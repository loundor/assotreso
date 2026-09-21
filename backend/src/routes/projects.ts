import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { FastifyPluginAsync } from 'fastify';
import { audit } from '../audit.js';
import { pool, query, withTransaction } from '../db.js';
import { ApiError, booleanValue, objectBody, optionalNumeric, optionalString, requiredString } from '../errors.js';

async function validateParent(client: PoolClient, projectId: string, parentId: string | null): Promise<void> {
  if (!parentId) return;
  if (parentId === projectId) {
    throw new ApiError(400, 'Un projet ne peut pas être son propre parent.', 'PARENT_PROJET_INVALIDE');
  }
  const parent = await client.query('SELECT id FROM projects WHERE id=$1', [parentId]);
  if (!parent.rowCount) throw new ApiError(404, 'Projet parent introuvable.', 'PROJET_PARENT_INTROUVABLE');
  const cycle = await client.query(
    `WITH RECURSIVE ancestors AS (
       SELECT id,parent_id FROM projects WHERE id=$1
       UNION ALL
       SELECT p.id,p.parent_id FROM projects p JOIN ancestors a ON p.id=a.parent_id
     )
     SELECT 1 FROM ancestors WHERE id=$2 LIMIT 1`,
    [parentId, projectId]
  );
  if (cycle.rowCount) {
    throw new ApiError(409, 'Ce parent créerait un cycle dans la hiérarchie des projets.', 'CYCLE_PROJET');
  }
}

const PROJECT_STATUSES = new Set(['IDEE', 'MONTAGE', 'EN_COURS', 'TERMINE', 'AVORTE']);

function parseStatus(value: unknown): string {
  const parsed = (optionalString(value) ?? 'EN_COURS').toUpperCase();
  if (!PROJECT_STATUSES.has(parsed)) throw new ApiError(400, 'Statut de projet invalide (IDEE, MONTAGE, EN_COURS, TERMINE, AVORTE).', 'VALIDATION');
  return parsed;
}

export const projectRoutes: FastifyPluginAsync = async (app) => {
  app.get('/projects', { preHandler: app.authenticate }, async () => ({
    projects: await query(`SELECT p.*,p.parent_id AS "parentId",
      COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0),0)::float8 AS income,
      ABS(COALESCE(SUM(t.amount) FILTER (WHERE t.amount < 0),0))::float8 AS expense
      FROM projects p LEFT JOIN transactions t ON t.project_id=p.id GROUP BY p.id ORDER BY p.name`)
  }));

  app.post('/projects', { preHandler: app.authenticate }, async (request, reply) => {
    const body = objectBody(request.body);
    const id = randomUUID();
    const parentId = optionalString(body.parentId);
    const status = parseStatus(body.status);
    const statusReason = optionalString(body.statusReason ?? body.status_reason);
    const project = await withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(82620261)');
      await validateParent(client, id, parentId);
      const result = await client.query(
        `INSERT INTO projects (id,name,description,budget,starts_on,ends_on,active,parent_id,status,status_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *,parent_id AS "parentId"`,
        [id, requiredString(body.name, 'nom'), optionalString(body.description), optionalNumeric(body.budget, 'budget'), optionalString(body.startsOn), optionalString(body.endsOn), booleanValue(body.active, true), parentId, status, statusReason]
      );
      await audit(client, request.user.sub, 'CREATE', 'project', id, { parentId, status });
      return result.rows[0];
    });
    return reply.code(201).send({ project });
  });

  app.put<{ Params: { id: string } }>('/projects/:id', { preHandler: app.authenticate }, async (request) => {
    const body = objectBody(request.body);
    const parentId = optionalString(body.parentId);
    const status = parseStatus(body.status);
    const statusReason = optionalString(body.statusReason ?? body.status_reason);
    const project = await withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(82620261)');
      const existing = await client.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [request.params.id]);
      if (!existing.rowCount) throw new ApiError(404, 'Projet introuvable.', 'PROJET_INTROUVABLE');
      await validateParent(client, request.params.id, parentId);
      const result = await client.query(
        `UPDATE projects SET name=$2,description=$3,budget=$4,starts_on=$5,ends_on=$6,active=$7,parent_id=$8,status=$9,status_reason=$10,updated_at=now()
         WHERE id=$1 RETURNING *,parent_id AS "parentId"`,
        [request.params.id, requiredString(body.name, 'nom'), optionalString(body.description), optionalNumeric(body.budget, 'budget'), optionalString(body.startsOn), optionalString(body.endsOn), booleanValue(body.active, true), parentId, status, statusReason]
      );
      await audit(client, request.user.sub, 'UPDATE', 'project', request.params.id, { parentId, status });
      return result.rows[0];
    });
    return { project };
  });

  app.delete<{ Params: { id: string } }>('/projects/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const children = await query<{ id: string }>('SELECT id FROM projects WHERE parent_id=$1 LIMIT 1', [request.params.id]);
    if (children[0]) {
      throw new ApiError(409, 'Ce projet possède des sous-projets et ne peut pas être supprimé.', 'PROJET_PARENT_UTILISE');
    }
    const rows = await query('DELETE FROM projects WHERE id=$1 RETURNING id', [request.params.id]);
    if (!rows[0]) throw new ApiError(404, 'Projet introuvable.', 'PROJET_INTROUVABLE');
    await audit(pool, request.user.sub, 'DELETE', 'project', request.params.id);
    return reply.code(204).send();
  });
};
