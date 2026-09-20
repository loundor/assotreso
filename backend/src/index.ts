import { chmod, mkdir } from 'node:fs/promises';
import { buildApp } from './app.js';
import { config } from './config.js';
import { migrateAndSeed } from './migrate.js';
import { pool } from './db.js';

async function main(): Promise<void> {
  await mkdir(config.codexHome, { recursive: true, mode: 0o700 });
  await chmod(config.codexHome, 0o700);
  await migrateAndSeed();
  const app = await buildApp();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Arrêt du serveur');
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.host, port: config.port });
}

main().catch(async (error: unknown) => {
  console.error('Démarrage impossible :', error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
