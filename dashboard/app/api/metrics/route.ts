/**
 * Prometheus Metrics Scrape Endpoint
 *
 * This endpoint exposes metrics in Prometheus text format for scraping.
 * It aggregates all registered metrics from the metrics registry.
 *
 * Endpoint: GET /api/metrics
 * Content-Type: text/plain; version=0.0.4; charset=utf-8
 */

import { NextRequest, NextResponse } from 'next/server';
import { getMetricsRegistry } from '@/lib/services/metrics-registry';
import { getHttpMetrics } from '@/lib/services/http-metrics';
import { getDatabaseMetrics } from '@/lib/services/database-metrics';
import { getStorageMetrics } from '@/lib/services/storage-metrics';

// ============================================================================
// Configuration
// ============================================================================

/**
 * Metrics endpoint configuration
 */
const METRICS_CONFIG = {
  /** Whether metrics endpoint is enabled */
  enabled: process.env.METRICS_ENABLED !== 'false',
  /** Token for authentication (optional) */
  authToken: process.env.METRICS_AUTH_TOKEN,
  /** Allowed IP addresses (optional, comma-separated) */
  allowedIps: process.env.METRICS_ALLOWED_IPS?.split(',').map((ip) => ip.trim()),
  /** Cache duration in seconds (0 = no cache) */
  cacheDuration: parseInt(process.env.METRICS_CACHE_DURATION || '0', 10),
};

// Cache for metrics output
let cachedMetrics: { content: string; timestamp: number } | null = null;

// ============================================================================
// Authentication & Authorization
// ============================================================================

/**
 * Validate authentication for the metrics endpoint
 */
function validateAuth(request: NextRequest): { valid: boolean; error?: string } {
  // Check if endpoint is disabled
  if (!METRICS_CONFIG.enabled) {
    return { valid: false, error: 'Metrics endpoint is disabled' };
  }

  // Check auth token if configured
  if (METRICS_CONFIG.authToken) {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace(/^Bearer\s+/i, '');

    if (!token || token !== METRICS_CONFIG.authToken) {
      return { valid: false, error: 'Unauthorized' };
    }
  }

  // Check IP allowlist if configured
  if (METRICS_CONFIG.allowedIps && METRICS_CONFIG.allowedIps.length > 0) {
    const clientIp =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip') ||
      'unknown';

    if (!METRICS_CONFIG.allowedIps.includes(clientIp)) {
      return { valid: false, error: 'Forbidden' };
    }
  }

  return { valid: true };
}

// ============================================================================
// Metrics Collection
// ============================================================================

/**
 * Collect and format all metrics
 */
function collectMetrics(): string {
  // Check cache
  if (METRICS_CONFIG.cacheDuration > 0 && cachedMetrics) {
    const now = Date.now();
    if (now - cachedMetrics.timestamp < METRICS_CONFIG.cacheDuration * 1000) {
      return cachedMetrics.content;
    }
  }

  // Initialize all metrics services to ensure they're registered
  // This is safe to call multiple times - services are singletons
  getHttpMetrics();
  getDatabaseMetrics();
  getStorageMetrics();

  // Export all metrics
  const registry = getMetricsRegistry();
  const content = registry.exportAll();

  // Update cache
  if (METRICS_CONFIG.cacheDuration > 0) {
    cachedMetrics = {
      content,
      timestamp: Date.now(),
    };
  }

  return content;
}

/**
 * Get registry statistics for health check
 */
function getRegistryStats(): {
  metricCount: number;
  metrics: string[];
} {
  const registry = getMetricsRegistry();
  return {
    metricCount: registry.getMetricNames().length,
    metrics: registry.getMetricNames(),
  };
}

// ============================================================================
// HTTP Handlers
// ============================================================================

/**
 * GET /api/metrics
 * Returns Prometheus-compatible metrics
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  // Validate authentication
  const auth = validateAuth(request);
  if (!auth.valid) {
    return new NextResponse(auth.error || 'Unauthorized', {
      status: auth.error === 'Forbidden' ? 403 : 401,
      headers: {
        'Content-Type': 'text/plain',
      },
    });
  }

  try {
    // Check for ?stats query parameter (for health/monitoring)
    const url = new URL(request.url);
    if (url.searchParams.get('stats') === 'true') {
      const stats = getRegistryStats();
      return NextResponse.json(stats);
    }

    // Collect and return metrics
    const metrics = collectMetrics();

    return new NextResponse(metrics, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  } catch (error) {
    console.error('Error collecting metrics:', error);

    return new NextResponse(
      '# Error collecting metrics\n' +
        `# ${error instanceof Error ? error.message : 'Unknown error'}\n`,
      {
        status: 500,
        headers: {
          'Content-Type': 'text/plain',
        },
      }
    );
  }
}

/**
 * HEAD /api/metrics
 * Health check for metrics endpoint
 */
export async function HEAD(): Promise<NextResponse> {
  if (!METRICS_CONFIG.enabled) {
    return new NextResponse(null, { status: 503 });
  }

  return new NextResponse(null, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain',
    },
  });
}

// ============================================================================
// Metrics Self-Registration
// ============================================================================

/**
 * Initialize default metrics on module load.
 * This ensures all metric types are registered before first scrape.
 */
function initializeDefaultMetrics(): void {
  const registry = getMetricsRegistry();

  // Check if metrics are already registered
  if (registry.getMetricNames().length > 0) {
    return;
  }

  // Initialize services which register their metrics
  getHttpMetrics();
  getDatabaseMetrics();
  getStorageMetrics();

  // Add application info metric
  registry.registerGauge({
    type: 'gauge',
    name: 'atlashub_info',
    help: 'AtlasHub application information',
    labelNames: ['version', 'node_env'],
  });

  const infoGauge = registry.getGauge('atlashub_info');
  if (infoGauge) {
    infoGauge.set(1, {
      version: process.env.npm_package_version || '0.0.0',
      node_env: process.env.NODE_ENV || 'development',
    });
  }

  // Add process metrics (if available)
  if (typeof process !== 'undefined' && process.memoryUsage) {
    registry.registerGauge({
      type: 'gauge',
      name: 'process_resident_memory_bytes',
      help: 'Resident memory size in bytes',
    });

    registry.registerGauge({
      type: 'gauge',
      name: 'process_heap_used_bytes',
      help: 'Process heap memory used in bytes',
    });

    registry.registerGauge({
      type: 'gauge',
      name: 'process_heap_total_bytes',
      help: 'Process heap memory total in bytes',
    });

    // Update process metrics periodically
    setInterval(() => {
      const memUsage = process.memoryUsage();
      const residentGauge = registry.getGauge('process_resident_memory_bytes');
      const heapUsedGauge = registry.getGauge('process_heap_used_bytes');
      const heapTotalGauge = registry.getGauge('process_heap_total_bytes');

      if (residentGauge) residentGauge.set(memUsage.rss);
      if (heapUsedGauge) heapUsedGauge.set(memUsage.heapUsed);
      if (heapTotalGauge) heapTotalGauge.set(memUsage.heapTotal);
    }, 10000).unref(); // Update every 10 seconds
  }
}

// Initialize on module load (in non-browser environments)
if (typeof window === 'undefined') {
  // Defer initialization to avoid circular dependencies
  setImmediate(() => {
    try {
      initializeDefaultMetrics();
    } catch (error) {
      console.warn('Failed to initialize default metrics:', error);
    }
  });
}
