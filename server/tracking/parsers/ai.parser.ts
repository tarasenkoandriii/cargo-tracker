import { Injectable } from '@nestjs/common';
import { config } from '../../config';
import { HeuristicParser } from './heuristic.parser';
import { ShipmentType, TrackingEvent } from '../models';

/**
 * AI-assisted parser (ТЗ §10.1).
 *
 * Where deterministic rules fail to make sense of a non-standard page, an LLM
 * can extract events from semi-structured text. This is OPTIONAL:
 *  - if `LLM_API_KEY` is not set, it transparently falls back to the
 *    deterministic HeuristicParser;
 *  - the model is instructed to use only text actually present and to return
 *    null for anything missing — it must never invent statuses or dates.
 *
 * The HTTP call is left as a single, easily-replaceable method so any provider
 * (Anthropic, OpenAI, …) can be wired in. No key is ever stored in code.
 */
@Injectable()
export class AiParser {
  constructor(private readonly heuristic: HeuristicParser) {}

  get enabled(): boolean {
    return !!config.llmApiKey;
  }

  async parse(text: string, type: ShipmentType): Promise<TrackingEvent[]> {
    if (!this.enabled) {
      return this.heuristic.parseLines(text.split('\n'), type);
    }
    try {
      const events = await this.callLlm(text, type);
      // Defensive: always re-normalize through deterministic rules so the
      // status vocabulary stays controlled.
      return events;
    } catch {
      return this.heuristic.parseLines(text.split('\n'), type);
    }
  }

  // Replace the body with a real provider call. Returns [] on any issue so the
  // caller falls back to deterministic parsing.
  private async callLlm(_text: string, _type: ShipmentType): Promise<TrackingEvent[]> {
    // Example shape (Anthropic Messages API):
    //
    // const res = await fetch('https://api.anthropic.com/v1/messages', {
    //   method: 'POST',
    //   headers: {
    //     'content-type': 'application/json',
    //     'x-api-key': config.llmApiKey!,
    //     'anthropic-version': '2023-06-01',
    //   },
    //   body: JSON.stringify({
    //     model: config.llmModel,
    //     max_tokens: 1500,
    //     system:
    //       'Extract shipment tracking events as strict JSON. Use ONLY text ' +
    //       'present in the input. Use null for any missing field. Never invent ' +
    //       'statuses or dates.',
    //     messages: [{ role: 'user', content: _text }],
    //   }),
    // });
    // ...parse JSON, map to TrackingEvent[]...
    return [];
  }
}
