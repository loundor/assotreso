import { createHash, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { FastifyPluginAsync } from 'fastify';
import pg from 'pg';
import { config } from '../config.js';
import { pool, query } from '../db.js';
import { ApiError, booleanValue, objectBody, optionalString, requiredString } from '../errors.js';
import { analyzeInvoiceWithAi, type AiAuthMode, type AiConnectionSettings, type AiProvider } from '../services/ai.js';
import { codexDeviceLoginStatus, codexIsAuthenticated, startCodexDeviceLogin } from '../services/codex.js';
import { agyIsAuthenticated, agyIsAvailable, testAgyConnection } from '../services/agy.js';
import { startAgyTerminalSession, getTerminalSession } from '../services/terminal.js';
import { decryptSecret, encryptSecret } from '../services/secrets.js';

const { Pool } = pg;
const ROLES = ['ADMIN', 'TRESORIER', 'PRESIDENT', 'BUREAU', 'BENEVOLE'] as const;
type Role = typeof ROLES[number];

const AI_PROVIDERS: Record<AiProvider, { baseUrl: string; authModes: AiAuthMode[] }> = {
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', authModes: ['api_key', 'oauth'] },
  openai: { baseUrl: 'https://api.openai.com/v1', authModes: ['api_key', 'oauth'] },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', authModes: ['api_key'] },
  mistral: { baseUrl: 'https://api.mistral.ai/v1', authModes: ['api_key'] },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', authModes: ['cli', 'api_key'] }
};

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

function oauthResultPage(success: boolean, message: string): string {
  const payload = JSON.stringify({ type: 'treso:ai-oauth', success, message }).replace(/</g, '\\u003c');
  const title = success ? 'Connexion réussie' : 'Connexion impossible';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{font-family:system-ui,sans-serif;background:#f7f3e8;color:#173f34;display:grid;place-items:center;min-height:100vh;margin:0}.card{background:white;border:1px solid #dce5df;border-radius:16px;padding:2rem;max-width:480px;text-align:center;box-shadow:0 12px 40px #173f3420}p{color:#5d6d67;line-height:1.5}</style></head><body><main class="card"><h1>${title}</h1><p>${message}</p><p>Vous pouvez fermer cette fenêtre.</p></main><script>if(window.opener){window.opener.postMessage(${payload},window.location.origin);setTimeout(()=>window.close(),800)}</script></body></html>`;
}

async function exchangeOpenRouterCode(state: string, code: string): Promise<void> {
  const flows = await query<{ code_verifier: string }>(
    `DELETE FROM ai_oauth_flows WHERE state=$1 AND provider='openrouter' AND expires_at>now() RETURNING code_verifier`,
    [state]
  );
  const flow = flows[0];
  if (!flow) throw new ApiError(400, 'La demande OAuth est inconnue ou expirée. Recommencez la connexion.', 'OAUTH_EXPIRE');
  const response = await fetch('https://openrouter.ai/api/v1/auth/keys', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: flow.code_verifier, code_challenge_method: 'S256' }),
    signal: AbortSignal.timeout(15_000)
  });
  const payload = await response.json().catch(() => ({})) as { key?: unknown; error?: unknown };
  if (!response.ok || typeof payload.key !== 'string' || !payload.key) {
    throw new ApiError(400, 'OpenRouter a refusé ou n’a pas pu finaliser la connexion.', 'OAUTH_ECHANGE');
  }
  await query(
    `UPDATE ai_settings SET provider='openrouter',auth_mode='oauth',base_url='https://openrouter.ai/api/v1',
     encrypted_secret=$1,oauth_status='configure',updated_at=now() WHERE id=1`,
    [encryptSecret(payload.key, config.jwtSecret)]
  );
}

interface AssociationRow {
  name: string;
  acronym: string | null;
  legal_form: string | null;
  legal_name: string | null;
  website: string | null;
  address: string | null;
  address_line2: string | null;
  postal_code: string | null;
  city: string | null;
  country: string;
  email: string | null;
  phone: string | null;
  siret: string | null;
  rna: string | null;
  fiscal_start_day: number;
  fiscal_start_month: number;
}

interface MemberRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  function: string | null;
  joined_on: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

interface AiRow {
  enabled: boolean;
  provider: string;
  auth_mode: 'api_key' | 'oauth' | 'cli';
  base_url: string | null;
  model: string | null;
  encrypted_secret: string | null;
  oauth_status: string;
  updated_at: string;
}

function associationJson(row: AssociationRow) {
  return {
    name: row.name,
    acronym: row.acronym,
    legalForm: row.legal_form,
    legalName: row.legal_name,
    website: row.website,
    address: row.address,
    addressLine2: row.address_line2,
    postalCode: row.postal_code,
    city: row.city,
    country: row.country,
    email: row.email,
    phone: row.phone,
    siret: row.siret,
    rna: row.rna,
    fiscalStartDay: row.fiscal_start_day,
    fiscalStartMonth: row.fiscal_start_month,
    fiscalYearStartDay: row.fiscal_start_day,
    fiscalYearStartMonth: row.fiscal_start_month
  };
}

function memberJson(row: MemberRow) {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    postalCode: row.postal_code,
    city: row.city,
    function: row.function,
    role: row.function,
    joinedOn: row.joined_on,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function aiJson(row: AiRow) {
  return {
    enabled: row.enabled,
    provider: row.provider,
    authMode: row.auth_mode,
    baseUrl: row.base_url,
    model: row.model,
    secret: row.encrypted_secret ? '********' : null,
    secretConfigured: Boolean(row.encrypted_secret),
    oauthStatus: row.oauth_status,
    updatedAt: row.updated_at
  };
}

function integerInRange(value: unknown, label: string, minimum: number, maximum: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ApiError(400, `Le champ « ${label} » doit être un entier entre ${minimum} et ${maximum}.`, 'VALIDATION');
  }
  return parsed;
}

function validEmail(value: unknown, required = false): string | null {
  const email = required ? requiredString(value, 'email') : optionalString(value);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(400, "L'adresse e-mail est invalide.", 'VALIDATION');
  }
  return email?.toLowerCase() ?? null;
}

function validRole(value: unknown): Role {
  const role = requiredString(value, 'rôle').toUpperCase();
  if (!ROLES.includes(role as Role)) {
    throw new ApiError(400, `Le rôle doit être l'un des suivants : ${ROLES.join(', ')}.`, 'VALIDATION');
  }
  return role as Role;
}

function validHttpUrl(value: unknown, label: string): string {
  const text = requiredString(value, label).replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new ApiError(400, `Le champ « ${label} » doit être une URL valide.`, 'VALIDATION');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ApiError(400, `Le champ « ${label} » doit utiliser HTTP ou HTTPS.`, 'VALIDATION');
  }
  return text;
}

function databaseJson(databaseUrl: string, connected: boolean) {
  try {
    const parsed = new URL(databaseUrl);
    return {
      connected,
      type: 'PostgreSQL',
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 5432,
      database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
      user: decodeURIComponent(parsed.username),
      dialect: 'PostgreSQL'
    };
  } catch {
    return { connected, type: 'PostgreSQL', dialect: 'PostgreSQL', host: null, port: null, database: null, user: null };
  }
}

async function association(): Promise<AssociationRow> {
  const rows = await query<AssociationRow>('SELECT * FROM association_settings WHERE id=1');
  const row = rows[0];
  if (!row) throw new Error("La configuration de l'association est absente.");
  return row;
}

async function membersState() {
  const members = await query<MemberRow>('SELECT * FROM association_members ORDER BY active DESC,last_name,first_name');
  const activeCount = members.filter((member) => member.active).length;
  return {
    members: members.map(memberJson),
    activeCount,
    warning: activeCount < 7 ? `L'association compte seulement ${activeCount} membre${activeCount > 1 ? 's' : ''} actif${activeCount > 1 ? 's' : ''} ; le minimum recommandé est de 7.` : null,
    memberCompliance: { activeCount, minimum: 7, compliant: activeCount >= 7 }
  };
}

async function aiSettings(): Promise<AiRow> {
  const rows = await query<AiRow>('SELECT * FROM ai_settings WHERE id=1');
  const row = rows[0];
  if (!row) throw new Error('La configuration IA est absente.');
  return row;
}

export async function getEnabledAiSettings(): Promise<AiConnectionSettings | null> {
  const settings = await aiSettings();
  if (!settings.enabled || !settings.model) return null;
  const provider = settings.provider in AI_PROVIDERS ? settings.provider as AiProvider : 'gemini';
  if (settings.auth_mode === 'cli') {
    if (!(await agyIsAvailable())) return null;
  } else {
    if (!settings.base_url) return null;
    const codexOauth = provider === 'openai' && settings.auth_mode === 'oauth';
    if (codexOauth) {
      if (settings.oauth_status !== 'configure' || !(await codexIsAuthenticated())) return null;
    } else if (!settings.encrypted_secret) return null;
  }
  return {
    provider,
    authMode: settings.auth_mode,
    baseUrl: settings.base_url || '',
    model: settings.model,
    secret: settings.encrypted_secret ? decryptSecret(settings.encrypted_secret, config.jwtSecret) : undefined
  };
}

export const configurationRoutes: FastifyPluginAsync = async (app) => {
  const adminOnly = { preHandler: [app.authenticate, app.requireAdmin] };

  app.get('/', adminOnly, async () => {
    const [associationRow, memberData, users, ai, databaseConnected] = await Promise.all([
      association(),
      membersState(),
      query('SELECT id,email,name,role,active,created_at FROM users ORDER BY name,email'),
      aiSettings(),
      pool.query('SELECT 1').then(() => true, () => false)
    ]);
    return {
      association: associationJson(associationRow),
      ...memberData,
      users,
      ai: aiJson(ai),
      database: databaseJson(config.databaseUrl, databaseConnected)
    };
  });

  app.put('/association', adminOnly, async (request) => {
    const body = objectBody(request.body);
    const rows = await query<AssociationRow>(
      `UPDATE association_settings SET name=$1,acronym=$2,legal_form=$3,legal_name=$4,website=$5,address=$6,
       address_line2=$7,postal_code=$8,city=$9,country=$10,email=$11,phone=$12,siret=$13,rna=$14,
       fiscal_start_day=$15,fiscal_start_month=$16,updated_at=now() WHERE id=1 RETURNING *`,
      [
        requiredString(body.name ?? body.nom, 'nom'), optionalString(body.acronym ?? body.sigle),
        optionalString(body.legalForm ?? body.formeJuridique), optionalString(body.legalName), optionalString(body.website),
        optionalString(body.address ?? body.adresse), optionalString(body.addressLine2), optionalString(body.postalCode ?? body.cp),
        optionalString(body.city ?? body.ville), optionalString(body.country) ?? 'France', validEmail(body.email),
        optionalString(body.phone ?? body.telephone), optionalString(body.siret), optionalString(body.rna),
        integerInRange(body.fiscalStartDay ?? body.fiscalYearStartDay ?? body.fiscal_start_day, 'jour de début d’exercice', 1, 31),
        integerInRange(body.fiscalStartMonth ?? body.fiscalYearStartMonth ?? body.fiscal_start_month, 'mois de début d’exercice', 1, 12)
      ]
    );
    return { association: associationJson(rows[0]!) };
  });

  app.get('/members', adminOnly, membersState);

  app.post('/members', adminOnly, async (request, reply) => {
    const body = objectBody(request.body);
    const rows = await query<MemberRow>(
      `INSERT INTO association_members (id,first_name,last_name,email,phone,address,postal_code,city,function,joined_on,active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [randomUUID(), requiredString(body.firstName ?? body.prenom, 'prénom'), requiredString(body.lastName ?? body.nom, 'nom'),
        validEmail(body.email), optionalString(body.phone), optionalString(body.address), optionalString(body.postalCode),
        optionalString(body.city), optionalString(body.function ?? body.fonction ?? body.role), optionalString(body.joinedOn ?? body.dateEntree),
        booleanValue(body.active ?? body.actif, true)]
    );
    return reply.code(201).send({ member: memberJson(rows[0]!), ...(await membersState()) });
  });

  app.put<{ Params: { id: string } }>('/members/:id', adminOnly, async (request) => {
    const body = objectBody(request.body);
    const rows = await query<MemberRow>(
      `UPDATE association_members SET first_name=$2,last_name=$3,email=$4,phone=$5,address=$6,postal_code=$7,city=$8,
       function=$9,joined_on=$10,active=$11,updated_at=now() WHERE id=$1 RETURNING *`,
      [request.params.id, requiredString(body.firstName ?? body.prenom, 'prénom'), requiredString(body.lastName ?? body.nom, 'nom'),
        validEmail(body.email), optionalString(body.phone), optionalString(body.address), optionalString(body.postalCode),
        optionalString(body.city), optionalString(body.function ?? body.fonction ?? body.role), optionalString(body.joinedOn ?? body.dateEntree),
        booleanValue(body.active ?? body.actif, true)]
    );
    if (!rows[0]) throw new ApiError(404, 'Membre introuvable.', 'MEMBRE_INTROUVABLE');
    return { member: memberJson(rows[0]), ...(await membersState()) };
  });

  app.delete<{ Params: { id: string } }>('/members/:id', adminOnly, async (request, reply) => {
    const rows = await query('DELETE FROM association_members WHERE id=$1 RETURNING id', [request.params.id]);
    if (!rows[0]) throw new ApiError(404, 'Membre introuvable.', 'MEMBRE_INTROUVABLE');
    return reply.code(204).send();
  });

  app.get('/users', adminOnly, async () => ({
    users: await query('SELECT id,email,name,role,active,created_at FROM users ORDER BY name,email')
  }));

  app.post('/users', adminOnly, async (request, reply) => {
    const body = objectBody(request.body);
    const password = requiredString(body.password ?? body.motDePasse, 'mot de passe');
    if (password.length < 8) throw new ApiError(400, 'Le mot de passe doit contenir au moins 8 caractères.', 'VALIDATION');
    const rows = await query(
      `INSERT INTO users (id,email,password_hash,name,role,active) VALUES ($1,$2,$3,$4,$5,true)
       RETURNING id,email,name,role,active,created_at`,
      [randomUUID(), validEmail(body.email, true), await bcrypt.hash(password, 12), requiredString(body.name ?? body.nom, 'nom'), validRole(body.role)]
    );
    return reply.code(201).send({ user: rows[0] });
  });

  app.delete<{ Params: { id: string } }>('/users/:id', adminOnly, async (request, reply) => {
    if (request.params.id === request.user.sub) {
      throw new ApiError(409, 'Vous ne pouvez pas supprimer votre propre compte.', 'AUTO_SUPPRESSION_INTERDITE');
    }
    const currentRows = await query<{ role: string; active: boolean }>('SELECT role,active FROM users WHERE id=$1', [request.params.id]);
    const current = currentRows[0];
    if (!current) throw new ApiError(404, 'Utilisateur introuvable.', 'UTILISATEUR_INTROUVABLE');
    if (current.role === 'ADMIN' && current.active) {
      const counts = await query<{ count: number }>("SELECT COUNT(*)::int AS count FROM users WHERE role='ADMIN' AND active=true");
      if ((counts[0]?.count ?? 0) <= 1) {
        throw new ApiError(409, 'Le dernier administrateur actif ne peut pas être supprimé.', 'DERNIER_ADMIN');
      }
    }
    const rows = await query('DELETE FROM users WHERE id=$1 RETURNING id', [request.params.id]);
    if (!rows[0]) throw new ApiError(404, 'Utilisateur introuvable.', 'UTILISATEUR_INTROUVABLE');
    return reply.code(204).send();
  });

  app.put<{ Params: { id: string } }>('/users/:id', adminOnly, async (request) => {
    const body = objectBody(request.body);
    const currentRows = await query<{ role: string; active: boolean }>('SELECT role,active FROM users WHERE id=$1', [request.params.id]);
    const current = currentRows[0];
    if (!current) throw new ApiError(404, 'Utilisateur introuvable.', 'UTILISATEUR_INTROUVABLE');
    const nextRole = body.role === undefined ? current.role : validRole(body.role);
    const nextActive = body.active === undefined ? current.active : booleanValue(body.active, false);
    if (current.role === 'ADMIN' && current.active && (nextRole !== 'ADMIN' || !nextActive)) {
      const counts = await query<{ count: number }>("SELECT COUNT(*)::int AS count FROM users WHERE role='ADMIN' AND active=true");
      if ((counts[0]?.count ?? 0) <= 1) throw new ApiError(409, 'Le dernier administrateur actif ne peut pas être désactivé ou rétrogradé.', 'DERNIER_ADMIN');
    }
    const rows = await query(
      `UPDATE users SET role=$2,active=$3 WHERE id=$1
       RETURNING id,email,name,role,active,created_at`,
      [request.params.id, nextRole, nextActive]
    );
    if (!rows[0]) throw new ApiError(404, 'Utilisateur introuvable.', 'UTILISATEUR_INTROUVABLE');
    return { user: rows[0] };
  });

  app.get('/database', adminOnly, async () => {
    const connected = await pool.query('SELECT 1').then(() => true, () => false);
    return { database: databaseJson(config.databaseUrl, connected) };
  });

  app.post('/database/test', adminOnly, async (request) => {
    const body = request.body === undefined ? {} : objectBody(request.body);
    const candidate = optionalString(body.databaseUrl ?? body.url) ?? config.databaseUrl;
    const testPool = new Pool({ connectionString: candidate, max: 1, connectionTimeoutMillis: 5_000 });
    try {
      await testPool.query('SELECT 1');
      return { connected: true, type: 'PostgreSQL' };
    } catch {
      return { connected: false, type: 'PostgreSQL', message: 'Connexion à PostgreSQL impossible.' };
    } finally {
      await testPool.end().catch(() => undefined);
    }
  });

  app.get('/ai/status', { preHandler: app.authenticate }, async () => {
    const settings = await aiSettings();
    const cliConfigured = settings.auth_mode === 'cli'
      ? (await agyIsAvailable()) && (await agyIsAuthenticated())
      : false;
    const configured = settings.auth_mode === 'cli'
      ? cliConfigured
      : settings.provider === 'openai' && settings.auth_mode === 'oauth'
        ? settings.oauth_status === 'configure' && await codexIsAuthenticated()
        : Boolean(settings.encrypted_secret);
    const isConfigured = Boolean((settings.auth_mode === 'cli' || settings.base_url) && settings.model && configured);
    return {
      enabled: Boolean(settings.enabled && isConfigured),
      configured: isConfigured
    };
  });

  app.get('/ai', adminOnly, async () => ({ ai: aiJson(await aiSettings()) }));

  app.put('/ai', adminOnly, async (request) => {
    const body = objectBody(request.body);
    const providerValue = (optionalString(body.provider) ?? 'openai').toLowerCase();
    if (!(providerValue in AI_PROVIDERS)) {
      throw new ApiError(400, `Fournisseur IA inconnu. Valeurs acceptées : ${Object.keys(AI_PROVIDERS).join(', ')}.`, 'VALIDATION');
    }
    const provider = providerValue as AiProvider;
    const requestedAuthMode = requiredString(body.authMode ?? body.auth_mode, 'mode d’authentification').toLowerCase();
    const authMode = (requestedAuthMode === 'api' ? 'api_key' : requestedAuthMode) as AiAuthMode;
    if (!AI_PROVIDERS[provider].authModes.includes(authMode)) {
      throw new ApiError(400, `Le mode d’authentification « ${authMode} » n’est pas disponible pour ce fournisseur.`, 'VALIDATION');
    }
    const previous = await aiSettings();
    const rawSecret = body.secret ?? body.apiKey ?? body.oauthToken ?? body.token;
    let encryptedSecret = previous.auth_mode === authMode && previous.provider === provider ? previous.encrypted_secret : null;
    if (rawSecret !== undefined && rawSecret !== '********') {
      const secret = optionalString(rawSecret);
      encryptedSecret = secret ? encryptSecret(secret, config.jwtSecret) : null;
    }
    if ((provider === 'openai' && authMode === 'oauth') || authMode === 'cli') {
      encryptedSecret = null;
    }
    const oauthStatus = authMode === 'oauth' && previous.provider === provider && previous.auth_mode === authMode
      ? previous.oauth_status
      : 'non_configure';
    const baseUrlValue = authMode === 'cli'
      ? (optionalString(body.baseUrl ?? body.base_url) || AI_PROVIDERS[provider].baseUrl)
      : validHttpUrl(optionalString(body.baseUrl ?? body.base_url) ?? AI_PROVIDERS[provider].baseUrl, 'URL de base');
    const rows = await query<AiRow>(
      `UPDATE ai_settings SET enabled=$1,provider=$2,auth_mode=$3,base_url=$4,model=$5,encrypted_secret=$6,
       oauth_status=$7,updated_at=now() WHERE id=1 RETURNING *`,
      [booleanValue(body.enabled, false), provider, authMode,
        baseUrlValue,
        optionalString(body.model), encryptedSecret,
        authMode === 'oauth' ? (provider === 'openrouter' && encryptedSecret ? 'configure' : oauthStatus) : 'non_configure']
    );
    return { ai: aiJson(rows[0]!) };
  });

  app.post('/ai/oauth/start', adminOnly, async (request) => {
    const body = request.body === undefined ? {} : objectBody(request.body);
    const settings = await aiSettings();
    if (!['openrouter', 'openai'].includes(settings.provider) || settings.auth_mode !== 'oauth') {
      throw new ApiError(400, 'La connexion OAuth est disponible pour OpenRouter et OpenAI.', 'OAUTH_INDISPONIBLE');
    }
    const state = base64Url(randomBytes(32));
    await query('DELETE FROM ai_oauth_flows WHERE expires_at<=now()');

    if (settings.provider === 'openai') {
      await query(
        `INSERT INTO ai_oauth_flows (state,provider,code_verifier,created_by,expires_at)
         VALUES ($1,'openai','device-code',$2,now()+interval '16 minutes')`,
        [state, request.user.sub]
      );
      try {
        const device = await startCodexDeviceLogin(
          state,
          async () => {
            await query("UPDATE ai_settings SET oauth_status='configure',updated_at=now() WHERE id=1 AND provider='openai' AND auth_mode='oauth'");
            await query('DELETE FROM ai_oauth_flows WHERE state=$1', [state]);
          },
          async () => {
            await query("UPDATE ai_settings SET oauth_status='erreur',updated_at=now() WHERE id=1 AND provider='openai' AND auth_mode='oauth'");
          }
        );
        return { ...device, state, provider: 'openai', flow: 'device_code' };
      } catch (error) {
        await query('DELETE FROM ai_oauth_flows WHERE state=$1', [state]);
        throw new ApiError(503, error instanceof Error ? error.message : 'Connexion OpenAI indisponible.', 'OAUTH_OPENAI');
      }
    }

    const manual = booleanValue(body.manual, false);
    const verifier = base64Url(randomBytes(64));
    const challenge = base64Url(createHash('sha256').update(verifier).digest());
    await query(
      `INSERT INTO ai_oauth_flows (state,provider,code_verifier,created_by,expires_at)
       VALUES ($1,'openrouter',$2,$3,now()+interval '10 minutes')`,
      [state, verifier, request.user.sub]
    );
    const authorizationUrl = new URL('https://openrouter.ai/auth');
    authorizationUrl.searchParams.set('code_challenge', challenge);
    authorizationUrl.searchParams.set('code_challenge_method', 'S256');
    authorizationUrl.searchParams.set('key_label', 'Trésorerie Association');
    if (!manual) {
      const callbackUrl = validHttpUrl(body.callbackUrl, 'adresse de callback');
      const parsedCallback = new URL(callbackUrl);
      const localDevelopment = parsedCallback.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsedCallback.hostname);
      if (parsedCallback.protocol !== 'https:' && !localDevelopment) {
        throw new ApiError(400, 'Le callback doit utiliser HTTPS, sauf sur localhost en mode développement.', 'OAUTH_CALLBACK');
      }
      parsedCallback.searchParams.set('state', state);
      authorizationUrl.searchParams.set('callback_url', parsedCallback.toString());
    }
    return { authorizationUrl: authorizationUrl.toString(), state, expiresIn: 600, manual, provider: 'openrouter', flow: 'pkce' };
  });

  app.get<{ Params: { state: string } }>('/ai/oauth/status/:state', adminOnly, async (request) => {
    const rows = await query<{ provider: string }>(
      'SELECT provider FROM ai_oauth_flows WHERE state=$1 AND created_by=$2 AND expires_at>now()',
      [request.params.state, request.user.sub]
    );
    if (rows[0]?.provider !== 'openai') {
      const settings = await aiSettings();
      if (settings.provider === 'openai' && settings.auth_mode === 'oauth' && settings.oauth_status === 'configure' && await codexIsAuthenticated()) {
        return { status: 'connected', ai: aiJson(settings) };
      }
      throw new ApiError(404, 'La demande de connexion OpenAI est inconnue ou expirée.', 'OAUTH_EXPIRE');
    }
    const status = codexDeviceLoginStatus(request.params.state);
    if (!status) return { status: 'pending' };
    if (status.status === 'connected') return { ...status, ai: aiJson(await aiSettings()) };
    return status;
  });

  app.get<{ Querystring: { state?: string; code?: string; error?: string } }>('/ai/oauth/callback', { logLevel: 'silent' }, async (request, reply) => {
    try {
      if (request.query.error) throw new ApiError(400, 'La connexion a été refusée sur OpenRouter.', 'OAUTH_REFUSE');
      const state = requiredString(request.query.state, 'état OAuth');
      const code = requiredString(request.query.code, 'code OAuth');
      await exchangeOpenRouterCode(state, code);
      return reply.type('text/html; charset=utf-8').send(oauthResultPage(true, 'OpenRouter est maintenant connecté à la trésorerie.'));
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'La connexion OAuth n’a pas pu être finalisée.';
      return reply.code(400).type('text/html; charset=utf-8').send(oauthResultPage(false, message));
    }
  });

  app.post('/ai/oauth/complete', adminOnly, async (request) => {
    const body = objectBody(request.body);
    await exchangeOpenRouterCode(requiredString(body.state, 'état OAuth'), requiredString(body.code, 'code OAuth'));
    return { connected: true, ai: aiJson(await aiSettings()) };
  });

  app.post('/ai/test', adminOnly, async (request) => {
    try {
      const body = request.body === undefined ? {} : objectBody(request.body);
      const dbSettings = await aiSettings();

      const candidateProvider = (optionalString(body.provider) ?? dbSettings.provider).toLowerCase();
      const provider = candidateProvider in AI_PROVIDERS ? candidateProvider as AiProvider : 'gemini';
      const candidateAuthMode = (optionalString(body.authMode ?? body.auth_mode) ?? dbSettings.auth_mode).toLowerCase();
      const authMode = (candidateAuthMode === 'api' ? 'api_key' : candidateAuthMode) as AiAuthMode;
      const model = optionalString(body.model) ?? dbSettings.model;
      const baseUrl = optionalString(body.baseUrl ?? body.base_url) ?? dbSettings.base_url ?? AI_PROVIDERS[provider].baseUrl;
      const rawSecret = body.secret ?? body.apiKey;
      const candidateSecret = rawSecret && rawSecret !== '********'
        ? optionalString(rawSecret)
        : null;
      const secret = (candidateSecret ?? (dbSettings.encrypted_secret ? decryptSecret(dbSettings.encrypted_secret, config.jwtSecret) : undefined)) ?? undefined;

      if (!model) {
        return { connected: false, message: "Le modèle d'IA doit être renseigné pour tester la connexion." };
      }

      if (authMode === 'cli') {
        const available = await agyIsAvailable();
        if (!available) {
          return {
            connected: false,
            message: "Le binaire agy n'est pas accessible sur le serveur. Ouvrez le terminal interactif pour le configurer."
          };
        }
        const agyTest = await testAgyConnection(model);
        if (!agyTest.success) {
          return {
            connected: false,
            message: agyTest.message
          };
        }
        return { connected: true, message: agyTest.message };
      }

      const connectionSettings: AiConnectionSettings = {
        provider,
        authMode,
        baseUrl,
        model,
        secret
      };

      if (authMode === 'api_key' && !secret) {
        return { connected: false, message: "La clé API doit être saisie ou déjà enregistrée pour tester." };
      }

      await analyzeInvoiceWithAi('Facture de test sans donnée réelle.', connectionSettings);
      return { connected: true, message: 'Connexion au service IA réussie.' };
    } catch (error) {
      return { connected: false, message: error instanceof Error ? error.message : 'Connexion au service IA impossible.' };
    }
  });

  app.post('/ai/terminal/start', adminOnly, async (request) => {
    const body = objectBody(request.body);
    const cols = typeof body.cols === 'number' ? body.cols : undefined;
    const rows = typeof body.rows === 'number' ? body.rows : undefined;
    const session = await startAgyTerminalSession({ cols, rows });
    return { sessionId: session.id };
  });

  app.get<{ Params: { sessionId: string } }>('/ai/terminal/:sessionId/stream', adminOnly, async (request, reply) => {
    const session = getTerminalSession(request.params.sessionId);
    if (!session) {
      throw new ApiError(404, 'Session de terminal introuvable ou expirée.', 'SESSION_INTROUVABLE');
    }

    reply.hijack();
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');
    reply.raw.flushHeaders();

    if (session.history) {
      reply.raw.write(`data: ${JSON.stringify({ type: 'output', data: session.history })}\n\n`);
    }
    if (session.closed) {
      reply.raw.write(`data: ${JSON.stringify({ type: 'exit', code: session.exitCode })}\n\n`);
      reply.raw.end();
      return;
    }

    const onChunk = (data: string) => {
      try {
        reply.raw.write(`data: ${JSON.stringify({ type: 'output', data })}\n\n`);
      } catch {
        // Ignorer si la connexion est fermée
      }
    };

    const onClose = (code: number | null) => {
      try {
        reply.raw.write(`data: ${JSON.stringify({ type: 'exit', code })}\n\n`);
        reply.raw.end();
      } catch {
        // Ignorer
      }
    };

    session.listeners.add(onChunk);
    session.closeListeners.add(onClose);

    request.raw.on('close', () => {
      session.listeners.delete(onChunk);
      session.closeListeners.delete(onClose);
    });
  });

  app.post<{ Params: { sessionId: string } }>('/ai/terminal/:sessionId/input', adminOnly, async (request) => {
    const session = getTerminalSession(request.params.sessionId);
    if (!session) {
      throw new ApiError(404, 'Session de terminal introuvable.', 'SESSION_INTROUVABLE');
    }
    const body = objectBody(request.body);
    const data = typeof body.data === 'string' ? body.data : '';
    if (data) {
      session.write(data);
    }
    return { ok: true };
  });

  app.post<{ Params: { sessionId: string } }>('/ai/terminal/:sessionId/resize', adminOnly, async (request) => {
    const session = getTerminalSession(request.params.sessionId);
    if (!session) {
      throw new ApiError(404, 'Session de terminal introuvable.', 'SESSION_INTROUVABLE');
    }
    const body = objectBody(request.body);
    const cols = typeof body.cols === 'number' ? body.cols : 100;
    const rows = typeof body.rows === 'number' ? body.rows : 30;
    session.resize(cols, rows);
    return { ok: true };
  });

  app.post<{ Params: { sessionId: string } }>('/ai/terminal/:sessionId/stop', adminOnly, async (request) => {
    const session = getTerminalSession(request.params.sessionId);
    if (session) {
      session.kill();
    }
    return { ok: true };
  });
};
