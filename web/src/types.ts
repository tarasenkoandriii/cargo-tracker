// Mirrors the server response contract (ТЗ §8). Kept loose where the server
// may emit nulls so the UI can render every scenario without guards failing.

export type ShipmentType = 'air_awb' | 'sea_container' | 'unknown';

export interface Carrier {
  name: string | null;
  code: string | null;
  source?: string | null;
}

export interface ShipmentErrorItem {
  code: string;
  message: string;
  source?: string | null;
}

export interface TrackEvent {
  event_code: string | null;
  event_name: string | null;
  normalized_status?: string | null;
  location: string | null;
  datetime: string | null;
  raw_text?: string | null;
}

export interface LastEvent {
  event_code: string | null;
  event_name: string | null;
  location: string | null;
  datetime: string | null;
  is_actual: boolean | null;
}

export interface ShipmentResult {
  input: { id: string | null; number: string };
  detected: {
    type: ShipmentType;
    normalized_number: string | null;
    carrier: Carrier | null;
  };
  tracking: {
    current_status: string | null;
    raw_status: string | null;
    last_event: LastEvent | null;
    dates: {
      etd: string | null;
      eta: string | null;
      actual_departure: string | null;
      actual_arrival: string | null;
    };
    route: {
      origin: string | null;
      destination: string | null;
      transit_points: string[];
    };
    events: TrackEvent[];
    container_milestones?: Record<string, unknown>;
  };
  source: {
    primary_source: string | null;
    final_source: string | null;
    url: string | null;
    retrieved_at: string | null;
  };
  quality: {
    confidence: number;
    data_complete: boolean;
    missing_fields: string[];
    warnings: string[];
  };
  errors: ShipmentErrorItem[];
  debug?: unknown;
}

export interface TrackResponse {
  request_id: string;
  checked_at: string;
  summary: { total: number; success: number; failed: number };
  results: ShipmentResult[];
  results_short?: Record<string, unknown>[];
}

export interface ShipmentInputItem {
  id?: string | null;
  number: string;
  type?: ShipmentType | null;
  carrier?: string | null;
  comment?: string | null;
}

/** Per-row UI state for progressive (streaming) rendering. */
export interface RowState {
  input: ShipmentInputItem;
  loading: boolean;
  result: ShipmentResult | null;
}
