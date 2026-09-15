import type { FastifyRequest } from 'fastify';
import { ForbiddenError } from '../lib/errors.js';

/**
 * Routes a publishable key may call. Publishable keys are meant to be shipped
 * to browsers, so they only read: everything else - inserting, updating and
 * deleting rows, uploading and deleting files, schema changes - needs the
 * secret key.
 *
 * An allowlist rather than a list of write routes: a route added later is
 * secret-only until someone decides otherwise.
 */
const PUBLISHABLE_ROUTES = new Set([
  'GET /v1/db/tables',
  'GET /v1/db/:table',
  'POST /v1/db/read-batch',
  'GET /v1/storage/signed-download',
]);

export function isAllowedForPublishableKey(method: string, routeUrl: string | undefined): boolean {
  if (!routeUrl) return false;
  const normalizedMethod = method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase();
  return PUBLISHABLE_ROUTES.has(`${normalizedMethod} ${routeUrl}`);
}

/** Must run after publicAuthMiddleware has set projectContext. */
export async function keyPermissionsMiddleware(request: FastifyRequest) {
  if (request.projectContext.keyType === 'secret') return;

  if (!isAllowedForPublishableKey(request.method, request.routeOptions.url)) {
    throw new ForbiddenError('This operation requires a secret API key');
  }
}
