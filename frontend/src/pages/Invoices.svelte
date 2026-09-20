<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import AsyncState from '../components/AsyncState.svelte';
  import Icon from '../components/Icon.svelte';
  import { api, listFrom } from '../lib/api';
  import { currency, formatDate, getErrorMessage } from '../lib/utils';
  import type { Category, Invoice, InvoiceAllocation, Project } from '../lib/types';

  export let openCapture: () => void;
  export let refreshKey = 0;

  let invoices: Invoice[] = [];
  let loading = true;
  let error = '';
  let previewOpen = false;
  let previewLoading = false;
  let previewError = '';
  let previewUrl = '';
  let previewMime = '';
  let previewName = '';
  let allocationOpen = false;
  let allocationLoading = false;
  let allocationSaving = false;
  let allocationError = '';
  let editedInvoice: Invoice | null = null;
  let projects: Project[] = [];
  let categories: Category[] = [];
  let allocationRows: Array<{ projectId: string; categoryId: string; amount: number }> = [];
  $: allocationTotal = allocationRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  $: invoiceTotal = Math.abs(Number(editedInvoice?.totalTtc ?? editedInvoice?.total ?? 0));
  $: allocationRemaining = Math.max(0, invoiceTotal - allocationTotal);

  async function load() {
    loading = true;
    error = '';
    try {
      invoices = listFrom<Invoice>(await api.get('invoices'), ['invoices']);
    } catch (caught) {
      error = getErrorMessage(caught);
    } finally {
      loading = false;
    }
  }

  function releasePreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = '';
  }

  function closePreview() {
    previewOpen = false;
    previewError = '';
    releasePreview();
  }

  async function showDocument(invoice: Invoice) {
    const documentId = invoice.document_id ?? invoice.documentId;
    if (!documentId) return;
    releasePreview();
    previewOpen = true;
    previewLoading = true;
    previewError = '';
    previewMime = invoice.mime_type ?? '';
    previewName = invoice.original_name ?? `Facture ${invoice.number ?? ''}`;
    try {
      const blob = await api.download(`documents/${documentId}/preview`);
      previewMime = blob.type || previewMime;
      previewUrl = URL.createObjectURL(blob);
    } catch (caught) {
      previewError = getErrorMessage(caught);
    } finally {
      previewLoading = false;
    }
  }

  function categoryProject(item: Category): string { return String(item.projectId ?? item.project_id ?? ''); }
  function categoriesFor(projectId: string): Category[] {
    return categories.filter((item) => !categoryProject(item) || categoryProject(item) === projectId);
  }
  function updateAllocation(index: number, patch: Partial<{ projectId: string; categoryId: string; amount: number }>) {
    allocationRows = allocationRows.map((row, position) => position === index ? { ...row, ...patch } : row);
  }
  function changeProject(index: number, projectId: string) {
    const row = allocationRows[index];
    const selectedCategory = categories.find((item) => String(item.id) === row.categoryId);
    const linkedProject = selectedCategory ? categoryProject(selectedCategory) : '';
    updateAllocation(index, { projectId, categoryId: linkedProject && linkedProject !== projectId ? '' : row.categoryId });
  }
  function addAllocation() { allocationRows = [...allocationRows, { projectId: '', categoryId: '', amount: allocationRemaining }]; }
  function removeAllocation(index: number) {
    allocationRows = allocationRows.filter((_, position) => position !== index);
    if (!allocationRows.length) allocationRows = [{ projectId: '', categoryId: '', amount: 0 }];
  }
  async function editAllocations(invoice: Invoice) {
    allocationOpen = true; allocationLoading = true; allocationError = ''; editedInvoice = invoice;
    try {
      const [detail, projectPayload, categoryPayload] = await Promise.all([
        api.get<{ invoice: Invoice }>(`invoices/${invoice.id}`), api.get('projects'), api.get('categories')
      ]);
      editedInvoice = detail.invoice;
      projects = listFrom<Project>(projectPayload, ['projects']);
      categories = listFrom<Category>(categoryPayload, ['categories']);
      allocationRows = (detail.invoice.allocations ?? []).map((row: InvoiceAllocation) => ({
        projectId: String(row.projectId ?? row.project_id ?? ''), categoryId: String(row.categoryId ?? row.category_id ?? ''), amount: Number(row.amount)
      }));
      if (!allocationRows.length) allocationRows = [{ projectId: '', categoryId: '', amount: invoiceTotal }];
    } catch (caught) { allocationError = getErrorMessage(caught); }
    finally { allocationLoading = false; }
  }
  function closeAllocations() { if (!allocationSaving) { allocationOpen = false; editedInvoice = null; allocationError = ''; } }
  async function saveAllocations() {
    if (!editedInvoice) return;
    if (allocationTotal > invoiceTotal + 0.001) { allocationError = 'La ventilation dépasse le montant TTC de la facture.'; return; }
    allocationSaving = true; allocationError = '';
    try {
      await api.put(`invoices/${editedInvoice.id}/allocations`, { allocations: allocationRows
        .filter((row) => (row.projectId || row.categoryId) && Number(row.amount) > 0)
        .map((row) => ({ projectId: row.projectId || null, categoryId: row.categoryId || null, amount: Number(row.amount).toFixed(2) })) });
      allocationOpen = false; editedInvoice = null; await load();
    } catch (caught) { allocationError = getErrorMessage(caught); }
    finally { allocationSaving = false; }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && previewOpen) closePreview();
    else if (event.key === 'Escape' && allocationOpen) closeAllocations();
  }

  onMount(() => {
    load();
    window.addEventListener('keydown', handleKeydown);
  });
  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown);
    releasePreview();
  });
  $: if (refreshKey) load();
</script>

<div class="page-stack">
  <section class="invoice-hero">
    <div>
      <span class="eyebrow">Justificatifs</span>
      <h2>Vos factures, sans effort.</h2>
      <p>Photographiez ou importez un document. Nous en extrayons les informations, vous gardez toujours le dernier mot.</p>
      <button class="btn btn-scan btn-large" on:click={openCapture}>
        <Icon name="scan" size={22}/> Scanner / importer une facture
      </button>
    </div>
    <div class="scan-illustration" aria-hidden="true">
      <div class="scan-corners"><Icon name="invoice" size={55}/><span></span></div>
      <small>PHOTO · IMAGE · PDF</small>
    </div>
  </section>

  <div class="section-heading">
    <div><h3>Toutes les factures</h3><p>Documents validés et enregistrés</p></div>
  </div>

  <AsyncState {loading} {error} empty={!invoices.length} emptyTitle="Aucune facture enregistrée" emptyText="Scannez votre première facture pour la retrouver ici." onRetry={load}>
    <div class="panel table-panel">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Fournisseur / destinataire</th><th>N°</th><th>Ventilation</th><th class="align-center">Traité</th><th class="align-right">TTC</th><th>Actions</th></tr></thead>
          <tbody>
            {#each invoices as invoice}
              <tr>
                <td data-label="Date">{formatDate(invoice.date)}</td>
                <td data-label="Tiers"><strong>{invoice.supplier || invoice.recipient || '—'}</strong></td>
                <td data-label="N°">{invoice.number || '—'}</td>
                <td data-label="Ventilation"><span class="status-badge">{(invoice.remainingAmount ?? invoice.remaining_amount ?? 0) <= 0 ? 'Complète' : (invoice.allocatedAmount ?? invoice.allocated_amount ?? 0) > 0 ? 'Partielle' : 'Non affectée'}</span><small>{currency.format(invoice.allocatedAmount ?? invoice.allocated_amount ?? 0)} affectés</small></td>
                <td data-label="Traité" class="align-center">
                  {#if invoice.isReconciled || invoice.reconciled || invoice.is_reconciled || invoice.transaction_id || invoice.transactionId}
                    <span class="traite-icon" title="Rapprochement bancaire effectué">
                      <Icon name="check" size={17} />
                    </span>
                  {/if}
                </td>
                <td data-label="TTC" class="align-right amount">{currency.format(invoice.totalTtc ?? invoice.total ?? 0)}</td>
                <td data-label="Actions"><div class="row-actions"><button class="btn btn-secondary btn-small" on:click={() => showDocument(invoice)}><Icon name="invoice" size={16}/> Voir</button><button class="btn btn-secondary btn-small" on:click={() => editAllocations(invoice)}><Icon name="folder" size={16}/> Ventiler</button></div></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  </AsyncState>
</div>

<style>
  .align-center {
    text-align: center;
  }
  .traite-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #198754;
    background: #e8f5e9;
    border-radius: 99px;
    width: 26px;
    height: 26px;
  }
</style>

{#if previewOpen}
  <div class="capture-layer" role="presentation">
    <button class="backdrop" aria-label="Fermer l’aperçu" on:click={closePreview}></button>
    <div class="capture-modal invoice-preview-modal" role="dialog" aria-modal="true" aria-labelledby="invoice-preview-title" tabindex="-1">
      <header class="capture-header">
        <div><span class="eyebrow">Document archivé</span><h2 id="invoice-preview-title">{previewName}</h2></div>
        <button class="icon-button" aria-label="Fermer" on:click={closePreview}><Icon name="close"/></button>
      </header>
      <div class="invoice-preview-content">
        {#if previewLoading}
          <div class="state" role="status"><span class="spinner"></span><p>Chargement de la facture…</p></div>
        {:else if previewError}
          <div class="state"><div class="state-icon"><Icon name="alert"/></div><p>{previewError}</p><button class="btn btn-secondary" on:click={closePreview}>Fermer</button></div>
        {:else if previewMime === 'application/pdf'}
          <object data={previewUrl} type="application/pdf" aria-label="Facture PDF"><p>Votre navigateur ne peut pas afficher ce PDF.</p></object>
        {:else}
          <img src={previewUrl} alt="Facture numérisée"/>
        {/if}
      </div>
    </div>
  </div>
{/if}

{#if allocationOpen}
  <div class="capture-layer" role="presentation">
    <button class="backdrop" aria-label="Fermer la ventilation" on:click={closeAllocations}></button>
    <div class="capture-modal allocation-modal" role="dialog" aria-modal="true" aria-labelledby="allocation-title">
      <header class="capture-header"><div><span class="eyebrow">Analyse des dépenses</span><h2 id="allocation-title">Ventiler la facture</h2></div><button class="icon-button" aria-label="Fermer" on:click={closeAllocations}><Icon name="close"/></button></header>
      <div class="capture-content">
        {#if allocationLoading}
          <div class="state" role="status"><span class="spinner"></span><p>Chargement des affectations…</p></div>
        {:else}
          <div class="allocation-summary"><div><span>Facture</span><strong>{editedInvoice?.supplier || editedInvoice?.recipient || editedInvoice?.number || 'Facture'}</strong></div><div><span>Total TTC</span><strong>{currency.format(invoiceTotal)}</strong></div></div>
          <p>Répartissez le TTC entre un ou plusieurs projets. Une rubrique liée au projet permet une analyse plus précise.</p>
          {#if allocationError}<div class="alert" role="alert"><Icon name="alert" size={18}/>{allocationError}</div>{/if}
          <div class="allocation-list">
            {#each allocationRows as row, index}
              <div class="allocation-row">
                <label>Projet<select value={row.projectId} on:change={(event) => changeProject(index, event.currentTarget.value)}><option value="">Aucun projet</option>{#each projects as project}<option value={project.id}>{project.name}</option>{/each}</select></label>
                <label>Catégorie / rubrique<select value={row.categoryId} on:change={(event) => updateAllocation(index, { categoryId: event.currentTarget.value })}><option value="">Non classée</option>{#each categoriesFor(row.projectId) as category}<option value={category.id}>{category.name}{category.project_name ? ` · ${category.project_name}` : ' · globale'}</option>{/each}</select></label>
                <label>Montant TTC (€)<input type="number" min="0" step="0.01" value={row.amount} on:input={(event) => updateAllocation(index, { amount: Number(event.currentTarget.value) })}/></label>
                {#if allocationRows.length > 1}<button type="button" class="text-button danger" on:click={() => removeAllocation(index)}>Retirer</button>{/if}
              </div>
            {/each}
          </div>
          <button type="button" class="btn btn-secondary btn-small" on:click={addAllocation}><Icon name="plus" size={15}/> Ajouter une affectation</button>
          <div class:over-allocated={allocationTotal > invoiceTotal} class="allocation-total"><span>Affecté <strong>{currency.format(allocationTotal)}</strong></span><span>Reste <strong>{currency.format(allocationRemaining)}</strong></span></div>
          <div class="capture-actions"><button type="button" class="btn btn-secondary" on:click={closeAllocations}>Annuler</button><button type="button" class="btn btn-primary" disabled={allocationSaving} on:click={saveAllocations}>{allocationSaving ? 'Enregistrement…' : 'Enregistrer la ventilation'}</button></div>
        {/if}
      </div>
    </div>
  </div>
{/if}
