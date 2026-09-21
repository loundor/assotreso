import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import { config } from './config.js';
import { ApiError } from './errors.js';
import { query } from './db.js';
import { accountRoutes } from './routes/accounts.js';
import { authRoutes } from './routes/auth.js';
import { categoryRoutes } from './routes/categories.js';
import { configurationRoutes } from './routes/configuration.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { documentRoutes } from './routes/documents.js';
import { projectRoutes } from './routes/projects.js';
import { transactionRoutes } from './routes/transactions.js';
import { reconciliationRoutes } from './routes/reconciliation.js';
import { reportsRoutes } from './routes/reports.js';
import { checkDatabase } from './migrate.js';

interface PgError extends Error {
  code?: string;
  constraint?: string;
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: ['req.headers.authorization', 'body.password', 'body.motDePasse', 'body.secret', 'body.apiKey', 'body.token', 'body.databaseUrl', 'body.url']
    },
    bodyLimit: config.maxUploadBytes
  });

  await app.register(jwt, { secret: config.jwtSecret });
  await app.register(multipart, {
    limits: { fileSize: config.maxUploadBytes, files: 1, fields: 10, parts: 11 }
  });

  app.decorate('authenticate', async function authenticate(request, reply): Promise<void> {
    try {
      const queryToken = typeof (request.query as Record<string, unknown> | undefined)?.token === 'string'
        ? (request.query as Record<string, string>).token
        : undefined;
      if (!request.headers.authorization && queryToken) {
        request.user = app.jwt.verify(queryToken);
      } else {
        await request.jwtVerify();
      }
    } catch {
      await reply.code(401).send({ error: 'AUTHENTIFICATION_REQUISE', message: 'Authentification requise ou jeton expiré.' });
    }
  });


  app.decorate('requireAdmin', async function requireAdmin(request, reply): Promise<void> {
    const users = await query<{ role: string; active: boolean }>('SELECT role,active FROM users WHERE id=$1', [request.user.sub]);
    if (!users[0]?.active || users[0].role !== 'ADMIN') {
      await reply.code(403).send({ error: 'ACCES_INTERDIT', message: 'Accès réservé aux administrateurs.' });
    }
  });

  app.setErrorHandler((error: FastifyError | ApiError | PgError, request, reply) => {
    request.log.error(error);
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }
    if (error.code === '23505') {
      return reply.code(409).send({ error: 'DOUBLON', message: 'Une donnée identique existe déjà.' });
    }
    if (error.code === '23503') {
      return reply.code(409).send({ error: 'DONNEE_UTILISEE', message: 'Cette donnée est liée à un autre élément et ne peut pas être supprimée ou modifiée ainsi.' });
    }
    if (error.code === '22P02' || error.code === '23514' || error.code === '22007') {
      return reply.code(400).send({ error: 'VALIDATION', message: 'Une valeur fournie est invalide.' });
    }
    if (error.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({ error: 'FICHIER_TROP_VOLUMINEUX', message: 'Le fichier dépasse la taille maximale de 10 Mo.' });
    }
    const statusCode = 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode < 500 ? error.statusCode : 500;
    return reply.code(statusCode).send({
      error: statusCode === 500 ? 'ERREUR_INTERNE' : 'REQUETE_INVALIDE',
      message: statusCode === 500 ? 'Une erreur interne est survenue.' : error.message
    });
  });

  app.get('/api/health', async (_request, reply) => {
    const database = await checkDatabase();
    return reply.code(database ? 200 : 503).send({ status: database ? 'ok' : 'degraded', database });
  });

  await app.register(async (api) => {
    await api.register(authRoutes);
    await api.register(dashboardRoutes);
    await api.register(accountRoutes);
    await api.register(categoryRoutes);
    await api.register(projectRoutes);
    await api.register(transactionRoutes);
    await api.register(reconciliationRoutes);
    await api.register(reportsRoutes);
    await api.register(documentRoutes);
    await api.register(configurationRoutes, { prefix: '/config' });
  }, { prefix: '/api' });

  return app;
}
