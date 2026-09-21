<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import AsyncState from '../components/AsyncState.svelte';
  import { api, getToken } from '../lib/api';
  import { currency, formatDate } from '../lib/utils';
  import type { Account, Category, Project } from '../lib/types';

  type PageFormat = 'A4' | 'A4_LANDSCAPE' | 'A3' | 'LETTER';
  let selectedPageFormat: PageFormat = 'A4';
  let generatingPdf = false;
  let generatingAi = false;

  interface ReportResponse {
    association: {
      name: string;
      acronym: string | null;
      siret: string | null;
      rna: string | null;
      email: string | null;
      address: string | null;
      postalCode: string | null;
      city: string | null;
      hasLogo: boolean;
    };
    period: {
      from: string;
      to: string;
      defaultFrom: string;
      defaultTo: string;
    };
    totals: {
      income: number;
      expense: number;
      net: number;
      count: number;
      countIncome: number;
      countExpense: number;
    };
    reconciliation: {
      totalCount: number;
      fullyReconciled: number;
      partiallyReconciled: number;
      unreconciled: number;
      reconciledAmount: number;
      rate: number;
    };
    evolution: Array<{
      period_month: string;
      income: number;
      expense: number;
      net: number;
      count: number;
    }>;
    byCategory: Array<{
      id: string | null;
      parent_id?: string | null;
      name: string;
      kind: string | null;
      color: string | null;
      parent_name: string | null;
      income: number;
      expense: number;
      net: number;
      count: number;
    }>;
    byProject: Array<{
      id: string;
      name: string;
      status: string;
      status_reason: string | null;
      budget: number;
      income: number;
      expense: number;
      net: number;
      count: number;
    }>;
    byPaymentMethod: Array<{
      method: string;
      income: number;
      expense: number;
      count: number;
    }>;
    topExpenses: Array<{
      id: string;
      operation_date: string;
      amount: number;
      description: string;
      category_name: string | null;
      account_name: string;
    }>;
    topIncomes: Array<{
      id: string;
      operation_date: string;
      amount: number;
      description: string;
      category_name: string | null;
      account_name: string;
    }>;
    comparison: {
      previousPeriod: { from: string; to: string };
      previousTotals: {
        income: number;
        expense: number;
        net: number;
        count: number;
      };
      variations: {
        income: { diff: number; percent: number | null };
        expense: { diff: number; percent: number | null };
        net: { diff: number };
      };
    };
  }

  // Section visibility states ("seul ou mélangé")
  let showSummary = true;
  let showEvolution = true;
  let showCategories = true;
  let showProjects = true;
  let showPayments = true;
  let showReconciliation = true;
  let showTop = true;
  let showComparison = true;

  // Filters
  let periodPreset: 'fiscal' | 'month' | 'quarter' | 'year' | 'custom' = 'fiscal';
  let dateFrom = '';
  let dateTo = '';
  let selectedAccountId = '';
  let selectedProjectId = '';
  let selectedCategoryId = '';

  // Data lists for select dropdowns
  let accountsList: Account[] = [];
  let projectsList: Project[] = [];
  let categoriesList: Category[] = [];

  // Report state
  let reportData: ReportResponse | null = null;
  let loading = true;
  let error = '';

  const now = new Date();
  const printDate = now.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  // Monthly evolution interactive chart state
  let hoveredMonthKey: string | null = null;
  let selectedMonthKey: string | null = null;

  $: activeMonthKey = hoveredMonthKey || selectedMonthKey;
  $: activeMonth = (() => {
    if (!reportData || !reportData.evolution || !activeMonthKey) return null;
    const found = reportData.evolution.find((m) => m.period_month === activeMonthKey);
    if (!found) return null;
    const totalInc = Math.max(0.01, reportData.totals.income);
    const totalExp = Math.max(0.01, reportData.totals.expense);
    return {
      ...found,
      label: formatMonthLabel(found.period_month),
      incomePct: (found.income / totalInc) * 100,
      expensePct: (found.expense / totalExp) * 100,
      isPositive: found.net >= 0
    };
  })();

  // Circular category chart state
  let pieMode: 'expense' | 'income' = 'expense';
  let hoveredSliceId: string | null = null;
  let selectedSliceId: string | null = null;

  interface CategorySlice {
    id: string;
    cat: ReportResponse['byCategory'][0];
    name: string;
    amount: number;
    color: string;
    percentage: number;
    path: string;
    dx: number;
    dy: number;
    midAngle: number;
    subcategories: Array<{
      id: string | number | null;
      name: string;
      amount: number;
      pctOfParent: number;
      count: number;
      color: string;
    }>;
  }

  $: pieData = (() => {
    if (!reportData || !reportData.byCategory) return { slices: [] as CategorySlice[], total: 0 };
    const cats = reportData.byCategory;
    const isExp = pieMode === 'expense';

    const items = cats
      .map((c) => ({ ...c, amount: isExp ? (Number(c.expense) || 0) : (Number(c.income) || 0) }))
      .filter((c) => c.amount > 0)
      .sort((a, b) => b.amount - a.amount);

    const total = items.reduce((acc, c) => acc + c.amount, 0);
    if (total <= 0) return { slices: [] as CategorySlice[], total: 0 };

    const cx = 175;
    const cy = 175;
    const R = 130;
    const r = 75;
    let currentAngle = -Math.PI / 2;

    const defaultColors = ['#E76F51', '#2A9D8F', '#F4A261', '#457B9D', '#1D3557', '#9B5DE5', '#F15BB5', '#00BBF9', '#00F5D4', '#7209B7'];

    const slices: CategorySlice[] = items.map((c, idx) => {
      const sliceAngle = (c.amount / total) * (Math.PI * 2);
      const startAngle = currentAngle;
      const endAngle = currentAngle + sliceAngle;
      currentAngle += sliceAngle;

      const midAngle = (startAngle + endAngle) / 2;
      const dx = Math.cos(midAngle) * 14;
      const dy = Math.sin(midAngle) * 14;

      const subInReport = cats.filter((child) =>
        (c.id && (child.parent_id === c.id || (child as any).parentId === c.id)) ||
        (child.parent_name && child.parent_name === c.name && child.id !== c.id)
      );

      const knownSubIds = new Set(subInReport.map((s) => String(s.id)));
      const subInConfig = categoriesList
        .filter((cl) => String(cl.parentId || cl.parent_id) === String(c.id) && !knownSubIds.has(String(cl.id)))
        .map((cl) => ({
          id: cl.id,
          parent_id: c.id,
          name: cl.name,
          kind: cl.kind || c.kind,
          color: cl.color || c.color,
          parent_name: c.name,
          income: 0,
          expense: 0,
          net: 0,
          count: 0
        }));

      const allSub = [...subInReport, ...subInConfig].map((s) => {
        const subAmt = isExp ? (Number(s.expense) || 0) : (Number(s.income) || 0);
        const pctOfParent = c.amount > 0 ? (subAmt / c.amount) * 100 : 0;
        return {
          id: s.id,
          name: s.name,
          amount: subAmt,
          pctOfParent,
          count: Number(s.count) || 0,
          color: s.color || c.color || defaultColors[idx % defaultColors.length]
        };
      });

      let path = '';
      if (items.length === 1) {
        path = `M ${cx} ${cy - R} A ${R} ${R} 0 1 1 ${cx - 0.01} ${cy - R} L ${cx - 0.01} ${cy - r} A ${r} ${r} 0 1 0 ${cx} ${cy - r} Z`;
      } else {
        const x1 = cx + R * Math.cos(startAngle);
        const y1 = cy + R * Math.sin(startAngle);
        const x2 = cx + R * Math.cos(endAngle);
        const y2 = cy + R * Math.sin(endAngle);

        const x3 = cx + r * Math.cos(endAngle);
        const y3 = cy + r * Math.sin(endAngle);
        const x4 = cx + r * Math.cos(startAngle);
        const y4 = cy + r * Math.sin(startAngle);

        const largeArc = sliceAngle > Math.PI ? 1 : 0;
        path = `M ${x1} ${y1} A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${r} ${r} 0 ${largeArc} 0 ${x4} ${y4} Z`;
      }

      const sliceColor = c.color || defaultColors[idx % defaultColors.length];

      return {
        id: String(c.id ?? c.name),
        cat: c,
        name: c.name,
        amount: c.amount,
        color: sliceColor,
        percentage: (c.amount / total) * 100,
        path,
        dx,
        dy,
        midAngle,
        subcategories: allSub
      };
    });

    return { slices, total };
  })();

  $: activeSlice = (() => {
    const targetId = hoveredSliceId || selectedSliceId;
    if (!targetId || !pieData.slices.length) return null;
    return pieData.slices.find((s) => s.id === targetId) || null;
  })();

  function applyPreset(preset: 'fiscal' | 'month' | 'quarter' | 'year' | 'custom') {
    periodPreset = preset;
    const today = new Date();
    const curYear = today.getFullYear();
    const curMonth = today.getMonth();

    if (preset === 'month') {
      const start = new Date(Date.UTC(curYear, curMonth, 1));
      const end = new Date(Date.UTC(curYear, curMonth + 1, 0));
      dateFrom = start.toISOString().slice(0, 10);
      dateTo = end.toISOString().slice(0, 10);
      void loadReport();
    } else if (preset === 'quarter') {
      const start = new Date(Date.UTC(curYear, curMonth - 2, 1));
      const end = new Date(Date.UTC(curYear, curMonth + 1, 0));
      dateFrom = start.toISOString().slice(0, 10);
      dateTo = end.toISOString().slice(0, 10);
      void loadReport();
    } else if (preset === 'year') {
      dateFrom = `${curYear}-01-01`;
      dateTo = `${curYear}-12-31`;
      void loadReport();
    } else if (preset === 'fiscal') {
      dateFrom = '';
      dateTo = '';
      void loadReport();
    }
  }

  function setOnly(section: string) {
    showSummary = section === 'summary';
    showEvolution = section === 'evolution';
    showCategories = section === 'categories';
    showProjects = section === 'projects';
    showPayments = section === 'payments';
    showReconciliation = section === 'reconciliation';
    showTop = section === 'top';
    showComparison = section === 'comparison';
  }

  function selectAll() {
    showSummary = true;
    showEvolution = true;
    showCategories = true;
    showProjects = true;
    showPayments = true;
    showReconciliation = true;
    showTop = true;
    showComparison = true;
  }

  async function loadReport() {
    loading = true;
    error = '';
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo);
      if (selectedAccountId) params.set('accountId', selectedAccountId);
      if (selectedProjectId) params.set('projectId', selectedProjectId);
      if (selectedCategoryId) params.set('categoryId', selectedCategoryId);

      const res = await api.get<ReportResponse>(`reports?${params.toString()}`);
      reportData = res;
      if (!dateFrom && res?.period?.from) dateFrom = res.period.from;
      if (!dateTo && res?.period?.to) dateTo = res.period.to;
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : 'Impossible de charger le rapport.';
    } finally {
      loading = false;
    }
  }

  async function loadFiltersData() {
    try {
      const [accRes, projRes, catRes] = await Promise.all([
        api.get<{ accounts?: Account[] } | Account[]>('accounts'),
        api.get<{ projects?: Project[] } | Project[]>('projects'),
        api.get<{ categories?: Category[] } | Category[]>('categories')
      ]);
      accountsList = Array.isArray(accRes) ? accRes : (accRes?.accounts ?? []);
      projectsList = Array.isArray(projRes) ? projRes : (projRes?.projects ?? []);
      categoriesList = Array.isArray(catRes) ? catRes : (catRes?.categories ?? []);
    } catch {
      // Ignorer
    }
  }

  async function downloadReportPdf(withAi: boolean = false) {
    if (withAi) generatingAi = true;
    else generatingPdf = true;

    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo);
      if (selectedAccountId) params.set('accountId', selectedAccountId);
      if (selectedProjectId) params.set('projectId', selectedProjectId);
      if (selectedCategoryId) params.set('categoryId', selectedCategoryId);
      params.set('pageSize', selectedPageFormat);
      if (withAi) params.set('withAi', 'true');

      const token = getToken();
      const response = await fetch(`/api/reports/pdf?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });

      if (!response.ok) {
        const errorJson = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(errorJson.message || 'Échec de la génération du document PDF.');
      }

      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      const safeFrom = dateFrom || reportData?.period?.from || 'debut';
      const safeTo = dateTo || reportData?.period?.to || 'fin';
      link.download = `rapport-financier-${safeFrom}_${safeTo}${withAi ? '-analyse-ia' : ''}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Erreur lors de la génération du fichier PDF.');
    } finally {
      generatingPdf = false;
      generatingAi = false;
    }
  }

  function formatMonthLabel(ym: string): string {
    const parts = ym.split('-');
    if (parts.length !== 2) return ym;
    const months = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];
    const idx = parseInt(parts[1], 10) - 1;
    return `${months[idx] || parts[1]} ${parts[0]}`;
  }

  function statusMeta(s?: string) {
    switch (s) {
      case 'IDEE': return { label: 'Idée', color: '#7c3aed', bg: '#f5f3ff' };
      case 'MONTAGE': return { label: 'Montage', color: '#0284c7', bg: '#f0f9ff' };
      case 'EN_COURS': return { label: 'En cours', color: '#16a34a', bg: '#f0fdf4' };
      case 'TERMINE': return { label: 'Terminé', color: '#059669', bg: '#ecfdf5' };
      case 'AVORTE': return { label: 'Avorté', color: '#dc2626', bg: '#fef2f2' };
      default: return { label: 'En cours', color: '#16a34a', bg: '#f0fdf4' };
    }
  }

  function paymentMethodLabel(m?: string): string {
    switch (m?.toUpperCase()) {
      case 'CARTE': return 'Carte bancaire';
      case 'CHEQUE': return 'Chèque';
      case 'VIREMENT': return 'Virement bancaire';
      case 'ESPECES': return 'Espèces';
      case 'PRELEVEMENT': return 'Prélèvement';
      case 'NON_SPECIFIE': return 'Non spécifié';
      default: return m || 'Autre';
    }
  }

  onMount(() => {
    void loadFiltersData();
    void loadReport();
  });
</script>

<div class="reports-page">
  <!-- PRINT-ONLY OFFICIAL HEADER (A4 FORMAT) -->
  <header class="print-header">
    <div class="print-header-brand">
      {#if reportData?.association?.hasLogo}
        <img src="/api/config/logo" alt="Logo" class="print-logo" />
      {/if}
      <div>
        <h1 class="print-org-name">{reportData?.association?.name || 'Association'}</h1>
        {#if reportData?.association?.acronym}
          <span class="print-org-acronym">({reportData.association.acronym})</span>
        {/if}
        <p class="print-org-details">
          {#if reportData?.association?.address}{reportData.association.address}, {/if}
          {#if reportData?.association?.postalCode}{reportData.association.postalCode} {/if}
          {#if reportData?.association?.city}{reportData.association.city}{/if}
          {#if reportData?.association?.siret} · SIRET : {reportData.association.siret}{/if}
          {#if reportData?.association?.rna} · RNA : {reportData.association.rna}{/if}
        </p>
      </div>
    </div>
    <div class="print-header-meta">
      <div class="print-doc-badge">Rapport Financier & Comptable</div>
      <div class="print-dates">
        Période : <strong>{formatDate(reportData?.period?.from || dateFrom)}</strong> au <strong>{formatDate(reportData?.period?.to || dateTo)}</strong>
      </div>
      <div class="print-timestamp">Édité le {printDate}</div>
    </div>
  </header>

  <!-- SCREEN-ONLY CONTROLS & FILTERS -->
  <div class="no-print screen-toolbar-panel panel">
    <div class="reports-page-title-row">
      <div>
        <h2>Rapports & Synthèses</h2>
        <p class="subtitle">Analysez l’évolution financière, filtrez selon vos besoins et exportez au format PDF professionnel.</p>
      </div>
      <div class="toolbar-actions">
        <label class="page-format-label">
          <span>Format :</span>
          <select class="page-format-select" bind:value={selectedPageFormat}>
            <option value="A4">A4 Portrait</option>
            <option value="A4_LANDSCAPE">A4 Paysage</option>
            <option value="A3">A3 Grand format</option>
            <option value="LETTER">Lettre US</option>
          </select>
        </label>
        <button
          type="button"
          class="btn btn-primary export-btn"
          disabled={generatingPdf || generatingAi}
          on:click={() => downloadReportPdf(false)}
        >
          {#if generatingPdf}
            <span class="spinner-small"></span> Génération...
          {:else}
            <Icon name="download" size={18}/> Exporter en PDF
          {/if}
        </button>
        <button
          type="button"
          class="btn btn-ai export-btn"
          disabled={generatingPdf || generatingAi}
          on:click={() => downloadReportPdf(true)}
        >
          {#if generatingAi}
            <span class="spinner-small"></span> Analyse IA...
          {:else}
            <span class="ai-sparkle">✨</span> Génération par IA
          {/if}
        </button>
      </div>
    </div>

    <!-- PRESETS & PERIOD SELECTOR -->
    <div class="filter-controls-wrap">
      <div class="filter-row">
        <span class="filter-label">Période :</span>
        <div class="period-presets">
          <button
            type="button"
            class="preset-pill"
            class:active={periodPreset === 'fiscal'}
            on:click={() => applyPreset('fiscal')}
          >
            Exercice en cours
          </button>
          <button
            type="button"
            class="preset-pill"
            class:active={periodPreset === 'month'}
            on:click={() => applyPreset('month')}
          >
            Ce mois-ci
          </button>
          <button
            type="button"
            class="preset-pill"
            class:active={periodPreset === 'quarter'}
            on:click={() => applyPreset('quarter')}
          >
            Trimestre
          </button>
          <button
            type="button"
            class="preset-pill"
            class:active={periodPreset === 'year'}
            on:click={() => applyPreset('year')}
          >
            Année civile
          </button>
        </div>

        <div class="date-range-inputs">
          <label>
            <span>Du</span>
            <input type="date" bind:value={dateFrom} on:change={() => { periodPreset = 'custom'; void loadReport(); }} />
          </label>
          <label>
            <span>Au</span>
            <input type="date" bind:value={dateTo} on:change={() => { periodPreset = 'custom'; void loadReport(); }} />
          </label>
        </div>
      </div>

      <!-- SECONDARY FILTERS -->
      <div class="filter-row secondary-filters">
        <label>
          <span>Compte</span>
          <select bind:value={selectedAccountId} on:change={() => void loadReport()}>
            <option value="">Tous les comptes</option>
            {#each accountsList as acc}
              <option value={acc.id}>{acc.name} ({acc.bank || acc.type})</option>
            {/each}
          </select>
        </label>

        <label>
          <span>Projet</span>
          <select bind:value={selectedProjectId} on:change={() => void loadReport()}>
            <option value="">Tous les projets</option>
            {#each projectsList as prj}
              <option value={prj.id}>{prj.name}</option>
            {/each}
          </select>
        </label>

        <label>
          <span>Catégorie</span>
          <select bind:value={selectedCategoryId} on:change={() => void loadReport()}>
            <option value="">Toutes les catégories</option>
            {#each categoriesList as cat}
              <option value={cat.id}>{cat.name} ({cat.kind})</option>
            {/each}
          </select>
        </label>

        <button type="button" class="btn btn-secondary btn-small refresh-btn" on:click={() => void loadReport()} title="Actualiser le rapport">
          <Icon name="refresh" size={16}/> Actualiser
        </button>
      </div>

      <!-- SECTION SELECTION (SEUL OU MÉLANGÉ) -->
      <div class="sections-picker-row">
        <div class="picker-header">
          <span class="filter-label">Modules du rapport :</span>
          <div class="picker-quick-buttons">
            <button type="button" class="text-button" on:click={selectAll}>Tout cocher</button>
            <span class="sep">·</span>
            <button type="button" class="text-button" on:click={() => setOnly('summary')}>Synthèse seule</button>
            <span class="sep">·</span>
            <button type="button" class="text-button" on:click={() => setOnly('evolution')}>Évolution seule</button>
            <span class="sep">·</span>
            <button type="button" class="text-button" on:click={() => setOnly('categories')}>Catégories seules</button>
            <span class="sep">·</span>
            <button type="button" class="text-button" on:click={() => setOnly('projects')}>Projets seuls</button>
            <span class="sep">·</span>
            <button type="button" class="text-button" on:click={() => setOnly('comparison')}>Comparatif N-1</button>
          </div>
        </div>

        <div class="checkbox-chips-grid">
          <label class="chip-checkbox" class:active={showSummary}>
            <input type="checkbox" bind:checked={showSummary} />
            <span>📊 Synthèse & Chiffres clés</span>
          </label>
          <label class="chip-checkbox" class:active={showEvolution}>
            <input type="checkbox" bind:checked={showEvolution} />
            <span>📈 Évolution temporelle</span>
          </label>
          <label class="chip-checkbox" class:active={showCategories}>
            <input type="checkbox" bind:checked={showCategories} />
            <span>🏷️ Ventilation Catégories</span>
          </label>
          <label class="chip-checkbox" class:active={showProjects}>
            <input type="checkbox" bind:checked={showProjects} />
            <span>🚀 Suivi des Projets</span>
          </label>
          <label class="chip-checkbox" class:active={showPayments}>
            <input type="checkbox" bind:checked={showPayments} />
            <span>💳 Moyens de paiement</span>
          </label>
          <label class="chip-checkbox" class:active={showReconciliation}>
            <input type="checkbox" bind:checked={showReconciliation} />
            <span>🔗 Justification & Rapprochement</span>
          </label>
          <label class="chip-checkbox" class:active={showTop}>
            <input type="checkbox" bind:checked={showTop} />
            <span>⭐ Top Opérations</span>
          </label>
          <label class="chip-checkbox" class:active={showComparison}>
            <input type="checkbox" bind:checked={showComparison} />
            <span>⚖️ Comparatif N vs N-1</span>
          </label>
        </div>
      </div>
    </div>
  </div>

  <!-- MAIN REPORT CONTENT (PRINTABLE & RESPONSIVE) -->
  <AsyncState {loading} {error} empty={!reportData} emptyTitle="Aucun rapport disponible" emptyText="Aucune donnée comptable n’a été trouvée pour la période sélectionnée." onRetry={loadReport}>
    {#if reportData}
      <div class="report-document">

        <!-- 1. SYNTHÈSE GLOBALE & CHIFFRES CLÉS -->
        {#if showSummary}
          <section class="report-section report-card-panel">
            <div class="section-title-wrap">
              <h3 class="section-title">1. Synthèse financière globale</h3>
              <span class="period-tag">Du {formatDate(reportData.period.from)} au {formatDate(reportData.period.to)}</span>
            </div>

            <div class="kpi-grid">
              <div class="kpi-card income-kpi">
                <span class="kpi-label">Total Recettes</span>
                <strong class="kpi-value text-income">{currency.format(reportData.totals.income)}</strong>
                <span class="kpi-sub">{reportData.totals.countIncome} écriture{reportData.totals.countIncome > 1 ? 's' : ''}</span>
              </div>

              <div class="kpi-card expense-kpi">
                <span class="kpi-label">Total Dépenses</span>
                <strong class="kpi-value text-expense">{currency.format(reportData.totals.expense)}</strong>
                <span class="kpi-sub">{reportData.totals.countExpense} écriture{reportData.totals.countExpense > 1 ? 's' : ''}</span>
              </div>

              <div class="kpi-card net-kpi" class:positive={reportData.totals.net >= 0} class:negative={reportData.totals.net < 0}>
                <span class="kpi-label">Résultat Net</span>
                <strong class="kpi-value">{currency.format(reportData.totals.net)}</strong>
                <span class="kpi-sub">
                  {reportData.totals.net >= 0 ? 'Excédent budgétaire' : 'Déficit sur la période'}
                </span>
              </div>

              <div class="kpi-card rec-kpi">
                <span class="kpi-label">Rapprochement</span>
                <strong class="kpi-value">{reportData.reconciliation.rate.toFixed(0)} %</strong>
                <span class="kpi-sub">{reportData.reconciliation.fullyReconciled} / {reportData.reconciliation.totalCount} justifiée{reportData.reconciliation.fullyReconciled > 1 ? 's' : ''}</span>
              </div>
            </div>

            <div class="report-summary-text">
              <p>
                Sur la période du <strong>{formatDate(reportData.period.from)}</strong> au <strong>{formatDate(reportData.period.to)}</strong>,
                l’association enregistre un total de <strong>{currency.format(reportData.totals.income)}</strong> de recettes et de <strong>{currency.format(reportData.totals.expense)}</strong> de dépenses,
                soit un solde net de <strong class:text-income={reportData.totals.net >= 0} class:text-expense={reportData.totals.net < 0}>{currency.format(reportData.totals.net)}</strong>
                ({reportData.totals.net >= 0 ? 'excédentaire' : 'déficitaire'}).
                Le volume d’activité représente <strong>{reportData.totals.count}</strong> transactions comptables.
                Le taux de couverture justificatif atteint <strong>{reportData.reconciliation.rate.toFixed(1)}%</strong>.
              </p>
            </div>
          </section>
        {/if}

        <!-- 2. ÉVOLUTION TEMPORELLE (GRAPH EN BARRES FLOTTANT + TABLEAU) -->
        {#if showEvolution}
          <section class="report-section report-card-panel">
            <div class="section-title-wrap">
              <h3 class="section-title">2. Évolution temporelle des flux</h3>
              <span class="period-tag">{reportData.evolution.length} mois analysé{reportData.evolution.length > 1 ? 's' : ''}</span>
            </div>

            {#if reportData.evolution.length > 0}
              {@const maxVal = Math.max(10, ...reportData.evolution.flatMap((m) => [m.income, m.expense]))}
              {@const colWidth = 720 / Math.max(1, reportData.evolution.length)}

              <div class="evolution-section-wrapper">
                <div class="evolution-toolbar-row">
                  <div class="chart-legend">
                    <span class="legend-item"><span class="legend-box income-box"></span> Recettes</span>
                    <span class="legend-item"><span class="legend-box expense-box"></span> Dépenses</span>
                    <span class="legend-item"><span class="legend-box net-badge-legend"></span> Solde Net mensuel</span>
                  </div>
                  <div class="evolution-hint-text">
                    <span>💡 Survolez ou cliquez une colonne pour la faire flotter et explorer le mois</span>
                  </div>
                </div>

                <div class="evolution-content-grid">
                  <!-- COLONNE GRAPHIQUE EN BARRES INTERACTIF -->
                  <div class="evolution-chart-col">
                    <div class="svg-chart-wrap">
                      <svg viewBox="0 0 800 250" class="responsive-svg-chart" aria-label="Graphique interactif d'évolution des recettes et dépenses par mois">
                        <!-- Lignes de grille horizontales -->
                        <line x1="40" y1="20" x2="780" y2="20" stroke="#e5e7eb" stroke-dasharray="4"/>
                        <line x1="40" y1="70" x2="780" y2="70" stroke="#e5e7eb" stroke-dasharray="4"/>
                        <line x1="40" y1="120" x2="780" y2="120" stroke="#e5e7eb" stroke-dasharray="4"/>
                        <line x1="40" y1="170" x2="780" y2="170" stroke="#e5e7eb" stroke-dasharray="4"/>
                        <line x1="40" y1="205" x2="780" y2="205" stroke="#9ca3af" stroke-width="1.5"/>

                        <!-- Repères de l'axe Y -->
                        <text x="35" y="24" text-anchor="end" font-size="10" fill="#6b7280">{currency.format(maxVal)}</text>
                        <text x="35" y="118" text-anchor="end" font-size="10" fill="#6b7280">{currency.format(maxVal / 2)}</text>
                        <text x="35" y="205" text-anchor="end" font-size="10" fill="#6b7280">0 €</text>

                        <!-- Groupes mensuels interactifs -->
                        <g class="evolution-months-group" class:has-active={Boolean(activeMonthKey)}>
                          {#each reportData.evolution as item, i (item.period_month)}
                            {@const x = 50 + i * colWidth}
                            {@const barW = Math.min(26, colWidth * 0.36)}
                            {@const incH = (item.income / maxVal) * 175}
                            {@const expH = (item.expense / maxVal) * 175}
                            {@const isFloating = activeMonthKey === item.period_month}

                            <!-- svelte-ignore a11y_click_events_have_key_events -->
                            <g
                              class="month-bar-group"
                              class:floating={isFloating}
                              on:mouseenter={() => hoveredMonthKey = item.period_month}
                              on:mouseleave={() => hoveredMonthKey = null}
                              on:click={() => selectedMonthKey = (selectedMonthKey === item.period_month ? null : item.period_month)}
                              role="button"
                              tabindex="0"
                              aria-label="Mois {formatMonthLabel(item.period_month)}"
                            >
                              <!-- Fond de colonne au survol / sélection -->
                              <rect
                                x={x + 2}
                                y={12}
                                width={colWidth - 4}
                                height={226}
                                rx="8"
                                class="month-col-highlight"
                                class:active={isFloating}
                              />

                              <!-- Barre Recettes -->
                              <rect
                                x={x + colWidth * 0.1}
                                y={205 - incH}
                                width={barW}
                                height={incH}
                                fill="#16a34a"
                                rx="3.5"
                                class="bar-income"
                              />

                              <!-- Barre Dépenses -->
                              <rect
                                x={x + colWidth * 0.1 + barW + 4}
                                y={205 - expH}
                                width={barW}
                                height={expH}
                                fill="#e76f51"
                                rx="3.5"
                                class="bar-expense"
                              />

                              <!-- Badge montant net flottant au dessus de la plus haute barre -->
                              {#if isFloating}
                                <g class="month-floating-badge" pointer-events="none">
                                  <rect
                                    x={x + colWidth * 0.1 + barW - 32}
                                    y={Math.max(8, 205 - Math.max(incH, expH) - 26)}
                                    width="68"
                                    height="20"
                                    rx="5"
                                    fill="#111827"
                                    opacity="0.92"
                                  />
                                  <text
                                    x={x + colWidth * 0.1 + barW + 2}
                                    y={Math.max(22, 205 - Math.max(incH, expH) - 12)}
                                    text-anchor="middle"
                                    font-size="9.5"
                                    font-weight="700"
                                    fill={item.net >= 0 ? '#4ade80' : '#f87171'}
                                  >
                                    {item.net > 0 ? '+' : ''}{currency.format(item.net)}
                                  </text>
                                </g>
                              {/if}

                              <!-- Libellé du mois -->
                              <text
                                x={x + colWidth * 0.1 + barW + 2}
                                y="225"
                                text-anchor="middle"
                                class="month-axis-label"
                                class:active={isFloating}
                              >
                                {formatMonthLabel(item.period_month)}
                              </text>
                            </g>
                          {/each}
                        </g>
                      </svg>
                    </div>
                  </div>

                  <!-- COLONNE PANNEAU DÉTAIL DU MOIS FLOTTANT -->
                  <div class="evolution-detail-col">
                    {#if activeMonth}
                      <div class="month-detail-card" class:positive={activeMonth.isPositive} class:negative={!activeMonth.isPositive}>
                        <div class="month-detail-header">
                          <div>
                            <span class="month-kpi-sub">Bilan mensuel détaillé</span>
                            <h4 class="month-title">{activeMonth.label}</h4>
                          </div>
                          <div class="month-net-badge" class:badge-green={activeMonth.isPositive} class:badge-red={!activeMonth.isPositive}>
                            <span>Solde : </span>
                            <strong>{activeMonth.net > 0 ? '+' : ''}{currency.format(activeMonth.net)}</strong>
                          </div>
                        </div>

                        <!-- Barres et répartition des flux du mois -->
                        <div class="month-flows-breakdown">
                          <!-- Recettes du mois -->
                          <div class="month-flow-row">
                            <div class="flow-header">
                              <span class="flow-name text-income">📈 Recettes</span>
                              <strong class="flow-amount">{currency.format(activeMonth.income)}</strong>
                            </div>
                            <div class="subcat-progress-track">
                              <div class="subcat-progress-fill" style:width="{Math.min(100, Math.max(0, activeMonth.incomePct))}%" style:background="#16a34a"></div>
                            </div>
                            <small class="flow-share">{activeMonth.incomePct.toFixed(1)}% des recettes globales</small>
                          </div>

                          <!-- Dépenses du mois -->
                          <div class="month-flow-row">
                            <div class="flow-header">
                              <span class="flow-name text-expense">📉 Dépenses</span>
                              <strong class="flow-amount">{currency.format(activeMonth.expense)}</strong>
                            </div>
                            <div class="subcat-progress-track">
                              <div class="subcat-progress-fill" style:width="{Math.min(100, Math.max(0, activeMonth.expensePct))}%" style:background="#e76f51"></div>
                            </div>
                            <small class="flow-share">{activeMonth.expensePct.toFixed(1)}% des dépenses globales</small>
                          </div>
                        </div>

                        <div class="month-card-footer">
                          <span class="month-count-tag">
                            📝 <strong>{activeMonth.count}</strong> opération{activeMonth.count > 1 ? 's' : ''} comptable{activeMonth.count > 1 ? 's' : ''}
                          </span>
                          <span class="month-status-pill" class:pill-green={activeMonth.isPositive} class:pill-red={!activeMonth.isPositive}>
                            {activeMonth.isPositive ? 'Excédent budgétaire' : 'Déficit sur le mois'}
                          </span>
                        </div>
                      </div>
                    {:else}
                      <!-- Panneau d'instruction avec boutons mois cliquables -->
                      <div class="month-placeholder-card">
                        <div class="placeholder-icon">📈</div>
                        <h4>Exploration temporelle des mois</h4>
                        <p>Survolez ou cliquez sur une colonne du graphique pour la voir <strong>s'écarter en mode flottant</strong> et faire apparaître son bilan mensuel détaillé.</p>

                        <div class="slice-chips-list">
                          {#each reportData.evolution as m}
                            <button
                              type="button"
                              class="slice-chip"
                              on:mouseenter={() => hoveredMonthKey = m.period_month}
                              on:mouseleave={() => hoveredMonthKey = null}
                              on:click={() => selectedMonthKey = m.period_month}
                            >
                              <span class="chip-bullet" style:background={m.net >= 0 ? '#16a34a' : '#e76f51'}></span>
                              <span class="chip-label">{formatMonthLabel(m.period_month)}</span>
                              <span class="chip-val" class:text-income={m.net >= 0} class:text-expense={m.net < 0}>
                                {m.net > 0 ? '+' : ''}{currency.format(m.net)}
                              </span>
                            </button>
                          {/each}
                        </div>
                      </div>
                    {/if}
                  </div>
                </div>
              </div>

              <!-- DETAILED EVOLUTION TABLE -->
              <div class="table-wrap" style="margin-top: 1.25rem;">
                <table class="report-table">
                  <thead>
                    <tr>
                      <th>Période</th>
                      <th class="text-right">Recettes</th>
                      <th class="text-right">Dépenses</th>
                      <th class="text-right">Solde du mois</th>
                      <th class="text-center">Écritures</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each reportData.evolution as item}
                      <tr class:row-highlight={activeMonthKey === item.period_month}>
                        <td><strong>{formatMonthLabel(item.period_month)}</strong></td>
                        <td class="text-right text-income font-medium">{currency.format(item.income)}</td>
                        <td class="text-right text-expense font-medium">{currency.format(item.expense)}</td>
                        <td class="text-right font-bold" class:text-income={item.net >= 0} class:text-expense={item.net < 0}>
                          {item.net > 0 ? '+' : ''}{currency.format(item.net)}
                        </td>
                        <td class="text-center">{item.count}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {:else}
              <p class="empty-notice">Aucune opération n’a été passée sur cette période.</p>
            {/if}
          </section>
        {/if}

        <!-- 3. VENTILATION PAR CATÉGORIES -->
        {#if showCategories}
          <section class="report-section report-card-panel">
            <div class="section-title-wrap">
              <h3 class="section-title">3. Ventilation analytique par catégorie</h3>
              <span class="period-tag">{reportData.byCategory.length} catégorie{reportData.byCategory.length > 1 ? 's' : ''} mouvementée{reportData.byCategory.length > 1 ? 's' : ''}</span>
            </div>

            {#if reportData.byCategory.length > 0}
            <!-- GRAPHIQUE CIRCULAIRE INTERACTIF AVEC PORTIONS FLOTTANTES & SOUS-CATÉGORIES -->
            <div class="pie-section-wrapper">
              <div class="pie-toolbar-row">
                <div class="pie-mode-toggle">
                  <button
                    type="button"
                    class="btn-toggle-pill"
                    class:active={pieMode === 'expense'}
                    on:click={() => { pieMode = 'expense'; selectedSliceId = null; hoveredSliceId = null; }}
                  >
                    📉 Dépenses ({currency.format(reportData.totals.expense)})
                  </button>
                  <button
                    type="button"
                    class="btn-toggle-pill"
                    class:active={pieMode === 'income'}
                    on:click={() => { pieMode = 'income'; selectedSliceId = null; hoveredSliceId = null; }}
                  >
                    📈 Recettes ({currency.format(reportData.totals.income)})
                  </button>
                </div>
                <div class="pie-hint-text">
                  <span>💡 Survolez ou cliquez une portion pour l’écarter et explorer ses sous-catégories</span>
                </div>
              </div>

              {#if pieData.slices.length > 0}
                <div class="pie-content-grid">
                  <!-- SVG DONUT AVEC PORTIONS FLOTTANTES -->
                  <div class="pie-chart-col">
                    <svg viewBox="0 0 350 350" class="pie-svg-element" role="img" aria-label="Graphique circulaire interactif des catégories">
                      <g class="pie-slices-group">
                        {#each pieData.slices as slice (slice.id)}
                          {@const isFloating = activeSlice?.id === slice.id}
                          <!-- svelte-ignore a11y_click_events_have_key_events -->
                          <path
                            d={slice.path}
                            class="pie-slice-path"
                            class:floating={isFloating}
                            style:fill={slice.color}
                            style:transform={isFloating ? `translate(${slice.dx}px, ${slice.dy}px) scale(1.03)` : 'translate(0,0)'}
                            on:mouseenter={() => hoveredSliceId = slice.id}
                            on:mouseleave={() => hoveredSliceId = null}
                            on:click={() => selectedSliceId = (selectedSliceId === slice.id ? null : slice.id)}
                            role="button"
                            tabindex="0"
                          >
                            <title>{slice.name} : {currency.format(slice.amount)} ({slice.percentage.toFixed(1)}%)</title>
                          </path>
                        {/each}
                      </g>

                      <!-- Centre du donut -->
                      <g class="pie-center-content" pointer-events="none">
                        {#if activeSlice}
                          <text x="175" y="152" text-anchor="middle" class="pie-center-label">{activeSlice.name.length > 18 ? activeSlice.name.slice(0, 16) + '…' : activeSlice.name}</text>
                          <text x="175" y="177" text-anchor="middle" class="pie-center-amount">{currency.format(activeSlice.amount)}</text>
                          <text x="175" y="198" text-anchor="middle" class="pie-center-pct">{activeSlice.percentage.toFixed(1)} % du total</text>
                        {:else}
                          <text x="175" y="152" text-anchor="middle" class="pie-center-sub">TOTAL {pieMode === 'expense' ? 'DÉPENSES' : 'RECETTES'}</text>
                          <text x="175" y="177" text-anchor="middle" class="pie-center-amount">{currency.format(pieData.total)}</text>
                          <text x="175" y="198" text-anchor="middle" class="pie-center-pct">{pieData.slices.length} catégories</text>
                        {/if}
                      </g>
                    </svg>
                  </div>

                  <!-- PANNEAU DÉTAIL & SOUS-CATÉGORIES FLOTTANT -->
                  <div class="pie-detail-col">
                    {#if activeSlice}
                      <div class="slice-detail-card" style:border-left-color={activeSlice.color}>
                        <div class="slice-detail-header">
                          <div class="slice-header-left">
                            <span class="color-bullet-large" style:background={activeSlice.color}></span>
                            <div>
                              <h4 class="slice-title">{activeSlice.name}</h4>
                              {#if activeSlice.cat.parent_name}
                                <span class="slice-parent-tag">Rattachée à : <strong>{activeSlice.cat.parent_name}</strong></span>
                              {/if}
                            </div>
                          </div>
                          <div class="slice-header-right">
                            <span class="slice-amount">{currency.format(activeSlice.amount)}</span>
                            <span class="slice-share-badge" style:background={activeSlice.color + '20'} style:color={activeSlice.color}>
                              {activeSlice.percentage.toFixed(1)} %
                            </span>
                          </div>
                        </div>

                        <!-- SOUS-CATÉGORIES ASSOCIÉES -->
                        <div class="subcategories-panel">
                          <div class="subcategories-panel-header">
                            <span class="subcat-title">Sous-catégories rattachées</span>
                            <span class="badge-mini">{activeSlice.subcategories.length}</span>
                          </div>

                          {#if activeSlice.subcategories.length > 0}
                            <div class="subcategories-list">
                              {#each activeSlice.subcategories as sub}
                                <div class="subcat-item">
                                  <div class="subcat-row">
                                    <div class="subcat-left">
                                      <span class="subcat-bullet" style:background={sub.color}></span>
                                      <span class="subcat-name">{sub.name}</span>
                                    </div>
                                    <div class="subcat-right">
                                      <strong>{currency.format(sub.amount)}</strong>
                                      {#if sub.amount > 0}
                                        <span class="subcat-pct">({sub.pctOfParent.toFixed(0)}%)</span>
                                      {:else}
                                        <span class="subcat-empty">0 €</span>
                                      {/if}
                                    </div>
                                  </div>
                                  {#if sub.amount > 0}
                                    <div class="subcat-progress-track">
                                      <div class="subcat-progress-fill" style:width="{Math.min(100, Math.max(2, sub.pctOfParent))}%" style:background={sub.color}></div>
                                    </div>
                                  {/if}
                                </div>
                              {/each}
                            </div>
                          {:else}
                            <div class="subcat-empty-notice">
                              <span>ℹ️ Aucune sous-catégorie rattachée à cette rubrique principale.</span>
                            </div>
                          {/if}
                        </div>
                      </div>
                    {:else}
                      <!-- Panneau d'instruction avec badges cliquables -->
                      <div class="pie-placeholder-card">
                        <div class="placeholder-icon">🎯</div>
                        <h4>Exploration circulaire par catégorie</h4>
                        <p>Survolez ou cliquez sur une portion du cercle pour la voir <strong>s'écarter en mode flottant</strong> et faire apparaître ses sous-catégories.</p>

                        <div class="slice-chips-list">
                          {#each pieData.slices as s}
                            <button
                              type="button"
                              class="slice-chip"
                              on:mouseenter={() => hoveredSliceId = s.id}
                              on:mouseleave={() => hoveredSliceId = null}
                              on:click={() => selectedSliceId = s.id}
                            >
                              <span class="color-bullet" style:background={s.color}></span>
                              <span class="chip-label">{s.name}</span>
                              <span class="chip-val">{s.percentage.toFixed(0)}%</span>
                            </button>
                          {/each}
                        </div>
                      </div>
                    {/if}
                  </div>
                </div>
              {:else}
                <div class="empty-pie-notice">
                  <p>Aucune transaction enregistrée pour les {pieMode === 'expense' ? 'dépenses' : 'recettes'} sur cette période.</p>
                </div>
              {/if}
            </div>

              <!-- TABLEAU COMPLET DES CATÉGORIES -->
              <div class="table-wrap" style="margin-top: 1.25rem;">
                <table class="report-table">
                  <thead>
                    <tr>
                      <th>Catégorie</th>
                      <th>Type</th>
                      <th>Catégorie parente</th>
                      <th class="text-right">Recettes</th>
                      <th class="text-right">Dépenses</th>
                      <th class="text-right">Solde Net</th>
                      <th class="text-center">Nb</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each reportData.byCategory as cat}
                      <tr>
                        <td>
                          <div class="cell-flex">
                            <span class="color-bullet" style:background={cat.color || '#3b8068'}></span>
                            <strong>{cat.name}</strong>
                          </div>
                        </td>
                        <td><span class="soft-badge">{cat.kind || 'DEPENSE'}</span></td>
                        <td>{cat.parent_name || '—'}</td>
                        <td class="text-right text-income">{cat.income > 0 ? currency.format(cat.income) : '—'}</td>
                        <td class="text-right text-expense">{cat.expense > 0 ? currency.format(cat.expense) : '—'}</td>
                        <td class="text-right font-bold" class:text-income={cat.net >= 0} class:text-expense={cat.net < 0}>
                          {cat.net > 0 ? '+' : ''}{currency.format(cat.net)}
                        </td>
                        <td class="text-center">{cat.count}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {:else}
              <p class="empty-notice">Aucune catégorie n’est associée aux transactions de cette période.</p>
            {/if}
          </section>
        {/if}

        <!-- 4. SUIVI DES PROJETS & BUDGETS -->
        {#if showProjects}
          <section class="report-section report-card-panel">
            <div class="section-title-wrap">
              <h3 class="section-title">4. Suivi des projets & consommations budgétaires</h3>
              <span class="period-tag">{reportData.byProject.length} projet{reportData.byProject.length > 1 ? 's' : ''}</span>
            </div>

            {#if reportData.byProject.length > 0}
              <div class="projects-report-grid">
                {#each reportData.byProject as proj}
                  {@const meta = statusMeta(proj.status)}
                  {@const budget = proj.budget || 0}
                  {@const consumedPct = budget > 0 ? ((proj.expense / budget) * 100) : 0}
                  {@const remaining = budget - proj.expense}
                  <div class="project-report-card">
                    <div class="proj-card-top">
                      <div>
                        <h4 class="proj-name">{proj.name}</h4>
                        <span class="status-badge-custom" style:background={meta.bg} style:color={meta.color} style:border={`1px solid ${meta.color}40`}>
                          {meta.label}
                        </span>
                      </div>
                      <div class="proj-budget-kpi">
                        <small>Budget voté</small>
                        <strong>{currency.format(budget)}</strong>
                      </div>
                    </div>

                    {#if proj.status_reason}
                      <p class="proj-status-note">💬 {proj.status_reason}</p>
                    {/if}

                    <div class="budget-gauge-wrap">
                      <div class="gauge-labels">
                        <span>Consommé : {consumedPct.toFixed(1)}%</span>
                        <span class:text-expense={remaining < 0}>
                          {remaining >= 0 ? `Reste : ${currency.format(remaining)}` : `Dépassement : ${currency.format(Math.abs(remaining))}`}
                        </span>
                      </div>
                      <div class="progress-track">
                        <div
                          class="progress-fill"
                          class:over-budget={consumedPct > 100}
                          style:width={`${Math.min(100, Math.max(1, consumedPct))}%`}
                          style:background={consumedPct > 100 ? '#dc2626' : consumedPct > 80 ? '#f59e0b' : '#16a34a'}
                        ></div>
                      </div>
                    </div>

                    <div class="proj-financials-row">
                      <div>
                        <span>Recettes</span>
                        <strong class="text-income">{currency.format(proj.income)}</strong>
                      </div>
                      <div>
                        <span>Dépenses</span>
                        <strong class="text-expense">{currency.format(proj.expense)}</strong>
                      </div>
                      <div>
                        <span>Solde Net</span>
                        <strong class:text-income={proj.net >= 0} class:text-expense={proj.net < 0}>
                          {proj.net > 0 ? '+' : ''}{currency.format(proj.net)}
                        </strong>
                      </div>
                    </div>
                  </div>
                {/each}
              </div>
            {:else}
              <p class="empty-notice">Aucun projet n’a d’activité sur cette période.</p>
            {/if}
          </section>
        {/if}

        <!-- 5. MOYENS DE PAIEMENT -->
        {#if showPayments}
          <section class="report-section report-card-panel">
            <div class="section-title-wrap">
              <h3 class="section-title">5. Répartition des moyens de paiement</h3>
              <span class="period-tag">Modes de règlement</span>
            </div>

            {#if reportData.byPaymentMethod.length > 0}
              <div class="table-wrap">
                <table class="report-table">
                  <thead>
                    <tr>
                      <th>Mode de règlement</th>
                      <th class="text-right">Recettes</th>
                      <th class="text-right">Dépenses</th>
                      <th class="text-center">Nombre d’opérations</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each reportData.byPaymentMethod as pay}
                      <tr>
                        <td><strong>{paymentMethodLabel(pay.method)}</strong></td>
                        <td class="text-right text-income">{pay.income > 0 ? currency.format(pay.income) : '—'}</td>
                        <td class="text-right text-expense">{pay.expense > 0 ? currency.format(pay.expense) : '—'}</td>
                        <td class="text-center">{pay.count}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {:else}
              <p class="empty-notice">Aucun mode de paiement renseigné.</p>
            {/if}
          </section>
        {/if}

        <!-- 6. JUSTIFICATION & RAPPROCHEMENT -->
        {#if showReconciliation}
          <section class="report-section report-card-panel">
            <div class="section-title-wrap">
              <h3 class="section-title">6. Rapprochement bancaire & contrôle interne</h3>
              <span class="period-tag">Traçabilité des justificatifs</span>
            </div>

            <div class="rec-stats-grid">
              <div class="rec-stat-card">
                <span class="stat-number text-income">{reportData.reconciliation.fullyReconciled}</span>
                <span class="stat-title">Opérations 100% justifiées</span>
                <small>Rapprochement facture & relevé validé</small>
              </div>
              <div class="rec-stat-card">
                <span class="stat-number" style="color: #f59e0b;">{reportData.reconciliation.partiallyReconciled}</span>
                <span class="stat-title">Rapprochements partiels</span>
                <small>Paiement fractionné ou solde en cours</small>
              </div>
              <div class="rec-stat-card">
                <span class="stat-number" class:text-expense={reportData.reconciliation.unreconciled > 0}>{reportData.reconciliation.unreconciled}</span>
                <span class="stat-title">Opérations sans justificatif</span>
                <small>Nécessitent un ticket ou facture</small>
              </div>
              <div class="rec-stat-card">
                <span class="stat-number">{reportData.reconciliation.rate.toFixed(1)}%</span>
                <span class="stat-title">Taux de couverture comptable</span>
                <small>Conformité avec les règles associatives</small>
              </div>
            </div>
          </section>
        {/if}

        <!-- 7. TOP OPÉRATIONS -->
        {#if showTop}
          <section class="report-section report-card-panel">
            <div class="section-title-wrap">
              <h3 class="section-title">7. Opérations marquantes</h3>
              <span class="period-tag">Top 5 Recettes & Dépenses</span>
            </div>

            <div class="top-tables-grid">
              <div>
                <h4 class="sub-table-title text-income">Top 5 Recettes</h4>
                <table class="report-table mini-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description</th>
                      <th class="text-right">Montant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each reportData.topIncomes as op}
                      <tr>
                        <td>{formatDate(op.operation_date)}</td>
                        <td><strong>{op.description}</strong><br><small>{op.category_name || 'Sans catégorie'} · {op.account_name}</small></td>
                        <td class="text-right text-income font-bold">{currency.format(op.amount)}</td>
                      </tr>
                    {:else}
                      <tr><td colspan="3" class="text-center">Aucune recette enregistrée</td></tr>
                    {/each}
                  </tbody>
                </table>
              </div>

              <div>
                <h4 class="sub-table-title text-expense">Top 5 Dépenses</h4>
                <table class="report-table mini-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description</th>
                      <th class="text-right">Montant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each reportData.topExpenses as op}
                      <tr>
                        <td>{formatDate(op.operation_date)}</td>
                        <td><strong>{op.description}</strong><br><small>{op.category_name || 'Sans catégorie'} · {op.account_name}</small></td>
                        <td class="text-right text-expense font-bold">{currency.format(op.amount)}</td>
                      </tr>
                    {:else}
                      <tr><td colspan="3" class="text-center">Aucune dépense enregistrée</td></tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        {/if}

        <!-- 8. COMPARATIF N vs N-1 -->
        {#if showComparison}
          <section class="report-section report-card-panel">
            <div class="section-title-wrap">
              <h3 class="section-title">8. Comparatif avec l’exercice précédent (N vs N-1)</h3>
              <span class="period-tag">Période comparable : {formatDate(reportData.comparison.previousPeriod.from)} au {formatDate(reportData.comparison.previousPeriod.to)}</span>
            </div>

            <div class="comparison-cards-grid">
              <div class="comparison-card">
                <span class="comp-label">Recettes</span>
                <div class="comp-figures">
                  <div>
                    <small>N (actuel)</small>
                    <strong class="text-income">{currency.format(reportData.totals.income)}</strong>
                  </div>
                  <div class="comp-vs">vs</div>
                  <div>
                    <small>N-1</small>
                    <span>{currency.format(reportData.comparison.previousTotals.income)}</span>
                  </div>
                </div>
                <div class="comp-delta" class:positive={reportData.comparison.variations.income.diff >= 0} class:negative={reportData.comparison.variations.income.diff < 0}>
                  {reportData.comparison.variations.income.diff >= 0 ? '▲ +' : '▼ '}
                  {currency.format(reportData.comparison.variations.income.diff)}
                  {#if reportData.comparison.variations.income.percent !== null}
                    ({reportData.comparison.variations.income.percent.toFixed(1)}%)
                  {/if}
                </div>
              </div>

              <div class="comparison-card">
                <span class="comp-label">Dépenses</span>
                <div class="comp-figures">
                  <div>
                    <small>N (actuel)</small>
                    <strong class="text-expense">{currency.format(reportData.totals.expense)}</strong>
                  </div>
                  <div class="comp-vs">vs</div>
                  <div>
                    <small>N-1</small>
                    <span>{currency.format(reportData.comparison.previousTotals.expense)}</span>
                  </div>
                </div>
                <div class="comp-delta" class:positive={reportData.comparison.variations.expense.diff <= 0} class:negative={reportData.comparison.variations.expense.diff > 0}>
                  {reportData.comparison.variations.expense.diff > 0 ? '▲ +' : '▼ '}
                  {currency.format(reportData.comparison.variations.expense.diff)}
                  {#if reportData.comparison.variations.expense.percent !== null}
                    ({reportData.comparison.variations.expense.percent.toFixed(1)}%)
                  {/if}
                </div>
              </div>

              <div class="comparison-card">
                <span class="comp-label">Résultat Net</span>
                <div class="comp-figures">
                  <div>
                    <small>N (actuel)</small>
                    <strong class:text-income={reportData.totals.net >= 0} class:text-expense={reportData.totals.net < 0}>
                      {currency.format(reportData.totals.net)}
                    </strong>
                  </div>
                  <div class="comp-vs">vs</div>
                  <div>
                    <small>N-1</small>
                    <span>{currency.format(reportData.comparison.previousTotals.net)}</span>
                  </div>
                </div>
                <div class="comp-delta" class:positive={reportData.comparison.variations.net.diff >= 0} class:negative={reportData.comparison.variations.net.diff < 0}>
                  {reportData.comparison.variations.net.diff >= 0 ? '▲ +' : '▼ '}
                  {currency.format(reportData.comparison.variations.net.diff)}
                </div>
              </div>
            </div>
          </section>
        {/if}

        <!-- PRINT FOOTER (A4 FORMAT) -->
        <footer class="print-footer">
          <div class="print-footer-rule"></div>
          <div class="print-footer-content">
            <span>{reportData.association.name || 'Association'} · Document comptable certifié</span>
            <span>Page 1 / 1 · Généré via TrésoGem</span>
          </div>
        </footer>

      </div>
    {/if}
  </AsyncState>
</div>

<style>
  /* =========================================
     GLOBAL & SCREEN STYLES
     ========================================= */
  .reports-page {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .screen-toolbar-panel {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    padding: 1.5rem;
    background: white;
    border: 1px solid var(--line);
    border-radius: 14px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.03);
  }

  .reports-page-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    border-bottom: 1px solid var(--line);
    padding-bottom: 1rem;
  }

  .reports-page-title-row h2 {
    margin: 0;
    font-size: 1.5rem;
    color: var(--ink);
  }

  .subtitle {
    margin: 0.25rem 0 0;
    font-size: 0.88rem;
    color: var(--muted);
  }

  .toolbar-actions {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    flex-wrap: wrap;
  }

  .page-format-label {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--ink);
  }

  .page-format-select {
    padding: 0.5rem 0.75rem;
    font-size: 0.85rem;
    font-weight: 600;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: white;
    color: var(--ink);
    cursor: pointer;
  }

  .export-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 1.1rem;
    font-size: 0.88rem;
    font-weight: 700;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .btn-ai {
    background: linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%);
    color: white;
    border: none;
    box-shadow: 0 2px 6px rgba(124, 58, 237, 0.25);
  }

  .btn-ai:hover:not(:disabled) {
    background: linear-gradient(135deg, #6d28d9 0%, #4338ca 100%);
    box-shadow: 0 4px 10px rgba(124, 58, 237, 0.35);
    transform: translateY(-1px);
  }

  .btn-ai:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  .ai-sparkle {
    font-size: 1rem;
    display: inline-block;
  }

  .spinner-small {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top: 2px solid #ffffff;
    border-radius: 50%;
    display: inline-block;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .filter-controls-wrap {
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
  }

  .filter-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .filter-label {
    font-weight: 700;
    font-size: 0.85rem;
    color: var(--ink);
    min-width: 90px;
  }

  .period-presets {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .preset-pill {
    background: #f1f5f3;
    border: 1px solid #d1ded7;
    border-radius: 99px;
    padding: 0.35rem 0.85rem;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--ink);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .preset-pill:hover {
    background: #e2ede7;
    border-color: var(--green);
  }

  .preset-pill.active {
    background: var(--green);
    color: white;
    border-color: var(--green);
  }

  .date-range-inputs {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-left: auto;
  }

  .date-range-inputs label,
  .secondary-filters label {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.82rem;
    color: var(--muted);
    font-weight: 600;
  }

  .date-range-inputs input,
  .secondary-filters select {
    padding: 0.4rem 0.65rem;
    font-size: 0.85rem;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: white;
  }

  .secondary-filters {
    padding-top: 0.4rem;
    border-top: 1px dashed var(--line);
  }

  .refresh-btn {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  .sections-picker-row {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.85rem 1rem;
    background: #f8faf9;
    border: 1px solid #dce5df;
    border-radius: 10px;
  }

  .picker-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .picker-quick-buttons {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8rem;
  }

  .picker-quick-buttons .sep {
    color: #9ca3af;
  }

  .checkbox-chips-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 0.5rem;
  }

  .chip-checkbox {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 0.75rem;
    background: white;
    border: 1px solid #d1ded7;
    border-radius: 8px;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--ink);
    cursor: pointer;
    transition: all 0.15s ease;
    user-select: none;
  }

  .chip-checkbox:hover {
    border-color: var(--green);
    background: #f0fdf4;
  }

  .chip-checkbox.active {
    border-color: var(--green);
    background: #eef7f2;
    color: var(--green);
  }

  /* =========================================
     REPORT DOCUMENT & SECTIONS
     ========================================= */
  .report-document {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .report-section {
    background: white;
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 1.5rem;
    box-shadow: 0 2px 8px rgba(0,0,0,0.03);
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .section-title-wrap {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1.25rem;
    border-bottom: 2px solid var(--line);
    padding-bottom: 0.65rem;
    flex-wrap: wrap;
  }

  .section-title {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 800;
    color: var(--ink);
  }

  .period-tag {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--muted);
    background: #f3f4f6;
    padding: 0.25rem 0.65rem;
    border-radius: 99px;
  }

  /* KPIs */
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
    margin-bottom: 1.25rem;
  }

  .kpi-card {
    background: #f9fafb;
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .kpi-label {
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .kpi-value {
    font-size: 1.6rem;
    font-weight: 800;
    color: var(--ink);
  }

  .kpi-sub {
    font-size: 0.78rem;
    color: var(--muted);
  }

  .income-kpi { border-left: 4px solid #16a34a; background: #f0fdf4; }
  .expense-kpi { border-left: 4px solid #e76f51; background: #fef7f5; }
  .net-kpi.positive { border-left: 4px solid var(--green); background: #f4faf6; }
  .net-kpi.negative { border-left: 4px solid #dc2626; background: #fef2f2; }
  .rec-kpi { border-left: 4px solid #0284c7; background: #f0f9ff; }

  .text-income { color: #16a34a; }
  .text-expense { color: #dc2626; }

  .report-summary-text {
    background: #fbfdfc;
    border-left: 4px solid var(--green);
    padding: 0.85rem 1.15rem;
    border-radius: 6px;
    font-size: 0.92rem;
    line-height: 1.5;
    color: #2c3e35;
  }

  /* CHART STYLES */
  .chart-legend {
    display: flex;
    align-items: center;
    gap: 1.25rem;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--muted);
  }

  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }

  .legend-box {
    width: 12px;
    height: 12px;
    border-radius: 3px;
    display: inline-block;
  }

  .income-box { background: #16a34a; }
  .expense-box { background: #e76f51; }

  .svg-chart-wrap {
    width: 100%;
    background: #fafcfb;
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 0.5rem;
  }

  .responsive-svg-chart {
    width: 100%;
    height: auto;
    display: block;
  }

  /* TABLES */
  .report-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
  }

  .report-table th {
    background: #f3f6f4;
    padding: 0.65rem 0.75rem;
    font-weight: 700;
    color: var(--ink);
    border-bottom: 2px solid var(--line);
  }

  .report-table td {
    padding: 0.65rem 0.75rem;
    border-bottom: 1px solid #edf2ef;
    vertical-align: middle;
  }

  .mini-table th, .mini-table td {
    padding: 0.5rem 0.6rem;
    font-size: 0.82rem;
  }

  .cell-flex {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }

  .color-bullet {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    display: inline-block;
    flex-shrink: 0;
  }

  /* EVOLUTION INTERACTIVE SECTION */
  .evolution-section-wrapper {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    background: #fcfdfc;
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 1.25rem;
  }

  .evolution-toolbar-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .evolution-hint-text {
    font-size: 0.82rem;
    color: var(--muted);
    font-weight: 500;
  }

  .net-badge-legend {
    background: #111827;
  }

  .evolution-content-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) minmax(320px, 1fr);
    gap: 1.5rem;
    align-items: center;
  }

  @media (max-width: 960px) {
    .evolution-content-grid {
      grid-template-columns: 1fr;
    }
  }

  .evolution-chart-col {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-width: 0;
  }

  .month-bar-group {
    cursor: pointer;
    outline: none;
    transition: transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  .month-bar-group.floating {
    transform: translateY(-8px);
  }

  .month-col-highlight {
    fill: transparent;
    transition: fill 0.2s ease;
  }

  .month-col-highlight.active {
    fill: #f1f5f3;
  }

  .bar-income, .bar-expense {
    transition: filter 0.2s ease, opacity 0.2s ease;
  }

  .month-bar-group:hover .bar-income,
  .month-bar-group.floating .bar-income {
    filter: drop-shadow(0 4px 10px rgba(22, 163, 74, 0.35));
  }

  .month-bar-group:hover .bar-expense,
  .month-bar-group.floating .bar-expense {
    filter: drop-shadow(0 4px 10px rgba(231, 111, 81, 0.35));
  }

  .evolution-months-group.has-active .month-bar-group:not(.floating) {
    opacity: 0.42;
    transition: opacity 0.2s ease;
  }

  .month-axis-label {
    font-size: 10.5px;
    font-weight: 600;
    fill: #4b5563;
    transition: font-weight 0.2s ease, fill 0.2s ease;
  }

  .month-axis-label.active {
    font-weight: 800;
    fill: var(--ink);
    font-size: 11.5px;
  }

  .evolution-detail-col {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-height: 260px;
  }

  .month-detail-card {
    background: white;
    border: 1px solid var(--line);
    border-left: 6px solid #16a34a;
    border-radius: 12px;
    padding: 1.25rem 1.4rem;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05);
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
    animation: fadeIn 0.2s ease-out;
  }

  .month-detail-card.negative {
    border-left-color: #e76f51;
  }

  .month-detail-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    border-bottom: 1px solid #f0f3f1;
    padding-bottom: 0.8rem;
  }

  .month-kpi-sub {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 700;
    color: var(--muted);
  }

  .month-title {
    margin: 0.2rem 0 0 0;
    font-size: 1.2rem;
    font-weight: 800;
    color: var(--ink);
  }

  .month-net-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.3rem 0.75rem;
    border-radius: 99px;
    font-size: 0.85rem;
    font-weight: 700;
  }

  .badge-green {
    background: #dcfce7;
    color: #15803d;
  }

  .badge-red {
    background: #fee2e2;
    color: #b91c1c;
  }

  .month-flows-breakdown {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }

  .month-flow-row {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .flow-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.88rem;
  }

  .flow-name {
    font-weight: 700;
  }

  .flow-amount {
    font-size: 0.95rem;
    color: var(--ink);
  }

  .flow-share {
    font-size: 0.75rem;
    color: var(--muted);
  }

  .month-card-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-top: 1px solid #f0f3f1;
    padding-top: 0.75rem;
    font-size: 0.82rem;
    color: var(--muted);
  }

  .month-status-pill {
    font-size: 0.75rem;
    font-weight: 700;
    padding: 0.15rem 0.55rem;
    border-radius: 99px;
  }

  .pill-green {
    background: #ecfdf5;
    color: #047857;
  }

  .pill-red {
    background: #fef2f2;
    color: #b91c1c;
  }

  .month-placeholder-card {
    background: white;
    border: 1px dashed var(--line);
    border-radius: 12px;
    padding: 1.5rem;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.6rem;
  }

  .month-placeholder-card h4 {
    margin: 0;
    font-size: 1.05rem;
    color: var(--ink);
  }

  .month-placeholder-card p {
    margin: 0;
    font-size: 0.85rem;
    color: var(--muted);
    max-width: 360px;
    line-height: 1.4;
  }

  .row-highlight {
    background-color: #f0fdf4 !important;
    font-weight: 600;
  }

  /* PIE / DONUT SECTION */
  .pie-section-wrapper {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    background: #fcfdfc;
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 1.25rem;
  }

  .pie-toolbar-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .pie-mode-toggle {
    display: inline-flex;
    background: #eef2ef;
    padding: 4px;
    border-radius: 99px;
    gap: 4px;
  }

  .btn-toggle-pill {
    padding: 0.4rem 1rem;
    font-size: 0.85rem;
    font-weight: 700;
    border: none;
    border-radius: 99px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .btn-toggle-pill:hover {
    color: var(--ink);
  }

  .btn-toggle-pill.active {
    background: white;
    color: var(--ink);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
  }

  .pie-hint-text {
    font-size: 0.82rem;
    color: var(--muted);
    font-weight: 500;
  }

  .pie-content-grid {
    display: grid;
    grid-template-columns: 360px 1fr;
    gap: 2rem;
    align-items: center;
  }

  @media (max-width: 900px) {
    .pie-content-grid {
      grid-template-columns: 1fr;
    }
  }

  .pie-chart-col {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 0.5rem;
  }

  .pie-svg-element {
    width: 100%;
    max-width: 340px;
    height: auto;
    overflow: visible;
  }

  .pie-slices-group {
    transform-origin: 175px 175px;
  }

  .pie-slice-path {
    cursor: pointer;
    stroke: #ffffff;
    stroke-width: 2.5px;
    stroke-linejoin: round;
    transition: transform 0.32s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease, filter 0.25s ease;
    transform-origin: 175px 175px;
    outline: none;
  }

  .pie-slice-path:hover,
  .pie-slice-path.floating {
    filter: drop-shadow(0 8px 18px rgba(0, 0, 0, 0.25));
    stroke: #ffffff;
    stroke-width: 3px;
    z-index: 10;
  }

  .pie-slices-group:has(.floating) .pie-slice-path:not(.floating) {
    opacity: 0.55;
  }

  .pie-center-content {
    user-select: none;
  }

  .pie-center-label {
    font-size: 13px;
    font-weight: 700;
    fill: var(--muted);
    letter-spacing: 0.3px;
  }

  .pie-center-sub {
    font-size: 10px;
    font-weight: 800;
    fill: var(--muted);
    letter-spacing: 0.8px;
    text-transform: uppercase;
  }

  .pie-center-amount {
    font-size: 19px;
    font-weight: 800;
    fill: var(--ink);
  }

  .pie-center-pct {
    font-size: 11px;
    font-weight: 600;
    fill: var(--muted);
  }

  /* DETAIL CARD & SUBCATEGORIES */
  .pie-detail-col {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 280px;
    justify-content: center;
  }

  .slice-detail-card {
    background: white;
    border: 1px solid var(--line);
    border-left: 6px solid var(--accent);
    border-radius: 12px;
    padding: 1.25rem 1.4rem;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05);
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
    animation: fadeIn 0.2s ease-out;
  }

  .slice-detail-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    border-bottom: 1px solid #f0f3f1;
    padding-bottom: 0.9rem;
  }

  .slice-header-left {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .color-bullet-large {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    margin-top: 3px;
    flex-shrink: 0;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.15);
  }

  .slice-title {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 800;
    color: var(--ink);
  }

  .slice-parent-tag {
    display: inline-block;
    font-size: 0.78rem;
    color: var(--muted);
    margin-top: 0.2rem;
  }

  .slice-header-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.25rem;
  }

  .slice-amount {
    font-size: 1.25rem;
    font-weight: 800;
    color: var(--ink);
  }

  .slice-share-badge {
    padding: 0.15rem 0.6rem;
    border-radius: 99px;
    font-size: 0.82rem;
    font-weight: 700;
  }

  .subcategories-panel {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .subcategories-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .subcat-title {
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .badge-mini {
    background: #eef2ef;
    color: var(--muted);
    font-size: 0.75rem;
    font-weight: 700;
    padding: 0.1rem 0.45rem;
    border-radius: 99px;
  }

  .subcategories-list {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    max-height: 200px;
    overflow-y: auto;
    padding-right: 0.4rem;
  }

  .subcat-item {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    background: #fafcfb;
    border: 1px solid #edf2ef;
    border-radius: 8px;
    padding: 0.55rem 0.75rem;
  }

  .subcat-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.85rem;
  }

  .subcat-left {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .subcat-bullet {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .subcat-name {
    font-weight: 600;
    color: var(--ink);
  }

  .subcat-right {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .subcat-pct {
    font-size: 0.78rem;
    color: var(--muted);
    font-weight: 600;
  }

  .subcat-empty {
    font-size: 0.78rem;
    color: var(--muted);
    font-style: italic;
  }

  .subcat-progress-track {
    width: 100%;
    height: 5px;
    background: #e5e7eb;
    border-radius: 99px;
    overflow: hidden;
  }

  .subcat-progress-fill {
    height: 100%;
    border-radius: 99px;
    transition: width 0.3s ease;
  }

  .subcat-empty-notice {
    font-size: 0.82rem;
    color: var(--muted);
    padding: 0.75rem 0;
    font-style: italic;
  }

  .pie-placeholder-card {
    background: white;
    border: 1px dashed var(--line);
    border-radius: 12px;
    padding: 1.5rem;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.6rem;
  }

  .placeholder-icon {
    font-size: 2rem;
  }

  .pie-placeholder-card h4 {
    margin: 0;
    font-size: 1.05rem;
    color: var(--ink);
  }

  .pie-placeholder-card p {
    margin: 0;
    font-size: 0.85rem;
    color: var(--muted);
    max-width: 360px;
    line-height: 1.4;
  }

  .slice-chips-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    justify-content: center;
    margin-top: 0.6rem;
  }

  .slice-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.65rem;
    background: #f4f7f5;
    border: 1px solid var(--line);
    border-radius: 99px;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--ink);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .slice-chip:hover {
    background: white;
    border-color: var(--accent);
    transform: translateY(-1px);
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.06);
  }

  .chip-val {
    color: var(--muted);
    font-weight: 700;
  }

  .empty-pie-notice {
    text-align: center;
    padding: 2rem;
    color: var(--muted);
    font-size: 0.9rem;
  }

  /* PROJECTS REPORT */
  .projects-report-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1rem;
  }

  .project-report-card {
    background: #fbfdfc;
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 1.1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .proj-card-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .proj-name {
    margin: 0 0 0.35rem 0;
    font-size: 1.05rem;
    color: var(--ink);
  }

  .proj-budget-kpi {
    text-align: right;
  }

  .proj-budget-kpi small {
    display: block;
    font-size: 0.72rem;
    color: var(--muted);
  }

  .proj-budget-kpi strong {
    font-size: 1.05rem;
    color: var(--ink);
  }

  .proj-status-note {
    font-size: 0.8rem;
    color: var(--muted);
    font-style: italic;
    margin: 0;
  }

  .budget-gauge-wrap {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .gauge-labels {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--muted);
  }

  .proj-financials-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 0.5rem;
    border-top: 1px dashed var(--line);
    font-size: 0.8rem;
  }

  .proj-financials-row span {
    display: block;
    color: var(--muted);
    font-size: 0.72rem;
  }

  /* RECONCILIATION STATS */
  .rec-stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 1rem;
  }

  .rec-stat-card {
    background: #f9fafb;
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .stat-number {
    font-size: 1.75rem;
    font-weight: 800;
    color: var(--ink);
  }

  .stat-title {
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--ink);
  }

  .rec-stat-card small {
    font-size: 0.75rem;
    color: var(--muted);
  }

  /* TOP TABLES */
  .top-tables-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 1.25rem;
  }

  .sub-table-title {
    margin: 0 0 0.65rem 0;
    font-size: 0.95rem;
    font-weight: 700;
  }

  /* COMPARISON CARDS */
  .comparison-cards-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 1rem;
  }

  .comparison-card {
    background: #f9fafb;
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 1.1rem;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .comp-label {
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--muted);
    text-transform: uppercase;
  }

  .comp-figures {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .comp-figures small {
    display: block;
    font-size: 0.72rem;
    color: var(--muted);
  }

  .comp-vs {
    font-size: 0.8rem;
    font-weight: 700;
    color: #9ca3af;
  }

  .comp-delta {
    padding: 0.35rem 0.6rem;
    border-radius: 6px;
    font-size: 0.85rem;
    font-weight: 700;
    text-align: center;
  }

  .comp-delta.positive {
    background: #ecfdf5;
    color: #16a34a;
  }

  .comp-delta.negative {
    background: #fef2f2;
    color: #dc2626;
  }

  .empty-notice {
    color: var(--muted);
    font-style: italic;
    font-size: 0.88rem;
    text-align: center;
    padding: 1.5rem;
  }

  /* HEADER & FOOTER (HIDDEN ON SCREEN) */
  .print-header,
  .print-footer {
    display: none;
  }

  /* =========================================
     PRINT STYLES FOR A4 EXPORT
     ========================================= */
  @media print {
    @page {
      size: A4 portrait;
      margin: 14mm 15mm 15mm 14mm;
    }

    /* Hide UI navigation, sidebar, and control buttons */
    :global(body) {
      background: white !important;
      color: black !important;
      font-size: 11pt !important;
    }

    :global(.sidebar),
    :global(.top-bar),
    :global(aside),
    .no-print {
      display: none !important;
    }

    .reports-page {
      gap: 1.5rem !important;
      max-width: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    .report-card-panel {
      box-shadow: none !important;
      border: 1px solid #d1d5db !important;
      border-radius: 8px !important;
      padding: 1.2rem !important;
      break-inside: avoid !important;
      page-break-inside: avoid !important;
      margin-bottom: 1.2rem !important;
    }

    /* Print Header */
    .print-header {
      display: flex !important;
      justify-content: space-between !important;
      align-items: flex-start !important;
      border-bottom: 2.5px solid #111827 !important;
      padding-bottom: 1rem !important;
      margin-bottom: 1.5rem !important;
    }

    .print-header-brand {
      display: flex !important;
      align-items: center !important;
      gap: 1rem !important;
    }

    .print-logo {
      width: 60px !important;
      height: 60px !important;
      object-fit: contain !important;
    }

    .print-org-name {
      margin: 0 !important;
      font-size: 1.4rem !important;
      font-weight: 800 !important;
      color: #111827 !important;
    }

    .print-org-details {
      margin: 0.2rem 0 0 0 !important;
      font-size: 8.5pt !important;
      color: #4b5563 !important;
    }

    .print-header-meta {
      text-align: right !important;
    }

    .print-doc-badge {
      font-size: 1.1rem !important;
      font-weight: 800 !important;
      color: #111827 !important;
      text-transform: uppercase !important;
      letter-spacing: 0.5px !important;
    }

    .print-dates {
      font-size: 9pt !important;
      color: #374151 !important;
      margin-top: 0.2rem !important;
    }

    .print-timestamp {
      font-size: 8pt !important;
      color: #6b7280 !important;
      margin-top: 0.15rem !important;
    }

    /* Print Footer */
    .print-footer {
      display: block !important;
      margin-top: 2rem !important;
      break-inside: avoid !important;
    }

    .print-footer-rule {
      border-top: 1px solid #d1d5db !important;
      margin-bottom: 0.5rem !important;
    }

    .print-footer-content {
      display: flex !important;
      justify-content: space-between !important;
      font-size: 8pt !important;
      color: #6b7280 !important;
    }

    .kpi-card {
      background: #f9fafb !important;
      border: 1px solid #e5e7eb !important;
    }
  }
</style>
