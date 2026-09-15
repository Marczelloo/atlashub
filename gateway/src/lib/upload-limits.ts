/**
 * Upload size limits.
 *
 * MAX_UPLOAD_SIZE_BYTES is the default for every project. STORAGE_UPLOAD_LIMITS
 * overrides it per project or per logical bucket, so an app that stores videos
 * can get a large limit without raising it for everyone:
 *
 *   STORAGE_UPLOAD_LIMITS=<projectId>=5GB,<projectId>/videos=50GB
 *
 * A bucket entry wins over its project entry. Sizes accept plain bytes or units
 * B, KB, MB, GB, TB (binary: 1 GB = 1024^3 bytes). Invalid entries are skipped
 * with a warning instead of failing startup.
 */

/** S3/MinIO accept at most 5 GiB in a single PUT; larger files need multipart. */
export const SINGLE_PUT_MAX_BYTES = 5 * 1024 ** 3;

/** Largest object S3/MinIO can store (5 TiB). */
export const MAX_OBJECT_BYTES = 5 * 1024 ** 4;

const UNITS: Record<string, number> = {
  B: 1,
  KB: 1024,
  MB: 1024 ** 2,
  GB: 1024 ** 3,
  TB: 1024 ** 4,
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

/** Bytes from "1048576", "500MB", "5 GB" or "1.5GB"; null when not a positive size. */
export function parseByteSize(raw: string | number): number | null {
  if (typeof raw === 'number') {
    return Number.isSafeInteger(raw) && raw > 0 ? raw : null;
  }
  const match = /^\s*(\d+(?:\.\d+)?)\s*([a-z]{0,2})\s*$/i.exec(raw);
  if (!match) return null;
  const unit = match[2].toUpperCase() || 'B';
  const multiplier = UNITS[unit === 'K' ? 'KB' : unit === 'M' ? 'MB' : unit === 'G' ? 'GB' : unit === 'T' ? 'TB' : unit];
  if (!multiplier) return null;
  const bytes = Math.floor(Number(match[1]) * multiplier);
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : null;
}

export interface UploadLimitOverrides {
  projects: Map<string, number>;
  buckets: Map<string, number>;
  invalid: string[];
}

export function parseUploadLimitOverrides(raw: string | undefined): UploadLimitOverrides {
  const projects = new Map<string, number>();
  const buckets = new Map<string, number>();
  const invalid: string[] = [];

  for (const entry of (raw ?? '').split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const separator = trimmed.indexOf('=');
    const target = separator > 0 ? trimmed.slice(0, separator).trim() : '';
    const size = separator > 0 ? parseByteSize(trimmed.slice(separator + 1)) : null;
    const [projectId, bucket, extra] = target.split('/');

    const validTarget =
      UUID_PATTERN.test(projectId ?? '') &&
      extra === undefined &&
      (bucket === undefined || BUCKET_PATTERN.test(bucket));

    if (!validTarget || size === null || size > MAX_OBJECT_BYTES) {
      invalid.push(trimmed);
      continue;
    }

    if (bucket === undefined) {
      projects.set(projectId.toLowerCase(), size);
    } else {
      buckets.set(`${projectId.toLowerCase()}/${bucket}`, size);
    }
  }

  return { projects, buckets, invalid };
}

/** The upload limit in bytes for a logical bucket of a project. */
export function resolveUploadLimit(
  overrides: UploadLimitOverrides,
  defaultLimit: number,
  projectId: string,
  bucket: string
): number {
  const project = projectId.toLowerCase();
  return overrides.buckets.get(`${project}/${bucket}`) ?? overrides.projects.get(project) ?? defaultLimit;
}
