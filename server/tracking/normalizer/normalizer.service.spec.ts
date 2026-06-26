import { describe, it, expect, beforeEach } from 'vitest';
import { NormalizerService } from './normalizer.service';
import { ShipmentType } from '../models';

describe('NormalizerService', () => {
  let svc: NormalizerService;
  beforeEach(() => {
    svc = new NormalizerService();
  });

  it('maps common delivered/arrived/departed phrases', () => {
    expect(svc.normalize('Delivered', ShipmentType.AIR)).toBe('delivered');
    expect(svc.normalize('Vessel departed', ShipmentType.SEA)).toBe('departed');
    expect(svc.normalize('Discharged from vessel', ShipmentType.SEA)).toBe('arrived');
  });

  it('applies SEA-specific empty-container rules before the generic ones', () => {
    // "gate out empty" must resolve to container_picked_up, NOT departed
    // (which the generic "gate out" rule would give).
    expect(svc.normalize('Gate out empty', ShipmentType.SEA)).toBe('container_picked_up');
    expect(svc.normalize('Empty returned to depot', ShipmentType.SEA)).toBe('container_returned');
  });

  it('maps AIR origin-terminal phrasing', () => {
    expect(svc.normalize('Accepted by airline', ShipmentType.AIR)).toBe('in_origin_terminal');
  });

  it('returns "unknown" for empty or unrecognized status', () => {
    expect(svc.normalize('', ShipmentType.SEA)).toBe('unknown');
    expect(svc.normalize(null, ShipmentType.AIR)).toBe('unknown');
    expect(svc.normalize('lorem ipsum dolor', ShipmentType.SEA)).toBe('unknown');
  });
});
