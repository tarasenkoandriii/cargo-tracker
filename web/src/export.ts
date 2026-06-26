import * as XLSX from 'xlsx';
import type { TrackResponse, ShipmentResult } from './types';

function flatRow(r: ShipmentResult) {
  return {
    id: r.input.id ?? '',
    number: r.input.number,
    type: r.detected.type,
    normalized_number: r.detected.normalized_number ?? '',
    carrier: r.detected.carrier?.name ?? '',
    current_status: r.tracking.current_status ?? '',
    raw_status: r.tracking.raw_status ?? '',
    etd: r.tracking.dates.etd ?? '',
    eta: r.tracking.dates.eta ?? '',
    origin: r.tracking.route.origin ?? '',
    destination: r.tracking.route.destination ?? '',
    last_event_at: r.tracking.last_event?.datetime ?? '',
    source: r.source.final_source
      ? r.source.final_source +
        (r.detected.carrier?.name
          ? `:${r.detected.carrier.name}`
          : r.source.source_variant
            ? `:${r.source.source_variant}`
            : '')
      : '',
    confidence: r.quality.confidence,
    errors: r.errors.map((e) => e.code).join('; '),
  };
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

export function exportJson(data: TrackResponse) {
  download(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    `tracking-${stamp()}.json`,
  );
}

export function exportCsv(data: TrackResponse) {
  const rows = data.results.map(flatRow);
  const ws = XLSX.utils.json_to_sheet(rows);
  const csv = XLSX.utils.sheet_to_csv(ws);
  download(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }), `tracking-${stamp()}.csv`);
}

export function exportXlsx(data: TrackResponse) {
  const rows = data.results.map(flatRow);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'tracking');
  XLSX.writeFile(wb, `tracking-${stamp()}.xlsx`);
}
