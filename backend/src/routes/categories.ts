import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { FastifyPluginAsync } from 'fastify';
import { audit } from '../audit.js';
import { pool, query, withTransaction } from '../db.js';
import { ApiError, objectBody, optionalString, requiredString } from '../errors.js';

const kinds = new Set(['RECETTE', 'DEPENSE', 'MIXTE']);

function kind(value: unknown): string {
  const parsed = (optionalString(value) ?? 'DEPENSE').toUpperCase();
  if (!kinds.has(parsed)) throw new ApiError(400, 'Type de catégorie invalide.', 'VALIDATION');
  return parsed;
}

async function validateCategoryRelations(
  client: PoolClient,
  categoryId: string,
  parentId: string | null,
  projectId: string | null,
  categoryKind: string
): Promise<void> {
  if (projectId) {
    const project = await client.query('SELECT id FROM projects WHERE id=$1', [projectId]);
    if (!project.rowCount) throw new ApiError(404, 'Projet introuvable.', 'PROJET_INTROUVABLE');
  }
  if (parentId) {
    if (parentId === categoryId) {
      throw new ApiError(400, 'Une catégorie ne peut pas être son propre parent.', 'PARENT_CATEGORIE_INVALIDE');
    }
    const parent = await client.query<{ project_id: string | null; kind: string }>(
      'SELECT project_id,kind FROM categories WHERE id=$1', [parentId]
    );
    if (!parent.rows[0]) throw new ApiError(404, 'Catégorie parente introuvable.', 'CATEGORIE_PARENT_INTROUVABLE');
    if (parent.rows[0].project_id !== projectId || parent.rows[0].kind !== categoryKind) {
      throw new ApiError(409, 'La catégorie parente doit appartenir au même projet et avoir le même type.', 'PARENT_CATEGORIE_INCOMPATIBLE');
    }
    const cycle = await client.query(
      `WITH RECURSIVE ancestors AS (
         SELECT id,parent_id FROM categories WHERE id=$1
         UNION ALL
         SELECT c.id,c.parent_id FROM categories c JOIN ancestors a ON c.id=a.parent_id
       )
       SELECT 1 FROM ancestors WHERE id=$2 LIMIT 1`,
      [parentId, categoryId]
    );
    if (cycle.rowCount) throw new ApiError(409, 'Ce parent créerait un cycle dans la hiérarchie des catégories.', 'CYCLE_CATEGORIE');
  }
  const incompatibleChild = await client.query(
    `SELECT id FROM categories WHERE parent_id=$1
       AND (project_id IS DISTINCT FROM $2::uuid OR kind IS DISTINCT FROM $3) LIMIT 1`,
    [categoryId, projectId, categoryKind]
  );
  if (incompatibleChild.rowCount) {
    throw new ApiError(409, 'Le projet ou le type est incompatible avec une catégorie enfant.', 'ENFANT_CATEGORIE_INCOMPATIBLE');
  }
}

export const categoryRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { projectId?: string } }>('/categories', { preHandler: app.authenticate }, async (request) => {
    const projectId = optionalString(request.query.projectId);
    return {
      categories: await query(
        `SELECT c.*,c.parent_id AS "parentId",c.project_id AS "projectId",p.name AS project_name
         FROM categories c LEFT JOIN projects p ON p.id=c.project_id
         ${projectId ? 'WHERE c.project_id=$1' : ''}
         ORDER BY c.project_id NULLS FIRST,c.kind,c.name`,
        projectId ? [projectId] : []
      )
    };
  });

  app.post('/categories', { preHandler: app.authenticate }, async (request, reply) => {
    const body = objectBody(request.body);
    const id = randomUUID();
    const categoryKind = kind(body.kind);
    const parentId = optionalString(body.parentId);
    const projectId = optionalString(body.projectId);
    const category = await withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(82620262)');
      await validateCategoryRelations(client, id, parentId, projectId, categoryKind);
      const result = await client.query(
        `INSERT INTO categories (id,name,kind,parent_id,project_id,color)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *,parent_id AS "parentId",project_id AS "projectId"`,
        [id, requiredString(body.name, 'nom'), categoryKind, parentId, projectId, optionalString(body.color)]
      );
      await audit(client, request.user.sub, 'CREATE', 'category', id, { parentId, projectId });
      return result.rows[0];
    });
    return reply.code(201).send({ category });
  });

  app.put<{ Params: { id: string } }>('/categories/:id', { preHandler: app.authenticate }, async (request) => {
    const body = objectBody(request.body);
    const categoryKind = kind(body.kind);
    const parentId = optionalString(body.parentId);
    const projectId = optionalString(body.projectId);
    const category = await withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(82620262)');
      const existing = await client.query('SELECT id FROM categories WHERE id=$1 FOR UPDATE', [request.params.id]);
      if (!existing.rowCount) throw new ApiError(404, 'Catégorie introuvable.', 'CATEGORIE_INTROUVABLE');
      await validateCategoryRelations(client, request.params.id, parentId, projectId, categoryKind);
      const result = await client.query(
        `UPDATE categories SET name=$2,kind=$3,parent_id=$4,project_id=$5,color=$6,updated_at=now()
         WHERE id=$1 RETURNING *,parent_id AS "parentId",project_id AS "projectId"`,
        [request.params.id, requiredString(body.name, 'nom'), categoryKind, parentId, projectId, optionalString(body.color)]
      );
      await audit(client, request.user.sub, 'UPDATE', 'category', request.params.id, { parentId, projectId });
      return result.rows[0];
    });
    return { category };
  });

  app.delete<{ Params: { id: string } }>('/categories/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const rows = await query('DELETE FROM categories WHERE id=$1 RETURNING id', [request.params.id]);
    if (!rows[0]) throw new ApiError(404, 'Catégorie introuvable.', 'CATEGORIE_INTROUVABLE');
    await audit(pool, request.user.sub, 'DELETE', 'category', request.params.id);
    return reply.code(204).send();
  });
};
