import '@fastify/jwt';
import 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string; role: string; name: string };
    user: { sub: string; email: string; role: string; name: string };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>;
    requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  }
}
