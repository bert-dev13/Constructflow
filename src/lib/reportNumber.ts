import { parseFlexibleDate } from './stewaCalculations';

const MONTH_SHORT = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
] as const;

type DateParts = { y: number; m: number; d: number };

function dateParts(value: string): DateParts | null {
  const v = String(value ?? '').trim();
  if (!v) return null;
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { y: Number(iso[1]), m: Number(iso[2]), d: Number(iso[3]) };
  const parsed = parseFlexibleDate(v);
  if (!parsed) return null;
  return { y: parsed.getFullYear(), m: parsed.getMonth() + 1, d: parsed.getDate() };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatBase(type: string, start: DateParts, end: DateParts): string {
  const [from, to] =
    Date.UTC(start.y, start.m - 1, start.d) <= Date.UTC(end.y, end.m - 1, end.d)
      ? [start, end]
      : [end, start];
  const month = MONTH_SHORT[from.m - 1] ?? 'JAN';
  const prefix = `${String(type).toUpperCase()}-${from.y}-${month}-${pad2(from.d)}`;
  if (from.y === to.y && from.m === to.m && from.d === to.d) return prefix;
  return `${prefix}-${pad2(to.d)}`;
}

/** Parse labels such as "July 6–9, 2026" or "July 06 – August 05, 2026". */
function parseHumanDateRange(label: string): { start: DateParts; end: DateParts } | null {
  const text = String(label ?? '')
    .replace(/^As of\s+/i, '')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+to\s+/gi, ' - ')
    .trim();
  if (!text) return null;

  const sameMonth = text.match(
    /^([A-Za-z]+)\s+(\d{1,2})\s*-\s*(\d{1,2}),\s*(\d{4})$/,
  );
  if (sameMonth) {
    const start = dateParts(`${sameMonth[1]} ${sameMonth[2]}, ${sameMonth[4]}`);
    const end = dateParts(`${sameMonth[1]} ${sameMonth[3]}, ${sameMonth[4]}`);
    if (start && end) return { start, end };
  }

  const crossMonth = text.match(
    /^([A-Za-z]+)\s+(\d{1,2})\s*-\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/,
  );
  if (crossMonth) {
    const start = dateParts(`${crossMonth[1]} ${crossMonth[2]}, ${crossMonth[5]}`);
    const end = dateParts(`${crossMonth[3]} ${crossMonth[4]}, ${crossMonth[5]}`);
    if (start && end) return { start, end };
  }

  const single = dateParts(text);
  if (single) return { start: single, end: single };
  return null;
}

function truthyRangeFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const s = String(value ?? '')
    .trim()
    .toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function resolveReportingPeriod(
  reportType: string,
  reportData: Record<string, unknown> | null | undefined,
): { start: DateParts; end: DateParts } | null {
  const data = reportData ?? {};
  const type = String(reportType || '').toUpperCase();

  const startRaw = String(data.as_of_start ?? data.period_start ?? '').trim();
  const endRaw = String(data.as_of_end ?? data.period_end ?? '').trim();
  const rangeOn = truthyRangeFlag(data.as_of_range);

  if ((rangeOn || (startRaw && endRaw)) && startRaw && endRaw) {
    const start = dateParts(startRaw);
    const end = dateParts(endRaw);
    if (start && end) return { start, end };
  }

  if (type === 'SWA') {
    const labelRange = parseHumanDateRange(String(data.as_of_label ?? data.period_covered ?? ''));
    if (labelRange) return labelRange;
    const single = dateParts(String(data.report_date ?? data.as_of ?? '').trim());
    if (single) return { start: single, end: single };
  }

  if (type === 'STEWA') {
    const periodStart = dateParts(String(data.period_start ?? '').trim());
    const periodEnd = dateParts(String(data.period_end ?? '').trim());
    if (periodStart && periodEnd) return { start: periodStart, end: periodEnd };
    const covered = parseHumanDateRange(
      String(data.period_covered ?? data.week_covered ?? data.as_of_label ?? ''),
    );
    if (covered) return covered;
    const single = dateParts(String(data.report_date ?? data.as_of ?? '').trim());
    if (single) return { start: single, end: single };
  }

  if (type === 'IAR') {
    const single = dateParts(
      String(data.report_date ?? data.as_of ?? data.week_covered ?? data.period_covered ?? '').trim(),
    );
    if (single) return { start: single, end: single };
    const covered = parseHumanDateRange(String(data.week_covered ?? data.period_covered ?? ''));
    if (covered) return covered;
  }

  const fallback = dateParts(String(data.report_date ?? data.as_of ?? '').trim());
  if (fallback) return { start: fallback, end: fallback };
  return null;
}

/**
 * Build the report ID from the document's saved reporting period / as-of dates.
 * Never uses created/updated/submitted timestamps or "today".
 *
 * Examples:
 * - SWA July 6–9, 2026 → SWA-2026-JUL-06-09
 * - STEWA July 6–12, 2026 → STEWA-2026-JUL-06-12
 * - IAR July 6, 2026 → IAR-2026-JUL-06
 */
export function buildReportNumberFromData(
  reportType: string,
  reportData: Record<string, unknown> | null | undefined,
): string {
  const type = String(reportType || '').toUpperCase();
  if (!type) return '';
  const period = resolveReportingPeriod(type, reportData);
  if (!period) return '';
  return formatBase(type, period.start, period.end);
}

/**
 * Display ID for lists, titles, preview, print, and PDF.
 * Prefers the reporting-period-derived number; keeps a stored uniqueness
 * suffix (e.g. "-2") when the stored value already uses that same base.
 */
export function displayReportNumber(report: {
  report_type?: string | null;
  report_number?: string | null;
  report_data?: Record<string, unknown> | null;
}): string {
  const stored = String(report.report_number ?? '').trim();
  const derived = buildReportNumberFromData(
    String(report.report_type ?? ''),
    report.report_data ?? null,
  );
  if (!derived) return stored;
  if (!stored) return derived;
  if (stored === derived || stored.startsWith(`${derived}-`)) return stored;
  return derived;
}
