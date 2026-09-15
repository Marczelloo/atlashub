/**
 * Per-project request limits from RATE_LIMIT_PROJECT_OVERRIDES.
 *
 * Format: "projectId=300,otherProjectId=500". A listed project gets that many
 * requests per rate-limit window instead of the global maximum; unlisted
 * projects keep the global value (including changes made in the dashboard).
 *
 * A typo must not take the gateway down, so invalid entries are skipped and
 * reported instead of failing startup.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RateLimitOverrides {
  limits: Map<string, number>;
  invalid: string[];
}

export function parseRateLimitOverrides(raw: string | undefined): RateLimitOverrides {
  const limits = new Map<string, number>();
  const invalid: string[] = [];

  for (const entry of (raw ?? '').split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const separator = trimmed.indexOf('=');
    const projectId = separator > 0 ? trimmed.slice(0, separator).trim() : '';
    const valueText = separator > 0 ? trimmed.slice(separator + 1).trim() : '';
    const value = Number(valueText);

    if (!UUID_PATTERN.test(projectId) || !/^\d+$/.test(valueText) || !Number.isSafeInteger(value) || value < 1) {
      invalid.push(trimmed);
      continue;
    }

    limits.set(projectId.toLowerCase(), value);
  }

  return { limits, invalid };
}

/** The limit for a project, or undefined when it has no override. */
export function projectRateLimit(
  overrides: RateLimitOverrides,
  projectId: string | undefined
): number | undefined {
  return projectId ? overrides.limits.get(projectId.toLowerCase()) : undefined;
}
