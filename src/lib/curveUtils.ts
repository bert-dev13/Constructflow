/**
 * Helpers to choose display dates for S-Curve charts.
 * These are reconstructed from Candidate C bundle behavior.
 */
export function sampleDatesAcrossPoints(points: { date: string }[], count: number): string[] {
  const dates = Array.from(new Set(points.map((p) => p.date.slice(0, 10))));
  if (dates.length <= count) return dates;
  const out: string[] = [];
  const step = (dates.length - 1) / (count - 1);
  for (let i = 0; i < count; i += 1) {
    const idx = Math.round(i * step);
    out.push(dates[Math.min(idx, dates.length - 1)]);
  }
  return Array.from(new Set(out));
}

export function originalCurveDisplayDates(points: { date: string }[], periodsCount: number): string[] {
  // Candidate C picks a sensible default set of display dates across the original points,
  // scaled by the requested periodsCount. Keep it deterministic and evenly sampled.
  const target = Math.max(2, Math.min(20, Math.floor(periodsCount ?? 7)));
  return sampleDatesAcrossPoints(points, target);
}

export function curveSeriesDisplayDates(points: { date: string; [k: string]: any }[], series: string): Set<string> {
  const s = new Set<string>();
  for (const p of points) {
    const v = p[series];
    if (v != null && Number.isFinite(Number(v))) s.add(p.date.slice(0, 10));
  }
  return s;
}

export function thinDatesByPixelGap(dates: string[], xForDate: (d: string) => number | null, minGapPx: number): string[] {
  const kept: string[] = [];
  let lastX: number | null = null;
  for (const d of dates) {
    const x = xForDate(d);
    if (x == null || !Number.isFinite(x)) continue;
    if (lastX == null || Math.abs(x - lastX) >= minGapPx) {
      kept.push(d);
      lastX = x;
    }
  }
  return kept;
}

