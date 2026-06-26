import { useMemo, useState } from 'react';
import type { RowState, ShipmentResult, TrackResponse } from '../types';
import { statusInfo, typeInfo, fmtDate } from '../status';
import { ShipmentDetail } from './ShipmentDetail';
import { exportJson, exportCsv, exportXlsx } from '../export';

export function ResultsTable({
  rows,
  checkedAt,
  onRetry,
}: {
  rows: RowState[];
  checkedAt?: string | null;
  onRetry?: (index: number) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);

  // Build an export payload from whatever has loaded so far.
  const exportData = useMemo<TrackResponse>(() => {
    const results = rows.map((r) => r.result).filter(Boolean) as ShipmentResult[];
    const failed = results.filter((r) => r.errors.length > 0).length;
    return {
      request_id: 'live',
      checked_at: checkedAt ?? new Date().toISOString(),
      summary: { total: results.length, success: results.length - failed, failed },
      results,
    };
  }, [rows, checkedAt]);

  if (!rows.length) {
    return (
      <div className="panel">
        <div className="empty">
          <div className="big">Немає результатів</div>
          Введіть номери ліворуч і натисніть «Відстежити».
        </div>
      </div>
    );
  }

  const anyLoaded = rows.some((r) => r.result);

  return (
    <div>
      <div className="toolbar">
        <span className="grow" />
        <button className="btn-ghost" disabled={!anyLoaded} onClick={() => exportJson(exportData)}>
          JSON
        </button>
        <button className="btn-ghost" disabled={!anyLoaded} onClick={() => exportCsv(exportData)}>
          CSV
        </button>
        <button className="btn-ghost" disabled={!anyLoaded} onClick={() => exportXlsx(exportData)}>
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
          {rows.map((row, i) => (
            <Row
              key={i}
              row={row}
              index={i}
              isOpen={open === i}
              onToggle={() => row.result && setOpen(open === i ? null : i)}
              onRetry={onRetry}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Spinner() {
  return <span className="spinner" aria-label="завантаження" />;
}

function Row({
  row,
  index,
  isOpen,
  onToggle,
  onRetry,
}: {
  row: RowState;
  index: number;
  isOpen: boolean;
  onToggle: () => void;
  onRetry?: (index: number) => void;
}) {
  const { input, loading, result: r } = row;

  // Placeholder: row exists but data hasn't arrived yet → spinner + skeletons.
  if (!r) {
    return (
      <tr className="placeholder">
        <td>
          <Spinner />
        </td>
        <td className="mono">{input.id ?? '—'}</td>
        <td className="num">{input.number}</td>
        <td>
          <span className="skeleton w-72" />
        </td>
        <td>
          <span className="skeleton w-90" />
        </td>
        <td>
          <span className="skeleton w-64" />
        </td>
        <td>
          <span className="skeleton w-80" />
        </td>
        <td>
          <span className="skeleton w-72" />
        </td>
      </tr>
    );
  }

  const st = statusInfo(r.tracking.current_status);
  const ty = typeInfo(r.detected.type);
  const hasError = r.errors.length > 0;
  const last = r.tracking.last_event;
  // Show the carrier name after the source (e.g. "pier2pier.com:Hapag-Lloyd");
  // fall back to the markup-parser variant if the carrier wasn't resolved.
  const srcSuffix = r.detected.carrier?.name ?? r.source.source_variant ?? null;

  return (
    <>
      <tr
        className={`clickable ${isOpen ? 'open' : ''} ${loading ? 'reloading' : ''}`}
        onClick={onToggle}
      >
        <td>{loading ? <Spinner /> : <span className="chev">▶</span>}</td>
        <td className="mono">{input.id ?? '—'}</td>
        <td className="num">{input.number}</td>
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
            <div className="src-cell">
              {srcSuffix && <span className="src-carrier">{srcSuffix}</span>}
              {onRetry ? (
                <button
                  type="button"
                  className="pill bad retry"
                  title="Повторити запит для цього номера"
                  disabled={loading}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRetry(index);
                  }}
                >
                  <span className="retry-glyph">{loading ? '⟳' : '↻'}</span>
                  {loading ? 'Повтор…' : r.errors[0].code}
                </button>
              ) : (
                <span className="pill bad">{r.errors[0].code}</span>
              )}
            </div>
          ) : r.source.final_source ? (
            <span className="src">
              {r.source.final_source}
              {srcSuffix && <span className="src-variant">:{srcSuffix}</span>}
            </span>
          ) : (
            '—'
          )}
        </td>
      </tr>
      {isOpen && r && (
        <tr className="detail">
          <td colSpan={8} style={{ padding: 0 }}>
            <ShipmentDetail r={r} />
          </td>
        </tr>
      )}
    </>
  );
}
