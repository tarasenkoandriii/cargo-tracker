import { useState } from 'react';
import type { ShipmentResult, TrackResponse } from '../types';
import { statusInfo, typeInfo, fmtDate } from '../status';
import { ShipmentDetail } from './ShipmentDetail';
import { exportJson, exportCsv, exportXlsx } from '../export';

export function ResultsTable({ data }: { data: TrackResponse }) {
  const [open, setOpen] = useState<number | null>(null);

  if (!data.results.length) {
    return (
      <div className="panel">
        <div className="empty">
          <div className="big">Немає результатів</div>
          Введіть номери ліворуч і натисніть «Відстежити».
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="toolbar">
        <span className="grow" />
        <button className="btn-ghost" onClick={() => exportJson(data)}>
          JSON
        </button>
        <button className="btn-ghost" onClick={() => exportCsv(data)}>
          CSV
        </button>
        <button className="btn-ghost" onClick={() => exportXlsx(data)}>
          Excel
        </button>
      </div>

      <table className="manifest">
        <thead>
          <tr>
            <th style={{ width: 32 }}></th>
            <th>ID</th>
            <th>Номер</th>
            <th>Тип</th>
            <th>Статус</th>
            <th>ETA</th>
            <th>Остання подія</th>
            <th>Джерело</th>
          </tr>
        </thead>
        <tbody>
          {data.results.map((r, i) => (
            <Row
              key={i}
              r={r}
              isOpen={open === i}
              onToggle={() => setOpen(open === i ? null : i)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({
  r,
  isOpen,
  onToggle,
}: {
  r: ShipmentResult;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const st = statusInfo(r.tracking.current_status);
  const ty = typeInfo(r.detected.type);
  const hasError = r.errors.length > 0;
  const last = r.tracking.last_event;

  return (
    <>
      <tr className={`clickable ${isOpen ? 'open' : ''}`} onClick={onToggle}>
        <td>
          <span className="chev">▶</span>
        </td>
        <td className="mono">{r.input.id ?? '—'}</td>
        <td className="num">{r.input.number}</td>
        <td>
          <span className="type-glyph">
            <span className={`g ${ty.cls}`}>{ty.glyph}</span>
            <span className="t">
              <small>{ty.label}</small>
            </span>
          </span>
        </td>
        <td>
          <span className={`pill dot ${st.family}`}>{st.label}</span>
        </td>
        <td className="mono">{fmtDate(r.tracking.dates.eta)}</td>
        <td className="mono">{last ? fmtDate(last.datetime) : '—'}</td>
        <td>
          {hasError ? (
            <span className="pill bad">{r.errors[0].code}</span>
          ) : (
            r.source.final_source ?? '—'
          )}
        </td>
      </tr>
      {isOpen && (
        <tr className="detail">
          <td colSpan={8} style={{ padding: 0 }}>
            <ShipmentDetail r={r} />
          </td>
        </tr>
      )}
    </>
  );
}
