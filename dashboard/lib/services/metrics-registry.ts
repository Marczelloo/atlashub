/**
 * Prometheus Metrics Registry
 *
 * A lightweight, zero-dependency implementation of a Prometheus metrics registry.
 * Supports counters, gauges, and histograms with labels.
 * Outputs metrics in Prometheus text exposition format.
 */

import type {
  Counter,
  Gauge,
  Histogram,
  CounterConfig,
  GaugeConfig,
  HistogramConfig,
  Labels,
  LabelValue,
  MetricsRegistry,
} from '../metrics-types';

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Escapes special characters in label values according to Prometheus format
 */
function escapeLabelValue(value: LabelValue): string {
  const str = String(value);
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

/**
 * Formats labels into Prometheus label syntax: {label1="value1",label2="value2"}
 */
function formatLabels(labels: Labels | undefined, includeBraces = true): string {
  if (!labels || Object.keys(labels).length === 0) {
    return '';
  }

  const pairs = Object.entries(labels)
    .map(([key, value]) => `${key}="${escapeLabelValue(value)}"`)
    .join(',');

  return includeBraces ? `{${pairs}}` : pairs;
}

/**
 * Formats a number for Prometheus output (handles special cases)
 */
function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return 'NaN';
  }
  // Prometheus prefers scientific notation for very large/small numbers
  return value.toString();
}

/**
 * Validates a metric name according to Prometheus naming conventions
 */
function validateMetricName(name: string): void {
  // Prometheus metric names must match [a-zA-Z_:][a-zA-Z0-9_:]*
  if (!/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(name)) {
    throw new Error(
      `Invalid metric name "${name}": must match [a-zA-Z_:][a-zA-Z0-9_:]*`
    );
  }
}

/**
 * Validates a label name according to Prometheus naming conventions
 */
function validateLabelName(name: string): void {
  // Label names must match [a-zA-Z_][a-zA-Z0-9_]*
  // Labels starting with __ are reserved for internal use
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(
      `Invalid label name "${name}": must match [a-zA-Z_][a-zA-Z0-9_]*`
    );
  }
  if (name.startsWith('__')) {
    throw new Error(
      `Invalid label name "${name}": labels starting with __ are reserved`
    );
  }
}

/**
 * Creates a hash key from labels for internal storage
 */
function labelsToKey(labels: Labels | undefined): string {
  if (!labels || Object.keys(labels).length === 0) {
    return '';
  }
  // Sort keys for consistent hashing
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join('|');
}

// ============================================================================
// Counter Implementation
// ============================================================================

class CounterImpl implements Counter {
  private readonly name: string;
  private readonly help: string;
  private readonly labelNames: Set<string>;
  private readonly values: Map<string, number> = new Map();

  constructor(config: CounterConfig) {
    validateMetricName(config.name);
    this.name = config.name;
    this.help = config.help;
    this.labelNames = new Set(config.labelNames || []);

    // Validate label names
    this.labelNames.forEach(validateLabelName);
  }

  inc(value = 1, labels?: Labels): void {
    if (value < 0) {
      throw new Error('Counter can only be incremented by non-negative values');
    }
    this.validateLabels(labels);
    const key = labelsToKey(labels);
    const current = this.values.get(key) || 0;
    this.values.set(key, current + value);
  }

  reset(): void {
    this.values.clear();
  }

  getValue(labels?: Labels): number | undefined {
    return this.values.get(labelsToKey(labels));
  }

  export(): string {
    const lines: string[] = [];

    // Add TYPE and HELP headers
    lines.push(`# HELP ${this.name} ${this.help}`);
    lines.push(`# TYPE ${this.name} counter`);

    // Export all values
    for (const [key, value] of this.values) {
      const labels = this.keyToLabels(key);
      const labelStr = formatLabels(labels);
      lines.push(`${this.name}${labelStr} ${formatNumber(value)}`);
    }

    return lines.join('\n');
  }

  private validateLabels(labels?: Labels): void {
    if (!labels) return;

    for (const key of Object.keys(labels)) {
      if (!this.labelNames.has(key)) {
        throw new Error(
          `Unknown label "${key}" for counter "${this.name}". ` +
          `Allowed labels: ${Array.from(this.labelNames).join(', ')}`
        );
      }
    }
  }

  private keyToLabels(key: string): Labels | undefined {
    if (!key) return undefined;

    const labels: Labels = {};
    const pairs = key.split('|');
    for (const pair of pairs) {
      const [k, v] = pair.split('=');
      labels[k] = v;
    }
    return labels;
  }
}

// ============================================================================
// Gauge Implementation
// ============================================================================

class GaugeImpl implements Gauge {
  private readonly name: string;
  private readonly help: string;
  private readonly labelNames: Set<string>;
  private readonly values: Map<string, number> = new Map();

  constructor(config: GaugeConfig) {
    validateMetricName(config.name);
    this.name = config.name;
    this.help = config.help;
    this.labelNames = new Set(config.labelNames || []);

    // Validate label names
    this.labelNames.forEach(validateLabelName);
  }

  set(value: number, labels?: Labels): void {
    this.validateLabels(labels);
    const key = labelsToKey(labels);
    this.values.set(key, value);
  }

  inc(value = 1, labels?: Labels): void {
    this.validateLabels(labels);
    const key = labelsToKey(labels);
    const current = this.values.get(key) || 0;
    this.values.set(key, current + value);
  }

  dec(value = 1, labels?: Labels): void {
    this.validateLabels(labels);
    const key = labelsToKey(labels);
    const current = this.values.get(key) || 0;
    this.values.set(key, current - value);
  }

  reset(): void {
    this.values.clear();
  }

  getValue(labels?: Labels): number | undefined {
    return this.values.get(labelsToKey(labels));
  }

  export(): string {
    const lines: string[] = [];

    // Add TYPE and HELP headers
    lines.push(`# HELP ${this.name} ${this.help}`);
    lines.push(`# TYPE ${this.name} gauge`);

    // Export all values
    for (const [key, value] of this.values) {
      const labels = this.keyToLabels(key);
      const labelStr = formatLabels(labels);
      lines.push(`${this.name}${labelStr} ${formatNumber(value)}`);
    }

    return lines.join('\n');
  }

  private validateLabels(labels?: Labels): void {
    if (!labels) return;

    for (const key of Object.keys(labels)) {
      if (!this.labelNames.has(key)) {
        throw new Error(
          `Unknown label "${key}" for gauge "${this.name}". ` +
          `Allowed labels: ${Array.from(this.labelNames).join(', ')}`
        );
      }
    }
  }

  private keyToLabels(key: string): Labels | undefined {
    if (!key) return undefined;

    const labels: Labels = {};
    const pairs = key.split('|');
    for (const pair of pairs) {
      const [k, v] = pair.split('=');
      labels[k] = v;
    }
    return labels;
  }
}

// ============================================================================
// Histogram Implementation
// ============================================================================

interface HistogramValue {
  buckets: Map<number, number>; // bucket boundary -> cumulative count
  sum: number;
  count: number;
}

class HistogramImpl implements Histogram {
  private readonly name: string;
  private readonly help: string;
  private readonly labelNames: Set<string>;
  private readonly buckets: number[];
  private readonly values: Map<string, HistogramValue> = new Map();

  constructor(config: HistogramConfig) {
    validateMetricName(config.name);
    this.name = config.name;
    this.help = config.help;
    this.labelNames = new Set(config.labelNames || []);
    this.buckets = config.buckets || [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

    // Validate label names
    this.labelNames.forEach(validateLabelName);

    // Validate buckets
    if (this.buckets.length === 0) {
      throw new Error('Histogram must have at least one bucket');
    }

    // Ensure buckets are sorted
    for (let i = 1; i < this.buckets.length; i++) {
      if (this.buckets[i] <= this.buckets[i - 1]) {
        throw new Error('Histogram buckets must be in ascending order');
      }
    }
  }

  observe(value: number, labels?: Labels): void {
    this.validateLabels(labels);
    const key = labelsToKey(labels);

    let histValue = this.values.get(key);
    if (!histValue) {
      histValue = this.createEmptyValue();
      this.values.set(key, histValue);
    }

    // Update sum and count
    histValue.sum += value;
    histValue.count += 1;

    // Update buckets (cumulative)
    for (const bucket of this.buckets) {
      if (value <= bucket) {
        const currentCount = histValue.buckets.get(bucket) || 0;
        histValue.buckets.set(bucket, currentCount + 1);
      }
    }
  }

  reset(): void {
    this.values.clear();
  }

  getBuckets(labels?: Labels): { bucket: number; count: number }[] | undefined {
    const histValue = this.values.get(labelsToKey(labels));
    if (!histValue) return undefined;

    // Return cumulative counts
    let cumulative = 0;
    return this.buckets.map((bucket) => {
      cumulative += histValue.buckets.get(bucket) || 0;
      return { bucket, count: cumulative };
    });
  }

  getSummary(labels?: Labels): { sum: number; count: number } | undefined {
    const histValue = this.values.get(labelsToKey(labels));
    if (!histValue) return undefined;
    return { sum: histValue.sum, count: histValue.count };
  }

  export(): string {
    const lines: string[] = [];

    // Add TYPE and HELP headers
    lines.push(`# HELP ${this.name} ${this.help}`);
    lines.push(`# TYPE ${this.name} histogram`);

    // Export each unique label combination
    for (const [key, histValue] of this.values) {
      const labels = this.keyToLabels(key);

      // Export buckets (with le label)
      let cumulative = 0;
      for (const bucket of this.buckets) {
        cumulative += histValue.buckets.get(bucket) || 0;
        const bucketLabels = { ...labels, le: bucket };
        const labelStr = formatLabels(bucketLabels);
        lines.push(`${this.name}_bucket${labelStr} ${cumulative}`);
      }

      // Export +Inf bucket (same as count)
      const infLabels = { ...labels, le: '+Inf' };
      lines.push(`${this.name}_bucket${formatLabels(infLabels)} ${histValue.count}`);

      // Export sum
      lines.push(`${this.name}_sum${formatLabels(labels)} ${formatNumber(histValue.sum)}`);

      // Export count
      lines.push(`${this.name}_count${formatLabels(labels)} ${histValue.count}`);
    }

    return lines.join('\n');
  }

  private createEmptyValue(): HistogramValue {
    return {
      buckets: new Map(this.buckets.map((b) => [b, 0])),
      sum: 0,
      count: 0,
    };
  }

  private validateLabels(labels?: Labels): void {
    if (!labels) return;

    for (const key of Object.keys(labels)) {
      if (!this.labelNames.has(key)) {
        throw new Error(
          `Unknown label "${key}" for histogram "${this.name}". ` +
          `Allowed labels: ${Array.from(this.labelNames).join(', ')}`
        );
      }
    }
  }

  private keyToLabels(key: string): Labels | undefined {
    if (!key) return undefined;

    const labels: Labels = {};
    const pairs = key.split('|');
    for (const pair of pairs) {
      const [k, v] = pair.split('=');
      labels[k] = v;
    }
    return labels;
  }
}

// ============================================================================
// Metrics Registry Implementation
// ============================================================================

class MetricsRegistryImpl implements MetricsRegistry {
  private readonly counters: Map<string, CounterImpl> = new Map();
  private readonly gauges: Map<string, GaugeImpl> = new Map();
  private readonly histograms: Map<string, HistogramImpl> = new Map();

  registerCounter(config: CounterConfig): Counter {
    if (this.counters.has(config.name) || this.gauges.has(config.name) || this.histograms.has(config.name)) {
      throw new Error(`Metric "${config.name}" is already registered`);
    }

    const counter = new CounterImpl(config);
    this.counters.set(config.name, counter);
    return counter;
  }

  registerGauge(config: GaugeConfig): Gauge {
    if (this.counters.has(config.name) || this.gauges.has(config.name) || this.histograms.has(config.name)) {
      throw new Error(`Metric "${config.name}" is already registered`);
    }

    const gauge = new GaugeImpl(config);
    this.gauges.set(config.name, gauge);
    return gauge;
  }

  registerHistogram(config: HistogramConfig): Histogram {
    if (this.counters.has(config.name) || this.gauges.has(config.name) || this.histograms.has(config.name)) {
      throw new Error(`Metric "${config.name}" is already registered`);
    }

    const histogram = new HistogramImpl(config);
    this.histograms.set(config.name, histogram);
    return histogram;
  }

  getCounter(name: string): Counter | undefined {
    return this.counters.get(name);
  }

  getGauge(name: string): Gauge | undefined {
    return this.gauges.get(name);
  }

  getHistogram(name: string): Histogram | undefined {
    return this.histograms.get(name);
  }

  exportAll(): string {
    const sections: string[] = [];

    // Add a header comment with timestamp
    sections.push(`# AtlasHub Metrics`);
    sections.push(`# Generated at: ${new Date().toISOString()}`);
    sections.push('');

    // Export all metrics in a consistent order
    const allNames = [
      ...Array.from(this.counters.keys()),
      ...Array.from(this.gauges.keys()),
      ...Array.from(this.histograms.keys()),
    ].sort();

    // Export counters
    for (const name of allNames) {
      const counter = this.counters.get(name);
      if (counter) {
        sections.push(counter.export());
      }
    }

    // Export gauges
    for (const name of allNames) {
      const gauge = this.gauges.get(name);
      if (gauge) {
        sections.push(gauge.export());
      }
    }

    // Export histograms
    for (const name of allNames) {
      const histogram = this.histograms.get(name);
      if (histogram) {
        sections.push(histogram.export());
      }
    }

    return sections.join('\n');
  }

  clear(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }

  getMetricNames(): string[] {
    return [
      ...Array.from(this.counters.keys()),
      ...Array.from(this.gauges.keys()),
      ...Array.from(this.histograms.keys()),
    ].sort();
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Global metrics registry instance.
 * Use this to register and access all metrics in the application.
 */
let globalRegistry: MetricsRegistry | null = null;

/**
 * Get the global metrics registry instance.
 * Creates a new instance on first call.
 */
export function getMetricsRegistry(): MetricsRegistry {
  if (!globalRegistry) {
    globalRegistry = new MetricsRegistryImpl();
  }
  return globalRegistry;
}

/**
 * Create a new isolated metrics registry.
 * Useful for testing or when you need separate metric namespaces.
 */
export function createMetricsRegistry(): MetricsRegistry {
  return new MetricsRegistryImpl();
}

/**
 * Reset the global registry (primarily for testing)
 */
export function resetGlobalRegistry(): void {
  if (globalRegistry) {
    globalRegistry.clear();
  }
  globalRegistry = null;
}

// Re-export types
export type { Counter, Gauge, Histogram, MetricsRegistry, Labels };
