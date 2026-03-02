/**
 * Storage Operation Metrics (S3/MinIO)
 *
 * Tracks storage-related metrics including:
 * - Operation count (upload, download, delete, list)
 * - Operation duration histogram
 *
 * Designed to work with S3-compatible storage services like MinIO.
 */

import { getMetricsRegistry } from './metrics-registry';
import type { Labels, Histogram, Counter, TimerResult } from '../metrics-types';
import {
  STORAGE_OPERATIONS_TOTAL_CONFIG,
  STORAGE_OPERATION_DURATION_CONFIG,
} from '../metrics-types';

// ============================================================================
// Types
// ============================================================================

/**
 * Storage operation types
 */
export type StorageOperation =
  | 'upload'
  | 'download'
  | 'delete'
  | 'list'
  | 'copy'
  | 'head'
  | 'presign_upload'
  | 'presign_download'
  | 'bucket_create'
  | 'bucket_delete'
  | 'bucket_list';

/**
 * Storage operation status
 */
export type StorageStatus = 'success' | 'error' | 'not_found' | 'forbidden' | 'timeout';

/**
 * Options for storage metrics tracking
 */
export interface StorageMetricsOptions {
  /** Bucket name */
  bucket?: string;
  /** Custom labels to add to all metrics */
  customLabels?: Labels;
}

/**
 * Storage operation tracking result
 */
export interface StorageTrackingResult {
  /** End tracking and record the operation result */
  end: (status?: StorageStatus) => void;
  /** Get elapsed time without ending tracking */
  elapsed: () => number;
}

/**
 * Result of a storage operation for metrics purposes
 */
export interface StorageOperationResult {
  /** Operation type */
  operation: StorageOperation;
  /** Bucket name */
  bucket: string;
  /** Operation status */
  status: StorageStatus;
  /** Duration in seconds */
  durationSeconds: number;
  /** Size in bytes (for upload/download) */
  bytes?: number;
}

// ============================================================================
// Storage Metrics Service
// ============================================================================

class StorageMetricsService {
  private operationsTotal: Counter;
  private operationDuration: Histogram;

  constructor() {
    const registry = getMetricsRegistry();

    // Register metrics
    this.operationsTotal = registry.registerCounter(STORAGE_OPERATIONS_TOTAL_CONFIG);
    this.operationDuration = registry.registerHistogram(STORAGE_OPERATION_DURATION_CONFIG);
  }

  /**
   * Start tracking a storage operation.
   * Returns functions to record the operation completion.
   */
  startOperation(
    operation: StorageOperation,
    bucket: string,
    options: StorageMetricsOptions = {}
  ): StorageTrackingResult {
    const startTime = process.hrtime.bigint();

    return {
      elapsed: () => {
        const endTime = process.hrtime.bigint();
        return Number(endTime - startTime) / 1e9;
      },
      end: (status: StorageStatus = 'success') => {
        const duration = Number(process.hrtime.bigint() - startTime) / 1e9;

        // Track operation count
        const countLabels: Labels = {
          operation,
          bucket,
          status,
          ...options.customLabels,
        };
        this.operationsTotal.inc(1, countLabels);

        // Track duration (without status to reduce cardinality)
        const durationLabels: Labels = {
          operation,
          bucket,
          ...options.customLabels,
        };
        this.operationDuration.observe(duration, durationLabels);
      },
    };
  }

  /**
   * Track a completed storage operation (convenience method)
   */
  trackOperation(
    operation: StorageOperation,
    bucket: string,
    status: StorageStatus,
    durationSeconds: number,
    options: StorageMetricsOptions = {}
  ): void {
    // Track operation count
    const countLabels: Labels = {
      operation,
      bucket,
      status,
      ...options.customLabels,
    };
    this.operationsTotal.inc(1, countLabels);

    // Track duration
    const durationLabels: Labels = {
      operation,
      bucket,
      ...options.customLabels,
    };
    this.operationDuration.observe(durationSeconds, durationLabels);
  }

  /**
   * Track a complete operation result
   */
  trackResult(result: StorageOperationResult, options: StorageMetricsOptions = {}): void {
    this.trackOperation(
      result.operation,
      result.bucket,
      result.status,
      result.durationSeconds,
      options
    );
  }

  /**
   * Wrap a storage operation function with automatic metrics tracking
   */
  wrapOperation<T>(
    operation: StorageOperation,
    bucket: string,
    operationFn: () => T | Promise<T>,
    options: StorageMetricsOptions = {}
  ): Promise<T> {
    const tracking = this.startOperation(operation, bucket, options);

    try {
      const result = operationFn();

      // Handle both sync and async results
      if (result instanceof Promise) {
        return result
          .then((value) => {
            tracking.end('success');
            return value;
          })
          .catch((error: Error & { code?: string }) => {
            // Determine status from error
            const status = this.errorToStatus(error);
            tracking.end(status);
            throw error;
          });
      } else {
        tracking.end('success');
        return Promise.resolve(result);
      }
    } catch (error: unknown) {
      const err = error as Error & { code?: string };
      const status = this.errorToStatus(err);
      tracking.end(status);
      return Promise.reject(error);
    }
  }

  /**
   * Get the underlying counter metric (for testing or advanced use)
   */
  getOperationsCounter(): Counter {
    return this.operationsTotal;
  }

  /**
   * Get the underlying histogram metric (for testing or advanced use)
   */
  getOperationDurationHistogram(): Histogram {
    return this.operationDuration;
  }

  /**
   * Convert an error to a storage status
   */
  private errorToStatus(error: Error & { code?: string; statusCode?: number }): StorageStatus {
    const code = error.code || error.statusCode;

    if (code === 'NotFound' || code === 404 || code === 'NoSuchKey') {
      return 'not_found';
    }
    if (code === 'AccessDenied' || code === 403 || code === 'Forbidden') {
      return 'forbidden';
    }
    if (code === 'Timeout' || code === 'ETIMEDOUT' || code === 408) {
      return 'timeout';
    }

    return 'error';
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let storageMetricsInstance: StorageMetricsService | null = null;

/**
 * Get the storage metrics service instance
 */
export function getStorageMetrics(): StorageMetricsService {
  if (!storageMetricsInstance) {
    storageMetricsInstance = new StorageMetricsService();
  }
  return storageMetricsInstance;
}

/**
 * Reset the storage metrics service (primarily for testing)
 */
export function resetStorageMetrics(): void {
  storageMetricsInstance = null;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a timer for measuring operation duration
 */
export function createStorageTimer(): TimerResult {
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
// S3/MinIO Client Integration
// ============================================================================

/**
 * Instrument an S3 client with automatic metrics tracking.
 * This wraps common S3 client methods to track operations.
 */
export function instrumentS3Client<T extends Record<string, unknown>>(
  client: T,
  defaultBucket: string
): T {
  const metrics = getStorageMetrics();
  const operationsToWrap: Record<string, StorageOperation> = {
    putObject: 'upload',
    getObject: 'download',
    deleteObject: 'delete',
    deleteObjects: 'delete',
    listObjects: 'list',
    listObjectsV2: 'list',
    copyObject: 'copy',
    headObject: 'head',
    headBucket: 'head',
    createBucket: 'bucket_create',
    deleteBucket: 'bucket_delete',
    listBuckets: 'bucket_list',
    getSignedUrl: 'presign_upload',
    getSignedUrlPromise: 'presign_download',
  };

  const wrappedClient = { ...client };

  for (const [methodName, operation] of Object.entries(operationsToWrap)) {
    const originalMethod = client[methodName];
    if (typeof originalMethod === 'function') {
      (wrappedClient as Record<string, unknown>)[methodName] = function wrappedMethod(
        ...args: unknown[]
      ) {
        // Extract bucket from arguments if available
        const bucket = (args[0] as { Bucket?: string })?.Bucket || defaultBucket;
        return metrics.wrapOperation(operation, bucket, () =>
          (originalMethod as (...args: unknown[]) => unknown).apply(client, args)
        );
      };
    }
  }

  return wrappedClient;
}

/**
 * Track bytes transferred (for upload/download operations)
 * This can be used alongside the main metrics to track data volume.
 */
export function trackBytesTransferred(
  operation: 'upload' | 'download',
  bucket: string,
  bytes: number
): void {
  const metrics = getStorageMetrics();

  // Record the byte count as the metric value to track total data transferred
  // The counter value represents cumulative bytes, allowing Prometheus to track totals
  metrics.getOperationsCounter().inc(bytes, {
    operation: `${operation}_bytes`,
    bucket,
    status: 'success',
  });
}

// ============================================================================
// Pre-signed URL Helpers
// ============================================================================

/**
 * Track pre-signed URL generation
 */
export function trackPresignedUrl(
  type: 'upload' | 'download',
  bucket: string,
  durationSeconds: number,
  status: StorageStatus = 'success'
): void {
  const metrics = getStorageMetrics();

  metrics.trackOperation(
    type === 'upload' ? 'presign_upload' : 'presign_download',
    bucket,
    status,
    durationSeconds
  );
}

// Re-export types
export type { Labels, Counter, Histogram };
