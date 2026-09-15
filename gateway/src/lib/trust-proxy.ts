/** Fastify's function form of trustProxy: whether to trust the hop at `hop` (0 = direct peer). */
export type TrustProxyFunction = (address: string, hop: number) => boolean;

/**
 * Fastify trustProxy value from the TRUST_PROXY setting: "true", "false", a hop
 * count ("1" trusts only the direct peer), or IPs/CIDRs and the presets
 * loopback, linklocal, uniquelocal, comma-separated.
 */
export function parseTrustProxy(raw: string): boolean | string | TrustProxyFunction {
  const value = raw.trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    return (_address: string, hop: number) => hop < hops;
  }
  return value;
}
