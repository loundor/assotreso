import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import { audit } from '../audit.js';
import { query, withTransaction } from '../db.js';
import { ApiError, objectBody, optionalNumeric, optionalString, requiredString } from '../errors.js';

export const reconciliationRoutes: FastifyPluginAsync = async (app) => {
  // Récupérer les rapprochements non effectués (< 100%) et terminés (paires liées)
  app.get('/reconciliation', { preHandler: app.authenticate }, async () => {
    // Opérations non rapprochées à 100%
    const unreconciledTransactions = await query(
      `SELECT t.*, t.amount::float8 AS amount, t.operation_date AS date, t.description AS label,
        CASE WHEN t.amount > 0 THEN 'income' ELSE 'expense' END AS direction,
        a.name AS account_name, a.name AS account,
        c.name AS category_name, p.name AS project_name,
        ABS(t.amount)::float8 AS "totalAmount",
        COALESCE(rec.reconciled_amount, 0)::float8 AS "reconciledAmount",
        GREATEST(ABS(t.amount) - COALESCE(rec.reconciled_amount, 0), 0)::float8 AS "remainingAmount",
        CASE
          WHEN ABS(t.amount) > 0 THEN LEAST(100.0, ROUND((COALESCE(rec.reconciled_amount, 0) / ABS(t.amount)) * 100.0, 1))::float8
          ELSE 100.0
        END AS "reconciliationPercent"
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN LATERAL (
         SELECT SUM(reconciled_amount) AS reconciled_amount
         FROM invoice_reconciliations
         WHERE transaction_id = t.id
       ) rec ON true
       WHERE (ABS(t.amount) - COALESCE(rec.reconciled_amount, 0)) > 0.009
       ORDER BY t.operation_date DESC, t.created_at DESC`
    );

    // Factures non rapprochées à 100%
    const unreconciledInvoices = await query(
      `SELECT i.*, i.invoice_number AS number, i.invoice_date AS date, i.total_ttc::float8 AS total,
        CASE WHEN i.direction = 'EMIS' THEN 'income' ELSE 'expense' END AS direction,
        i.direction AS invoice_direction,
        d.id AS document_id, d.original_name, d.mime_type,
        ABS(COALESCE(i.total_ttc, 0))::float8 AS "totalAmount",
        COALESCE(rec.reconciled_amount, 0)::float8 AS "reconciledAmount",
        GREATEST(ABS(COALESCE(i.total_ttc, 0)) - COALESCE(rec.reconciled_amount, 0), 0)::float8 AS "remainingAmount",
        CASE
          WHEN ABS(COALESCE(i.total_ttc, 0)) > 0 THEN LEAST(100.0, ROUND((COALESCE(rec.reconciled_amount, 0) / ABS(COALESCE(i.total_ttc, 0))) * 100.0, 1))::float8
          ELSE 100.0
        END AS "reconciliationPercent",
        COALESCE(a.allocated_amount, 0)::float8 AS allocated_amount,
        COALESCE(a.allocated_amount, 0)::float8 AS "allocatedAmount",
        GREATEST(ABS(COALESCE(i.total_ttc, 0)) - COALESCE(a.allocated_amount, 0), 0)::float8 AS remaining_allocation_amount,
        GREATEST(ABS(COALESCE(i.total_ttc, 0)) - COALESCE(a.allocated_amount, 0), 0)::float8 AS "remainingAllocationAmount"
       FROM invoices i
       JOIN documents d ON d.id = i.document_id
       LEFT JOIN LATERAL (
         SELECT SUM(amount) AS allocated_amount
         FROM invoice_allocations
         WHERE invoice_id = i.id
       ) a ON true
       LEFT JOIN LATERAL (
         SELECT SUM(reconciled_amount) AS reconciled_amount
         FROM invoice_reconciliations
         WHERE invoice_id = i.id
       ) rec ON true
       WHERE (ABS(COALESCE(i.total_ttc, 0)) - COALESCE(rec.reconciled_amount, 0)) > 0.009
       ORDER BY i.invoice_date DESC NULLS LAST, i.created_at DESC`
    );

    // Rapprochements existants (paires liées)
    const reconciledPairs = await query(
      `SELECT
         ir.id AS reconciliation_id,
         ir.reconciled_amount::float8 AS reconciled_amount,
         ir.created_at AS reconciled_at,
         i.id AS invoice_id,
         i.invoice_number,
         i.invoice_date,
         i.supplier AS invoice_supplier,
         i.recipient AS invoice_recipient,
         i.direction AS invoice_direction,
         CASE WHEN i.direction = 'EMIS' THEN 'income' ELSE 'expense' END AS invoice_direction_type,
         i.total_ttc::float8 AS invoice_total_ttc,
         COALESCE(inv_rec.total_reconciled, 0)::float8 AS invoice_reconciled_total,
         CASE
           WHEN ABS(COALESCE(i.total_ttc, 0)) > 0 THEN LEAST(100.0, ROUND((COALESCE(inv_rec.total_reconciled, 0) / ABS(COALESCE(i.total_ttc, 0))) * 100.0, 1))::float8
           ELSE 100.0
         END AS invoice_reconciliation_percent,
         d.id AS document_id,
         d.original_name AS document_name,
         d.mime_type AS document_mime_type,
         t.id AS transaction_id,
         t.operation_date AS transaction_date,
         t.amount::float8 AS transaction_amount,
         t.description AS transaction_description,
         t.bank_label AS transaction_bank_label,
         t.payment_method AS transaction_payment_method,
         COALESCE(tx_rec.total_reconciled, 0)::float8 AS transaction_reconciled_total,
         CASE
           WHEN ABS(COALESCE(t.amount, 0)) > 0 THEN LEAST(100.0, ROUND((COALESCE(tx_rec.total_reconciled, 0) / ABS(COALESCE(t.amount, 0))) * 100.0, 1))::float8
           ELSE 100.0
         END AS transaction_reconciliation_percent,
         a.name AS account_name
       FROM invoice_reconciliations ir
       JOIN invoices i ON i.id = ir.invoice_id
       JOIN documents d ON d.id = i.document_id
       JOIN transactions t ON t.id = ir.transaction_id
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN LATERAL (
         SELECT SUM(reconciled_amount) AS total_reconciled FROM invoice_reconciliations WHERE invoice_id = i.id
       ) inv_rec ON true
       LEFT JOIN LATERAL (
         SELECT SUM(reconciled_amount) AS total_reconciled FROM invoice_reconciliations WHERE transaction_id = t.id
       ) tx_rec ON true
       ORDER BY ir.created_at DESC, t.operation_date DESC`
    );

    return {
      unreconciledTransactions,
      unreconciledInvoices,
      reconciledPairs
    };
  });

  // Associer (rapprocher) une transaction et une facture (supporte les montants partiels et multi-paiements)
  app.post('/reconciliation', { preHandler: app.authenticate }, async (request, reply) => {
    const body = objectBody(request.body);
    const transactionId = requiredString(body.transactionId, 'transactionId');
    const invoiceId = requiredString(body.invoiceId, 'invoiceId');
    const requestedAmount = optionalNumeric(body.amount, 'montant de rapprochement');

    const result = await withTransaction(async (client) => {
      // 1. Transaction (verrouillage pour mise à jour sécurisée)
      const transRes = await client.query(
        `SELECT t.id, t.amount,
          COALESCE((
            SELECT SUM(ir.reconciled_amount)
            FROM invoice_reconciliations ir
            WHERE ir.transaction_id = t.id
          ), 0)::float8 AS already_reconciled
         FROM transactions t
         WHERE t.id = $1
         FOR UPDATE`,
        [transactionId]
      );
      if (!transRes.rowCount) throw new ApiError(404, 'Transaction introuvable.', 'TRANSACTION_INTROUVABLE');
      const tx = transRes.rows[0];
      const txTotal = Math.abs(Number(tx.amount));
      const txRemaining = Math.max(0, txTotal - Number(tx.already_reconciled));
      if (txRemaining <= 0.009) {
        throw new ApiError(409, 'Cette opération bancaire est déjà intégralement rapprochée (100%).', 'TRANSACTION_DEJA_RAPPROCHEE');
      }

      // 2. Facture (verrouillage pour mise à jour sécurisée)
      const invRes = await client.query(
        `SELECT i.id, i.document_id, i.total_ttc,
          COALESCE((
            SELECT SUM(ir.reconciled_amount)
            FROM invoice_reconciliations ir
            WHERE ir.invoice_id = i.id
          ), 0)::float8 AS already_reconciled
         FROM invoices i
         WHERE i.id = $1
         FOR UPDATE`,
        [invoiceId]
      );
      if (!invRes.rowCount) throw new ApiError(404, 'Facture introuvable.', 'FACTURE_INTROUVABLE');
      const invoice = invRes.rows[0];
      const invTotal = Math.abs(Number(invoice.total_ttc ?? 0));
      const invRemaining = Math.max(0, invTotal - Number(invoice.already_reconciled));
      if (invRemaining <= 0.009) {
        throw new ApiError(409, 'Cette facture est déjà intégralement rapprochée (100%).', 'FACTURE_DEJA_RAPPROCHEE');
      }

      // 3. Calcul du montant à rapprocher
      const maxPossible = Math.min(txRemaining, invRemaining);
      const amountToReconcile = requestedAmount && requestedAmount > 0
        ? Math.min(requestedAmount, maxPossible)
        : maxPossible;

      if (amountToReconcile <= 0) {
        throw new ApiError(400, 'Le montant de rapprochement calculé est invalide ou nul.', 'MONTANT_INVALIDE');
      }

      const recId = randomUUID();
      await client.query(
        `INSERT INTO invoice_reconciliations (id, invoice_id, transaction_id, reconciled_amount)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (invoice_id, transaction_id)
         DO UPDATE SET reconciled_amount = invoice_reconciliations.reconciled_amount + EXCLUDED.reconciled_amount, updated_at = now()`,
        [recId, invoiceId, transactionId, amountToReconcile]
      );

      // 4. Mettre à jour les statuts 100%
      const newTxRemaining = txRemaining - amountToReconcile;
      const newInvRemaining = invRemaining - amountToReconcile;

      if (newTxRemaining <= 0.009) {
        await client.query("UPDATE transactions SET reconciliation_status='RAPPROCHE', updated_at=now() WHERE id=$1", [transactionId]);
      } else {
        await client.query("UPDATE transactions SET reconciliation_status='NON_RAPPROCHE', updated_at=now() WHERE id=$1", [transactionId]);
      }

      if (newInvRemaining <= 0.009) {
        await client.query("UPDATE invoices SET transaction_id=$1, updated_at=now() WHERE id=$2", [transactionId, invoiceId]);
        if (invoice.document_id) {
          await client.query("UPDATE documents SET transaction_id=$1, updated_at=now() WHERE id=$2", [transactionId, invoice.document_id]);
        }
      }

      await audit(client, request.user.sub, 'RECONCILE', 'transaction', transactionId, {
        invoiceId,
        amount: amountToReconcile,
        newTxRemaining,
        newInvRemaining
      });

      return {
        success: true,
        transactionId,
        invoiceId,
        reconciledAmount: amountToReconcile,
        txRemaining: newTxRemaining,
        invRemaining: newInvRemaining,
        isTxCompleted: newTxRemaining <= 0.009,
        isInvCompleted: newInvRemaining <= 0.009
      };
    });

    return reply.code(200).send(result);
  });

  // Dissocier un rapprochement
  app.post('/reconciliation/unmatch', { preHandler: app.authenticate }, async (request, reply) => {
    const body = objectBody(request.body);
    const reconciliationId = optionalString(body.reconciliationId);
    const invoiceId = optionalString(body.invoiceId);
    const transactionId = optionalString(body.transactionId);

    const result = await withTransaction(async (client) => {
      let recs: { id: string; invoice_id: string; transaction_id: string; reconciled_amount: number }[] = [];

      if (reconciliationId) {
        const res = await client.query(
          'SELECT id, invoice_id, transaction_id, reconciled_amount FROM invoice_reconciliations WHERE id=$1',
          [reconciliationId]
        );
        recs = res.rows;
      } else if (invoiceId && transactionId) {
        const res = await client.query(
          'SELECT id, invoice_id, transaction_id, reconciled_amount FROM invoice_reconciliations WHERE invoice_id=$1 AND transaction_id=$2',
          [invoiceId, transactionId]
        );
        recs = res.rows;
      } else if (invoiceId) {
        const res = await client.query(
          'SELECT id, invoice_id, transaction_id, reconciled_amount FROM invoice_reconciliations WHERE invoice_id=$1',
          [invoiceId]
        );
        recs = res.rows;
      }

      if (!recs.length && invoiceId) {
        // Fallback rétrocompatible si non présent dans invoice_reconciliations
        const invRes = await client.query('SELECT id, document_id, transaction_id FROM invoices WHERE id=$1', [invoiceId]);
        if (invRes.rowCount) {
          const inv = invRes.rows[0];
          await client.query('UPDATE invoices SET transaction_id=NULL, updated_at=now() WHERE id=$1', [invoiceId]);
          if (inv.document_id) {
            await client.query('UPDATE documents SET transaction_id=NULL, updated_at=now() WHERE id=$1', [inv.document_id]);
          }
          if (inv.transaction_id) {
            await client.query("UPDATE transactions SET reconciliation_status='NON_RAPPROCHE', updated_at=now() WHERE id=$1", [inv.transaction_id]);
          }
          return { success: true, count: 1 };
        }
      }

      for (const rec of recs) {
        await client.query('DELETE FROM invoice_reconciliations WHERE id=$1', [rec.id]);

        // Mettre à jour la transaction
        const txCheck = await client.query(
          `SELECT t.amount, COALESCE(SUM(ir.reconciled_amount), 0)::float8 AS total_reconciled
           FROM transactions t
           LEFT JOIN invoice_reconciliations ir ON ir.transaction_id = t.id
           WHERE t.id = $1
           GROUP BY t.id, t.amount`,
          [rec.transaction_id]
        );
        if (txCheck.rowCount) {
          const rem = Math.abs(Number(txCheck.rows[0].amount)) - Number(txCheck.rows[0].total_reconciled);
          const status = rem <= 0.009 ? 'RAPPROCHE' : 'NON_RAPPROCHE';
          await client.query('UPDATE transactions SET reconciliation_status=$1, updated_at=now() WHERE id=$2', [status, rec.transaction_id]);
        }

        // Mettre à jour la facture
        const invCheck = await client.query(
          `SELECT i.id, i.document_id, i.total_ttc, COALESCE(SUM(ir.reconciled_amount), 0)::float8 AS total_reconciled
           FROM invoices i
           LEFT JOIN invoice_reconciliations ir ON ir.invoice_id = i.id
           WHERE i.id = $1
           GROUP BY i.id, i.document_id, i.total_ttc`,
          [rec.invoice_id]
        );
        if (invCheck.rowCount) {
          const inv = invCheck.rows[0];
          const rem = Math.abs(Number(inv.total_ttc ?? 0)) - Number(inv.total_reconciled);
          if (rem > 0.009) {
            await client.query('UPDATE invoices SET transaction_id=NULL, updated_at=now() WHERE id=$1', [rec.invoice_id]);
            if (inv.document_id) {
              await client.query('UPDATE documents SET transaction_id=NULL, updated_at=now() WHERE id=$1', [inv.document_id]);
            }
          }
        }

        await audit(client, request.user.sub, 'UNRECONCILE', 'invoice_reconciliation', rec.id, {
          invoiceId: rec.invoice_id,
          transactionId: rec.transaction_id,
          amount: rec.reconciled_amount
        });
      }

      return { success: true, count: recs.length };
    });

    return reply.code(200).send(result);
  });
};
