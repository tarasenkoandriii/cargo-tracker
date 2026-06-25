import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { config } from '../../config';
import {
  ErrorCode,
  emptyTrackResult,
  ShipmentType,
  TrackResult,
} from '../models';
import {
  Connector,
  TrackContext,
  fetchWithTimeout,
  retry,
  TimeoutError,
} from './connector.interface';
import { HeuristicParser } from '../parsers/heuristic.parser';
import { AiParser } from '../parsers/ai.parser';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

/**
 * Connector for track-trace.com (ТЗ §5, primary source).
 *
 * IMPORTANT (Vercel Hobby): serverless functions cannot run a headless
 * browser, so this uses plain HTTP + cheerio. track-trace.com renders results
 * client-side and is anti-bot protected, so an HTTP-only fetch will usually be
 * unable to read the rendered table. In that case the connector returns a
 * STRUCTURED error (SOURCE_UNAVAILABLE / CAPTCHA_REQUIRED / PARSING_FAILED)
 * instead of throwing — exactly as required by ТЗ §5/§9. It never bypasses
 * CAPTCHA or logins.
 *
 * To make this connector return live data, run it in an environment that
 * allows browser automation (e.g. a long-running Node host with Playwright)
 * and swap the `download()` method for a rendered-page fetch — the parsing
 * below stays the same.
 */
@Injectable()
export class TrackTraceConnector implements Connector {
  readonly name = 'track-trace.com';

  constructor(
    private readonly heuristic: HeuristicParser,
    private readonly ai: AiParser,
  ) {}

  supports(type: ShipmentType): boolean {
    return type === ShipmentType.AIR || type === ShipmentType.SEA;
  }

  async fetch(ctx: TrackContext): Promise<TrackResult> {
    const url =
      ctx.type === ShipmentType.SEA ? config.trackTraceContainer : config.trackTraceAir;
    const r = emptyTrackResult();
    r.source_name = this.name;
    r.url = url;

    let html: string;
    try {
      html = await retry(
        () => this.download(url, ctx.normalizedNumber),
        config.retries,
        config.rateLimitDelayMs,
      );
    } catch (err) {
      ctx.logger.add('query_track_trace', 'error', {
        url,
        reason: err instanceof TimeoutError ? 'timeout' : String(err),
      });
      r.error = {
        code: err instanceof TimeoutError ? ErrorCode.TIMEOUT : ErrorCode.SOURCE_UNAVAILABLE,
        message:
          err instanceof TimeoutError
            ? 'track-trace.com did not respond in time'
            : 'track-trace.com is unreachable from this host',
        source: this.name,
      };
      return r;
    }

    // Detect anti-bot / CAPTCHA / login walls and return structured errors.
    const lower = html.toLowerCase();
    if (/captcha|are you a human|cf-challenge|recaptcha/.test(lower)) {
      ctx.logger.add('query_track_trace', 'error', { url, reason: 'captcha' });
      r.error = {
        code: ErrorCode.CAPTCHA_REQUIRED,
        message: 'Source requires CAPTCHA; automatic extraction is not possible',
        source: this.name,
      };
      return r;
    }

    ctx.logger.add('query_track_trace', 'success', { url });

    // Attempt to read a rendered results region. On a JS-only shell this yields
    // nothing → PARSING_FAILED (honest), rather than fabricated data.
    const text = this.extractText(html);
    const events = await this.ai.parse(text, ctx.type);
    if (events.length === 0) {
      ctx.logger.add('parse_events', 'error', { events_count: 0 });
      r.error = {
        code: ErrorCode.PARSING_FAILED,
        message:
          'Page fetched but no tracking rows could be parsed (likely rendered ' +
          'client-side; a browser-capable host is required for this source).',
        source: this.name,
      };
      return r;
    }

    ctx.logger.add('parse_events', 'success', { events_count: events.length });
    const last = events[events.length - 1];
    r.found = true;
    r.events = events;
    r.current_status = last.normalized_status;
    r.raw_status = last.raw_text;
    return r;
  }

  private async download(url: string, number: string): Promise<string> {
    // GET the source with the number as a query hint. Real endpoints differ
    // per source; this is the single place to adapt when wiring a live source.
    const target = `${url}?number=${encodeURIComponent(number)}`;
    const res = await fetchWithTimeout(
      target,
      { headers: { 'user-agent': UA, accept: 'text/html' } },
      config.timeoutMs,
    );
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res.text();
  }

  private extractText(html: string): string {
    const $ = cheerio.load(html);
    // Prefer a results container if present; otherwise fall back to body text.
    const scope = $('#results, .tracking-results, table').first();
    const node = scope.length ? scope : $('body');
    return node
      .text()
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join('\n');
  }
}
