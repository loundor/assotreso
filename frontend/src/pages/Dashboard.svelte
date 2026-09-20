<script lang="ts">
  import { onMount } from 'svelte';
  import AsyncState from '../components/AsyncState.svelte';
  import Icon from '../components/Icon.svelte';
  import { api, listFrom } from '../lib/api';
  import { currency, formatDate, getErrorMessage } from '../lib/utils';
  import type { DashboardData, Transaction } from '../lib/types';

  export let openCapture: () => void;
  export let navigate: (page: 'transactions' | 'accounts') => void;
  let data: DashboardData = {};
  let loading = true;
  let error = '';

  async function load() {
    loading = true; error = '';
    try {
      const payload = await api.get<DashboardData>('dashboard');
      data = payload || {};
      if (!data.recentTransactions) data.recentTransactions = listFrom<Transaction>(payload, ['recentTransactions', 'transactions']);
    } catch (err) { error = getErrorMessage(err); }
    finally { loading = false; }
  }
  onMount(load);
  $: balance = data.totalBalance ?? data.balance ?? 0;
</script>

<div class="page-stack">
  <section class="welcome-row"><div><span class="eyebrow">Vue d’ensemble</span><h2>Bonjour 👋</h2><p>Voici où en est votre association aujourd’hui.</p></div><button class="btn btn-scan" on:click={openCapture}><Icon name="scan" size={21}/> Scanner une facture</button></section>
  <AsyncState {loading} {error} onRetry={load}>
    <section class="stats-grid">
      <article class="stat-card stat-main"><div><span>Solde total</span><strong>{currency.format(balance)}</strong><small>Tous comptes confondus</small></div><span class="stat-icon"><Icon name="wallet"/></span></article>
      <article class="stat-card"><div><span>Recettes</span><strong class="positive">+ {currency.format(data.income ?? 0)}</strong><small>Ce mois-ci</small></div><span class="trend positive">↗</span></article>
      <article class="stat-card"><div><span>Dépenses</span><strong class="negative">− {currency.format(data.expenses ?? 0)}</strong><small>Ce mois-ci</small></div><span class="trend negative">↘</span></article>
      <article class="stat-card"><div><span>À vérifier</span><strong>{data.pendingInvoices ?? 0} facture{data.pendingInvoices === 1 ? '' : 's'}</strong><small>En attente de rapprochement</small></div><span class="stat-icon amber"><Icon name="invoice"/></span></article>
    </section>
    <section class="dashboard-grid">
      <article class="panel"><div class="panel-heading"><div><h3>Activité récente</h3><p>Derniers mouvements enregistrés</p></div><button class="text-button" on:click={() => navigate('transactions')}>Tout voir <Icon name="chevron" size={16}/></button></div>
        {#if !data.recentTransactions?.length}<div class="mini-empty">Aucune transaction récente.</div>{:else}<div class="transaction-list">{#each data.recentTransactions.slice(0, 6) as tx}<div class="transaction-row"><span class:income={tx.amount > 0 || tx.direction === 'income'} class="transaction-dot">{tx.amount > 0 || tx.direction === 'income' ? '↙' : '↗'}</span><div><strong>{tx.label || tx.description || 'Transaction'}</strong><small>{formatDate(tx.date)}</small></div><strong class:positive={tx.amount > 0 || tx.direction === 'income'}>{tx.amount > 0 ? '+' : ''}{currency.format(tx.amount)}</strong></div>{/each}</div>{/if}
      </article>
      <aside class="panel quick-panel"><div class="panel-heading"><div><h3>Actions rapides</h3><p>Gagnez du temps</p></div></div><button on:click={openCapture}><span class="quick-icon"><Icon name="scan"/></span><span><strong>Importer une facture</strong><small>Photo, image ou PDF</small></span><Icon name="chevron"/></button><button on:click={() => navigate('transactions')}><span class="quick-icon pale"><Icon name="plus"/></span><span><strong>Ajouter une transaction</strong><small>Saisie manuelle</small></span><Icon name="chevron"/></button><button on:click={() => navigate('accounts')}><span class="quick-icon pale"><Icon name="wallet"/></span><span><strong>Voir les comptes</strong><small>Soldes et détails</small></span><Icon name="chevron"/></button></aside>
    </section>
  </AsyncState>
</div>
