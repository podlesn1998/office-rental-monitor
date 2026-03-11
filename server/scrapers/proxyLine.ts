/**
 * ProxyLine residential proxy helper.
 *
 * Fetches active proxies from the ProxyLine API and provides a simple
 * round-robin rotation so each Yandex page request uses a different IP.
 *
 * Proxy format returned by the API:
 *   { id, ip, port, login, password, type, ip_version, country, ... }
 *
 * Playwright proxy config:
 *   { server: "http://ip:port", username: "login", password: "password" }
 */

import { ENV } from "../_core/env";

export interface ProxyConfig {
  server: string;
  username: string;
  password: string;
}

interface ProxyLineProxy {
  id: number;
  ip: string;
  port: number;
  login: string;
  password: string;
  type: string; // "dedicated" | "shared"
  ip_version: number;
  country: string;
  active: boolean;
}

interface ProxyLineResponse {
  count: number;
  results: ProxyLineProxy[];
}

let _proxies: ProxyConfig[] = [];
let _lastFetchAt = 0;
let _rotationIndex = 0;

const CACHE_TTL_MS = 5 * 60 * 1000; // refresh proxy list every 5 minutes

/**
 * Fetch active proxies from ProxyLine API and cache them.
 */
async function fetchProxies(): Promise<ProxyConfig[]> {
  const apiKey = ENV.proxylineApiKey;
  if (!apiKey) {
    console.warn("[ProxyLine] PROXYLINE_API_KEY not set, proxy disabled");
    return [];
  }

  try {
    const url = new URL("https://panel.proxyline.net/api/proxies/");
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("status", "active");
    url.searchParams.set("limit", "100");

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      console.warn(`[ProxyLine] API returned ${res.status}`);
      return [];
    }

    const data = (await res.json()) as ProxyLineResponse;
    if (!data.results || data.results.length === 0) {
      console.warn("[ProxyLine] No active proxies found in account");
      return [];
    }

    const proxies: ProxyConfig[] = data.results.map((p) => ({
      server: `http://${p.ip}:${p.port}`,
      username: p.login,
      password: p.password,
    }));

    console.log(`[ProxyLine] Loaded ${proxies.length} active proxies`);
    return proxies;
  } catch (err) {
    console.warn("[ProxyLine] Failed to fetch proxies:", err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Get a proxy config for the next request (round-robin rotation).
 * Returns null if no proxies are available (scraper falls back to direct connection).
 */
export async function getNextProxy(): Promise<ProxyConfig | null> {
  const now = Date.now();

  // Refresh cache if stale or empty
  if (_proxies.length === 0 || now - _lastFetchAt > CACHE_TTL_MS) {
    _proxies = await fetchProxies();
    _lastFetchAt = now;
    _rotationIndex = 0;
  }

  if (_proxies.length === 0) return null;

  const proxy = _proxies[_rotationIndex % _proxies.length];
  _rotationIndex++;
  return proxy;
}

/**
 * Force-refresh the proxy list (call after a proxy fails).
 */
export async function refreshProxies(): Promise<void> {
  _proxies = await fetchProxies();
  _lastFetchAt = Date.now();
  _rotationIndex = 0;
}

/**
 * Check if ProxyLine is configured and has proxies available.
 */
export async function isProxyAvailable(): Promise<boolean> {
  if (!ENV.proxylineApiKey) return false;
  const proxy = await getNextProxy();
  return proxy !== null;
}
