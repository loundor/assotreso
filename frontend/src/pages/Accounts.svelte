<script lang="ts">
  import { onMount } from 'svelte';
  import AsyncState from '../components/AsyncState.svelte';
  import Icon from '../components/Icon.svelte';
  import { api, listFrom } from '../lib/api';
  import { currency, getErrorMessage } from '../lib/utils';
  import type { Account } from '../lib/types';

  let accounts: Account[] = [];
  let loading = true; let error = ''; let formOpen = false; let saving = false; let formError = '';
  let name = ''; let type = 'bank'; let balance = 0; let bankName = '';
  async function load() { loading = true; error = ''; try { accounts = listFrom<Account>(await api.get('accounts'), ['accounts']); } catch (e) { error = getErrorMessage(e); } finally { loading = false; } }
  async function save() { saving = true; formError = ''; try { await api.post('accounts', { name, type, balance: Number(balance), bankName, currency: 'EUR' }); name = ''; bankName = ''; balance = 0; formOpen = false; await load(); } catch (e) { formError = getErrorMessage(e); } finally { saving = false; } }
  onMount(load);
</script>

<div class="page-stack">
  <div class="page-intro"><div><h2>Vos comptes</h2><p>Centralisez les soldes de l’association.</p></div><button class="btn btn-primary" on:click={() => formOpen = !formOpen}><Icon name={formOpen ? 'close' : 'plus'} size={18}/>{formOpen ? 'Annuler' : 'Ajouter un compte'}</button></div>
  {#if formOpen}<form class="panel inline-form" on:submit|preventDefault={save}><div class="form-heading"><h3>Nouveau compte</h3><p>Renseignez les informations principales.</p></div>{#if formError}<div class="alert" role="alert">{formError}</div>{/if}<div class="form-grid"><label>Nom du compte<input bind:value={name} required placeholder="Compte courant" /></label><label>Type<select bind:value={type}><option value="bank">Compte bancaire</option><option value="cash">Caisse</option><option value="savings">Épargne</option></select></label><label>Établissement<input bind:value={bankName} placeholder="Nom de la banque" /></label><label>Solde initial (€)<input type="number" step="0.01" bind:value={balance} /></label></div><div class="form-actions"><button class="btn btn-primary" disabled={saving}>{saving ? 'Enregistrement…' : 'Créer le compte'}</button></div></form>{/if}
  <AsyncState {loading} {error} empty={!accounts.length} emptyTitle="Aucun compte" emptyText="Ajoutez le premier compte bancaire ou la caisse de l’association." onRetry={load}>
    <div class="cards-grid">{#each accounts as account}<article class="account-card"><div class="account-top"><span class="account-icon"><Icon name="wallet"/></span><span class="status-badge">Actif</span></div><div><small>{account.type === 'cash' ? 'Caisse' : account.bankName || 'Compte bancaire'}</small><h3>{account.name}</h3></div><div class="account-balance"><span>Solde disponible</span><strong>{currency.format(account.balance ?? 0)}</strong></div></article>{/each}</div>
  </AsyncState>
</div>
