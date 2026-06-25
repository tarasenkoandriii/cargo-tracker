// Maps the normalized status vocabulary (ТЗ §7) to a visual family and a
// Ukrainian label. Unknown values fall back to neutral + the raw string.

type Family = 'neutral' | 'transit' | 'done' | 'bad';

const MAP: Record<string, { family: Family; label: string }> = {
  not_found: { family: 'bad', label: 'Не знайдено' },
  created: { family: 'neutral', label: 'Створено' },
  booked: { family: 'neutral', label: 'Заброньовано' },
  received: { family: 'neutral', label: 'Прийнято' },
  in_origin_terminal: { family: 'neutral', label: 'У терміналі відправлення' },
  departed: { family: 'transit', label: 'Відправлено' },
  in_transit: { family: 'transit', label: 'У дорозі' },
  arrived: { family: 'transit', label: 'Прибуло' },
  customs: { family: 'transit', label: 'Митниця' },
  ready_for_pickup: { family: 'transit', label: 'Готово до видачі' },
  delivered: { family: 'done', label: 'Доставлено' },
  container_picked_up: { family: 'done', label: 'Контейнер забрано' },
  container_returned: { family: 'done', label: 'Контейнер повернено' },
  exception: { family: 'bad', label: 'Виняткова ситуація' },
  unknown: { family: 'neutral', label: 'Невідомо' },
};

export function statusInfo(status: string | null): { family: Family; label: string } {
  if (!status) return { family: 'neutral', label: '—' };
  return MAP[status] ?? { family: 'neutral', label: status };
}

export function typeInfo(type: string): { glyph: string; cls: string; label: string } {
  switch (type) {
    case 'air_awb':
      return { glyph: '✈', cls: 'air', label: 'Авіа · AWB' };
    case 'sea_container':
      return { glyph: '▣', cls: 'sea', label: 'Море · контейнер' };
    default:
      return { glyph: '?', cls: 'unknown', label: 'Невідомий' };
  }
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  // Show ISO as-is but trimmed to minute precision when it looks like a datetime.
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(iso);
  if (m) return `${m[1]} ${m[2]}`;
  return iso;
}
