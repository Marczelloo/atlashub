import { Pool, type PoolClient } from 'pg';
import { LRUCache } from 'lru-cache';
import { projectDbCredsService } from '../services/project-db-creds.js';
import { config } from '../config/env.js';
import { runtimeSettings } from '../services/runtime-settings.js';

interface ProjectPools {
  owner: Pool;
  app: Pool;
  lastAccessed: number;
  inUse: number; // Reference count to prevent eviction while in use
}

// Maximum number of projects to keep connection pools for
const MAX_PROJECT_POOLS = 100;

// Track pools that are being closed to prevent double-close
const closingPools = new Set<string>();

// Pool creations in progress, so parallel first requests create pools once
const pendingPools = new Map<string, Promise<ProjectPools>>();

// Cache of project connection pools with LRU eviction
const projectPools = new LRUCache<string, ProjectPools>({
  max: MAX_PROJECT_POOLS,
  // Dispose function is called when an item is evicted
  dispose: (pools, projectId) => {
    // Don't close if already being closed elsewhere
    if (closingPools.has(projectId)) {
      return;
    }
    // Don't close if pool is still in use
    if (pools.inUse > 0) {
      // Put it back in the cache - this is a safety measure
      // In practice, fetchMethod or noDelete should prevent this
      console.warn(`Attempted to evict pool for project ${projectId} while in use (${pools.inUse} active queries)`);
      return;
    }
    closingPools.add(projectId);
    // Gracefully close pools when evicted from cache
    Promise.all([pools.owner.end(), pools.app.end()])
      .then(() => {
        console.log(`Closed connection pools for project ${projectId}`);
      })
      .catch((err) => {
        console.error(`Error closing pools for project ${projectId}:`, err);
      })
      .finally(() => {
        closingPools.delete(projectId);
      });
  },
  // Don't call dispose when overwriting a key with set()
  noDisposeOnSet: true,
  // Update age on get to track access patterns
  updateAgeOnGet: true,
  // Set TTL to 10 minutes (longer than typical idle timeout)
  ttl: 10 * 60 * 1000,
  // Don't delete items that are stale if they're being fetched
  allowStale: false,
});

async function getProjectPools(projectId: string): Promise<ProjectPools> {
  const cached = projectPools.get(projectId);
  if (cached) {
    cached.lastAccessed = Date.now();
    return cached;
  }

  // Check if pools are being closed for this project
  if (closingPools.has(projectId)) {
    // Wait a bit and retry
    await new Promise((resolve) => setTimeout(resolve, 100));
    return getProjectPools(projectId);
  }

  // Parallel first requests for a project share one pool creation. Without this
  // each of them built its own pair of pools and all but one were dropped
  // without being closed.
  const pending = pendingPools.get(projectId);
  if (pending) return pending;

  const creation = createProjectPools(projectId).finally(() => {
    pendingPools.delete(projectId);
  });
  pendingPools.set(projectId, creation);
  return creation;
}

async function createProjectPools(projectId: string): Promise<ProjectPools> {
  const creds = await projectDbCredsService.getCredentials(projectId);

  const ownerPool = new Pool({
    connectionString: creds.owner,
    max: config.postgres.projectOwnerPoolSize, // Small pool per project
    idleTimeoutMillis: config.postgres.idleTimeoutMs,
    connectionTimeoutMillis: config.postgres.connectionTimeoutMs,
  });

  const appPool = new Pool({
    connectionString: creds.app,
    max: config.postgres.projectAppPoolSize,
    // Public API queries must not run unbounded: one slow filter on a large
    // table would otherwise hold a connection and load the shared Postgres.
    // The owner pool (DDL, imports, backups) has no such limit.
    statement_timeout: runtimeSettings.getSqlStatementTimeoutMs(),
    idleTimeoutMillis: config.postgres.idleTimeoutMs,
    connectionTimeoutMillis: config.postgres.connectionTimeoutMs,
  });

  // Handle pool errors
  ownerPool.on('error', (err) => {
    console.error(`Unexpected error on owner pool for project ${projectId}:`, err);
  });

  appPool.on('error', (err) => {
    console.error(`Unexpected error on app pool for project ${projectId}:`, err);
  });

  const pools: ProjectPools = {
    owner: ownerPool,
    app: appPool,
    lastAccessed: Date.now(),
    inUse: 0,
  };

  projectPools.set(projectId, pools);

  return pools;
}

async function runInTransaction<T>(
  projectId: string,
  role: 'app' | 'owner',
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const pools = await getProjectPools(projectId);
  pools.inUse++;
  try {
    const client = await pools[role].connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } finally {
    pools.inUse--;
  }
}

export const projectDb = {
  async queryAsOwner<T extends Record<string, unknown> = Record<string, unknown>>(
    projectId: string,
    text: string,
    params?: unknown[]
  ) {
    const pools = await getProjectPools(projectId);
    pools.inUse++;
    try {
      return await pools.owner.query<T>(text, params);
    } finally {
      pools.inUse--;
    }
  },

  async queryAsApp<T extends Record<string, unknown> = Record<string, unknown>>(
    projectId: string,
    text: string,
    params?: unknown[]
  ) {
    const pools = await getProjectPools(projectId);
    pools.inUse++;
    try {
      return await pools.app.query<T>(text, params);
    } finally {
      pools.inUse--;
    }
  },

  /** Run several statements as the app role in one transaction. */
  async transactionAsApp<T>(projectId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    return runInTransaction(projectId, 'app', fn);
  },

  /**
   * Run statements as the owner role on one dedicated connection, without a
   * transaction (so VACUUM or CREATE INDEX CONCURRENTLY still work).
   */
  async withOwnerClient<T>(projectId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const pools = await getProjectPools(projectId);
    pools.inUse++;
    try {
      const client = await pools.owner.connect();
      try {
        return await fn(client);
      } finally {
        client.release();
      }
    } finally {
      pools.inUse--;
    }
  },

  async closeProjectPools(projectId: string): Promise<void> {
    // Check if already being closed
    if (closingPools.has(projectId)) {
      return;
    }

    const pools = projectPools.get(projectId);
    if (pools) {
      closingPools.add(projectId);
      // Remove from cache first to prevent new queries
      projectPools.delete(projectId);
      try {
        // Then close the pools
        await Promise.all([pools.owner.end(), pools.app.end()]);
      } finally {
        closingPools.delete(projectId);
      }
    }
  },

  async closeAllPools(): Promise<void> {
    const projectIds = [...projectPools.keys()];
    const closePromises = projectIds.map(async (projectId) => {
      await this.closeProjectPools(projectId);
    });
    await Promise.all(closePromises);
  },

  /**
   * Get current pool statistics for monitoring
   */
  getPoolStats(): { totalPools: number; projectIds: string[] } {
    return {
      totalPools: projectPools.size,
      projectIds: [...projectPools.keys()],
    };
  },
};

// Register cleanup handlers for graceful shutdown
function setupCleanupHandlers(): void {
  const cleanup = async (signal: string) => {
    console.log(`Received ${signal}, closing all project database pools...`);
    try {
      await projectDb.closeAllPools();
      console.log('All project database pools closed successfully');
    } catch (err) {
      console.error('Error closing project database pools:', err);
    }
  };

  // Handle termination signals
  process.on('SIGTERM', () => cleanup('SIGTERM'));
  process.on('SIGINT', () => cleanup('SIGINT'));

  // Handle beforeExit for graceful shutdown (not for explicit termination)
  process.on('beforeExit', () => {
    console.log('Process exiting, closing all project database pools...');
    projectDb.closeAllPools().catch((err) => {
      console.error('Error closing project database pools on exit:', err);
    });
  });
}

// Initialize cleanup handlers
setupCleanupHandlers();
