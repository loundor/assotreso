<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import { api, setToken } from '../lib/api';
  import { getErrorMessage } from '../lib/utils';
  import type { User } from '../lib/types';

  export let onSuccess: (user: User) => void;
  let email = 'tresorier@demo.fr';
  let password = 'demo1234';
  let loading = false;
  let error = '';
  let showPassword = false;

  async function submit() {
    error = ''; loading = true;
    try {
      const result = await api.login(email, password);
      setToken(result.token);
      onSuccess(result.user);
    } catch (err) { error = getErrorMessage(err); }
    finally { loading = false; }
  }
</script>

<div class="login-page">
  <section class="login-visual" aria-hidden="true">
    <div class="visual-brand"><span class="brand-mark brand-mark-light">T</span><strong>Tréso</strong></div>
    <div class="visual-copy"><span class="pill-light">Pensé pour les associations</span><h1>Votre trésorerie,<br/>clairement.</h1><p>Suivez vos comptes, classez vos justificatifs et pilotez vos projets sereinement.</p></div>
    <div class="visual-card"><span class="visual-card-icon"><Icon name="scan" size={24}/></span><div><strong>Les factures, sans la saisie.</strong><small>Photographiez, vérifiez, validez.</small></div></div>
  </section>
  <main class="login-main">
    <div class="login-mobile-brand"><span class="brand-mark">T</span><strong>Tréso</strong></div>
    <form class="login-card" on:submit|preventDefault={submit}>
      <div><span class="eyebrow">Heureux de vous revoir</span><h2>Connexion</h2><p>Accédez à l’espace de gestion de votre association.</p></div>
      {#if error}<div class="alert" role="alert"><Icon name="alert" size={19}/><span>{error}</span></div>{/if}
      <label>Adresse e-mail<input type="email" bind:value={email} autocomplete="email" required /></label>
      <label>Mot de passe<div class="password-field"><input type={showPassword ? 'text' : 'password'} bind:value={password} autocomplete="current-password" required /><button type="button" on:click={() => showPassword = !showPassword}>{showPassword ? 'Masquer' : 'Afficher'}</button></div></label>
      <button class="btn btn-primary btn-large" type="submit" disabled={loading}>{#if loading}<span class="spinner spinner-light"></span> Connexion…{:else}Se connecter <span aria-hidden="true">→</span>{/if}</button>
      <div class="demo-note"><strong>Compte de démonstration</strong><span>Les identifiants sont déjà renseignés.</span></div>
    </form>
  </main>
</div>
