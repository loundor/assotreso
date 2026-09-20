import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { audit } from '../audit.js';
import { pool, query, withTransaction } from '../db.js';
import { ApiError, numeric, objectBody, optionalString, requiredString } from '../errors.js';
import { csvEscape, parseBankCsv } from '../services/csv.js';

const transactionTypes = new Set(['RECETTE','DEPENSE','VIREMENT_INTERNE','REMBOURSEMENT','COTISATION','DON','SUBVENTION','AUTRE']);

function transactionType(value: unknown): string {
  const type = requiredString(value, 'type').toUpperCase();
  if (!transactionTypes.has(type)) throw new ApiError(400, 'Type d’opération invalide.', 'VALIDATION');
  return type;
}

interface ListQuery {
  accountId?: string;
  categoryId?: string;
  projectId?: string;
  from?: string;
  to?: string;
  search?: string;
  limit?: string;
  offset?: string;
}

function transactionValues(body: Record<string, unknown>, userId: string): unknown[] {
  let amount = numeric(body.amount, 'montant');
  const direction = optionalString(body.direction)?.toLowerCase();
  if (direction === 'expense' || direction === 'debit') amount = -Math.abs(amount);
  if (direction === 'income' || direction === 'credit') amount = Math.abs(amount);
  if (amount === 0) throw new ApiError(400, 'Le montant ne peut pas être nul.', 'VALIDATION');
  const inferredType = amount > 0 ? 'RECETTE' : 'DEPENSE';
  const paymentMethod = optionalString(body.paymentMethod ?? body.payment_method);
  return [
    requiredString(body.accountId, 'compte'),
    requiredString(body.operationDate ?? body.date, 'date'),
    amount,
    transactionType(body.type ?? inferredType),
    optionalString(body.bankLabel ?? body.label),
    requiredString(body.description ?? body.label, 'description'),
    optionalString(body.categoryId),
    optionalString(body.projectId),
    optionalString(body.supplier),
    optionalString(body.bankReference),
    optionalString(body.reconciliationStatus) ?? 'NON_RAPPROCHE',
    optionalString(body.comment),
    userId,
    paymentMethod
  ];
}

export const transactionRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ListQuery }>('/transactions', { preHandler: app.authenticate }, async (request) => {
    const values: unknown[] = [];
    const filters: string[] = [];
    const addFilter = (sql: string, value: string): void => {
      values.push(value);
      filters.push(sql.replace('?', `$${values.length}`));
    };
    if (request.query.accountId) addFilter('t.account_id = ?', request.query.accountId);
    if (request.query.categoryId) addFilter('t.category_id = ?', request.query.categoryId);
    if (request.query.projectId) addFilter('t.project_id = ?', request.query.projectId);
    if (request.query.from) addFilter('t.operation_date >= ?', request.query.from);
    if (request.query.to) addFilter('t.operation_date <= ?', request.query.to);
    if (request.query.search) {
      values.push(request.query.search);
      filters.push(`(t.description ILIKE '%' || $${values.length} || '%' OR t.bank_label ILIKE '%' || $${values.length} || '%' OR t.supplier ILIKE '%' || $${values.length} || '%')`);
    }
    const limit = Math.min(Math.max(Number.parseInt(request.query.limit ?? '100', 10) || 100, 1), 500);
    const offset = Math.max(Number.parseInt(request.query.offset ?? '0', 10) || 0, 0);
    values.push(limit, offset);
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const transactions = await query(
      `SELECT t.*, t.amount::float8 AS amount, t.operation_date AS date, t.description AS label,
        CASE WHEN t.amount > 0 THEN 'income' ELSE 'expense' END AS direction,
        a.name AS account_name, a.name AS account,
        c.name AS category_name, c.name AS category,
        p.name AS project_name, p.name AS project,
        EXISTS(SELECT 1 FROM documents d WHERE d.transaction_id=t.id) AS has_document
       FROM transactions t JOIN accounts a ON a.id=t.account_id
       LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN projects p ON p.id=t.project_id
       ${where} ORDER BY t.operation_date DESC, t.created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    return { transactions, limit, offset };
  });

  app.post('/transactions', { preHandler: app.authenticate }, async (request, reply) => {
    const body = objectBody(request.body);
    const id = randomUUID();
    const values = transactionValues(body, request.user.sub);
    const rows = await query(
      `INSERT INTO transactions (id,account_id,operation_date,amount,type,bank_label,description,category_id,project_id,supplier,bank_reference,reconciliation_status,comment,modified_by,payment_method)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [id, ...values]
    );
    await audit(pool, request.user.sub, 'CREATE', 'transaction', id);
    return reply.code(201).send({ transaction: rows[0] });
  });

  app.put<{ Params: { id: string } }>('/transactions/:id', { preHandler: app.authenticate }, async (request) => {
    const values = transactionValues(objectBody(request.body), request.user.sub);
    const rows = await query(
      `UPDATE transactions SET account_id=$2,operation_date=$3,amount=$4,type=$5,bank_label=$6,description=$7,category_id=$8,project_id=$9,supplier=$10,bank_reference=$11,reconciliation_status=$12,comment=$13,modified_by=$14,payment_method=$15,updated_at=now()
       WHERE id=$1 RETURNING *`,
      [request.params.id, ...values]
    );
    if (!rows[0]) throw new ApiError(404, 'Opération introuvable.', 'OPERATION_INTROUVABLE');
    await audit(pool, request.user.sub, 'UPDATE', 'transaction', request.params.id);
    return { transaction: rows[0] };
  });

  app.delete<{ Params: { id: string } }>('/transactions/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const rows = await query('DELETE FROM transactions WHERE id=$1 RETURNING id', [request.params.id]);
    if (!rows[0]) throw new ApiError(404, 'Opération introuvable.', 'OPERATION_INTROUVABLE');
    await audit(pool, request.user.sub, 'DELETE', 'transaction', request.params.id);
    return reply.code(204).send();
  });

  app.post('/transactions/import', { preHandler: app.authenticate }, async (request, reply) => {
    let accountId: string | null = null;
    let csv: Buffer | null = null;
    for await (const part of request.parts()) {
      if (part.type === 'field' && part.fieldname === 'accountId') accountId = String(part.value);
      if (part.type === 'file') {
        if (csv) throw new ApiError(400, 'Un seul fichier CSV est accepté.', 'CSV_INVALIDE');
        if (!['text/csv', 'application/vnd.ms-excel', 'text/plain'].includes(part.mimetype)) {
          throw new ApiError(415, 'Le fichier doit être au format CSV.', 'TYPE_FICHIER_REFUSE');
        }
        csv = await part.toBuffer();
        if (part.file.truncated) throw new ApiError(413, 'Le fichier CSV dépasse 10 Mo.', 'FICHIER_TROP_VOLUMINEUX');
      }
    }
    if (!accountId) throw new ApiError(400, 'Le champ multipart « accountId » est obligatoire.', 'VALIDATION');
    if (!csv) throw new ApiError(400, 'Le champ multipart « file » est obligatoire.', 'VALIDATION');
    const parsed = parseBankCsv(csv.toString('utf8'));
    const imported = await withTransaction(async (client) => {
      const account = await client.query('SELECT id FROM accounts WHERE id=$1', [accountId]);
      if (!account.rowCount) throw new ApiError(404, 'Compte introuvable.', 'COMPTE_INTROUVABLE');
      let count = 0;
      for (const item of parsed) {
        const duplicate = await client.query(
          `SELECT id FROM transactions WHERE account_id=$1 AND operation_date=$2 AND amount=$3
           AND COALESCE(bank_reference,'')=COALESCE($4,'') AND description=$5 LIMIT 1`,
          [accountId, item.operationDate, item.amount, item.bankReference, item.description]
        );
        if (duplicate.rowCount) continue;
        const id = randomUUID();
        await client.query(
          `INSERT INTO transactions (id,account_id,operation_date,amount,type,bank_label,description,bank_reference,modified_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [id, accountId, item.operationDate, item.amount, item.amount > 0 ? 'RECETTE' : 'DEPENSE', item.bankLabel, item.description, item.bankReference, request.user.sub]
        );
        count += 1;
      }
      await audit(client, request.user.sub, 'IMPORT_CSV', 'transaction', null, { received: parsed.length, imported: count });
      return count;
    });
    return reply.code(201).send({ received: parsed.length, imported, skipped: parsed.length - imported });
  });

  app.get<{ Querystring: ListQuery }>('/transactions/export.csv', { preHandler: app.authenticate }, async (request, reply) => {
    const values: unknown[] = [];
    const filters: string[] = [];
    if (request.query.from) { values.push(request.query.from); filters.push(`t.operation_date >= $${values.length}`); }
    if (request.query.to) { values.push(request.query.to); filters.push(`t.operation_date <= $${values.length}`); }
    if (request.query.accountId) { values.push(request.query.accountId); filters.push(`t.account_id = $${values.length}`); }
    const rows = await query<Record<string, unknown>>(
      `SELECT t.operation_date,t.description,t.amount,t.type,a.name AS compte,c.name AS categorie,p.name AS projet,t.supplier,t.bank_reference
       FROM transactions t JOIN accounts a ON a.id=t.account_id LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN projects p ON p.id=t.project_id
       ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''} ORDER BY t.operation_date`, values
    );
    const headers = ['date','description','montant','type','compte','categorie','projet','fournisseur','reference'];
    const keys = ['operation_date','description','amount','type','compte','categorie','projet','supplier','bank_reference'];
    const content = [headers.join(';'), ...rows.map((row) => keys.map((key) => csvEscape(row[key])).join(';'))].join('\n');
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="transactions-${new Date().toISOString().slice(0, 10)}.csv"`);
    return `\uFEFF${content}`;
  });
};
