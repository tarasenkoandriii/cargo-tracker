/**
 * Domain types shared across the tracking pipeline.
 *
 * These types are the contract between connectors, parsers, the normalizer
 * and the response builder. The public JSON returned by the API is assembled
 * by `ResponseBuilder` and must always match `schema/response.schema.json`.
 */

// ---- Shipment types (ТЗ §4) ------------------------------------------------

export type ShipmentType = 'air_awb' | 'sea_container' | 'unknown';

export const ShipmentType = {
  AIR: 'air_awb' as ShipmentType,
  SEA: 'sea_container' as ShipmentType,
  UNKNOWN: 'unknown' as ShipmentType,
};

// ---- Normalized statuses (ТЗ §7) -------------------------------------------

export type NormalizedStatus =
  | 'not_found'
  | 'created'
  | 'booked'
  | 'received'
  | 'in_origin_terminal'
  | 'departed'
  | 'in_transit'
  | 'arrived'
  | 'customs'
  | 'ready_for_pickup'
  | 'delivered'
  | 'container_picked_up'
  | 'container_returned'
  | 'exception'
  | 'unknown';

// ---- Error codes (ТЗ §9) ---------------------------------------------------

export type ErrorCode =
  | 'INVALID_FORMAT'
  | 'NOT_FOUND'
  | 'SOURCE_UNAVAILABLE'
  | 'TIMEOUT'
  | 'CAPTCHA_REQUIRED'
  | 'LOGIN_REQUIRED'
  | 'PARSING_FAILED'
  | 'PARTIAL_DATA';

export const ErrorCode = {
  INVALID_FORMAT: 'INVALID_FORMAT' as ErrorCode,
  NOT_FOUND: 'NOT_FOUND' as ErrorCode,
  SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE' as ErrorCode,
  TIMEOUT: 'TIMEOUT' as ErrorCode,
  CAPTCHA_REQUIRED: 'CAPTCHA_REQUIRED' as ErrorCode,
  LOGIN_REQUIRED: 'LOGIN_REQUIRED' as ErrorCode,
  PARSING_FAILED: 'PARSING_FAILED' as ErrorCode,
  PARTIAL_DATA: 'PARTIAL_DATA' as ErrorCode,
};

export interface ShipmentError {
  code: ErrorCode;
  message: string;
  source: string | null;
}

export interface Carrier {
  name: string | null;
  code: string | null;
  /** how the carrier was derived, e.g. "awb_prefix" | "container_owner_prefix" | "source" */
  source: string | null;
}

export type TimezoneConfidence = 'source_provided' | 'inferred' | 'unknown';

export interface TrackingEvent {
  event_code: string | null;
  event_name: string | null;
  normalized_status: NormalizedStatus | null;
  location: string | null;
  /** ISO 8601, or null. Dates are never invented (ТЗ §10.1, §11.1). */
  datetime: string | null;
  raw_text: string | null;
  raw_datetime: string | null;
  is_actual: boolean | null;
  timezone: string | null;
  timezone_confidence: TimezoneConfidence | null;
}

/** Internal result returned by a single connector for a single number. */
export interface TrackResult {
  found: boolean;
  carrier: Carrier | null;

  current_status: NormalizedStatus | null;
  raw_status: string | null;
  events: TrackingEvent[];

  etd: string | null;
  eta: string | null;
  actual_departure: string | null;
  actual_arrival: string | null;

  origin: string | null;
  destination: string | null;
  transit_points: string[];

  /** Container milestones (ТЗ §6.3), kept additionally to `events`. */
  container_milestones: Record<string, unknown>;

  source_name: string | null;
  url: string | null;

  warnings: string[];
  error: ShipmentError | null;
}

export function emptyTrackResult(): TrackResult {
  return {
    found: false,
    carrier: null,
    current_status: null,
    raw_status: null,
    events: [],
    etd: null,
    eta: null,
    actual_departure: null,
    actual_arrival: null,
    origin: null,
    destination: null,
    transit_points: [],
    container_milestones: {},
    source_name: null,
    url: null,
    warnings: [],
    error: null,
  };
}

// ---- Pipeline I/O ----------------------------------------------------------

export interface ShipmentInput {
  id?: string | null;
  number: string;
  type?: ShipmentType | null; // optional user hint, validated not trusted
  carrier?: string | null; // optional user hint
  comment?: string | null;
}

export interface DetectionResult {
  type: ShipmentType;
  normalized_number: string;
  carrier: Carrier | null;
  warnings: string[];
}

export interface PipelineOptions {
  demoMode: boolean;
  shortFormat: boolean;
}
