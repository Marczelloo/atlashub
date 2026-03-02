import { LRUCache } from 'lru-cache';
import { platformDb } from '../db/platform.js';
import { decrypt } from '../lib/crypto.js';
import { NotFoundError } from '../lib/errors.js';

// Cache configuration
const CACHE_MAX_ITEMS = 100;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL for credentials

interface CachedCredentials {
  owner: string;
  app: string;
  cachedAt: number;
}

// LRU cache for project database credentials
const credentialsCache = new LRUCache<string, CachedCredentials>({
  max: CACHE_MAX_ITEMS,
  ttl: CACHE_TTL_MS,
  updateAgeOnGet: true,
});

export const projectDbCredsService = {
  async getCredentials(projectId: string): Promise<{ owner: string; app: string }> {
    // Check cache first
    const cached = credentialsCache.get(projectId);
    if (cached) {
      return { owner: cached.owner, app: cached.app };
    }

    // Fetch from database
    const result = await platformDb.query<{
      role: 'owner' | 'app';
      encrypted_connection_string: string;
      iv: string;
      auth_tag: string;
    }>(
      `SELECT role, encrypted_connection_string, iv, auth_tag
       FROM project_db_creds
       WHERE project_id = $1`,
      [projectId]
    );

    if (result.rows.length !== 2) {
      throw new NotFoundError('Project database credentials not found');
    }

    const creds: { owner?: string; app?: string } = {};

    for (const row of result.rows) {
      const decrypted = decrypt(row.encrypted_connection_string, row.iv, row.auth_tag);
      creds[row.role] = decrypted;
    }

    if (!creds.owner || !creds.app) {
      throw new Error('Incomplete project database credentials');
    }

    // Cache the credentials
    credentialsCache.set(projectId, {
      owner: creds.owner,
      app: creds.app,
      cachedAt: Date.now(),
    });

    return { owner: creds.owner, app: creds.app };
  },

  /**
   * Invalidate cached credentials for a project.
   * Call this when credentials are rotated or updated.
   */
  invalidateCache(projectId: string): void {
    credentialsCache.delete(projectId);
  },

  /**
   * Clear all cached credentials.
   * Use for security-sensitive operations or when multiple credentials may have changed.
   */
  clearCache(): void {
    credentialsCache.clear();
  },

  /**
   * Get cache statistics for monitoring.
   */
  getCacheStats(): { size: number; maxItems: number; ttlMs: number } {
    return {
      size: credentialsCache.size,
      maxItems: CACHE_MAX_ITEMS,
      ttlMs: CACHE_TTL_MS,
    };
  },
};
