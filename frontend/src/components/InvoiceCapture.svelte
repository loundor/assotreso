<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { api, ApiError, listFrom } from '../lib/api';
  import { currency, formatDate, getErrorMessage } from '../lib/utils';
  import type { AnalysisField, CaptureAnalysis, CapturedDocument, Category, Project } from '../lib/types';

  export let onClose: () => void;
  export let onSuccess: () => void;
  export let mode: 'upload' | 'manual' = 'upload';
  export let initialDirection: 'expense' | 'income' = 'expense';

  type Step = 'choose' | 'preview' | 'uploading' | 'review' | 'success';
  let step: Step = mode === 'manual' ? 'review' : 'choose';
  let file: File | null = null;
  let localPreview = '';
  let document: CapturedDocument | null = null;
  let analysis: CaptureAnalysis = {};
  let progress = 0;
  let uploadError = '';
  let validateError = '';
  let validating = false;
  let categories: Category[] = [];
  let projects: Project[] = [];
  let aiStatusLoading = true;
  let aiAvailable = false;
  let useAi = false;
  let aiUsed = false;

  interface AllocationDraft { projectId: string; categoryId: string; amount: number; }
  let type = 'invoice';
  let direction: 'expense' | 'income' = initialDirection;
  let supplier = '';
  let recipient = '';
  let invoiceNumber = '';
  let date = '';
  let subtotal = 0;
  let tax = 0;
  let total = 0;
  let allocations: AllocationDraft[] = [{ projectId: '', categoryId: '', amount: 0 }];
  let activeAllocation = 0;
  let quickCreate: 'category' | 'project' | null = null;
  let quickName = '';
  let quickParentId = '';
  let quickSaving = false;
  let quickError = '';
  let associationName = '';
  $: allocatedTotal = allocations.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  $: allocationRemaining = Math.max(0, (Number(total) || 0) - allocatedTotal);

  async function loadAssociationName() {
    try {
      const info = await api.get<{ name?: string }>('config/public');
      if (info?.name) {
        associationName = info.name;
        if (direction === 'income' && !supplier) {
          supplier = associationName;
        }
      }
    } catch {
      // Ignorer si indisponible
    }
  }

  function setDirection(newDir: 'expense' | 'income') {
    direction = newDir;
    if (direction === 'income') {
      if (!supplier || supplier.trim() === '') {
        supplier = associationName;
      }
    } else {
      if (supplier === associationName) {
        supplier = '';
      }
    }
  }

  function valueOf<T>(entry: T | AnalysisField<T> | undefined, fallback: T): T {
    if (entry && typeof entry === 'object' && 'value' in entry) return (entry.value ?? fallback) as T;
    return (entry ?? fallback) as T;
  }
  function entryFor(...keys: string[]): unknown {
    for (const key of keys) if (analysis[key] !== undefined) return analysis[key];
    return undefined;
  }
  function confidenceFor(...keys: string[]): number | null {
    const entry = entryFor(...keys);
    if (entry && typeof entry === 'object' && 'confidence' in entry) return Number((entry as AnalysisField).confidence ?? 0);
    return null;
  }
  function uncertain(...keys: string[]): boolean {
    const entry = entryFor(...keys);
    if (entry && typeof entry === 'object') {
      const field = entry as AnalysisField;
      return field.uncertain === true || (field.confidence !== undefined && field.confidence < 0.75);
    }
    return false;
  }
  function displayConfidence(value: number | null): string { return value === null ? '' : `${Math.round(value * (value <= 1 ? 100 : 1))} %`; }

  async function optimizeMobilePhoto(selected: File): Promise<File> {
    if (!selected.type.startsWith('image/') || selected.type === 'image/gif' || selected.size < 900_000) return selected;
    try {
      const bitmap = await createImageBitmap(selected, { imageOrientation: 'from-image' });
      const maxDimension = 2200;
      const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
      const canvas = window.document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) return selected;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      if (!blob || blob.size >= selected.size) return selected;
      const baseName = selected.name.replace(/\.[^.]+$/, '') || 'facture';
      return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
    } catch {
      return selected;
    }
  }

  async function selectFile(selected?: File) {
    if (!selected) return;
    uploadError = '';
    const allowed = selected.type.startsWith('image/') || selected.type === 'application/pdf';
    if (!allowed) { uploadError = 'Format non pris en charge. Choisissez une image ou un PDF.'; return; }
    const prepared = await optimizeMobilePhoto(selected);
    if (prepared.size > 10 * 1024 * 1024) { uploadError = 'Le fichier dépasse la taille maximale de 10 Mo après optimisation.'; return; }
    if (localPreview) URL.revokeObjectURL(localPreview);
    file = prepared; localPreview = URL.createObjectURL(prepared); step = 'preview';
  }

  function extractedString(keys: string[], fallback = ''): string {
    const entry = entryFor(...keys) as string | number | AnalysisField | undefined;
    return String(valueOf(entry, fallback));
  }
  function extractedNumber(keys: string[]): number {
    const entry = entryFor(...keys) as string | number | AnalysisField | undefined;
    return Number(valueOf(entry, 0)) || 0;
  }
  function fillForm() {
    type = extractedString(['type', 'documentType'], 'invoice');
    const rawDir = extractedString(['direction', 'financialDirection', 'sense'], direction);
    if (['income', 'EMIS', 'recette', 'gain', 'vente'].includes(rawDir)) {
      direction = 'income';
    } else if (['expense', 'RECU', 'depense', 'achat', 'charge'].includes(rawDir)) {
      direction = 'expense';
    }
    supplier = extractedString(['supplier', 'vendor', 'fournisseur']);
    if (direction === 'income' && (!supplier || supplier.trim() === '')) {
      supplier = associationName;
    }
    recipient = extractedString(['recipient', 'destinataire']);
    invoiceNumber = extractedString(['number', 'invoiceNumber', 'numero']);
    date = extractedString(['date', 'invoiceDate']).slice(0, 10);
    subtotal = extractedNumber(['subtotal', 'totalHt', 'ht']);
    tax = extractedNumber(['tax', 'vat', 'tva']);
    total = extractedNumber(['total', 'totalTtc', 'ttc']);
    const categoryId = extractedString(['categoryId', 'category']);
    const projectId = extractedString(['projectId', 'project']);
    allocations = [{ projectId, categoryId, amount: projectId || categoryId ? total : 0 }];
  }

  async function analyze() {
    if (!file) return;
    step = 'uploading'; progress = 8; uploadError = '';
    const timer = window.setInterval(() => { if (progress < 88) progress += Math.max(1, Math.round((90 - progress) / 7)); }, 280);
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('useAi', String(useAi && aiAvailable));
      body.append('direction', direction === 'income' ? 'EMIS' : 'RECU');
      const result = await api.upload<{ document: CapturedDocument; analysis: CaptureAnalysis; aiUsed?: boolean }>('mobile/capture', body);
      document = result.document;
      analysis = result.analysis || {};
      aiUsed = result.aiUsed === true || analysis.aiUsed === true;
      fillForm(); progress = 100;
      await new Promise((resolve) => setTimeout(resolve, 250)); step = 'review';
    } catch (error) { uploadError = getErrorMessage(error); step = 'preview'; }
    finally { window.clearInterval(timer); }
  }

  function projectParent(item: Project): string { return String(item.parentId ?? item.parent_id ?? ''); }
  function orderedProjects(): Array<Project & { depth: number }> {
    const result: Array<Project & { depth: number }> = [];
    const add = (parent: string, depth: number) => {
      projects.filter((item) => projectParent(item) === parent).sort((a, b) => a.name.localeCompare(b.name, 'fr')).forEach((item) => {
        result.push({ ...item, depth }); add(String(item.id), depth + 1);
      });
    };
    add('', 0); return result;
  }
  function categoriesFor(projectId: string): Category[] {
    return categories.filter((item) => {
      const linkedProject = String(item.projectId ?? item.project_id ?? '');
      const expectedKind = direction === 'income' ? 'RECETTE' : 'DEPENSE';
      return (!item.kind || item.kind === expectedKind || item.kind === 'MIXTE') && (!linkedProject || linkedProject === projectId);
    });
  }
  function updateAllocation(index: number, patch: Partial<AllocationDraft>) {
    allocations = allocations.map((item, position) => position === index ? { ...item, ...patch } : item);
  }
  function changeAllocationProject(index: number, projectId: string) {
    const current = allocations[index];
    const category = categories.find((item) => String(item.id) === current.categoryId);
    const categoryProject = String(category?.projectId ?? category?.project_id ?? '');
    updateAllocation(index, { projectId, categoryId: categoryProject && categoryProject !== projectId ? '' : current.categoryId });
  }
  function addAllocation() {
    allocations = [...allocations, { projectId: '', categoryId: '', amount: allocationRemaining }];
  }
  function removeAllocation(index: number) {
    allocations = allocations.filter((_, position) => position !== index);
    if (!allocations.length) allocations = [{ projectId: '', categoryId: '', amount: 0 }];
  }

  async function createQuickResource(kind: 'category' | 'project') {
    const name = quickName.trim();
    if (!name) { quickError = 'Saisissez un nom.'; return; }
    quickSaving = true; quickError = '';
    try {
      const selected = allocations[activeAllocation] ?? allocations[0];
      if (kind === 'category') {
        const result = await api.post<{ category: Category }>('categories', {
          name, kind: direction === 'income' ? 'RECETTE' : 'DEPENSE', color: '#3b8068', projectId: selected.projectId || null
        });
        categories = [...categories, result.category].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
        updateAllocation(activeAllocation, { categoryId: String(result.category.id) });
      } else {
        const result = await api.post<{ project: Project }>('projects', { name, parentId: quickParentId || null, active: true });
        projects = [...projects, result.project].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
        updateAllocation(activeAllocation, { projectId: String(result.project.id), categoryId: '' });
      }
      quickCreate = null; quickName = ''; quickParentId = '';
    } catch (error) { quickError = getErrorMessage(error); }
    finally { quickSaving = false; }
  }

  function toggleQuick(kind: 'category' | 'project', index: number) {
    activeAllocation = index;
    quickCreate = quickCreate === kind ? null : kind;
    quickName = ''; quickParentId = allocations[index]?.projectId ?? ''; quickError = '';
  }

  let showConfirmModal = false;

  function promptValidate() {
    validateError = '';
    if (!total || Number(total) <= 0) {
      validateError = 'Le montant total TTC doit être strictement supérieur à zéro.';
      return;
    }
    if (direction === 'income') {
      if (!recipient || !recipient.trim()) {
        validateError = 'Le nom du client / destinataire / adhérent est obligatoire pour une facture émise.';
        return;
      }
    } else {
      if (!supplier || !supplier.trim()) {
        validateError = 'Le nom du fournisseur / émetteur est obligatoire pour une facture reçue.';
        return;
      }
    }
    if (!date) {
      validateError = 'La date de la facture est obligatoire.';
      return;
    }
    if (allocatedTotal > Number(total) + 0.001) {
      validateError = 'La ventilation dépasse le montant TTC de la facture.';
      return;
    }
    showConfirmModal = true;
  }

  function cancelConfirm() {
    showConfirmModal = false;
  }

  async function confirmAndValidate() {
    showConfirmModal = false;
    await validate();
  }

  function getProjectName(id: string) {
    return projects.find((p) => String(p.id) === String(id))?.name || '';
  }

  function getCategoryName(id: string) {
    return categories.find((c) => String(c.id) === String(id))?.name || '';
  }

  async function validate() {
    validating = true; validateError = '';
    try {
      if (allocatedTotal > Number(total) + 0.001) throw new Error('La ventilation dépasse le montant TTC de la facture.');
      const formattedAllocations = allocations
        .filter((item) => (item.projectId || item.categoryId) && Number(item.amount) > 0)
        .map((item) => ({ projectId: item.projectId || null, categoryId: item.categoryId || null, amount: Number(item.amount).toFixed(2) }));

      const directionVal = direction === 'income' ? 'EMIS' : 'RECU';
      if (mode === 'manual' || !document) {
        await api.post('invoices/manual', {
          type, direction: directionVal, supplier, recipient, number: invoiceNumber, date: date || new Date().toISOString().slice(0, 10),
          subtotal: Number(subtotal) || 0, tax: Number(tax) || 0, total: Number(total) || 0,
          allocations: formattedAllocations
        });
      } else {
        await api.post(`documents/${document.id}/validate`, {
          type, direction: directionVal, supplier, recipient, number: invoiceNumber, date,
          subtotal: Number(subtotal), tax: Number(tax), total: Number(total),
          allocations: formattedAllocations
        });
      }
      step = 'success'; onSuccess();
    } catch (error) { validateError = getErrorMessage(error); }
    finally { validating = false; }
  }

  function resetFile() { if (localPreview) URL.revokeObjectURL(localPreview); localPreview = ''; file = null; step = 'choose'; uploadError = ''; }
  function keydown(event: KeyboardEvent) { if (event.key === 'Escape' && step !== 'uploading' && !validating) onClose(); }
  onMount(async () => {
    window.addEventListener('keydown', keydown);
    void loadAssociationName();
    const resources = Promise.all([api.get('categories'), api.get('projects')])
      .then(([c, p]) => { categories = listFrom<Category>(c, ['categories']); projects = listFrom<Project>(p, ['projects']); })
      .catch(() => { /* Les listes restent facultatives. */ });
    const status = api.get<{ enabled: boolean; configured: boolean }>('config/ai/status')
      .then((value) => {
        aiAvailable = Boolean(value?.enabled && value?.configured);
        useAi = aiAvailable;
      })
      .catch((error) => {
        if (!(error instanceof ApiError && error.status === 403)) console.warn('Statut IA indisponible', error);
        aiAvailable = false;
        useAi = false;
      })
      .finally(() => { aiStatusLoading = false; });
    await Promise.all([resources, status]);
  });
  onDestroy(() => { window.removeEventListener('keydown', keydown); if (localPreview) URL.revokeObjectURL(localPreview); });
</script>

<div class="capture-layer" role="presentation">
  <button class="backdrop" aria-label="Fermer" on:click={() => step !== 'uploading' && !validating && onClose()}></button>
  <div class="capture-modal" role="dialog" aria-modal="true" aria-labelledby="capture-title" tabindex="-1">
    <header class="capture-header">
      <div>
        <span class="eyebrow">Facturation · {direction === 'income' ? 'Facture émise (recette)' : 'Facture reçue (dépense)'}</span>
        <h2 id="capture-title">
          {#if step === 'review'}
            {#if mode === 'manual' || (!file && !localPreview)}
              {direction === 'income' ? 'Créer une facture émise (recette)' : 'Créer une facture reçue (dépense)'}
            {:else}
              {direction === 'income' ? 'Vérifier la facture émise' : 'Vérifier la facture reçue'}
            {/if}
          {:else if step === 'success'}
            Facture enregistrée
          {:else}
            Scanner / importer une facture
          {/if}
        </h2>
      </div>
      {#if step !== 'uploading' && !validating}
        <button class="icon-button" aria-label="Fermer" on:click={onClose}>
          <Icon name="close"/>
        </button>
      {/if}
    </header>

    {#if step === 'choose'}
      <div class="capture-content choose-content">
        <div class="capture-intro">
          <span class="big-scan-icon"><Icon name="scan" size={34}/></span>
          <h3>Comment souhaitez-vous ajouter la facture ?</h3>
          <p>Vous pouvez importer un document pour en extraire les informations ou saisir directement une facture sans fichier.</p>
        </div>

        {#if uploadError}<div class="alert" role="alert"><Icon name="alert" size={18}/>{uploadError}</div>{/if}
        <div class="choice-grid">
          <label class="file-choice"><input type="file" accept="image/*" capture="environment" on:change={(e) => selectFile(e.currentTarget.files?.[0])}/><span class="choice-icon"><Icon name="camera" size={28}/></span><span><strong>Prendre une photo</strong><small>Utiliser l’appareil photo</small></span><Icon name="chevron"/></label>
          <label class="file-choice"><input type="file" accept="image/*,application/pdf,.pdf" on:change={(e) => selectFile(e.currentTarget.files?.[0])}/><span class="choice-icon"><Icon name="upload" size={28}/></span><span><strong>Choisir un fichier</strong><small>Image ou PDF · 10 Mo max.</small></span><Icon name="chevron"/></label>
          <button type="button" class="file-choice manual-entry-button" on:click={() => { mode = 'manual'; step = 'review'; if (!date) date = new Date().toISOString().slice(0, 10); }}>
            <span class="choice-icon"><Icon name="invoice" size={28}/></span>
            <span><strong>Saisie manuelle sans fichier</strong><small>Renseigner directement {direction === 'income' ? 'la recette' : 'la dépense'}</small></span>
            <Icon name="chevron"/>
          </button>
        </div>
        <div class="privacy-note">🔒 Vos données et documents sont hébergés et traités en toute sécurité.</div>
      </div>
    {:else if step === 'preview'}
      <div class="capture-content"><div class="preview-layout"><div class="document-preview">{#if file?.type === 'application/pdf'}<object data={localPreview} type="application/pdf" aria-label="Aperçu du PDF"><div class="pdf-placeholder"><Icon name="invoice" size={48}/><strong>{file?.name}</strong><small>Aperçu PDF</small></div></object>{:else}<img src={localPreview} alt="Aperçu de la facture sélectionnée"/>{/if}</div><div class="preview-info"><span class="status-badge">Prêt pour l’analyse</span><h3>{file?.name}</h3><p>{file ? `${(file.size/1024/1024).toFixed(2)} Mo` : ''}</p><label class:disabled={!aiAvailable} class="ai-capture-option"><input type="checkbox" bind:checked={useAi} disabled={!aiAvailable || aiStatusLoading}/><span><strong>Analyse avec IA</strong><small>{aiStatusLoading ? 'Vérification de la disponibilité…' : aiAvailable ? 'L’analyse avec le fournisseur IA configuré sera effectuée.' : 'L’IA n’est pas activée ou sa configuration/connexion n’est pas prête.'}</small></span></label><div class="analysis-promise"><Icon name="check"/><span><strong>Vous gardez le contrôle</strong><small>Aucune facture ne sera créée avant votre validation explicite.</small></span></div></div></div>
        {#if uploadError}<div class="alert" role="alert"><Icon name="alert" size={18}/>{uploadError}</div>{/if}
        <div class="capture-actions"><button class="btn btn-secondary" on:click={resetFile}>Choisir un autre fichier</button><button class="btn btn-scan" on:click={analyze}>Analyser le document <span>→</span></button></div></div>
    {:else if step === 'uploading'}
      <div class="capture-content analyzing" role="status" aria-live="polite"><div class="analysis-animation"><div class="paper-scan"><Icon name="invoice" size={58}/><span class="laser"></span></div></div><h3>Analyse du document…</h3><p>Nous identifions les montants, les tiers et les informations comptables.</p><div class="progress-track"><span style:width={`${progress}%`}></span></div><strong>{progress} %</strong><small>Ne fermez pas cette fenêtre.</small></div>
    {:else if step === 'review'}
      <form class="capture-content review-content" on:submit|preventDefault={validate}>
        {#if file || localPreview}
          <div class="review-banner"><div><Icon name="check"/><span><strong>Analyse terminée</strong><small>Contrôlez les champs signalés avant de valider.</small></span></div><div class="review-badges">{#if aiUsed}<span class="ai-used-badge">IA utilisée</span>{/if}<span class="confidence">Confiance globale <strong>{displayConfidence(analysis.confidence ?? null) || '—'}</strong></span></div></div>
        {:else}
          <div class="review-banner manual-banner"><div><Icon name="invoice"/><span><strong>Saisie manuelle ({direction === 'income' ? 'Facture émise / Recette' : 'Facture reçue / Dépense'})</strong><small>Renseignez les champs ci-dessous et ventilez le montant selon vos besoins.</small></span></div></div>
        {/if}
        <div class="review-layout" class:manual-layout={!file && !localPreview}>
          {#if file || localPreview}
            <aside class="review-preview"><div class="document-preview compact">{#if file?.type === 'application/pdf'}<object data={localPreview} type="application/pdf" aria-label="Aperçu du PDF"></object>{:else}<img src={localPreview} alt="Aperçu de la facture"/>{/if}</div><small>{file?.name}</small></aside>
          {/if}
          <div class="review-form" class:full-width-form={!file && !localPreview}>
            <!-- Sélecteur direct Dépense vs Recette -->
            <div class="form-section">
              <h3>Nature de la facture</h3>
              <div class="direction-segmented-control">
                <button
                  type="button"
                  class="segmented-btn"
                  class:active={direction === 'expense'}
                  on:click={() => setDirection('expense')}
                >
                  <span class="seg-icon">📥</span>
                  <div class="seg-text">
                    <strong>Facture reçue (Dépense)</strong>
                    <small>Fournisseur, achat, charge, prestataire</small>
                  </div>
                </button>
                <button
                  type="button"
                  class="segmented-btn income"
                  class:active={direction === 'income'}
                  on:click={() => setDirection('income')}
                >
                  <span class="seg-icon">📤</span>
                  <div class="seg-text">
                    <strong>Facture émise (Gain / Recette)</strong>
                    <small>Client, vente, prestation rendue, adhésion, subvention</small>
                  </div>
                </button>
              </div>
              <div class="form-grid" style="margin-top: 0.8rem;">
                <label class:uncertain={uncertain('type')}>Type {#if uncertain('type')}<span class="uncertain-label">À vérifier</span>{/if}
                  <select bind:value={type}>
                    <option value="invoice">Facture</option>
                    <option value="credit_note">Avoir</option>
                    <option value="receipt">Reçu / ticket</option>
                  </select>
                </label>
              </div>
            </div>

            <div class="form-section">
              <h3>Informations générales</h3>
              <div class="form-grid">
                {#if direction === 'income'}
                  <label class:uncertain={uncertain('recipient')}>Client / Destinataire / Adhérent * {#if uncertain('recipient')}<span class="uncertain-label">À vérifier</span>{/if}
                    <input bind:value={recipient} placeholder="Ex. Mairie de Paris, Partenaire X, Adhérent" required />
                  </label>
                  <label class:uncertain={uncertain('supplier','vendor')}>Émetteur (votre association) {#if uncertain('supplier','vendor')}<span class="uncertain-label">À vérifier</span>{/if}
                    <input bind:value={supplier} placeholder="Nom de l'association" />
                  </label>
                {:else}
                  <label class:uncertain={uncertain('supplier','vendor')}>Fournisseur / Prestataire * {#if uncertain('supplier','vendor')}<span class="uncertain-label">À vérifier</span>{/if}
                    <input bind:value={supplier} placeholder="Ex. Fournisseur SAS, Boulangerie, EDF" required />
                  </label>
                  <label class:uncertain={uncertain('recipient')}>Destinataire (optionnel) {#if uncertain('recipient')}<span class="uncertain-label">À vérifier</span>{/if}
                    <input bind:value={recipient} placeholder="Nom du destinataire ou bénévole" />
                  </label>
                {/if}
                <label class:uncertain={uncertain('number','invoiceNumber')}>Numéro {#if uncertain('number','invoiceNumber')}<span class="uncertain-label">À vérifier</span>{/if}
                  <input bind:value={invoiceNumber} placeholder="Ex. FAC-2026-001" />
                </label>
                <label class:uncertain={uncertain('date')}>Date {#if uncertain('date')}<span class="uncertain-label">À vérifier</span>{/if}
                  <input type="date" bind:value={date} required />
                </label>
              </div>
            </div>

            <div class="form-section">
              <h3>Montants</h3>
              <div class="form-grid form-grid-3">
                <label class:uncertain={uncertain('subtotal','totalHt')}>HT (€) {#if uncertain('subtotal','totalHt')}<span class="uncertain-label">À vérifier</span>{/if}
                  <input type="number" step="0.01" bind:value={subtotal}/>
                </label>
                <label class:uncertain={uncertain('tax','vat','tva')}>TVA (€) {#if uncertain('tax','vat','tva')}<span class="uncertain-label">À vérifier</span>{/if}
                  <input type="number" step="0.01" bind:value={tax}/>
                </label>
                <label class:uncertain={uncertain('total','totalTtc')}>TTC (€) {#if uncertain('total','totalTtc')}<span class="uncertain-label">À vérifier</span>{/if}
                  <input type="number" min="0" step="0.01" bind:value={total} required/>
                </label>
              </div>
              <div class="total-check" class:income-total={direction === 'income'}>
                <span>Total {direction === 'income' ? 'à encaisser (Recette / Gain)' : 'à décaisser (Dépense)'}</span>
                <strong class:income-amount={direction === 'income'}>{currency.format(total||0)}</strong>
              </div>
            </div>

            <div class="form-section">
              <div class="allocation-heading">
                <div>
                  <h3>Ventilation analytique</h3>
                  <p>Affectez toute la facture ou répartissez-la entre plusieurs projets et rubriques ({direction === 'income' ? 'recettes' : 'dépenses'}).</p>
                </div>
                <button type="button" class="btn btn-secondary btn-small" on:click={addAllocation}>
                  <Icon name="plus" size={15}/> Ajouter une ligne
                </button>
              </div>
              <div class="allocation-list">
                {#each allocations as allocation, index}
                  <div class="allocation-row">
                    <label>Projet
                      <select value={allocation.projectId} on:change={(event) => changeAllocationProject(index, event.currentTarget.value)}><option value="">Aucun projet</option>{#each orderedProjects() as item}<option value={item.id}>{'— '.repeat(item.depth)}{item.name}</option>{/each}</select>
                    </label>
                    <label>Catégorie / rubrique
                      <select value={allocation.categoryId} on:change={(event) => updateAllocation(index, { categoryId: event.currentTarget.value })}><option value="">Non classée</option>{#each categoriesFor(allocation.projectId) as item}<option value={item.id}>{item.name}{item.project_name ? ` · ${item.project_name}` : ' · globale'}</option>{/each}</select>
                    </label>
                    <label>Montant TTC (€)<input type="number" min="0" step="0.01" value={allocation.amount} on:input={(event) => updateAllocation(index, { amount: Number(event.currentTarget.value) })}/></label>
                    <div class="allocation-actions"><button type="button" class="quick-create-trigger" on:click={() => toggleQuick('project', index)}><Icon name="plus" size={15}/> Projet</button><button type="button" class="quick-create-trigger" on:click={() => toggleQuick('category', index)}><Icon name="plus" size={15}/> Rubrique</button>{#if allocations.length > 1}<button type="button" class="text-button danger" on:click={() => removeAllocation(index)}>Retirer</button>{/if}</div>
                  </div>
                {/each}
              </div>
              <div class:over-allocated={allocatedTotal > total} class="allocation-total"><span>Ventilé <strong>{currency.format(allocatedTotal)}</strong></span><span>Reste à affecter <strong>{currency.format(allocationRemaining)}</strong></span></div>
              {#if quickCreate}<div class="quick-create-panel"><label>Nom de {quickCreate === 'category' ? 'la rubrique' : 'du projet'}<input bind:value={quickName} placeholder={quickCreate === 'category' ? (direction === 'income' ? 'Ex. Ventes et prestations' : 'Ex. Télécommunications') : 'Ex. Fonctionnement général'} on:keydown={(event) => event.key === 'Enter' && (event.preventDefault(), createQuickResource(quickCreate!))}/></label>{#if quickCreate === 'project'}<label>Projet parent<select bind:value={quickParentId}><option value="">Aucun — projet principal</option>{#each orderedProjects() as item}<option value={item.id}>{'— '.repeat(item.depth)}{item.name}</option>{/each}</select></label>{/if}<div><button type="button" class="btn btn-secondary btn-small" on:click={() => quickCreate = null}>Annuler</button><button type="button" class="btn btn-primary btn-small" disabled={quickSaving} on:click={() => createQuickResource(quickCreate!)}>{quickSaving ? 'Création…' : 'Créer et sélectionner'}</button></div>{#if quickError}<small class="quick-create-error" role="alert">{quickError}</small>{/if}</div>{/if}
            </div>
          </div>
        </div>
        {#if validateError}<div class="alert" role="alert"><Icon name="alert" size={18}/>{validateError}</div>{/if}
        <div class="capture-actions sticky-actions"><button type="button" class="btn btn-secondary" on:click={resetFile} disabled={validating}>Recommencer</button><div><span class="validation-note">La facture sera créée à cette étape uniquement.</span><button type="submit" class="btn btn-scan" disabled={validating}>{#if validating}<span class="spinner spinner-light"></span> Validation…{:else}<Icon name="check" size={18}/> Valider et enregistrer{/if}</button></div></div>
      </form>
    {:else}
      <div class="capture-content success-content"><span class="success-mark"><Icon name="check" size={42}/></span><span class="eyebrow">C’est fait</span><h3>La facture a bien été enregistrée.</h3><p>Elle est désormais disponible dans votre liste de factures et peut être rattachée à votre suivi comptable.</p><div class="success-summary"><span>{supplier||recipient||'Document'} ({direction === 'income' ? 'Recette' : 'Dépense'})</span><strong>{currency.format(total||0)}</strong></div><button class="btn btn-primary btn-large" on:click={onClose}>Voir mes factures</button></div>
    {/if}
  </div>

  {#if showConfirmModal}
    <div class="confirm-modal-layer">
      <button type="button" class="confirm-backdrop" on:click={cancelConfirm} aria-label="Fermer"></button>
      <div class="confirm-modal-box" role="dialog" aria-modal="true" aria-labelledby="confirm-invoice-modal-title">
        <div class="confirm-header">
          <div class="confirm-title-wrap">
            <span class="confirm-icon-badge">🛡️</span>
            <div>
              <h3 id="confirm-invoice-modal-title">Vérification de la facture</h3>
              <span class="confirm-subtitle">Contrôle avant enregistrement comptable définitif</span>
            </div>
          </div>
          <button type="button" class="close-btn" on:click={cancelConfirm} title="Fermer" aria-label="Fermer">✕</button>
        </div>

        <div class="confirm-alert-box">
          <span class="alert-icon">⚠️</span>
          <div class="alert-text">
            <strong>Attention : Facture non modifiable après validation !</strong>
            <p>
              Conformément aux normes comptables et d'intégrité des pièces justificatives, cette facture ne pourra plus être modifiée une fois enregistrée. Veuillez vérifier attentivement toutes les données ci-dessous.
            </p>
          </div>
        </div>

        <div class="confirm-recap-card">
          <div class="recap-row highlight-row">
            <span class="recap-label">Nature du document</span>
            <span class="recap-val">
              {#if direction === 'income'}
                <span class="status-badge badge-green">📥 Facture émise (Recette / Gain)</span>
              {:else}
                <span class="status-badge badge-blue">📤 Facture reçue (Dépense / Fournisseur)</span>
              {/if}
            </span>
          </div>

          <div class="recap-row highlight-row">
            <span class="recap-label">Montant Total TTC</span>
            <span class="recap-val amount-highlight" class:text-income={direction === 'income'} class:text-expense={direction === 'expense'}>
              {direction === 'income' ? '+' : '-'}{currency.format(Number(total) || 0)}
            </span>
          </div>

          {#if direction === 'income'}
            <div class="recap-row">
              <span class="recap-label">Client / Destinataire / Adhérent</span>
              <span class="recap-val font-semibold">{recipient || '—'}</span>
            </div>
            {#if supplier}
              <div class="recap-row">
                <span class="recap-label">Émetteur</span>
                <span class="recap-val">{supplier}</span>
              </div>
            {/if}
          {:else}
            <div class="recap-row">
              <span class="recap-label">Fournisseur / Prestataire</span>
              <span class="recap-val font-semibold">{supplier || '—'}</span>
            </div>
            {#if recipient}
              <div class="recap-row">
                <span class="recap-label">Destinataire</span>
                <span class="recap-val">{recipient}</span>
              </div>
            {/if}
          {/if}

          <div class="recap-row">
            <span class="recap-label">Numéro de pièce</span>
            <span class="recap-val">{invoiceNumber || 'Non renseigné'}</span>
          </div>

          <div class="recap-row">
            <span class="recap-label">Date du document</span>
            <span class="recap-val">{formatDate(date)}</span>
          </div>

          {#if subtotal || tax}
            <div class="recap-row">
              <span class="recap-label">Détail HT / TVA</span>
              <span class="recap-val">
                HT : {currency.format(Number(subtotal) || 0)}
                {#if tax} · TVA : {currency.format(Number(tax) || 0)}{/if}
              </span>
            </div>
          {/if}

          <div class="recap-row recap-allocations-row">
            <span class="recap-label">Ventilation analytique</span>
            <div class="recap-allocations-list">
              {#if allocations.some(a => a.categoryId || a.projectId)}
                {#each allocations.filter(a => a.categoryId || a.projectId || Number(a.amount) > 0) as alloc}
                  <div class="recap-alloc-item">
                    <span class="alloc-labels">
                      {#if alloc.projectId}
                        <span class="project-tag">📁 {getProjectName(alloc.projectId)}</span>
                      {/if}
                      {#if alloc.categoryId}
                        <span class="category-tag">🏷️ {getCategoryName(alloc.categoryId)}</span>
                      {:else}
                        <span class="category-tag uncategorized">Sans rubrique</span>
                      {/if}
                    </span>
                    <strong class="alloc-amt">{currency.format(Number(alloc.amount) || 0)}</strong>
                  </div>
                {/each}
              {:else}
                <span class="text-muted italic">Non ventilée (rubrique par défaut)</span>
              {/if}
            </div>
          </div>
        </div>

        {#if validateError}
          <div class="alert" role="alert"><Icon name="alert" size={18}/>{validateError}</div>
        {/if}

        <div class="confirm-modal-footer">
          <button type="button" class="btn btn-secondary" on:click={cancelConfirm} disabled={validating}>
            Modifier les informations
          </button>
          <button type="button" class="btn btn-scan btn-confirm-submit" on:click={confirmAndValidate} disabled={validating}>
            {#if validating}
              <span class="spinner spinner-light"></span> Validation en cours…
            {:else}
              <Icon name="check" size={18}/> Confirmer et enregistrer définitivement
            {/if}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  /* Segmented control dans le formulaire */
  .direction-segmented-control {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
  }
  @media (max-width: 600px) {
    .direction-segmented-control {
      grid-template-columns: 1fr;
    }
  }
  .segmented-btn {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    border-radius: 10px;
    border: 2px solid #e2e8f0;
    background: #ffffff;
    cursor: pointer;
    text-align: left;
    transition: all 0.15s ease;
  }
  .segmented-btn:hover {
    border-color: #cbd5e1;
    background: #f8fafc;
  }
  .segmented-btn.active {
    border-color: #2563eb;
    background: #eff6ff;
  }
  .segmented-btn.active strong {
    color: #1d4ed8;
  }
  .segmented-btn.income.active {
    border-color: #16a34a;
    background: #f0fdf4;
  }
  .segmented-btn.income.active strong {
    color: #15803d;
  }
  .seg-icon {
    font-size: 1.4rem;
    line-height: 1;
    flex-shrink: 0;
  }
  .seg-text {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .seg-text strong {
    font-size: 0.9rem;
    color: #1e293b;
  }
  .seg-text small {
    font-size: 0.76rem;
    color: #64748b;
  }
  .total-check.income-total {
    background: #f0fdf4;
    border-color: #bbf7d0;
  }
  .total-check strong.income-amount {
    color: #15803d;
  }

  /* Modal de confirmation avant enregistrement définitif */
  .confirm-modal-layer {
    position: fixed;
    inset: 0;
    z-index: 1200;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
  }

  .confirm-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(15, 23, 42, 0.65);
    backdrop-filter: blur(4px);
    border: none;
    cursor: pointer;
    width: 100%;
    height: 100%;
  }

  .confirm-modal-box {
    position: relative;
    z-index: 1;
    background: white;
    border-radius: 16px;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.25);
    width: 100%;
    max-width: 600px;
    max-height: 90vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
    padding: 1.5rem;
    animation: fadeIn 0.2s ease-out;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .confirm-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    border-bottom: 1px solid #e2e8f0;
    padding-bottom: 0.85rem;
  }

  .confirm-title-wrap {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .confirm-icon-badge {
    font-size: 1.6rem;
    line-height: 1;
  }

  .confirm-title-wrap h3 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 800;
    color: #0f172a;
  }

  .confirm-subtitle {
    display: block;
    font-size: 0.78rem;
    color: #64748b;
    margin-top: 0.15rem;
  }

  .close-btn {
    background: #f1f5f9;
    border: none;
    border-radius: 99px;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: #64748b;
    font-size: 0.85rem;
    transition: all 0.15s ease;
  }

  .close-btn:hover {
    background: #e2e8f0;
    color: #0f172a;
  }

  .confirm-alert-box {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    background: #fffbeb;
    border: 1px solid #fef3c7;
    border-left: 5px solid #f59e0b;
    border-radius: 8px;
    padding: 0.85rem 1rem;
  }

  .alert-icon {
    font-size: 1.3rem;
    line-height: 1.2;
  }

  .alert-text strong {
    display: block;
    font-size: 0.86rem;
    color: #92400e;
    margin-bottom: 0.2rem;
  }

  .alert-text p {
    margin: 0;
    font-size: 0.8rem;
    color: #b45309;
    line-height: 1.4;
  }

  .confirm-recap-card {
    display: flex;
    flex-direction: column;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    overflow: hidden;
  }

  .recap-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.65rem 1rem;
    border-bottom: 1px solid #edf2f7;
    font-size: 0.86rem;
  }

  .recap-row:last-child {
    border-bottom: none;
  }

  .highlight-row {
    background: #ffffff;
  }

  .recap-label {
    color: #64748b;
    font-weight: 500;
  }

  .recap-val {
    color: #1e293b;
    text-align: right;
  }

  .amount-highlight {
    font-size: 1.15rem;
    font-weight: 800;
  }

  .text-income {
    color: #16a34a;
  }

  .text-expense {
    color: #2563eb;
  }

  .font-semibold {
    font-weight: 600;
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    padding: 0.25rem 0.65rem;
    border-radius: 99px;
    font-size: 0.78rem;
    font-weight: 700;
  }

  .badge-green {
    background: #dcfce7;
    color: #15803d;
    border: 1px solid #bbf7d0;
  }

  .badge-blue {
    background: #dbeafe;
    color: #1d4ed8;
    border: 1px solid #bfdbfe;
  }

  .recap-allocations-row {
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
  }

  .recap-allocations-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .recap-alloc-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 0.4rem 0.65rem;
    font-size: 0.82rem;
  }

  .alloc-labels {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .project-tag {
    background: #f1f5f9;
    color: #334155;
    padding: 0.15rem 0.45rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .category-tag {
    background: #e0f2fe;
    color: #0369a1;
    padding: 0.15rem 0.45rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .category-tag.uncategorized {
    background: #f1f5f9;
    color: #64748b;
  }

  .alloc-amt {
    color: #0f172a;
    font-weight: 700;
  }

  .confirm-modal-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.75rem;
    padding-top: 0.5rem;
    border-top: 1px solid #e2e8f0;
  }

  .btn-confirm-submit {
    background: #0f172a;
    color: white;
  }

  .btn-confirm-submit:hover:not(:disabled) {
    background: #1e293b;
  }
</style>
