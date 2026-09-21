import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { FastifyPluginAsync } from 'fastify';
import { query, withTransaction } from '../db.js';
import { ApiError, objectBody, requiredString } from '../errors.js';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: string;
}

interface AuthStatusRow {
  setup_required: boolean;
  demo_mode: boolean;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(user: UserRow) {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.get('/auth/status', async (_request, reply) => {
    const rows = await query<AuthStatusRow>(`
      SELECT
        NOT EXISTS (SELECT 1 FROM users) AS setup_required,
        COALESCE((SELECT demo_mode FROM app_settings WHERE id = 1), false) AS demo_mode
    `);
    reply.header('Cache-Control', 'no-store');
    return {
      setupRequired: rows[0]?.setup_required ?? true,
      demoMode: rows[0]?.demo_mode ?? false
    };
  });

  app.post('/auth/setup', async (request, reply) => {
    const body = objectBody(request.body);
    const name = requiredString(body.name, 'nom');
    const email = requiredString(body.email, 'email').toLowerCase();
    const password = requiredString(body.password, 'mot de passe');
    const passwordConfirmation = requiredString(body.passwordConfirmation, 'confirmation du mot de passe');

    if (name.length < 2 || name.length > 120) {
      throw new ApiError(400, 'Le nom doit contenir entre 2 et 120 caractères.', 'VALIDATION');
    }
    if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
      throw new ApiError(400, 'L’adresse e-mail est invalide.', 'VALIDATION');
    }
    if (password.length < 8) {
      throw new ApiError(400, 'Le mot de passe doit contenir au moins 8 caractères.', 'VALIDATION');
    }
    if (Buffer.byteLength(password, 'utf8') > 72) {
      throw new ApiError(400, 'Le mot de passe ne doit pas dépasser 72 octets.', 'VALIDATION');
    }
    if (password !== passwordConfirmation) {
      throw new ApiError(400, 'Les deux mots de passe ne correspondent pas.', 'VALIDATION');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await withTransaction(async (client): Promise<UserRow> => {
      await client.query('SELECT pg_advisory_xact_lock(8262027)');
      const existing = await client.query('SELECT 1 FROM users LIMIT 1');
      if ((existing.rowCount ?? 0) > 0) {
        throw new ApiError(409, 'La configuration initiale a déjà été effectuée.', 'INSTALLATION_DEJA_EFFECTUEE');
      }

      const result = await client.query<UserRow>(
        `INSERT INTO users (id, email, password_hash, name, role, active)
         VALUES ($1, $2, $3, $4, 'ADMIN', true)
         RETURNING id, email, password_hash, name, role`,
        [randomUUID(), email, passwordHash, name]
      );
      const createdUser = result.rows[0];
      if (!createdUser) throw new Error('Le compte administrateur n’a pas pu être créé.');
      return createdUser;
    });

    const token = app.jwt.sign({ sub: user.id, email: user.email, role: user.role, name: user.name }, { expiresIn: '12h' });
    return reply.code(201).send({ token, user: publicUser(user) });
  });

  app.post('/auth/login', async (request) => {
    const body = objectBody(request.body);
    const email = requiredString(body.email, 'email').toLowerCase();
    const password = requiredString(body.password, 'mot de passe');
    const users = await query<UserRow>(
      'SELECT id, email, password_hash, name, role FROM users WHERE email = $1 AND active = true',
      [email]
    );
    const user = users[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw new ApiError(401, 'Adresse e-mail ou mot de passe incorrect.', 'IDENTIFIANTS_INVALIDES');
    }
    const token = app.jwt.sign({ sub: user.id, email: user.email, role: user.role, name: user.name }, { expiresIn: '12h' });
    return { token, user: publicUser(user) };
  });

  app.get('/auth/me', { preHandler: app.authenticate }, async (request) => {
    const users = await query<Omit<UserRow, 'password_hash'>>(
      'SELECT id, email, name, role FROM users WHERE id = $1 AND active = true',
      [request.user.sub]
    );
    const user = users[0];
    if (!user) throw new ApiError(404, 'Utilisateur introuvable.', 'UTILISATEUR_INTROUVABLE');
    return user;
  });
};
