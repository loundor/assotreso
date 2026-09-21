<script lang="ts">
  import { onMount } from 'svelte';
  import AsyncState from '../components/AsyncState.svelte';
  import Icon from '../components/Icon.svelte';
  import { api, listFrom } from '../lib/api';
  import { currency, formatDate, getErrorMessage } from '../lib/utils';
  import type { Account } from '../lib/types';

  let accounts: Account[] = [];
  let loading = true;
  let error = '';

  // Formulaire d'ajout / édition de compte
  let formOpen = false;
  let editingAccount: Account | null = null;
  let saving = false;
  let formError = '';

  let name = '';
  let type = 'bank';
  let bankName = '';
  let bankAddress = '';
  let managerName = '';
  let iban = '';
  let rib = '';
  let balance = 0;
  let bankinConnected = false;
  let formBankinMode: 'sandbox' | 'production' = 'sandbox';
  let formBankinClientId = '';
  let formBankinClientSecret = '';

  // Suppression de compte
  let deleteModalOpen = false;
  let accountToDelete: Account | null = null;
  let deleting = false;
  let deleteError = '';

  // Plugin Bankin'
  let bankinModalOpen = false;
  let bankinTargetAccount: Account | null = null;
  let bankinPluginMode: 'sandbox' | 'production' = 'sandbox';
  let bankinClientId = '';
  let bankinClientSecret = '';
  let bankinConnecting = false;
  let bankinPluginError = '';
  let bankinPluginSuccess = '';

  // Gestion du contrat
  let uploadingContractForId: string | number | null = null;
  let contractFileInput: HTMLInputElement;
  let previewContractUrl = '';
  let previewContractName = '';
  let previewContractOpen = false;
  let previewContractMime = '';

  // Synchronisation Bankin'
  let syncingAccountId: string | number | null = null;
  let syncResultNotice = '';
  let syncResultError = '';

  async function load() {
    loading = true;
    error = '';
    try {
      accounts = listFrom<Account>(await api.get('accounts'), ['accounts']);
    } catch (e) {
      error = getErrorMessage(e);
    } finally {
      loading = false;
    }
  }

  function openCreateForm() {
    editingAccount = null;
    name = '';
    type = 'bank';
    bankName = '';
    bankAddress = '';
    managerName = '';
    iban = '';
    rib = '';
    balance = 0;
    bankinConnected = false;
    formBankinMode = 'sandbox';
    formBankinClientId = '';
    formBankinClientSecret = '';
    formError = '';
    formOpen = true;
  }

  function openEditForm(account: Account) {
    editingAccount = account;
    name = account.name || '';
    type = account.type || 'bank';
    bankName = account.bankName || account.bank || account.bank_name || '';
    bankAddress = account.bankAddress || account.bank_address || '';
    managerName = account.managerName || account.manager_name || '';
    iban = account.iban || '';
    rib = account.rib || '';
    balance = Number(account.initialBalance ?? account.initial_balance ?? 0);
    bankinConnected = Boolean(account.bankinConnected ?? account.bankin_connected);
    formBankinMode = 'sandbox';
    formBankinClientId = '';
    formBankinClientSecret = '';
    formError = '';
    formOpen = true;
  }

  function closeForm() {
    formOpen = false;
    editingAccount = null;
    formError = '';
  }

  async function save() {
    saving = true;
    formError = '';
    try {
      const payload = {
        name,
        type,
        bankName,
        bankAddress,
        managerName,
        iban,
        rib,
        initialBalance: Number(balance),
        bankinConnected,
        currency: 'EUR'
      };

      let savedAccount: Account;
      if (editingAccount) {
        const res = await api.put<{ account: Account }>(`accounts/${editingAccount.id}`, payload);
        savedAccount = res.account || editingAccount;
      } else {
        const res = await api.post<{ account: Account }>('accounts', payload);
        savedAccount = res.account;
      }

      if (savedAccount?.id && bankinConnected) {
        try {
          await api.post(`accounts/${savedAccount.id}/bankin/connect`, {
            connected: true,
            environment: formBankinMode,
            clientId: formBankinClientId.trim() || undefined,
            clientSecret: formBankinClientSecret.trim() || undefined
          });
        } catch (bErr) {
          console.warn('Bankin connection error:', bErr);
        }
      }

      closeForm();
      await load();
    } catch (e) {
      formError = getErrorMessage(e);
    } finally {
      saving = false;
    }
  }

  async function toggleActive(account: Account) {
    try {
      await api.post(`accounts/${account.id}/toggle-active`, {});
      syncResultNotice = `Statut du compte « ${account.name} » mis à jour.`;
      await load();
      setTimeout(() => { syncResultNotice = ''; }, 4000);
    } catch (e) {
      syncResultError = getErrorMessage(e);
      setTimeout(() => { syncResultError = ''; }, 5000);
    }
  }

  function promptDelete(account: Account) {
    accountToDelete = account;
    deleteError = '';
    deleteModalOpen = true;
  }

  function closeDeleteModal() {
    if (!deleting) {
      deleteModalOpen = false;
      accountToDelete = null;
      deleteError = '';
    }
  }

  async function confirmDelete() {
    if (!accountToDelete) return;
    deleting = true;
    deleteError = '';
    try {
      await api.delete(`accounts/${accountToDelete.id}`);
      deleteModalOpen = false;
      accountToDelete = null;
      syncResultNotice = 'Compte supprimé avec succès.';
      await load();
      setTimeout(() => { syncResultNotice = ''; }, 4000);
    } catch (e) {
      deleteError = getErrorMessage(e);
    } finally {
      deleting = false;
    }
  }

  function openBankinPluginModal(account: Account) {
    bankinTargetAccount = account;
    bankinPluginMode = 'sandbox';
    bankinClientId = '';
    bankinClientSecret = '';
    bankinPluginError = '';
    bankinPluginSuccess = '';
    bankinModalOpen = true;
  }

  function closeBankinPluginModal() {
    if (!bankinConnecting) {
      bankinModalOpen = false;
      bankinTargetAccount = null;
      bankinPluginError = '';
      bankinPluginSuccess = '';
    }
  }

  async function connectBankinPlugin() {
    if (!bankinTargetAccount) return;
    bankinConnecting = true;
    bankinPluginError = '';
    bankinPluginSuccess = '';
    try {
      const res = await api.post<{ connected: boolean; message: string }>(`accounts/${bankinTargetAccount.id}/bankin/connect`, {
        connected: true,
        environment: bankinPluginMode,
        clientId: bankinClientId.trim() || undefined,
        clientSecret: bankinClientSecret.trim() || undefined
      });
      bankinPluginSuccess = res.message || 'Connecteur Bankin\' configuré avec succès !';
      await load();
      setTimeout(() => {
        closeBankinPluginModal();
      }, 1500);
    } catch (e) {
      bankinPluginError = getErrorMessage(e);
    } finally {
      bankinConnecting = false;
    }
  }

  async function disconnectBankin(account: Account) {
    if (!confirm(`Désactiver le connecteur Bankin' pour « ${account.name} » ?`)) return;
    try {
      await api.post(`accounts/${account.id}/bankin/connect`, { connected: false });
      syncResultNotice = `Connecteur Bankin' désactivé pour « ${account.name} ».`;
      await load();
      setTimeout(() => { syncResultNotice = ''; }, 4000);
    } catch (e) {
      syncResultError = getErrorMessage(e);
    }
  }

  async function startBankinOAuth() {
    if (!bankinTargetAccount) return;
    bankinPluginError = '';
    try {
      const res = await api.post<{ authUrl: string }>(`accounts/${bankinTargetAccount.id}/bankin/oauth-url`, {
        clientId: bankinClientId.trim() || undefined,
        redirectUri: window.location.href
      });
      if (res.authUrl) {
        window.open(res.authUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (e) {
      bankinPluginError = getErrorMessage(e);
    }
  }

  // Téléversement / remplacement de contrat
  function triggerContractUpload(accountId: string | number) {
    uploadingContractForId = accountId;
    if (contractFileInput) {
      contractFileInput.value = '';
      contractFileInput.click();
    }
  }

  async function handleContractFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !uploadingContractForId) return;

    try {
      const formData = new FormData();
      formData.append('file', file);
      await api.upload(`accounts/${uploadingContractForId}/contract`, formData);
      syncResultNotice = `Contrat « ${file.name} » enregistré avec succès.`;
      await load();
      setTimeout(() => { syncResultNotice = ''; }, 5000);
    } catch (e) {
      syncResultError = `Erreur lors de l’envoi du contrat : ${getErrorMessage(e)}`;
      setTimeout(() => { syncResultError = ''; }, 6000);
    } finally {
      uploadingContractForId = null;
    }
  }

  async function viewContract(account: Account) {
    try {
      const blob = await api.download(`accounts/${account.id}/contract`);
      if (previewContractUrl) URL.revokeObjectURL(previewContractUrl);
      previewContractUrl = URL.createObjectURL(blob);
      previewContractName = account.contractFilename || account.contract_filename || 'Contrat de compte';
      previewContractMime = blob.type || account.contractMime || account.contract_mime || 'application/pdf';
      previewContractOpen = true;
    } catch (e) {
      syncResultError = `Impossible de consulter le contrat : ${getErrorMessage(e)}`;
      setTimeout(() => { syncResultError = ''; }, 5000);
    }
  }

  function closeContractPreview() {
    previewContractOpen = false;
    if (previewContractUrl) URL.revokeObjectURL(previewContractUrl);
    previewContractUrl = '';
  }

  async function deleteContract(account: Account) {
    if (!confirm(`Supprimer le fichier de contrat de ce compte (${account.contractFilename || 'contrat'}) ?`)) return;
    try {
      await api.delete(`accounts/${account.id}/contract`);
      syncResultNotice = 'Contrat supprimé du compte.';
      await load();
      setTimeout(() => { syncResultNotice = ''; }, 4000);
    } catch (e) {
      syncResultError = getErrorMessage(e);
      setTimeout(() => { syncResultError = ''; }, 5000);
    }
  }

  // Synchronisation Bankin'
  async function syncBankin(account: Account) {
    syncingAccountId = account.id;
    syncResultNotice = '';
    syncResultError = '';
    try {
      const res = await api.post<{
        imported: number;
        skipped: number;
        total: number;
        balance: number;
        lastSyncedAt: string;
      }>(`accounts/${account.id}/bankin/sync`, {});

      syncResultNotice = `Synchronisation Bankin' réussie pour « ${account.name} » : ${res.imported} nouvelle(s) opération(s) importée(s), ${res.skipped} déjà existante(s) ignorée(s) sans doublon. Nouveau solde : ${currency.format(res.balance)}.`;
      await load();
      setTimeout(() => { syncResultNotice = ''; }, 7000);
    } catch (e) {
      syncResultError = `Échec de la synchronisation bancaire : ${getErrorMessage(e)}`;
      setTimeout(() => { syncResultError = ''; }, 6000);
    } finally {
      syncingAccountId = null;
    }
  }

  onMount(load);
</script>

<!-- Input invisible pour l'upload de contrat -->
<input
  type="file"
  accept="application/pdf,image/jpeg,image/png,image/webp"
  style="display: none;"
  bind:this={contractFileInput}
  on:change={handleContractFileSelected}
/>

<div class="page-stack">
  <div class="page-intro">
    <div>
      <span class="eyebrow">Trésorerie</span>
      <h2>Vos comptes & connecteurs bancaires</h2>
      <p>Paramètres des comptes, informations bancaires, contrats et synchronisation automatique des relevés.</p>
    </div>
    <button class="btn btn-primary" on:click={openCreateForm}>
      <Icon name="plus" size={18} /> Ajouter un compte
    </button>
  </div>

  {#if syncResultNotice}
    <div class="alert alert-success" role="status">
      <Icon name="check" size={18} />
      <span>{syncResultNotice}</span>
    </div>
  {/if}

  {#if syncResultError}
    <div class="alert" role="alert">
      <Icon name="alert" size={18} />
      <span>{syncResultError}</span>
    </div>
  {/if}

  {#if formOpen}
    <form class="panel inline-form account-form-panel" on:submit|preventDefault={save}>
      <div class="form-heading">
        <h3>{editingAccount ? 'Modifier le compte' : 'Nouveau compte'}</h3>
        <p>Renseignez les coordonnées bancaires, la personne responsable et le contrat associé.</p>
      </div>

      {#if formError}
        <div class="alert" role="alert">
          <Icon name="alert" size={18} />
          <span>{formError}</span>
        </div>
      {/if}

      <div class="form-grid">
        <label>
          Nom du compte *
          <input bind:value={name} required placeholder="Compte courant principal" />
        </label>

        <label>
          Type de compte *
          <select bind:value={type}>
            <option value="bank">Compte bancaire courant</option>
            <option value="savings">Livret / Épargne</option>
            <option value="cash">Caisse espèces</option>
          </select>
        </label>

        <label>
          Nom de la banque
          <input bind:value={bankName} placeholder="Ex: Crédit Agricole, BNP Paribas…" />
        </label>

        <label>
          Adresse de l’agence bancaire
          <input bind:value={bankAddress} placeholder="12 rue de la République, 75001 Paris" />
        </label>

        <label>
          Personne en charge du compte
          <input bind:value={managerName} placeholder="Nom et rôle (ex: Jean Dupont - Trésorier)" />
        </label>

        <label>
          IBAN
          <input bind:value={iban} placeholder="FR76 1234 5678 9012 3456 7890 123" />
        </label>

        <label>
          RIB
          <input bind:value={rib} placeholder="Code banque, guichet, compte, clé" />
        </label>

        <label>
          Solde initial (€)
          <input type="number" step="0.01" bind:value={balance} />
        </label>

        <div class="checkbox-field-wrap">
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={bankinConnected} />
            <span>Activer le connecteur bancaire Bankin' pour ce compte</span>
          </label>
        </div>

        {#if bankinConnected}
          <div class="bankin-plugin-subform">
            <div class="bankin-plugin-subform-header">
              <span class="badge-mini badge-blue">Plugin Bankin' Bridge</span>
              <p>Choisissez le mode d'intégration bancaire pour synchroniser les relevés.</p>
            </div>
            <div class="form-grid compact-grid">
              <label>
                Mode Bankin'
                <select bind:value={formBankinMode}>
                  <option value="sandbox">Sandbox (Développement & test avec banques virtuelles)</option>
                  <option value="production">Production (Connexion bancaire réelle Open Banking)</option>
                </select>
              </label>
              <label>
                Client ID Bankin'
                <input bind:value={formBankinClientId} placeholder={formBankinMode === 'sandbox' ? 'Optionnel en sandbox' : 'client_id_bankin_...'} />
              </label>
              {#if formBankinMode === 'production'}
                <label>
                  Client Secret Bankin'
                  <input type="password" bind:value={formBankinClientSecret} placeholder="secret_..." />
                </label>
              {/if}
            </div>
          </div>
        {/if}
      </div>

      <div class="form-actions">
        <button type="button" class="btn btn-secondary" on:click={closeForm} disabled={saving}>
          Annuler
        </button>
        <button class="btn btn-primary" disabled={saving}>
          {saving ? 'Enregistrement…' : editingAccount ? 'Mettre à jour le compte' : 'Créer le compte'}
        </button>
      </div>
    </form>
  {/if}

  <AsyncState {loading} {error} empty={!accounts.length} emptyTitle="Aucun compte" emptyText="Ajoutez le premier compte bancaire ou la caisse de l’association." onRetry={load}>
    <div class="accounts-list-grid">
      {#each accounts as account (account.id)}
        <article class="account-card-rich panel" class:account-inactive={account.active === false}>
          <header class="account-card-header">
            <div class="account-title-area">
              <span class="account-type-icon">
                <Icon name={account.type === 'cash' ? 'wallet' : 'wallet'} size={22} />
              </span>
              <div>
                <div class="account-tag-row">
                  <span class="account-bank-tag">{account.type === 'cash' ? 'Caisse d’espèces' : account.bankName || account.bank || 'Établissement bancaire'}</span>
                  {#if account.active === false}
                    <span class="badge-mini badge-warning">Inactif</span>
                  {:else}
                    <span class="badge-mini badge-green">Actif</span>
                  {/if}
                </div>
                <h3>{account.name}</h3>
              </div>
            </div>

            <div class="account-header-right">
              <span class="account-balance-badge" class:negative={Number(account.balance ?? 0) < 0}>
                {currency.format(account.balance ?? 0)}
              </span>
              <div class="account-card-actions">
                <button class="btn btn-secondary btn-small" on:click={() => openEditForm(account)} title="Modifier les coordonnées de ce compte">
                  Modifier
                </button>
                <button
                  class="btn btn-secondary btn-small"
                  on:click={() => toggleActive(account)}
                  title={account.active === false ? 'Réactiver ce compte' : 'Désactiver temporairement ce compte'}
                >
                  {account.active === false ? 'Réactiver' : 'Désactiver'}
                </button>
                <button
                  class="btn btn-secondary btn-small icon-only danger-text"
                  on:click={() => promptDelete(account)}
                  title="Supprimer ce compte"
                >
                  <Icon name="trash" size={15} />
                </button>
              </div>
            </div>
          </header>

          <!-- Détails bancaires et paramètres -->
          <div class="account-details-grid">
            <div class="detail-item">
              <span class="detail-label">Responsable</span>
              <span class="detail-value">{account.managerName || account.manager_name || 'Non renseigné'}</span>
            </div>

            {#if account.bankAddress || account.bank_address}
              <div class="detail-item full-width">
                <span class="detail-label">Adresse agence</span>
                <span class="detail-value">{account.bankAddress || account.bank_address}</span>
              </div>
            {/if}

            <div class="detail-item">
              <span class="detail-label">IBAN</span>
              <span class="detail-value monospace">{account.iban || 'Non renseigné'}</span>
            </div>

            <div class="detail-item">
              <span class="detail-label">RIB</span>
              <span class="detail-value monospace">{account.rib || 'Non renseigné'}</span>
            </div>
          </div>

          <!-- Section Contrat Bancaire & Connecteur Bankin' -->
          <div class="account-features-row">
            <!-- Bloc Contrat de compte -->
            <div class="feature-block contract-block">
              <div class="feature-header">
                <strong>Contrat de compte</strong>
                {#if account.contractFilename || account.contract_filename}
                  <span class="badge-mini badge-green">Enregistré</span>
                {:else}
                  <span class="badge-mini subtle">Aucun contrat</span>
                {/if}
              </div>

              {#if account.contractFilename || account.contract_filename}
                <div class="contract-info">
                  <span class="contract-name" title={account.contractFilename || account.contract_filename}>
                    📄 {account.contractFilename || account.contract_filename}
                  </span>
                  <div class="contract-actions">
                    <button class="btn btn-secondary btn-small" on:click={() => viewContract(account)} title="Consulter ou télécharger le contrat">
                      Consulter
                    </button>
                    <button class="btn btn-secondary btn-small" on:click={() => triggerContractUpload(account.id)} title="Remplacer par un nouveau fichier">
                      Changer
                    </button>
                    <button class="btn btn-secondary btn-small icon-only danger-text" on:click={() => deleteContract(account)} title="Supprimer le contrat">
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                </div>
              {:else}
                <p class="feature-desc">Ajoutez le fichier PDF ou l'image de la convention de compte.</p>
                <button class="btn btn-secondary btn-small" on:click={() => triggerContractUpload(account.id)}>
                  <Icon name="upload" size={15} /> Déposer le contrat
                </button>
              {/if}
            </div>

            <!-- Bloc Connecteur Bankin' -->
            <div class="feature-block bankin-block">
              <div class="feature-header">
                <strong>Connecteur bancaire (Bankin')</strong>
                {#if account.bankinConnected || account.bankin_connected}
                  <span class="badge-mini badge-blue">Connecté</span>
                {:else}
                  <span class="badge-mini subtle">Non activé</span>
                {/if}
              </div>

              <p class="feature-desc">
                Récupère automatiquement les relevés bancaires pour les incorporer dans les transactions sans aucun doublon.
              </p>

              {#if account.lastSyncedAt || account.last_synced_at}
                <small class="sync-date">
                  Dernière synchro : {new Date(account.lastSyncedAt || account.last_synced_at || '').toLocaleString('fr-FR')}
                </small>
              {/if}

              <div class="bankin-actions-row">
                {#if account.bankinConnected || account.bankin_connected}
                  <button
                    class="btn btn-primary btn-small"
                    disabled={syncingAccountId === account.id}
                    on:click={() => syncBankin(account)}
                    title="Récupérer le relevé bancaire et incorporer les transactions sans doublon"
                  >
                    <Icon name="refresh" size={15} />
                    {syncingAccountId === account.id ? 'Synchronisation…' : 'Synchroniser le relevé'}
                  </button>
                  <button
                    class="btn btn-secondary btn-small"
                    on:click={() => openBankinPluginModal(account)}
                    title="Configurer les accès API Bankin' ou tester la connexion"
                  >
                    Paramètres Bankin'
                  </button>
                  <button
                    class="btn btn-secondary btn-small danger-text"
                    on:click={() => disconnectBankin(account)}
                    title="Déconnecter Bankin' de ce compte"
                  >
                    Déconnecter
                  </button>
                {:else}
                  <button
                    class="btn btn-secondary btn-small"
                    on:click={() => openBankinPluginModal(account)}
                    title="Activer et configurer l'accès Bankin' / Open Banking"
                  >
                    <Icon name="link" size={15} /> Configurer & connecter Bankin'
                  </button>
                {/if}
              </div>
            </div>
          </div>
        </article>
      {/each}
    </div>
  </AsyncState>
</div>

<!-- Modal de configuration du Plugin Bankin' -->
{#if bankinModalOpen && bankinTargetAccount}
  <div class="capture-layer" role="presentation">
    <button class="backdrop" aria-label="Fermer" on:click={closeBankinPluginModal}></button>
    <div class="capture-modal bankin-plugin-modal" role="dialog" aria-modal="true" aria-labelledby="bankin-modal-title">
      <header class="capture-header">
        <div>
          <span class="eyebrow">Connecteur Open Banking</span>
          <h2 id="bankin-modal-title">Plugin Bankin' Bridge — {bankinTargetAccount.name}</h2>
        </div>
        <button class="icon-button" aria-label="Fermer" on:click={closeBankinPluginModal}>
          <Icon name="close" />
        </button>
      </header>

      <div class="bankin-modal-body">
        <p class="bankin-intro">
          Le plugin Bankin' Bridge permet de synchroniser automatiquement les relevés bancaires avec Tréso et de dédoublonner rigoureusement chaque opération.
        </p>

        {#if bankinPluginSuccess}
          <div class="alert alert-success" role="status">
            <Icon name="check" size={18} />
            <span>{bankinPluginSuccess}</span>
          </div>
        {/if}

        {#if bankinPluginError}
          <div class="alert" role="alert">
            <Icon name="alert" size={18} />
            <span>{bankinPluginError}</span>
          </div>
        {/if}

        <div class="form-grid">
          <label>
            Environnement Bankin'
            <select bind:value={bankinPluginMode}>
              <option value="sandbox">Sandbox (Environnement de test & banques de simulation)</option>
              <option value="production">Production (Accès direct API Open Banking Bankin')</option>
            </select>
          </label>

          <label>
            Client ID {bankinPluginMode === 'production' ? '*' : '(optionnel en sandbox)'}
            <input bind:value={bankinClientId} placeholder="client_id_bankin_..." />
          </label>

          {#if bankinPluginMode === 'production'}
            <label>
              Client Secret *
              <input type="password" bind:value={bankinClientSecret} placeholder="client_secret_..." />
            </label>
          {/if}
        </div>

        <div class="oauth-section">
          <div class="oauth-info">
            <strong>Authentification OAuth Bankin'</strong>
            <p>Si votre compte Bankin' Bridge utilise la redirection bancaire OAuth, vous pouvez initialiser la mire de connexion sécurisée.</p>
          </div>
          <button type="button" class="btn btn-secondary btn-small" on:click={startBankinOAuth}>
            <Icon name="link" size={15} /> Lancer le flux OAuth Bankin'
          </button>
        </div>
      </div>

      <footer class="capture-footer">
        <button type="button" class="btn btn-secondary" on:click={closeBankinPluginModal} disabled={bankinConnecting}>
          Fermer
        </button>
        <button type="button" class="btn btn-primary" on:click={connectBankinPlugin} disabled={bankinConnecting}>
          {bankinConnecting ? 'Vérification…' : 'Tester et enregistrer la connexion'}
        </button>
      </footer>
    </div>
  </div>
{/if}

<!-- Modal de confirmation de suppression de compte -->
{#if deleteModalOpen && accountToDelete}
  <div class="capture-layer" role="presentation">
    <button class="backdrop" aria-label="Fermer" on:click={closeDeleteModal}></button>
    <div class="capture-modal modal-small" role="dialog" aria-modal="true" aria-labelledby="del-acc-title">
      <header class="capture-header">
        <div>
          <span class="eyebrow">Zone de danger</span>
          <h2 id="del-acc-title">Supprimer le compte</h2>
        </div>
        <button class="icon-button" aria-label="Fermer" on:click={closeDeleteModal}>
          <Icon name="close" />
        </button>
      </header>

      <div class="delete-modal-body">
        <p>Êtes-vous certain de vouloir supprimer définitivement le compte <strong>« {accountToDelete.name} »</strong> ?</p>
        <p class="subtle-note">Cette action est irréversible. Si des opérations y sont associées, la suppression sera bloquée pour préserver la comptabilité.</p>

        {#if deleteError}
          <div class="alert" role="alert">
            <Icon name="alert" size={18} />
            <span>{deleteError}</span>
          </div>
        {/if}
      </div>

      <footer class="capture-footer">
        <button type="button" class="btn btn-secondary" on:click={closeDeleteModal} disabled={deleting}>
          Annuler
        </button>
        <button type="button" class="btn btn-primary danger-btn" on:click={confirmDelete} disabled={deleting}>
          {deleting ? 'Suppression…' : 'Confirmer la suppression'}
        </button>
      </footer>
    </div>
  </div>
{/if}

<!-- Modal de prévisualisation du contrat -->
{#if previewContractOpen}
  <div class="capture-layer" role="presentation">
    <button class="backdrop" aria-label="Fermer le contrat" on:click={closeContractPreview}></button>
    <div class="capture-modal contract-preview-modal" role="dialog" aria-modal="true" aria-labelledby="contract-modal-title">
      <header class="capture-header">
        <div>
          <span class="eyebrow">Document de compte</span>
          <h2 id="contract-modal-title">{previewContractName}</h2>
        </div>
        <button class="icon-button" aria-label="Fermer" on:click={closeContractPreview}>
          <Icon name="close" />
        </button>
      </header>
      <div class="contract-modal-body">
        {#if previewContractMime === 'application/pdf'}
          <object data={previewContractUrl} type="application/pdf" class="contract-viewer" title="Aperçu du contrat PDF">
            <p>Votre navigateur ne peut pas afficher directement ce PDF. <a href={previewContractUrl} download={previewContractName}>Télécharger le fichier</a></p>
          </object>
        {:else}
          <img src={previewContractUrl} alt="Contrat bancaire" class="contract-image" />
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .account-form-panel {
    margin-bottom: 2rem;
  }
  .checkbox-field-wrap {
    grid-column: 1 / -1;
    margin-top: 0.5rem;
    display: flex;
    align-items: center;
  }
  .checkbox-label {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    font-weight: 500;
    cursor: pointer;
    width: fit-content;
    max-width: max-content;
    user-select: none;
    border: none;
    background: transparent;
    padding: 0;
  }
  .checkbox-label input[type="checkbox"] {
    width: 18px;
    height: 18px;
    margin: 0;
    cursor: pointer;
    flex-shrink: 0;
  }

  .bankin-plugin-subform {
    grid-column: 1 / -1;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 1rem;
    margin-top: 0.5rem;
  }
  .bankin-plugin-subform-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }
  .bankin-plugin-subform-header p {
    margin: 0;
    font-size: 0.85rem;
    color: #64748b;
  }
  .compact-grid {
    gap: 0.75rem;
  }

  .accounts-list-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1.5rem;
  }

  .account-card-rich.account-inactive {
    opacity: 0.75;
    background: #f8fafc;
    border-style: dashed;
  }

  .account-tag-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .account-card-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .bankin-actions-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: auto;
  }

  .bankin-plugin-modal {
    max-width: 640px;
    width: 100%;
  }
  .bankin-modal-body {
    padding: 1.25rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .bankin-intro {
    margin: 0;
    font-size: 0.9rem;
    color: #475569;
  }
  .oauth-section {
    background: #f1f5f9;
    border-radius: 8px;
    padding: 1rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-top: 0.5rem;
  }
  .oauth-info strong {
    display: block;
    font-size: 0.9rem;
    color: #1e293b;
  }
  .oauth-info p {
    margin: 0.2rem 0 0;
    font-size: 0.8rem;
    color: #64748b;
  }
  .modal-small {
    max-width: 480px;
    width: 100%;
  }
  .delete-modal-body {
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .subtle-note {
    font-size: 0.85rem;
    color: #64748b;
    margin: 0;
  }
  .danger-btn {
    background: #dc2626 !important;
    border-color: #dc2626 !important;
    color: #ffffff !important;
  }
  .badge-mini.badge-warning {
    background: #fef3c7;
    color: #b45309;
  }

  .account-card-rich {
    padding: 1.5rem;
    border-radius: 12px;
    background: #ffffff;
    border: 1px solid var(--border-color, #e2e8f0);
    box-shadow: 0 1px 3px rgba(0,0,0,0.03);
  }

  .account-card-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding-bottom: 1.25rem;
    border-bottom: 1px solid #f1f5f9;
  }

  .account-title-area {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .account-type-icon {
    background: #eff6ff;
    color: #2563eb;
    width: 44px;
    height: 44px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .account-bank-tag {
    font-size: 0.78rem;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
  }
  .account-title-area h3 {
    margin: 0.15rem 0 0;
    font-size: 1.25rem;
  }

  .account-header-right {
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  .account-balance-badge {
    font-size: 1.25rem;
    font-weight: 700;
    color: #15803d;
  }
  .account-balance-badge.negative {
    color: #b91c1c;
  }

  /* Grille des coordonnées */
  .account-details-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 1rem;
    padding: 1.25rem 0;
    border-bottom: 1px solid #f1f5f9;
  }
  .detail-item {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .detail-item.full-width {
    grid-column: 1 / -1;
  }
  .detail-label {
    font-size: 0.75rem;
    color: #64748b;
    text-transform: uppercase;
    font-weight: 600;
  }
  .detail-value {
    font-size: 0.92rem;
    color: #1e293b;
  }
  .monospace {
    font-family: monospace;
    letter-spacing: 0.5px;
  }

  /* Rangée Contrat + Connecteur */
  .account-features-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.25rem;
    margin-top: 1.25rem;
  }
  @media (max-width: 768px) {
    .account-features-row {
      grid-template-columns: 1fr;
    }
  }

  .feature-block {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .feature-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.92rem;
  }
  .feature-desc {
    margin: 0;
    font-size: 0.82rem;
    color: #64748b;
    line-height: 1.35;
  }
  .contract-info {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .contract-name {
    font-size: 0.85rem;
    color: #334155;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .contract-actions {
    display: flex;
    gap: 0.4rem;
  }
  .danger-text {
    color: #dc2626 !important;
  }
  .sync-date {
    font-size: 0.75rem;
    color: #64748b;
  }

  /* Badges */
  .badge-mini {
    display: inline-block;
    padding: 0.15rem 0.45rem;
    border-radius: 6px;
    font-size: 0.72rem;
    font-weight: 600;
  }
  .badge-mini.badge-green {
    background: #dcfce7;
    color: #15803d;
  }
  .badge-mini.badge-blue {
    background: #dbeafe;
    color: #1d4ed8;
  }
  .badge-mini.subtle {
    background: #f1f5f9;
    color: #64748b;
  }

  /* Modal de prévisualisation contrat */
  .contract-preview-modal {
    max-width: 850px;
    width: 100%;
    height: 85vh;
    display: flex;
    flex-direction: column;
  }
  .contract-modal-body {
    flex: 1;
    overflow: hidden;
    display: flex;
    justify-content: center;
    align-items: center;
    background: #334155;
    border-radius: 8px;
  }
  .contract-viewer {
    width: 100%;
    height: 100%;
    border: none;
  }
  .contract-image {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
</style>
