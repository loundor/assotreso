<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import AsyncState from '../components/AsyncState.svelte';
  import Icon from '../components/Icon.svelte';
  import FiscalYearNav from '../components/FiscalYearNav.svelte';
  import { api, listFrom } from '../lib/api';
  import { currency, formatDate, getErrorMessage } from '../lib/utils';
  import type { Category, Invoice, InvoiceAllocation, Project } from '../lib/types';

  export let openCapture: () => void;
  export let openManualCapture: ((dir?: 'expense' | 'income') => void) | undefined = undefined;
  export let refreshKey = 0;

  let invoices: Invoice[] = [];
  let filterTab: 'all' | 'expense' | 'income' = 'all';
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

  let detailOpen = false;
  let detailLoading = false;
  let detailError = '';
  let detailedInvoice: Invoice | null = null;
  let detailedAllocations: InvoiceAllocation[] = [];

  // Navigation par exercice comptable (N, N-1, etc.)
  let fiscalOffset = 0;
  let periodMode: 'fiscal' | 'all' | 'custom' = 'fiscal';
  let filterStartDate = '';
  let filterEndDate = '';

  function isIncome(inv: Invoice): boolean {
    return inv.direction === 'income' || inv.direction === 'EMIS' || inv.invoice_direction === 'EMIS';
  }

  $: periodInvoices = invoices.filter((inv) => {
    if (periodMode === 'fiscal' && filterStartDate && filterEndDate) {
      const invDate = (inv.date || '').slice(0, 10);
      if (invDate && (invDate < filterStartDate || invDate > filterEndDate)) {
        return false;
      }
    } else if (periodMode === 'custom') {
      const invDate = (inv.date || '').slice(0, 10);
      if (filterStartDate && invDate < filterStartDate) return false;
      if (filterEndDate && invDate > filterEndDate) return false;
    }
    return true;
  });

  $: expenseCount = periodInvoices.filter((inv) => !isIncome(inv)).length;
  $: incomeCount = periodInvoices.filter((inv) => isIncome(inv)).length;
  $: filteredInvoices = periodInvoices.filter((inv) => {
    if (filterTab === 'expense') return !isIncome(inv);
    if (filterTab === 'income') return isIncome(inv);
    return true;
  });

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

  async function showVentilationDetails(invoice: Invoice) {
    detailOpen = true;
    detailLoading = true;
    detailError = '';
    detailedInvoice = invoice;
    try {
      const detail = await api.get<{ invoice: Invoice }>(`invoices/${invoice.id}`);
      detailedInvoice = detail.invoice;
      detailedAllocations = (detail.invoice.allocations ?? []) as InvoiceAllocation[];
    } catch (caught) {
      detailError = getErrorMessage(caught);
    } finally {
      detailLoading = false;
    }
  }

  function closeVentilationDetails() {
    detailOpen = false;
    detailedInvoice = null;
    detailedAllocations = [];
    detailError = '';
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && previewOpen) closePreview();
    else if (event.key === 'Escape' && allocationOpen) closeAllocations();
    else if (event.key === 'Escape' && detailOpen) closeVentilationDetails();
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
      <span class="eyebrow">Justificatifs & Facturation</span>
      <h2>Vos factures, sans effort.</h2>
      <p>Gérez vos factures reçues (dépenses fournisseurs) et émises (recettes, prestations, adhésions, subventions). Importez un fichier ou saisissez directement sans justificatif.</p>
      <div class="hero-actions">
        <button class="btn btn-scan btn-large" on:click={openCapture}>
          <Icon name="scan" size={22}/> Scanner / importer une facture
        </button>
        <button class="btn btn-secondary btn-large" on:click={() => openManualCapture ? openManualCapture('expense') : openCapture()}>
          <Icon name="plus" size={18}/> + Facture reçue (dépense)
        </button>
        <button class="btn btn-primary btn-large btn-hero-income" on:click={() => openManualCapture ? openManualCapture('income') : openCapture()}>
          <Icon name="plus" size={18}/> + Facture émise (recette)
        </button>
      </div>
    </div>
    <div class="scan-illustration" aria-hidden="true">
      <div class="scan-corners"><Icon name="invoice" size={55}/><span></span></div>
      <small>DÉPENSES · RECETTES · PDF</small>
    </div>
  </section>

  <FiscalYearNav
    bind:fiscalOffset
    bind:mode={periodMode}
    bind:filterStartDate
    bind:filterEndDate
    itemCount={periodInvoices.length}
    itemLabel="factures"
    allowCustomDates={true}
  />

  <div class="section-heading-with-tabs">
    <div class="section-heading">
      <div>
        <h3>Liste des factures ({filteredInvoices.length})</h3>
        <p>Documents validés et enregistrés pour l'association</p>
      </div>
    </div>
    <div class="invoices-filter-tabs">
      <button
        type="button"
        class="filter-tab"
        class:active={filterTab === 'all'}
        on:click={() => filterTab = 'all'}
      >
        Toutes ({periodInvoices.length})
      </button>
      <button
        type="button"
        class="filter-tab"
        class:active={filterTab === 'expense'}
        on:click={() => filterTab = 'expense'}
      >
        📥 Reçues / Dépenses ({expenseCount})
      </button>
      <button
        type="button"
        class="filter-tab income-tab"
        class:active={filterTab === 'income'}
        on:click={() => filterTab = 'income'}
      >
        📤 Émises / Recettes ({incomeCount})
      </button>
    </div>
  </div>

  <AsyncState {loading} {error} empty={!filteredInvoices.length} emptyTitle="Aucune facture dans cette vue" emptyText="Scannez ou saisissez une facture pour la retrouver ici." onRetry={load}>
    <div class="panel table-panel">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Type / Sens</th>
              <th>Tiers</th>
              <th>N°</th>
              <th>Ventilation</th>
              <th class="align-center">Traité</th>
              <th class="align-right">TTC</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {#each filteredInvoices as invoice (invoice.id)}
              <tr>
                <td data-label="Date">{formatDate(invoice.date)}</td>
                <td data-label="Type">
                  {#if isIncome(invoice)}
                    <span class="status-badge badge-green" title="Facture émise par l'association (gain / recette)">
                      📤 Émise (Recette)
                    </span>
                  {:else}
                    <span class="status-badge badge-blue" title="Facture reçue d'un fournisseur (dépense / charge)">
                      📥 Reçue (Dépense)
                    </span>
                  {/if}
                </td>
                <td data-label="Tiers">
                  {#if isIncome(invoice)}
                    <strong>{invoice.recipient || invoice.supplier || 'Client / Adhérent inconnu'}</strong>
                    {#if invoice.supplier}
                      <small class="tiers-sub">Émetteur : {invoice.supplier}</small>
                    {/if}
                  {:else}
                    <strong>{invoice.supplier || invoice.recipient || 'Fournisseur inconnu'}</strong>
                    {#if invoice.recipient}
                      <small class="tiers-sub">Dest. : {invoice.recipient}</small>
                    {/if}
                  {/if}
                </td>
                <td data-label="N°">{invoice.number || '—'}</td>
                <td data-label="Ventilation">
                  {#if (invoice.remainingAmount ?? invoice.remaining_amount ?? 0) <= 0}
                    <button
                      type="button"
                      class="status-badge badge-green badge-clickable"
                      title="Cliquer pour voir le détail de la ventilation"
                      on:click={() => showVentilationDetails(invoice)}
                    >
                      Complète
                    </button>
                  {:else if (invoice.allocatedAmount ?? invoice.allocated_amount ?? 0) > 0}
                    <button
                      type="button"
                      class="status-badge badge-blue badge-clickable"
                      title="Cliquer pour voir le détail de la ventilation"
                      on:click={() => showVentilationDetails(invoice)}
                    >
                      Partielle
                    </button>
                  {:else}
                    <span class="status-badge badge-orange" title="Ventilation non effectuée">Non affectée</span>
                  {/if}
                  <small>{currency.format(invoice.allocatedAmount ?? invoice.allocated_amount ?? 0)} affectés</small>
                </td>
                <td data-label="Traité" class="align-center">
                  {#if invoice.isReconciled || invoice.reconciled || invoice.is_reconciled || invoice.transaction_id || invoice.transactionId}
                    <span class="traite-icon" title="Rapprochement bancaire effectué">
                      <Icon name="check" size={17} />
                    </span>
                  {/if}
                </td>
                <td data-label="TTC" class="align-right amount" class:income-amount={isIncome(invoice)}>
                  {isIncome(invoice) ? '+' : ''}{currency.format(invoice.totalTtc ?? invoice.total ?? 0)}
                </td>
                <td data-label="Actions">
                  <div class="row-actions">
                    <button class="btn btn-secondary btn-small" on:click={() => showDocument(invoice)}><Icon name="invoice" size={16}/> Voir</button>
                    {#if (invoice.remainingAmount ?? invoice.remaining_amount ?? 0) > 0}
                      <button class="btn btn-secondary btn-small" on:click={() => editAllocations(invoice)}><Icon name="folder" size={16}/> Ventiler</button>
                    {/if}
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  </AsyncState>
</div>

<style>
  .hero-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-top: 1rem;
    align-items: center;
  }
  .align-center {
    text-align: center;
  }
  :global(.allocation-row) {
    display: grid !important;
    grid-template-columns: minmax(140px, 1fr) minmax(150px, 1fr) minmax(110px, 120px) auto !important;
    gap: 0.75rem !important;
    align-items: flex-end !important;
  }
  :global(.allocation-row label) {
    min-width: 0 !important;
    width: 100% !important;
    box-sizing: border-box !important;
  }
  :global(.allocation-row label input),
  :global(.allocation-row label select) {
    width: 100% !important;
    max-width: 100% !important;
    box-sizing: border-box !important;
    min-width: 0 !important;
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
  .badge-clickable {
    cursor: pointer;
    border: none;
    font-family: inherit;
    transition: transform 0.12s ease, box-shadow 0.12s ease;
  }
  .badge-clickable:hover {
    transform: translateY(-1px);
    box-shadow: 0 2px 6px rgba(0,0,0,0.1);
  }
  .badge-green {
    background: #dcfce7 !important;
    color: #15803d !important;
    border: 1px solid #bbf7d0 !important;
  }
  .badge-blue {
    background: #eff6ff !important;
    color: #1d4ed8 !important;
    border: 1px solid #bfdbfe !important;
  }
  .badge-orange {
    background: #fff7ed !important;
    color: #c2410c !important;
    border: 1px solid #fed7aa !important;
  }
  .detail-allocations-table {
    margin: 1.25rem 0;
  }
  .alloc-breakdown-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
  }
  .alloc-breakdown-table th {
    background: #f8fafc;
    padding: 0.5rem 0.75rem;
    border-bottom: 2px solid #e2e8f0;
    text-align: left;
    font-weight: 600;
    color: #475569;
  }
  .alloc-breakdown-table td {
    padding: 0.6rem 0.75rem;
    border-bottom: 1px solid #f1f5f9;
  }
  .empty-alloc-text {
    color: #94a3b8;
    text-align: center;
    padding: 1.5rem 0;
  }
  .btn-hero-income {
    background: #16a34a !important;
    border-color: #15803d !important;
    color: #ffffff !important;
  }
  .btn-hero-income:hover {
    background: #15803d !important;
  }
  .section-heading-with-tabs {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 1rem;
    margin-bottom: 1rem;
  }
  .invoices-filter-tabs {
    display: inline-flex;
    background: #e2e8f0;
    padding: 0.25rem;
    border-radius: 10px;
    gap: 0.25rem;
  }
  .filter-tab {
    border: none;
    background: transparent;
    padding: 0.45rem 0.85rem;
    border-radius: 7px;
    font-size: 0.82rem;
    font-weight: 600;
    color: #64748b;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
  }
  .filter-tab:hover {
    color: #1e293b;
  }
  .filter-tab.active {
    background: #ffffff;
    color: #0f172a;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  }
  .filter-tab.income-tab.active {
    color: #15803d;
  }
  .tiers-sub {
    display: block;
    font-size: 0.75rem;
    color: #64748b;
    margin-top: 0.15rem;
  }
  .amount.income-amount {
    color: #15803d;
    font-weight: 700;
  }
  @media (max-width: 759px) {
    :global(.allocation-row) {
      grid-template-columns: 1fr !important;
      align-items: stretch !important;
    }
    :global(.allocation-row > .text-button) {
      justify-self: start;
      min-height: 40px;
    }
    .hero-actions { align-items: stretch; flex-direction: column; }
    .hero-actions .btn { width: 100%; }
    .invoices-filter-tabs { display: grid; grid-template-columns: 1fr; width: 100%; }
    .filter-tab { min-height: 42px; white-space: normal; }
    .row-actions { justify-content: flex-end; }
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

{#if detailOpen && detailedInvoice}
  <div class="capture-layer" role="presentation">
    <button class="backdrop" aria-label="Fermer les détails" on:click={closeVentilationDetails}></button>
    <div class="capture-modal allocation-modal" role="dialog" aria-modal="true" aria-labelledby="ventilation-detail-title">
      <header class="capture-header">
        <div>
          <span class="eyebrow">Ventilation analytique</span>
          <h2 id="ventilation-detail-title">Détail des affectations</h2>
        </div>
        <button class="icon-button" aria-label="Fermer" on:click={closeVentilationDetails}>
          <Icon name="close"/>
        </button>
      </header>
      <div class="capture-content">
        {#if detailLoading}
          <div class="state" role="status"><span class="spinner"></span><p>Chargement du détail…</p></div>
        {:else if detailError}
          <div class="alert" role="alert"><Icon name="alert" size={18}/>{detailError}</div>
        {:else}
          <div class="allocation-summary">
            <div>
              <span>Facture</span>
              <strong>{detailedInvoice.supplier || detailedInvoice.recipient || detailedInvoice.number || 'Facture'}</strong>
            </div>
            <div>
              <span>Total TTC</span>
              <strong>{currency.format(detailedInvoice.totalTtc ?? detailedInvoice.total ?? 0)}</strong>
            </div>
          </div>

          <div class="detail-allocations-table">
            {#if !detailedAllocations.length}
              <p class="empty-alloc-text">Aucune affectation enregistrée pour cette facture.</p>
            {:else}
              <table class="alloc-breakdown-table">
                <thead>
                  <tr>
                    <th>Projet</th>
                    <th>Catégorie / Rubrique</th>
                    <th class="align-right">Montant TTC</th>
                    <th class="align-right">Part</th>
                  </tr>
                </thead>
                <tbody>
                  {#each detailedAllocations as alloc}
                    <tr>
                      <td><strong>{alloc.project_name || alloc.projectId || 'Aucun projet'}</strong></td>
                      <td>{alloc.category_name || alloc.categoryId || 'Non classée'}</td>
                      <td class="align-right amount">{currency.format(alloc.amount)}</td>
                      <td class="align-right">
                        {detailedInvoice.totalTtc ? Math.round((alloc.amount / Math.abs(detailedInvoice.totalTtc)) * 100) : 0}%
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/if}
          </div>

          <div class="allocation-total">
            <span>Affecté : <strong>{currency.format(detailedInvoice.allocatedAmount ?? detailedInvoice.allocated_amount ?? 0)}</strong></span>
            <span>Reste : <strong>{currency.format(detailedInvoice.remainingAmount ?? detailedInvoice.remaining_amount ?? 0)}</strong></span>
          </div>

          <div class="capture-actions">
            <button type="button" class="btn btn-secondary" on:click={closeVentilationDetails}>Fermer</button>
            <button
              type="button"
              class="btn btn-primary"
              on:click={() => {
                const inv = detailedInvoice;
                closeVentilationDetails();
                if (inv) editAllocations(inv);
              }}
            >
              <Icon name="folder" size={16} /> Modifier la ventilation
            </button>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
