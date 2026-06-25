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
   * Minimum gap (ms) between consecutive CargoAI/RapidAPI requests. The connector
   * runs a small queue: each air call starts at least this long after the
   * previous one, so concurrent air numbers never hit RapidAPI's per-second rate
   * limit at once (429). 1500ms = under 1 req/sec, which the free tier tolerates;
   * raise further if you still see 429, lower if your plan allows higher QPS.
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
   * RapidAPI access mode for CargoAI. CargoAI distributes its Track & Trace
   * API via RapidAPI, where auth uses x-rapidapi-key / x-rapidapi-host headers
   * instead of a direct Bearer token. If RAPIDAPI_KEY is set, the connector
   * switches to this mode automatically.
   */
  rapidapiKey: process.env.RAPIDAPI_KEY || null,
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
