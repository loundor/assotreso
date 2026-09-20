<script lang="ts">
  import Icon from './Icon.svelte';
  export let loading = false;
  export let error = '';
  export let empty = false;
  export let emptyTitle = 'Aucune donnée';
  export let emptyText = 'Les éléments apparaîtront ici.';
  export let onRetry: (() => void) | undefined = undefined;
</script>

{#if loading}
  <div class="state" role="status" aria-live="polite"><span class="spinner"></span><p>Chargement en cours…</p></div>
{:else if error}
  <div class="state state-error" role="alert">
    <span class="state-icon"><Icon name="alert" size={24} /></span>
    <strong>Impossible de charger les données</strong><p>{error}</p>
    {#if onRetry}<button class="btn btn-secondary btn-small" on:click={onRetry}><Icon name="refresh" size={17}/> Réessayer</button>{/if}
  </div>
{:else if empty}
  <div class="state"><span class="state-icon state-icon-muted">✦</span><strong>{emptyTitle}</strong><p>{emptyText}</p></div>
{:else}
  <slot />
{/if}
