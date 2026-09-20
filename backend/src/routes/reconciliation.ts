import type { FastifyPluginAsync } from 'fastify';
import { audit } from '../audit.js';
import { pool, query, withTransaction } from '../db.js';
import { ApiError, objectBody, requiredString } from '../errors.js';

export const reconciliationRoutes: FastifyPluginAsync = async (app) => {
  // Récupérer les rapprochements non effectués (transactions et factures orphelines) et terminés (paires liées)
  app.get('/reconciliation', { preHandler: app.authenticate }, async () => {
    const unreconciledTransactions = await query(
      `SELECT t.*, t.amount::float8 AS amount, t.operation_date AS date, t.description AS label,
        CASE WHEN t.amount > 0 THEN 'income' ELSE 'expense' END AS direction,
        a.name AS account_name, a.name AS account,
        c.name AS category_name, p.name AS project_name
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE t.reconciliation_status != 'RAPPROCHE'
         AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.transaction_id = t.id)
         AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.transaction_id = t.id)
       ORDER BY t.operation_date DESC, t.created_at DESC`
    );

    const unreconciledInvoices = await query(
      `SELECT i.*, i.invoice_number AS number, i.invoice_date AS date, i.total_ttc::float8 AS total,
        d.id AS document_id, d.original_name, d.mime_type,
        COALESCE(a.allocated_amount, 0)::float8 AS allocated_amount,
        COALESCE(a.allocated_amount, 0)::float8 AS "allocatedAmount",
        GREATEST(ABS(COALESCE(i.total_ttc, 0)) - COALESCE(a.allocated_amount, 0), 0)::float8 AS remaining_amount,
        GREATEST(ABS(COALESCE(i.total_ttc, 0)) - COALESCE(a.allocated_amount, 0), 0)::float8 AS "remainingAmount"
       FROM invoices i
       JOIN documents d ON d.id = i.document_id
       LEFT JOIN LATERAL (SELECT SUM(amount) AS allocated_amount FROM invoice_allocations WHERE invoice_id = i.id) a ON true
       WHERE i.transaction_id IS NULL
         AND d.transaction_id IS NULL
       ORDER BY i.invoice_date DESC NULLS LAST, i.created_at DESC`
    );

    const reconciledPairs = await query(
      `SELECT
         i.id AS invoice_id,
         i.invoice_number AS invoice_number,
         i.invoice_date AS invoice_date,
         i.supplier AS invoice_supplier,
         i.recipient AS invoice_recipient,
         i.total_ttc::float8 AS invoice_total_ttc,
         d.id AS document_id,
         d.original_name AS document_name,
         d.mime_type AS document_mime_type,
         t.id AS transaction_id,
         t.operation_date AS transaction_date,
         t.amount::float8 AS transaction_amount,
         t.description AS transaction_description,
         t.bank_label AS transaction_bank_label,
         t.payment_method AS transaction_payment_method,
         a.name AS account_name,
         t.updated_at AS reconciled_at
       FROM invoices i
       JOIN documents d ON d.id = i.document_id
       JOIN transactions t ON t.id = i.transaction_id
       JOIN accounts a ON a.id = t.account_id
       WHERE i.transaction_id IS NOT NULL
       ORDER BY t.updated_at DESC, t.operation_date DESC`
    );

    return {
      unreconciledTransactions,
      unreconciledInvoices,
      reconciledPairs
    };
  });

  // Associer (rapprocher) une transaction et une facture
  app.post('/reconciliation', { preHandler: app.authenticate }, async (request, reply) => {
    const body = objectBody(request.body);
    const transactionId = requiredString(body.transactionId, 'transactionId');
    const invoiceId = requiredString(body.invoiceId, 'invoiceId');

    const result = await withTransaction(async (client) => {
      const transRes = await client.query('SELECT id, amount, description FROM transactions WHERE id=$1 FOR UPDATE', [transactionId]);
      if (!transRes.rowCount) throw new ApiError(404, 'Transaction introuvable.', 'TRANSACTION_INTROUVABLE');

      const invRes = await client.query('SELECT id, document_id, total_ttc FROM invoices WHERE id=$1 FOR UPDATE', [invoiceId]);
      if (!invRes.rowCount) throw new ApiError(404, 'Facture introuvable.', 'FACTURE_INTROUVABLE');
      const invoice = invRes.rows[0];

      await client.query('UPDATE invoices SET transaction_id=$1, updated_at=now() WHERE id=$2', [transactionId, invoiceId]);
      if (invoice.document_id) {
        await client.query('UPDATE documents SET transaction_id=$1, updated_at=now() WHERE id=$2', [transactionId, invoice.document_id]);
      }
      await client.query("UPDATE transactions SET reconciliation_status='RAPPROCHE', updated_at=now() WHERE id=$1", [transactionId]);

      await audit(client, request.user.sub, 'RECONCILE', 'transaction', transactionId, { invoiceId });
      return { success: true, transactionId, invoiceId };
    });

    return reply.code(200).send(result);
  });

  // Dissocier un rapprochement
  app.post('/reconciliation/unmatch', { preHandler: app.authenticate }, async (request, reply) => {
    const body = objectBody(request.body);
    const invoiceId = requiredString(body.invoiceId, 'invoiceId');

    const result = await withTransaction(async (client) => {
      const invRes = await client.query('SELECT id, document_id, transaction_id FROM invoices WHERE id=$1 FOR UPDATE', [invoiceId]);
      if (!invRes.rowCount) throw new ApiError(404, 'Facture introuvable.', 'FACTURE_INTROUVABLE');
      const invoice = invRes.rows[0];
      const transactionId = invoice.transaction_id;

      await client.query('UPDATE invoices SET transaction_id=NULL, updated_at=now() WHERE id=$1', [invoiceId]);
      if (invoice.document_id) {
        await client.query('UPDATE documents SET transaction_id=NULL, updated_at=now() WHERE id=$1', [invoice.document_id]);
      }

      if (transactionId) {
        // Vérifier si la transaction est encore liée à une autre facture ou document
        const otherRes = await client.query(
          'SELECT 1 FROM invoices WHERE transaction_id=$1 UNION SELECT 1 FROM documents WHERE transaction_id=$1',
          [transactionId]
        );
        if (!otherRes.rowCount || otherRes.rowCount === 0) {
          await client.query("UPDATE transactions SET reconciliation_status='NON_RAPPROCHE', updated_at=now() WHERE id=$1", [transactionId]);
        }
        await audit(client, request.user.sub, 'UNRECONCILE', 'invoice', invoiceId, { transactionId });
      }

      return { success: true, invoiceId, transactionId };
    });

    return reply.code(200).send(result);
  });
};
