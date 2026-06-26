import { fmtDate } from '../status';
import type { RowSummary } from '../rows';

export function SummaryBar({
  summary,
  checkedAt,
  running,
}: {
  summary: RowSummary;
  checkedAt: string;
  running?: boolean;
}) {
  const done = summary.total - summary.pending;
  return (
    <div className="summary">
      <div className="tally total">
        <div className="n">{summary.total}</div>
        <div className="k">Усього номерів</div>
      </div>
      <div className="tally ok">
        <div className="n">{summary.success}</div>
        <div className="k">Успішно</div>
      </div>
      <div className="tally fail">
        <div className="n">{summary.failed}</div>
        <div className="k">З помилками</div>
      </div>
      <div className="tally">
        <div className="k">{running ? 'Завантаження' : 'Готово'}</div>
        <div className="req">
          {running ? (
            <>
              <span className="spinner sm" /> {done}/{summary.total}
            </>
          ) : (
            `${done}/${summary.total} опрацьовано`
          )}
        </div>
        <div className="req" style={{ marginTop: 4 }}>
          {fmtDate(checkedAt)}
        </div>
      </div>
    </div>
  );
}
