import { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import type { ShipmentInputItem } from '../types';

const EXAMPLE = `080-38652331
501-20285134
TLLU4912250
CAIU7533723
MSKU1880987`;

interface Props {
  demo: boolean;
  setDemo: (v: boolean) => void;
  loading: boolean;
  onRun: (shipments: ShipmentInputItem[]) => void;
}

export function InputPanel({ demo, setDemo, loading, onRun }: Props) {
  const [text, setText] = useState('');
  const [fileInfo, setFileInfo] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function parseText(raw: string): ShipmentInputItem[] {
    return raw
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((number, i) => ({ id: `S${String(i + 1).padStart(3, '0')}`, number }));
  }

  async function onFile(file: File) {
    const name = file.name.toLowerCase();
    try {
      if (name.endsWith('.json')) {
        const data = JSON.parse(await file.text());
        const list: ShipmentInputItem[] = Array.isArray(data)
          ? data
          : data.shipments ?? [];
        setText(list.map((s) => s.number).join('\n'));
        setFileInfo(`${file.name} · ${list.length} номерів`);
      } else if (name.endsWith('.csv') || name.endsWith('.xlsx') || name.endsWith('.xls')) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
        const numbers = rows
          .map(
            (row) =>
              row.number ?? row.Number ?? row['номер'] ?? row['Номер'] ?? row.awb ?? row.AWB,
          )
          .filter(Boolean)
          .map(String);
        setText(numbers.join('\n'));
        setFileInfo(`${file.name} · ${numbers.length} номерів`);
      } else {
        setText(await file.text());
        setFileInfo(file.name);
      }
    } catch (err) {
      setFileInfo(`Не вдалося прочитати файл: ${String((err as Error).message)}`);
    }
  }

  const shipments = parseText(text);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Вхідні дані</h2>
      </div>
      <div className="panel-body">
        <label className="field-label" htmlFor="numbers">
          Номери AWB / контейнерів
        </label>
        <textarea
          id="numbers"
          className="numbers"
          placeholder={'080-38652331\nTLLU4912250\n…'}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setFileInfo(null);
          }}
        />
        <p className="hint">Один номер у рядку (також через кому або «;»).</p>

        <div className="row" style={{ gap: 8, marginTop: 6 }}>
          <span className="filebtn btn-ghost">
            Завантажити файл
            <input
              ref={fileRef}
              type="file"
              accept=".json,.csv,.xlsx,.xls"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
              }}
            />
          </span>
          <button className="btn-link" onClick={() => setText(EXAMPLE)}>
            Приклад
          </button>
        </div>
        {fileInfo && <p className="hint">{fileInfo}</p>}

        <div className="divider" />

        <div className="controls">
          <label className="toggle">
            <input
              type="checkbox"
              checked={demo}
              onChange={(e) => setDemo(e.target.checked)}
            />
            <span className="toggle-text">
              Демо-режим
              <small>Синтетичні дані без зовнішніх запитів</small>
            </span>
          </label>

          <button
            className="btn-primary"
            disabled={loading || shipments.length === 0}
            onClick={() => onRun(shipments)}
          >
            {loading
              ? 'Обробка…'
              : `Відстежити${shipments.length ? ` (${shipments.length})` : ''}`}
          </button>
        </div>
      </div>
    </section>
  );
}
