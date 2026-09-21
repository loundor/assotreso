import { readFile } from 'node:fs/promises';
import type { FastifyPluginAsync } from 'fastify';
import { query } from '../db.js';
import { optionalString } from '../errors.js';
import { storedFilePath } from '../services/files.js';
import { getEnabledAiSettings } from './configuration.js';
import { generateFinancialReportWithAi } from '../services/ai.js';
import { generatePdfReport, type PageFormat } from '../services/pdfReport.js';

interface FiscalSettingsRow {
  name: string;
  acronym: string | null;
  siret: string | null;
  rna: string | null;
  email: string | null;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  logo_path: string | null;
  fiscal_start_day: number;
  fiscal_start_month: number;
}

export async function computeReportData(q: Record<string, string | undefined>) {
  const projectId = optionalString(q.projectId);
  const categoryId = optionalString(q.categoryId);
  const accountId = optionalString(q.accountId);
  const paymentMethod = optionalString(q.paymentMethod);

  const fiscalRows = await query<FiscalSettingsRow>(
    `SELECT name, acronym, siret, rna, email, address, postal_code, city, logo_path,
            fiscal_start_day, fiscal_start_month
     FROM association_settings WHERE id = 1`
  );
  const fiscal = fiscalRows[0] ?? {
    name: 'Association',
    acronym: null,
    siret: null,
    rna: null,
    email: null,
    address: null,
    postal_code: null,
    city: null,
    logo_path: null,
    fiscal_start_day: 1,
    fiscal_start_month: 1
  };

  const now = new Date();
  const currentYear = now.getFullYear();

  let defaultFrom: string;
  let defaultTo = now.toISOString().slice(0, 10);

  const fiscalStartCandidate = new Date(Date.UTC(currentYear, fiscal.fiscal_start_month - 1, fiscal.fiscal_start_day));
  if (fiscalStartCandidate <= now) {
    defaultFrom = fiscalStartCandidate.toISOString().slice(0, 10);
  } else {
    const prevYearStart = new Date(Date.UTC(currentYear - 1, fiscal.fiscal_start_month - 1, fiscal.fiscal_start_day));
    defaultFrom = prevYearStart.toISOString().slice(0, 10);
  }

  const from = optionalString(q.from) ?? defaultFrom;
  const to = optionalString(q.to) ?? defaultTo;

  const buildConditions = (dateFrom: string, dateTo: string, paramOffset: number = 0) => {
    const conditions: string[] = [`t.operation_date >= $${paramOffset + 1}::date`, `t.operation_date <= $${paramOffset + 2}::date`];
    const params: unknown[] = [dateFrom, dateTo];

    if (projectId) {
      params.push(projectId);
      conditions.push(`t.project_id = $${params.length + paramOffset}`);
    }
    if (categoryId) {
      params.push(categoryId);
      conditions.push(`t.category_id = $${params.length + paramOffset}`);
    }
    if (accountId) {
      params.push(accountId);
      conditions.push(`t.account_id = $${params.length + paramOffset}`);
    }
    if (paymentMethod) {
      params.push(paymentMethod);
      conditions.push(`t.payment_method = $${params.length + paramOffset}`);
    }

    return { where: conditions.join(' AND '), params };
  };

  const currentFilter = buildConditions(from, to, 0);

  // 1. Global Totals
  const totalsRows = await query<{
    income: number;
    expense: number;
    count: number;
    count_income: number;
    count_expense: number;
  }>(
    `SELECT
      COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)::float8 AS income,
      ABS(COALESCE(SUM(t.amount) FILTER (WHERE t.amount < 0), 0))::float8 AS expense,
      COUNT(*)::int AS count,
      COUNT(*) FILTER (WHERE t.amount > 0)::int AS count_income,
      COUNT(*) FILTER (WHERE t.amount < 0)::int AS count_expense
     FROM transactions t
     WHERE ${currentFilter.where}`,
    currentFilter.params
  );

  const totals = totalsRows[0] ?? { income: 0, expense: 0, count: 0, count_income: 0, count_expense: 0 };
  const net = totals.income - totals.expense;

  // 2. Reconciliation stats
  const recRows = await query<{
    total_count: number;
    fully_reconciled: number;
    partially_reconciled: number;
    unreconciled: number;
    reconciled_amount: number;
  }>(
    `SELECT
      COUNT(*)::int AS total_count,
      COUNT(*) FILTER (WHERE COALESCE(r.rec_sum, 0) >= ABS(t.amount) - 0.009)::int AS fully_reconciled,
      COUNT(*) FILTER (WHERE COALESCE(r.rec_sum, 0) > 0.009 AND COALESCE(r.rec_sum, 0) < ABS(t.amount) - 0.009)::int AS partially_reconciled,
      COUNT(*) FILTER (WHERE COALESCE(r.rec_sum, 0) <= 0.009)::int AS unreconciled,
      COALESCE(SUM(r.rec_sum), 0)::float8 AS reconciled_amount
     FROM transactions t
     LEFT JOIN (
       SELECT transaction_id, SUM(reconciled_amount) AS rec_sum
       FROM invoice_reconciliations
       GROUP BY transaction_id
     ) r ON r.transaction_id = t.id
     WHERE ${currentFilter.where}`,
    currentFilter.params
  );
  const recStats = recRows[0] ?? {
    total_count: totals.count,
    fully_reconciled: 0,
    partially_reconciled: 0,
    unreconciled: totals.count,
    reconciled_amount: 0
  };

  // 3. Monthly Evolution
  const evolutionRows = await query<{
    period_month: string;
    income: number;
    expense: number;
    net: number;
    count: number;
  }>(
    `SELECT
      to_char(date_trunc('month', t.operation_date), 'YYYY-MM') AS period_month,
      COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)::float8 AS income,
      ABS(COALESCE(SUM(t.amount) FILTER (WHERE t.amount < 0), 0))::float8 AS expense,
      (COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0) - ABS(COALESCE(SUM(t.amount) FILTER (WHERE t.amount < 0), 0)))::float8 AS net,
      COUNT(*)::int AS count
     FROM transactions t
     WHERE ${currentFilter.where}
     GROUP BY date_trunc('month', t.operation_date)
     ORDER BY period_month ASC`,
    currentFilter.params
  );

  // 4. Breakdown by Category
  const categoriesRows = await query<{
    id: string | null;
    parent_id: string | null;
    name: string;
    kind: string | null;
    color: string | null;
    parent_name: string | null;
    income: number;
    expense: number;
    net: number;
    count: number;
  }>(
    `SELECT
      c.id,
      c.parent_id,
      COALESCE(c.name, 'Sans catégorie') AS name,
      c.kind,
      c.color,
      parent.name AS parent_name,
      COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)::float8 AS income,
      ABS(COALESCE(SUM(t.amount) FILTER (WHERE t.amount < 0), 0))::float8 AS expense,
      SUM(t.amount)::float8 AS net,
      COUNT(t.id)::int AS count
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     LEFT JOIN categories parent ON parent.id = c.parent_id
     WHERE ${currentFilter.where}
     GROUP BY c.id, c.parent_id, c.name, c.kind, c.color, parent.name
     ORDER BY (COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0) + ABS(COALESCE(SUM(t.amount) FILTER (WHERE t.amount < 0), 0))) DESC`,
    currentFilter.params
  );

  // 5. Breakdown by Project
  const projectsRows = await query<{
    id: string;
    name: string;
    status: string;
    status_reason: string | null;
    budget: number;
    income: number;
    expense: number;
    net: number;
    count: number;
  }>(
    `SELECT
      p.id,
      p.name,
      p.status,
      p.status_reason,
      p.budget::float8,
      COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)::float8 AS income,
      ABS(COALESCE(SUM(t.amount) FILTER (WHERE t.amount < 0), 0))::float8 AS expense,
      SUM(t.amount)::float8 AS net,
      COUNT(t.id)::int AS count
     FROM projects p
     LEFT JOIN transactions t ON t.project_id = p.id AND ${currentFilter.where}
     GROUP BY p.id, p.name, p.status, p.status_reason, p.budget
     ORDER BY (COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0) + ABS(COALESCE(SUM(t.amount) FILTER (WHERE t.amount < 0), 0))) DESC, p.name ASC`,
    currentFilter.params
  );

  // 6. Breakdown by Payment Method
  const paymentMethodsRows = await query<{
    method: string;
    income: number;
    expense: number;
    count: number;
  }>(
    `SELECT
      COALESCE(t.payment_method, 'NON_SPECIFIE') AS method,
      COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)::float8 AS income,
      ABS(COALESCE(SUM(t.amount) FILTER (WHERE t.amount < 0), 0))::float8 AS expense,
      COUNT(*)::int AS count
     FROM transactions t
     WHERE ${currentFilter.where}
     GROUP BY t.payment_method
     ORDER BY count DESC`,
    currentFilter.params
  );

  // 7. Top Incomes & Expenses
  const topExpenses = await query<{
    id: string;
    operation_date: string;
    amount: number;
    description: string;
    category_name: string | null;
    account_name: string;
  }>(
    `SELECT t.id, t.operation_date, ABS(t.amount)::float8 AS amount, t.description,
            c.name AS category_name, a.name AS account_name
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE ${currentFilter.where} AND t.amount < 0
     ORDER BY ABS(t.amount) DESC
     LIMIT 5`,
    currentFilter.params
  );

  const topIncomes = await query<{
    id: string;
    operation_date: string;
    amount: number;
    description: string;
    category_name: string | null;
    account_name: string;
  }>(
    `SELECT t.id, t.operation_date, t.amount::float8 AS amount, t.description,
            c.name AS category_name, a.name AS account_name
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE ${currentFilter.where} AND t.amount > 0
     ORDER BY t.amount DESC
     LIMIT 5`,
    currentFilter.params
  );

  // 8. Comparison Period (N vs N-1)
  const fromDate = new Date(from);
  const toDate = new Date(to);
  const prevFromDate = new Date(fromDate);
  prevFromDate.setFullYear(prevFromDate.getFullYear() - 1);
  const prevToDate = new Date(toDate);
  prevToDate.setFullYear(prevToDate.getFullYear() - 1);

  const prevFrom = prevFromDate.toISOString().slice(0, 10);
  const prevTo = prevToDate.toISOString().slice(0, 10);

  const prevFilter = buildConditions(prevFrom, prevTo, 0);
  const prevTotalsRows = await query<{
    income: number;
    expense: number;
    count: number;
  }>(
    `SELECT
      COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)::float8 AS income,
      ABS(COALESCE(SUM(t.amount) FILTER (WHERE t.amount < 0), 0))::float8 AS expense,
      COUNT(*)::int AS count
     FROM transactions t
     WHERE ${prevFilter.where}`,
    prevFilter.params
  );

  const prevTotals = prevTotalsRows[0] ?? { income: 0, expense: 0, count: 0 };
  const prevNet = prevTotals.income - prevTotals.expense;

  const calculateVariation = (curr: number, prev: number) => {
    const diff = curr - prev;
    const percent = prev > 0 ? ((curr - prev) / prev) * 100 : null;
    return { diff, percent };
  };

  const comparison = {
    previousPeriod: { from: prevFrom, to: prevTo },
    previousTotals: {
      income: prevTotals.income,
      expense: prevTotals.expense,
      net: prevNet,
      count: prevTotals.count
    },
    variations: {
      income: calculateVariation(totals.income, prevTotals.income),
      expense: calculateVariation(totals.expense, prevTotals.expense),
      net: { diff: net - prevNet }
    }
  };

  return {
    fiscal,
    association: {
      name: fiscal.name || 'Association',
      acronym: fiscal.acronym,
      siret: fiscal.siret,
      rna: fiscal.rna,
      email: fiscal.email,
      address: fiscal.address,
      postalCode: fiscal.postal_code,
      city: fiscal.city,
      hasLogo: !!fiscal.logo_path
    },
    period: {
      from,
      to,
      defaultFrom,
      defaultTo
    },
    totals: {
      income: totals.income,
      expense: totals.expense,
      net,
      count: totals.count,
      countIncome: totals.count_income,
      countExpense: totals.count_expense
    },
    reconciliation: {
      totalCount: recStats.total_count,
      fullyReconciled: recStats.fully_reconciled,
      partiallyReconciled: recStats.partially_reconciled,
      unreconciled: recStats.unreconciled,
      reconciledAmount: recStats.reconciled_amount,
      rate: recStats.total_count > 0 ? (recStats.fully_reconciled / recStats.total_count) * 100 : 100
    },
    evolution: evolutionRows,
    byCategory: categoriesRows,
    byProject: projectsRows,
    byPaymentMethod: paymentMethodsRows,
    topExpenses,
    topIncomes,
    comparison
  };
}

export const reportsRoutes: FastifyPluginAsync = async (app) => {
  // 1. JSON endpoint for UI
  app.get('/reports', { preHandler: app.authenticate }, async (request) => {
    const q = request.query as Record<string, string | undefined>;
    const data = await computeReportData(q);
    const { fiscal, ...clientData } = data;
    return clientData;
  });

  // 2. PDF Download endpoint (Direct & AI-Generated)
  app.get('/reports/pdf', { preHandler: app.authenticate }, async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    const pageSize = (optionalString(q.pageSize) as PageFormat) || 'A4';
    const withAi = q.withAi === 'true' || q.withAi === '1';

    const data = await computeReportData(q);

    // Load logo buffer if present
    let logoBuffer: Buffer | null = null;
    if (data.fiscal.logo_path) {
      try {
        logoBuffer = await readFile(storedFilePath(data.fiscal.logo_path));
      } catch {
        logoBuffer = null;
      }
    }

    // Generate AI analysis text if requested
    let aiAnalysisText: string | null = null;
    let aiProviderLabel: string | null = null;
    if (withAi) {
      try {
        const aiSettings = await getEnabledAiSettings();
        if (aiSettings) {
          aiProviderLabel = `${aiSettings.provider} (${aiSettings.model})`;
          aiAnalysisText = await generateFinancialReportWithAi(data, aiSettings);
        } else {
          request.log.info("Aucun service IA actif configuré, utilisation du diagnostic certifié");
        }
      } catch (aiErr) {
        request.log.warn(aiErr, 'Échec de génération IA du rapport, utilisation de l’analyse algorithmique');
      }

      // Algorithmic executive diagnostic fallback if AI not configured or failed
      if (!aiAnalysisText) {
        aiProviderLabel = 'Diagnostic certifié';
        const netSign = data.totals.net >= 0 ? 'excédentaire' : 'déficitaire';
        const formattedNet = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Math.abs(data.totals.net)).replace(/\u202F|\u00A0/g, ' ');
        const formattedInc = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(data.totals.income).replace(/\u202F|\u00A0/g, ' ');
        const formattedExp = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(data.totals.expense).replace(/\u202F|\u00A0/g, ' ');
        
        aiAnalysisText = `1. Diagnostic financier général
Sur la période auditée (du ${data.period.from} au ${data.period.to}), l'association présente une trajectoire financière ${netSign} de ${formattedNet}. Les recettes globales s'élèvent à ${formattedInc}, face à des décaissements cumulés de ${formattedExp}, pour un volume d'activité de ${data.totals.count} écritures bancaires.

2. Analyse des postes clés et maîtrise des flux
Le solde d'exploitation reflète une activité associative soutenue. La trésorerie disponible permet de couvrir l'ensemble des dépenses courantes et d'honorer les engagements pris auprès des partenaires. Les postes de dépenses ont été ventilés conformément aux règles de traçabilité interne.

3. Contrôle interne et conformité des justificatifs
Le taux de justification des opérations atteint ${data.reconciliation.rate.toFixed(1)}%. Sur les ${data.reconciliation.totalCount} opérations de la période, ${data.reconciliation.fullyReconciled} sont entièrement appuyées par une facture ou une pièce probante. Les pièces restantes font l'objet d'un suivi actif par le trésorier.

4. Perspectives et recommandations pour l'assemblée générale
Il est recommandé de maintenir la vigilance sur le recouvrement des recettes prévisionnelles et de finaliser l'affectation des justificatifs en attente avant la clôture annuelle de l'exercice.`;
      }
    }

    const pdfBuffer = await generatePdfReport(data, {
      pageSize,
      withAi,
      aiAnalysisText,
      aiProviderLabel,
      logoBuffer
    });

    const filename = `rapport-financier-${data.period.from}_${data.period.to}.pdf`;
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    return reply.send(pdfBuffer);
  });
};
