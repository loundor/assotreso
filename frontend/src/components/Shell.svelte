<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { api } from '../lib/api';
  import type { PageId, User } from '../lib/types';

  export let page: PageId;
  export let user: User;
  export let navigate: (page: PageId) => void;
  export let openCapture: () => void;
  export let logout: () => void;

  let menuOpen = false;
  let assoInfo: { name?: string; acronym?: string; hasLogo?: boolean; logoUrl?: string | null } = {};
  let logoTimestamp = Date.now();

  async function loadAssoInfo() {
    try {
      const info = await api.get<{ name?: string; acronym?: string; hasLogo?: boolean; logoUrl?: string | null }>('config/public');
      assoInfo = info || {};
      logoTimestamp = Date.now();
    } catch {
      // Ignorer si échec
    }
  }

  onMount(() => {
    void loadAssoInfo();
    window.addEventListener('treso:config-updated', loadAssoInfo);
    return () => window.removeEventListener('treso:config-updated', loadAssoInfo);
  });

  type NavItem = { id: PageId; label: string; icon: 'dashboard' | 'wallet' | 'transfer' | 'invoice' | 'tag' | 'folder' | 'settings' | 'link' | 'report' };
  const baseItems: NavItem[] = [
    { id: 'dashboard', label: 'Tableau de bord', icon: 'dashboard' },
    { id: 'accounts', label: 'Comptes', icon: 'wallet' },
    { id: 'transactions', label: 'Transactions', icon: 'transfer' },
    { id: 'invoices', label: 'Factures', icon: 'invoice' },
    { id: 'reconciliation', label: 'Rapprochement', icon: 'link' },
    { id: 'reports', label: 'Rapports', icon: 'report' },
    { id: 'categories', label: 'Catégories', icon: 'tag' },
    { id: 'projects', label: 'Projets', icon: 'folder' }
  ];
  $: items = user.role === 'ADMIN'
    ? [...baseItems, { id: 'configuration', label: 'Configuration', icon: 'settings' } satisfies NavItem]
    : baseItems;
  $: title = items.find((item) => item.id === page)?.label ?? 'Tableau de bord';

  function go(id: PageId) { navigate(id); menuOpen = false; }
</script>

<div class="app-shell">
  <aside class:open={menuOpen} class="sidebar" aria-label="Navigation principale">
    <div class="brand">
      {#if assoInfo.hasLogo || assoInfo.logoUrl}
        <img src={`/api/config/logo?t=${logoTimestamp}`} alt="Logo" class="brand-logo" />
      {:else}
        <span class="brand-mark">{(assoInfo.name || 'T').slice(0, 1).toUpperCase()}</span>
      {/if}
      <span>
        <strong>{assoInfo.name || 'Tréso'}</strong>
        <small>{assoInfo.acronym || 'Gestion associative'}</small>
      </span>
    </div>
    <button class="sidebar-close icon-button" aria-label="Fermer le menu" on:click={() => menuOpen = false}><Icon name="close"/></button>
    <button class="capture-cta" on:click={() => { openCapture(); menuOpen = false; }}><Icon name="scan" size={23}/><span>Scanner / importer<br/>une facture</span></button>
    <nav>
      {#each items as item}
        <button class:active={page === item.id} aria-current={page === item.id ? 'page' : undefined} on:click={() => go(item.id)}>
          <Icon name={item.icon}/><span>{item.label}</span>
        </button>
      {/each}
    </nav>
    <div class="sidebar-user">
      <div class="avatar">{(user.name || user.email).slice(0, 1).toUpperCase()}</div>
      <div><strong>{user.name || 'Trésorier·ère'}</strong><small>{user.email}</small></div>
      <button class="icon-button" aria-label="Se déconnecter" title="Se déconnecter" on:click={logout}><Icon name="logout"/></button>
    </div>
  </aside>
  {#if menuOpen}<button class="backdrop nav-backdrop" aria-label="Fermer le menu" on:click={() => menuOpen = false}></button>{/if}

  <div class="main-column">
    <header class="topbar">
      <button class="icon-button menu-button" aria-label="Ouvrir le menu" on:click={() => menuOpen = true}><Icon name="menu"/></button>
      <div><span class="eyebrow">Espace trésorerie</span><h1>{title}</h1></div>
      <button class="top-capture" aria-label="Scanner ou importer une facture" on:click={openCapture}><Icon name="scan"/><span>Importer</span></button>
    </header>
    <main id="main-content"><slot /></main>
  </div>

  <nav class="mobile-nav" aria-label="Navigation mobile">
    {#each items.slice(0, 4) as item}
      <button class:active={page === item.id} aria-current={page === item.id ? 'page' : undefined} on:click={() => go(item.id)}><Icon name={item.icon} size={20}/><span>{item.label === 'Tableau de bord' ? 'Accueil' : item.label}</span></button>
    {/each}
    <button on:click={() => menuOpen = true}><Icon name="menu" size={20}/><span>Plus</span></button>
  </nav>
</div>

<style>
  .brand-logo {
    width: 38px;
    height: 38px;
    border-radius: 10px;
    object-fit: contain;
    background: white;
    padding: 2px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  }
</style>
