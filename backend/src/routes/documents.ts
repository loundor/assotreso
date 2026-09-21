import { createReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { FastifyPluginAsync } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { audit } from '../audit.js';
import { query, withTransaction } from '../db.js';
import { ApiError, objectBody, optionalNumeric, optionalString } from '../errors.js';
import { absoluteMoneyCents, parseInvoiceAllocations, type InvoiceAllocationInput } from '../services/allocations.js';
import { analyzeDocument } from '../services/ocr.js';
import type { ExtractedAnalysis } from '../services/extraction.js';
import { analyzeInvoiceWithAi, mergeAiAnalysis } from '../services/ai.js';
import { getEnabledAiSettings } from './configuration.js';
import { removeStoredFile, storeMultipartFile, storedFilePath, type StoredUpload } from '../services/files.js';

interface DocumentRow {
  id: string;
  original_name: string;
  stored_name: string;
  mime_type: string;
  size_bytes: number;
  transaction_id: string | null;
  ocr_text: string | null;
  analysis: Record<string, unknown> | null;
  status: string;
  created_at: string;
}

interface InvoiceTotalRow {
  id: string;
  total_ttc: string | number | null;
}

function normalizeInvoiceDirection(value: unknown): 'RECU' | 'EMIS' {
  const str = String(value ?? '').trim().toUpperCase();
  if (['EMIS', 'EMISE', 'INCOME', 'RECETTE', 'GAIN', 'VENTE', 'CREDIT'].includes(str)) {
    return 'EMIS';
  }
  return 'RECU';
}

function clientAnalysis(analysis: ExtractedAnalysis, documentId: string, preferredDirection?: string): Record<string, unknown> {
  const normalizedDirection = preferredDirection ? normalizeInvoiceDirection(preferredDirection) : normalizeInvoiceDirection(analysis.direction);
  return {
    ...analysis,
    type: 'invoice',
    direction: normalizedDirection === 'EMIS' ? 'income' : 'expense',
    invoice_direction: normalizedDirection,
    number: analysis.invoiceNumber,
    date: analysis.invoiceDate,
    subtotal: analysis.totalHt,
    tax: analysis.vatAmount,
    total: analysis.totalTtc,
    previewUrl: `/api/documents/${documentId}/preview`
  };
}

function analysisObject(body: Record<string, unknown>): Record<string, unknown> {
  const value = body.analysis ?? body;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'Le champ « analysis » doit être un objet.', 'VALIDATION');
  }
  return value as Record<string, unknown>;
}

async function normalizedAllocationTargets(client: PoolClient, allocations: InvoiceAllocationInput[]): Promise<InvoiceAllocationInput[]> {
  const normalized: InvoiceAllocationInput[] = [];
  for (const allocation of allocations) {
    let projectId = allocation.projectId;
    if (projectId) {
      const project = await client.query('SELECT id FROM projects WHERE id=$1', [projectId]);
      if (!project.rowCount) throw new ApiError(404, 'Projet d’allocation introuvable.', 'PROJET_INTROUVABLE');
    }
    if (allocation.categoryId) {
      const category = await client.query<{ project_id: string | null }>(
        'SELECT project_id FROM categories WHERE id=$1', [allocation.categoryId]
      );
      if (!category.rows[0]) throw new ApiError(404, 'Catégorie d’allocation introuvable.', 'CATEGORIE_INTROUVABLE');
      const categoryProjectId = category.rows[0].project_id;
      if (categoryProjectId && projectId && categoryProjectId !== projectId) {
        throw new ApiError(409, 'La catégorie n’appartient pas au projet de l’allocation.', 'ALLOCATION_CATEGORIE_INCOMPATIBLE');
      }
      if (categoryProjectId && !projectId) projectId = categoryProjectId;
    }
    normalized.push({ ...allocation, projectId });
  }
  return normalized;
}

async function allocationRows(client: PoolClient, invoiceId: string): Promise<Record<string, unknown>[]> {
  const result = await client.query<Record<string, unknown>>(
    `SELECT a.*,a.project_id AS "projectId",a.category_id AS "categoryId",a.amount::float8 AS amount,
       p.name AS project_name,c.name AS category_name
     FROM invoice_allocations a
     LEFT JOIN projects p ON p.id=a.project_id LEFT JOIN categories c ON c.id=a.category_id
     WHERE a.invoice_id=$1 ORDER BY a.created_at,a.id`,
    [invoiceId]
  );
  return result.rows;
}

async function replaceAllocations(
  client: PoolClient,
  invoiceId: string,
  rawAllocations: unknown
): Promise<Record<string, unknown>[]> {
  const invoiceResult = await client.query<InvoiceTotalRow>('SELECT id,total_ttc FROM invoices WHERE id=$1 FOR UPDATE', [invoiceId]);
  const invoice = invoiceResult.rows[0];
  if (!invoice) throw new ApiError(404, 'Facture introuvable.', 'FACTURE_INTROUVABLE');
  const allocations = await normalizedAllocationTargets(client, parseInvoiceAllocations(rawAllocations));
  const allocatedCents = allocations.reduce((sum, allocation) => sum + allocation.amountCents, 0);
  if (!Number.isSafeInteger(allocatedCents)) throw new ApiError(400, 'Le total des allocations est trop élevé.', 'VALIDATION');
  if (allocatedCents > 0) {
    if (invoice.total_ttc === null) throw new ApiError(409, 'Une facture sans montant TTC ne peut pas être ventilée.', 'FACTURE_SANS_MONTANT');
    const invoiceCents = absoluteMoneyCents(invoice.total_ttc, 'montant TTC');
    if (allocatedCents > invoiceCents) {
      throw new ApiError(409, 'La somme des allocations dépasse le montant TTC de la facture.', 'ALLOCATIONS_SUPERIEURES_AU_TTC');
    }
  }
  await client.query('DELETE FROM invoice_allocations WHERE invoice_id=$1', [invoiceId]);
  for (const allocation of allocations) {
    await client.query(
      `INSERT INTO invoice_allocations (id,invoice_id,project_id,category_id,amount)
       VALUES ($1,$2,$3,$4,$5)`,
      [randomUUID(), invoiceId, allocation.projectId, allocation.categoryId, allocation.amount]
    );
  }
  return allocationRows(client, invoiceId);
}

export const documentRoutes: FastifyPluginAsync = async (app) => {
  app.get('/documents', { preHandler: app.authenticate }, async () => ({
    documents: await query(
      `SELECT d.id,d.original_name,d.mime_type,d.size_bytes,d.transaction_id,d.analysis,d.status,d.created_at,
        t.description AS transaction_description, i.id AS invoice_id
       FROM documents d LEFT JOIN transactions t ON t.id=d.transaction_id LEFT JOIN invoices i ON i.document_id=d.id
       ORDER BY d.created_at DESC`
    )
  }));

  app.get('/invoices', { preHandler: app.authenticate }, async () => ({
    invoices: await query(
      `SELECT i.*,i.invoice_number AS number,i.invoice_date AS date,i.total_ttc::float8 AS total,
        'invoice' AS type,
        CASE WHEN i.direction = 'EMIS' THEN 'income' ELSE 'expense' END AS direction,
        i.direction AS invoice_direction,
        'VALIDE' AS status,d.original_name,d.mime_type,t.description AS transaction_description,
        COALESCE(rec.reconciled_amount, 0)::float8 AS "reconciledAmount",
        CASE
          WHEN ABS(COALESCE(i.total_ttc, 0)) > 0 THEN LEAST(100.0, ROUND((COALESCE(rec.reconciled_amount, 0) / ABS(COALESCE(i.total_ttc, 0))) * 100.0, 1))::float8
          ELSE 100.0
        END AS "reconciliationPercent",
        (COALESCE(rec.reconciled_amount, 0) >= ABS(COALESCE(i.total_ttc, 0)) - 0.009 AND ABS(COALESCE(i.total_ttc, 0)) > 0) AS is_reconciled,
        (COALESCE(rec.reconciled_amount, 0) >= ABS(COALESCE(i.total_ttc, 0)) - 0.009 AND ABS(COALESCE(i.total_ttc, 0)) > 0) AS reconciled,
        (COALESCE(rec.reconciled_amount, 0) >= ABS(COALESCE(i.total_ttc, 0)) - 0.009 AND ABS(COALESCE(i.total_ttc, 0)) > 0) AS "isReconciled",
        i.transaction_id AS "transactionId",
        COALESCE(a.allocated_amount,0)::float8 AS allocated_amount,
        COALESCE(a.allocated_amount,0)::float8 AS "allocatedAmount",
        GREATEST(ABS(COALESCE(i.total_ttc,0))-COALESCE(a.allocated_amount,0),0)::float8 AS remaining_amount,
        GREATEST(ABS(COALESCE(i.total_ttc,0))-COALESCE(a.allocated_amount,0),0)::float8 AS "remainingAmount"
       FROM invoices i JOIN documents d ON d.id=i.document_id LEFT JOIN transactions t ON t.id=i.transaction_id
       LEFT JOIN LATERAL (SELECT SUM(amount) AS allocated_amount FROM invoice_allocations WHERE invoice_id=i.id) a ON true
       LEFT JOIN LATERAL (SELECT SUM(reconciled_amount) AS reconciled_amount FROM invoice_reconciliations WHERE invoice_id=i.id) rec ON true
       ORDER BY i.invoice_date DESC NULLS LAST,i.created_at DESC`
    )
  }));

  app.get<{ Params: { id: string } }>('/invoices/:id', { preHandler: app.authenticate }, async (request) => {
    const invoices = await query<Record<string, unknown>>(
      `SELECT i.*,i.invoice_number AS number,i.invoice_date AS date,i.total_ttc::float8 AS total,
        CASE WHEN i.direction = 'EMIS' THEN 'income' ELSE 'expense' END AS direction,
        i.direction AS invoice_direction,
        d.original_name,d.mime_type,d.status AS document_status,
        COALESCE(rec.reconciled_amount, 0)::float8 AS "reconciledAmount",
        CASE
          WHEN ABS(COALESCE(i.total_ttc, 0)) > 0 THEN LEAST(100.0, ROUND((COALESCE(rec.reconciled_amount, 0) / ABS(COALESCE(i.total_ttc, 0))) * 100.0, 1))::float8
          ELSE 100.0
        END AS "reconciliationPercent",
        (COALESCE(rec.reconciled_amount, 0) >= ABS(COALESCE(i.total_ttc, 0)) - 0.009 AND ABS(COALESCE(i.total_ttc, 0)) > 0) AS is_reconciled,
        (COALESCE(rec.reconciled_amount, 0) >= ABS(COALESCE(i.total_ttc, 0)) - 0.009 AND ABS(COALESCE(i.total_ttc, 0)) > 0) AS reconciled,
        (COALESCE(rec.reconciled_amount, 0) >= ABS(COALESCE(i.total_ttc, 0)) - 0.009 AND ABS(COALESCE(i.total_ttc, 0)) > 0) AS "isReconciled",
        i.transaction_id AS "transactionId",
        COALESCE(a.allocated_amount,0)::float8 AS allocated_amount,
        COALESCE(a.allocated_amount,0)::float8 AS "allocatedAmount",
        GREATEST(ABS(COALESCE(i.total_ttc,0))-COALESCE(a.allocated_amount,0),0)::float8 AS remaining_amount,
        GREATEST(ABS(COALESCE(i.total_ttc,0))-COALESCE(a.allocated_amount,0),0)::float8 AS "remainingAmount"
       FROM invoices i JOIN documents d ON d.id=i.document_id
       LEFT JOIN LATERAL (SELECT SUM(amount) AS allocated_amount FROM invoice_allocations WHERE invoice_id=i.id) a ON true
       LEFT JOIN LATERAL (SELECT SUM(reconciled_amount) AS reconciled_amount FROM invoice_reconciliations WHERE invoice_id=i.id) rec ON true
       WHERE i.id=$1`,
      [request.params.id]
    );
    if (!invoices[0]) throw new ApiError(404, 'Facture introuvable.', 'FACTURE_INTROUVABLE');
    const allocations = await query<Record<string, unknown>>(
      `SELECT a.*,a.project_id AS "projectId",a.category_id AS "categoryId",a.amount::float8 AS amount,
        p.name AS project_name,c.name AS category_name
       FROM invoice_allocations a
       LEFT JOIN projects p ON p.id=a.project_id LEFT JOIN categories c ON c.id=a.category_id
       WHERE a.invoice_id=$1 ORDER BY a.created_at,a.id`,
      [request.params.id]
    );
    return { invoice: { ...invoices[0], allocations } };
  });

  app.put<{ Params: { id: string } }>('/invoices/:id/allocations', { preHandler: app.authenticate }, async (request) => {
    const body = objectBody(request.body);
    const result = await withTransaction(async (client) => {
      const allocations = await replaceAllocations(client, request.params.id, body.allocations);
      await audit(client, request.user.sub, 'ALLOCATE', 'invoice', request.params.id, { allocations });
      const invoice = await client.query<InvoiceTotalRow>('SELECT id,total_ttc FROM invoices WHERE id=$1', [request.params.id]);
      return { invoice: invoice.rows[0], allocations };
    });
    return result;
  });

  app.post('/mobile/capture', { preHandler: app.authenticate }, async (request, reply) => {
    let transactionId: string | null = null;
    let useAi = false;
    let preferredDirection: string | null = null;
    let upload: StoredUpload | null = null;
    try {
      for await (const part of request.parts()) {
        if (part.type === 'field' && part.fieldname === 'transactionId') transactionId = String(part.value) || null;
        if (part.type === 'field' && part.fieldname === 'useAi') useAi = ['true', '1', 'oui'].includes(String(part.value).toLowerCase());
        if (part.type === 'field' && (part.fieldname === 'direction' || part.fieldname === 'financialDirection')) {
          preferredDirection = String(part.value) || null;
        }
        if (part.type === 'file') {
          if (part.fieldname !== 'file') {
            part.file.resume();
            continue;
          }
          if (upload) throw new ApiError(400, 'Un seul justificatif est accepté.', 'VALIDATION');
          upload = await storeMultipartFile(part as MultipartFile);
        }
      }
      if (!upload) throw new ApiError(400, 'Le champ multipart « file » est obligatoire.', 'VALIDATION');
      const documentId = randomUUID();
      await query(
        `INSERT INTO documents (id,original_name,stored_name,mime_type,size_bytes,uploaded_by,transaction_id,status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'ANALYSE_EN_COURS')`,
        [documentId, upload.originalName, upload.storedName, upload.mimeType, upload.sizeBytes, request.user.sub, transactionId]
      );
      try {
        const result = await analyzeDocument(upload.buffer, upload.mimeType);
        let extracted = result.analysis;
        let aiUsed = false;
        if (useAi) {
          try {
            const aiSettings = await getEnabledAiSettings();
            if (aiSettings) {
              extracted = mergeAiAnalysis(
                extracted,
                await analyzeInvoiceWithAi(result.text, aiSettings, undefined, undefined, undefined, {
                  filePath: upload.path,
                  mimeType: upload.mimeType,
                  buffer: upload.buffer
                })
              );
              aiUsed = true;
            } else {
              extracted = { ...extracted, warnings: [...extracted.warnings, "L'analyse IA est désactivée ou incomplètement configurée."] };
            }
          } catch (error) {
            request.log.warn({ err: error }, "Échec de l'analyse IA, conservation de l'analyse locale");
            extracted = { ...extracted, warnings: [...extracted.warnings, "L'analyse IA a échoué ; l'analyse locale a été conservée."] };
          }
        }
        const analysis = clientAnalysis(extracted, documentId, preferredDirection ?? undefined);
        const rows = await query<DocumentRow>(
          `UPDATE documents SET ocr_text=$2,analysis=$3::jsonb,status='A_VALIDER',updated_at=now() WHERE id=$1 RETURNING *`,
          [documentId, result.text, JSON.stringify(analysis)]
        );
        await withTransaction(async (client) => audit(client, request.user.sub, 'CAPTURE', 'document', documentId, { mimeType: upload?.mimeType }));
        return reply.code(201).send({
          document: { ...rows[0], filename: rows[0]?.original_name, previewUrl: `/api/documents/${documentId}/preview` },
          analysis,
          aiUsed
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Analyse impossible.';
        const analysis = { confidence: 0, warnings: [message] };
        const rows = await query<DocumentRow>(
          `UPDATE documents SET analysis=$2::jsonb,status='ERREUR',updated_at=now() WHERE id=$1 RETURNING *`,
          [documentId, JSON.stringify(analysis)]
        );
        return reply.code(201).send({ document: rows[0], analysis, aiUsed: false, warning: 'Le fichier est conservé mais son analyse a échoué.' });
      }
    } catch (error) {
      if (upload) await removeStoredFile(upload.path);
      throw error;
    }
  });

  app.get<{ Params: { id: string } }>('/documents/:id', { preHandler: app.authenticate }, async (request) => {
    const rows = await query<DocumentRow>(
      `SELECT d.*,i.id AS invoice_id,i.supplier AS validated_supplier,i.total_ttc AS validated_total_ttc
       FROM documents d LEFT JOIN invoices i ON i.document_id=d.id WHERE d.id=$1`,
      [request.params.id]
    );
    if (!rows[0]) throw new ApiError(404, 'Justificatif introuvable.', 'DOCUMENT_INTROUVABLE');
    return { document: rows[0] };
  });

  app.get<{ Params: { id: string } }>('/documents/:id/analysis', { preHandler: app.authenticate }, async (request) => {
    const rows = await query<Pick<DocumentRow, 'id' | 'status' | 'analysis' | 'ocr_text'>>(
      'SELECT id,status,analysis,ocr_text FROM documents WHERE id=$1', [request.params.id]
    );
    if (!rows[0]) throw new ApiError(404, 'Justificatif introuvable.', 'DOCUMENT_INTROUVABLE');
    return { documentId: rows[0].id, status: rows[0].status, analysis: rows[0].analysis, ocrText: rows[0].ocr_text };
  });

  app.get<{ Params: { id: string } }>('/documents/:id/preview', { preHandler: app.authenticate }, async (request, reply) => {
    const rows = await query<Pick<DocumentRow, 'stored_name' | 'mime_type' | 'original_name'>>(
      'SELECT stored_name,mime_type,original_name FROM documents WHERE id=$1', [request.params.id]
    );
    const document = rows[0];
    if (!document) throw new ApiError(404, 'Justificatif introuvable.', 'DOCUMENT_INTROUVABLE');
    if (document.mime_type === 'application/x-manual-entry') {
      reply.type('text/html; charset=utf-8');
      return reply.send('<div style="font-family:system-ui,-apple-system,sans-serif;padding:3rem;text-align:center;color:#475569;"><h3>Facture saisie manuellement</h3><p>Aucun fichier numérique n’a été téléversé pour cette facture.</p></div>');
    }
    reply.type(document.mime_type);
    reply.header('Content-Disposition', `inline; filename="${document.original_name.replace(/["\r\n]/g, '_')}"`);
    return reply.send(createReadStream(storedFilePath(document.stored_name)));
  });

  app.post<{ Params: { id: string } }>('/documents/:id/validate', { preHandler: app.authenticate }, async (request, reply) => {
    const body = objectBody(request.body);
    const analysis = analysisObject(body);
    const transactionId = optionalString(body.transactionId ?? analysis.transactionId);
    const projectId = optionalString(body.projectId ?? analysis.projectId);
    const categoryId = optionalString(body.categoryId ?? analysis.categoryId);
    const direction = normalizeInvoiceDirection(body.direction ?? body.invoiceDirection ?? analysis.direction ?? analysis.financialDirection);
    const supplier = optionalString(analysis.supplier ?? body.supplier);
    const recipient = optionalString(analysis.recipient ?? body.recipient);
    const invoiceDate = optionalString(analysis.invoiceDate ?? analysis.date ?? body.date);
    const totalTtc = optionalNumeric(analysis.totalTtc ?? analysis.total ?? body.total, 'montant TTC');
    const totalHt = optionalNumeric(analysis.totalHt ?? analysis.subtotal ?? body.subtotal, 'montant HT');
    const vatAmount = optionalNumeric(analysis.vatAmount ?? analysis.tax ?? body.tax, 'TVA');
    const invoiceNumber = optionalString(analysis.invoiceNumber ?? analysis.number ?? body.number);
    const siret = optionalString(analysis.siret ?? body.siret);
    const paymentMethod = optionalString(analysis.paymentMethod ?? body.paymentMethod);
    const email = optionalString(analysis.email ?? body.email);

    const invoice = await withTransaction(async (client) => {
      const documentResult = await client.query<DocumentRow>('SELECT * FROM documents WHERE id=$1 FOR UPDATE', [request.params.id]);
      const document = documentResult.rows[0];
      if (!document) throw new ApiError(404, 'Justificatif introuvable.', 'DOCUMENT_INTROUVABLE');
      const id = randomUUID();
      const result = await client.query<InvoiceTotalRow>(
        `INSERT INTO invoices (id,document_id,transaction_id,supplier,recipient,invoice_date,total_ttc,total_ht,vat_amount,invoice_number,siret,payment_method,email,direction,validated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (document_id) DO UPDATE SET transaction_id=EXCLUDED.transaction_id,supplier=EXCLUDED.supplier,
           recipient=EXCLUDED.recipient,invoice_date=EXCLUDED.invoice_date,total_ttc=EXCLUDED.total_ttc,total_ht=EXCLUDED.total_ht,
           vat_amount=EXCLUDED.vat_amount,invoice_number=EXCLUDED.invoice_number,siret=EXCLUDED.siret,
           payment_method=EXCLUDED.payment_method,email=EXCLUDED.email,direction=EXCLUDED.direction,validated_by=EXCLUDED.validated_by,
           validated_at=now(),updated_at=now()
         RETURNING *`,
        [id, request.params.id, transactionId, supplier, recipient, invoiceDate, totalTtc, totalHt, vatAmount, invoiceNumber, siret, paymentMethod, email, direction, request.user.sub]
      );
      const savedInvoice = result.rows[0];
      if (!savedInvoice) throw new ApiError(500, 'La facture n’a pas pu être enregistrée.', 'ERREUR_FACTURE');
      let allocations: Record<string, unknown>[] | undefined;
      if (Array.isArray(body.allocations)) {
        allocations = await replaceAllocations(client, savedInvoice.id, body.allocations);
      } else if (projectId || categoryId) {
        const existing = await client.query('SELECT 1 FROM invoice_allocations WHERE invoice_id=$1 LIMIT 1', [savedInvoice.id]);
        if (!existing.rowCount) {
          if (savedInvoice.total_ttc === null || absoluteMoneyCents(savedInvoice.total_ttc, 'montant TTC') === 0) {
            throw new ApiError(409, 'Un montant TTC positif est requis pour créer l’allocation par défaut.', 'FACTURE_SANS_MONTANT');
          }
          allocations = await replaceAllocations(client, savedInvoice.id, [{
            projectId,
            categoryId,
            amount: (absoluteMoneyCents(savedInvoice.total_ttc, 'montant TTC') / 100).toFixed(2)
          }]);
        }
      }
      await client.query(
        `UPDATE documents SET transaction_id=$2,analysis=$3::jsonb,status='VALIDE',updated_at=now() WHERE id=$1`,
        [request.params.id, transactionId, JSON.stringify(analysis)]
      );
      await audit(client, request.user.sub, 'VALIDATE', 'document', request.params.id, { invoiceId: savedInvoice.id, transactionId, projectId, categoryId, allocations, direction });
      return savedInvoice;
    });
    return reply.code(200).send({ invoice });
  });

  // Création directe d'une facture sans justificatif fichier
  app.post('/invoices/manual', { preHandler: app.authenticate }, async (request, reply) => {
    const body = objectBody(request.body);
    const direction = normalizeInvoiceDirection(body.direction ?? body.invoiceDirection);
    const supplier = optionalString(body.supplier);
    const recipient = optionalString(body.recipient);
    const invoiceNumber = optionalString(body.invoiceNumber ?? body.number);
    const invoiceDate = optionalString(body.invoiceDate ?? body.date);
    const totalTtc = optionalNumeric(body.totalTtc ?? body.total, 'montant TTC');
    const totalHt = optionalNumeric(body.totalHt ?? body.subtotal, 'montant HT');
    const vatAmount = optionalNumeric(body.vatAmount ?? body.tax, 'TVA');
    const paymentMethod = optionalString(body.paymentMethod);
    const email = optionalString(body.email);
    const transactionId = optionalString(body.transactionId);
    const projectId = optionalString(body.projectId);
    const categoryId = optionalString(body.categoryId);

    const invoice = await withTransaction(async (client) => {
      const documentId = randomUUID();
      const storedName = `manual/${documentId}.txt`;
      const docLabel = direction === 'EMIS'
        ? (recipient ? `Facture émise - ${recipient}` : 'Facture émise (recette)')
        : (supplier ? `Facture reçue - ${supplier}` : 'Facture reçue (dépense)');
      await client.query(
        `INSERT INTO documents (id, original_name, stored_name, mime_type, size_bytes, uploaded_by, transaction_id, status)
         VALUES ($1, $2, $3, 'application/x-manual-entry', 1, $4, $5, 'VALIDE')`,
        [documentId, docLabel, storedName, request.user.sub, transactionId]
      );

      const invoiceId = randomUUID();
      const result = await client.query<InvoiceTotalRow>(
        `INSERT INTO invoices (id, document_id, transaction_id, supplier, recipient, invoice_date, total_ttc, total_ht, vat_amount, invoice_number, payment_method, email, direction, validated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [invoiceId, documentId, transactionId, supplier, recipient, invoiceDate, totalTtc, totalHt, vatAmount, invoiceNumber, paymentMethod, email, direction, request.user.sub]
      );
      const savedInvoice = result.rows[0];
      if (!savedInvoice) throw new ApiError(500, 'La facture n’a pas pu être enregistrée.', 'ERREUR_FACTURE');

      if (Array.isArray(body.allocations)) {
        await replaceAllocations(client, savedInvoice.id, body.allocations);
      } else if (projectId || categoryId) {
        if (savedInvoice.total_ttc !== null && absoluteMoneyCents(savedInvoice.total_ttc, 'montant TTC') > 0) {
          await replaceAllocations(client, savedInvoice.id, [{
            projectId,
            categoryId,
            amount: (absoluteMoneyCents(savedInvoice.total_ttc, 'montant TTC') / 100).toFixed(2)
          }]);
        }
      }

      await audit(client, request.user.sub, 'CREATE_MANUAL', 'invoice', savedInvoice.id, { totalTtc, supplier, recipient, direction });
      return savedInvoice;
    });

    return reply.code(201).send({ invoice });
  });
};
