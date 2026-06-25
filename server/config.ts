/**
 * Runtime configuration, read from environment variables.
 *
 * Security (ТЗ §11): API keys / cookies live only in env vars, never in code.
 * On Vercel set these in Project Settings → Environment Variables.
 */

function bool(name: string, def: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return def;
  return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
}

function int(name: string, def: number): number {
  const v = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) ? v : def;
}

/**
 * Build a Webshare backbone proxy URL from convenience env vars, so the user can
 * just paste their Webshare username/password instead of hand-crafting a URL.
 * Webshare backbone host is p.webshare.io; username params are appended with
 * hyphens: `{username}[-{country}][-rotate]`. Rotation (a fresh exit IP per
 * request) is ON by default — ideal for dodging any per-IP filtering.
 * Returns null if credentials aren't set.
 */
function webshareProxyUrl(): string | null {
  const user = process.env.WEBSHARE_PROXY_USERNAME;
  const pass = process.env.WEBSHARE_PROXY_PASSWORD;
  if (!user || !pass) return null;
  const host = process.env.WEBSHARE_PROXY_HOST || 'p.webshare.io';
  const port = process.env.WEBSHARE_PROXY_PORT || '80';
  const country = (process.env.WEBSHARE_PROXY_COUNTRY || '').trim().toLowerCase();
  const rotate = !['0', 'false', 'no', 'off'].includes(
    (process.env.WEBSHARE_PROXY_ROTATE || 'true').trim().toLowerCase(),
  );
  let u = user;
  if (country) u += `-${country}`;
  if (rotate) u += '-rotate';
  return `http://${u}:${pass}@${host}:${port}`;
}

export const config = {
  /**
   * When true the pipeline makes NO external requests and uses a deterministic
   * synthetic connector. Default true so the app works out-of-the-box on
   * Vercel Hobby (no scraping, no API keys). Set DEMO_MODE=0 to use live
   * connectors. A per-request `demo` flag can also override this.
   */
  demoMode: bool('DEMO_MODE', true),

  /** Per-source/per-number timeout (ms). Kept short to fit serverless limits. */
  timeoutMs: int('TIMEOUT_MS', 8000),

  /**
   * Max numbers processed concurrently in one request. Kept modest: firing many
   * air numbers at once trips CargoAI/RapidAPI's request-rate limit (429) and
   * makes results WORSE, not better. This also stays within the serverless
   * duration budget. Raise only if your data plan allows higher QPS.
   */
  concurrency: int('CONCURRENCY', 4),

  /**
   * Sea (Pier2Pier) is slower and primes cookies across requests, plus it can
   * throttle datacenter IPs. Give it a longer timeout and a couple of retries
   * (the connector reuses the cookie jar between attempts), to ride through
   * cookie-priming and transient anti-bot responses.
   */
  seaTimeoutMs: int('SEA_TIMEOUT_MS', 15000),
  seaRetries: int('SEA_RETRIES', 2),

  /**
   * CargoAI does a near-real-time pull and can return large payloads, so an
   * 8s timeout sometimes isn't enough (the call then falls through to a
   * fallback and shows SOURCE_UNAVAILABLE even though data exists). Give air
   * a longer dedicated timeout and a couple of retries for flaky pulls.
   */
  cargoaiTimeoutMs: int('CARGOAI_TIMEOUT_MS', 15000),
  cargoaiRetries: int('CARGOAI_RETRIES', 2),

  /**
   * Minimum gap (ms) between consecutive CargoAI/RapidAPI requests *within one
   * key lane*. Each key runs its own queue, so this spaces only that key's calls.
   * Higher = gentler on each key's per-second limit (at the cost of latency).
   */
  cargoaiMinGapMs: int('CARGOAI_MIN_GAP_MS', 1500),

  /** Retries for transient network errors (ТЗ §11). */
  retries: int('RETRIES', 1),

  /** Politeness delay between external calls (ms) — no aggressive scraping. */
  rateLimitDelayMs: int('RATE_LIMIT_DELAY_MS', 600),

  /** Optional CargoAI commercial API key for air cargo (ТЗ §5, §16). */
  cargoaiApiKey: process.env.CARGOAI_API_KEY || null,
  /** Explicit base URL override; if unset it is derived per access mode. */
  cargoaiBaseUrl: process.env.CARGOAI_BASE_URL || null,

  /**
   * Optional HTTP(S) proxy for CargoAI/RapidAPI requests only. Set this if you
   * suspect RapidAPI is filtering by the (shared) serverless egress IP — routing
   * through a proxy changes the source IP. Three ways to set it (first wins):
   *   1) CARGOAI_PROXY_URL = http://user:pass@host:port (full URL, any provider)
   *   2) Webshare convenience vars: WEBSHARE_PROXY_USERNAME / _PASSWORD
   *      (+ optional _HOST / _PORT / _COUNTRY / _ROTATE) — builds the backbone
   *      rotating URL automatically (fresh exit IP per request by default).
   *   3) the conventional HTTPS_PROXY / HTTP_PROXY.
   * NOTE: a proxy does NOT bypass the per-key rate/quota limit (the API key is
   * sent in the header regardless of IP).
   */
  cargoaiProxyUrl:
    process.env.CARGOAI_PROXY_URL ||
    webshareProxyUrl() ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    null,

  /**
   * RapidAPI access mode for CargoAI. CargoAI distributes its Track & Trace
   * API via RapidAPI, where auth uses x-rapidapi-key / x-rapidapi-host headers
   * instead of a direct Bearer token. If RAPIDAPI_KEY is set, the connector
   * switches to this mode automatically.
   */
  rapidapiKey: process.env.RAPIDAPI_KEY || null,
  /**
   * Optional 2nd RapidAPI key (a separate account = a separate quota). When the
   * primary key is exhausted/blocked (429 / quota), the connector retries the
   * same request with this key before giving up.
   */
  rapidapiKeyFallback:
    process.env.RAPIDAPI_KEY_FALLBACK || process.env.RAPID_API_KEY_FALLBACK || null,
  rapidapiHost:
    process.env.RAPIDAPI_HOST || 'air-cargo-co2-track-and-trace.p.rapidapi.com',

  /**
   * Optional Grok (xAI) key for AI-assisted parsing fallback (ТЗ §10.1).
   * The xAI API is OpenAI-compatible: POST {baseUrl}/chat/completions with a
   * Bearer token. Accepts XAI_API_KEY (official) or GROK_API_KEY (alias).
   * If unset, the pipeline transparently falls back to deterministic parsing.
   */
  grokApiKey: process.env.XAI_API_KEY || process.env.GROK_API_KEY || null,
  grokBaseUrl: process.env.XAI_BASE_URL || 'https://api.x.ai/v1',
  grokModel: process.env.GROK_MODEL || 'grok-4.3',

  /** track-trace.com endpoints (ТЗ §5, §16). */
  trackTraceAir: 'https://www.track-trace.com/aircargo',
  trackTraceContainer: 'https://www.track-trace.com/container',

  /** Pier2Pier free container tracking endpoint (ТЗ §5/§15, sea only). */
  pier2pierBaseUrl:
    process.env.PIER2PIER_BASE_URL || 'https://www.pier2pier.com/links/tracking2.php',

  port: int('PORT', 3001),
};

export type AppConfig = typeof config;
