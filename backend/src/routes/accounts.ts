import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { audit } from '../audit.js';
import { pool, query } from '../db.js';
import { ApiError, booleanValue, numeric, objectBody, optionalString, requiredString } from '../errors.js';

export const accountRoutes: FastifyPluginAsync = async (app) => {
  app.get('/accounts', { preHandler: app.authenticate }, async () => ({
    accounts: await query(`SELECT a.*, a.bank AS bank_name, a.bank AS "bankName",
      a.initial_balance::float8 AS "initialBalance",
      (a.initial_balance + COALESCE(SUM(t.amount), 0))::float8 AS current_balance,
      (a.initial_balance + COALESCE(SUM(t.amount), 0))::float8 AS balance
      FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id GROUP BY a.id ORDER BY a.name`)
  }));

  app.post('/accounts', { preHandler: app.authenticate }, async (request, reply) => {
    const body = objectBody(request.body);
    const id = randomUUID();
    const rows = await query(
      `INSERT INTO accounts (id, name, type, bank, iban, initial_balance, currency, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [id, requiredString(body.name, 'nom'), requiredString(body.type, 'type'), optionalString(body.bank ?? body.bankName), optionalString(body.iban), numeric(body.initialBalance ?? body.balance ?? 0, 'solde initial'), (optionalString(body.currency) ?? 'EUR').toUpperCase(), booleanValue(body.active, true)]
    );
    await audit(pool, request.user.sub, 'CREATE', 'account', id);
    return reply.code(201).send({ account: rows[0] });
  });

  app.put<{ Params: { id: string } }>('/accounts/:id', { preHandler: app.authenticate }, async (request) => {
    const body = objectBody(request.body);
    const rows = await query(
      `UPDATE accounts SET name=$2,type=$3,bank=$4,iban=$5,initial_balance=$6,currency=$7,active=$8,updated_at=now()
       WHERE id=$1 RETURNING *`,
      [request.params.id, requiredString(body.name, 'nom'), requiredString(body.type, 'type'), optionalString(body.bank ?? body.bankName), optionalString(body.iban), numeric(body.initialBalance ?? body.balance ?? 0, 'solde initial'), (optionalString(body.currency) ?? 'EUR').toUpperCase(), booleanValue(body.active, true)]
    );
    if (!rows[0]) throw new ApiError(404, 'Compte introuvable.', 'COMPTE_INTROUVABLE');
    await audit(pool, request.user.sub, 'UPDATE', 'account', request.params.id);
    return { account: rows[0] };
  });

  app.delete<{ Params: { id: string } }>('/accounts/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const rows = await query('DELETE FROM accounts WHERE id=$1 RETURNING id', [request.params.id]);
    if (!rows[0]) throw new ApiError(404, 'Compte introuvable ou utilisé par des opérations.', 'COMPTE_INTROUVABLE');
    await audit(pool, request.user.sub, 'DELETE', 'account', request.params.id);
    return reply.code(204).send();
  });
};
