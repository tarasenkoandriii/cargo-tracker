import { ShipmentInput } from './models';

/**
 * Minimal RFC4180-ish CSV parser for the tracking input columns
 * (id,number[,type,carrier,comment]). Quoted fields and embedded commas are
 * supported; no external dependency is needed (ТЗ §3).
 */
export function parseCsv(csv: string): ShipmentInput[] {
  const rows = splitRows(csv);
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const hasHeader = idx('number') !== -1;

  const numberCol = hasHeader ? idx('number') : 1;
  const idCol = hasHeader ? idx('id') : 0;
  const typeCol = hasHeader ? idx('type') : -1;
  const carrierCol = hasHeader ? idx('carrier') : -1;
  const commentCol = hasHeader ? idx('comment') : -1;

  const body = hasHeader ? rows.slice(1) : rows;
  const out: ShipmentInput[] = [];
  for (const cols of body) {
    const number = (cols[numberCol] ?? '').trim();
    if (!number) continue;
    out.push({
      id: idCol >= 0 ? (cols[idCol] ?? '').trim() || null : null,
      number,
      type: typeCol >= 0 ? ((cols[typeCol] ?? '').trim() as any) || null : null,
      carrier: carrierCol >= 0 ? (cols[carrierCol] ?? '').trim() || null : null,
      comment: commentCol >= 0 ? (cols[commentCol] ?? '').trim() || null : null,
    });
  }
  return out;
}

function splitRows(csv: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  const text = csv.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}
