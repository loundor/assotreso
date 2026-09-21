<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import { api, setToken } from '../lib/api';
  import { getErrorMessage } from '../lib/utils';
  import type { User } from '../lib/types';

  export let onSuccess: (user: User) => void;
  export let setupRequired = false;
  export let demoMode = false;

  let name = '';
  let email = demoMode && !setupRequired ? 'tresorier@demo.fr' : '';
  let password = demoMode && !setupRequired ? 'demo1234' : '';
  let passwordConfirmation = '';
  let loading = false;
  let error = '';
  let showPassword = false;
  let showPasswordConfirmation = false;

  function validateSetup(): string {
    const cleanName = name.trim();
    const cleanEmail = email.trim();
    if (cleanName.length < 2) return 'Saisissez un nom d’au moins 2 caractères.';
    if (!cleanEmail) return 'Saisissez une adresse e-mail.';
    if (password.length < 8) return 'Le mot de passe doit contenir au moins 8 caractères.';
    if (new TextEncoder().encode(password).length > 72) return 'Le mot de passe ne doit pas dépasser 72 octets.';
    if (password !== passwordConfirmation) return 'Les deux mots de passe ne correspondent pas.';
    return '';
  }

  async function submit() {
    error = setupRequired ? validateSetup() : '';
    if (error) return;

    loading = true;
    try {
      const result = setupRequired
        ? await api.setup({
            name: name.trim(),
            email: email.trim().toLowerCase(),
            password,
            passwordConfirmation
          })
        : await api.login(email.trim().toLowerCase(), password);
      setToken(result.token);
      onSuccess(result.user);
    } catch (err) {
      error = getErrorMessage(err);
    } finally {
      loading = false;
    }
  }
</script>

<div class="login-page">
  <section class="login-visual" aria-hidden="true">
    <div class="visual-brand"><span class="brand-mark brand-mark-light">T</span><strong>Tréso</strong></div>
    <div class="visual-copy">
      <span class="pill-light">Pensé pour les associations</span>
      <h1>Votre trésorerie,<br/>clairement.</h1>
      <p>Suivez vos comptes, classez vos justificatifs et pilotez vos projets sereinement.</p>
    </div>
    <div class="visual-card"><span class="visual-card-icon"><Icon name="scan" size={24}/></span><div><strong>Les factures, sans la saisie.</strong><small>Photographiez, vérifiez, validez.</small></div></div>
  </section>
  <main class="login-main">
    <div class="login-mobile-brand"><span class="brand-mark">T</span><strong>Tréso</strong></div>
    <form class="login-card" aria-busy={loading} on:submit|preventDefault={submit}>
      <div>
        <span class="eyebrow">{setupRequired ? 'Configuration initiale' : 'Heureux de vous revoir'}</span>
        <h2>{setupRequired ? 'Première utilisation' : 'Connexion'}</h2>
        <p>{setupRequired ? 'Créez le premier compte administrateur de votre association.' : 'Accédez à l’espace de gestion de votre association.'}</p>
      </div>

      {#if error}<div class="alert" role="alert" aria-live="polite"><Icon name="alert" size={19}/><span>{error}</span></div>{/if}

      {#if setupRequired}
        <label>
          Nom complet
          <input type="text" bind:value={name} autocomplete="name" minlength="2" maxlength="120" placeholder="Camille Martin" required />
        </label>
      {/if}

      <label>
        Adresse e-mail
        <input type="email" bind:value={email} autocomplete={setupRequired ? 'email' : 'username'} maxlength="254" placeholder="vous@association.fr" required />
      </label>

      <label>
        Mot de passe
        <div class="password-field">
          <input type={showPassword ? 'text' : 'password'} bind:value={password} autocomplete={setupRequired ? 'new-password' : 'current-password'} minlength={setupRequired ? 8 : undefined} required />
          <button type="button" aria-pressed={showPassword} on:click={() => showPassword = !showPassword}>{showPassword ? 'Masquer' : 'Afficher'}</button>
        </div>
        {#if setupRequired}<span class="field-help">Au moins 8 caractères.</span>{/if}
      </label>

      {#if setupRequired}
        <label>
          Confirmer le mot de passe
          <div class="password-field">
            <input type={showPasswordConfirmation ? 'text' : 'password'} bind:value={passwordConfirmation} autocomplete="new-password" minlength="8" required />
            <button type="button" aria-pressed={showPasswordConfirmation} on:click={() => showPasswordConfirmation = !showPasswordConfirmation}>{showPasswordConfirmation ? 'Masquer' : 'Afficher'}</button>
          </div>
        </label>
      {/if}

      <button class="btn btn-primary btn-large" type="submit" disabled={loading}>
        {#if loading}
          <span class="spinner spinner-light"></span> {setupRequired ? 'Création…' : 'Connexion…'}
        {:else}
          {setupRequired ? 'Créer le compte administrateur' : 'Se connecter'} <span aria-hidden="true">→</span>
        {/if}
      </button>

      {#if demoMode && !setupRequired}
        <div class="demo-note"><strong>Compte de démonstration</strong><span>Les identifiants sont déjà renseignés.</span></div>
      {/if}
    </form>
  </main>
</div>
