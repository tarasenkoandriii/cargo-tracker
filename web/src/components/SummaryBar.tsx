import type { TrackResponse } from '../types';
import { fmtDate } from '../status';

export function SummaryBar({ data }: { data: TrackResponse }) {
  const { summary } = data;
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
        <div className="k">Запит</div>
        <div className="req">{data.request_id}</div>
        <div className="req" style={{ marginTop: 4 }}>
          {fmtDate(data.checked_at)}
        </div>
      </div>
    </div>
  );
}
