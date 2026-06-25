/**
 * Reference data for carrier resolution.
 *
 * This is generic reference data (prefix → carrier), NOT hardcoded shipment
 * numbers (ТЗ §13). Tables are intentionally partial — unknown prefixes
 * resolve to `null` with a warning rather than a guessed value, because the
 * agent must never invent data (ТЗ §10.1).
 *
 * Sources to extend from in production:
 *  - IATA airline prefix list (first 3 digits of an AWB).
 *  - BIC / ISO 6346 container owner (the 3-letter owner code before "U").
 */

/** AWB prefix (3 digits) → { airline name, IATA code }. Partial, verified set. */
export const AWB_PREFIXES: Record<string, { name: string; code: string }> = {
  '001': { name: 'American Airlines', code: 'AA' },
  '006': { name: 'Delta Air Lines', code: 'DL' },
  '014': { name: 'American Airlines', code: 'AA' },
  '016': { name: 'United Airlines', code: 'UA' },
  '020': { name: 'Lufthansa Cargo', code: 'LH' },
  '023': { name: 'FedEx', code: 'FX' },
  '057': { name: 'Air France', code: 'AF' },
  '074': { name: 'KLM', code: 'KL' },
  '075': { name: 'Iberia', code: 'IB' },
  '125': { name: 'British Airways', code: 'BA' },
  '131': { name: 'Japan Airlines', code: 'JL' },
  '157': { name: 'Qatar Airways Cargo', code: 'QR' },
  '160': { name: 'Cathay Pacific Cargo', code: 'CX' },
  '172': { name: 'Cargolux', code: 'CV' },
  '176': { name: 'Emirates SkyCargo', code: 'EK' },
  '180': { name: 'Korean Air Cargo', code: 'KE' },
  '205': { name: 'Turkish Cargo', code: 'TK' },
  '235': { name: 'TAP Air Portugal', code: 'TP' },
  '297': { name: 'China Airlines', code: 'CI' },
  '988': { name: 'Asiana Airlines', code: 'OZ' },
};

/**
 * Container owner prefix (3 letters before the equipment category letter)
 * → { owner/operator name, optional SCAC-style code, isLessor }.
 *
 * Note: the owner code identifies the *equipment owner*. For leasing companies
 * the operating shipping line can differ; we flag that with `isLessor`.
 */
export const CONTAINER_OWNERS: Record<
  string,
  { name: string; code?: string; isLessor?: boolean }
> = {
  MSK: { name: 'Maersk', code: 'MAEU' },
  MAE: { name: 'Maersk', code: 'MAEU' },
  MRK: { name: 'Maersk', code: 'MAEU' },
  MSC: { name: 'MSC (Mediterranean Shipping Company)', code: 'MSCU' },
  CMA: { name: 'CMA CGM', code: 'CMDU' },
  HLX: { name: 'Hapag-Lloyd', code: 'HLCU' },
  HLB: { name: 'Hapag-Lloyd', code: 'HLCU' },
  HLC: { name: 'Hapag-Lloyd', code: 'HLCU' },
  ONE: { name: 'Ocean Network Express (ONE)', code: 'ONEY' },
  OOL: { name: 'OOCL', code: 'OOLU' },
  COS: { name: 'COSCO', code: 'COSU' },
  APL: { name: 'APL', code: 'APLU' },
  EGH: { name: 'Evergreen', code: 'EGLV' },
  EIS: { name: 'Evergreen', code: 'EGLV' },
  YML: { name: 'Yang Ming', code: 'YMLU' },
  // Major leasing companies (equipment owner ≠ operating line):
  TRH: { name: 'Triton Container (lessor)', isLessor: true },
  TGH: { name: 'Triton Container (lessor)', isLessor: true },
  TCN: { name: 'Triton Container (lessor)', isLessor: true },
  CAI: { name: 'CAI International (lessor)', isLessor: true },
  SEG: { name: 'Seaco (lessor)', isLessor: true },
  GES: { name: 'Triton / GE SeaCo (lessor)', isLessor: true },
  BEA: { name: 'Beacon Intermodal (lessor)', isLessor: true },
  FCI: { name: 'Florens (lessor)', isLessor: true },
};
