import { describe, it, expect, beforeEach } from 'vitest';
import { DetectorService } from './detector.service';
import { ShipmentType } from '../models';

describe('DetectorService', () => {
  let svc: DetectorService;
  beforeEach(() => {
    svc = new DetectorService();
  });

  describe('normalize', () => {
    it('trims, uppercases and strips inner whitespace', () => {
      expect(svc.normalize('  tllu 491 2250 ')).toBe('TLLU4912250');
    });
    it('handles null/undefined safely', () => {
      expect(svc.normalize(undefined as unknown as string)).toBe('');
    });
  });

  describe('detect — air (AWB)', () => {
    it('detects an AWB with a dash', () => {
      const d = svc.detect('080-38652331');
      expect(d.type).toBe(ShipmentType.AIR);
      expect(d.normalized_number).toBe('080-38652331');
    });
    it('canonicalizes an AWB without a dash to PREFIX-SERIAL', () => {
      const d = svc.detect('08038652331');
      expect(d.type).toBe(ShipmentType.AIR);
      expect(d.normalized_number).toBe('080-38652331');
    });
  });

  describe('detect — sea (container)', () => {
    it('detects a container number (ISO 6346 shape)', () => {
      const d = svc.detect('TLLU4912250');
      expect(d.type).toBe(ShipmentType.SEA);
      expect(d.normalized_number).toBe('TLLU4912250');
    });
    it('warns (does not reject) on a bad check digit', () => {
      // CSQU3054383 is valid; flip the check digit to force a warning.
      const d = svc.detect('CSQU3054384');
      expect(d.type).toBe(ShipmentType.SEA);
      expect(d.warnings).toContain('invalid_check_digit');
    });
  });

  describe('detect — unknown', () => {
    it('returns UNKNOWN for unrecognized input', () => {
      expect(svc.detect('HELLO').type).toBe(ShipmentType.UNKNOWN);
      expect(svc.detect('12345').type).toBe(ShipmentType.UNKNOWN);
    });
  });

  describe('validateIso6346', () => {
    it('accepts the canonical valid example (CSQU3054383 → 3)', () => {
      const r = svc.validateIso6346('CSQU3054383');
      expect(r.expected).toBe(3);
      expect(r.valid).toBe(true);
    });
    it('rejects a wrong check digit', () => {
      expect(svc.validateIso6346('CSQU3054384').valid).toBe(false);
    });
    it('returns invalid/null for a non-container string', () => {
      expect(svc.validateIso6346('NOPE')).toEqual({ valid: false, expected: null });
    });
  });
});
