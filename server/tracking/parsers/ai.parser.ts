import { Injectable } from '@nestjs/common';
import { config } from '../../config';
import { HeuristicParser } from './heuristic.parser';
import { NormalizerService } from '../normalizer/normalizer.service';
import { ShipmentType, TrackingEvent } from '../models';

/**
 * AI-assisted parser (ТЗ §10.1), powered by Grok (xAI).
 *
 * Where deterministic rules fail to make sense of a non-standard page, Grok
 * extracts events from semi-structured text. This is OPTIONAL and safe:
 *  - if no Grok key is set (XAI_API_KEY / GROK_API_KEY), it transparently
 *    falls back to the deterministic HeuristicParser;
 *  - Grok is instructed to use ONLY text actually present and to return null
 *    for anything missing — it must never invent statuses, dates or locations
 *    (ТЗ §10.1). Any AI output still flows through the deterministic
 *    Normalizer downstream, so the status vocabulary stays controlled.
 *
 * The xAI API is OpenAI-compatible, so this is a single fetch to
 * `${grokBaseUrl}/chat/completions` with a Bearer token. On any error or
 * timeout we fall back to heuristics — the AI never blocks a result.
 */
@Injectable()
export class AiParser {
  constructor(
    private readonly heuristic: HeuristicParser,
    private readonly normalizer: NormalizerService,
  ) {}

  get enabled(): boolean {
    return !!config.grokApiKey;
  }

  async parse(text: string, type: ShipmentType): Promise<TrackingEvent[]> {
    if (!this.enabled) {
      return this.heuristic.parseLines(text.split('\n'), type);
    }
    try {
      const events = await this.callGrok(text, type);
      // If Grok returned nothing usable, fall back rather than emit an empty set.
      if (!events.length) {
        return this.heuristic.parseLines(text.split('\n'), type);
      }
      return events;
    } catch {
      return this.heuristic.parseLines(text.split('\n'), type);
    }
  }

  /**
   * Calls Grok (xAI) and maps the structured reply to TrackingEvent[].
   * Returns [] on any problem so the caller falls back to deterministic parsing.
   */
  private async callGrok(text: string, type: ShipmentType): Promise<TrackingEvent[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);

    const system =
      'You extract shipment tracking events from raw text of a tracking page. ' +
      'Return ONLY a JSON object of the form {"events":[...]}, no prose, no ' +
      'markdown fences. Each event has: event_name (string|null), location ' +
      '(string|null), datetime (ISO 8601 string|null), is_actual (boolean|null, ' +
      'true if the event already happened, false if it is a future estimate), ' +
      'raw_text (the original line|null). Use ONLY information present in the ' +
      'input. If a field is unknown, use null. NEVER invent statuses, dates, ' +
      'locations or events. If there are no events, return {"events":[]}. ' +
      `The shipment type is "${type}".`;

    try {
      const res = await fetch(`${config.grokBaseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.grokApiKey}`,
        },
        body: JSON.stringify({
          model: config.grokModel,
          temperature: 0,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: text.slice(0, 12000) },
          ],
        }),
      });

      if (!res.ok) return [];

      const data: any = await res.json();
      const content: string = data?.choices?.[0]?.message?.content ?? '';
      return this.mapEvents(content, type);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Parses Grok's JSON reply defensively and maps it to TrackingEvent[]. */
  private mapEvents(content: string, type: ShipmentType): TrackingEvent[] {
    // Strip any accidental code fences before parsing.
    const cleaned = content.replace(/```json/gi, '').replace(/```/g, '').trim();
    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Last resort: pull the first {...} block out of the string.
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (!m) return [];
      try {
        parsed = JSON.parse(m[0]);
      } catch {
        return [];
      }
    }

    const arr: any[] = Array.isArray(parsed) ? parsed : parsed?.events ?? [];
    if (!Array.isArray(arr)) return [];

    const str = (v: unknown): string | null =>
      typeof v === 'string' && v.trim() ? v.trim() : null;

    return arr
      .map((e): TrackingEvent => {
        const datetime = str(e?.datetime);
        const rawText = str(e?.raw_text) ?? str(e?.event_name);
        return {
          event_code: null,
          event_name: str(e?.event_name),
          // The controlled status vocabulary (ТЗ §7) is assigned ONLY by the
          // deterministic NormalizerService — never by the model itself.
          normalized_status: this.normalizer.normalize(rawText, type),
          location: str(e?.location),
          datetime,
          raw_text: rawText,
          raw_datetime: str(e?.raw_datetime) ?? datetime,
          is_actual: typeof e?.is_actual === 'boolean' ? e.is_actual : null,
          // Timezone is not reliably derivable here; left unknown (ТЗ §11.1).
          timezone: null,
          timezone_confidence: 'unknown',
        };
      })
      // Drop fully-empty rows the model may have emitted.
      .filter((e) => e.event_name || e.location || e.datetime || e.raw_text);
  }
}
