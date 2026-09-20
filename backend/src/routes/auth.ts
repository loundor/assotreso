import bcrypt from 'bcryptjs';
import type { FastifyPluginAsync } from 'fastify';
import { query } from '../db.js';
import { ApiError, objectBody, requiredString } from '../errors.js';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: string;
}

export const authRoutes: FastifyPluginAsync = async (app) => {
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
    return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
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
