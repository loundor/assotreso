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
  import { getErrorMessage } from './lib/utils';
  import type { AuthStatus, PageId, User } from './lib/types';

  let user: User | null = null;
  let checkingAuth = true;
  let authStatus: AuthStatus | null = null;
  let authError = '';
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
  function authenticationSuccess(loggedUser: User) {
    user = loggedUser;
    authStatus = authStatus ? { ...authStatus, setupRequired: false } : authStatus;
    navigate('dashboard');
  }

  async function initializeAuth() {
    checkingAuth = true;
    authError = '';
    try {
      authStatus = await api.authStatus();
      if (authStatus.setupRequired) {
        clearToken();
        user = null;
      } else if (getToken()) {
        try { user = await api.me(); }
        catch { clearToken(); user = null; }
      }
    } catch (error) {
      authError = getErrorMessage(error);
    } finally {
      checkingAuth = false;
    }
  }

  function startCapture(mode: 'upload' | 'manual' = 'upload', direction: 'expense' | 'income' = 'expense') {
    captureMode = mode;
    captureDirection = direction;
    captureOpen = true;
  }

  onMount(async () => {
    page = pageFromHash();
    window.addEventListener('hashchange', handleHash);
    window.addEventListener('treso:unauthorized', unauthorized);
    await initializeAuth();
    page = pageFromHash();
    if (location.hash !== `#/${page}`) history.replaceState(null, '', `#/${page}`);
  });
  onDestroy(() => { window.removeEventListener('hashchange', handleHash); window.removeEventListener('treso:unauthorized', unauthorized); });
</script>

{#if checkingAuth}
  <div class="app-loading" role="status"><div class="brand"><span class="brand-mark">T</span><strong>Tréso</strong></div><span class="spinner"></span><p>Ouverture de votre espace…</p></div>
{:else if authError}
  <div class="app-loading" role="alert">
    <div class="brand"><span class="brand-mark">!</span><strong>Tréso</strong></div>
    <strong>Impossible d’initialiser l’application</strong>
    <p>{authError}</p>
    <button class="btn btn-secondary" on:click={initializeAuth}>Réessayer</button>
  </div>
{:else if !user && authStatus}
  <Login setupRequired={authStatus.setupRequired} demoMode={authStatus.demoMode} onSuccess={authenticationSuccess} />
{:else if user}
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
