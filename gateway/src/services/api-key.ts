import { randomUUID } from 'node:crypto';
import { LRUCache } from 'lru-cache';
import type { ApiKey, ApiKeyType, ProjectContext } from '@atlashub/shared';
import { platformDb } from '../db/platform.js';
import { generateApiKey, hashApiKey, constantTimeCompare } from '../lib/crypto.js';
import { NotFoundError } from '../lib/errors.js';
import { auditService } from './audit.js';

/**
 * How long a validated key stays in memory.
 *
 * Every public API request validates its key, which used to be one platform DB
 * round trip per request. Revoking, rotating or deleting keys through the API
 * clears the cache immediately; a key revoked with raw SQL in the dashboard
 * stops working after at most this long.
 */
export const KEY_CACHE_TTL_MS = 30_000;

const keyCache = new LRUCache<string, ProjectContext>({
  max: 1000,
  ttl: KEY_CACHE_TTL_MS,
  // Wall-clock TTL: seconds-long entries do not need a monotonic clock, and
  // tests can move Date to check expiry.
  perf: { now: () => Date.now() },
  ttlResolution: 0,
});

/**
 * Bumped on every clear. A validation that started before a revocation must
 * not put the revoked key back into the cache when it finishes afterwards.
 */
let keyGeneration = 0;

function clearKeys(): void {
  keyGeneration++;
  keyCache.clear();
}

export const apiKeyService = {
  async listProjectKeys(projectId: string): Promise<ApiKey[]> {
    const result = await platformDb.query<{
      id: string;
      project_id: string;
      key_type: ApiKeyType;
      key_prefix: string;
      created_at: Date;
      expires_at: Date | null;
      revoked_at: Date | null;
    }>(
      `SELECT id, project_id, key_type, key_prefix, created_at, expires_at, revoked_at
       FROM api_keys
       WHERE project_id = $1 AND revoked_at IS NULL
       ORDER BY created_at DESC`,
      [projectId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      keyType: row.key_type,
      keyPrefix: row.key_prefix,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
    }));
  },

  async validateKey(key: string): Promise<ProjectContext | undefined> {
    const keyHash = hashApiKey(key);

    const cached = keyCache.get(keyHash);
    if (cached) return cached;

    const generation = keyGeneration;

    // Lookup by hash uses idx_api_keys_key_hash instead of loading every active
    // key of every project on each request. The indexed value is a SHA-256 of a
    // random 256-bit key, so lookup timing reveals nothing usable about the key.
    const result = await platformDb.query<{
      id: string;
      project_id: string;
      key_type: ApiKeyType;
      key_hash: string;
      expires_at: Date | null;
    }>(
      `SELECT id, project_id, key_type, key_hash, expires_at
       FROM api_keys
       WHERE key_hash = $1
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > NOW())
       LIMIT 1`,
      [keyHash]
    );

    const row = result.rows[0];
    if (!row || !constantTimeCompare(keyHash, row.key_hash)) {
      // Unknown keys are not cached: a freshly created key must work at once.
      return undefined;
    }

    const context: ProjectContext = {
      projectId: row.project_id,
      keyType: row.key_type,
      keyId: row.id,
    };

    // An expiring key must not outlive its expiry in the cache.
    const untilExpiry = row.expires_at
      ? new Date(row.expires_at).getTime() - Date.now()
      : Number.POSITIVE_INFINITY;
    if (untilExpiry > 0 && generation === keyGeneration) {
      keyCache.set(keyHash, context, { ttl: Math.min(KEY_CACHE_TTL_MS, untilExpiry) });
    }

    return context;
  },

  /** Forget validated keys. Called whenever keys are revoked, rotated or deleted. */
  clearKeyCache(): void {
    clearKeys();
  },

  async rotateKey(
    projectId: string,
    keyType: ApiKeyType
  ): Promise<{ apiKey: ApiKey; newKey: string }> {
    const prefix = keyType === 'publishable' ? 'pk' : 'sk';
    const newKey = generateApiKey(prefix);
    const newKeyHash = hashApiKey(newKey);
    const newKeyId = randomUUID();

    await platformDb.transaction(async (client) => {
      // Revoke old key
      await client.query(
        `UPDATE api_keys SET revoked_at = NOW()
         WHERE project_id = $1 AND key_type = $2 AND revoked_at IS NULL`,
        [projectId, keyType]
      );

      // Create new key
      await client.query(
        `INSERT INTO api_keys (id, project_id, key_type, key_hash, key_prefix)
         VALUES ($1, $2, $3, $4, $5)`,
        [newKeyId, projectId, keyType, newKeyHash, newKey.slice(0, 8)]
      );
    });
    clearKeys();

    const result = await platformDb.query<{
      id: string;
      project_id: string;
      key_type: ApiKeyType;
      key_prefix: string;
      created_at: Date;
      expires_at: Date | null;
      revoked_at: Date | null;
    }>('SELECT * FROM api_keys WHERE id = $1', [newKeyId]);

    if (result.rows.length === 0) {
      throw new Error('Failed to create new API key');
    }

    const row = result.rows[0];
    const apiKey = {
      id: row.id,
      projectId: row.project_id,
      keyType: row.key_type,
      keyPrefix: row.key_prefix,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
    };

    // Log key rotation
    await auditService.log({
      action: auditService.actions.KEY_ROTATED,
      projectId,
      details: { keyType, keyId: newKeyId },
    });

    return { apiKey, newKey };
  },

  async revokeKey(keyId: string): Promise<void> {
    const result = await platformDb.query(
      `UPDATE api_keys SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL`,
      [keyId]
    );
    clearKeys();

    if (result.rowCount === 0) {
      throw new NotFoundError('API key not found or already revoked');
    }

    // Log key revocation
    await auditService.log({
      action: auditService.actions.KEY_REVOKED,
      details: { keyId },
    });
  },
};
