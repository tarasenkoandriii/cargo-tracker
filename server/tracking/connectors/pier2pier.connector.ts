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
  sleep,
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
    const cookies: string[] = [];

    // Retry the whole flow, REUSING the cookie jar between attempts. Pier2Pier
    // primes cookies (PHPSESSID, then Pier2PierLOG) across requests, so a 2nd/3rd
    // attempt with the accumulated jar is what actually returns data — mirroring
    // a real browser. Also rides through transient IP-based throttling.
    const attempts = 1 + Math.max(0, config.seaRetries);
    let result: TrackResult = r;
    for (let i = 0; i < attempts; i++) {
      result = await this.attempt(ctx, emptyTrackResult(), id, cookies);
      result.source_name = this.name;
      if (result.found) return result;
      const code = result.error?.code;
      // Retry the cookie-priming / transient cases (these fail fast, so retrying
      // is cheap). Do NOT retry TIMEOUT — a slow Pier2Pier response rarely
      // recovers and retrying it risks the serverless duration budget.
      const retryable =
        code === ErrorCode.SOURCE_UNAVAILABLE || code === ErrorCode.PARSING_FAILED;
      if (i < attempts - 1 && retryable) {
        ctx.logger.add('query_pier2pier', 'info', { event: 'retry', attempt: i + 1, code });
        await sleep(config.rateLimitDelayMs + 400 * i);
        continue;
      }
      return result;
    }
    return result;
  }

  /** One full resolve → shell → data pass, sharing the caller's cookie jar. */
  private async attempt(
    ctx: TrackContext,
    r: TrackResult,
    id: string,
    cookies: string[],
  ): Promise<TrackResult> {
    r.source_name = this.name;
    const base = config.pier2pierBaseUrl;

    try {
      // ── 1) RESOLVE: prime cookies + find the CarrierCode. ──
      const resolveUrl = `${base}?Type=CONT&ID=${encodeURIComponent(id)}&Company=P2P`;
      r.url = resolveUrl;
      const resolveHtml = await this.get(resolveUrl, cookies, base);
      if (this.isAntiBot(resolveHtml)) return this.unavailable(r, ctx, 'anti_bot');
      // Cookie-priming wall ("enable cookies"): cookies are now set; signal a
      // retry so the next attempt (with the jar) gets real content.
      if (this.isCookieWall(resolveHtml)) return this.unavailable(r, ctx, 'cookie_wall');

      const carrierCode = this.extractCarrierCode(resolveHtml);

      // Some lines (e.g. MSC) render the data iframe directly on the Company=P2P
      // page, so try the resolve response first. Others (e.g. CMA CGM) only
      // expose a CarrierCode link and need the explicit shell step.
      let iframeUrl = this.extractIframeUrl(resolveHtml);
      let shellUrl = resolveUrl;
      if (!iframeUrl && carrierCode) {
        // ── 2) SHELL: fetch the carrier-specific page that holds the iframe. ──
        shellUrl = `${base}?CarrierCode=${encodeURIComponent(carrierCode)}&Type=CONT&ID=${encodeURIComponent(id)}`;
        const shellHtml = await this.get(shellUrl, cookies, resolveUrl);
        iframeUrl = this.extractIframeUrl(shellHtml);
      }

      if (!iframeUrl) {
        ctx.logger.add('query_pier2pier', 'error', { reason: 'no_iframe' });
        r.error = {
          code: ErrorCode.PARSING_FAILED,
          message: 'Pier2Pier shell returned no data iframe (cookie-priming or layout change)',
          source: this.name,
        };
        return r;
      }

      // ── 3) DATA: the iframe HTML holds the real moves table. ──
      const dataHtml = await this.get(iframeUrl, cookies, shellUrl);

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

  /** GET with cookie jar + browser-like headers and the sea timeout. */
  private async get(url: string, cookies: string[], referer: string): Promise<string> {
    const res = await fetchWithTimeout(
      url,
      {
        headers: {
          'user-agent': UA,
          accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
          'upgrade-insecure-requests': '1',
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-site': cookies.length ? 'same-origin' : 'none',
          'sec-fetch-user': '?1',
          referer,
          ...(cookies.length ? { cookie: cookies.join('; ') } : {}),
        },
      },
      config.seaTimeoutMs,
    );
    // Accumulate cookies (PHPSESSID, Pier2PierLOG, …) across steps and attempts.
    const setCookie =
      (res.headers as any).getSetCookie?.() ?? res.headers.get('set-cookie');
    for (const c of toCookieList(setCookie)) {
      const pair = c.split(';')[0].trim();
      const name = pair.split('=')[0];
      // Replace any prior value for the same cookie name; else append.
      const idx = cookies.findIndex((x) => x.split('=')[0] === name);
      if (pair && idx >= 0) cookies[idx] = pair;
      else if (pair) cookies.push(pair);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }

  private isAntiBot(html: string): boolean {
    return /captcha|are you a human|cf-challenge|recaptcha|just a moment/i.test(html);
  }

  /** The "In order to view this page you need to enable cookies" priming wall. */
  private isCookieWall(html: string): boolean {
    return /enable cookies/i.test(html) && !/<iframe/i.test(html);
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
   * Parse the iframe HTML. Pier2Pier embeds carrier-specific layouts, so we
   * detect the format and dispatch. Never fabricates data.
   */
  private parse(html: string, r: TrackResult, carrierCode: string | null): TrackResult {
    if (/msc-flow-tracking/i.test(html)) return this.parseMsc(html, r);
    if (/tracing_by_container|hl-tbl/i.test(html)) return this.parseHapag(html, r);
    if (/transport-plan__list|data-test="transport-plan"/i.test(html)) return this.parseMaersk(html, r);
    return this.parseKendo(html, r, carrierCode);
  }

  /**
   * Parse the Kendo UI grid layout (e.g. CMA CGM). Never fabricates data.
   *
   * Each move row has: td.date (span.calendar + span.time), a td whose
   * span.capsule holds the move name, td.location (city + div.terminal-name),
   * and td.vesselVoyage (two <a>: name + "(voyage)"). The grid nests a
   * master/detail copy, so rows are de-duplicated by date+status+location.
   * POL/POD/ETA come from the .timeline--item header.
   */
  private parseKendo(html: string, r: TrackResult, carrierCode: string | null): TrackResult {
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

  /**
   * Parse the MSC layout (div.msc-flow-tracking). Never fabricates data.
   *
   * Each move is a `.msc-flow-tracking__step` with cells:
   *  --two  date (DD/MM/YYYY)   --three location   --four description
   *  --five Empty/Laden/Vessel/Voyage   --six terminal
   * Header POL/POD come from `.msc-flow-tracking__details-*` pairs. The
   * "Estimated Time of Arrival" step is a future ETA (not an actual move).
   */
  private parseMsc(html: string, r: TrackResult): TrackResult {
    const $ = cheerio.load(html);

    const val = (el: any, sel: string) =>
      (sel ? $(el).find(`${sel} .data-value`) : $(el).find('.data-value'))
        .first()
        .text()
        .replace(/\s+/g, ' ')
        .trim();

    const events: TrackingEvent[] = [];
    const seen = new Set<string>();

    $('.msc-flow-tracking__step').each((_i, step) => {
      const $s = $(step);
      const dateStr = val($s, '.msc-flow-tracking__cell--two');
      const dateM = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (!dateM) return; // header / non-data rows

      const location = val($s, '.msc-flow-tracking__cell--three') || null;
      const desc = val($s, '.msc-flow-tracking__cell--four');
      const vessel = val($s, '.msc-flow-tracking__cell--five');
      const terminal = val($s, '.msc-flow-tracking__cell--six');
      if (!desc) return;

      const datetime = `${dateM[3]}-${dateM[2]}-${dateM[1]}T00:00:00`;
      const isEstimate = /estimat|^eta\b|expected/i.test(desc);
      const move = matchMove(desc);

      const key = `${datetime}|${desc.toUpperCase()}|${location}`;
      if (seen.has(key)) return;
      seen.add(key);

      const loc = [location, terminal].filter(Boolean).join(', ') || location;
      const vesselTxt = vessel && !/^laden$|^empty$/i.test(vessel) ? ` · ${vessel}` : '';

      events.push({
        event_code: null,
        event_name: desc,
        normalized_status: move.status,
        location: loc,
        datetime,
        raw_text: desc + vesselTxt,
        raw_datetime: datetime,
        is_actual: !isEstimate,
        timezone: null,
        timezone_confidence: 'unknown',
      });
    });

    if (events.length === 0) {
      r.error = {
        code: ErrorCode.PARSING_FAILED,
        message: 'MSC data page fetched but no moves could be parsed',
        source: this.name,
      };
      return r;
    }

    events.sort((a, b) => ts(a.datetime) - ts(b.datetime));
    const actual = events.filter((e) => e.is_actual && e.datetime);
    const last = actual.length ? actual[actual.length - 1] : events[events.length - 1];

    // Header details (label/value pairs).
    const details: Record<string, string> = {};
    $('.msc-flow-tracking__details-heading').each((_i, h) => {
      const label = $(h).text().replace(/\s+/g, ' ').trim();
      const value = $(h)
        .nextAll('.msc-flow-tracking__details-value')
        .first()
        .text()
        .replace(/\s+/g, ' ')
        .trim();
      if (label) details[label.toUpperCase()] = value;
    });
    r.origin = details['PORT OF LOAD'] || details['SHIPPED FROM'] || events[0].location;
    r.destination = details['PORT OF DISCHARGE'] || details['SHIPPED TO'] || null;

    // ETA from the explicit "Estimated Time of Arrival" step (a future row).
    const etaStep = events.find((e) => /estimat.*arriv/i.test(e.event_name ?? ''));
    if (etaStep) r.eta = etaStep.datetime;

    // Container type from the container card (x-text="container.ContainerType").
    const typeM = $('[x-text="container.ContainerType"]').first().text().trim();
    if (typeM) r.container_milestones = { container_type: typeM };

    // Pier2Pier shows MSC for this layout.
    r.carrier = { name: 'MSC', code: 'MSCU', source: 'pier2pier' };

    r.found = true;
    r.events = events;
    r.current_status = last.normalized_status;
    r.raw_status = last.raw_text;
    return r;
  }

  /**
   * Parse the Hapag-Lloyd layout (Pier2Pier embeds Hapag's own tracing page).
   * The moves table is `table.hl-tbl` with columns Status | Place of Activity |
   * Date | Time | Transport | Voyage No. Bold rows (td.strong) are actual data;
   * plain rows are planned movements. Never fabricates data.
   */
  private parseHapag(html: string, r: TrackResult): TrackResult {
    const $ = cheerio.load(html);
    const events: TrackingEvent[] = [];
    const seen = new Set<string>();

    $('table.hl-tbl tbody tr, table.hal-table tbody tr').each((_i, tr) => {
      const tds = $(tr).find('> td');
      if (tds.length < 4) return;
      const cell = (i: number) =>
        ($(tds[i]).find('.nonEditableContent').first().text() || $(tds[i]).text())
          .replace(/\s+/g, ' ')
          .trim();
      const status = cell(0);
      const place = cell(1);
      const date = cell(2);
      const time = cell(3);
      const transport = tds.length > 4 ? cell(4) : '';
      const voyage = tds.length > 5 ? cell(5) : '';

      const dM = date.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (!dM || !status) return;
      const tM = time.match(/(\d{1,2}):(\d{2})/);
      const datetime = `${dM[1]}-${dM[2]}-${dM[3]}T${tM ? `${tM[1].padStart(2, '0')}:${tM[2]}` : '00:00'}:00`;

      // Bold rows (td.strong) are actual; plain rows are planned/estimated.
      const isActual = $(tds[0]).hasClass('strong');
      const key = `${datetime}|${status.toUpperCase()}|${place}`;
      if (seen.has(key)) return;
      seen.add(key);

      const vessel =
        transport && !/^truck$/i.test(transport)
          ? transport + (voyage ? ` (${voyage})` : '')
          : '';

      events.push({
        event_code: null,
        event_name: status,
        normalized_status: hapagMove(status),
        location: place || null,
        datetime,
        raw_text: status + (vessel ? ` · ${vessel}` : ''),
        raw_datetime: datetime,
        is_actual: isActual,
        timezone: null,
        timezone_confidence: 'unknown',
      });
    });

    if (events.length === 0) {
      r.error = {
        code: ErrorCode.PARSING_FAILED,
        message: 'Hapag-Lloyd data page fetched but no moves could be parsed',
        source: this.name,
      };
      return r;
    }

    events.sort((a, b) => ts(a.datetime) - ts(b.datetime));
    const actual = events.filter((e) => e.is_actual && e.datetime);
    const planned = events.filter((e) => !e.is_actual);
    const last = actual.length ? actual[actual.length - 1] : events[events.length - 1];

    r.origin = events[0].location;
    r.destination = events[events.length - 1].location;

    // ETA = last (planned) vessel arrival in the chain.
    const lastArrival = [...events].reverse().find((e) => /arriv/i.test(e.event_name ?? ''));
    if (lastArrival) r.eta = lastArrival.datetime;

    // Container type from the "Type"/"Description" labels, e.g. "45GP (HIGH CUBE CONT.)".
    const labelled = (name: string): string => {
      let out = '';
      $('label').each((_i, l) => {
        if (out) return;
        if (new RegExp(`^${name}$`, 'i').test($(l).text().trim())) {
          out = $(l).closest('td').nextAll('td').find('.nonEditableContent').first().text().trim();
        }
      });
      return out;
    };
    const ctype = labelled('Type');
    const cdesc = labelled('Description');
    if (ctype) r.container_milestones = { container_type: cdesc ? `${ctype} (${cdesc})` : ctype };

    r.carrier = { name: 'Hapag-Lloyd', code: 'HLCU', source: 'pier2pier' };

    let current = last.normalized_status;
    // A discharge at a transhipment port (not the final destination) with later
    // planned moves means the box is still in transit, not "arrived".
    if (
      current === 'arrived' &&
      planned.length > 0 &&
      r.destination &&
      last.location &&
      last.location !== r.destination
    ) {
      current = 'in_transit';
    }

    r.found = true;
    r.events = events;
    r.current_status = current;
    r.raw_status = last.raw_text;
    return r;
  }

  /**
   * Parse the Maersk layout (Pier2Pier embeds Maersk's own tracking page,
   * built with mc- web components). Milestones live in `ul.transport-plan__list`
   * as `li.transport-plan__list__item`; each has a label, a `milestone-date`,
   * and an optional location (which carries forward). Never fabricates data.
   */
  private parseMaersk(html: string, r: TrackResult): TrackResult {
    const $ = cheerio.load(html);
    const events: TrackingEvent[] = [];
    const seen = new Set<string>();
    let lastLoc: string | null = null;

    $('.transport-plan__list__item').each((_i, li) => {
      const $li = $(li);
      const loc = $li.find('[data-test="location-name"] strong').first().text().trim();
      if (loc) lastLoc = loc;

      const mEl = $li.find('[data-test="milestone"]').first();
      const dateStr = mEl.find('[data-test="milestone-date"]').first().text().trim();
      const label = mEl
        .clone()
        .find('[data-test="milestone-date"]')
        .remove()
        .end()
        .text()
        .replace(/\s+/g, ' ')
        .trim();
      const datetime = maerskDate(dateStr);
      if (!label || !datetime) return;

      // Items marked complete are actual; incomplete/estimated are planned.
      const dt = ($li.attr('data-test') || '').toLowerCase();
      const isActual = !/incomplete|estimat/.test(dt);

      const key = `${datetime}|${label.toUpperCase()}|${lastLoc}`;
      if (seen.has(key)) return;
      seen.add(key);

      events.push({
        event_code: null,
        event_name: label,
        normalized_status: maerskMove(label),
        location: lastLoc,
        datetime,
        raw_text: label,
        raw_datetime: datetime,
        is_actual: isActual,
        timezone: null,
        timezone_confidence: 'unknown',
      });
    });

    if (events.length === 0) {
      r.error = {
        code: ErrorCode.PARSING_FAILED,
        message: 'Maersk data page fetched but no milestones could be parsed',
        source: this.name,
      };
      return r;
    }

    events.sort((a, b) => ts(a.datetime) - ts(b.datetime));
    const actual = events.filter((e) => e.is_actual && e.datetime);
    const last = actual.length ? actual[actual.length - 1] : events[events.length - 1];

    r.origin =
      $('[data-test="track-from-value"]').first().text().trim() || events[0].location;
    r.destination =
      $('[data-test="track-to-value"]').first().text().trim() ||
      events[events.length - 1].location;

    // ETA = arrival at the destination port (or the last arrival in the chain).
    const arrivals = events.filter((e) => /arrival/i.test(e.event_name ?? ''));
    const podArrival =
      arrivals.reverse().find((e) => e.location === r.destination) ?? arrivals[0];
    if (podArrival) r.eta = podArrival.datetime;

    // Container type, e.g. "MSKU... | 40' Dry High" → "40' Dry High".
    const details = $('[data-test="container-details"]').first().text();
    const typeM = details.split('|').pop()?.trim();
    if (typeM && !/^[A-Z]{4}\d{7}$/.test(typeM)) {
      r.container_milestones = { container_type: typeM };
    }

    r.carrier = { name: 'Maersk', code: 'MAEU', source: 'pier2pier' };

    let current = last.normalized_status;
    if (
      current === 'arrived' &&
      events.some((e) => !e.is_actual) &&
      r.destination &&
      last.location &&
      last.location !== r.destination
    ) {
      current = 'in_transit';
    }

    r.found = true;
    r.events = events;
    r.current_status = current;
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
  [/ESTIMATED.*ARRIVAL|EXPECTED.*ARRIVAL/i, 'arrived'], // future ETA row (marked not-actual)
  [/EMPTY\s+RETURN|EMPTY\s+RETURNED|EMPTY\s+IN/i, 'container_returned'],
  [/EMPTY\s+TO\s+SHIPPER|EMPTY\s+DISPATCH|EMPTY\s+PICK|EMPTY\s+OUT/i, 'container_picked_up'],
  [/READY\s+TO\s+BE\s+LOADED|GATE\s*IN|RECEIVED\s+AT|EXPORT\s+RECEIVED|FULL\s+IN/i, 'in_origin_terminal'],
  [/LOADED\s+ON\s+BOARD|LOADED\s+ON\s+VESSEL|SHIPPED\s+ON\s+BOARD|EXPORT\s+LOADED/i, 'in_origin_terminal'],
  [/VESSEL\s+DEPARTURE|VESSEL\s+DEPARTED|DEPARTED|SAILED|DEPARTURE\s+FROM/i, 'departed'],
  [/TRANSSHIP|TRANSHIP|IN\s+TRANSIT|ON\s+BOARD\s+AT/i, 'in_transit'],
  [/DISCHARG.*TRANSHIP|DISCHARG.*TRANSSHIP/i, 'in_transit'],
  [/VESSEL\s+ARRIVAL|VESSEL\s+ARRIVED|ARRIVED|IMPORT\s+DISCHARG|DISCHARG|UNLOADED/i, 'arrived'],
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

/**
 * Map Hapag-Lloyd milestone names to the normalized vocabulary (ТЗ §7).
 * Hapag uses its own wording (e.g. "Gate out empty", "Arrival in"), so it needs
 * a dedicated table rather than the generic MOVE_RULES.
 */
const HAPAG_RULES: Array<[RegExp, NormalizedStatus]> = [
  [/GATE\s+OUT\s+EMPTY|EMPTY\s+TO\s+SHIPPER|EMPTY\s+DELIVERY|EMPTY\s+DISPATCH/i, 'container_picked_up'],
  [/EMPTY\s+RETURN/i, 'container_returned'],
  [/ARRIVAL\s+IN|GATE\s+IN|RECEIVED/i, 'in_origin_terminal'],
  [/LOADED/i, 'in_origin_terminal'],
  [/VESSEL\s+DEPART|DEPARTED|DEPARTURE/i, 'departed'],
  [/TRANSSHIP|TRANSHIP/i, 'in_transit'],
  [/DISCHARG/i, 'arrived'],
  [/VESSEL\s+ARRIV|ARRIVED|ARRIVAL/i, 'arrived'],
  [/CUSTOMS|CLEARED/i, 'customs'],
  [/AVAILABLE\s+FOR\s+DELIVERY|READY\s+FOR/i, 'ready_for_pickup'],
  [/GATE\s+OUT\s+FULL|DELIVERED/i, 'delivered'],
];

function hapagMove(status: string): NormalizedStatus {
  for (const [re, s] of HAPAG_RULES) if (re.test(status)) return s;
  return 'unknown';
}

/** Maersk milestone vocabulary → normalized status (ТЗ §7). */
const MAERSK_RULES: Array<[RegExp, NormalizedStatus]> = [
  [/EMPTY\s+CONTAINER\s+RETURN|EMPTY\s+RETURN/i, 'container_returned'],
  [/GATE\s+OUT\s+EMPTY/i, 'container_picked_up'],
  [/GATE\s+IN|RECEIVED/i, 'in_origin_terminal'],
  [/LOAD\s+ON|LOADED/i, 'in_origin_terminal'],
  [/VESSEL\s+DEPARTURE|DEPARTED/i, 'departed'],
  [/TRANSSHIP|TRANSHIP/i, 'in_transit'],
  [/VESSEL\s+ARRIVAL|ARRIVED/i, 'arrived'],
  [/DISCHARGE|DISCHARGED/i, 'arrived'],
  [/GATE\s+OUT\s+FOR\s+DELIVERY|OUT\s+FOR\s+DELIVERY|DELIVERED/i, 'delivered'],
  [/CUSTOMS|CLEARED/i, 'customs'],
  [/AVAILABLE\s+FOR/i, 'ready_for_pickup'],
];

function maerskMove(label: string): NormalizedStatus {
  for (const [re, s] of MAERSK_RULES) if (re.test(label)) return s;
  return 'unknown';
}

/** "17 Mar 2026 18:41" → "2026-03-17T18:41:00" (no tz). */
function maerskDate(s: string): string | null {
  const m = s.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const mon = MONTHS[m[2].toUpperCase()];
  if (!mon) return null;
  const hh = m[4] ? m[4].padStart(2, '0') : '00';
  const mm = m[5] ?? '00';
  return `${m[3]}-${mon}-${m[1].padStart(2, '0')}T${hh}:${mm}:00`;
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
