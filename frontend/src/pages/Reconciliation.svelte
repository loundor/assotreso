<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import AsyncState from '../components/AsyncState.svelte';
  import Icon from '../components/Icon.svelte';
  import FiscalYearNav from '../components/FiscalYearNav.svelte';
  import { api } from '../lib/api';
  import { currency, formatDate, getErrorMessage } from '../lib/utils';
  import type { Invoice, ReconciledPair, Transaction } from '../lib/types';

  let loading = true;
  let error = '';
  let unreconciledTransactions: Transaction[] = [];
  let unreconciledInvoices: Invoice[] = [];
  let reconciledPairs: ReconciledPair[] = [];

  let searchTx = '';
  let searchInv = '';

  // Drag & Drop natif HTML5 + Sélection 1-clic
  let draggedTx: Transaction | null = null;
  let hoveredInvoiceId: string | number | null = null;
  let selectedTxForPairing: Transaction | null = null;

  function isInvoiceIncome(item?: { direction?: string; invoice_direction?: string } | null): boolean {
    if (!item) return false;
    return item.direction === 'income' || item.direction === 'EMIS' || item.invoice_direction === 'EMIS';
  }

  // Validation modal
  let confirmModalOpen = false;
  let selectedTx: Transaction | null = null;
  let selectedInv: Invoice | null = null;
  let reconciliationAmount = 0;
  let maxReconciliationAmount = 0;
  let submitting = false;
  let submitError = '';
  let successNotice = '';

  // Modal de dissociation
  let unmatchModalOpen = false;
  let pairToUnmatch: ReconciledPair | null = null;
  let unmatching = false;

  // Navigation par exercice comptable (N, N-1, etc.)
  let fiscalStartDay = 1;
  let fiscalStartMonth = 1;
  let fiscalOffset = 0;
  let filterStartDate = '';
  let filterEndDate = '';
  let periodMode: 'fiscal' | 'all' | 'custom' = 'fiscal';

  $: filteredReconciledPairs = reconciledPairs.filter((pair) => {
    if (periodMode === 'all') return true;
    if (!filterStartDate && !filterEndDate) return true;
    const dateStr = (pair.transaction_date || pair.reconciled_at || '').slice(0, 10);
    if (!dateStr) return true;
    if (filterStartDate && dateStr < filterStartDate) return false;
    if (filterEndDate && dateStr > filterEndDate) return false;
    return true;
  });

  // Modal détails de l'opération bancaire
  let detailTxPair: ReconciledPair | null = null;
  function openTxDetail(pair: ReconciledPair) {
    detailTxPair = pair;
  }
  function closeTxDetail() {
    detailTxPair = null;
  }

  // Modal détails de la facture avec document
  let detailInvPair: ReconciledPair | null = null;
  let docPreviewUrl = '';
  let docPreviewLoading = false;
  let docPreviewError = '';
  let docPreviewMime = '';

  async function openInvDetail(pair: ReconciledPair) {
    detailInvPair = pair;
    if (docPreviewUrl) {
      URL.revokeObjectURL(docPreviewUrl);
      docPreviewUrl = '';
    }
    docPreviewError = '';
    docPreviewMime = pair.document_mime_type || '';
    if (pair.document_id) {
      docPreviewLoading = true;
      try {
        const blob = await api.download(`documents/${pair.document_id}/preview`);
        docPreviewMime = blob.type || docPreviewMime;
        docPreviewUrl = URL.createObjectURL(blob);
      } catch (e) {
        docPreviewError = getErrorMessage(e);
      } finally {
        docPreviewLoading = false;
      }
    }
  }

  function closeInvDetail() {
    if (docPreviewUrl) {
      URL.revokeObjectURL(docPreviewUrl);
      docPreviewUrl = '';
    }
    detailInvPair = null;
    docPreviewError = '';
    docPreviewLoading = false;
  }

  async function loadData() {
    loading = true;
    error = '';
    try {
      const [res, publicConfig] = await Promise.all([
        api.get<{
          unreconciledTransactions: Transaction[];
          unreconciledInvoices: Invoice[];
          reconciledPairs: ReconciledPair[];
        }>('reconciliation'),
        api.get<{ fiscalYearStartDay?: number; fiscalYearStartMonth?: number }>('config/public').catch(() => null)
      ]);
      unreconciledTransactions = res.unreconciledTransactions ?? [];
      unreconciledInvoices = res.unreconciledInvoices ?? [];
      reconciledPairs = res.reconciledPairs ?? [];
      if (publicConfig) {
        fiscalStartDay = Number(publicConfig.fiscalYearStartDay) || 1;
        fiscalStartMonth = Number(publicConfig.fiscalYearStartMonth) || 1;
      }
    } catch (caught) {
      error = getErrorMessage(caught);
    } finally {
      loading = false;
    }
  }

  $: filteredTransactions = unreconciledTransactions.filter((tx) => {
    if (!searchTx.trim()) return true;
    const term = searchTx.toLowerCase();
    return (
      (tx.description && tx.description.toLowerCase().includes(term)) ||
      (tx.label && tx.label.toLowerCase().includes(term)) ||
      (tx.bank_label && String(tx.bank_label).toLowerCase().includes(term)) ||
      (tx.payment_method && String(tx.payment_method).toLowerCase().includes(term)) ||
      (tx.account && String(tx.account).toLowerCase().includes(term)) ||
      String(tx.amount).includes(term)
    );
  });

  $: filteredInvoices = unreconciledInvoices.filter((inv) => {
    if (!searchInv.trim()) return true;
    const term = searchInv.toLowerCase();
    return (
      (inv.supplier && inv.supplier.toLowerCase().includes(term)) ||
      (inv.recipient && inv.recipient.toLowerCase().includes(term)) ||
      (inv.number && inv.number.toLowerCase().includes(term)) ||
      (inv.original_name && inv.original_name.toLowerCase().includes(term)) ||
      String(inv.totalTtc ?? inv.total ?? '').includes(term)
    );
  });

  // Drag & Drop HTML5
  function handleDragStart(event: DragEvent, tx: Transaction) {
    draggedTx = tx;
    hoveredInvoiceId = null;
    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', String(tx.id));
      event.dataTransfer.effectAllowed = 'copy';
      if (event.currentTarget instanceof HTMLElement) {
        event.dataTransfer.setDragImage(event.currentTarget, 24, 24);
      }
    }
  }

  function handleDragEnd() {
    draggedTx = null;
    hoveredInvoiceId = null;
  }

  function handleDragOver(event: DragEvent, inv: Invoice) {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    hoveredInvoiceId = inv.id;
  }

  function handleDragEnter(event: DragEvent, inv: Invoice) {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    hoveredInvoiceId = inv.id;
  }

  function handleDragLeave(event: DragEvent, inv: Invoice) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (
      event.clientX <= rect.left ||
      event.clientX >= rect.right ||
      event.clientY <= rect.top ||
      event.clientY >= rect.bottom
    ) {
      if (String(hoveredInvoiceId) === String(inv.id)) {
        hoveredInvoiceId = null;
      }
    }
  }

  function handleDrop(event: DragEvent, inv: Invoice) {
    event.preventDefault();
    event.stopPropagation();
    const tx = draggedTx;
    draggedTx = null;
    hoveredInvoiceId = null;
    if (tx) {
      openConfirmModal(tx, inv);
    }
  }

  function selectTxForPairing(tx: Transaction) {
    if (selectedTxForPairing?.id === tx.id) {
      selectedTxForPairing = null;
    } else {
      selectedTxForPairing = tx;
    }
  }

  function cancelTxPairing() {
    selectedTxForPairing = null;
  }

  function handleInvoiceClick(inv: Invoice) {
    if (selectedTxForPairing) {
      openConfirmModal(selectedTxForPairing, inv);
    }
  }

  function openConfirmModal(tx: Transaction, inv: Invoice) {
    selectedTx = tx;
    selectedInv = inv;
    const txRem = Number(tx.remainingAmount ?? Math.abs(Number(tx.amount)));
    const invRem = Number(inv.remainingAmount ?? Math.abs(Number(inv.totalTtc ?? inv.total ?? 0)));
    maxReconciliationAmount = Math.max(0, Math.min(txRem, invRem));
    reconciliationAmount = Number(maxReconciliationAmount.toFixed(2));
    submitError = '';
    confirmModalOpen = true;
    selectedTxForPairing = null;
    draggedTx = null;
    hoveredInvoiceId = null;
  }

  function closeConfirmModal() {
    if (!submitting) {
      confirmModalOpen = false;
      selectedTx = null;
      selectedInv = null;
      submitError = '';
    }
  }

  async function approveReconciliation() {
    if (!selectedTx || !selectedInv) return;
    const amountToReconcile = Number(reconciliationAmount);
    if (!amountToReconcile || amountToReconcile <= 0) {
      submitError = 'Veuillez renseigner un montant de rapprochement valide.';
      return;
    }
    submitting = true;
    submitError = '';
    try {
      await api.post('reconciliation', {
        transactionId: selectedTx.id,
        invoiceId: selectedInv.id,
        amount: amountToReconcile
      });
      successNotice = `Rapprochement validé avec succès (${currency.format(amountToReconcile)}) entre l’opération et la facture.`;
      confirmModalOpen = false;
      selectedTx = null;
      selectedInv = null;
      await loadData();
      setTimeout(() => { successNotice = ''; }, 6000);
    } catch (caught) {
      submitError = getErrorMessage(caught);
    } finally {
      submitting = false;
    }
  }

  function promptUnmatch(pair: ReconciledPair) {
    pairToUnmatch = pair;
    unmatchModalOpen = true;
  }

  function closeUnmatchModal() {
    if (!unmatching) {
      unmatchModalOpen = false;
      pairToUnmatch = null;
    }
  }

  async function confirmUnmatch() {
    if (!pairToUnmatch) return;
    unmatching = true;
    try {
      await api.post('reconciliation/unmatch', {
        reconciliationId: pairToUnmatch.reconciliation_id,
        invoiceId: pairToUnmatch.invoice_id,
        transactionId: pairToUnmatch.transaction_id
      });
      unmatchModalOpen = false;
      pairToUnmatch = null;
      successNotice = 'Rapprochement dissocié.';
      await loadData();
      setTimeout(() => { successNotice = ''; }, 4000);
    } catch (caught) {
      error = getErrorMessage(caught);
    } finally {
      unmatching = false;
    }
  }

  function paymentLabel(code?: string | null): string {
    switch (code) {
      case 'CARTE': return 'Carte';
      case 'CHEQUE': return 'Chèque';
      case 'VIREMENT': return 'Virement';
      case 'ESPECES': return 'Espèces';
      default: return code || '—';
    }
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      if (detailTxPair) {
        closeTxDetail();
      } else if (detailInvPair) {
        closeInvDetail();
      } else if (confirmModalOpen && !submitting) {
        closeConfirmModal();
      } else if (unmatchModalOpen && !unmatching) {
        closeUnmatchModal();
      } else if (selectedTxForPairing) {
        cancelTxPairing();
      }
      draggedTx = null;
      hoveredInvoiceId = null;
    }
  }

  onMount(() => {
    loadData();
    window.addEventListener('keydown', handleKeyDown);
  });

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', handleKeyDown);
    }
    if (docPreviewUrl) {
      URL.revokeObjectURL(docPreviewUrl);
    }
  });
</script>

<div class="page-stack">
  <div class="page-intro">
    <div>
      <span class="eyebrow">Trésorerie</span>
      <h2>Rapprochement bancaire</h2>
      <p>Associez chaque facture à son opération bancaire correspondante par simple glisser-déposer.</p>
    </div>
    <button class="btn btn-secondary" on:click={loadData} title="Rafraîchir les données">
      <Icon name="refresh" size={17} /> Actualiser
    </button>
  </div>

  {#if successNotice}
    <div class="alert alert-success" role="status">
      <Icon name="check" size={18} />
      <span>{successNotice}</span>
    </div>
  {/if}

  {#if error}
    <div class="alert" role="alert">
      <Icon name="alert" size={18} />
      <span>{error}</span>
    </div>
  {/if}

  <!-- Section 1 : Rapprochements non effectués (AU-DESSUS) -->
  <section class="reconciliation-pending-section">
    <div class="section-title-wrap">
      <div>
        <h3>Rapprochements à effectuer ({unreconciledTransactions.length} opérations · {unreconciledInvoices.length} factures)</h3>
        <p class="section-subtitle">
          Associez une opération bancaire à une facture par <strong>simple clic sur « Associer »</strong> ou par <strong>glisser-déposer</strong>.
        </p>
      </div>
    </div>

    {#if selectedTxForPairing}
      <div class="pairing-active-banner" role="status">
        <div class="pairing-banner-info">
          <span class="badge-mini badge-blue">Étape 2 / 2</span>
          <span>
            Opération sélectionnée : <strong>{selectedTxForPairing.description || selectedTxForPairing.label}</strong> ({currency.format(Number(selectedTxForPairing.amount))})
            — <em>Cliquez sur la facture correspondante dans la colonne de droite pour valider.</em>
          </span>
        </div>
        <button type="button" class="btn btn-secondary btn-small" on:click={cancelTxPairing}>
          Annuler la sélection
        </button>
      </div>
    {/if}

    <AsyncState {loading} {error} empty={false} onRetry={loadData}>
      <div class="drag-grid">
        <!-- COLONNE GAUCHE : Transactions bancaires non rapprochées -->
        <div class="drag-column transactions-column">
          <div class="column-header">
            <div class="column-title">
              <Icon name="transfer" size={20} />
              <h4>Opérations bancaires en attente</h4>
              <span class="count-tag">{filteredTransactions.length}</span>
            </div>
            <input
              type="search"
              bind:value={searchTx}
              placeholder="Filtrer les opérations (libellé, montant, date)…"
              class="column-search"
            />
          </div>

          <div class="cards-scroller">
            {#if !filteredTransactions.length}
              <div class="empty-column">
                <Icon name="check" size={28} />
                <p>Toutes les opérations bancaires ont été rapprochées à 100% !</p>
              </div>
            {:else}
              {#each filteredTransactions as tx (tx.id)}
                <div
                  class="tx-card"
                  class:is-dragging={draggedTx?.id === tx.id}
                  class:is-pairing-selected={selectedTxForPairing?.id === tx.id}
                  role="button"
                  tabindex="0"
                  draggable="true"
                  on:dragstart={(e) => handleDragStart(e, tx)}
                  on:dragend={handleDragEnd}
                  on:click={() => selectTxForPairing(tx)}
                  on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectTxForPairing(tx); } }}
                >
                  <div
                    class="card-drag-handle"
                    title="Glissez cette opération sur une facture pour les associer"
                  >
                    <span class="drag-grip">⋮⋮</span>
                    <span class="tx-date">{formatDate(tx.date)}</span>
                  </div>

                  <div class="tx-body">
                    <strong class="tx-desc">{tx.description || tx.label}</strong>
                    {#if tx.bank_label && tx.bank_label !== tx.description}
                      <small class="tx-sub">{tx.bank_label}</small>
                    {/if}
                    <div class="tx-meta">
                      {#if tx.payment_method}
                        <span class="badge-mini">{paymentLabel(tx.payment_method)}</span>
                      {/if}
                      {#if tx.account || tx.account_name}
                        <span class="badge-mini subtle">{tx.account_name || tx.account}</span>
                      {/if}
                      {#if (tx.reconciliationPercent ?? 0) > 0}
                        <span class="badge-mini badge-blue">Partiel ({tx.reconciliationPercent}%)</span>
                      {/if}
                    </div>

                    <!-- Barre de progression du rapprochement de l'opération -->
                    <div class="progress-wrap">
                      <div class="progress-bar-track" title="Taux de rapprochement : {tx.reconciliationPercent ?? 0}%">
                        <div
                          class="progress-bar-fill"
                          class:complete={(tx.reconciliationPercent ?? 0) >= 100}
                          style="width: {tx.reconciliationPercent ?? 0}%;"
                        ></div>
                      </div>
                      <div class="progress-info-row">
                        <span class="progress-label">Rapproché : <strong>{tx.reconciliationPercent ?? 0}%</strong> ({currency.format(tx.reconciledAmount ?? 0)} / {currency.format(tx.totalAmount ?? Math.abs(tx.amount))})</span>
                        {#if (tx.remainingAmount ?? 0) > 0}
                          <span class="progress-remaining">Reste : <strong>{currency.format(tx.remainingAmount ?? 0)}</strong></span>
                        {/if}
                      </div>
                    </div>
                  </div>

                  <div class="tx-amount-col">
                    <span class="tx-amount" class:income={Number(tx.amount) > 0} class:expense={Number(tx.amount) < 0}>
                      {Number(tx.amount) > 0 ? '+' : ''}{currency.format(Number(tx.amount))}
                    </span>
                    <button
                      type="button"
                      draggable="false"
                      class="btn btn-small pair-btn"
                      class:btn-primary={selectedTxForPairing?.id === tx.id}
                      class:btn-secondary={selectedTxForPairing?.id !== tx.id}
                      on:click|stopPropagation={() => selectTxForPairing(tx)}
                      title="Sélectionner cette opération pour l'associer en 1 clic à une facture"
                    >
                      {selectedTxForPairing?.id === tx.id ? 'Sélectionnée ✓' : 'Associer'}
                    </button>
                  </div>
                </div>
              {/each}
            {/if}
          </div>
        </div>

        <!-- COLONNE DROITE : Factures non rapprochées à 100% -->
        <div class="drag-column invoices-column" class:has-drag-active={Boolean(draggedTx)}>
          <div class="column-header">
            <div class="column-title">
              <Icon name="invoice" size={20} />
              <h4>Factures & justificatifs à rapprocher</h4>
              <span class="count-tag">{filteredInvoices.length}</span>
            </div>
            <input
              type="search"
              bind:value={searchInv}
              placeholder="Filtrer les factures (fournisseur, n°, montant)…"
              class="column-search"
            />
          </div>

          <div class="cards-scroller">
            {#if !filteredInvoices.length}
              <div class="empty-column">
                <Icon name="check" size={28} />
                <p>Toutes les factures enregistrées ont été rapprochées à 100% !</p>
              </div>
            {:else}
              {#each filteredInvoices as inv (inv.id)}
                <div
                  class="invoice-card"
                  class:drop-hover={String(hoveredInvoiceId) === String(inv.id)}
                  class:clickable-for-pair={Boolean(selectedTxForPairing)}
                  data-invoice-id={inv.id}
                  on:dragover={(e) => handleDragOver(e, inv)}
                  on:dragenter={(e) => handleDragEnter(e, inv)}
                  on:dragleave={(e) => handleDragLeave(e, inv)}
                  on:drop={(e) => handleDrop(e, inv)}
                  on:click={() => handleInvoiceClick(inv)}
                  role="region"
                  aria-label="Zone d'association pour rapprochement"
                >
                  <div class="invoice-top">
                    <div>
                      {#if isInvoiceIncome(inv)}
                        <strong class="inv-supplier">{inv.recipient || inv.supplier || 'Client inconnu'}</strong>
                      {:else}
                        <strong class="inv-supplier">{inv.supplier || inv.recipient || 'Fournisseur inconnu'}</strong>
                      {/if}
                      {#if inv.number}
                        <span class="inv-num">N° {inv.number}</span>
                      {/if}
                    </div>
                    <span class="inv-amount" class:income={isInvoiceIncome(inv)} class:expense={!isInvoiceIncome(inv)}>
                      {isInvoiceIncome(inv) ? '+' : ''}{currency.format(inv.totalTtc ?? inv.total ?? 0)}
                    </span>
                  </div>

                  <div class="invoice-meta">
                    <span class="inv-date">{formatDate(inv.date)}</span>
                    {#if isInvoiceIncome(inv)}
                      <span class="badge-mini badge-green">📤 Émise (Recette)</span>
                    {:else}
                      <span class="badge-mini badge-blue">📥 Reçue (Dépense)</span>
                    {/if}
                    {#if (inv.reconciliationPercent ?? 0) > 0}
                      <span class="badge-mini badge-blue">Rapproché ({inv.reconciliationPercent}%)</span>
                    {:else}
                      <span class="badge-mini subtle">Non rapprochée (0%)</span>
                    {/if}
                    {#if (inv.remainingAllocationAmount ?? inv.remainingAmount ?? 0) <= 0}
                      <span class="badge-mini badge-green">Ventilation complète</span>
                    {/if}
                  </div>

                  <!-- Barre de progression du rapprochement de la facture -->
                  <div class="progress-wrap">
                    <div class="progress-bar-track" title="Taux de rapprochement : {inv.reconciliationPercent ?? 0}%">
                      <div
                        class="progress-bar-fill"
                        class:complete={(inv.reconciliationPercent ?? 0) >= 100}
                        style="width: {inv.reconciliationPercent ?? 0}%;"
                      ></div>
                    </div>
                    <div class="progress-info-row">
                      <span class="progress-label">Rapproché : <strong>{inv.reconciliationPercent ?? 0}%</strong> ({currency.format(inv.reconciledAmount ?? 0)} / {currency.format(inv.totalAmount ?? inv.totalTtc ?? inv.total ?? 0)})</span>
                      {#if (inv.remainingAmount ?? 0) > 0}
                        <span class="progress-remaining">{isInvoiceIncome(inv) ? 'Reste à encaisser :' : 'Reste à payer :'} <strong class={isInvoiceIncome(inv) ? 'income-text' : 'expense-text'}>{currency.format(inv.remainingAmount ?? 0)}</strong></span>
                      {/if}
                    </div>
                  </div>

                  <div class="drop-zone-indicator">
                    {#if String(hoveredInvoiceId) === String(inv.id)}
                      <span class="drop-ready">🎯 Relâchez pour rapprocher avec cette facture</span>
                    {:else if selectedTxForPairing}
                      <span class="click-ready">👉 Cliquez pour associer avec « {selectedTxForPairing.description || selectedTxForPairing.label} »</span>
                    {:else}
                      <span class="drop-target-text">Glissez une opération ici ou cliquez « Associer »</span>
                    {/if}
                  </div>
                </div>
              {/each}
            {/if}
          </div>
        </div>
      </div>
    </AsyncState>
  </section>

  <!-- Section 2 : Rapprochements terminés (EN-DESSOUS) -->
  <section class="reconciliation-completed-section">
    <div class="section-title-wrap">
      <div>
        <h3>Rapprochements effectués ({reconciledPairs.length} liaisons)</h3>
        <p class="section-subtitle">Historique des paiements et factures associés (paiements uniques ou multiples).</p>
      </div>
    </div>

    <!-- Navigation par exercice comptable (N-1, N, N+1) -->
    <FiscalYearNav
      bind:fiscalStartDay
      bind:fiscalStartMonth
      bind:fiscalOffset
      bind:mode={periodMode}
      bind:filterStartDate
      bind:filterEndDate
      itemCount={filteredReconciledPairs.length}
      itemLabel="liaisons"
      allowCustomDates={true}
    />

    {#if !filteredReconciledPairs.length}
      <div class="panel empty-reconciled">
        <Icon name="link" size={32} />
        <p>{reconciledPairs.length ? 'Aucun rapprochement ne correspond à la période sélectionnée.' : 'Aucun rapprochement n\'a encore été effectué. Glissez une opération bancaire sur une facture ou cliquez sur « Associer » pour démarrer.'}</p>
        {#if reconciledPairs.length && (filterStartDate || filterEndDate)}
          <button type="button" class="btn btn-secondary btn-small" on:click={() => { periodMode = 'all'; filterStartDate = ''; filterEndDate = ''; }}>Afficher tout l'historique</button>
        {/if}
      </div>
    {:else}
      <div class="panel table-panel">
        <div class="table-wrap">
          <table class="reconciled-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Opération bancaire (cliquer)</th>
                <th>Montant lié</th>
                <th>Facture associée (cliquer)</th>
                <th>Total facture</th>
                <th>Compte</th>
                <th class="align-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {#each filteredReconciledPairs as pair (pair.reconciliation_id || `${pair.invoice_id}_${pair.transaction_id}`)}
                <tr>
                  <td data-label="Date">{formatDate(pair.transaction_date)}</td>
                  <td data-label="Opération" class="clickable-cell" on:click={() => openTxDetail(pair)} title="Cliquer pour afficher tous les détails de cette opération">
                    <div class="cell-link-title">
                      <strong class="clickable-title">{pair.transaction_description}</strong>
                      <span class="cell-info-icon" title="Voir détails">ℹ️</span>
                    </div>
                    <div class="table-badges">
                      {#if pair.transaction_payment_method}
                        <span class="badge-mini">{paymentLabel(pair.transaction_payment_method)}</span>
                      {/if}
                      {#if (pair.transaction_reconciliation_percent ?? 100) >= 100}
                        <span class="badge-mini badge-green">Opération 100%</span>
                      {:else}
                        <span class="badge-mini badge-blue">{pair.transaction_reconciliation_percent}% lié</span>
                      {/if}
                    </div>
                  </td>
                  <td data-label="Montant lié" class="amount" class:expense={Number(pair.reconciled_amount || pair.transaction_amount) < 0} class:income={Number(pair.reconciled_amount || pair.transaction_amount) > 0}>
                    <strong>{Number(pair.reconciled_amount || pair.transaction_amount) > 0 ? '+' : ''}{currency.format(Number(pair.reconciled_amount || Math.abs(Number(pair.transaction_amount))))}</strong>
                  </td>
                  <td data-label="Facture" class="clickable-cell" on:click={() => openInvDetail(pair)} title="Cliquer pour afficher tous les détails et le justificatif">
                    <div class="cell-link-title">
                      <strong class="clickable-title">{pair.invoice_supplier || pair.invoice_recipient || 'Facture'}</strong>
                      <span class="cell-info-icon" title="Voir justificatif">ℹ️</span>
                    </div>
                    {#if pair.invoice_number}
                      <small>N° {pair.invoice_number}</small>
                    {/if}
                    <div class="table-badges">
                      {#if isInvoiceIncome(pair)}
                        <span class="badge-mini badge-green">📤 Émise (Recette)</span>
                      {:else}
                        <span class="badge-mini badge-blue">📥 Reçue (Dépense)</span>
                      {/if}
                      {#if (pair.invoice_reconciliation_percent ?? 100) >= 100}
                        <span class="badge-mini badge-green">Facture solde 100%</span>
                      {:else}
                        <span class="badge-mini badge-blue">{pair.invoice_reconciliation_percent}% payé</span>
                      {/if}
                    </div>
                  </td>
                  <td data-label="Total facture" class="amount" class:income={isInvoiceIncome(pair)} class:expense={!isInvoiceIncome(pair)}>
                    {isInvoiceIncome(pair) ? '+' : ''}{currency.format(Number(pair.invoice_total_ttc ?? 0))}
                  </td>
                  <td data-label="Compte">
                    <small>{pair.account_name || '—'}</small>
                  </td>
                  <td data-label="Action" class="align-center">
                    <button
                      class="btn btn-secondary btn-small danger-outline"
                      title="Annuler ce rapprochement entre cette facture et cette opération"
                      on:click={() => promptUnmatch(pair)}
                    >
                      <Icon name="close" size={14} /> Dissocier
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/if}
  </section>
</div>

<!-- MODALE DE CONFIRMATION DE RAPPROCHEMENT -->
{#if confirmModalOpen && selectedTx && selectedInv}
  <div class="capture-layer" role="presentation">
    <button class="backdrop" aria-label="Fermer" on:click={closeConfirmModal}></button>
    <div class="capture-modal confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-match-title">
      <header class="capture-header">
        <div>
          <span class="eyebrow">Validation</span>
          <h2 id="confirm-match-title">Vérifier le rapprochement</h2>
        </div>
        <button class="icon-button" aria-label="Fermer" on:click={closeConfirmModal}>
          <Icon name="close" />
        </button>
      </header>

      <div class="capture-content">
        <p>Veuillez vérifier les informations ci-dessous avant d'approuver l'association de l'opération bancaire avec la facture.</p>

        {#if submitError}
          <div class="alert" role="alert">
            <Icon name="alert" size={18} />
            <span>{submitError}</span>
          </div>
        {/if}

        <div class="comparison-cards">
          <!-- Carte Opération Bancaire -->
          <div class="compare-card compare-tx">
            <div class="compare-header">
              <Icon name="transfer" size={18} />
              <h4>Opération bancaire</h4>
            </div>
            <dl class="compare-details">
              <div>
                <dt>Date</dt>
                <dd>{formatDate(selectedTx.date)}</dd>
              </div>
              <div>
                <dt>Description</dt>
                <dd><strong>{selectedTx.description || selectedTx.label}</strong></dd>
              </div>
              {#if selectedTx.bank_label}
                <div>
                  <dt>Libellé banque</dt>
                  <dd><small>{selectedTx.bank_label}</small></dd>
                </div>
              {/if}
              <div>
                <dt>Paiement</dt>
                <dd>{paymentLabel(selectedTx.payment_method)}</dd>
              </div>
              <div>
                <dt>Montant total</dt>
                <dd class="compare-amount" class:income={Number(selectedTx.amount) > 0} class:expense={Number(selectedTx.amount) < 0}>
                  {Number(selectedTx.amount) > 0 ? '+' : ''}{currency.format(Number(selectedTx.amount))}
                </dd>
              </div>
              {#if (selectedTx.remainingAmount ?? Math.abs(Number(selectedTx.amount))) !== Math.abs(Number(selectedTx.amount))}
                <div>
                  <dt>Reste à rapprocher</dt>
                  <dd><strong>{currency.format(Number(selectedTx.remainingAmount))}</strong></dd>
                </div>
              {/if}
            </dl>
          </div>

          <!-- Lien visuel -->
          <div class="compare-separator">
            <span class="link-circle">
              <Icon name="link" size={20} />
            </span>
          </div>

          <!-- Carte Facture -->
          <div class="compare-card compare-inv">
            <div class="compare-header">
              <Icon name="invoice" size={18} />
              <h4>{isInvoiceIncome(selectedInv) ? 'Facture émise (Recette)' : 'Facture reçue (Dépense)'}</h4>
            </div>
            <dl class="compare-details">
              <div>
                <dt>{isInvoiceIncome(selectedInv) ? 'Client / Destinataire' : 'Fournisseur / Prestataire'}</dt>
                <dd><strong>{isInvoiceIncome(selectedInv) ? (selectedInv.recipient || selectedInv.supplier || '—') : (selectedInv.supplier || selectedInv.recipient || '—')}</strong></dd>
              </div>
              <div>
                <dt>N° de facture</dt>
                <dd>{selectedInv.number || '—'}</dd>
              </div>
              <div>
                <dt>Date facture</dt>
                <dd>{formatDate(selectedInv.date)}</dd>
              </div>
              <div>
                <dt>Montant TTC</dt>
                <dd class="compare-amount" class:income={isInvoiceIncome(selectedInv)} class:expense={!isInvoiceIncome(selectedInv)}>
                  {isInvoiceIncome(selectedInv) ? '+' : ''}{currency.format(selectedInv.totalTtc ?? selectedInv.total ?? 0)}
                </dd>
              </div>
              {#if (selectedInv.remainingAmount ?? Math.abs(Number(selectedInv.totalTtc ?? selectedInv.total ?? 0))) !== Math.abs(Number(selectedInv.totalTtc ?? selectedInv.total ?? 0))}
                <div>
                  <dt>Solde restant {isInvoiceIncome(selectedInv) ? 'à encaisser' : 'à régler'}</dt>
                  <dd><strong class={isInvoiceIncome(selectedInv) ? 'income-text' : 'expense-text'}>{currency.format(Number(selectedInv.remainingAmount))}</strong></dd>
                </div>
              {/if}
            </dl>
          </div>
        </div>

        <!-- Cohérence du sens financier (dépense vs recette) -->
        {#if (Number(selectedTx.amount) < 0 && isInvoiceIncome(selectedInv))}
          <div class="match-check warning">
            <Icon name="alert" size={18} />
            <span>⚠️ <strong>Sens financier inverse :</strong> L’opération bancaire est un débit (dépense) mais la facture est de type <strong>Émise (Recette)</strong>. Veuillez vérifier qu’il s’agit bien du document souhaité.</span>
          </div>
        {:else if (Number(selectedTx.amount) > 0 && !isInvoiceIncome(selectedInv))}
          <div class="match-check warning">
            <Icon name="alert" size={18} />
            <span>⚠️ <strong>Sens financier inverse :</strong> L’opération bancaire est un crédit (recette) mais la facture est de type <strong>Reçue (Dépense)</strong>. Veuillez vérifier qu’il s’agit bien du document souhaité.</span>
          </div>
        {/if}

        <!-- Concordance des montants -->
        {#if Math.abs(Number(selectedTx.amount)) === Math.abs(Number(selectedInv.totalTtc ?? selectedInv.total ?? 0))}
          <div class="match-check success">
            <Icon name="check" size={18} />
            <span>Les montants totaux correspondent ({currency.format(Math.abs(Number(selectedTx.amount)))}).</span>
          </div>
        {:else}
          <div class="match-check warning">
            <Icon name="alert" size={18} />
            <span>
              Les montants totaux diffèrent ({currency.format(Math.abs(Number(selectedTx.amount)))} vs {currency.format(Math.abs(Number(selectedInv.totalTtc ?? selectedInv.total ?? 0)))}). Vous pouvez effectuer un rapprochement partiel ci-dessous.
            </span>
          </div>
        {/if}

        <!-- Sélecteur de montant de rapprochement (multi-paiements / partiel) -->
        <div class="reconciliation-amount-selector">
          <label for="rec-amount-input" class="amount-field-label">
            <strong>Montant de ce règlement à rapprocher (€) *</strong>
          </label>
          <div class="amount-input-row">
            <input
              id="rec-amount-input"
              class="amount-input"
              type="number"
              step="0.01"
              min="0.01"
              max={maxReconciliationAmount}
              bind:value={reconciliationAmount}
              required
            />
            <span class="amount-currency">€</span>
            <button
              type="button"
              class="btn btn-secondary btn-small"
              on:click={() => reconciliationAmount = Number(maxReconciliationAmount.toFixed(2))}
            >
              Maximum ({currency.format(maxReconciliationAmount)})
            </button>
          </div>
          <small class="amount-tip">
            Plafond calculé disponible pour cette liaison : <strong>{currency.format(maxReconciliationAmount)}</strong>.
            {#if Number(reconciliationAmount) < Number(selectedInv.remainingAmount ?? selectedInv.totalTtc ?? 0)}
              <br /><span class="tip-multi">ℹ️ Ce paiement est partiel. La facture restera disponible dans la liste avec sa barre d'avancement actualisée pour les prochains règlements.</span>
            {/if}
          </small>
        </div>

        <div class="capture-actions">
          <button type="button" class="btn btn-secondary" on:click={closeConfirmModal} disabled={submitting}>
            Annuler
          </button>
          <button type="button" class="btn btn-primary" on:click={approveReconciliation} disabled={submitting}>
            {submitting ? 'Validation en cours…' : 'Approuver le rapprochement'}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- MODALE DE DISSOCIATION -->
{#if unmatchModalOpen && pairToUnmatch}
  <div class="capture-layer" role="presentation">
    <button class="backdrop" aria-label="Fermer" on:click={closeUnmatchModal}></button>
    <div class="capture-modal modal-small" role="dialog" aria-modal="true" aria-labelledby="unmatch-title">
      <header class="capture-header">
        <div>
          <span class="eyebrow">Rapprochement</span>
          <h2 id="unmatch-title">Dissocier le rapprochement</h2>
        </div>
        <button class="icon-button" aria-label="Fermer" on:click={closeUnmatchModal}>
          <Icon name="close" />
        </button>
      </header>
      <div class="capture-content">
        <p>
          Êtes-vous sûr de vouloir dissocier l’opération <strong>{pairToUnmatch.transaction_description}</strong> de la facture <strong>{pairToUnmatch.invoice_supplier || 'Fournisseur'}</strong> ?
        </p>
        <p class="subtle-note">
          L’opération et la facture redeviendront disponibles dans la liste des rapprochements à effectuer.
        </p>
        <div class="capture-actions">
          <button type="button" class="btn btn-secondary" on:click={closeUnmatchModal} disabled={unmatching}>
            Annuler
          </button>
          <button type="button" class="btn btn-primary danger-btn" on:click={confirmUnmatch} disabled={unmatching}>
            {unmatching ? 'Dissociation…' : 'Confirmer la dissociation'}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- MODALE DÉTAILS OPÉRATION BANCAIRE -->
{#if detailTxPair}
  <div class="capture-layer" role="presentation">
    <button class="backdrop" aria-label="Fermer" on:click={closeTxDetail}></button>
    <div class="capture-modal modal-small" role="dialog" aria-modal="true" aria-labelledby="tx-detail-title">
      <header class="capture-header">
        <div>
          <span class="eyebrow">Détails de l’opération</span>
          <h2 id="tx-detail-title">{detailTxPair.transaction_description}</h2>
        </div>
        <button class="icon-button" aria-label="Fermer" on:click={closeTxDetail}>
          <Icon name="close" />
        </button>
      </header>
      <div class="capture-content">
        <dl class="compare-details detail-list">
          <div>
            <dt>Date de l’opération</dt>
            <dd>{formatDate(detailTxPair.transaction_date)}</dd>
          </div>
          <div>
            <dt>Libellé / Description</dt>
            <dd><strong>{detailTxPair.transaction_description}</strong></dd>
          </div>
          {#if detailTxPair.transaction_bank_label}
            <div>
              <dt>Libellé bancaire brut</dt>
              <dd><small>{detailTxPair.transaction_bank_label}</small></dd>
            </div>
          {/if}
          <div>
            <dt>Compte bancaire</dt>
            <dd>{detailTxPair.account_name || 'Compte bancaire'}</dd>
          </div>
          <div>
            <dt>Moyen de paiement</dt>
            <dd>{paymentLabel(detailTxPair.transaction_payment_method)}</dd>
          </div>
          <div>
            <dt>Montant total</dt>
            <dd class="compare-amount" class:income={Number(detailTxPair.transaction_amount) > 0} class:expense={Number(detailTxPair.transaction_amount) < 0}>
              {Number(detailTxPair.transaction_amount) > 0 ? '+' : ''}{currency.format(Number(detailTxPair.transaction_amount))}
            </dd>
          </div>
          <div>
            <dt>Montant lié à cette facture</dt>
            <dd><strong>{currency.format(Number(detailTxPair.reconciled_amount || Math.abs(Number(detailTxPair.transaction_amount))))}</strong></dd>
          </div>
          <div>
            <dt>Avancement du rapprochement</dt>
            <dd>
              <span class="soft-badge">
                {detailTxPair.transaction_reconciliation_percent ?? 100}% rapproché
              </span>
            </dd>
          </div>
          {#if detailTxPair.reconciled_at}
            <div>
              <dt>Date du rapprochement</dt>
              <dd><small>{formatDate(detailTxPair.reconciled_at)}</small></dd>
            </div>
          {/if}
        </dl>
        <div class="capture-actions">
          <button type="button" class="btn btn-primary" on:click={closeTxDetail}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- MODALE DÉTAILS FACTURE ET JUSTIFICATIF -->
{#if detailInvPair}
  <div class="capture-layer" role="presentation">
    <button class="backdrop" aria-label="Fermer" on:click={closeInvDetail}></button>
    <div class="capture-modal confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="inv-detail-title">
      <header class="capture-header">
        <div>
          <span class="eyebrow">Détails de la facture</span>
          <h2 id="inv-detail-title">
            {detailInvPair.invoice_supplier || detailInvPair.invoice_recipient || 'Facture'}
            {#if detailInvPair.invoice_number} — N° {detailInvPair.invoice_number}{/if}
          </h2>
        </div>
        <button class="icon-button" aria-label="Fermer" on:click={closeInvDetail}>
          <Icon name="close" />
        </button>
      </header>
      <div class="capture-content">
        <div class="detail-inv-layout">
          <dl class="compare-details detail-list">
            <div>
              <dt>Nature</dt>
              <dd>
                {#if isInvoiceIncome(detailInvPair)}
                  <span class="badge-mini badge-green">📤 Facture émise (Recette)</span>
                {:else}
                  <span class="badge-mini badge-blue">📥 Facture reçue (Dépense)</span>
                {/if}
              </dd>
            </div>
            <div>
              <dt>{isInvoiceIncome(detailInvPair) ? 'Client / Destinataire' : 'Fournisseur / Émetteur'}</dt>
              <dd><strong>{detailInvPair.invoice_supplier || detailInvPair.invoice_recipient || '—'}</strong></dd>
            </div>
            {#if detailInvPair.invoice_number}
              <div>
                <dt>Numéro de facture</dt>
                <dd>{detailInvPair.invoice_number}</dd>
              </div>
            {/if}
            {#if detailInvPair.invoice_date}
              <div>
                <dt>Date de la facture</dt>
                <dd>{formatDate(detailInvPair.invoice_date)}</dd>
              </div>
            {/if}
            <div>
              <dt>Total TTC</dt>
              <dd class="compare-amount" class:income={isInvoiceIncome(detailInvPair)} class:expense={!isInvoiceIncome(detailInvPair)}>
                {isInvoiceIncome(detailInvPair) ? '+' : ''}{currency.format(Number(detailInvPair.invoice_total_ttc ?? 0))}
              </dd>
            </div>
            <div>
              <dt>Montant réglé dans cette liaison</dt>
              <dd><strong>{currency.format(Number(detailInvPair.reconciled_amount || detailInvPair.invoice_total_ttc || 0))}</strong></dd>
            </div>
            <div>
              <dt>Statut de rapprochement</dt>
              <dd>
                <span class="soft-badge">
                  {detailInvPair.invoice_reconciliation_percent ?? 100}% payé
                </span>
              </dd>
            </div>
          </dl>

          {#if detailInvPair.document_id}
            <div class="detail-preview-box">
              <h4>Aperçu du justificatif</h4>
              {#if docPreviewLoading}
                <div class="state" role="status"><span class="spinner"></span><p>Chargement du document…</p></div>
              {:else if docPreviewError}
                <div class="alert" role="alert"><Icon name="alert" size={18}/><span>{docPreviewError}</span></div>
              {:else if docPreviewUrl}
                <div class="doc-preview-container">
                  {#if docPreviewMime === 'application/pdf'}
                    <object data={docPreviewUrl} type="application/pdf" aria-label="Aperçu du document" class="doc-embed-obj">
                      <p>Aperçu PDF indisponible.</p>
                    </object>
                  {:else}
                    <img src={docPreviewUrl} alt="Justificatif de facture" class="doc-preview-img" />
                  {/if}
                </div>
                <div class="preview-actions-row">
                  <a href={docPreviewUrl} target="_blank" rel="noopener" class="btn btn-secondary btn-small">
                    Ouvrir en plein écran
                  </a>
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <div class="capture-actions">
          <button type="button" class="btn btn-primary" on:click={closeInvDetail}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .reconciliation-pending-section {
    margin-bottom: 2.5rem;
  }
  .section-title-wrap {
    margin-bottom: 1rem;
  }
  .section-subtitle {
    margin: 0.25rem 0 0;
    color: var(--text-muted, #64748b);
    font-size: 0.92rem;
  }
  .drag-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
  }
  @media (max-width: 900px) {
    .drag-grid {
      grid-template-columns: 1fr;
    }
  }
  .drag-column {
    background: #ffffff;
    border: 1px solid var(--border-color, #e2e8f0);
    border-radius: 12px;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    box-shadow: 0 1px 3px rgba(0,0,0,0.03);
  }
  .column-header {
    margin-bottom: 1rem;
  }
  .column-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .column-title h4 {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 600;
  }
  .count-tag {
    background: #f1f5f9;
    color: #475569;
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.15rem 0.5rem;
    border-radius: 99px;
  }
  .column-search {
    width: 100%;
    padding: 0.45rem 0.75rem;
    border: 1px solid var(--border-color, #cbd5e1);
    border-radius: 8px;
    font-size: 0.85rem;
  }
  .cards-scroller {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-height: 520px;
    overflow-y: auto;
    padding-right: 0.25rem;
  }
  .empty-column {
    padding: 2.5rem 1rem;
    text-align: center;
    color: #94a3b8;
  }
  .empty-column p {
    margin: 0.5rem 0 0;
    font-size: 0.9rem;
  }

  .pairing-active-banner {
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 10px;
    padding: 0.75rem 1.25rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1.25rem;
  }
  .pairing-banner-info {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.92rem;
    color: #1e3a8a;
  }

  /* Carte transaction */
  .tx-card {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 0.75rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    user-select: none;
    -webkit-user-select: none;
    -webkit-user-drag: element;
    cursor: grab;
    transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;
  }
  .tx-card:active {
    cursor: grabbing;
  }
  .tx-card:hover {
    border-color: #3b82f6;
    background: #ffffff;
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.08);
  }
  .tx-card.is-pairing-selected {
    border-color: #2563eb;
    background: #eff6ff;
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.25);
  }
  .tx-card.is-dragging {
    opacity: 0.45;
    border-color: #3b82f6;
    background: #eff6ff;
  }
  .card-drag-handle {
    display: flex;
    flex-direction: column;
    align-items: center;
    color: #94a3b8;
    cursor: grab;
    padding: 0.25rem 0.4rem;
    border-radius: 6px;
    user-select: none;
    border: none;
    background: transparent;
  }
  .card-drag-handle:hover {
    background: #e2e8f0;
    color: #1e293b;
  }
  .drag-grip {
    font-size: 1.1rem;
    line-height: 1;
    letter-spacing: -2px;
  }
  .tx-date {
    font-size: 0.75rem;
    color: #64748b;
    margin-top: 0.25rem;
  }
  .tx-body {
    flex: 1;
    min-width: 0;
  }
  .tx-desc {
    display: block;
    font-size: 0.9rem;
    color: #1e293b;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tx-sub {
    display: block;
    font-size: 0.75rem;
    color: #64748b;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tx-meta {
    display: flex;
    gap: 0.35rem;
    margin-top: 0.35rem;
  }
  .tx-amount-col {
    text-align: right;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }
  .tx-amount {
    font-weight: 700;
    font-size: 0.95rem;
    display: block;
  }
  .tx-amount.income {
    color: #15803d;
  }
  .tx-amount.expense {
    color: #b91c1c;
  }
  .pair-btn {
    margin-top: 0.3rem;
    font-size: 0.75rem;
    padding: 0.2rem 0.55rem;
  }

  /* Carte facture drop-zone */
  .invoice-card {
    background: #ffffff;
    border: 2px dashed #cbd5e1;
    border-radius: 10px;
    padding: 0.85rem;
    transition: all 0.2s ease;
  }
  .invoice-card.drop-hover {
    border-color: #2563eb;
    background: #eff6ff;
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
    transform: scale(1.01);
  }
  .has-drag-active .invoice-card * {
    pointer-events: none !important;
  }
  .invoice-card.clickable-for-pair {
    cursor: pointer;
    border-color: #3b82f6;
    background: #f8fafc;
  }
  .invoice-card.clickable-for-pair:hover {
    background: #eff6ff;
    border-color: #1d4ed8;
    box-shadow: 0 4px 12px rgba(37, 99, 235, 0.12);
    transform: translateY(-1px);
  }
  .click-ready {
    font-size: 0.82rem;
    font-weight: 600;
    color: #2563eb;
  }
  .invoice-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }
  .inv-supplier {
    font-size: 0.95rem;
    color: #0f172a;
    display: block;
  }
  .inv-num {
    font-size: 0.78rem;
    color: #64748b;
  }
  .inv-amount {
    font-weight: 700;
    font-size: 1rem;
    color: #0f172a;
  }
  .inv-amount.income {
    color: #15803d;
  }
  .inv-amount.expense {
    color: #b91c1c;
  }
  .invoice-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.4rem 0;
  }
  .inv-date {
    font-size: 0.8rem;
    color: #64748b;
  }
  .drop-zone-indicator {
    border-top: 1px solid #f1f5f9;
    padding-top: 0.4rem;
    text-align: center;
  }
  .drop-target-text {
    font-size: 0.75rem;
    color: #94a3b8;
  }
  .drop-ready {
    font-size: 0.8rem;
    font-weight: 600;
    color: #2563eb;
  }

  /* Badges */
  .badge-mini {
    display: inline-block;
    padding: 0.15rem 0.45rem;
    border-radius: 6px;
    font-size: 0.72rem;
    font-weight: 600;
    background: #f1f5f9;
    color: #334155;
  }
  .badge-mini.subtle {
    background: #f8fafc;
    color: #64748b;
    border: 1px solid #e2e8f0;
  }
  .badge-mini.badge-green {
    background: #dcfce7;
    color: #15803d;
  }
  .badge-mini.badge-blue {
    background: #dbeafe;
    color: #1d4ed8;
  }


  /* Modale comparaison */
  .confirm-dialog {
    max-width: 680px;
    width: 100%;
  }
  .modal-small {
    max-width: 480px;
    width: 100%;
  }
  .comparison-cards {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 1rem;
    align-items: center;
    margin: 1.25rem 0;
  }
  @media (max-width: 640px) {
    .comparison-cards {
      grid-template-columns: 1fr;
    }
    .compare-separator {
      transform: rotate(90deg);
    }
  }
  .compare-card {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 1rem;
  }
  .compare-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
    color: #1e293b;
  }
  .compare-header h4 {
    margin: 0;
    font-size: 0.95rem;
  }
  .compare-details dt {
    font-size: 0.75rem;
    color: #64748b;
    margin-top: 0.4rem;
  }
  .compare-details dd {
    margin: 0;
    font-size: 0.88rem;
    color: #0f172a;
  }
  .compare-amount {
    font-weight: 700;
    font-size: 1.05rem;
    color: #0f172a;
  }
  .compare-amount.income {
    color: #15803d;
  }
  .compare-amount.expense {
    color: #b91c1c;
  }
  .income-text {
    color: #15803d;
  }
  .expense-text {
    color: #b91c1c;
  }
  .amount.income {
    color: #15803d;
  }
  .amount.expense {
    color: #b91c1c;
  }
  .compare-separator {
    display: flex;
    justify-content: center;
  }
  .link-circle {
    background: #eff6ff;
    color: #2563eb;
    border: 2px solid #bfdbfe;
    width: 38px;
    height: 38px;
    border-radius: 99px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .match-check {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border-radius: 8px;
    font-size: 0.88rem;
    margin-bottom: 1.25rem;
  }
  .match-check.success {
    background: #f0fdf4;
    color: #15803d;
    border: 1px solid #bbf7d0;
  }
  .match-check.warning {
    background: #fffbeb;
    color: #b45309;
    border: 1px solid #fde68a;
  }

  .subtle-note {
    font-size: 0.85rem;
    color: #64748b;
  }
  .danger-outline {
    color: #b91c1c;
    border-color: #fca5a5;
  }
  .danger-outline:hover {
    background: #fef2f2;
  }
  .danger-btn {
    background: #dc2626 !important;
  }
  .empty-reconciled {
    padding: 3rem 1.5rem;
    text-align: center;
    color: #94a3b8;
  }
  .empty-reconciled p {
    margin: 0.75rem 0 0;
  }
  .align-center {
    text-align: center;
  }

  /* Barres de progression et métriques % */
  .progress-wrap {
    margin-top: 0.6rem;
  }
  .progress-bar-track {
    width: 100%;
    height: 6px;
    background: #e2e8f0;
    border-radius: 99px;
    overflow: hidden;
  }
  .progress-bar-fill {
    height: 100%;
    background: #3b82f6;
    border-radius: 99px;
    transition: width 0.3s ease;
  }
  .progress-bar-fill.complete {
    background: #10b981;
  }
  .progress-info-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.74rem;
    margin-top: 0.25rem;
    color: #64748b;
  }
  .progress-label {
    font-weight: 600;
  }
  .progress-remaining {
    color: #b45309;
    font-weight: 500;
  }

  /* Sélecteur de montant pour paiements partiels / multiples */
  .reconciliation-amount-selector {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 1rem;
    margin-bottom: 1.25rem;
  }
  .amount-field-label {
    display: block;
    font-size: 0.85rem;
    font-weight: 600;
    color: #1e293b;
    margin-bottom: 0.5rem;
  }
  .amount-input-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .amount-input {
    flex: 1;
    padding: 0.5rem 0.75rem;
    font-size: 1rem;
    font-weight: 600;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    background: #ffffff;
  }
  .amount-input:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }
  .amount-currency {
    font-size: 0.95rem;
    font-weight: 600;
    color: #64748b;
  }
  .amount-tip {
    display: block;
    font-size: 0.8rem;
    color: #64748b;
    margin-top: 0.5rem;
    line-height: 1.4;
  }
  .tip-multi {
    color: #0284c7;
  }
  .table-badges {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }


  /* Clickable cells */
  .clickable-cell {
    cursor: pointer;
    transition: background-color 0.15s ease;
  }
  .clickable-cell:hover {
    background-color: #f1f7f4;
  }
  .cell-link-title {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .clickable-title {
    color: var(--ink);
    transition: color 0.15s ease;
  }
  .clickable-cell:hover .clickable-title {
    color: var(--green);
    text-decoration: underline;
  }
  .cell-info-icon {
    font-size: 0.82rem;
    opacity: 0.6;
    transition: opacity 0.15s ease;
  }
  .clickable-cell:hover .cell-info-icon {
    opacity: 1;
  }

  /* Detail modal layouts */
  .detail-inv-layout {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .detail-preview-box {
    background: #f8faf9;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 1rem;
  }
  .detail-preview-box h4 {
    margin: 0 0 0.75rem 0;
    font-size: 0.95rem;
    color: var(--ink);
  }
  .doc-preview-container {
    max-height: 420px;
    overflow: auto;
    border-radius: 8px;
    border: 1px solid #cbd5e1;
    background: white;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 0.5rem;
  }
  .doc-preview-img {
    max-width: 100%;
    height: auto;
    border-radius: 6px;
    object-fit: contain;
  }
  .doc-embed-obj {
    width: 100%;
    min-height: 380px;
    border: none;
  }
  .preview-actions-row {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.6rem;
  }
  .detail-list {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.75rem 1.25rem;
  }
  @media (max-width: 640px) {
    .detail-list {
      grid-template-columns: 1fr;
    }
  }
</style>
