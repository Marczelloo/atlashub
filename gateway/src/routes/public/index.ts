import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { publicAuthMiddleware } from '../../middleware/public-auth.js';
import { keyPermissionsMiddleware } from '../../middleware/key-permissions.js';
import { dbRoutes } from './db.js';
import { storageRoutes } from './storage.js';

export const publicRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // Apply public authentication (API key) to all routes
  fastify.addHook('onRequest', publicAuthMiddleware);
  // Publishable keys are read-only; runs after authentication has set the key type
  fastify.addHook('onRequest', keyPermissionsMiddleware);

  // Register sub-routes
  await fastify.register(dbRoutes, { prefix: '/db' });
  await fastify.register(storageRoutes, { prefix: '/storage' });
};
