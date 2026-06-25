import { Injectable } from '@nestjs/common';
import { NormalizerService } from '../normalizer/normalizer.service';
import { ShipmentType, TrackingEvent, TimezoneConfidence } from '../models';

/**
 * Deterministic parser that extracts tracking events from semi-structured
 * text lines (e.g. text scraped from a tracking page). It is intentionally
 * conservative: dates are only emitted when confidently parsed, and the
 * timezone is reported as `unknown` rather than invented (ТЗ §11.1).
 */
@Injectable()
export class HeuristicParser {
  constructor(private readonly normalizer: NormalizerService) {}

  parseLines(lines: string[], type: ShipmentType): TrackingEvent[] {
    const events: TrackingEvent[] = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const { iso, rawDate, tz, tzConfidence } = this.extractDate(line);
      const status = this.normalizer.normalize(line, type);
      if (status === 'unknown' && !iso) continue; // skip noise
      events.push({
        event_code: null,
        event_name: this.cleanName(line),
        normalized_status: status,
        location: this.extractLocation(line),
        datetime: iso,
        raw_text: line,
        raw_datetime: rawDate,
        is_actual: !/\b(estimated|expected|eta|etd|scheduled)\b/i.test(line),
        timezone: tz,
        timezone_confidence: tzConfidence,
      });
    }
    return events;
  }

  /** Best-effort ISO 8601 extraction. Returns null ISO when not confident. */
  private extractDate(line: string): {
    iso: string | null;
    rawDate: string | null;
    tz: string | null;
    tzConfidence: TimezoneConfidence;
  } {
    // 2026-06-05T18:45:00+08:00 or 2026-06-05 18:45
    const isoLike = line.match(
      /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{2}:?\d{2}|Z)?/,
    );
    if (isoLike) {
      const tzRaw = isoLike[7] ?? null;
      const hasTz = !!tzRaw;
      const d = new Date(isoLike[0].replace(' ', 'T'));
      if (!isNaN(d.getTime())) {
        return {
          iso: hasTz ? d.toISOString() : `${isoLike[1]}-${isoLike[2]}-${isoLike[3]}T${isoLike[4]}:${isoLike[5]}:${isoLike[6] ?? '00'}`,
          rawDate: isoLike[0],
          tz: hasTz ? (tzRaw === 'Z' ? '+00:00' : tzRaw) : null,
          tzConfidence: hasTz ? 'source_provided' : 'unknown',
        };
      }
    }
    // 05 Jun 2026 18:45 — date only, no timezone → do not invent tz
    const human = line.match(/(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
    if (human) {
      const d = new Date(`${human[1]} ${human[2]} ${human[3]} ${human[4] ?? '00'}:${human[5] ?? '00'} UTC`);
      if (!isNaN(d.getTime())) {
        return {
          iso: `${human[3]}-${this.month(human[2])}-${human[1].padStart(2, '0')}T${(human[4] ?? '00')}:${(human[5] ?? '00')}:00`,
          rawDate: human[0],
          tz: null,
          tzConfidence: 'unknown',
        };
      }
    }
    return { iso: null, rawDate: null, tz: null, tzConfidence: 'unknown' };
  }

  private month(m: string): string {
    const idx =
      ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(
        m.slice(0, 3).toLowerCase(),
      ) + 1;
    return String(idx || 1).padStart(2, '0');
  }

  /** Pull an airport/port code like HKG, WAW, DOH if present. */
  private extractLocation(line: string): string | null {
    const m = line.match(/\b([A-Z]{3,5})\b/g);
    if (!m) return null;
    const stop = new Set(['ETA', 'ETD', 'DEP', 'ARR', 'RCS', 'RCF', 'MAN', 'NFD', 'DLV', 'POD']);
    const cand = m.find((c) => !stop.has(c));
    return cand ?? null;
  }

  private cleanName(line: string): string {
    return line.replace(/\s+/g, ' ').slice(0, 120);
  }
}
