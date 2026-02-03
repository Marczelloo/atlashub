import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { adminAuthMiddleware } from '../../middleware/admin-auth.js';
import { projectRoutes } from './projects.js';
import { sqlRoutes } from './sql.js';
import { adminStorageRoutes } from './storage.js';
import { inviteRoutes } from './invites.js';
import { usersRoutes } from './users.js';
import { statsRoutes } from './stats.js';
import { settingsRoutes } from './settings.js';
import { cronRoutes } from './cron.js';
import { backupRoutes } from './backups.js';

export const adminRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // Apply admin authentication to all routes
  fastify.addHook('onRequest', adminAuthMiddleware);

  // Register sub-routes
  await fastify.register(projectRoutes, { prefix: '/projects' });
  await fastify.register(sqlRoutes);
  await fastify.register(adminStorageRoutes);
  await fastify.register(inviteRoutes, { prefix: '/invites' });
  await fastify.register(usersRoutes, { prefix: '/users' });
  await fastify.register(statsRoutes);
  await fastify.register(settingsRoutes);
  await fastify.register(cronRoutes, { prefix: '/cron' });
  await fastify.register(backupRoutes, { prefix: '/backups' });
  // Note: Data Tools (import/export) are now per-project under /admin/projects/:id/data-tools/*
};
