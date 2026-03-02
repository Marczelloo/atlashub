/**
 * Database Connection and Query Metrics
 *
 * Tracks database-related metrics including:
 * - Active connection count (gauge)
 * - Query duration histogram
 *
 * Designed to integrate with PostgreSQL connection pools and query execution.
 */

import { getMetricsRegistry } from './metrics-registry';
import type { Labels, Histogram, Gauge, TimerResult } from '../metrics-types';
import {
  DB_CONNECTIONS_ACTIVE_CONFIG,
  DB_QUERY_DURATION_CONFIG,
} from '../metrics-types';

// ============================================================================
// Types
// ============================================================================

/**
 * Database operation types for tracking
 */
export type DbOperation =
  | 'select'
  | 'insert'
  | 'update'
  | 'delete'
  | 'query'
  | 'transaction'
  | 'migration';

/**
 * Options for database metrics tracking
 */
export interface DatabaseMetricsOptions {
  /** Pool identifier for multi-pool setups */
  poolName?: string;
  /** Custom labels to add to all metrics */
  customLabels?: Labels;
}

/**
 * Query tracking result
 */
export interface QueryTrackingResult {
  /** End tracking and record the query duration */
  end: (operation?: DbOperation, table?: string) => void;
  /** Get elapsed time without ending tracking */
  elapsed: () => number;
}

// ============================================================================
// Database Metrics Service
// ============================================================================

class DatabaseMetricsService {
  private connectionsActive: Gauge;
  private queryDuration: Histogram;
  private defaultPoolName: string;

  constructor() {
    const registry = getMetricsRegistry();

    // Register metrics
    this.connectionsActive = registry.registerGauge(DB_CONNECTIONS_ACTIVE_CONFIG);
    this.queryDuration = registry.registerHistogram(DB_QUERY_DURATION_CONFIG);

    this.defaultPoolName = 'default';
  }

  /**
   * Set the number of active connections
   */
  setActiveConnections(count: number, poolName?: string): void {
    const labels: Labels = {
      pool: poolName || this.defaultPoolName,
    };
    this.connectionsActive.set(count, labels);
  }

  /**
   * Increment active connections count
   */
  incrementConnections(poolName?: string): void {
    const labels: Labels = {
      pool: poolName || this.defaultPoolName,
    };
    this.connectionsActive.inc(1, labels);
  }

  /**
   * Decrement active connections count
   */
  decrementConnections(poolName?: string): void {
    const labels: Labels = {
      pool: poolName || this.defaultPoolName,
    };
    this.connectionsActive.dec(1, labels);
  }

  /**
   * Start tracking a database query.
   * Returns functions to record the query completion.
   */
  startQuery(
    operation: DbOperation = 'query',
    table?: string,
    options: DatabaseMetricsOptions = {}
  ): QueryTrackingResult {
    const startTime = process.hrtime.bigint();

    return {
      elapsed: () => {
        const endTime = process.hrtime.bigint();
        return Number(endTime - startTime) / 1e9;
      },
      end: (finalOperation?: DbOperation, finalTable?: string) => {
        const duration = Number(process.hrtime.bigint() - startTime) / 1e9;

        const labels: Labels = {
          operation: finalOperation || operation,
          table: finalTable || table || 'unknown',
          ...options.customLabels,
        };

        this.queryDuration.observe(duration, labels);
      },
    };
  }

  /**
   * Track a completed database query (convenience method)
   */
  trackQuery(
    operation: DbOperation,
    table: string,
    durationSeconds: number,
    options: DatabaseMetricsOptions = {}
  ): void {
    const labels: Labels = {
      operation,
      table,
      ...options.customLabels,
    };

    this.queryDuration.observe(durationSeconds, labels);
  }

  /**
   * Wrap a query function with automatic metrics tracking
   */
  wrapQuery<T>(
    operation: DbOperation,
    table: string,
    queryFn: () => T | Promise<T>,
    options: DatabaseMetricsOptions = {}
  ): Promise<T> {
    const tracking = this.startQuery(operation, table, options);

    try {
      const result = queryFn();

      // Handle both sync and async results
      if (result instanceof Promise) {
        return result
          .then((value) => {
            tracking.end();
            return value;
          })
          .catch((error) => {
            tracking.end();
            throw error;
          });
      } else {
        tracking.end();
        return Promise.resolve(result);
      }
    } catch (error) {
      tracking.end();
      return Promise.reject(error);
    }
  }

  /**
   * Get the underlying gauge metric (for testing or advanced use)
   */
  getConnectionsGauge(): Gauge {
    return this.connectionsActive;
  }

  /**
   * Get the underlying histogram metric (for testing or advanced use)
   */
  getQueryDurationHistogram(): Histogram {
    return this.queryDuration;
  }

  /**
   * Create a connection pool monitor that automatically updates metrics
   */
  createPoolMonitor(pool: {
    totalCount: number;
    idleCount: number;
    waitingCount: number;
  }, poolName?: string): () => void {
    const name = poolName || this.defaultPoolName;

    return () => {
      // Set active connections = total - idle
      const activeCount = pool.totalCount - pool.idleCount;
      this.setActiveConnections(activeCount, name);
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let databaseMetricsInstance: DatabaseMetricsService | null = null;

/**
 * Get the database metrics service instance
 */
export function getDatabaseMetrics(): DatabaseMetricsService {
  if (!databaseMetricsInstance) {
    databaseMetricsInstance = new DatabaseMetricsService();
  }
  return databaseMetricsInstance;
}

/**
 * Reset the database metrics service (primarily for testing)
 */
export function resetDatabaseMetrics(): void {
  databaseMetricsInstance = null;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Detect the operation type from a SQL query string
 */
export function detectQueryOperation(sql: string): DbOperation {
  const normalizedSql = sql.trim().toUpperCase();

  if (normalizedSql.startsWith('SELECT')) return 'select';
  if (normalizedSql.startsWith('INSERT')) return 'insert';
  if (normalizedSql.startsWith('UPDATE')) return 'update';
  if (normalizedSql.startsWith('DELETE')) return 'delete';
  if (normalizedSql.startsWith('BEGIN') || normalizedSql.startsWith('START TRANSACTION')) {
    return 'transaction';
  }

  return 'query';
}

/**
 * Extract table name from a simple SQL query (best effort)
 */
export function extractTableName(sql: string): string {
  const normalizedSql = sql.trim().toUpperCase();

  // Match common patterns
  const fromMatch = normalizedSql.match(/FROM\s+([^\s,;]+)/i);
  if (fromMatch) return fromMatch[1].toLowerCase().replace(/['"]/g, '');

  const intoMatch = normalizedSql.match(/INTO\s+([^\s,(;]+)/i);
  if (intoMatch) return intoMatch[1].toLowerCase().replace(/['"]/g, '');

  const updateMatch = normalizedSql.match(/UPDATE\s+([^\s,;]+)/i);
  if (updateMatch) return updateMatch[1].toLowerCase().replace(/['"]/g, '');

  return 'unknown';
}

/**
 * Create a timer for measuring query duration
 */
export function createQueryTimer(): TimerResult {
  const startTime = process.hrtime.bigint();

  const stop = (): number => {
    const endTime = process.hrtime.bigint();
    return Number(endTime - startTime) / 1e9;
  };

  // Calculate initial duration (for elapsed property)
  const duration = stop();

  return { duration, stop };
}

// ============================================================================
// Connection Pool Integration
// ============================================================================

/**
 * Integration helper for node-postgres (pg) pools
 */
export function instrumentPgPool(
  pool: {
    on: (event: string, callback: () => void) => void;
    totalCount: number;
    idleCount: number;
    waitingCount: number;
  },
  poolName?: string
): void {
  const metrics = getDatabaseMetrics();
  const name = poolName || 'default';

  // Track connection acquisition
  pool.on('connect', () => {
    metrics.incrementConnections(name);
  });

  // Note: pg pool doesn't have a 'remove' event, so we use periodic updates
  // or manual tracking via query wrappers

  // Set up periodic gauge update
  const updateGauge = () => {
    const activeCount = pool.totalCount - pool.idleCount;
    metrics.setActiveConnections(activeCount, name);
  };

  // Update immediately
  updateGauge();

  // Update every 5 seconds
  setInterval(updateGauge, 5000).unref();
}

// Re-export types
export type { Labels, Gauge, Histogram };
