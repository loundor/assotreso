import { resolve } from 'node:path';

function integerEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) throw new Error(`La variable ${name} doit être un entier.`);
  return parsed;
}

function booleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new Error(`La variable ${name} doit valoir true ou false.`);
}

export const config = {
  host: process.env.HOST ?? '0.0.0.0',
  port: integerEnv('PORT', 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/tresorerie',
  jwtSecret: process.env.JWT_SECRET ?? 'changez-ce-secret-en-production',
  storageDir: resolve(process.env.STORAGE_DIR ?? 'storage'),
  codexHome: resolve(process.env.CODEX_HOME ?? 'codex-data'),
  migrationFile: resolve(process.env.MIGRATION_FILE ?? 'sql/001_init.sql'),
  demoSeedFile: resolve(process.env.DEMO_SEED_FILE ?? 'sql/002_demo_seed.sql'),
  demoMode: booleanEnv('DEMO_MODE', false),
  agyExecutable: process.env.AGY_EXECUTABLE ?? 'agy',
  promptsDir: resolve(process.env.PROMPTS_DIR ?? 'prompts'),
  maxUploadBytes: 10 * 1024 * 1024,
  isProduction: process.env.NODE_ENV === 'production'
} as const;
