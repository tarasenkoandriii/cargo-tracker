import type { ShipmentInputItem, TrackResponse } from './types';

const BASE = '/api';

export interface TrackOptions {
  demo?: boolean;
  debug?: boolean;
}

export async function track(
  shipments: ShipmentInputItem[],
  opts: TrackOptions = {},
): Promise<TrackResponse> {
  const res = await fetch(`${BASE}/track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipments, demo: opts.demo, debug: opts.debug }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Сервер повернув ${res.status}. ${text}`.trim());
  }
  return res.json();
}

export async function health(): Promise<{ status: string }> {
  const res = await fetch(`${BASE}/health`);
  return res.json();
}
