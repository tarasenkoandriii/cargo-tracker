import { useState } from 'react';
import { InputPanel } from './components/InputPanel';
import { SummaryBar } from './components/SummaryBar';
import { ResultsTable } from './components/ResultsTable';
import { track } from './api';
import type { ShipmentInputItem, TrackResponse } from './types';

export default function App() {
  const [demo, setDemo] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<TrackResponse | null>(null);

  async function run(shipments: ShipmentInputItem[]) {
    setLoading(true);
    setError(null);
    try {
      const res = await track(shipments, { demo });
      setData(res);
    } catch (err) {
      setError(String((err as Error).message));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark">CARGO·TRACKER</span>
            <span className="brand-sub">AWB &amp; контейнери · трекінг</span>
          </div>
          <span className="topbar-spacer" />
          <span className={`env-flag ${demo ? 'demo' : 'live'}`}>
            {demo ? 'demo mode' : 'live'}
          </span>
        </div>
      </header>

      <main className="shell">
        <aside>
          <InputPanel demo={demo} setDemo={setDemo} loading={loading} onRun={run} />
          {error && <div className="error-banner">{error}</div>}
        </aside>

        <section>
          {data && <SummaryBar data={data} />}
          {data ? (
            <ResultsTable data={data} />
          ) : (
            <div className="panel">
              <div className="empty">
                <div className="big">Готово до роботи</div>
                Вставте номери AWB або контейнерів і натисніть «Відстежити».
                У демо-режимі відповідь формується локально й показує всі три
                сценарії: знайдено, не знайдено, невірний формат.
              </div>
            </div>
          )}
        </section>
      </main>

      <footer className="foot">
        Десктоп-консоль трекінгу. Формат номерів: AWB <code>NNN-NNNNNNNN</code>,
        контейнер <code>AAAA NNNNNNN</code> (ISO&nbsp;6346). Розгорніть рядок, щоб
        побачити журнал подій, маршрут і якість даних.
      </footer>
    </>
  );
}
