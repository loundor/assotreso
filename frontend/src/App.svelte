<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Login from './pages/Login.svelte';
  import Dashboard from './pages/Dashboard.svelte';
  import Accounts from './pages/Accounts.svelte';
  import Transactions from './pages/Transactions.svelte';
  import Invoices from './pages/Invoices.svelte';
  import Reconciliation from './pages/Reconciliation.svelte';
  import Reports from './pages/Reports.svelte';
  import Resources from './pages/Resources.svelte';
  import Configuration from './pages/Configuration.svelte';
  import Shell from './components/Shell.svelte';
  import InvoiceCapture from './components/InvoiceCapture.svelte';
  import { api, clearToken, getToken } from './lib/api';
  import type { PageId, User } from './lib/types';

  let user: User | null = null;
  let checkingAuth = true;
  let page: PageId = 'dashboard';
  let captureOpen = false;
  let captureMode: 'upload' | 'manual' = 'upload';
  let captureDirection: 'expense' | 'income' = 'expense';
  let invoiceRefresh = 0;
  const validPages: PageId[] = ['dashboard','accounts','transactions','invoices','reconciliation','reports','categories','projects','configuration'];

  function pageFromHash(): PageId {
    const candidate = location.hash.replace('#/', '') as PageId;
    if (!validPages.includes(candidate) || (candidate === 'configuration' && user?.role !== 'ADMIN')) return 'dashboard';
    return candidate;
  }
  function navigate(next: PageId) {
    const allowed = next !== 'configuration' || user?.role === 'ADMIN';
    page = allowed ? next : 'dashboard';
    history.replaceState(null, '', `#/${page}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function logout() { clearToken(); user = null; captureOpen = false; }
  function unauthorized() { logout(); }
  function handleHash() { page = pageFromHash(); }
  function captureSuccess() { invoiceRefresh += 1; navigate('invoices'); }

  function startCapture(mode: 'upload' | 'manual' = 'upload', direction: 'expense' | 'income' = 'expense') {
    captureMode = mode;
    captureDirection = direction;
    captureOpen = true;
  }

  onMount(async () => {
    page = pageFromHash();
    window.addEventListener('hashchange', handleHash);
    window.addEventListener('treso:unauthorized', unauthorized);
    if (getToken()) { try { user = await api.me(); } catch { clearToken(); } }
    page = pageFromHash();
    if (location.hash !== `#/${page}`) history.replaceState(null, '', `#/${page}`);
    checkingAuth = false;
  });
  onDestroy(() => { window.removeEventListener('hashchange', handleHash); window.removeEventListener('treso:unauthorized', unauthorized); });
</script>

{#if checkingAuth}
  <div class="app-loading" role="status"><div class="brand"><span class="brand-mark">T</span><strong>Tréso</strong></div><span class="spinner"></span><p>Ouverture de votre espace…</p></div>
{:else if !user}
  <Login onSuccess={(loggedUser) => { user = loggedUser; navigate('dashboard'); }} />
{:else}
  <Shell {page} {user} {navigate} openCapture={() => startCapture('upload')} {logout}>
    {#if page === 'dashboard'}<Dashboard openCapture={() => startCapture('upload')} navigate={(target) => navigate(target)} />
    {:else if page === 'accounts'}<Accounts />
    {:else if page === 'transactions'}<Transactions />
    {:else if page === 'invoices'}<Invoices openCapture={() => startCapture('upload')} openManualCapture={(dir?: 'expense' | 'income') => startCapture('manual', dir ?? 'expense')} refreshKey={invoiceRefresh} />
    {:else if page === 'reconciliation'}<Reconciliation />
    {:else if page === 'reports'}<Reports />
    {:else if page === 'categories'}<Resources kind="categories" />
    {:else if page === 'projects'}<Resources kind="projects" />
    {:else if page === 'configuration' && user.role === 'ADMIN'}<Configuration />{/if}
  </Shell>
  {#if captureOpen}<InvoiceCapture mode={captureMode} initialDirection={captureDirection} onClose={() => captureOpen = false} onSuccess={captureSuccess} />{/if}
{/if}
