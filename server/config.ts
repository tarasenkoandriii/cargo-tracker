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
  timeoutMs: int('TIMEOUT_MS', 9000),

  /** Retries for transient network errors (ТЗ §11). */
  retries: int('RETRIES', 1),

  /** Politeness delay between external calls (ms) — no aggressive scraping. */
  rateLimitDelayMs: int('RATE_LIMIT_DELAY_MS', 600),

  /** Optional CargoAI commercial API key for air cargo (ТЗ §5, §16). */
  cargoaiApiKey: process.env.CARGOAI_API_KEY || null,
  cargoaiBaseUrl: process.env.CARGOAI_BASE_URL || 'https://api.cargoai.co',

  /** Optional LLM key for AI-assisted parsing fallback (ТЗ §10.1). */
  llmApiKey: process.env.LLM_API_KEY || null,
  llmModel: process.env.LLM_MODEL || 'claude-sonnet-4-6',

  /** track-trace.com endpoints (ТЗ §5, §16). */
  trackTraceAir: 'https://www.track-trace.com/aircargo',
  trackTraceContainer: 'https://www.track-trace.com/container',

  port: int('PORT', 3001),
};

export type AppConfig = typeof config;
