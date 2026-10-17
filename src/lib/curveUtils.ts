/**
 * Display-date helpers for S-Curve charts (Candidate C marker / label thinning).
 */

function roundPctKey(value: unknown): string {
  if (value == null || value === '') return '';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '';
  const rounded = Math.round((n + Number.EPSILON) * 100) / 100;
  return `${rounded.toFixed(2).replace(/\.?0+$/, '')}%`;
}

type SeriesKeyedPoint = {
  date: string;
  originalPlan?: number | null;
  currentPlan?: number | null;
  actual?: number | null;
};

function seriesValue(point: SeriesKeyedPoint, series: string): unknown {
  if (series === 'originalPlan') return point.originalPlan;
  if (series === 'currentPlan') return point.currentPlan;
  if (series === 'actual') return point.actual;
  return undefined;
}

function plateauMiddles(
  points: SeriesKeyedPoint[],
  series: string,
): Array<{ date: string; length: number }> {
  const rows = points.filter((point) => {
    const value = seriesValue(point, series);
    return typeof value === 'number' && Number.isFinite(value);
  });
  const groups: Array<{ date: string; length: number }> = [];
  let start = 0;
  for (let index = 1; index <= rows.length; index += 1) {
    if (
      index < rows.length &&
      roundPctKey(seriesValue(rows[index], series)) === roundPctKey(seriesValue(rows[index - 1], series))
    ) {
      continue;
    }
    const slice = rows.slice(start, index);
    groups.push({
      date: slice[Math.floor((slice.length - 1) / 2)].date.slice(0, 10),
      length: slice.length,
    });
    start = index;
  }
  return groups;
}

/** Sparse marker dates for Target / Actual (plateau middles, min 7-day gap). */
export function curveSeriesDisplayDates(
  points: SeriesKeyedPoint[],
  series: 'originalPlan' | 'currentPlan' | 'actual',
): Set<string> {
  const rows = points.filter((point) => {
    const value = seriesValue(point, series);
    return typeof value === 'number' && Number.isFinite(value);
  });
  if (rows.length === 0) return new Set();

  const ends = new Set([rows[0].date.slice(0, 10), rows[rows.length - 1].date.slice(0, 10)]);
  const candidates = new Set<string>();
  for (const group of plateauMiddles(rows, series)) {
    if (group.length > 1) {
      candidates.add(group.date);
      continue;
    }
    const day = Number(group.date.slice(8, 10));
    if (ends.has(group.date) || day <= 3) candidates.add(group.date);
  }

  const last = rows[rows.length - 1].date.slice(0, 10);
  const thinned: string[] = [];
  for (const date of [...candidates].sort()) {
    const prev = thinned.at(-1);
    if (
      !prev ||
      Math.round(
        (Date.parse(`${date.slice(0, 10)}T00:00:00Z`) - Date.parse(`${prev.slice(0, 10)}T00:00:00Z`)) /
          86_400_000,
      ) >= 7
    ) {
      thinned.push(date);
      continue;
    }
    if (date === last) thinned[thinned.length - 1] = date;
  }
  return new Set(thinned);
}

/**
 * Sparse Original marker / label dates.
 * Optional intervalDays walks calendar steps; otherwise evenly samples up to periodsCount (max 20).
 */
export function originalCurveDisplayDates(
  points: Array<{ date: string; originalPlan?: number | null }>,
  periodsCount = 7,
  intervalDays?: number | null,
): string[] {
  const rows = points.filter(
    (point) => typeof point.originalPlan === 'number' && Number.isFinite(point.originalPlan),
  );
  if (rows.length === 0) return [];

  const count = Math.min(rows.length, Math.max(2, Math.min(20, Math.floor(periodsCount))));
  if (rows.length <= count) return rows.map((point) => point.date.slice(0, 10));

  const first = rows[0].date.slice(0, 10);
  const last = rows[rows.length - 1].date.slice(0, 10);

  if (intervalDays != null && Number.isFinite(Number(intervalDays)) && Number(intervalDays) > 0) {
    const dates: string[] = [first];
    let cursor = first;
    const addDays = (iso: string, days: number) => {
      const date = new Date(`${iso}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    };
    for (;;) {
      const next = addDays(cursor, Number(intervalDays));
      if (!next || next >= last) break;
      dates.push(next);
      cursor = next;
    }
    if (dates[dates.length - 1] !== last) dates.push(last);
    return Array.from(new Set(dates));
  }

  const sampled: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const rowIndex = Math.round((index * (rows.length - 1)) / (count - 1));
    const date = rows[rowIndex].date.slice(0, 10);
    if (!sampled.includes(date)) sampled.push(date);
  }
  if (sampled[0] !== first) sampled.unshift(first);
  if (sampled[sampled.length - 1] !== last) sampled.push(last);
  return [...new Set(sampled)];
}

export function thinDatesByPixelGap(
  dates: string[],
  xForDate: (date: string) => number | null,
  minGapPx: number,
): string[] {
  if (dates.length <= 2) return dates;
  const positioned = dates
    .map((date) => ({ date, x: xForDate(date) }))
    .filter((entry): entry is { date: string; x: number } => entry.x != null && Number.isFinite(entry.x))
    .sort((a, b) => a.x - b.x);
  if (positioned.length <= 2) return positioned.map((entry) => entry.date);

  const first = positioned[0];
  const last = positioned[positioned.length - 1];
  const kept = [first];
  for (const entry of positioned.slice(1, -1)) {
    if (entry.x - kept[kept.length - 1].x >= minGapPx) kept.push(entry);
  }
  if (last.x - kept[kept.length - 1].x < minGapPx && kept.length > 1) {
    kept[kept.length - 1] = last;
  } else if (kept[kept.length - 1].date !== last.date) {
    kept.push(last);
  }
  return kept.map((entry) => entry.date);
}

export function sampleDatesAcrossPoints(points: { date: string }[], count: number): string[] {
  return originalCurveDisplayDates(
    points.map((point) => ({ ...point, originalPlan: 0 })),
    count,
  );
}

/** Sample N visible marker dates for any numeric series key on a set of points. */
export function sampleSeriesDisplayDates(
  points: Array<{ date: string } & Record<string, unknown>>,
  seriesKey: string,
  periodsCount = 7,
  intervalDays?: number | null,
): string[] {
  const rows = points.filter((p) => {
    const v = p[seriesKey];
    return typeof v === 'number' && Number.isFinite(v);
  });
  if (rows.length === 0) return [];

  const count = Math.min(rows.length, Math.max(2, Math.min(20, Math.floor(periodsCount))));
  if (rows.length <= count) return rows.map((r) => r.date.slice(0, 10));

  const first = rows[0].date.slice(0, 10);
  const last = rows[rows.length - 1].date.slice(0, 10);

  if (intervalDays != null && Number.isFinite(Number(intervalDays)) && Number(intervalDays) > 0) {
    const dates: string[] = [first];
    let cursor = first;
    const addDays = (iso: string, days: number) => {
      const date = new Date(`${iso}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    };
    for (;;) {
      const next = addDays(cursor, Number(intervalDays));
      if (!next || next >= last) break;
      dates.push(next);
      cursor = next;
    }
    if (dates[dates.length - 1] !== last) dates.push(last);
    return Array.from(new Set(dates));
  }

  const sampled: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const rowIndex = Math.round((index * (rows.length - 1)) / (count - 1));
    const date = rows[rowIndex].date.slice(0, 10);
    if (!sampled.includes(date)) sampled.push(date);
  }
  if (sampled[0] !== first) sampled.unshift(first);
  if (sampled[sampled.length - 1] !== last) sampled.push(last);
  return [...new Set(sampled)];
}
