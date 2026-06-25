import { Injectable } from '@nestjs/common';
import { NormalizedStatus, ShipmentType } from '../models';

/**
 * Deterministic raw → normalized status mapping (ТЗ §6.2, §6.3, §7).
 *
 * Rules are ordered keyword/regex matchers. The raw text is always preserved
 * separately (raw_status / raw_text) so no information is lost. If no rule
 * matches, the result is `unknown` and the pipeline may invoke the optional
 * AI parser to classify it (ТЗ §10.1) — the AI never invents new statuses.
 */
type Rule = { test: RegExp; status: NormalizedStatus };

const COMMON_RULES: Rule[] = [
  { test: /\b(delivered|delivery complete|pod|proof of delivery|dlv)\b/i, status: 'delivered' },
  { test: /\b(ready for (pick.?up|collection)|available for pick.?up|nfd|notified)\b/i, status: 'ready_for_pickup' },
  { test: /\b(customs|cleared|clearance|held by customs)\b/i, status: 'customs' },
  { test: /\b(arriv|rcf|recovered from flight|discharg|unload)\b/i, status: 'arrived' },
  { test: /\b(in transit|transit|transfer|man|on board|onboard|sailing|en route)\b/i, status: 'in_transit' },
  { test: /\b(depart|dep|gate out|sailed|vessel departure|loaded on vessel)\b/i, status: 'departed' },
  { test: /\b(received|rcs|accepted|cargo received|gate in)\b/i, status: 'received' },
  { test: /\b(booked|booking confirmed)\b/i, status: 'booked' },
  { test: /\b(created|booking created|shipment created)\b/i, status: 'created' },
  { test: /\b(exception|delay|hold|failed|cancell|problem|discrepanc)\b/i, status: 'exception' },
];

const AIR_RULES: Rule[] = [
  { test: /\b(accepted by airline|in origin terminal|origin terminal)\b/i, status: 'in_origin_terminal' },
];

const SEA_RULES: Rule[] = [
  { test: /\b(empty (returned|return)|return empty|gate in empty)\b/i, status: 'container_returned' },
  { test: /\b(empty (pick.?up|out)|gate out empty|picked up empty)\b/i, status: 'container_picked_up' },
];

@Injectable()
export class NormalizerService {
  normalize(rawStatus: string | null | undefined, type: ShipmentType): NormalizedStatus {
    if (!rawStatus) return 'unknown';
    const text = rawStatus.trim();

    const ruleSets =
      type === ShipmentType.SEA
        ? [...SEA_RULES, ...COMMON_RULES]
        : type === ShipmentType.AIR
          ? [...AIR_RULES, ...COMMON_RULES]
          : [...COMMON_RULES];

    for (const rule of ruleSets) {
      if (rule.test.test(text)) return rule.status;
    }
    return 'unknown';
  }
}
