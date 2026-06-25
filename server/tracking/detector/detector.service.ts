import { Injectable } from '@nestjs/common';
import {
  Carrier,
  DetectionResult,
  ShipmentType,
} from '../models';
import { AWB_PREFIXES, CONTAINER_OWNERS } from './reference-data';

const AWB_RE = /^\d{3}-?\d{8}$/;
const CONTAINER_RE = /^[A-Z]{4}\d{7}$/;

// ISO 6346 letter values (multiples of 11 are skipped: 22 and 33).
const ISO6346_LETTER_VALUES: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  let value = 10;
  for (let i = 0; i < 26; i++) {
    if (value % 11 === 0) value++; // skip 22, 33
    map[String.fromCharCode(65 + i)] = value;
    value++;
  }
  return map;
})();

@Injectable()
export class DetectorService {
  /** Normalize a raw number: trim, uppercase, strip inner whitespace. */
  normalize(raw: string): string {
    return (raw ?? '').trim().toUpperCase().replace(/\s+/g, '');
  }

  detect(rawNumber: string): DetectionResult {
    const normalized = this.normalize(rawNumber);
    const warnings: string[] = [];

    if (AWB_RE.test(normalized)) {
      const canonical = this.canonicalAwb(normalized);
      return {
        type: ShipmentType.AIR,
        normalized_number: canonical,
        carrier: this.carrierFromAwb(canonical),
        warnings,
      };
    }

    if (CONTAINER_RE.test(normalized)) {
      const check = this.validateIso6346(normalized);
      if (!check.valid) {
        // Per ТЗ §4: do not reject a container on a bad check digit, only warn.
        warnings.push('invalid_check_digit');
      }
      return {
        type: ShipmentType.SEA,
        normalized_number: normalized,
        carrier: this.carrierFromContainer(normalized),
        warnings,
      };
    }

    return {
      type: ShipmentType.UNKNOWN,
      normalized_number: normalized,
      carrier: null,
      warnings,
    };
  }

  /** Render an AWB as `PREFIX-SERIAL` (e.g. 12312345678 → 123-12345678). */
  private canonicalAwb(n: string): string {
    const digits = n.replace('-', '');
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }

  private carrierFromAwb(canonical: string): Carrier | null {
    const prefix = canonical.slice(0, 3);
    const hit = AWB_PREFIXES[prefix];
    if (!hit) return null;
    return { name: hit.name, code: hit.code, source: 'awb_prefix' };
  }

  private carrierFromContainer(n: string): Carrier | null {
    const owner = n.slice(0, 3); // 3-letter owner code (4th letter is category)
    const hit = CONTAINER_OWNERS[owner];
    if (!hit) return null;
    return {
      name: hit.name,
      code: hit.code ?? null,
      source: hit.isLessor ? 'container_owner_prefix(lessor)' : 'container_owner_prefix',
    };
  }

  /**
   * ISO 6346 container check digit.
   * Computed over the 4 letters + first 6 digits; compared to the 7th digit.
   */
  validateIso6346(containerNo: string): { valid: boolean; expected: number | null } {
    if (!CONTAINER_RE.test(containerNo)) return { valid: false, expected: null };
    const body = containerNo.slice(0, 10); // 4 letters + 6 digits
    const checkDigit = parseInt(containerNo[10], 10);

    let sum = 0;
    for (let i = 0; i < 10; i++) {
      const ch = body[i];
      const val = /[A-Z]/.test(ch) ? ISO6346_LETTER_VALUES[ch] : parseInt(ch, 10);
      sum += val * Math.pow(2, i);
    }
    let expected = sum % 11;
    if (expected === 10) expected = 0;
    return { valid: expected === checkDigit, expected };
  }
}
