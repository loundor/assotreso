import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool, withTransaction } from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main(): Promise<void> {
  const seedPath = join(__dirname, '../../sql/002_demo_seed.sql');
  console.log('Chargement du jeu de données démo depuis :', seedPath);
  const sql = await readFile(seedPath, 'utf8');

  await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(8262026)');
    await client.query(sql);
  });

  console.log('✅ Base de données réinitialisée et jeu de données démo (4 ans) injecté avec succès !');
  await pool.end();
}

main().catch(async (err: unknown) => {
  console.error('❌ Échec de l’injection du jeu de données démo :', err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
