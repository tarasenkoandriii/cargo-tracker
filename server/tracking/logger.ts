import { ShipmentType } from './models';

/** A single processing step recorded for debug/audit (ТЗ §12). */
export interface DebugStep {
  step: string;
  status: 'success' | 'error' | 'skipped' | 'info';
  [key: string]: unknown;
}

/**
 * Collects the ordered processing steps for one shipment number so the
 * response can expose a `debug` block (ТЗ §12). Cheap and per-number.
 */
export class ShipmentLogger {
  readonly shipmentNumber: string;
  private readonly steps: DebugStep[] = [];

  constructor(shipmentNumber: string) {
    this.shipmentNumber = shipmentNumber;
  }

  add(step: string, status: DebugStep['status'], extra: Record<string, unknown> = {}): void {
    this.steps.push({ step, status, ...extra });
  }

  detect(type: ShipmentType): void {
    this.add('detect_type', 'success', { result: type });
  }

  toJSON(): { shipment_number: string; steps: DebugStep[] } {
    return { shipment_number: this.shipmentNumber, steps: this.steps };
  }
}
