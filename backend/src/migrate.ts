import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { pool, withTransaction } from './db.js';

const DEMO_USER_ID = '10000000-0000-4000-8000-000000000001';

interface AppSettingsRow {
  demo_mode: boolean;
  demo_seeded_at: Date | null;
}

interface DatabaseContentRow {
  has_users: boolean;
  has_business_data: boolean;
}

export async function migrateAndSeed(): Promise<void> {
  const migrationSql = await readFile(config.migrationFile, 'utf8');
  const demoSql = config.demoMode ? await readFile(config.demoSeedFile, 'utf8') : null;

  await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(8262026)');
    await client.query(migrationSql);

    const settingsResult = await client.query<AppSettingsRow>(
      'SELECT demo_mode, demo_seeded_at FROM app_settings WHERE id = 1 FOR UPDATE'
    );
    const settings = settingsResult.rows[0];

    if (!config.demoMode || settings?.demo_mode || settings?.demo_seeded_at) return;

    const contentResult = await client.query<DatabaseContentRow>(`
      SELECT
        EXISTS (SELECT 1 FROM users) AS has_users,
        (
          EXISTS (SELECT 1 FROM accounts)
          OR EXISTS (SELECT 1 FROM transactions)
          OR EXISTS (SELECT 1 FROM invoices)
          OR EXISTS (SELECT 1 FROM documents)
          OR EXISTS (SELECT 1 FROM projects)
          OR EXISTS (SELECT 1 FROM categories)
        ) AS has_business_data
    `);
    const content = contentResult.rows[0];
    if (content?.has_users || content?.has_business_data) {
      throw new Error('DEMO_MODE=true ne peut être activé que sur une base vide. Utilisez un nouveau volume PostgreSQL pour créer une démonstration.');
    }

    const passwordHash = await bcrypt.hash('demo1234', 12);
    await client.query(
      `INSERT INTO users (id, email, password_hash, name, role, active)
       VALUES ($1, 'tresorier@demo.fr', $2, 'Trésorier démo', 'ADMIN', true)`,
      [DEMO_USER_ID, passwordHash]
    );
    await client.query(demoSql as string);
    await client.query(
      `UPDATE app_settings
       SET demo_mode = true, demo_seeded_at = now(), updated_at = now()
       WHERE id = 1`
    );
  });
}

export async function checkDatabase(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export function newId(): string {
  return randomUUID();
}
