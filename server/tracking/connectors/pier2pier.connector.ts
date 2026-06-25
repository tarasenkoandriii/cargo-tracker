import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { config } from '../../config';
import {
  ErrorCode,
  emptyTrackResult,
  NormalizedStatus,
  ShipmentType,
  TrackingEvent,
  TrackResult,
} from '../models';
import {
  Connector,
  TrackContext,
  fetchWithTimeout,
  retry,
  TimeoutError,
} from './connector.interface';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

/**
 * Free sea-container tracking via Pier2Pier (ТЗ §5/§15).
 *
 * Pier2Pier serves a *shell* page; the actual moves table is generated as a
 * temporary HTML file and embedded via an <iframe>. So a single GET never
 * yields data — the connector mirrors the browser's 3-step flow over plain
 * HTTP (works on Vercel Hobby, no headless browser):
 *
 *  1) RESOLVE — GET tracking2.php?Type=CONT&ID=<id>&Company=P2P
 *     Establishes the session cookies (PHPSESSID, Pier2PierLOG) and reveals the
 *     operating line via an encoded `CarrierCode=XXXX` link in the markup.
 *  2) SHELL   — GET tracking2.php?CarrierCode=<code>&Type=CONT&ID=<id>
 *     Returns the shell whose <iframe src> points at the generated data file
 *     under /Temp_Files/Container_Tracking/Display/<n>.html (per-request).
 *  3) DATA    — GET that iframe URL → the real moves table → parse with cheerio.
 *
 * CAVEATS: Pier2Pier's robots.txt disallows automated access — use responsibly
 * and at low volume; datacenter IPs (Vercel) may be rate-limited/blocked, in
 * which case a structured SOURCE_UNAVAILABLE is returned (never throws, never
 * fabricates). The iframe filename is timestamp-like and ephemeral, so it is
 * always extracted dynamically — never hardcoded.
 */
@Injectable()
export class Pier2PierConnector implements Connector {
  readonly name = 'pier2pier.com';

  supports(type: ShipmentType): boolean {
    return type === ShipmentType.SEA;
  }

  async fetch(ctx: TrackContext): Promise<TrackResult> {
    const r = emptyTrackResult();
    r.source_name = this.name;
    const id = ctx.normalizedNumber;
    const base = config.pier2pierBaseUrl;
    const cookies: string[] = [];

    try {
      // ── 1) RESOLVE: prime cookies + find the CarrierCode. ──
      const resolveUrl = `${base}?Type=CONT&ID=${encodeURIComponent(id)}&Company=P2P`;
      r.url = resolveUrl;
      const resolveHtml = await retry(
        () => this.get(resolveUrl, cookies, base),
        config.retries,
        config.rateLimitDelayMs,
      );
      if (this.isAntiBot(resolveHtml)) return this.unavailable(r, ctx, 'anti_bot');

      const carrierCode = this.extractCarrierCode(resolveHtml);

      // ── 2) SHELL: page with the data iframe (use CarrierCode if found). ──
      const shellUrl = carrierCode
        ? `${base}?CarrierCode=${encodeURIComponent(carrierCode)}&Type=CONT&ID=${encodeURIComponent(id)}`
        : resolveUrl;
      const shellHtml =
        shellUrl === resolveUrl
          ? resolveHtml
          : await retry(
              () => this.get(shellUrl, cookies, resolveUrl),
              config.retries,
              config.rateLimitDelayMs,
            );

      const iframeUrl = this.extractIframeUrl(shellHtml);
      if (!iframeUrl) {
        ctx.logger.add('query_pier2pier', 'error', { reason: 'no_iframe' });
        r.error = {
          code: ErrorCode.PARSING_FAILED,
          message: 'Pier2Pier shell returned no data iframe (layout may have changed)',
          source: this.name,
        };
        return r;
      }

      // ── 3) DATA: the iframe HTML holds the real moves table. ──
      const dataHtml = await retry(
        () => this.get(iframeUrl, cookies, shellUrl),
        config.retries,
        config.rateLimitDelayMs,
      );

      ctx.logger.add('query_pier2pier', 'success', { carrierCode: carrierCode ?? null });
      return this.parse(dataHtml, r, carrierCode);
    } catch (err) {
      ctx.logger.add('query_pier2pier', 'error', {
        reason: err instanceof TimeoutError ? 'timeout' : String(err),
      });
      r.error = {
        code: err instanceof TimeoutError ? ErrorCode.TIMEOUT : ErrorCode.SOURCE_UNAVAILABLE,
        message:
          err instanceof TimeoutError
            ? 'pier2pier.com did not respond in time'
            : 'pier2pier.com is unreachable from this host (may be blocked from datacenter IPs)',
        source: this.name,
      };
      return r;
    }
  }

  /** GET with cookie jar handling and a Referer; collects Set-Cookie for reuse. */
  private async get(url: string, cookies: string[], referer: string): Promise<string> {
    const res = await fetchWithTimeout(
      url,
      {
        headers: {
          'user-agent': UA,
          accept: 'text/html,application/xhtml+xml',
          referer,
          ...(cookies.length ? { cookie: cookies.join('; ') } : {}),
        },
      },
      config.timeoutMs,
    );
    // Accumulate cookies (PHPSESSID, Pier2PierLOG, …) across the 3 steps.
    const setCookie =
      (res.headers as any).getSetCookie?.() ?? res.headers.get('set-cookie');
    for (const c of toCookieList(setCookie)) {
      const pair = c.split(';')[0].trim();
      if (pair && !cookies.includes(pair)) cookies.push(pair);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }

  private isAntiBot(html: string): boolean {
    return /captcha|are you a human|cf-challenge|recaptcha|just a moment/i.test(html);
  }

  private unavailable(r: TrackResult, ctx: TrackContext, reason: string): TrackResult {
    ctx.logger.add('query_pier2pier', 'error', { reason });
    r.error = {
      code: ErrorCode.SOURCE_UNAVAILABLE,
      message: 'Source presented an anti-bot challenge; automatic extraction not possible',
      source: this.name,
    };
    return r;
  }

  /** Pull the operating line's SCAC from an encoded `CarrierCode=XXXX` link. */
  private extractCarrierCode(html: string): string | null {
    // Matches both raw and URL-encoded forms (CarrierCode=CMDU / %3DCMDU).
    const m =
      html.match(/CarrierCode(?:=|%3D)([A-Z]{2,4})/i) ||
      decodeURIComponent(html).match(/CarrierCode=([A-Z]{2,4})/i);
    return m ? m[1].toUpperCase() : null;
  }

  /** Resolve the data <iframe src> to an absolute URL. */
  private extractIframeUrl(html: string): string | null {
    const m = html.match(/<iframe[^>]*\bsrc=['"]([^'"]+)['"]/i);
    if (!m) return null;
    let src = m[1].trim();
    if (src.startsWith('//')) src = `https:${src}`;
    else if (src.startsWith('/')) src = `https://www.pier2pier.com${src}`;
    // Collapse accidental double slashes after the host (Pier2Pier emits //Temp_Files).
    return src.replace(/([^:])\/\/+/g, '$1/');
  }

  /**
   * Parse the iframe HTML (a Kendo UI grid). Never fabricates data.
   *
   * Each move row has: td.date (span.calendar + span.time), a td whose
   * span.capsule holds the move name, td.location (city + div.terminal-name),
   * and td.vesselVoyage (two <a>: name + "(voyage)"). The grid nests a
   * master/detail copy, so rows are de-duplicated by date+status+location.
   * POL/POD/ETA come from the .timeline--item header.
   */
  private parse(html: string, r: TrackResult, carrierCode: string | null): TrackResult {
    const $ = cheerio.load(html);

    const events: TrackingEvent[] = [];
    const seen = new Set<string>();

    $('tr').each((_i, tr) => {
      const $tr = $(tr);
      const dateCell = $tr.find('td.date').first();
      const capsule = $tr.find('td .capsule, td.capsule').first().text().trim();
      if (!dateCell.length || !capsule) return;

      const calendar = dateCell.find('.calendar').text().trim(); // "Friday, 22-MAY-2026"
      const time = dateCell.find('.time').text().trim(); // "02:40 PM"
      const dateM = calendar.match(/(\d{1,2}-[A-Z]{3}-\d{4})/i);
      if (!dateM) return;
      const datetime = toIso(dateM[1], time || null);

      // Location: city span + terminal name (skip the inner terminal div text).
      const locCell = $tr.find('td.location').first();
      const city = locCell.find('> div > span').first().text().trim();
      const terminal = locCell.find('.terminal-name').first().text().trim();
      const location = [city, terminal].filter(Boolean).join(', ') || null;

      // Vessel (Voyage): join the anchor texts → "KUO LONG ( 0XSQ5S1MA)".
      const vessel = $tr
        .find('td.vesselVoyage a')
        .map((_j, a) => $(a).text().trim())
        .get()
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      const move = matchMove(capsule);
      const key = `${datetime}|${capsule.toUpperCase()}|${city}`;
      if (seen.has(key)) return;
      seen.add(key);

      // Row state: "coming" rows are future estimates (e.g. ETA arrival),
      // "done"/"current" are actual. Never treat an estimate as actual.
      const cls = ($tr.attr('class') || '').toLowerCase();
      const isActual = !/\bcoming\b/.test(cls);

      events.push({
        event_code: null,
        event_name: capsule,
        normalized_status: move.status,
        location,
        datetime,
        raw_text: capsule + (vessel ? ` · ${vessel}` : ''),
        raw_datetime: datetime,
        is_actual: isActual,
        timezone: null,
        timezone_confidence: 'unknown',
      });
    });

    if (events.length === 0) {
      r.error = {
        code: ErrorCode.PARSING_FAILED,
        message: 'Data page fetched but no container moves could be parsed',
        source: this.name,
      };
      return r;
    }

    events.sort((a, b) => ts(a.datetime) - ts(b.datetime));
    // Current status = latest ACTUAL move (ignore future "coming" estimates).
    const actual = events.filter((e) => e.is_actual && e.datetime);
    const last = actual.length ? actual[actual.length - 1] : events[events.length - 1];

    if (carrierCode) {
      r.carrier = {
        name: SCAC_NAMES[carrierCode] ?? carrierCode,
        code: carrierCode,
        source: 'pier2pier',
      };
    }

    // ── Header: POL / POD / ETA from the timeline. ──
    $('.timeline--item').each((_i, li) => {
      const $li = $(li);
      const cap = $li.find('.capsule').first().text().trim().toUpperCase();
      const place = $li.find('.timeline--item-description strong').first().text().trim();
      if (cap === 'POL' && place) r.origin = place;
      if (cap === 'POD' && place) r.destination = place;
    });
    if (!r.origin) r.origin = events[0].location;

    // ETA berth at POD: "Tue 11-AUG-2026" + "08:00 PM" inside .timeline--item-eta.
    const etaBlock = $('.timeline--item-eta').first().text().replace(/\s+/g, ' ');
    const etaM = etaBlock.match(/(\d{1,2}-[A-Z]{3}-\d{4})[^0-9]{0,10}(\d{1,2}:\d{2}\s*[AP]M)?/i);
    if (etaM) r.eta = toIso(etaM[1], etaM[2] ?? null);

    // Container type, e.g. "45G1 (40HC)" from the resume filter.
    const typeM = $('body').text().replace(/\s+/g, ' ').match(/\b(\d{2}[A-Z]\d)\b\s*\(([^)]+)\)/);
    if (typeM) r.container_milestones = { container_type: `${typeM[1]} (${typeM[2]})` };

    r.found = true;
    r.events = events;
    r.current_status = last.normalized_status;
    r.raw_status = last.raw_text;
    return r;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function toCookieList(setCookie: string[] | string | null | undefined): string[] {
  if (!setCookie) return [];
  if (Array.isArray(setCookie)) return setCookie;
  // Single header may pack multiple cookies; split on commas that precede `key=`.
  return setCookie.split(/,(?=\s*[A-Za-z0-9_\-]+=)/);
}

const MONTHS: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
};

/** "22-MAY-2026" + "02:40 PM" → "2026-05-22T14:40:00" (no tz; never invents). */
function toIso(dateStr: string, timeStr: string | null): string | null {
  const d = dateStr.match(/(\d{1,2})-([A-Z]{3})-(\d{4})/i);
  if (!d) return null;
  const mon = MONTHS[d[2].toUpperCase()];
  if (!mon) return null;
  let hh = '00';
  let mm = '00';
  if (timeStr) {
    const t = timeStr.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
    if (t) {
      let h = parseInt(t[1], 10) % 12;
      if (/pm/i.test(t[3])) h += 12;
      hh = String(h).padStart(2, '0');
      mm = t[2];
    }
  }
  return `${d[3]}-${mon}-${d[1].padStart(2, '0')}T${hh}:${mm}:00`;
}

function ts(iso: string | null): number {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Infinity;
}

const MOVE_RULES: Array<[RegExp, NormalizedStatus]> = [
  [/EMPTY\s+RETURN|EMPTY\s+RETURNED|EMPTY\s+IN/i, 'container_returned'],
  [/EMPTY\s+TO\s+SHIPPER|EMPTY\s+DISPATCH|EMPTY\s+PICK|EMPTY\s+OUT/i, 'container_picked_up'],
  [/READY\s+TO\s+BE\s+LOADED|GATE\s*IN|RECEIVED\s+AT|FULL\s+IN/i, 'in_origin_terminal'],
  [/LOADED\s+ON\s+BOARD|LOADED\s+ON\s+VESSEL|SHIPPED\s+ON\s+BOARD/i, 'in_origin_terminal'],
  [/VESSEL\s+DEPARTURE|DEPARTED|SAILED|DEPARTURE\s+FROM/i, 'departed'],
  [/TRANSSHIP|TRANSHIP|IN\s+TRANSIT|ON\s+BOARD\s+AT/i, 'in_transit'],
  [/DISCHARG.*TRANSHIP|DISCHARG.*TRANSSHIP/i, 'in_transit'],
  [/VESSEL\s+ARRIVAL|ARRIVED|DISCHARG|UNLOADED/i, 'arrived'],
  [/CUSTOMS|CLEARED/i, 'customs'],
  [/AVAILABLE\s+FOR\s+PICK|READY\s+FOR\s+PICK|FULL\s+OUT/i, 'ready_for_pickup'],
  [/GATE\s*OUT|DELIVERED|FULL\s+DELIVERY/i, 'delivered'],
  [/BOOKING|BOOKED/i, 'booked'],
];

function matchMove(rowText: string): { phrase: string; status: NormalizedStatus } {
  for (const [re, status] of MOVE_RULES) {
    const m = rowText.match(re);
    if (m) return { phrase: m[0].replace(/\s+/g, ' ').trim().toUpperCase(), status };
  }
  const cell = rowText
    .split('|')
    .map((c) => c.trim())
    .find(
      (c) =>
        c.length >= 3 &&
        c.length <= 40 &&
        !/\d{1,2}-[A-Z]{3}-\d{4}/i.test(c) &&
        !/[AP]M$/i.test(c) &&
        /[A-Za-z]/.test(c),
    );
  return { phrase: cell ?? 'move', status: 'unknown' };
}

/** Minimal SCAC → carrier name map for common lines (extend as needed). */
const SCAC_NAMES: Record<string, string> = {
  CMDU: 'CMA CGM',
  MAEU: 'Maersk',
  MSCU: 'MSC',
  HLCU: 'Hapag-Lloyd',
  COSU: 'COSCO',
  ONEY: 'Ocean Network Express',
  OOLU: 'OOCL',
  EGLV: 'Evergreen',
  YMLU: 'Yang Ming',
  HMMU: 'HMM',
  ANNU: 'ANL',
  APLU: 'APL',
  ZIMU: 'ZIM',
};
