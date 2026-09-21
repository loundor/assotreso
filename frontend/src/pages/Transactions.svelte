<script lang="ts">
  import { onMount } from 'svelte';
  import AsyncState from '../components/AsyncState.svelte';
  import Icon from '../components/Icon.svelte';
  import FiscalYearNav from '../components/FiscalYearNav.svelte';
  import { api, listFrom } from '../lib/api';
  import { currency, displayName, formatDate, getErrorMessage } from '../lib/utils';
  import type { Account, Category, Project, Transaction } from '../lib/types';

  let transactions: Transaction[] = [];
  let accounts: Account[] = [];
  let categories: Category[] = [];
  let projects: Project[] = [];
  let loading = true;
  let error = '';
  let formOpen = false;
  let saving = false;
  let formError = '';

  let filterTab: 'all' | 'income' | 'expense' = 'all';

  // Navigation par exercice comptable (N, N-1, etc.)
  let fiscalOffset = 0;
  let periodMode: 'fiscal' | 'all' | 'custom' = 'fiscal';
  let filterStartDate = '';
  let filterEndDate = '';

  function isIncome(tx: Transaction): boolean {
    return tx.direction === 'income' || Number(tx.amount) > 0;
  }

  $: periodTransactions = transactions.filter((tx) => {
    if (periodMode === 'fiscal' && filterStartDate && filterEndDate) {
      const txDate = (tx.date || '').slice(0, 10);
      if (txDate && (txDate < filterStartDate || txDate > filterEndDate)) {
        return false;
      }
    } else if (periodMode === 'custom') {
      const txDate = (tx.date || '').slice(0, 10);
      if (filterStartDate && txDate < filterStartDate) return false;
      if (filterEndDate && txDate > filterEndDate) return false;
    }
    return true;
  });

  $: incomeCount = periodTransactions.filter(isIncome).length;
  $: expenseCount = periodTransactions.filter(tx => !isIncome(tx)).length;

  $: filteredTransactions = periodTransactions.filter((tx) => {
    if (filterTab === 'income') return isIncome(tx);
    if (filterTab === 'expense') return !isIncome(tx);
    return true;
  });

  let label = '';
  let amount = 0;
  let date = new Date().toISOString().slice(0, 10);
  let direction = 'expense';
  let accountId = '';
  let categoryId = '';
  let projectId = '';
  let paymentMethod = '';
  let paymentMethodCustom = '';

  function displayPaymentMethod(val?: string | null): string {
    if (!val) return '—';
    const upper = val.toUpperCase();
    if (upper === 'CARTE' || upper === 'CB' || upper === 'CARTE BANCAIRE') return 'Carte';
    if (upper === 'CHEQUE') return 'Chèque';
    if (upper === 'VIREMENT') return 'Virement';
    if (upper === 'ESPECES' || upper === 'ESPECE') return 'Espèces';
    return val;
  }

  async function load() {
    loading = true;
    error = '';
    try {
      const [t, a, c, p] = await Promise.all([
        api.get('transactions'),
        api.get('accounts'),
        api.get('categories'),
        api.get('projects')
      ]);
      transactions = listFrom<Transaction>(t, ['transactions']);
      accounts = listFrom<Account>(a, ['accounts']);
      categories = listFrom<Category>(c, ['categories']);
      projects = listFrom<Project>(p, ['projects']);
    } catch (e) {
      error = getErrorMessage(e);
    } finally {
      loading = false;
    }
  }

  let showConfirmModal = false;

  $: finalPaymentMethod = paymentMethod === 'AUTRE'
    ? (paymentMethodCustom.trim() || 'Autre')
    : (paymentMethod || undefined);

  function promptSave() {
    formError = '';
    if (!label.trim()) {
      formError = 'Le libellé de l’opération est obligatoire.';
      return;
    }
    if (!amount || Number(amount) <= 0) {
      formError = 'Le montant doit être strictement supérieur à zéro.';
      return;
    }
    if (!date) {
      formError = 'La date de l’opération est obligatoire.';
      return;
    }
    if (!accountId) {
      formError = 'Veuillez sélectionner le compte bancaire concerné.';
      return;
    }
    showConfirmModal = true;
  }

  function cancelConfirm() {
    showConfirmModal = false;
  }

  async function confirmAndSave() {
    saving = true;
    formError = '';
    try {
      await api.post('transactions', {
        label: label.trim(),
        date,
        amount: Number(amount),
        direction,
        accountId: accountId || undefined,
        categoryId: categoryId || undefined,
        projectId: projectId || undefined,
        paymentMethod: finalPaymentMethod
      });
      label = '';
      amount = 0;
      paymentMethod = '';
      paymentMethodCustom = '';
      showConfirmModal = false;
      formOpen = false;
      await load();
    } catch (e) {
      formError = getErrorMessage(e);
      showConfirmModal = false;
    } finally {
      saving = false;
    }
  }

  onMount(load);
</script>

<div class="page-stack">
  <div class="page-intro">
    <div>
      <h2>Mouvements</h2>
      <p>Suivez les recettes et dépenses de l’association.</p>
    </div>
    <button class="btn btn-primary" on:click={() => formOpen = !formOpen}>
      <Icon name={formOpen ? 'close' : 'plus'} size={18}/>
      {formOpen ? 'Annuler' : 'Nouvelle transaction'}
    </button>
  </div>

  {#if formOpen}
    <form class="panel inline-form" on:submit|preventDefault={promptSave}>
      <div class="form-heading">
        <h3>Ajouter une transaction</h3>
        <p>La transaction sera soumise à vérification avant son inscription définitive au journal comptable.</p>
      </div>
      {#if formError}
        <div class="alert" role="alert">{formError}</div>
      {/if}
      <div class="form-grid">
        <label>
          Libellé
          <input bind:value={label} required placeholder="Cotisation annuelle"/>
        </label>
        <label>
          Sens
          <select bind:value={direction}>
            <option value="expense">Dépense (Débit)</option>
            <option value="income">Recette (Crédit)</option>
          </select>
        </label>
        <label>
          Montant (€)
          <input type="number" min="0.01" step="0.01" bind:value={amount} required/>
        </label>
        <label>
          Date
          <input type="date" bind:value={date} required/>
        </label>
        <label>
          Compte
          <select bind:value={accountId} required>
            <option value="">Sélectionner</option>
            {#each accounts as item}
              <option value={item.id}>{item.name}</option>
            {/each}
          </select>
        </label>
        <label>
          Mode de paiement
          <select bind:value={paymentMethod}>
            <option value="">Non précisé</option>
            <option value="CARTE">Carte</option>
            <option value="CHEQUE">Chèque</option>
            <option value="VIREMENT">Virement</option>
            <option value="ESPECES">Espèces</option>
            <option value="AUTRE">Autre</option>
          </select>
        </label>
        {#if paymentMethod === 'AUTRE'}
          <label class="custom-payment-field">
            Préciser le type de paiement
            <input bind:value={paymentMethodCustom} required placeholder="Ex: Prélèvement, En ligne, Billet..."/>
          </label>
        {/if}
        <label>
          Catégorie
          <select bind:value={categoryId}>
            <option value="">Non classée</option>
            {#each categories as item}
              <option value={item.id}>{item.name}</option>
            {/each}
          </select>
        </label>
        <label>
          Projet
          <select bind:value={projectId}>
            <option value="">Aucun projet</option>
            {#each projects as item}
              <option value={item.id}>{item.name}</option>
            {/each}
          </select>
        </label>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">
          Vérifier et enregistrer la transaction <span>→</span>
        </button>
      </div>
    </form>
  {/if}

  <!-- MODAL DE CONFIRMATION AVANT VALIDATION DÉFINITIVE DE LA TRANSACTION -->
  {#if showConfirmModal}
    <div class="confirm-modal-layer" role="presentation">
      <button class="confirm-backdrop" aria-label="Fermer" on:click={cancelConfirm}></button>
      <div class="confirm-modal-box" role="dialog" aria-modal="true" aria-labelledby="confirm-tx-title">
        <div class="confirm-header">
          <div class="confirm-title-wrap">
            <span class="confirm-icon-badge">🛡️</span>
            <div>
              <h3 id="confirm-tx-title">Vérification de la transaction</h3>
              <span class="confirm-subtitle">Contrôle avant inscription définitive au grand livre</span>
            </div>
          </div>
          <button type="button" class="close-btn" on:click={cancelConfirm} aria-label="Fermer">✕</button>
        </div>

        <div class="confirm-alert-box">
          <div class="alert-icon">⚠️</div>
          <div class="alert-text">
            <strong>Attention : Information non modifiable après validation !</strong>
            <p>Conformément aux exigences légales et comptables des associations, <strong>cette opération ne sera plus modifiable ni supprimable</strong> une fois enregistrée. Veuillez vérifier scrupuleusement l’exactitude des éléments récapitulés ci-dessous.</p>
          </div>
        </div>

        <div class="confirm-recap-card">
          <div class="recap-row highlight-row">
            <span class="recap-label">Nature de l'opération</span>
            <span class="recap-val">
              {#if direction === 'income'}
                <span class="status-badge badge-green">📈 Recette (Crédit +)</span>
              {:else}
                <span class="status-badge badge-expense">📉 Dépense (Débit -)</span>
              {/if}
            </span>
          </div>

          <div class="recap-row">
            <span class="recap-label">Montant</span>
            <span class="recap-val amount-highlight" class:text-income={direction === 'income'} class:text-expense={direction === 'expense'}>
              {direction === 'income' ? '+' : '-'}{currency.format(Number(amount) || 0)}
            </span>
          </div>

          <div class="recap-row">
            <span class="recap-label">Libellé de l'opération</span>
            <span class="recap-val font-semibold">{label}</span>
          </div>

          <div class="recap-row">
            <span class="recap-label">Date d'opération</span>
            <span class="recap-val">{formatDate(date)}</span>
          </div>

          <div class="recap-row">
            <span class="recap-label">Compte bancaire affecté</span>
            <span class="recap-val font-semibold">
              {accounts.find(a => String(a.id) === String(accountId))?.name || '—'}
            </span>
          </div>

          <div class="recap-row">
            <span class="recap-label">Mode de règlement</span>
            <span class="recap-val">{finalPaymentMethod || 'Non précisé'}</span>
          </div>

          <div class="recap-row">
            <span class="recap-label">Catégorie analytique</span>
            <span class="recap-val">
              {#if categoryId}
                {@const cat = categories.find(c => String(c.id) === String(categoryId))}
                <strong>{cat ? cat.name : 'Sélectionnée'}</strong>
              {:else}
                <span class="text-muted italic">Non classée</span>
              {/if}
            </span>
          </div>

          <div class="recap-row">
            <span class="recap-label">Projet</span>
            <span class="recap-val">
              {#if projectId}
                {@const proj = projects.find(p => String(p.id) === String(projectId))}
                <strong>{proj ? proj.name : 'Sélectionné'}</strong>
              {:else}
                <span class="text-muted italic">Aucun projet</span>
              {/if}
            </span>
          </div>
        </div>

        <div class="confirm-modal-footer">
          <button type="button" class="btn btn-secondary" on:click={cancelConfirm} disabled={saving}>
            Modifier les informations
          </button>
          <button type="button" class="btn btn-primary btn-confirm-submit" on:click={confirmAndSave} disabled={saving}>
            {#if saving}
              <span class="spinner spinner-light"></span> Enregistrement en cours…
            {:else}
              <Icon name="check" size={18}/> Confirmer et enregistrer définitivement
            {/if}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <FiscalYearNav
    bind:fiscalOffset
    bind:mode={periodMode}
    bind:filterStartDate
    bind:filterEndDate
    itemCount={periodTransactions.length}
    itemLabel="mouvements"
    allowCustomDates={true}
  />

  <div class="section-heading-with-tabs">
    <div class="section-heading">
      <div>
        <h3>Liste des mouvements ({filteredTransactions.length})</h3>
        <p>Historique des opérations bancaires et saisies</p>
      </div>
    </div>
    <div class="transactions-filter-tabs">
      <button
        type="button"
        class="filter-tab"
        class:active={filterTab === 'all'}
        on:click={() => filterTab = 'all'}
      >
        Toutes ({periodTransactions.length})
      </button>
      <button
        type="button"
        class="filter-tab income-tab"
        class:active={filterTab === 'income'}
        on:click={() => filterTab = 'income'}
      >
        📥 Entrées ({incomeCount})
      </button>
      <button
        type="button"
        class="filter-tab expense-tab"
        class:active={filterTab === 'expense'}
        on:click={() => filterTab = 'expense'}
      >
        📤 Sorties ({expenseCount})
      </button>
    </div>
  </div>

  <AsyncState {loading} {error} empty={!filteredTransactions.length} emptyTitle="Aucun mouvement dans cette vue" emptyText="Aucune opération ne correspond au filtre sélectionné." onRetry={load}>
    <div class="panel table-panel">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Sens</th>
              <th>Libellé</th>
              <th>Paiement</th>
              <th>Catégorie</th>
              <th>Compte</th>
              <th class="align-right">Montant</th>
            </tr>
          </thead>
          <tbody>
            {#each filteredTransactions as tx (tx.id)}
              <tr>
                <td data-label="Date">{formatDate(tx.date)}</td>
                <td data-label="Sens">
                  {#if isIncome(tx)}
                    <span class="status-badge badge-green" title="Recette / Entrée de trésorerie">
                      📥 Entrée
                    </span>
                  {:else}
                    <span class="status-badge badge-blue" title="Dépense / Sortie de trésorerie">
                      📤 Sortie
                    </span>
                  {/if}
                </td>
                <td data-label="Libellé">
                  <strong>{tx.label || tx.description || 'Transaction'}</strong>
                  {#if tx.project}
                    <small>{displayName(tx.project)}</small>
                  {/if}
                </td>
                <td data-label="Paiement">
                  {#if tx.payment_method || tx.paymentMethod}
                    <span class="soft-badge">{displayPaymentMethod(tx.payment_method || tx.paymentMethod)}</span>
                  {:else}
                    <span class="muted-dash">—</span>
                  {/if}
                </td>
                <td data-label="Catégorie"><span class="soft-badge">{displayName(tx.category)}</span></td>
                <td data-label="Compte">{displayName(tx.account)}</td>
                <td
                  data-label="Montant"
                  class:positive={isIncome(tx)}
                  class:negative={!isIncome(tx)}
                  class="align-right amount"
                >
                  {isIncome(tx) ? '+ ' : '− '}{currency.format(Math.abs(tx.amount))}
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
  .custom-payment-field {
    animation: fadeIn 0.2s ease-in;
  }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .muted-dash {
    color: var(--muted, #8ca298);
  }
  .section-heading-with-tabs {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 1rem;
    margin-bottom: 1rem;
  }
  .transactions-filter-tabs {
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
  .filter-tab.expense-tab.active {
    color: #b91c1c;
  }
  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.2rem 0.55rem;
    border-radius: 6px;
    font-size: 0.78rem;
    font-weight: 600;
  }
  .badge-green {
    background: #dcfce7 !important;
    color: #15803d !important;
    border: 1px solid #bbf7d0 !important;
  }
  .badge-expense {
    background: #fee2e2 !important;
    color: #b91c1c !important;
    border: 1px solid #fecaca !important;
  }

  /* CONFIRMATION MODAL */
  .confirm-modal-layer {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
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
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
    width: 100%;
    max-width: 580px;
    max-height: 90vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    padding: 1.5rem;
    animation: fadeIn 0.2s ease-out;
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

  .font-semibold {
    font-weight: 600;
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
