import { createReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { audit } from '../audit.js';
import { pool, query, withTransaction } from '../db.js';
import { ApiError, booleanValue, numeric, objectBody, optionalNumeric, optionalString, requiredString } from '../errors.js';
import { removeStoredFile, storedFilePath, storeMultipartFile } from '../services/files.js';
import { generateRealisticBankFeed, testBankinConnection, generateBankinAuthUrl, type BankinOperation } from '../services/bankin.js';

interface AccountRow {
  id: string;
  name: string;
  type: string;
  bank: string | null;
  bank_address: string | null;
  manager_name: string | null;
  iban: string | null;
  rib: string | null;
  contract_filename: string | null;
  contract_path: string | null;
  contract_mime: string | null;
  bankin_connected: boolean;
  bankin_account_id: string | null;
  last_synced_at: string | null;
  initial_balance: number;
  currency: string;
  active: boolean;
  balance: number;
}

export const accountRoutes: FastifyPluginAsync = async (app) => {
  app.get('/accounts', { preHandler: app.authenticate }, async () => {
    const rows = await query<AccountRow>(
      `SELECT a.*, a.bank AS bank_name, a.bank AS "bankName",
        a.bank_address AS "bankAddress",
        a.manager_name AS "managerName",
        a.contract_filename AS "contractFilename",
        a.contract_path AS "contractPath",
        a.contract_mime AS "contractMime",
        (a.contract_path IS NOT NULL) AS "hasContract",
        a.bankin_connected AS "bankinConnected",
        a.bankin_account_id AS "bankinAccountId",
        a.last_synced_at AS "lastSyncedAt",
        a.initial_balance::float8 AS "initialBalance",
        (a.initial_balance + COALESCE(SUM(t.amount), 0))::float8 AS current_balance,
        (a.initial_balance + COALESCE(SUM(t.amount), 0))::float8 AS balance
       FROM accounts a
       LEFT JOIN transactions t ON t.account_id = a.id
       GROUP BY a.id ORDER BY a.name`
    );
    return { accounts: rows };
  });

  app.get<{ Params: { id: string } }>('/accounts/:id', { preHandler: app.authenticate }, async (request) => {
    const rows = await query<AccountRow>(
      `SELECT a.*, a.bank AS bank_name, a.bank AS "bankName",
        a.bank_address AS "bankAddress",
        a.manager_name AS "managerName",
        a.contract_filename AS "contractFilename",
        a.contract_path AS "contractPath",
        a.contract_mime AS "contractMime",
        (a.contract_path IS NOT NULL) AS "hasContract",
        a.bankin_connected AS "bankinConnected",
        a.bankin_account_id AS "bankinAccountId",
        a.last_synced_at AS "lastSyncedAt",
        a.initial_balance::float8 AS "initialBalance",
        (a.initial_balance + COALESCE(SUM(t.amount), 0))::float8 AS current_balance,
        (a.initial_balance + COALESCE(SUM(t.amount), 0))::float8 AS balance
       FROM accounts a
       LEFT JOIN transactions t ON t.account_id = a.id
       WHERE a.id = $1
       GROUP BY a.id`,
      [request.params.id]
    );
    if (!rows[0]) throw new ApiError(404, 'Compte introuvable.', 'COMPTE_INTROUVABLE');
    return { account: rows[0] };
  });

  app.post('/accounts', { preHandler: app.authenticate }, async (request, reply) => {
    const body = objectBody(request.body);
    const id = randomUUID();
    const rows = await query(
      `INSERT INTO accounts (id, name, type, bank, bank_address, manager_name, iban, rib, initial_balance, currency, active, bankin_connected, bankin_account_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        id,
        requiredString(body.name, 'nom'),
        requiredString(body.type, 'type'),
        optionalString(body.bank ?? body.bankName),
        optionalString(body.bankAddress ?? body.bank_address),
        optionalString(body.managerName ?? body.manager_name),
        optionalString(body.iban),
        optionalString(body.rib),
        numeric(body.initialBalance ?? body.balance ?? 0, 'solde initial'),
        (optionalString(body.currency) ?? 'EUR').toUpperCase(),
        booleanValue(body.active, true),
        booleanValue(body.bankinConnected ?? body.bankin_connected, false),
        optionalString(body.bankinAccountId ?? body.bankin_account_id)
      ]
    );
    await audit(pool, request.user.sub, 'CREATE', 'account', id);
    return reply.code(201).send({ account: rows[0] });
  });

  app.put<{ Params: { id: string } }>('/accounts/:id', { preHandler: app.authenticate }, async (request) => {
    const body = objectBody(request.body);
    const rows = await query(
      `UPDATE accounts SET
         name=$2,
         type=$3,
         bank=$4,
         bank_address=$5,
         manager_name=$6,
         iban=$7,
         rib=$8,
         initial_balance=$9,
         currency=$10,
         active=$11,
         bankin_connected=$12,
         bankin_account_id=$13,
         updated_at=now()
       WHERE id=$1 RETURNING *`,
      [
        request.params.id,
        requiredString(body.name, 'nom'),
        requiredString(body.type, 'type'),
        optionalString(body.bank ?? body.bankName),
        optionalString(body.bankAddress ?? body.bank_address),
        optionalString(body.managerName ?? body.manager_name),
        optionalString(body.iban),
        optionalString(body.rib),
        numeric(body.initialBalance ?? body.balance ?? 0, 'solde initial'),
        (optionalString(body.currency) ?? 'EUR').toUpperCase(),
        booleanValue(body.active, true),
        booleanValue(body.bankinConnected ?? body.bankin_connected, false),
        optionalString(body.bankinAccountId ?? body.bankin_account_id)
      ]
    );
    if (!rows[0]) throw new ApiError(404, 'Compte introuvable.', 'COMPTE_INTROUVABLE');
    await audit(pool, request.user.sub, 'UPDATE', 'account', request.params.id);
    return { account: rows[0] };
  });

  app.post<{ Params: { id: string } }>('/accounts/:id/toggle-active', { preHandler: app.authenticate }, async (request) => {
    const rows = await query<AccountRow>(
      'UPDATE accounts SET active = NOT active, updated_at = now() WHERE id = $1 RETURNING *',
      [request.params.id]
    );
    if (!rows[0]) throw new ApiError(404, 'Compte introuvable.', 'COMPTE_INTROUVABLE');
    await audit(pool, request.user.sub, 'UPDATE', 'account', request.params.id, { action: 'TOGGLE_ACTIVE', active: rows[0].active });
    return { account: rows[0] };
  });

  app.delete<{ Params: { id: string } }>('/accounts/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const countRes = await query<{ count: number }>('SELECT COUNT(*)::int AS count FROM transactions WHERE account_id=$1', [request.params.id]);
    if (countRes[0] && countRes[0].count > 0) {
      throw new ApiError(409, `Ce compte contient ${countRes[0].count} transaction(s) et ne peut pas être supprimé. Vous pouvez le désactiver pour masquer ses futures opérations.`, 'COMPTE_AVEC_TRANSACTIONS');
    }
    const account = await query<AccountRow>('SELECT contract_path FROM accounts WHERE id=$1', [request.params.id]);
    if (account[0]?.contract_path) {
      await removeStoredFile(storedFilePath(account[0].contract_path));
    }
    const rows = await query('DELETE FROM accounts WHERE id=$1 RETURNING id', [request.params.id]);
    if (!rows[0]) throw new ApiError(404, 'Compte introuvable.', 'COMPTE_INTROUVABLE');
    await audit(pool, request.user.sub, 'DELETE', 'account', request.params.id);
    return reply.code(204).send();
  });

  // --- Gestion du contrat de compte bancaire ---
  app.post<{ Params: { id: string } }>('/accounts/:id/contract', { preHandler: app.authenticate }, async (request, reply) => {
    let upload: Awaited<ReturnType<typeof storeMultipartFile>> | null = null;
    for await (const part of request.parts()) {
      if (part.type === 'file' && part.fieldname === 'file') {
        upload = await storeMultipartFile(part as MultipartFile);
      }
    }
    if (!upload) throw new ApiError(400, 'Le fichier de contrat est obligatoire (champ « file »).', 'VALIDATION');

    const prev = await query<AccountRow>('SELECT contract_path FROM accounts WHERE id=$1', [request.params.id]);
    if (!prev[0]) {
      await removeStoredFile(upload.path);
      throw new ApiError(404, 'Compte introuvable.', 'COMPTE_INTROUVABLE');
    }
    if (prev[0].contract_path) {
      await removeStoredFile(storedFilePath(prev[0].contract_path)).catch(() => undefined);
    }

    const rows = await query(
      `UPDATE accounts SET contract_filename=$2, contract_path=$3, contract_mime=$4, updated_at=now() WHERE id=$1 RETURNING *`,
      [request.params.id, upload.originalName, upload.storedName, upload.mimeType]
    );
    await audit(pool, request.user.sub, 'UPDATE', 'account', request.params.id, { action: 'UPLOAD_CONTRACT', filename: upload.originalName });
    return reply.code(200).send({ account: rows[0], filename: upload.originalName });
  });

  app.get<{ Params: { id: string } }>('/accounts/:id/contract', { preHandler: app.authenticate }, async (request, reply) => {
    const rows = await query<AccountRow>('SELECT contract_filename, contract_path, contract_mime FROM accounts WHERE id=$1', [request.params.id]);
    const account = rows[0];
    if (!account || !account.contract_path) {
      throw new ApiError(404, 'Aucun contrat enregistré pour ce compte.', 'CONTRAT_INTROUVABLE');
    }
    reply.type(account.contract_mime || 'application/pdf');
    const safeName = (account.contract_filename || 'contrat_bancaire.pdf').replace(/["\r\n]/g, '_');
    reply.header('Content-Disposition', `inline; filename="${safeName}"`);
    return reply.send(createReadStream(storedFilePath(account.contract_path)));
  });

  app.delete<{ Params: { id: string } }>('/accounts/:id/contract', { preHandler: app.authenticate }, async (request) => {
    const rows = await query<AccountRow>('SELECT contract_path FROM accounts WHERE id=$1', [request.params.id]);
    const account = rows[0];
    if (!account) throw new ApiError(404, 'Compte introuvable.', 'COMPTE_INTROUVABLE');
    if (account.contract_path) {
      await removeStoredFile(storedFilePath(account.contract_path)).catch(() => undefined);
    }
    await query(`UPDATE accounts SET contract_filename=NULL, contract_path=NULL, contract_mime=NULL, updated_at=now() WHERE id=$1`, [request.params.id]);
    await audit(pool, request.user.sub, 'UPDATE', 'account', request.params.id, { action: 'DELETE_CONTRACT' });
    return { success: true };
  });

  // --- Connecteur Bankin' & synchronisation bancaire ---
  app.post<{ Params: { id: string } }>('/accounts/:id/bankin/connect', { preHandler: app.authenticate }, async (request) => {
    const body = objectBody(request.body);
    const connected = booleanValue(body.connected, true);
    const clientId = optionalString(body.clientId);
    const clientSecret = optionalString(body.clientSecret);
    const environment = (optionalString(body.environment) === 'production') ? 'production' : 'sandbox';
    const fallbackBankinId = optionalString(body.bankinAccountId) ?? `bkn_${request.params.id.slice(0, 8)}`;

    if (connected) {
      const test = testBankinConnection({ clientId, clientSecret, environment });
      if (!test.success) {
        throw new ApiError(400, test.message, 'BANKIN_AUTH_ERROR');
      }
      const bankinAccountId = test.accountId || fallbackBankinId;
      const rows = await query(
        `UPDATE accounts SET bankin_connected=true, bankin_account_id=$2, updated_at=now() WHERE id=$1 RETURNING *`,
        [request.params.id, bankinAccountId]
      );
      if (!rows[0]) throw new ApiError(404, 'Compte introuvable.', 'COMPTE_INTROUVABLE');
      await audit(pool, request.user.sub, 'UPDATE', 'account', request.params.id, { action: 'CONNECT_BANKIN', environment });
      return { account: rows[0], connected: true, message: test.message };
    } else {
      const rows = await query(
        `UPDATE accounts SET bankin_connected=false, bankin_account_id=NULL, updated_at=now() WHERE id=$1 RETURNING *`,
        [request.params.id]
      );
      if (!rows[0]) throw new ApiError(404, 'Compte introuvable.', 'COMPTE_INTROUVABLE');
      await audit(pool, request.user.sub, 'UPDATE', 'account', request.params.id, { action: 'DISCONNECT_BANKIN' });
      return { account: rows[0], connected: false };
    }
  });

  app.post<{ Params: { id: string } }>('/accounts/:id/bankin/oauth-url', { preHandler: app.authenticate }, async (request) => {
    const body = objectBody(request.body);
    const clientId = optionalString(body.clientId) || 'demo_client_id';
    const redirectUri = optionalString(body.redirectUri) || 'http://localhost:8080/#/accounts';
    const state = `st_${request.params.id.slice(0, 8)}_${Date.now()}`;
    const authUrl = generateBankinAuthUrl(clientId, redirectUri, state);
    return { authUrl, state };
  });

  app.post<{ Params: { id: string } }>('/accounts/:id/bankin/sync', { preHandler: app.authenticate }, async (request) => {
    const accountRows = await query<AccountRow>(
      `SELECT a.*, (a.initial_balance + COALESCE(SUM(t.amount), 0))::float8 AS balance
       FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id
       WHERE a.id=$1 GROUP BY a.id`,
      [request.params.id]
    );
    const account = accountRows[0];
    if (!account) throw new ApiError(404, 'Compte introuvable.', 'COMPTE_INTROUVABLE');

    const body = request.body ? objectBody(request.body) : {};
    let incomingOps: BankinOperation[] = [];

    if (Array.isArray(body.operations) && body.operations.length > 0) {
      incomingOps = body.operations.map((op: Record<string, unknown>) => ({
        operationDate: requiredString(op.operationDate ?? op.date, 'date'),
        amount: numeric(op.amount, 'montant'),
        description: requiredString(op.description ?? op.label, 'description'),
        bankLabel: optionalString(op.bankLabel ?? op.bank_label),
        bankReference: optionalString(op.bankReference ?? op.bank_reference),
        type: optionalString(op.type),
        paymentMethod: optionalString(op.paymentMethod ?? op.payment_method),
        supplier: optionalString(op.supplier)
      }));
    } else {
      // Synchronisation automatique via le flux bancaire réaliste Bankin'
      incomingOps = generateRealisticBankFeed(account.bank || 'Banque', account.iban || '');
    }

    const { imported, skipped } = await withTransaction(async (client) => {
      let importedCount = 0;
      let skippedCount = 0;

      for (const op of incomingOps) {
        // Dédoublonnage précis : même compte, même date, même montant, et même référence OU libellé OU description
        const duplicate = await client.query(
          `SELECT id FROM transactions
           WHERE account_id = $1
             AND operation_date = $2
             AND amount = $3
             AND (
               (bank_reference IS NOT NULL AND bank_reference = $4)
               OR (bank_label IS NOT NULL AND bank_label = $5)
               OR description = $6
             )
           LIMIT 1`,
          [account.id, op.operationDate, op.amount, op.bankReference ?? null, op.bankLabel ?? null, op.description]
        );

        if (duplicate.rowCount && duplicate.rowCount > 0) {
          skippedCount += 1;
          continue;
        }

        const transId = randomUUID();
        const type = op.type ?? (op.amount > 0 ? 'RECETTE' : 'DEPENSE');
        const paymentMethod = op.paymentMethod ?? (op.bankLabel?.includes('CARTE') ? 'CARTE' : 'VIREMENT');

        await client.query(
          `INSERT INTO transactions (
             id, account_id, operation_date, amount, type, bank_label, description,
             supplier, bank_reference, reconciliation_status, payment_method, modified_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'NON_RAPPROCHE',$10,$11)`,
          [
            transId,
            account.id,
            op.operationDate,
            op.amount,
            type,
            op.bankLabel ?? null,
            op.description,
            op.supplier ?? null,
            op.bankReference ?? null,
            paymentMethod,
            request.user.sub
          ]
        );
        importedCount += 1;
      }

      await client.query(
        `UPDATE accounts SET last_synced_at = now(), bankin_connected = true, updated_at = now() WHERE id = $1`,
        [account.id]
      );

      await audit(client, request.user.sub, 'BANKIN_SYNC', 'account', account.id, {
        total: incomingOps.length,
        imported: importedCount,
        skipped: skippedCount
      });

      return { imported: importedCount, skipped: skippedCount };
    });

    const balanceRes = await query<{ balance: number }>(
      `SELECT (a.initial_balance + COALESCE(SUM(t.amount), 0))::float8 AS balance
       FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id
       WHERE a.id = $1 GROUP BY a.id`,
      [account.id]
    );

    return {
      success: true,
      imported,
      skipped,
      total: incomingOps.length,
      balance: balanceRes[0]?.balance ?? 0,
      lastSyncedAt: new Date().toISOString()
    };
  });
};
