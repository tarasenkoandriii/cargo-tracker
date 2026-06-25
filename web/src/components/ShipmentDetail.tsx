import type { ShipmentResult } from '../types';
import { fmtDate } from '../status';

export function ShipmentDetail({ r }: { r: ShipmentResult }) {
  const t = r.tracking;
  const events = t.events ?? [];
  const route = t.route;
  const q = r.quality;

  return (
    <div className="detail-inner">
      <div>
        <h3>Маршрут</h3>
        <div className="route">
          <span className="leg">{route.origin ?? '—'}</span>
          {route.transit_points && route.transit_points.length > 0 && (
            <>
              <span className="arrow">→</span>
              <span className="via">{route.transit_points.join(' · ')}</span>
            </>
          )}
          <span className="arrow">→</span>
          <span className="leg">{route.destination ?? '—'}</span>
        </div>

        <h3>Журнал подій</h3>
        {events.length === 0 ? (
          <p className="hint">Подій немає.</p>
        ) : (
          <ul className="ledger">
            {events.map((e, i) => {
              const isLast = i === events.length - 1;
              return (
                <li key={i} className={isLast ? 'cur' : ''}>
                  <div className="ev-top">
                    <span className="ev-name">
                      {e.event_name ?? e.event_code ?? '—'}
                    </span>
                    <span className="ev-time">{fmtDate(e.datetime)}</span>
                  </div>
                  {e.location && <div className="ev-loc">{e.location}</div>}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div>
        <h3>Деталі</h3>
        <dl className="kv">
          <dt>Нормалізований №</dt>
          <dd className="mono">{r.detected.normalized_number ?? '—'}</dd>
          <dt>Перевізник</dt>
          <dd>
            {r.detected.carrier?.name ?? '—'}
            {r.detected.carrier?.code ? (
              <span className="mono"> ({r.detected.carrier.code})</span>
            ) : null}
          </dd>
          <dt>Сирий статус</dt>
          <dd>{t.raw_status ?? '—'}</dd>
          <dt>ETD / ETA</dt>
          <dd className="mono">
            {fmtDate(t.dates.etd)} → {fmtDate(t.dates.eta)}
          </dd>
          <dt>Факт. відпр.</dt>
          <dd className="mono">{fmtDate(t.dates.actual_departure)}</dd>
          <dt>Факт. приб.</dt>
          <dd className="mono">{fmtDate(t.dates.actual_arrival)}</dd>
          <dt>Джерело</dt>
          <dd>
            {r.source.final_source ?? '—'}
            {r.source.url ? (
              <>
                {' · '}
                <a href={r.source.url} target="_blank" rel="noreferrer">
                  посилання
                </a>
              </>
            ) : null}
          </dd>
        </dl>

        <h3 style={{ marginTop: 16 }}>
          Якість даних · {Math.round(q.confidence * 100)}%
        </h3>
        <div className="conf-bar">
          <span style={{ width: `${Math.round(q.confidence * 100)}%` }} />
        </div>

        {(q.warnings.length > 0 || r.errors.length > 0 || q.missing_fields.length > 0) && (
          <div className="warnings">
            {r.errors.map((e, i) => (
              <span className="err-tag" key={`e${i}`} title={e.message}>
                {e.code}
              </span>
            ))}
            {q.warnings.map((w, i) => (
              <span className="warn-tag" key={`w${i}`}>
                {w}
              </span>
            ))}
            {q.missing_fields.length > 0 && (
              <span className="warn-tag">missing: {q.missing_fields.join(', ')}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
