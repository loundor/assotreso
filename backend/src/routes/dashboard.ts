import type { FastifyPluginAsync } from 'fastify';
import { query } from '../db.js';

interface FiscalSettingsRow {
  today: string;
  fiscal_start_day: number;
  fiscal_start_month: number;
}

interface SummaryRow {
  current_balance: number;
  month_income: number;
  month_expense: number;
  year_income: number;
  year_expense: number;
  transactions_without_document: number;
  unmatched_documents: number;
}

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  const dashboard = async () => {
    const fiscalRows = await query<FiscalSettingsRow>(
      `SELECT CURRENT_DATE::text AS today,fiscal_start_day,fiscal_start_month FROM association_settings WHERE id=1`
    );
    const fiscal = fiscalRows[0] ?? { today: new Date().toISOString().slice(0, 10), fiscal_start_day: 1, fiscal_start_month: 1 };
    const today = new Date(`${fiscal.today}T00:00:00Z`);
    const currentYear = today.getUTCFullYear();
    const candidateDay = Math.min(fiscal.fiscal_start_day, new Date(Date.UTC(currentYear, fiscal.fiscal_start_month, 0)).getUTCDate());
    let fiscalStart = new Date(Date.UTC(currentYear, fiscal.fiscal_start_month - 1, candidateDay));
    if (fiscalStart > today) {
      const previousYearDay = Math.min(fiscal.fiscal_start_day, new Date(Date.UTC(currentYear - 1, fiscal.fiscal_start_month, 0)).getUTCDate());
      fiscalStart = new Date(Date.UTC(currentYear - 1, fiscal.fiscal_start_month - 1, previousYearDay));
    }
    const fiscalStartDate = fiscalStart.toISOString().slice(0, 10);
    const summary = await query<SummaryRow>(`
      SELECT
        COALESCE((SELECT SUM(initial_balance) FROM accounts WHERE active), 0)::float8
          + COALESCE((SELECT SUM(amount) FROM transactions), 0)::float8 AS current_balance,
        COALESCE(SUM(amount) FILTER (WHERE amount > 0 AND date_trunc('month', operation_date) = date_trunc('month', CURRENT_DATE)), 0)::float8 AS month_income,
        ABS(COALESCE(SUM(amount) FILTER (WHERE amount < 0 AND date_trunc('month', operation_date) = date_trunc('month', CURRENT_DATE)), 0))::float8 AS month_expense,
        COALESCE(SUM(amount) FILTER (WHERE amount > 0 AND operation_date >= $1::date), 0)::float8 AS year_income,
        ABS(COALESCE(SUM(amount) FILTER (WHERE amount < 0 AND operation_date >= $1::date), 0))::float8 AS year_expense,
        (SELECT COUNT(*)::int FROM transactions t WHERE NOT EXISTS (SELECT 1 FROM documents d WHERE d.transaction_id = t.id)) AS transactions_without_document,
        (SELECT COUNT(*)::int FROM invoices i JOIN documents d ON d.id = i.document_id WHERE i.transaction_id IS NULL AND d.transaction_id IS NULL) AS unmatched_documents
      FROM transactions
    `, [fiscalStartDate]);
    const latestTransactions = await query(
      `SELECT t.*, t.amount::float8 AS amount, t.operation_date AS date, t.description AS label,
        CASE WHEN t.amount > 0 THEN 'income' ELSE 'expense' END AS direction,
        a.name AS account_name, a.name AS account,
        c.name AS category_name, c.name AS category,
        p.name AS project_name, p.name AS project
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN projects p ON p.id = t.project_id
       ORDER BY t.operation_date DESC, t.created_at DESC LIMIT 8`
    );
    const expensesByCategory = await query(
      `SELECT COALESCE(c.name, 'Sans catégorie') AS category, ABS(SUM(t.amount))::float8 AS amount
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.amount < 0 AND t.operation_date >= $1::date
       GROUP BY c.name ORDER BY amount DESC`,
      [fiscalStartDate]
    );
    const values = summary[0];
    return {
      summary: values,
      totalBalance: values?.current_balance ?? 0,
      balance: values?.current_balance ?? 0,
      income: values?.month_income ?? 0,
      expenses: values?.month_expense ?? 0,
      pendingInvoices: values?.unmatched_documents ?? 0,
      fiscalStartDate,
      latestTransactions,
      recentTransactions: latestTransactions,
      expensesByCategory
    };
  };
  app.get('/dashboard/summary', { preHandler: app.authenticate }, dashboard);
  app.get('/dashboard', { preHandler: app.authenticate }, dashboard);
};
