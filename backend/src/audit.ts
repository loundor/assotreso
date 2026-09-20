import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { pool } from './db.js';

type DbExecutor = Pick<PoolClient, 'query'> | typeof pool;

export async function audit(
  db: DbExecutor,
  userId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  details: Record<string, unknown> = {}
): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [userId, action, entityType, entityId, JSON.stringify({ eventId: randomUUID(), ...details })]
  );
}
