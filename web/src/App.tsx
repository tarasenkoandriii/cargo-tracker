import { useMemo, useState } from 'react';
import { InputPanel } from './components/InputPanel';
import { SummaryBar } from './components/SummaryBar';
import { ResultsTable } from './components/ResultsTable';
import { track } from './api';
import type { RowState, ShipmentInputItem } from './types';
import { makeErrorResult, patchRow, runPool, summarize } from './rows';

// How many per-shipment requests the browser keeps in flight at once. Each is an
// isolated single-number serverless call (fresh proxy IP, no batch burst), so a
// modest pool streams results in quickly without hammering the upstream API.
const CLIENT_CONCURRENCY = 5;

export default function App() {
  const [demo, setDemo] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<RowState[] | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  const summary = useMemo(() => (rows ? summarize(rows) : null), [rows]);

  // Track one shipment and write its result into the given row. Shared by the
  // initial run and per-row retry.
  async function fetchInto(index: number, input: ShipmentInputItem) {
    try {
      const res = await track([{ id: input.id ?? undefined, number: input.number }], { demo });
      const fresh = res.results[0] ?? makeErrorResult(input, 'Порожня відповідь сервера');
      setRows((prev) => patchRow(prev, index, { loading: false, result: fresh }));
    } catch (err) {
      setRows((prev) =>
        patchRow(prev, index, {
          loading: false,
          result: makeErrorResult(input, String((err as Error).message)),
        }),
      );
    }
  }

  // Click "Відстежити": render placeholders immediately, then stream each row in.
  async function run(shipments: ShipmentInputItem[]) {
    if (!shipments.length) return;
    setError(null);
    setRunning(true);
    setCheckedAt(new Date().toISOString());
    setRows(shipments.map((s) => ({ input: s, loading: true, result: null })));

    await runPool(shipments, CLIENT_CONCURRENCY, (s, i) => fetchInto(i, s));

    setCheckedAt(new Date().toISOString());
    setRunning(false);
  }

  // Re-track a single row on demand (failed straggler or refresh).
  async function retryOne(index: number) {
    const row = rows?.[index];
    if (!row || row.loading) return;
    setError(null);
    setRows((prev) => patchRow(prev, index, { loading: true }));
    await fetchInto(index, row.input);
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
          <InputPanel demo={demo} setDemo={setDemo} loading={running} onRun={run} />
          {error && <div className="error-banner">{error}</div>}
        </aside>

        <section>
          {summary && checkedAt && (
            <SummaryBar summary={summary} checkedAt={checkedAt} running={running} />
          )}
          {rows ? (
            <ResultsTable rows={rows} checkedAt={checkedAt} onRetry={retryOne} />
          ) : (
            <div className="panel">
              <div className="empty">
                <div className="big">Готово до роботи</div>
                Вставте номери AWB або контейнерів і натисніть «Відстежити».
                Рядки з’являться одразу, а дані підвантажаться по кожному
                відправленню окремо.
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
