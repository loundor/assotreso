import { pool } from '../db.js';
import { config } from '../config.js';
import { migrateAndSeed } from '../migrate.js';

async function main(): Promise<void> {
  if (!config.demoMode) {
    throw new Error('Le seed de démonstration nécessite DEMO_MODE=true.');
  }
  await migrateAndSeed();
  console.log('✅ Jeu de données de démonstration initialisé.');
  await pool.end();
}

main().catch(async (error: unknown) => {
  console.error('❌ Échec de l’initialisation de la démonstration :', error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
