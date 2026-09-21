<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { api } from '../lib/api';
  import { formatDate, getFiscalYearInfo, type FiscalYearInfo } from '../lib/utils';

  export let fiscalStartDay = 1;
  export let fiscalStartMonth = 1;
  export let fiscalOffset = 0;
  export let mode: 'fiscal' | 'all' | 'custom' = 'fiscal';
  export let filterStartDate = '';
  export let filterEndDate = '';
  export let itemCount: number | undefined = undefined;
  export let itemLabel = 'éléments';
  export let allowCustomDates = false;

  let showCustomDates = false;

  $: fiscalInfo = getFiscalYearInfo(fiscalStartDay, fiscalStartMonth, fiscalOffset);

  function syncDates() {
    if (mode === 'all') {
      filterStartDate = '';
      filterEndDate = '';
    } else if (mode === 'fiscal') {
      filterStartDate = fiscalInfo.startStr;
      filterEndDate = fiscalInfo.endStr;
    }
  }

  $: {
    // Synchroniser automatiquement les dates quand offset change ou quand mode redevient fiscal
    if (fiscalStartDay && fiscalStartMonth && mode === 'fiscal') {
      filterStartDate = fiscalInfo.startStr;
      filterEndDate = fiscalInfo.endStr;
    }
  }

  export function prevYear() {
    fiscalOffset -= 1;
    mode = 'fiscal';
    syncDates();
  }

  export function nextYear() {
    if (fiscalOffset >= 0) return;
    fiscalOffset += 1;
    mode = 'fiscal';
    syncDates();
  }

  export function resetToCurrent() {
    fiscalOffset = 0;
    mode = 'fiscal';
    syncDates();
  }

  export function toggleAllHistory() {
    if (mode === 'all') {
      resetToCurrent();
    } else {
      mode = 'all';
      syncDates();
    }
  }

  function handleCustomStartChange(event: Event) {
    const val = (event.currentTarget as HTMLInputElement).value;
    filterStartDate = val;
    mode = 'custom';
  }

  function handleCustomEndChange(event: Event) {
    const val = (event.currentTarget as HTMLInputElement).value;
    filterEndDate = val;
    mode = 'custom';
  }

  onMount(async () => {
    try {
      const publicConfig = await api.get<{ fiscalYearStartDay?: number; fiscalYearStartMonth?: number }>('config/public');
      if (publicConfig) {
        if (publicConfig.fiscalYearStartDay) fiscalStartDay = Number(publicConfig.fiscalYearStartDay);
        if (publicConfig.fiscalYearStartMonth) fiscalStartMonth = Number(publicConfig.fiscalYearStartMonth);
      }
    } catch {
      // Ignorer si déjà fourni
    }
    syncDates();
  });
</script>

<div class="fiscal-nav-wrapper">
  <div class="fiscal-nav-main">
    <!-- Contrôles de navigation N-1 / Année / N+1 -->
    <div class="fiscal-stepper">
      <button
        type="button"
        class="nav-btn prev-btn"
        on:click={prevYear}
        title="Consulter l'exercice précédent (N-1)"
      >
        <Icon name="chevron-left" size={16} />
        <span class="btn-text">N-1</span>
      </button>

      <div
        class="fiscal-display-pill"
        class:is-current={fiscalInfo.isCurrent && mode === 'fiscal'}
        class:is-past={!fiscalInfo.isCurrent && mode === 'fiscal'}
        class:is-all={mode === 'all'}
        class:is-custom={mode === 'custom'}
      >
        <div class="pill-top-row">
          <span class="pill-badge">
            {#if mode === 'all'}
              Historique complet
            {:else if mode === 'custom'}
              Période personnalisée
            {:else if fiscalInfo.isCurrent}
              Exercice en cours (N)
            {:else}
              Exercice {fiscalInfo.relativeLabel}
            {/if}
          </span>
          {#if typeof itemCount === 'number'}
            <span class="pill-counter">
              <strong>{itemCount}</strong> {itemLabel}
            </span>
          {/if}
        </div>

        <div class="pill-title-row">
          {#if mode === 'all'}
            <strong class="pill-year">Toutes les dates</strong>
          {:else if mode === 'custom'}
            <strong class="pill-year">Du {formatDate(filterStartDate)} au {formatDate(filterEndDate)}</strong>
          {:else}
            <strong class="pill-year">Exercice {fiscalInfo.labelYear}</strong>
          {/if}
        </div>

        {#if mode === 'fiscal'}
          <div class="pill-dates-row">
            <span>du {formatDate(fiscalInfo.startStr)} au {formatDate(fiscalInfo.endStr)}</span>
          </div>
        {/if}
      </div>

      <!-- Bouton N+1 : masqué ou non cliquable quand on est sur l'exercice en cours -->
      <button
        type="button"
        class="nav-btn next-btn"
        class:disabled-btn={fiscalInfo.isCurrent || mode === 'all'}
        disabled={fiscalInfo.isCurrent || mode === 'all'}
        on:click={nextYear}
        title={fiscalInfo.isCurrent ? 'Vous êtes sur l’exercice en cours (N+1 désactivé)' : 'Consulter l\'exercice suivant (N+1)'}
      >
        <span class="btn-text">N+1</span>
        <Icon name="chevron-right" size={16} />
      </button>
    </div>

    <!-- Actions rapides -->
    <div class="fiscal-quick-actions">
      {#if !fiscalInfo.isCurrent || mode !== 'fiscal'}
        <button
          type="button"
          class="btn btn-secondary btn-small back-current-btn"
          on:click={resetToCurrent}
          title="Revenir à l'exercice comptable en cours"
        >
          <Icon name="refresh" size={14} />
          <span>Exercice en cours</span>
        </button>
      {/if}

      <button
        type="button"
        class="btn btn-small"
        class:btn-primary={mode === 'all'}
        class:btn-secondary={mode !== 'all'}
        on:click={toggleAllHistory}
        title="Voir toutes les écritures sans filtre de date"
      >
        <span>{mode === 'all' ? 'Afficher l\'exercice' : 'Tout l\'historique'}</span>
      </button>

      {#if allowCustomDates}
        <button
          type="button"
          class="btn btn-small"
          class:btn-primary={mode === 'custom' || showCustomDates}
          class:btn-secondary={mode !== 'custom' && !showCustomDates}
          on:click={() => showCustomDates = !showCustomDates}
          title="Sélectionner une plage de dates sur-mesure"
        >
          <span>Dates libres</span>
        </button>
      {/if}
    </div>
  </div>

  {#if allowCustomDates && (showCustomDates || mode === 'custom')}
    <div class="fiscal-custom-dates-bar">
      <label class="custom-date-field">
        <span>Du</span>
        <input
          type="date"
          value={filterStartDate}
          on:change={handleCustomStartChange}
        />
      </label>
      <label class="custom-date-field">
        <span>Au</span>
        <input
          type="date"
          value={filterEndDate}
          on:change={handleCustomEndChange}
        />
      </label>
      <button
        type="button"
        class="text-button"
        on:click={resetToCurrent}
      >
        Réinitialiser à l'exercice
      </button>
    </div>
  {/if}
</div>

<style>
  .fiscal-nav-wrapper {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin-bottom: 1.25rem;
  }

  .fiscal-nav-main {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 14px;
    padding: 0.65rem 1rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
    flex-wrap: wrap;
  }

  .fiscal-stepper {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .nav-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    color: #334155;
    padding: 0.5rem 0.85rem;
    border-radius: 9px;
    font-size: 0.85rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
    user-select: none;
  }

  .nav-btn:hover:not(:disabled) {
    background: #0f172a;
    color: #ffffff;
    border-color: #0f172a;
  }

  .nav-btn.disabled-btn,
  .nav-btn:disabled {
    opacity: 0.32;
    cursor: not-allowed;
    background: #f1f5f9;
    border-color: #e2e8f0;
    color: #94a3b8;
    pointer-events: none;
  }

  .fiscal-display-pill {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-width: 220px;
    padding: 0.45rem 1.1rem;
    border-radius: 11px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    text-align: center;
    transition: all 0.15s ease;
  }

  .fiscal-display-pill.is-current {
    background: #f0fdf4;
    border-color: #bbf7d0;
  }

  .fiscal-display-pill.is-past {
    background: #eff6ff;
    border-color: #bfdbfe;
  }

  .fiscal-display-pill.is-all {
    background: #faf5ff;
    border-color: #e9d5ff;
  }

  .pill-top-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    line-height: 1;
  }

  .pill-badge {
    font-size: 0.72rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .is-current .pill-badge {
    color: #15803d;
  }

  .is-past .pill-badge {
    color: #1d4ed8;
  }

  .is-all .pill-badge {
    color: #7e22ce;
  }

  .pill-counter {
    font-size: 0.72rem;
    color: #64748b;
  }

  .pill-title-row {
    margin-top: 0.2rem;
    line-height: 1.2;
  }

  .pill-year {
    font-size: 1.02rem;
    font-weight: 800;
    color: #0f172a;
  }

  .is-current .pill-year {
    color: #14532d;
  }

  .is-past .pill-year {
    color: #1e3a8a;
  }

  .pill-dates-row {
    font-size: 0.73rem;
    color: #64748b;
    margin-top: 0.15rem;
  }

  .fiscal-quick-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .back-current-btn {
    border-color: #86efac;
    background: #f0fdf4;
    color: #166534;
  }

  .back-current-btn:hover {
    background: #dcfce7;
    border-color: #4ade80;
    color: #14532d;
  }

  .fiscal-custom-dates-bar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    background: #f8fafc;
    border: 1px dashed #cbd5e1;
    border-radius: 10px;
    padding: 0.6rem 1rem;
    flex-wrap: wrap;
  }

  .custom-date-field {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.82rem;
    font-weight: 600;
    color: #475569;
    margin: 0;
  }

  .custom-date-field input {
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    padding: 0.35rem 0.55rem;
    font-size: 0.82rem;
    background: white;
  }

  @media (max-width: 700px) {
    .fiscal-nav-main {
      flex-direction: column;
      align-items: stretch;
    }

    .fiscal-stepper {
      justify-content: space-between;
    }

    .fiscal-display-pill {
      flex: 1;
      min-width: 0;
    }

    .fiscal-quick-actions {
      justify-content: center;
      width: 100%;
    }
  }
</style>
