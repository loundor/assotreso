import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { pool, withTransaction } from './db.js';

const DEMO_USER_ID = '10000000-0000-4000-8000-000000000001';
const DEMO_ACCOUNT_ID = '20000000-0000-4000-8000-000000000001';
const EXPENSE_CATEGORY_ID = '30000000-0000-4000-8000-000000000001';
const INCOME_CATEGORY_ID = '30000000-0000-4000-8000-000000000002';
const PROJECT_ID = '40000000-0000-4000-8000-000000000001';

export async function migrateAndSeed(): Promise<void> {
  const sql = await readFile(config.migrationFile, 'utf8');
  await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(8262026)');
    await client.query(sql);
    const passwordHash = await bcrypt.hash('demo1234', 12);
    await client.query(
      `INSERT INTO users (id, email, password_hash, name, role, active)
       VALUES ($1, 'tresorier@demo.fr', $2, 'Trésorier démo', 'ADMIN', true)
       ON CONFLICT (email) DO UPDATE SET role='ADMIN', active=true`,
      [DEMO_USER_ID, passwordHash]
    );
    const existingAccounts = await client.query('SELECT 1 FROM accounts LIMIT 1');
    if (existingAccounts.rowCount === 0) {
      await client.query(
        `INSERT INTO accounts (id, name, type, bank, initial_balance, currency)
         VALUES ($1, 'Compte principal', 'BANQUE', 'Banque Démo', 1250.00, 'EUR')
         ON CONFLICT (id) DO NOTHING`,
        [DEMO_ACCOUNT_ID]
      );
      await client.query(
        `INSERT INTO categories (id, name, kind, color) VALUES
         ($1, 'Fonctionnement', 'DEPENSE', '#E76F51'),
         ($2, 'Cotisations', 'RECETTE', '#2A9D8F')
         ON CONFLICT (name, kind) DO NOTHING`,
        [EXPENSE_CATEGORY_ID, INCOME_CATEGORY_ID]
      );
      await client.query(
        `INSERT INTO projects (id, name, description, budget, active)
         VALUES ($1, 'Fonctionnement général', 'Activités courantes de l’association', 3000, true)
         ON CONFLICT (name) DO NOTHING`,
        [PROJECT_ID]
      );
      await client.query(
        `INSERT INTO transactions
         (id, account_id, operation_date, amount, type, bank_label, description, category_id, project_id, supplier, reconciliation_status, modified_by)
         VALUES
         ($1, $2, CURRENT_DATE - 8, 250.00, 'COTISATION', 'Cotisations adhérents', 'Cotisations du mois', $3, $5, NULL, 'RAPPROCHE', $6),
         ($4, $2, CURRENT_DATE - 3, -89.90, 'DEPENSE', 'ACHAT FOURNITURES', 'Fournitures administratives', $7, $5, 'Papeterie Démo', 'NON_RAPPROCHE', $6)
         ON CONFLICT (id) DO NOTHING`,
        [
          '50000000-0000-4000-8000-000000000001',
          DEMO_ACCOUNT_ID,
          INCOME_CATEGORY_ID,
          '50000000-0000-4000-8000-000000000002',
          PROJECT_ID,
          DEMO_USER_ID,
          EXPENSE_CATEGORY_ID
        ]
      );
    }
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
