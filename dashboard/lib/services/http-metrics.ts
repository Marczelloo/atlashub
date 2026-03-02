/**
 * HTTP Request Metrics
 *
 * Tracks HTTP request metrics including:
 * - Request count by method, path, and status code
 * - Request duration histogram
 *
 * Designed to work as middleware in Next.js API routes or as a wrapper
 * around fetch calls for tracking outgoing requests.
 */

import { getMetricsRegistry } from './metrics-registry';
import type { Labels, Histogram, Counter } from '../metrics-types';
import {
  HTTP_REQUESTS_TOTAL_CONFIG,
  HTTP_REQUEST_DURATION_CONFIG,
} from '../metrics-types';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for HTTP metrics tracking
 */
export interface HttpMetricsOptions {
  /** Whether to track request counts (default: true) */
  trackCount?: boolean;
  /** Whether to track request durations (default: true) */
  trackDuration?: boolean;
  /** Custom labels to add to all metrics */
  customLabels?: Labels;
  /** Function to normalize paths (e.g., replace IDs with placeholders) */
  pathNormalizer?: (path: string) => string;
  /** Whether to skip tracking for certain paths */
  shouldSkip?: (path: string) => boolean;
}

/**
 * Result of tracking an HTTP request
 */
export interface HttpTrackingResult {
  /** Function to call when the request completes */
  end: (status: number) => void;
  /** Timer instance for manual control */
  timer: () => number;
}

// ============================================================================
// Path Normalization
// ============================================================================

/**
 * Default path normalizer that replaces common ID patterns
 */
export function defaultPathNormalizer(path: string): string {
  return path
    // Replace UUIDs
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      ':id'
    )
    // Replace numeric IDs (but not in query strings)
    .replace(/\/(\d+)(?=[/?]|$)/g, '/:id')
    // Replace common hash patterns
    .replace(/\/[a-f0-9]{16,}(?=[/?]|$)/gi, '/:hash');
}

/**
 * Paths that are typically excluded from metrics
 */
const DEFAULT_SKIP_PATHS = [
  '/favicon.ico',
  '/robots.txt',
  '/health',
  '/healthz',
  '/ready',
  '/readyz',
  '/live',
  '/livez',
];

/**
 * Default skip function
 */
export function defaultShouldSkip(path: string): boolean {
  const normalizedPath = path.split('?')[0];
  return DEFAULT_SKIP_PATHS.some((skipPath) => normalizedPath === skipPath);
}

// ============================================================================
// HTTP Metrics Service
// ============================================================================

class HttpMetricsService {
  private requestsTotal: Counter;
  private requestDuration: Histogram;
  private pathNormalizer: (path: string) => string;
  private shouldSkip: (path: string) => boolean;

  constructor() {
    const registry = getMetricsRegistry();

    // Register metrics
    this.requestsTotal = registry.registerCounter(HTTP_REQUESTS_TOTAL_CONFIG);
    this.requestDuration = registry.registerHistogram(HTTP_REQUEST_DURATION_CONFIG);

    this.pathNormalizer = defaultPathNormalizer;
    this.shouldSkip = defaultShouldSkip;
  }

  /**
   * Configure the HTTP metrics service
   */
  configure(options: HttpMetricsOptions): void {
    if (options.pathNormalizer) {
      this.pathNormalizer = options.pathNormalizer;
    }
    if (options.shouldSkip) {
      this.shouldSkip = options.shouldSkip;
    }
  }

  /**
   * Start tracking an HTTP request.
   * Returns functions to record the request completion.
   */
  startRequest(
    method: string,
    path: string,
    options: HttpMetricsOptions = {}
  ): HttpTrackingResult | null {
    const { shouldSkip: localSkip, pathNormalizer: localNormalizer } = options;

    const skipFn = localSkip || this.shouldSkip;
    const normalizeFn = localNormalizer || this.pathNormalizer;

    // Check if we should skip this path
    if (skipFn(path)) {
      return null;
    }

    const normalizedPath = normalizeFn(path);
    const startTime = process.hrtime.bigint();

    return {
      timer: () => {
        const endTime = process.hrtime.bigint();
        return Number(endTime - startTime) / 1e9; // Convert nanoseconds to seconds
      },
      end: (status: number) => {
        const duration = Number(process.hrtime.bigint() - startTime) / 1e9;

        const labels: Labels = {
          method: method.toUpperCase(),
          path: normalizedPath,
          status: String(status),
          ...options.customLabels,
        };

        // Track request count
        if (options.trackCount !== false) {
          this.requestsTotal.inc(1, labels);
        }

        // Track duration (without status label for histogram to reduce cardinality)
        if (options.trackDuration !== false) {
          const durationLabels: Labels = {
            method: method.toUpperCase(),
            path: normalizedPath,
          };
          this.requestDuration.observe(duration, durationLabels);
        }
      },
    };
  }

  /**
   * Track a completed HTTP request (convenience method)
   */
  trackRequest(
    method: string,
    path: string,
    status: number,
    durationSeconds: number,
    options: HttpMetricsOptions = {}
  ): void {
    const skipFn = options.shouldSkip || this.shouldSkip;
    const normalizeFn = options.pathNormalizer || this.pathNormalizer;

    if (skipFn(path)) {
      return;
    }

    const normalizedPath = normalizeFn(path);
    const labels: Labels = {
      method: method.toUpperCase(),
      path: normalizedPath,
      status: String(status),
      ...options.customLabels,
    };

    if (options.trackCount !== false) {
      this.requestsTotal.inc(1, labels);
    }

    if (options.trackDuration !== false) {
      const durationLabels: Labels = {
        method: method.toUpperCase(),
        path: normalizedPath,
      };
      this.requestDuration.observe(durationSeconds, durationLabels);
    }
  }

  /**
   * Get the underlying counter metric (for testing or advanced use)
   */
  getRequestsTotalCounter(): Counter {
    return this.requestsTotal;
  }

  /**
   * Get the underlying histogram metric (for testing or advanced use)
   */
  getRequestDurationHistogram(): Histogram {
    return this.requestDuration;
  }

  /**
   * Increment error count (convenience method)
   */
  incrementError(
    method: string,
    path: string,
    status: number,
    options: HttpMetricsOptions = {}
  ): void {
    const normalizeFn = options.pathNormalizer || this.pathNormalizer;
    const normalizedPath = normalizeFn(path);

    this.requestsTotal.inc(1, {
      method: method.toUpperCase(),
      path: normalizedPath,
      status: String(status),
      ...options.customLabels,
    });
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let httpMetricsInstance: HttpMetricsService | null = null;

/**
 * Get the HTTP metrics service instance
 */
export function getHttpMetrics(): HttpMetricsService {
  if (!httpMetricsInstance) {
    httpMetricsInstance = new HttpMetricsService();
  }
  return httpMetricsInstance;
}

/**
 * Reset the HTTP metrics service (primarily for testing)
 */
export function resetHttpMetrics(): void {
  httpMetricsInstance = null;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a high-resolution timer
 */
export function createTimer(): () => number {
  const startTime = process.hrtime.bigint();
  return () => {
    const endTime = process.hrtime.bigint();
    return Number(endTime - startTime) / 1e9;
  };
}

/**
 * Wrap a fetch call with metrics tracking
 */
export async function trackedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: HttpMetricsOptions
): Promise<Response> {
  const url = typeof input === 'string' ? input : (input as URL).toString();
  const method = init?.method || 'GET';
  const path = new URL(url).pathname;

  const httpMetrics = getHttpMetrics();
  const tracking = httpMetrics.startRequest(method, path, options);

  try {
    const response = await fetch(input, init);
    tracking?.end(response.status);
    return response;
  } catch (error) {
    tracking?.end(0); // 0 indicates network error
    throw error;
  }
}

/**
 * Express/Next.js middleware helper for tracking requests
 */
export function createMetricsMiddleware(options: HttpMetricsOptions = {}) {
  const httpMetrics = getHttpMetrics();

  return async function metricsMiddleware(
    req: { method: string; url: string },
    res: { status?: number; statusCode?: number },
    next: () => Promise<void> | void
  ): Promise<void> {
    const url = new URL(req.url, 'http://localhost');
    const tracking = httpMetrics.startRequest(req.method, url.pathname, options);

    try {
      await next();
    } finally {
      const status = res.status || res.statusCode || 200;
      tracking?.end(status);
    }
  };
}

// Re-export types
export type { Labels };
