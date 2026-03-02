/**
 * Prometheus Metrics Type Definitions
 *
 * This module defines TypeScript types for the Prometheus metrics system.
 * All metrics follow Prometheus naming conventions and support labels.
 */

// ============================================================================
// Label Types
// ============================================================================

/**
 * Labels are key-value pairs that identify specific dimensions of a metric.
 * In Prometheus format, labels are appended to the metric name.
 */
export type LabelValue = string | number | boolean;
export type Labels = Record<string, LabelValue>;

// ============================================================================
// Metric Types
// ============================================================================

/**
 * The three core Prometheus metric types
 */
export type MetricType = 'counter' | 'gauge' | 'histogram';

/**
 * Base configuration shared by all metric types
 */
export interface MetricConfig {
  /** The name of the metric (must be unique) */
  name: string;
  /** Help text describing what the metric measures */
  help: string;
  /** List of label names this metric supports */
  labelNames?: string[];
}

/**
 * Counter: A cumulative metric that only increases (or resets to zero).
 * Use for counting events like requests served, tasks completed, or errors.
 */
export interface CounterConfig extends MetricConfig {
  type: 'counter';
}

/**
 * Gauge: A metric that can go up and down.
 * Use for values like current temperature, memory usage, or concurrent requests.
 */
export interface GaugeConfig extends MetricConfig {
  type: 'gauge';
}

/**
 * Histogram: Samples observations and counts them in configurable buckets.
 * Also provides a sum and count of all observations.
 * Use for request durations, response sizes, etc.
 */
export interface HistogramConfig extends MetricConfig {
  type: 'histogram';
  /** Bucket boundaries for the histogram (in ascending order) */
  buckets?: number[];
}

/**
 * Union type of all metric configurations
 */
export type AnyMetricConfig = CounterConfig | GaugeConfig | HistogramConfig;

// ============================================================================
// Metric Instance Types
// ============================================================================

/**
 * Counter metric instance with methods to increment
 */
export interface Counter {
  /** Increment the counter by 1 (or a specified value) */
  inc(value?: number, labels?: Labels): void;
  /** Reset the counter to zero */
  reset(): void;
  /** Get the current value (for testing/debugging) */
  getValue(labels?: Labels): number | undefined;
  /** Export metric in Prometheus format */
  export(): string;
}

/**
 * Gauge metric instance with methods to set, inc, dec
 */
export interface Gauge {
  /** Set the gauge to a specific value */
  set(value: number, labels?: Labels): void;
  /** Increment the gauge by 1 (or a specified value) */
  inc(value?: number, labels?: Labels): void;
  /** Decrement the gauge by 1 (or a specified value) */
  dec(value?: number, labels?: Labels): void;
  /** Reset the gauge to zero */
  reset(): void;
  /** Get the current value (for testing/debugging) */
  getValue(labels?: Labels): number | undefined;
  /** Export metric in Prometheus format */
  export(): string;
}

/**
 * Histogram metric instance with methods to observe values
 */
export interface Histogram {
  /** Observe a value and add it to the appropriate bucket */
  observe(value: number, labels?: Labels): void;
  /** Reset the histogram (all buckets, sum, and count) */
  reset(): void;
  /** Get bucket values (for testing/debugging) */
  getBuckets(labels?: Labels): { bucket: number; count: number }[] | undefined;
  /** Get sum and count (for testing/debugging) */
  getSummary(labels?: Labels): { sum: number; count: number } | undefined;
  /** Export metric in Prometheus format (includes _bucket, _sum, _count) */
  export(): string;
}

// ============================================================================
// Registry Types
// ============================================================================

/**
 * The metrics registry collects and exports all registered metrics
 */
export interface MetricsRegistry {
  /** Register a new counter metric */
  registerCounter(config: CounterConfig): Counter;
  /** Register a new gauge metric */
  registerGauge(config: GaugeConfig): Gauge;
  /** Register a new histogram metric */
  registerHistogram(config: HistogramConfig): Histogram;
  /** Get a previously registered counter by name */
  getCounter(name: string): Counter | undefined;
  /** Get a previously registered gauge by name */
  getGauge(name: string): Gauge | undefined;
  /** Get a previously registered histogram by name */
  getHistogram(name: string): Histogram | undefined;
  /** Export all metrics in Prometheus text format */
  exportAll(): string;
  /** Clear all metrics (useful for testing) */
  clear(): void;
  /** Get list of all registered metric names */
  getMetricNames(): string[];
}

// ============================================================================
// Predefined Metric Configurations
// ============================================================================

/**
 * Default histogram buckets for HTTP request durations (in seconds)
 * Based on common web application latency patterns
 */
export const DEFAULT_HTTP_DURATION_BUCKETS = [
  0.001,  // 1ms
  0.005,  // 5ms
  0.01,   // 10ms
  0.025,  // 25ms
  0.05,   // 50ms
  0.1,    // 100ms
  0.25,   // 250ms
  0.5,    // 500ms
  1,      // 1s
  2.5,    // 2.5s
  5,      // 5s
  10,     // 10s
];

/**
 * Default histogram buckets for database query durations (in seconds)
 */
export const DEFAULT_DB_DURATION_BUCKETS = [
  0.001,  // 1ms
  0.005,  // 5ms
  0.01,   // 10ms
  0.025,  // 25ms
  0.05,   // 50ms
  0.1,    // 100ms
  0.25,   // 250ms
  0.5,    // 500ms
  1,      // 1s
  2.5,    // 2.5s
  5,      // 5s
];

/**
 * Default histogram buckets for storage operation durations (in seconds)
 */
export const DEFAULT_STORAGE_DURATION_BUCKETS = [
  0.01,   // 10ms
  0.025,  // 25ms
  0.05,   // 50ms
  0.1,    // 100ms
  0.25,   // 250ms
  0.5,    // 500ms
  1,      // 1s
  2.5,    // 2.5s
  5,      // 5s
  10,     // 10s
  30,     // 30s
];

// ============================================================================
// HTTP Metrics Configuration
// ============================================================================

export const HTTP_REQUESTS_TOTAL_CONFIG: CounterConfig = {
  type: 'counter',
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path', 'status'],
};

export const HTTP_REQUEST_DURATION_CONFIG: HistogramConfig = {
  type: 'histogram',
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'path', 'status'],
  buckets: DEFAULT_HTTP_DURATION_BUCKETS,
};

// ============================================================================
// Database Metrics Configuration
// ============================================================================

export const DB_CONNECTIONS_ACTIVE_CONFIG: GaugeConfig = {
  type: 'gauge',
  name: 'db_connections_active',
  help: 'Number of active database connections',
  labelNames: ['pool'],
};

export const DB_QUERY_DURATION_CONFIG: HistogramConfig = {
  type: 'histogram',
  name: 'db_query_duration_seconds',
  help: 'Duration of database queries in seconds',
  labelNames: ['operation', 'table'],
  buckets: DEFAULT_DB_DURATION_BUCKETS,
};

// ============================================================================
// Storage Metrics Configuration
// ============================================================================

export const STORAGE_OPERATIONS_TOTAL_CONFIG: CounterConfig = {
  type: 'counter',
  name: 'storage_operations_total',
  help: 'Total number of storage operations',
  labelNames: ['operation', 'bucket', 'status'],
};

export const STORAGE_OPERATION_DURATION_CONFIG: HistogramConfig = {
  type: 'histogram',
  name: 'storage_operation_duration_seconds',
  help: 'Duration of storage operations in seconds',
  labelNames: ['operation', 'bucket'],
  buckets: DEFAULT_STORAGE_DURATION_BUCKETS,
};

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Timing helper result
 */
export interface TimerResult {
  /** The duration in seconds */
  duration: number;
  /** Stop the timer and return the duration */
  stop: () => number;
}

/**
 * Metric observation with optional labels
 */
export interface MetricObservation {
  value: number;
  labels?: Labels;
}
