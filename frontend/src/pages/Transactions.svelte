<script lang="ts">
  import { onMount } from 'svelte';
  import AsyncState from '../components/AsyncState.svelte';
  import Icon from '../components/Icon.svelte';
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

  async function save() {
    saving = true;
    formError = '';
    try {
      const finalPaymentMethod = paymentMethod === 'AUTRE'
        ? (paymentMethodCustom.trim() || 'Autre')
        : (paymentMethod || undefined);

      await api.post('transactions', {
        label,
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
      formOpen = false;
      await load();
    } catch (e) {
      formError = getErrorMessage(e);
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
    <form class="panel inline-form" on:submit|preventDefault={save}>
      <div class="form-heading">
        <h3>Ajouter une transaction</h3>
        <p>La transaction sera ajoutée au journal.</p>
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
            <option value="expense">Dépense</option>
            <option value="income">Recette</option>
          </select>
        </label>
        <label>
          Montant (€)
          <input type="number" min="0" step="0.01" bind:value={amount} required/>
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
        <button class="btn btn-primary" disabled={saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </form>
  {/if}

  <AsyncState {loading} {error} empty={!transactions.length} emptyTitle="Aucune transaction" emptyText="Ajoutez votre premier mouvement pour commencer le suivi." onRetry={load}>
    <div class="panel table-panel">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Libellé</th>
              <th>Paiement</th>
              <th>Catégorie</th>
              <th>Compte</th>
              <th class="align-right">Montant</th>
            </tr>
          </thead>
          <tbody>
            {#each transactions as tx}
              <tr>
                <td data-label="Date">{formatDate(tx.date)}</td>
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
                  class:positive={tx.amount > 0 || tx.direction === 'income'}
                  class:negative={tx.amount < 0 || tx.direction === 'expense'}
                  class="align-right amount"
                >
                  {tx.direction === 'expense' && tx.amount > 0 ? '− ' : tx.amount > 0 ? '+ ' : ''}{currency.format(Math.abs(tx.amount))}
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
</style>
