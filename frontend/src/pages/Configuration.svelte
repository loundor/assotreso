<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import TerminalModal from '../components/TerminalModal.svelte';
  import { api, listFrom } from '../lib/api';
  import { getErrorMessage } from '../lib/utils';
  import type { AiConfig, AssociationConfig, ConfigData, DatabaseConfig, MemberConfig, User, UserRole } from '../lib/types';

  type Tab = 'association' | 'members' | 'users' | 'ai' | 'database';
  type Notice = { kind: 'success' | 'error'; text: string } | null;

  const roles: UserRole[] = ['ADMIN', 'TRESORIER', 'PRESIDENT', 'BUREAU', 'BENEVOLE'];
  const aiProviders = [
    { id: 'gemini', label: 'Google Gemini / Antigravity', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.8-flash-high', apiModel: 'gemini-2.5-flash', oauth: false, cli: true, help: 'Utilisation en CLI avec agy (terminal/TUI) ou avec une clé API Google AI Studio.' },
    { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4.1-mini', oauth: true, cli: false, help: 'Clé API ou connexion OAuth officielle avec autorisation dans le navigateur.' },
    { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.6-luna', oauth: true, cli: false, help: 'Clé API OpenAI ou connexion officielle à votre compte ChatGPT via Codex.' },
    { id: 'anthropic', label: 'Anthropic Claude', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5', oauth: false, cli: false, help: 'API native Anthropic avec une clé créée dans la console Anthropic.' },
    { id: 'mistral', label: 'Mistral AI', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', oauth: false, cli: false, help: 'API Mistral hébergée en Europe.' }
  ] as const;
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'association', label: 'Association' },
    { id: 'members', label: 'Membres' },
    { id: 'users', label: 'Utilisateurs & rôles' },
    { id: 'ai', label: 'Intelligence artificielle' },
    { id: 'database', label: 'Serveur SQL' }
  ];
  const emptyAssociation: AssociationConfig = {
    name: '', legalName: '', acronym: '', rna: '', siret: '', email: '', phone: '', website: '',
    address: '', addressLine2: '', postalCode: '', city: '', country: 'France', fiscalYearStartDay: 1, fiscalYearStartMonth: 1
  };
  const emptyMember = () => ({ firstName: '', lastName: '', email: '', phone: '', address: '', postalCode: '', city: '', role: '', active: true });
  const emptyUser = () => ({ name: '', email: '', password: '', role: 'BENEVOLE' as UserRole });

  let activeTab: Tab = 'association';
  let loading = true;
  let loadError = '';
  let saving = '';
  let notice: Notice = null;
  let association: AssociationConfig = { ...emptyAssociation };
  let members: MemberConfig[] = [];
  let users: User[] = [];
  let ai: AiConfig = { enabled: false, provider: '', authMode: 'api_key', baseUrl: '', model: '' };
  let database: DatabaseConfig = {};
  let compliance = { activeCount: 0, minimum: 7, compliant: false };
  let memberDraft = emptyMember();
  let editingMemberId: string | number | null = null;
  let userDraft = emptyUser();
  let aiSecret = '';
  let databaseTestUrl = '';
  let testResult = '';
  let oauthCallbackUrl = '';
  let oauthManualMode = false;
  let oauthManualCode = '';
  let oauthState = '';
  let oauthUserCode = '';
  let oauthPollTimer: ReturnType<typeof setTimeout> | undefined;
  let showTerminalModal = false;

  $: activeMemberCount = members.filter((member) => member.active !== false).length;
  $: displayedActiveCount = Number.isFinite(compliance.activeCount) ? compliance.activeCount : activeMemberCount;
  $: minimumMembers = compliance.minimum || 7;
  $: membersCompliant = displayedActiveCount >= minimumMembers;
  $: selectedAiProvider = aiProviders.find((provider) => provider.id === ai.provider) || aiProviders[0];

  const monthNames = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  const monthNamesShort = ['JAN','FÉV','MAR','AVR','MAI','JUIN','JUIL','AOÛT','SEPT','OCT','NOV','DÉC'];
  let fiscalDateInput: HTMLInputElement;

  $: fiscalDay = Math.max(1, Math.min(31, Number(association.fiscalYearStartDay) || 1));
  $: fiscalMonth = Math.max(1, Math.min(12, Number(association.fiscalYearStartMonth) || 1));
  $: fiscalDateLabel = `${fiscalDay === 1 ? '1er' : fiscalDay} ${monthNames[fiscalMonth - 1] || 'Janvier'}`;
  $: fiscalDateIso = `2026-${String(fiscalMonth).padStart(2, '0')}-${String(fiscalDay).padStart(2, '0')}`;

  function openFiscalDatePicker() {
    if (fiscalDateInput) {
      if (typeof fiscalDateInput.showPicker === 'function') {
        fiscalDateInput.showPicker();
      } else {
        fiscalDateInput.focus();
        fiscalDateInput.click();
      }
    }
  }

  function handleFiscalDateChange(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    if (!target.value) return;
    const parts = target.value.split('-');
    if (parts.length === 3) {
      const m = parseInt(parts[1], 10);
      const d = parseInt(parts[2], 10);
      if (!isNaN(m) && !isNaN(d)) {
        association.fiscalYearStartMonth = m;
        association.fiscalYearStartDay = d;
      }
    }
  }

  function unwrap<T>(payload: unknown, key: string, fallback: T): T {
    if (payload && typeof payload === 'object' && key in payload) return (payload as Record<string, unknown>)[key] as T;
    return (payload as T) ?? fallback;
  }

  function showNotice(kind: 'success' | 'error', text: string) {
    notice = { kind, text };
  }

  async function loadConfig() {
    loading = true; loadError = '';
    try {
      const config = await api.get<ConfigData>('config');
      association = { ...emptyAssociation, ...(config.association || {}) };
      members = Array.isArray(config.members) ? config.members : [];
      users = Array.isArray(config.users) ? config.users : [];
      ai = { enabled: false, provider: '', authMode: 'api_key', baseUrl: '', model: '', ...(config.ai || {}) };
      database = config.database || {};
      compliance = config.memberCompliance || { activeCount: members.filter((member) => member.active !== false).length, minimum: 7, compliant: false };
    } catch (error) { loadError = getErrorMessage(error); }
    finally { loading = false; }
  }

  let uploadingLogo = false;
  let logoVersion = Date.now();

  async function handleLogoUpload(file?: File) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showNotice('error', 'Veuillez sélectionner un fichier image valide (PNG, JPG, SVG, WebP).');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showNotice('error', 'L’image du logo ne doit pas dépasser 5 Mo.');
      return;
    }
    uploadingLogo = true; notice = null;
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.upload<{ association: AssociationConfig; logoUrl: string }>('config/logo', formData);
      association = { ...association, ...(res.association || {}), logoUrl: res.logoUrl || '/api/config/logo', hasLogo: true };
      logoVersion = Date.now();
      showNotice('success', 'Le logo a été mis à jour avec succès.');
      window.dispatchEvent(new CustomEvent('treso:config-updated'));
    } catch (error) {
      showNotice('error', getErrorMessage(error));
    } finally {
      uploadingLogo = false;
    }
  }

  async function deleteLogo() {
    if (!confirm('Supprimer le logo de l’association ?')) return;
    uploadingLogo = true; notice = null;
    try {
      const res = await api.delete<{ association: AssociationConfig }>('config/logo');
      association = { ...association, ...(res.association || {}), logoUrl: null, hasLogo: false };
      logoVersion = Date.now();
      showNotice('success', 'Le logo a été supprimé.');
      window.dispatchEvent(new CustomEvent('treso:config-updated'));
    } catch (error) {
      showNotice('error', getErrorMessage(error));
    } finally {
      uploadingLogo = false;
    }
  }

  async function saveAssociation() {
    saving = 'association'; notice = null;
    try {
      const day = Number(association.fiscalYearStartDay) || 1;
      const month = Number(association.fiscalYearStartMonth) || 1;
      const payload: AssociationConfig = {
        ...association,
        fiscalYearStartDay: day,
        fiscalYearStartMonth: month,
        fiscalStartDay: day,
        fiscalStartMonth: month
      };
      const result = await api.put<AssociationConfig | { association: AssociationConfig }>('config/association', payload);
      association = { ...association, ...unwrap(result, 'association', association), fiscalYearStartDay: day, fiscalYearStartMonth: month };
      showNotice('success', 'Les informations de l’association ont été enregistrées.');
      window.dispatchEvent(new CustomEvent('treso:config-updated'));
    } catch (error) { showNotice('error', getErrorMessage(error)); }
    finally { saving = ''; }
  }

  async function refreshMembers() {
    const result = await api.get<unknown>('config/members');
    members = listFrom<MemberConfig>(result, ['members']);
    compliance = { activeCount: members.filter((member) => member.active !== false).length, minimum: 7, compliant: false };
  }

  function editMember(member: MemberConfig) {
    editingMemberId = member.id;
    memberDraft = {
      firstName: member.firstName || '', lastName: member.lastName || member.name || '', email: member.email || '',
      phone: member.phone || '', address: member.address || '', postalCode: member.postalCode || '', city: member.city || '',
      role: member.role || '', active: member.active !== false
    };
    document.getElementById('member-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function cancelMemberEdit() { editingMemberId = null; memberDraft = emptyMember(); }

  async function saveMember() {
    saving = 'member'; notice = null;
    try {
      if (editingMemberId !== null) await api.put(`config/members/${editingMemberId}`, memberDraft);
      else await api.post('config/members', memberDraft);
      await refreshMembers();
      showNotice('success', editingMemberId !== null ? 'Le membre a été modifié.' : 'Le membre a été ajouté.');
      cancelMemberEdit();
    } catch (error) { showNotice('error', getErrorMessage(error)); }
    finally { saving = ''; }
  }

  async function toggleMember(member: MemberConfig) {
    saving = `member-${member.id}`; notice = null;
    try {
      await api.put(`config/members/${member.id}`, { ...member, active: member.active === false });
      await refreshMembers();
      showNotice('success', member.active === false ? 'Le membre a été réactivé.' : 'Le membre a été désactivé.');
    } catch (error) { showNotice('error', getErrorMessage(error)); }
    finally { saving = ''; }
  }

  async function deleteMember(member: MemberConfig) {
    const label = member.firstName || member.lastName || member.name || member.email || 'ce membre';
    if (!confirm(`Supprimer définitivement ${label} ?`)) return;
    saving = `member-${member.id}`; notice = null;
    try {
      await api.delete(`config/members/${member.id}`);
      await refreshMembers();
      showNotice('success', 'Le membre a été supprimé.');
    } catch (error) { showNotice('error', getErrorMessage(error)); }
    finally { saving = ''; }
  }

  async function refreshUsers() {
    const result = await api.get<unknown>('config/users');
    users = listFrom<User>(result, ['users']);
  }

  async function createUser() {
    saving = 'user'; notice = null;
    try {
      await api.post('config/users', userDraft);
      await refreshUsers();
      userDraft = emptyUser();
      showNotice('success', 'Le compte utilisateur a été créé.');
    } catch (error) { showNotice('error', getErrorMessage(error)); }
    finally { saving = ''; }
  }

  async function changeUserRole(user: User, role: UserRole) {
    if (user.role === role) return;
    saving = `user-${user.id}`; notice = null;
    try {
      await api.put(`config/users/${user.id}`, { role });
      users = users.map((item) => item.id === user.id ? { ...item, role } : item);
      showNotice('success', `Le rôle de ${user.name || user.email} a été mis à jour.`);
    } catch (error) { showNotice('error', getErrorMessage(error)); }
    finally { saving = ''; }
  }

  async function deleteUser(user: User) {
    if (user.id === undefined) return;
    const label = user.name || user.email;
    if (!confirm(`Supprimer définitivement le compte de ${label} ?\n\nSes anciennes actions comptables seront conservées, mais ce compte ne pourra plus se connecter.`)) return;
    saving = `user-${user.id}`; notice = null;
    try {
      await api.delete(`config/users/${user.id}`);
      await refreshUsers();
      showNotice('success', `Le compte de ${label} a été supprimé.`);
    } catch (error) { showNotice('error', getErrorMessage(error)); }
    finally { saving = ''; }
  }

  function selectAiProvider(providerId: string) {
    const provider = aiProviders.find((item) => item.id === providerId) || aiProviders[0];
    let nextAuthMode: 'oauth' | 'api_key' | 'cli' = 'api_key';
    if (provider.cli) nextAuthMode = 'cli';
    else if (provider.oauth && ai.authMode === 'oauth') nextAuthMode = 'oauth';

    ai = {
      ...ai,
      provider: provider.id,
      baseUrl: provider.baseUrl,
      model: nextAuthMode === 'cli' ? provider.model : (('apiModel' in provider && provider.apiModel) ? provider.apiModel : provider.model),
      authMode: nextAuthMode
    };
    aiSecret = '';
    testResult = '';
  }

  function onAuthModeChange(event: Event) {
    const newMode = (event.currentTarget as HTMLSelectElement).value as 'oauth' | 'api_key' | 'cli';
    ai.authMode = newMode;
    if (ai.provider === 'gemini') {
      if (newMode === 'cli' && (!ai.model || ai.model.startsWith('gemini-2') || ai.model.startsWith('gemini-1'))) {
        ai.model = 'gemini-3.8-flash-high';
      } else if (newMode === 'api_key' && (!ai.model || ai.model.startsWith('gemini-3'))) {
        ai.model = 'gemini-2.5-flash';
      }
    }
  }

  async function pollOpenAiOauth(state: string) {
    clearTimeout(oauthPollTimer);
    try {
      const result = await api.get<{ status: 'pending' | 'connected' | 'error'; message?: string; ai?: AiConfig }>(`config/ai/oauth/status/${state}`);
      if (result.status === 'connected') {
        ai = { ...ai, ...(result.ai || {}), oauthStatus: 'configure' };
        oauthState = ''; oauthUserCode = '';
        showNotice('success', result.message || 'OpenAI est connecté avec votre compte ChatGPT.');
        return;
      }
      if (result.status === 'error') {
        oauthState = '';
        showNotice('error', result.message || 'La connexion OpenAI a échoué ou a expiré.');
        return;
      }
      oauthPollTimer = setTimeout(() => void pollOpenAiOauth(state), 2_000);
    } catch (error) {
      oauthState = '';
      showNotice('error', getErrorMessage(error));
    }
  }

  async function connectAiOauth() {
    saving = 'ai-oauth'; notice = null; testResult = ''; oauthManualCode = ''; oauthState = ''; oauthUserCode = '';
    clearTimeout(oauthPollTimer);
    const popup = window.open('about:blank', 'treso-ai-oauth', 'popup,width=720,height=780');
    try {
      const saved = await api.put<AiConfig | { ai: AiConfig }>('config/ai', {
        enabled: ai.enabled === true, provider: ai.provider, authMode: 'oauth', baseUrl: ai.baseUrl, model: ai.model
      });
      ai = { ...ai, ...unwrap(saved, 'ai', ai) };
      const result = await api.post<{ authorizationUrl: string; state: string; userCode?: string; provider: string }>('config/ai/oauth/start', {
        manual: ai.provider === 'openrouter' && oauthManualMode,
        callbackUrl: oauthCallbackUrl
      });
      oauthState = result.state;
      oauthUserCode = result.userCode || '';
      if (popup) popup.location.href = result.authorizationUrl;
      else window.open(result.authorizationUrl, '_blank', 'noopener');
      if (result.provider === 'openai') {
        showNotice('success', 'La page OpenAI a été ouverte. Saisissez le code affiché ci-dessous puis acceptez la connexion.');
        void pollOpenAiOauth(result.state);
      } else {
        showNotice('success', oauthManualMode
          ? 'Autorisez OpenRouter, copiez le code affiché puis collez-le ci-dessous.'
          : 'La fenêtre OpenRouter a été ouverte. Acceptez l’autorisation pour terminer la connexion.');
      }
    } catch (error) {
      popup?.close();
      showNotice('error', getErrorMessage(error));
    } finally { saving = ''; }
  }

  async function completeManualOauth() {
    saving = 'ai-oauth-complete'; notice = null;
    try {
      const result = await api.post<{ ai: AiConfig }>('config/ai/oauth/complete', { state: oauthState, code: oauthManualCode.trim() });
      ai = { ...ai, ...(result.ai || {}) };
      oauthManualCode = ''; oauthState = '';
      showNotice('success', 'OpenRouter est connecté. La clé générée a été chiffrée sur le serveur.');
    } catch (error) { showNotice('error', getErrorMessage(error)); }
    finally { saving = ''; }
  }

  async function saveAi() {
    saving = 'ai'; notice = null; testResult = '';
    const payload: Record<string, unknown> = { enabled: ai.enabled === true, provider: ai.provider, authMode: ai.authMode, baseUrl: ai.baseUrl, model: ai.model };
    if (aiSecret.trim()) payload[ai.authMode === 'oauth' ? 'oauthToken' : 'apiKey'] = aiSecret.trim();
    try {
      const result = await api.put<AiConfig | { ai: AiConfig }>('config/ai', payload);
      ai = { ...ai, ...unwrap(result, 'ai', ai) };
      aiSecret = '';
      showNotice('success', 'La configuration IA a été enregistrée. Le secret saisi a été effacé de ce formulaire.');
    } catch (error) { showNotice('error', getErrorMessage(error)); }
    finally { saving = ''; }
  }

  async function testAi() {
    saving = 'ai-test'; notice = null; testResult = '';
    try {
      const payload: Record<string, unknown> = {
        provider: ai.provider,
        authMode: ai.authMode,
        baseUrl: ai.baseUrl,
        model: ai.model
      };
      if (aiSecret.trim()) payload.secret = aiSecret.trim();
      const result = await api.post<Record<string, unknown>>('config/ai/test', payload);
      if (result.connected === false) throw new Error(typeof result.message === 'string' ? result.message : 'Connexion au service IA impossible.');
      testResult = typeof result?.message === 'string' ? result.message : 'Connexion au service IA réussie.';
    } catch (error) { showNotice('error', getErrorMessage(error)); }
    finally { saving = ''; }
  }

  async function testDatabase() {
    saving = 'database-test'; notice = null; testResult = '';
    try {
      const result = await api.post<Record<string, unknown>>('config/database/test', { url: databaseTestUrl });
      if (result.connected === false) throw new Error(typeof result.message === 'string' ? result.message : 'Connexion SQL impossible.');
      testResult = typeof result?.message === 'string' ? result.message : 'Connexion SQL réussie.';
      databaseTestUrl = '';
    } catch (error) { showNotice('error', getErrorMessage(error)); }
    finally { saving = ''; }
  }

  interface AiPromptItem {
    id: string;
    name: string;
    title: string;
    description: string;
    content: string;
  }

  let aiPrompts: AiPromptItem[] = [];
  let selectedPromptId = 'analyse_justificatif';
  let promptDraft = '';
  let loadingPrompts = false;
  let savingPrompt = false;

  $: currentPrompt = aiPrompts.find((p) => p.id === selectedPromptId) || aiPrompts[0];

  function selectPrompt(id: string) {
    selectedPromptId = id;
    const found = aiPrompts.find((p) => p.id === id);
    if (found) {
      promptDraft = found.content;
    }
  }

  async function loadAiPrompts() {
    loadingPrompts = true;
    try {
      const res = await api.get<{ prompts: AiPromptItem[] }>('config/ai/prompts');
      aiPrompts = res.prompts || [];
      if (aiPrompts.length > 0) {
        const active = aiPrompts.find((p) => p.id === selectedPromptId) || aiPrompts[0];
        if (active) {
          selectedPromptId = active.id;
          promptDraft = active.content;
        }
      }
    } catch (err) {
      console.error('Failed to load prompts', err);
    } finally {
      loadingPrompts = false;
    }
  }

  async function saveCurrentPrompt() {
    if (!currentPrompt) return;
    savingPrompt = true;
    notice = null;
    try {
      const res = await api.put<{ prompt: AiPromptItem }>(`config/ai/prompts/${currentPrompt.id}`, { content: promptDraft });
      const idx = aiPrompts.findIndex((p) => p.id === currentPrompt.id);
      if (idx >= 0 && res.prompt) {
        aiPrompts[idx] = res.prompt;
      }
      showNotice('success', `Le fichier de contexte « ${currentPrompt.name} » a été mis à jour avec succès.`);
    } catch (error) {
      showNotice('error', getErrorMessage(error));
    } finally {
      savingPrompt = false;
    }
  }

  onMount(() => {
    oauthCallbackUrl = `${window.location.origin}/api/config/ai/oauth/callback`;
    const receiveOauthResult = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'treso:ai-oauth') return;
      if (event.data.success) {
        const result = await api.get<{ ai: AiConfig }>('config/ai');
        ai = { ...ai, ...(result.ai || {}) };
        showNotice('success', event.data.message || 'Connexion OAuth réussie.');
      } else showNotice('error', event.data.message || 'Connexion OAuth impossible.');
    };
    window.addEventListener('message', receiveOauthResult);
    void loadConfig();
    void loadAiPrompts();
    return () => {
      clearTimeout(oauthPollTimer);
      window.removeEventListener('message', receiveOauthResult);
    };
  });
</script>

<div class="page-stack configuration-page">
  <section class="configuration-hero">
    <div><span class="eyebrow">Administration</span><h2>Configuration de l’association</h2><p>Gérez l’identité, les membres, les accès et les services externes depuis un espace protégé.</p></div>
    <span class="admin-badge"><Icon name="settings" size={18}/> Accès administrateur</span>
  </section>

  {#if loading}
    <div class="state" role="status"><span class="spinner"></span><p>Chargement de la configuration…</p></div>
  {:else if loadError}
    <div class="state"><span class="state-icon"><Icon name="alert"/></span><h3>Configuration indisponible</h3><p>{loadError}</p><button class="btn btn-secondary" on:click={loadConfig}>Réessayer</button></div>
  {:else}
    <nav class="config-tabs" aria-label="Sections de configuration">
      {#each tabs as tab}<button class:active={activeTab === tab.id} aria-current={activeTab === tab.id ? 'page' : undefined} on:click={() => { activeTab = tab.id; notice = null; testResult = ''; }}>{tab.label}</button>{/each}
    </nav>

    {#if notice}<div class:success={notice.kind === 'success'} class="config-notice" role={notice.kind === 'error' ? 'alert' : 'status'}>{#if notice.kind === 'error'}<Icon name="alert" size={18}/>{:else}<Icon name="check" size={18}/>{/if}{notice.text}</div>{/if}
    {#if testResult}<div class="config-notice success" role="status"><Icon name="check" size={18}/>{testResult}</div>{/if}

    {#if activeTab === 'association'}
      <form class="panel config-panel inline-form" on:submit|preventDefault={saveAssociation}>
        <div class="form-heading"><h3>Identité et coordonnées</h3><p>Informations administratives et publiques de l’association.</p></div>

        <!-- Section Logo de l'association -->
        <div class="logo-config-card">
          <div class="logo-preview-container">
            {#if association.hasLogo || association.logoUrl}
              <img src={`/api/config/logo?t=${logoVersion}`} alt="Logo de l'association" class="logo-preview-image" />
            {:else}
              <div class="logo-preview-empty">
                <Icon name="upload" size={26}/>
                <span>Aucun logo</span>
              </div>
            {/if}
          </div>
          <div class="logo-config-details">
            <div class="logo-title-wrap">
              <strong>Logo officiel de l’association</strong>
              <small>Ce logo s'affiche dans le menu et sur l'ensemble de l'application.</small>
            </div>
            <div class="logo-action-buttons">
              <label class="btn btn-secondary btn-small upload-logo-label">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  style="display:none"
                  on:change={(e) => handleLogoUpload(e.currentTarget.files?.[0])}
                  disabled={uploadingLogo}
                />
                <Icon name="upload" size={15}/>
                <span>{uploadingLogo ? 'Téléversement…' : (association.hasLogo ? 'Remplacer le logo' : 'Téléverser le logo')}</span>
              </label>
              {#if association.hasLogo}
                <button
                  type="button"
                  class="btn btn-secondary btn-small danger-outline"
                  on:click={deleteLogo}
                  disabled={uploadingLogo}
                >
                  <Icon name="trash" size={15}/> Supprimer
                </button>
              {/if}
            </div>
          </div>
        </div>

        <div class="form-grid">
          <label>Nom usuel<input bind:value={association.name} required autocomplete="organization"/></label>
          <label>Dénomination légale<input bind:value={association.legalName}/></label>
          <label>Sigle<input bind:value={association.acronym} placeholder="Ex. ADMR, GEM, AS"/></label>
          <label>Numéro RNA<input bind:value={association.rna} placeholder="W…"/></label>
          <label>SIRET<input bind:value={association.siret} inputmode="numeric"/></label>
          <label>Email<input type="email" bind:value={association.email} autocomplete="email"/></label>
          <label>Téléphone<input type="tel" bind:value={association.phone} autocomplete="tel"/></label>
          <label>Site internet<input type="url" bind:value={association.website} placeholder="https://"/></label>
          <label class="span-2">Adresse<input bind:value={association.address} autocomplete="street-address"/></label>
          <label class="span-2">Complément d’adresse<input bind:value={association.addressLine2}/></label>
          <label>Code postal<input bind:value={association.postalCode} autocomplete="postal-code"/></label>
          <label>Ville<input bind:value={association.city} autocomplete="address-level2"/></label>
          <label>Pays<input bind:value={association.country} autocomplete="country-name"/></label>
        </div>
        <div class="fiscal-block-container">
          <label class="fiscal-block-label" for="fiscal-picker-input">
            Début de l’exercice comptable
          </label>
          <button
            type="button"
            class="fiscal-date-card"
            on:click={openFiscalDatePicker}
            title="Cliquer pour choisir le jour et le mois"
          >
            <div class="fiscal-date-calendar">
              <div class="calendar-header">{monthNamesShort[fiscalMonth - 1] || 'JAN'}</div>
              <div class="calendar-body">{fiscalDay}</div>
            </div>
            <div class="fiscal-date-details">
              <span class="fiscal-date-primary">{fiscalDateLabel}</span>
              <span class="fiscal-date-hint">Cliquez pour choisir le jour et le mois</span>
            </div>
            <div class="fiscal-date-cta">
              <span class="btn btn-secondary btn-small">Choisir la date</span>
            </div>
          </button>
          <input
            id="fiscal-picker-input"
            bind:this={fiscalDateInput}
            type="date"
            class="fiscal-native-input"
            value={fiscalDateIso}
            on:change={handleFiscalDateChange}
            tabindex="-1"
            aria-hidden="true"
          />
        </div>
        <div class="form-actions"><button class="btn btn-primary" disabled={saving === 'association'}>{saving === 'association' ? 'Enregistrement…' : 'Enregistrer l’association'}</button></div>
      </form>
    {:else if activeTab === 'members'}
      <section class:warning={!membersCompliant} class="compliance-card" aria-live="polite"><div><strong>{displayedActiveCount} membre{displayedActiveCount > 1 ? 's' : ''} actif{displayedActiveCount > 1 ? 's' : ''}</strong><span>Minimum attendu : {minimumMembers}</span></div>{#if membersCompliant}<span class="compliance-ok"><Icon name="check" size={18}/> Seuil respecté</span>{:else}<span class="compliance-warning"><Icon name="alert" size={18}/> Association alsacienne : minimum attendu 7</span>{/if}</section>
      <form id="member-form" class="panel config-panel inline-form" on:submit|preventDefault={saveMember}>
        <div class="form-heading"><h3>{editingMemberId !== null ? 'Modifier le membre' : 'Ajouter un membre'}</h3><p>Enregistrez les coordonnées utiles et son statut dans l’association.</p></div>
        <div class="form-grid"><label>Prénom<input bind:value={memberDraft.firstName} required autocomplete="given-name"/></label><label>Nom<input bind:value={memberDraft.lastName} required autocomplete="family-name"/></label><label>Email<input type="email" bind:value={memberDraft.email} autocomplete="email"/></label><label>Téléphone<input type="tel" bind:value={memberDraft.phone} autocomplete="tel"/></label><label class="span-2">Adresse<input bind:value={memberDraft.address} autocomplete="street-address"/></label><label>Code postal<input bind:value={memberDraft.postalCode} autocomplete="postal-code"/></label><label>Ville<input bind:value={memberDraft.city} autocomplete="address-level2"/></label><label>Fonction / qualité<input bind:value={memberDraft.role} placeholder="Ex. membre du bureau"/></label><label class="checkbox-field"><input type="checkbox" bind:checked={memberDraft.active}/> Membre actif</label></div>
        <div class="form-actions config-actions">{#if editingMemberId !== null}<button type="button" class="btn btn-secondary" on:click={cancelMemberEdit}>Annuler</button>{/if}<button class="btn btn-primary" disabled={saving === 'member'}>{saving === 'member' ? 'Enregistrement…' : editingMemberId !== null ? 'Enregistrer les modifications' : 'Ajouter le membre'}</button></div>
      </form>
      <section class="panel table-panel"><div class="panel-heading config-table-heading"><div><h3>Liste des membres</h3><p>{members.length} membre{members.length > 1 ? 's' : ''} enregistré{members.length > 1 ? 's' : ''}</p></div></div><div class="table-wrap"><table><thead><tr><th>Membre</th><th>Coordonnées</th><th>Fonction</th><th>Statut</th><th>Actions</th></tr></thead><tbody>{#each members as member}<tr><td data-label="Membre"><strong>{member.firstName} {member.lastName || member.name}</strong></td><td data-label="Coordonnées">{member.email || '—'}<small>{member.phone || ''}</small></td><td data-label="Fonction">{member.role || '—'}</td><td data-label="Statut"><span class:inactive={member.active === false} class="soft-badge">{member.active === false ? 'Inactif' : 'Actif'}</span></td><td data-label="Actions"><div class="row-actions"><button class="text-button" on:click={() => editMember(member)}>Modifier</button><button class="text-button" disabled={saving === `member-${member.id}`} on:click={() => toggleMember(member)}>{member.active === false ? 'Réactiver' : 'Désactiver'}</button><button class="text-button danger" disabled={saving === `member-${member.id}`} on:click={() => deleteMember(member)}>Supprimer</button></div></td></tr>{:else}<tr><td colspan="5"><div class="mini-empty">Aucun membre enregistré.</div></td></tr>{/each}</tbody></table></div></section>
    {:else if activeTab === 'users'}
      <form class="panel config-panel inline-form" on:submit|preventDefault={createUser}>
        <div class="form-heading"><h3>Créer un utilisateur</h3><p>Le mot de passe est envoyé une seule fois lors de la création.</p></div>
        <div class="form-grid"><label>Nom<input bind:value={userDraft.name} required autocomplete="name"/></label><label>Email<input type="email" bind:value={userDraft.email} required autocomplete="email"/></label><label>Mot de passe initial<input type="password" bind:value={userDraft.password} required minlength="8" autocomplete="new-password"/></label><label>Rôle<select bind:value={userDraft.role}>{#each roles as role}<option value={role}>{role}</option>{/each}</select></label></div>
        <div class="form-actions"><button class="btn btn-primary" disabled={saving === 'user'}>{saving === 'user' ? 'Création…' : 'Créer le compte'}</button></div>
      </form>
      <section class="panel table-panel"><div class="panel-heading config-table-heading"><div><h3>Utilisateurs et rôles</h3><p>La suppression retire définitivement l’accès, sans effacer l’historique comptable associé.</p></div></div><div class="table-wrap"><table><thead><tr><th>Utilisateur</th><th>Email</th><th>Rôle</th><th>Actions</th></tr></thead><tbody>{#each users as account}<tr><td data-label="Utilisateur"><strong>{account.name || 'Sans nom'}</strong></td><td data-label="Email">{account.email}</td><td data-label="Rôle"><select class="role-select" value={account.role || 'BENEVOLE'} disabled={saving === `user-${account.id}`} aria-label={`Rôle de ${account.name || account.email}`} on:change={(event) => changeUserRole(account, event.currentTarget.value as UserRole)}>{#each roles as role}<option value={role}>{role}</option>{/each}</select></td><td data-label="Actions"><button class="text-button danger" disabled={saving === `user-${account.id}`} on:click={() => deleteUser(account)}>{saving === `user-${account.id}` ? 'Traitement…' : 'Supprimer'}</button></td></tr>{:else}<tr><td colspan="4"><div class="mini-empty">Aucun utilisateur enregistré.</div></td></tr>{/each}</tbody></table></div></section>
    {:else if activeTab === 'ai'}
      <form class="panel config-panel inline-form" on:submit|preventDefault={saveAi}>
        <div class="form-heading"><h3>Service d’intelligence artificielle</h3><p>Choisissez un fournisseur : les paramètres techniques adaptés sont préremplis automatiquement.</p></div>
        <div class="data-warning"><Icon name="alert" size={20}/><div><strong>Transmission à un service tiers</strong><span>Lorsque l’analyse IA est choisie, le texte extrait par OCR peut être transmis au fournisseur configuré. Vérifiez ses conditions de confidentialité et de traitement des données.</span></div></div>
        <label class="switch-field"><input type="checkbox" bind:checked={ai.enabled}/><span><strong>Activer l’analyse avec IA</strong><small>Les utilisateurs pourront choisir cette option lors de l’import.</small></span></label>
        <div class="form-grid">
          <label>Fournisseur
            <select value={ai.provider || 'gemini'} on:change={(event) => selectAiProvider(event.currentTarget.value)}>
              {#each aiProviders as provider}
                <option value={provider.id}>{provider.label}</option>
              {/each}
            </select>
            <small class="field-help">{selectedAiProvider.help}</small>
          </label>
          <label>Mode d’authentification
            <select value={ai.authMode || 'api_key'} on:change={onAuthModeChange}>
              {#if selectedAiProvider.cli}
                <option value="cli">Ligne de commande CLI (agy)</option>
              {/if}
              <option value="api_key">Clé API</option>
              {#if selectedAiProvider.oauth}
                <option value="oauth">Connexion OAuth</option>
              {/if}
            </select>
            <small class="field-help">Seuls les parcours officiellement proposés par le fournisseur sont affichés.</small>
          </label>
          {#if ai.authMode !== 'cli'}
            <label class="span-2">URL de base
              <input type="url" bind:value={ai.baseUrl} required placeholder="https://api.example.com/v1"/>
              <small class="field-help">Modifiable pour un proxy, une passerelle ou un serveur compatible.</small>
            </label>
          {/if}
          <label class:span-2={ai.authMode === 'cli'}>Modèle
            <input bind:value={ai.model} required placeholder="Nom du modèle"/>
            <small class="field-help">Exemple proposé : {selectedAiProvider.model || 'modèle exposé par votre serveur'}.</small>
          </label>
          {#if ai.authMode === 'api_key'}
            <label>Nouvelle clé API
              <input type="password" bind:value={aiSecret} autocomplete="new-password" placeholder="Laisser vide pour conserver la clé actuelle"/>
              <small class="field-help">La clé existante n’est jamais affichée. Toute valeur saisie est effacée après enregistrement.</small>
            </label>
          {/if}
        </div>
        {#if ai.authMode === 'cli'}
          <section class="oauth-connect-card">
            <div>
              <strong>Exécution par CLI locale (Antigravity agy)</strong>
              <p>L’analyse documentaire est confiée directement au CLI <code>agy</code>. Le document original (PDF ou image) et les instructions Markdown lui sont transmis pour extraire directement le récapitulatif comptable en JSON.</p>
            </div>
            <div class="manual-oauth">
              <label>Modèle agy conseillé
                <input list="agy-model-suggestions" bind:value={ai.model} placeholder="gemini-3.8-flash-high"/>
                <datalist id="agy-model-suggestions">
                  <option value="gemini-3.8-flash-high">Gemini 3.8 Flash (High)</option>
                  <option value="gemini-3.7-flash-high">Gemini 3.7 Flash (High)</option>
                  <option value="gemini-3.6-flash-high">Gemini 3.6 Flash (High)</option>
                  <option value="gemini-3.1-pro-high">Gemini 3.1 Pro (High)</option>
                  <option value="claude-sonnet-4-6">Claude Sonnet 4.6 (Thinking)</option>
                </datalist>
              </label>
              <p class="field-help">Si <code>agy</code> nécessite une première connexion au compte ou pour tester la session en direct, vous pouvez ouvrir son terminal interactif.</p>
            </div>
            <div class="terminal-trigger-wrap">
              <button type="button" class="btn btn-secondary" on:click={() => showTerminalModal = true}>
                <Icon name="settings" size={16}/> Ouvrir le terminal / TUI agy
              </button>
            </div>
            <span class="oauth-connected"><Icon name="check" size={17}/> Session CLI configurable</span>
          </section>
        {:else if ai.authMode === 'oauth' && ai.provider === 'openrouter'}
          <section class="oauth-connect-card">
            <div><strong>Connexion sécurisée à OpenRouter</strong><p>Une fenêtre OpenRouter demandera votre autorisation. La clé produite sera récupérée par le serveur puis stockée chiffrée.</p></div>
            <label>Adresse de callback<input type="url" bind:value={oauthCallbackUrl} required/><small class="field-help">Sur votre poste de développement, `localhost` et son port actuel sont acceptés.</small></label>
            <label class="checkbox-field"><input type="checkbox" bind:checked={oauthManualMode}/> Mode développement manuel / serveur sans callback accessible</label>
            {#if oauthManualMode && oauthState}
              <div class="manual-oauth"><label>Code affiché par OpenRouter<input bind:value={oauthManualCode} autocomplete="off" placeholder="Collez le code d’autorisation"/></label><button type="button" class="btn btn-secondary" disabled={!oauthManualCode.trim() || saving === 'ai-oauth-complete'} on:click={completeManualOauth}>{saving === 'ai-oauth-complete' ? 'Validation…' : 'Valider le code'}</button></div>
            {/if}
            <button type="button" class="btn btn-primary" disabled={saving === 'ai-oauth'} on:click={connectAiOauth}>{saving === 'ai-oauth' ? 'Ouverture…' : ai.oauthStatus === 'configure' ? 'Reconnecter OpenRouter' : 'Se connecter à OpenRouter'}</button>
            {#if ai.oauthStatus === 'configure'}<span class="oauth-connected"><Icon name="check" size={17}/> OpenRouter connecté</span>{/if}
          </section>
        {:else if ai.authMode === 'oauth' && ai.provider === 'openai'}
          <section class="oauth-connect-card">
            <div><strong>Connexion officielle à OpenAI avec ChatGPT</strong><p>Le serveur utilise Codex pour ouvrir l’autorisation OpenAI. Ce mode fonctionne aussi sur `localhost` et dans Docker sans adresse de callback publique.</p></div>
            {#if oauthUserCode}
              <div class="manual-oauth"><label>Code temporaire OpenAI<input value={oauthUserCode} readonly aria-label="Code temporaire OpenAI"/></label><p class="field-help">Saisissez ce code dans la page OpenAI ouverte. Il expire après 15 minutes.</p></div>
            {/if}
            <button type="button" class="btn btn-primary" disabled={saving === 'ai-oauth' || Boolean(oauthState)} on:click={connectAiOauth}>{saving === 'ai-oauth' ? 'Ouverture…' : oauthState ? 'Autorisation en attente…' : ai.oauthStatus === 'configure' ? 'Reconnecter OpenAI' : 'Se connecter à OpenAI'}</button>
            {#if ai.oauthStatus === 'configure'}<span class="oauth-connected"><Icon name="check" size={17}/> OpenAI connecté via ChatGPT</span>{/if}
          </section>
        {/if}
        <div class="form-actions config-actions"><button type="button" class="btn btn-secondary" disabled={saving === 'ai-test'} on:click={testAi}>{saving === 'ai-test' ? 'Test en cours…' : 'Tester la connexion'}</button><button class="btn btn-primary" disabled={saving === 'ai'}>{saving === 'ai' ? 'Enregistrement…' : 'Enregistrer l’IA'}</button></div>
      </form>

      <!-- CONTEXTES ET DIRECTIVES MARKDOWN DES IA -->
      <section class="panel config-panel prompt-management-panel">
        <div class="form-heading">
          <div class="prompt-header-row">
            <div>
              <h3>📄 Contextes & Directives des IA (Fichiers Markdown)</h3>
              <p>Consultez et modifiez les instructions envoyées aux modèles IA pour adapter l’extraction des factures et la forme du rapport PDF.</p>
            </div>
            {#if currentPrompt}
              <span class="badge-mini subtle">Fichier : <code>{currentPrompt.name}</code></span>
            {/if}
          </div>
        </div>

        <div class="prompt-tabs-bar">
          {#each aiPrompts as p}
            <button
              type="button"
              class="prompt-tab-btn"
              class:active={p.id === selectedPromptId}
              on:click={() => selectPrompt(p.id)}
            >
              <span class="prompt-tab-icon">{p.id === 'analyse_justificatif' ? '🧾' : '📊'}</span>
              <div class="prompt-tab-labels">
                <strong>{p.name}</strong>
                <small>{p.id === 'analyse_justificatif' ? 'Extraction factures & justificatifs' : 'Rapport financier officiel (PDF)'}</small>
              </div>
            </button>
          {/each}
        </div>

        {#if currentPrompt}
          <div class="prompt-editor-card">
            <div class="prompt-meta-box">
              <div class="prompt-meta-title">
                <strong>{currentPrompt.title}</strong>
              </div>
              <p class="prompt-meta-desc">{currentPrompt.description}</p>
            </div>

            <div class="editor-textarea-wrapper">
              <textarea
                class="prompt-code-textarea"
                bind:value={promptDraft}
                rows="18"
                spellcheck="false"
                placeholder="Directives et instructions au format Markdown..."
              ></textarea>
            </div>

            <div class="form-actions prompt-footer-actions">
              <button
                type="button"
                class="btn btn-secondary"
                on:click={() => { if (currentPrompt) promptDraft = currentPrompt.content; }}
                disabled={savingPrompt || promptDraft === currentPrompt.content}
              >
                Rétablir le texte sauvegardé
              </button>
              <button
                type="button"
                class="btn btn-primary"
                disabled={savingPrompt || promptDraft === currentPrompt.content}
                on:click={saveCurrentPrompt}
              >
                {savingPrompt ? 'Enregistrement…' : 'Enregistrer les modifications du contexte'}
              </button>
            </div>
          </div>
        {:else if loadingPrompts}
          <p class="field-help">Chargement des fichiers de contexte…</p>
        {/if}
      </section>
    {:else}
      <section class="panel config-panel">
        <div class="form-heading"><h3>État du serveur SQL</h3><p>Seules les informations techniques non sensibles communiquées par le serveur sont affichées.</p></div>
        <dl class="database-details"><div><dt>État</dt><dd><span class:inactive={database.connected === false} class="soft-badge">{database.connected === true ? 'Connecté' : database.connected === false ? 'Déconnecté' : database.status || 'Inconnu'}</span></dd></div><div><dt>Type</dt><dd>{database.dialect || '—'}</dd></div><div><dt>Hôte</dt><dd>{database.host || '—'}</dd></div><div><dt>Port</dt><dd>{database.port || '—'}</dd></div><div><dt>Base</dt><dd>{database.database || database.name || '—'}</dd></div><div><dt>Version</dt><dd>{database.version || '—'}</dd></div></dl>
      </section>
      <form class="panel config-panel inline-form" on:submit|preventDefault={testDatabase}>
        <div class="form-heading"><h3>Tester une URL temporaire</h3><p>L’URL est envoyée uniquement au test de connexion. Elle n’est ni enregistrée ni réaffichée par le frontend.</p></div>
        <div class="data-warning neutral"><Icon name="check" size={20}/><div><strong>Secret éphémère</strong><span>Le mot de passe éventuellement inclus dans cette URL reste masqué et le champ est vidé après un test réussi.</span></div></div>
        <label>URL de connexion SQL<input type="password" bind:value={databaseTestUrl} required autocomplete="off" placeholder="postgresql://utilisateur:mot-de-passe@hôte:5432/base"/></label>
        <div class="form-actions"><button class="btn btn-primary" disabled={saving === 'database-test'}>{saving === 'database-test' ? 'Test en cours…' : 'Tester la connexion SQL'}</button></div>
      </form>
    {/if}
  {/if}

  {#if showTerminalModal}
    <TerminalModal onClose={() => { showTerminalModal = false; void testAi(); }} />
  {/if}
</div>

<style>
  .logo-config-card {
    display: flex;
    align-items: center;
    gap: 1.25rem;
    padding: 1.2rem;
    background: #f8faf9;
    border: 1px solid #dce5df;
    border-radius: 12px;
    margin-bottom: 1.2rem;
  }
  .logo-preview-container {
    width: 76px;
    height: 76px;
    border-radius: 12px;
    border: 2px dashed #b8ccc2;
    background: white;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    flex-shrink: 0;
  }
  .logo-preview-image {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
  .logo-preview-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
    color: var(--muted);
    font-size: 0.65rem;
    text-align: center;
  }
  .logo-config-details {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .logo-title-wrap strong {
    font-size: 0.95rem;
    color: var(--ink);
    display: block;
  }
  .logo-title-wrap small {
    color: var(--muted);
    font-size: 0.78rem;
  }
  .logo-action-buttons {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
    margin-top: 0.2rem;
  }
  .upload-logo-label {
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .fiscal-block-container {
    margin: 1.25rem 0;
    position: relative;
  }
  .fiscal-block-label {
    display: block;
    font-weight: 700;
    font-size: 0.88rem;
    color: var(--ink);
    margin-bottom: 0.5rem;
  }
  .fiscal-date-card {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.85rem 1.15rem;
    background: white;
    border: 2px solid var(--line);
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.2s ease;
    width: 100%;
    max-width: 440px;
    text-align: left;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  }
  .fiscal-date-card:hover {
    border-color: var(--green);
    background: #fbfdfc;
    box-shadow: 0 4px 14px rgba(23, 63, 52, 0.08);
  }
  .fiscal-date-calendar {
    width: 52px;
    height: 56px;
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 2px 5px rgba(0,0,0,0.04);
    flex-shrink: 0;
  }
  .fiscal-date-calendar .calendar-header {
    background: var(--green);
    color: white;
    font-size: 0.65rem;
    font-weight: 800;
    text-align: center;
    padding: 0.15rem 0;
    letter-spacing: 0.5px;
  }
  .fiscal-date-calendar .calendar-body {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.25rem;
    font-weight: 800;
    color: var(--ink);
  }
  .fiscal-date-details {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .fiscal-date-primary {
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--ink);
  }
  .fiscal-date-hint {
    font-size: 0.78rem;
    color: var(--muted);
  }
  .fiscal-native-input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
    width: 1px;
    height: 1px;
    bottom: 0;
    left: 0;
  }

  /* PROMPT MANAGEMENT PANEL */
  .prompt-management-panel {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    margin-top: 1.5rem;
  }
  .prompt-header-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .prompt-tabs-bar {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .prompt-tab-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1.1rem;
    background: #f4f7f5;
    border: 1px solid var(--line);
    border-radius: 10px;
    cursor: pointer;
    text-align: left;
    transition: all 0.2s ease;
  }
  .prompt-tab-btn:hover {
    background: #eef3f0;
    border-color: #cbd5d0;
  }
  .prompt-tab-btn.active {
    background: white;
    border-color: var(--green);
    box-shadow: 0 3px 10px rgba(0,0,0,0.06);
  }
  .prompt-tab-icon {
    font-size: 1.4rem;
  }
  .prompt-tab-labels {
    display: flex;
    flex-direction: column;
  }
  .prompt-tab-labels strong {
    font-size: 0.88rem;
    color: var(--ink);
  }
  .prompt-tab-labels small {
    font-size: 0.75rem;
    color: var(--muted);
  }
  .prompt-editor-card {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    background: #fafcfb;
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 1.25rem;
  }
  .prompt-meta-box {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid #eef2ef;
  }
  .prompt-meta-title strong {
    font-size: 0.95rem;
    color: var(--ink);
  }
  .prompt-meta-desc {
    margin: 0;
    font-size: 0.82rem;
    color: var(--muted);
    line-height: 1.4;
  }
  .editor-textarea-wrapper {
    width: 100%;
  }
  .prompt-code-textarea {
    width: 100%;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 0.86rem;
    line-height: 1.55;
    padding: 1rem;
    background: #ffffff;
    color: #1f2937;
    border: 1px solid var(--line);
    border-radius: 8px;
    resize: vertical;
    box-sizing: border-box;
    outline: none;
    transition: border-color 0.2s ease;
  }
  .prompt-code-textarea:focus {
    border-color: var(--green);
    box-shadow: 0 0 0 3px rgba(42, 157, 143, 0.15);
  }
  .prompt-footer-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    margin-top: 0.25rem;
  }
  @media (max-width: 600px) {
    .logo-config-card { align-items: flex-start; flex-direction: column; padding: 1rem; }
    .logo-config-details,.logo-action-buttons,.logo-action-buttons .btn,.upload-logo-label { width: 100%; }
    .logo-action-buttons { align-items: stretch; flex-direction: column; }
    .fiscal-date-card { padding: 0.75rem; }
    .prompt-tabs-bar { display: grid; grid-template-columns: 1fr; width: 100%; }
    .prompt-tab-btn { width: 100%; }
    .prompt-editor-card { padding: 0.85rem; }
    .prompt-code-textarea { min-height: 280px; padding: 0.75rem; }
    .prompt-footer-actions { align-items: stretch; flex-direction: column-reverse; }
    .prompt-footer-actions .btn { width: 100%; }
  }
</style>

