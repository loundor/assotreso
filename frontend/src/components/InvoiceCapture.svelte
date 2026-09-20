<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { api, ApiError, listFrom } from '../lib/api';
  import { currency, getErrorMessage } from '../lib/utils';
  import type { AnalysisField, CaptureAnalysis, CapturedDocument, Category, Project } from '../lib/types';

  export let onClose: () => void;
  export let onSuccess: () => void;

  type Step = 'choose' | 'preview' | 'uploading' | 'review' | 'success';
  let step: Step = 'choose';
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
  let type = 'invoice'; let direction = 'expense'; let supplier = ''; let recipient = ''; let invoiceNumber = '';
  let date = ''; let subtotal = 0; let tax = 0; let total = 0;
  let allocations: AllocationDraft[] = [{ projectId: '', categoryId: '', amount: 0 }];
  let activeAllocation = 0;
  let quickCreate: 'category' | 'project' | null = null;
  let quickName = ''; let quickParentId = ''; let quickSaving = false; let quickError = '';
  $: allocatedTotal = allocations.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  $: allocationRemaining = Math.max(0, (Number(total) || 0) - allocatedTotal);

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
    direction = extractedString(['direction', 'financialDirection', 'sense'], 'expense');
    supplier = extractedString(['supplier', 'vendor', 'fournisseur']);
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

  async function validate() {
    if (!document) return;
    validating = true; validateError = '';
    try {
      if (allocatedTotal > Number(total) + 0.001) throw new Error('La ventilation dépasse le montant TTC de la facture.');
      await api.post(`documents/${document.id}/validate`, {
        type, direction, supplier, recipient, number: invoiceNumber, date,
        subtotal: Number(subtotal), tax: Number(tax), total: Number(total),
        allocations: allocations
          .filter((item) => (item.projectId || item.categoryId) && Number(item.amount) > 0)
          .map((item) => ({ projectId: item.projectId || null, categoryId: item.categoryId || null, amount: Number(item.amount).toFixed(2) }))
      });
      step = 'success'; onSuccess();
    } catch (error) { validateError = getErrorMessage(error); }
    finally { validating = false; }
  }

  function resetFile() { if (localPreview) URL.revokeObjectURL(localPreview); localPreview = ''; file = null; step = 'choose'; uploadError = ''; }
  function keydown(event: KeyboardEvent) { if (event.key === 'Escape' && step !== 'uploading' && !validating) onClose(); }
  onMount(async () => {
    window.addEventListener('keydown', keydown);
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
    <header class="capture-header"><div><span class="eyebrow">Ajout intelligent</span><h2 id="capture-title">{step === 'review' ? 'Vérifiez les informations' : step === 'success' ? 'Facture enregistrée' : 'Scanner / importer une facture'}</h2></div>{#if step !== 'uploading' && !validating}<button class="icon-button" aria-label="Fermer" on:click={onClose}><Icon name="close"/></button>{/if}</header>

    {#if step === 'choose'}
      <div class="capture-content choose-content"><div class="capture-intro"><span class="big-scan-icon"><Icon name="scan" size={34}/></span><h3>Comment souhaitez-vous ajouter le document ?</h3><p>Les informations seront extraites automatiquement, puis soumises à votre validation.</p></div>
        {#if uploadError}<div class="alert" role="alert"><Icon name="alert" size={18}/>{uploadError}</div>{/if}
        <div class="choice-grid"><label class="file-choice"><input type="file" accept="image/*" capture="environment" on:change={(e) => selectFile(e.currentTarget.files?.[0])}/><span class="choice-icon"><Icon name="camera" size={28}/></span><span><strong>Prendre une photo</strong><small>Utiliser l’appareil photo</small></span><Icon name="chevron"/></label><label class="file-choice"><input type="file" accept="image/*,application/pdf,.pdf" on:change={(e) => selectFile(e.currentTarget.files?.[0])}/><span class="choice-icon"><Icon name="upload" size={28}/></span><span><strong>Choisir un fichier</strong><small>Image ou PDF · 10 Mo max.</small></span><Icon name="chevron"/></label></div>
        <div class="privacy-note">🔒 Votre document est transmis de manière sécurisée.</div>
      </div>
    {:else if step === 'preview'}
      <div class="capture-content"><div class="preview-layout"><div class="document-preview">{#if file?.type === 'application/pdf'}<object data={localPreview} type="application/pdf" aria-label="Aperçu du PDF"><div class="pdf-placeholder"><Icon name="invoice" size={48}/><strong>{file?.name}</strong><small>Aperçu PDF</small></div></object>{:else}<img src={localPreview} alt="Aperçu de la facture sélectionnée"/>{/if}</div><div class="preview-info"><span class="status-badge">Prêt pour l’analyse</span><h3>{file?.name}</h3><p>{file ? `${(file.size/1024/1024).toFixed(2)} Mo` : ''}</p><label class:disabled={!aiAvailable} class="ai-capture-option"><input type="checkbox" bind:checked={useAi} disabled={!aiAvailable || aiStatusLoading}/><span><strong>Analyse avec IA</strong><small>{aiStatusLoading ? 'Vérification de la disponibilité…' : aiAvailable ? 'L’analyse avec le fournisseur IA configuré sera effectuée.' : 'L’IA n’est pas activée ou sa configuration/connexion n’est pas prête.'}</small></span></label><div class="analysis-promise"><Icon name="check"/><span><strong>Vous gardez le contrôle</strong><small>Aucune facture ne sera créée avant votre validation explicite.</small></span></div></div></div>
        {#if uploadError}<div class="alert" role="alert"><Icon name="alert" size={18}/>{uploadError}</div>{/if}
        <div class="capture-actions"><button class="btn btn-secondary" on:click={resetFile}>Choisir un autre fichier</button><button class="btn btn-scan" on:click={analyze}>Analyser le document <span>→</span></button></div></div>
    {:else if step === 'uploading'}
      <div class="capture-content analyzing" role="status" aria-live="polite"><div class="analysis-animation"><div class="paper-scan"><Icon name="invoice" size={58}/><span class="laser"></span></div></div><h3>Analyse du document…</h3><p>Nous identifions les montants, les tiers et les informations comptables.</p><div class="progress-track"><span style:width={`${progress}%`}></span></div><strong>{progress} %</strong><small>Ne fermez pas cette fenêtre.</small></div>
    {:else if step === 'review'}
      <form class="capture-content review-content" on:submit|preventDefault={validate}>
        <div class="review-banner"><div><Icon name="check"/><span><strong>Analyse terminée</strong><small>Contrôlez les champs signalés avant de valider.</small></span></div><div class="review-badges">{#if aiUsed}<span class="ai-used-badge">IA utilisée</span>{/if}<span class="confidence">Confiance globale <strong>{displayConfidence(analysis.confidence ?? null) || '—'}</strong></span></div></div>
        <div class="review-layout"><aside class="review-preview"><div class="document-preview compact">{#if file?.type === 'application/pdf'}<object data={localPreview} type="application/pdf" aria-label="Aperçu du PDF"></object>{:else}<img src={localPreview} alt="Aperçu de la facture"/>{/if}</div><small>{file?.name}</small></aside>
          <div class="review-form"><div class="form-section"><h3>Nature du document</h3><div class="form-grid"><label class:uncertain={uncertain('type')}>Type {#if uncertain('type')}<span class="uncertain-label">À vérifier</span>{/if}<select bind:value={type}><option value="invoice">Facture</option><option value="credit_note">Avoir</option><option value="receipt">Reçu / ticket</option></select></label><label class:uncertain={uncertain('direction','financialDirection')}>Sens financier {#if uncertain('direction','financialDirection')}<span class="uncertain-label">À vérifier</span>{/if}<select bind:value={direction}><option value="expense">Dépense</option><option value="income">Recette</option></select></label></div></div>
          <div class="form-section"><h3>Informations générales</h3><div class="form-grid"><label class:uncertain={uncertain('supplier','vendor')}>Fournisseur {#if uncertain('supplier','vendor')}<span class="uncertain-label">À vérifier</span>{/if}<input bind:value={supplier}/></label><label class:uncertain={uncertain('recipient')}>Destinataire {#if uncertain('recipient')}<span class="uncertain-label">À vérifier</span>{/if}<input bind:value={recipient}/></label><label class:uncertain={uncertain('number','invoiceNumber')}>Numéro {#if uncertain('number','invoiceNumber')}<span class="uncertain-label">À vérifier</span>{/if}<input bind:value={invoiceNumber}/></label><label class:uncertain={uncertain('date')}>Date {#if uncertain('date')}<span class="uncertain-label">À vérifier</span>{/if}<input type="date" bind:value={date} required/></label></div></div>
          <div class="form-section"><h3>Montants</h3><div class="form-grid form-grid-3"><label class:uncertain={uncertain('subtotal','totalHt')}>HT (€) {#if uncertain('subtotal','totalHt')}<span class="uncertain-label">À vérifier</span>{/if}<input type="number" step="0.01" bind:value={subtotal}/></label><label class:uncertain={uncertain('tax','vat','tva')}>TVA (€) {#if uncertain('tax','vat','tva')}<span class="uncertain-label">À vérifier</span>{/if}<input type="number" step="0.01" bind:value={tax}/></label><label class:uncertain={uncertain('total','totalTtc')}>TTC (€) {#if uncertain('total','totalTtc')}<span class="uncertain-label">À vérifier</span>{/if}<input type="number" min="0" step="0.01" bind:value={total} required/></label></div><div class="total-check"><span>Total à enregistrer</span><strong>{currency.format(total||0)}</strong></div></div>
          <div class="form-section"><div class="allocation-heading"><div><h3>Ventilation analytique</h3><p>Affectez toute la facture ou répartissez-la entre plusieurs projets et rubriques.</p></div><button type="button" class="btn btn-secondary btn-small" on:click={addAllocation}><Icon name="plus" size={15}/> Ajouter une ligne</button></div>
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
            {#if quickCreate}<div class="quick-create-panel"><label>Nom de {quickCreate === 'category' ? 'la rubrique' : 'du projet'}<input bind:value={quickName} placeholder={quickCreate === 'category' ? 'Ex. Télécommunications' : 'Ex. Fonctionnement général'} on:keydown={(event) => event.key === 'Enter' && (event.preventDefault(), createQuickResource(quickCreate!))}/></label>{#if quickCreate === 'project'}<label>Projet parent<select bind:value={quickParentId}><option value="">Aucun — projet principal</option>{#each orderedProjects() as item}<option value={item.id}>{'— '.repeat(item.depth)}{item.name}</option>{/each}</select></label>{/if}<div><button type="button" class="btn btn-secondary btn-small" on:click={() => quickCreate = null}>Annuler</button><button type="button" class="btn btn-primary btn-small" disabled={quickSaving} on:click={() => createQuickResource(quickCreate!)}>{quickSaving ? 'Création…' : 'Créer et sélectionner'}</button></div>{#if quickError}<small class="quick-create-error" role="alert">{quickError}</small>{/if}</div>{/if}
          </div></div></div>
        {#if validateError}<div class="alert" role="alert"><Icon name="alert" size={18}/>{validateError}</div>{/if}
        <div class="capture-actions sticky-actions"><button type="button" class="btn btn-secondary" on:click={resetFile} disabled={validating}>Recommencer</button><div><span class="validation-note">La facture sera créée à cette étape uniquement.</span><button type="submit" class="btn btn-scan" disabled={validating}>{#if validating}<span class="spinner spinner-light"></span> Validation…{:else}<Icon name="check" size={18}/> Valider et enregistrer{/if}</button></div></div>
      </form>
    {:else}
      <div class="capture-content success-content"><span class="success-mark"><Icon name="check" size={42}/></span><span class="eyebrow">C’est fait</span><h3>La facture a bien été enregistrée.</h3><p>Elle est désormais disponible dans votre liste de factures et peut être rattachée à votre suivi comptable.</p><div class="success-summary"><span>{supplier||recipient||'Document'}</span><strong>{currency.format(total||0)}</strong></div><button class="btn btn-primary btn-large" on:click={onClose}>Voir mes factures</button></div>
    {/if}
  </div>
</div>
