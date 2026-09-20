<script lang="ts">
  import { onMount } from 'svelte';
  import AsyncState from '../components/AsyncState.svelte';
  import Icon from '../components/Icon.svelte';
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

  let draggedTx: Transaction | null = null;
  let hoveredInvoiceId: string | number | null = null;

  let confirmModalOpen = false;
  let selectedTx: Transaction | null = null;
  let selectedInv: Invoice | null = null;
  let submitting = false;
  let submitError = '';
  let successNotice = '';

  // Modal de dissociation
  let unmatchModalOpen = false;
  let pairToUnmatch: ReconciledPair | null = null;
  let unmatching = false;

  async function loadData() {
    loading = true;
    error = '';
    try {
      const res = await api.get<{
        unreconciledTransactions: Transaction[];
        unreconciledInvoices: Invoice[];
        reconciledPairs: ReconciledPair[];
      }>('reconciliation');
      unreconciledTransactions = res.unreconciledTransactions ?? [];
      unreconciledInvoices = res.unreconciledInvoices ?? [];
      reconciledPairs = res.reconciledPairs ?? [];
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

  function handleDragStart(event: DragEvent, tx: Transaction) {
    draggedTx = tx;
    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', String(tx.id));
      event.dataTransfer.effectAllowed = 'link';
    }
  }

  function handleDragEnd() {
    draggedTx = null;
    hoveredInvoiceId = null;
  }

  function handleDragOver(event: DragEvent, inv: Invoice) {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'link';
    }
    hoveredInvoiceId = inv.id;
  }

  function handleDragLeave(_event: DragEvent, inv: Invoice) {
    if (hoveredInvoiceId === inv.id) {
      hoveredInvoiceId = null;
    }
  }

  function handleDrop(event: DragEvent, inv: Invoice) {
    event.preventDefault();
    hoveredInvoiceId = null;
    if (draggedTx) {
      openConfirmModal(draggedTx, inv);
    }
  }

  function openConfirmModal(tx: Transaction, inv: Invoice) {
    selectedTx = tx;
    selectedInv = inv;
    submitError = '';
    confirmModalOpen = true;
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
    submitting = true;
    submitError = '';
    try {
      await api.post('reconciliation', {
        transactionId: selectedTx.id,
        invoiceId: selectedInv.id
      });
      successNotice = `Rapprochement validé avec succès entre l’opération de ${currency.format(selectedTx.amount)} et la facture de ${selectedInv.supplier || selectedInv.recipient || 'fournisseur'}.`;
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
      await api.post('reconciliation/unmatch', { invoiceId: pairToUnmatch.invoice_id });
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

  onMount(loadData);
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
          Prenez une carte d'opération à gauche et <strong>glissez-la sur la facture correspondante</strong> à droite pour valider le rapprochement.
        </p>
      </div>
    </div>

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
                <p>Aucune opération bancaire en attente de rapprochement.</p>
              </div>
            {:else}
              {#each filteredTransactions as tx (tx.id)}
                <div
                  class="tx-card"
                  class:is-dragging={draggedTx?.id === tx.id}
                  draggable="true"
                  on:dragstart={(e) => handleDragStart(e, tx)}
                  on:dragend={handleDragEnd}
                  role="button"
                  tabindex="0"
                >
                  <div class="card-drag-handle" title="Glisser cette opération vers une facture">
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
                    </div>
                  </div>
                  <div class="tx-amount-col">
                    <span class="tx-amount" class:income={Number(tx.amount) > 0} class:expense={Number(tx.amount) < 0}>
                      {currency.format(Number(tx.amount))}
                    </span>
                    <small class="drag-hint">Glisser vers facture →</small>
                  </div>
                </div>
              {/each}
            {/if}
          </div>
        </div>

        <!-- COLONNE DROITE : Factures non rapprochées (Drop zone) -->
        <div class="drag-column invoices-column">
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
                <p>Toutes les factures enregistrées ont été rapprochées !</p>
              </div>
            {:else}
              {#each filteredInvoices as inv (inv.id)}
                <div
                  class="invoice-card"
                  class:drop-hover={hoveredInvoiceId === inv.id}
                  on:dragover={(e) => handleDragOver(e, inv)}
                  on:dragleave={(e) => handleDragLeave(e, inv)}
                  on:drop={(e) => handleDrop(e, inv)}
                  role="region"
                  aria-label="Zone de dépôt pour rapprochement"
                >
                  <div class="invoice-top">
                    <div>
                      <strong class="inv-supplier">{inv.supplier || inv.recipient || 'Fournisseur inconnu'}</strong>
                      {#if inv.number}
                        <span class="inv-num">N° {inv.number}</span>
                      {/if}
                    </div>
                    <span class="inv-amount">{currency.format(inv.totalTtc ?? inv.total ?? 0)}</span>
                  </div>

                  <div class="invoice-meta">
                    <span class="inv-date">{formatDate(inv.date)}</span>
                    {#if (inv.remainingAmount ?? inv.remaining_amount ?? 0) <= 0}
                      <span class="badge-mini badge-green">Ventilation complète</span>
                    {:else if (inv.allocatedAmount ?? inv.allocated_amount ?? 0) > 0}
                      <span class="badge-mini badge-blue">Ventilation partielle</span>
                    {:else}
                      <span class="badge-mini badge-orange">Non affectée</span>
                    {/if}
                  </div>

                  <div class="drop-zone-indicator">
                    {#if hoveredInvoiceId === inv.id}
                      <span class="drop-ready">Déposez ici pour rapprocher avec cette facture</span>
                    {:else}
                      <span class="drop-target-text">Déposer une opération ici</span>
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
        <h3>Rapprochements terminés ({reconciledPairs.length})</h3>
        <p class="section-subtitle">Historique des factures et opérations bancaires validées ensemble.</p>
      </div>
    </div>

    {#if !reconciledPairs.length}
      <div class="panel empty-reconciled">
        <Icon name="link" size={32} />
        <p>Aucun rapprochement n'a encore été effectué. Glissez une opération bancaire sur une facture pour démarrer.</p>
      </div>
    {:else}
      <div class="panel table-panel">
        <div class="table-wrap">
          <table class="reconciled-table">
            <thead>
              <tr>
                <th>Date opération</th>
                <th>Opération bancaire</th>
                <th>Montant</th>
                <th>Facture associée</th>
                <th>Montant TTC</th>
                <th>Compte</th>
                <th class="align-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {#each reconciledPairs as pair (pair.invoice_id)}
                <tr>
                  <td data-label="Date">{formatDate(pair.transaction_date)}</td>
                  <td data-label="Opération">
                    <strong>{pair.transaction_description}</strong>
                    {#if pair.transaction_payment_method}
                      <span class="badge-mini">{paymentLabel(pair.transaction_payment_method)}</span>
                    {/if}
                  </td>
                  <td data-label="Montant" class="amount" class:expense={Number(pair.transaction_amount) < 0} class:income={Number(pair.transaction_amount) > 0}>
                    {currency.format(Number(pair.transaction_amount))}
                  </td>
                  <td data-label="Facture">
                    <strong>{pair.invoice_supplier || pair.invoice_recipient || 'Facture'}</strong>
                    {#if pair.invoice_number}
                      <small>N° {pair.invoice_number}</small>
                    {/if}
                  </td>
                  <td data-label="TTC" class="amount">
                    {currency.format(Number(pair.invoice_total_ttc ?? 0))}
                  </td>
                  <td data-label="Compte">
                    <small>{pair.account_name || '—'}</small>
                  </td>
                  <td data-label="Action" class="align-center">
                    <button
                      class="btn btn-secondary btn-small danger-outline"
                      title="Annuler le rapprochement entre cette facture et cette opération"
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
                <dt>Montant</dt>
                <dd class="compare-amount">{currency.format(Number(selectedTx.amount))}</dd>
              </div>
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
              <h4>Facture justificative</h4>
            </div>
            <dl class="compare-details">
              <div>
                <dt>Tiers / Fournisseur</dt>
                <dd><strong>{selectedInv.supplier || selectedInv.recipient || '—'}</strong></dd>
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
                <dt>Ventilation</dt>
                <dd>
                  {#if (selectedInv.remainingAmount ?? selectedInv.remaining_amount ?? 0) <= 0}
                    <span class="badge-mini badge-green">Complète</span>
                  {:else if (selectedInv.allocatedAmount ?? selectedInv.allocated_amount ?? 0) > 0}
                    <span class="badge-mini badge-blue">Partielle</span>
                  {:else}
                    <span class="badge-mini badge-orange">Non affectée</span>
                  {/if}
                </dd>
              </div>
              <div>
                <dt>Montant TTC</dt>
                <dd class="compare-amount">{currency.format(selectedInv.totalTtc ?? selectedInv.total ?? 0)}</dd>
              </div>
            </dl>
          </div>
        </div>

        <!-- Concordance des montants -->
        {#if Math.abs(Number(selectedTx.amount)) === Math.abs(Number(selectedInv.totalTtc ?? selectedInv.total ?? 0))}
          <div class="match-check success">
            <Icon name="check" size={18} />
            <span>Les montants correspondent parfaitement ({currency.format(Math.abs(Number(selectedTx.amount)))}).</span>
          </div>
        {:else}
          <div class="match-check warning">
            <Icon name="alert" size={18} />
            <span>
              Attention : les montants diffèrent ({currency.format(Math.abs(Number(selectedTx.amount)))} vs {currency.format(Math.abs(Number(selectedInv.totalTtc ?? selectedInv.total ?? 0)))}).
            </span>
          </div>
        {/if}

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

  /* Carte transaction draggable */
  .tx-card {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 0.75rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    cursor: grab;
    user-select: none;
    transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;
  }
  .tx-card:hover {
    border-color: #3b82f6;
    background: #ffffff;
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.08);
    transform: translateY(-1px);
  }
  .tx-card:active {
    cursor: grabbing;
  }
  .tx-card.is-dragging {
    opacity: 0.45;
  }
  .card-drag-handle {
    display: flex;
    flex-direction: column;
    align-items: center;
    color: #94a3b8;
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
  .drag-hint {
    font-size: 0.7rem;
    color: #3b82f6;
    display: block;
    margin-top: 0.2rem;
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
  .badge-mini.badge-orange {
    background: #fff7ed;
    color: #c2410c;
    border: 1px solid #fed7aa;
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
</style>
