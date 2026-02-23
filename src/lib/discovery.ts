import type { Server } from '~/components/context/config';
import { fetchInfo } from '~/lib/info';

export interface DiscoveryOptions {
  /** Base URL of the first replica (e.g. `http://localhost:8222`). */
  baseUrl: string;
  /**
   * Name of the first replica — used to derive names for subsequent ones.
   *
   * Pattern:  "nats-0"    → "nats-0", "nats-1", "nats-2" …
   *           "Replica 1" → "Replica 1", "Replica 2", "Replica 3" …
   *           "myserver"  → "myserver", "myserver-1", "myserver-2" …
   *
   * Falls back to "Replica N" when omitted.
   */
  baseName?: string;
  /** Upper bound on how many ports to probe. @default 20 */
  maxReplicas?: number;
  /** Per-probe timeout in milliseconds. @default 2000 */
  timeout?: number;
  /** Use JSONP for probing (for old NATS servers). @default false */
  jsonp?: boolean;
}

/**
 * Attempt to reach one NATS monitoring endpoint.
 *
 * Uses `/healthz` — the most lightweight endpoint — so discovery traffic is
 * minimal.
 */
async function probeServer(url: string, timeout: number, jsonp: boolean): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    await fetchInfo({ url, endpoint: 'healthz', signal: controller.signal, jsonp });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Derive a display name for the replica at `index` (0-based port offset).
 *
 * If `baseName` ends with a number we replace that number to keep the naming
 * scheme consistent:
 *   baseName="nats-0", index=2  → "nats-2"
 *   baseName="Replica 1", index=2  → "Replica 3"   (1-based display)
 */
function deriveName(baseName: string | undefined, portOffset: number): string {
  if (!baseName) return `Replica ${portOffset + 1}`;

  const match = baseName.match(/^(.*?)([- _]?)(\d+)$/);
  if (match) {
    const prefix = match[1] ?? '';
    const sep = match[2] ?? '';
    const base = parseInt(match[3] ?? '0', 10);
    return `${prefix}${sep}${base + portOffset}`;
  }

  // No trailing number — append the offset for replicas beyond the first.
  return portOffset === 0 ? baseName : `${baseName}-${portOffset}`;
}

/**
 * Discover NATS replicas by probing sequential ports upward from `baseUrl`.
 *
 * The scan is sequential: starts at the base port, increments by 1 each step.
 * Stops as soon as a port is unreachable (after at least one has been found)
 * or `maxReplicas` is reached — whichever comes first.
 *
 * @example
 * // base: http://localhost:8222 → probes :8222, :8223, :8224 …
 * const servers = await discoverReplicas({ baseUrl: 'http://localhost:8222' });
 */
export async function discoverReplicas({
  baseUrl,
  baseName,
  maxReplicas = 20,
  timeout = 2000,
  jsonp = false,
}: DiscoveryOptions): Promise<Server[]> {
  let parsed: URL;

  try {
    parsed = new URL(baseUrl.includes('://') ? baseUrl : `http://${baseUrl}`);
  } catch {
    console.warn('[discovery] Invalid base URL:', baseUrl);
    return [];
  }

  const basePort = parseInt(
    parsed.port || (parsed.protocol === 'https:' ? '443' : '80'),
    10
  );

  const servers: Server[] = [];

  for (let i = 0; i < maxReplicas; i++) {
    parsed.port = String(basePort + i);
    const probeUrl = parsed.origin; // scheme://host:port

    const reachable = await probeServer(probeUrl, timeout, jsonp);

    if (reachable) {
      servers.push({ name: deriveName(baseName, i), url: probeUrl });
    } else if (servers.length > 0) {
      // First gap after at least one success → stop.
      break;
    }
  }

  return servers;
}
