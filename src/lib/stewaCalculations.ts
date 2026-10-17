/**
 * STEWA formulas copied from public/SWA-STEWA-RCBC.xlsx, sheet "STEWA (July 6-9)".
 * Printed values are column D. Column I is the input / working area.
 * Displayed planned % is D29 = I29 (sine, original duration). H36 does not change D29.
 */

const MS_DAY = 86_400_000;
/** Excel I29 uses this constant, not Math.PI. */
const EXCEL_PI = 3.14159265358979;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

type DateParts = { y: number; m: number; d: number };

/** Parse yyyy-mm-dd (date input) or MM/DD/YYYY text. */
export function parseFlexibleDate(value: string): Date | null {
  const v = value.trim();
  if (!v) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const d = new Date(`${v}T12:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const mdy = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const d = new Date(Number(mdy[3]), Number(mdy[1]) - 1, Number(mdy[2]), 12);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const parsed = new Date(v);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateParts(value: string): DateParts | null {
  const v = value.trim();
  if (!v) return null;
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { y: Number(iso[1]), m: Number(iso[2]), d: Number(iso[3]) };
  const parsed = parseFlexibleDate(v);
  if (!parsed) return null;
  return { y: parsed.getFullYear(), m: parsed.getMonth() + 1, d: parsed.getDate() };
}

function utcMs(parts: DateParts): number {
  return Date.UTC(parts.y, parts.m - 1, parts.d);
}

function fromUtc(ms: number): DateParts {
  const dt = new Date(ms);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function toIso(parts: DateParts): string {
  return `${parts.y}-${String(parts.m).padStart(2, '0')}-${String(parts.d).padStart(2, '0')}`;
}

/** Excel date + N days (D17 = D20+9, D21 = D17+D19). */
export function addCalendarDays(value: string, days: number): string | null {
  const parts = dateParts(value);
  if (!parts || !Number.isFinite(days)) return null;
  return toIso(fromUtc(utcMs(parts) + Math.trunc(days) * MS_DAY));
}

/** Excel serial subtraction (D18 − D17). */
export function excelDateDiff(later: string, earlier: string): number | null {
  const a = dateParts(later);
  const b = dateParts(earlier);
  if (!a || !b) return null;
  return Math.round((utcMs(a) - utcMs(b)) / MS_DAY);
}

/** "July 08, 2026" — day zero-padded, matching the workbook. */
export function formatExcelDate(value: string): string {
  const v = value.trim();
  if (!v) return '';
  if (/[\u2013\u2014]| to /i.test(v)) {
    return v.replace(/^As of\s+/i, '').trim();
  }
  const parts = dateParts(v);
  if (!parts) return v.replace(/^As of\s+/i, '').trim();
  return `${MONTHS[parts.m - 1]} ${String(parts.d).padStart(2, '0')}, ${parts.y}`;
}

/**
 * Printed SWA "As of" text, without the "As of" prefix.
 * A single date stays in the workbook format. A range is "July 6–10, 2026"
 * in one month, or "July 30 – August 5, 2026" when the months differ.
 */
export function formatSwaAsOfLabel(data: Record<string, unknown> | null | undefined): string {
  const record = data ?? {};
  const single = String(record.report_date ?? record.as_of ?? '').trim();
  const rangeOn =
    String(record.as_of_range ?? '') === '1' ||
    record.as_of_range === true ||
    String(record.as_of_range ?? '').toLowerCase() === 'true';
  const startRaw = String(record.as_of_start ?? '').trim();
  const endRaw = String(record.as_of_end ?? '').trim();
  if ((rangeOn || (!single && startRaw && endRaw)) && startRaw && endRaw) {
    const ranged = formatSwaDateRange(startRaw, endRaw);
    if (ranged) return ranged;
  }
  const asOfLabel = String(record.as_of_label ?? '').trim();
  if (asOfLabel) {
    return asOfLabel.replace(/^As of\s+/i, '').trim();
  }
  return single ? formatExcelDate(single) : '';
}

/**
 * Displayed date or reporting period for a report record in lists/tables.
 * Single source of truth is the date/reporting period SET INSIDE the document:
 * - SWA: reporting period "July 6–9, 2026" or "July 09, 2026" (matches "As of ...")
 * - STEWA: document report date / period covered
 * - IAR: document report date / week covered
 */
export function formatReportDisplayDate(
  report:
    | {
        report_type?: string | null;
        report_data?: Record<string, unknown> | null;
        created_at?: string | null;
      }
    | null
    | undefined,
): string {
  if (!report) return '—';
  const data =
    report.report_data ??
    (report as { reportData?: Record<string, unknown> }).reportData ??
    {};
  const reportType = String(report.report_type ?? '').toUpperCase();

  if (reportType === 'SWA') {
    const swaLabel = formatSwaAsOfLabel(data);
    if (swaLabel) return swaLabel;
    const reportDate = String(data.report_date ?? data.as_of ?? '').trim();
    if (reportDate) return formatExcelDate(reportDate);
    const period = String(data.period ?? data.period_covered ?? '').trim();
    if (period) return formatExcelDate(period);
  } else if (reportType === 'STEWA') {
    const reportDate = String(data.report_date ?? data.as_of ?? '').trim();
    if (reportDate) return formatExcelDate(reportDate);
    const periodStart = String(data.period_start ?? '').trim();
    const periodEnd = String(data.period_end ?? '').trim();
    if (periodStart && periodEnd) {
      return `${formatExcelDate(periodStart)} to ${formatExcelDate(periodEnd)}`;
    }
    const periodCovered = String(data.period_covered ?? data.week_covered ?? '').trim();
    if (periodCovered) return formatExcelDate(periodCovered);
  } else if (reportType === 'IAR') {
    const reportDate = String(data.report_date ?? data.as_of ?? '').trim();
    if (reportDate) return formatExcelDate(reportDate);
    const weekCovered = String(data.week_covered ?? data.period_covered ?? '').trim();
    if (weekCovered) return formatExcelDate(weekCovered);
  } else {
    // Other / generic
    const reportDate = String(data.report_date ?? data.as_of ?? '').trim();
    if (reportDate) return formatExcelDate(reportDate);
    const asOf = formatSwaAsOfLabel(data);
    if (asOf) return asOf;
    const period = String(data.period_covered ?? data.period ?? '').trim();
    if (period) return formatExcelDate(period);
  }

  // Fallback to formatted created_at only if no document date has been set inside the report yet
  const createdAt = String(report.created_at ?? '').trim();
  if (createdAt) {
    const parsed = formatExcelDate(createdAt.slice(0, 10));
    if (parsed) return parsed;
  }
  return '—';
}

function formatSwaDateRange(startRaw: string, endRaw: string): string | null {
  const start = dateParts(startRaw);
  const end = dateParts(endRaw);
  if (!start || !end) return null;
  const [from, to] = utcMs(start) <= utcMs(end) ? [start, end] : [end, start];
  if (from.y === to.y && from.m === to.m && from.d === to.d) {
    return formatExcelDate(
      `${from.y}-${String(from.m).padStart(2, '0')}-${String(from.d).padStart(2, '0')}`,
    );
  }
  const fromMonth = MONTHS[from.m - 1];
  const toMonth = MONTHS[to.m - 1];
  if (from.y === to.y && from.m === to.m) {
    return `${fromMonth} ${from.d}\u2013${to.d}, ${from.y}`;
  }
  if (from.y === to.y) {
    return `${fromMonth} ${from.d} \u2013 ${toMonth} ${to.d}, ${to.y}`;
  }
  return `${fromMonth} ${from.d}, ${from.y} \u2013 ${toMonth} ${to.d}, ${to.y}`;
}

function optionalNumber(value: string | undefined): number | null {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '-' || raw === '—') return null;
  const n = Number(raw.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Blank Excel number cells act as 0 inside arithmetic. */
function excelNumber(value: string | undefined): number {
  return optionalNumber(value) ?? 0;
}

/**
 * I29 = (((SIN((((180*(D27/D19))-90)*(PI/180)))+1)*50)/100)
 * Returned in percentage points (1.33 means 1.33%), which is how Excel percent format displays the fraction.
 */
export function plannedSinePercent(elapsed: number, duration: number): number | null {
  if (!duration) return null;
  const radians = ((180 * (elapsed / duration) - 90) * EXCEL_PI) / 180;
  const fraction = ((Math.sin(radians) + 1) * 50) / 100;
  return fraction * 100;
}

/**
 * STEWA Planned % (D17 = NTP+9, D27 = as-of − D17 + 1 − approved suspension days, D29 = I29 sine).
 * This is the only planned-percentage implementation. STEWA and the S-Curve both call it.
 * `suspensionDays` is the approved suspension entered for the project, subtracted on every as-of date.
 */
export function calculatePlannedPercentage(input: {
  noticeToProceed: string;
  contractDurationDays: number;
  asOf: string;
  suspensionDays?: number;
}): number | null {
  const duration = input.contractDurationDays;
  const noticeToProceed = input.noticeToProceed.trim();
  const asOf = input.asOf.trim().slice(0, 10);
  if (!noticeToProceed || !asOf || !(duration > 0)) return null;
  const periodStart = addCalendarDays(noticeToProceed, 9);
  if (!periodStart) return null;
  const span = excelDateDiff(asOf, periodStart);
  if (span == null) return null;
  const elapsed = span + 1 - Math.max(0, input.suspensionDays ?? 0);
  const planned = plannedSinePercent(elapsed, duration);
  if (planned == null || !Number.isFinite(planned)) return null;
  return Math.round((planned + Number.EPSILON) * 100) / 100;
}

/**
 * Revised / Target STEWA planned % with dated suspension freeze.
 * During a suspension window the curve stays at the pre-suspension sine value;
 * after the window the full suspensionDays are subtracted from elapsed.
 */
export function revisedStewaPlannedPercent(input: {
  noticeToProceed: string;
  contractDurationDays: number;
  asOf: string;
  suspensionDays?: number;
  suspensionStart?: string | null;
  suspensionEnd?: string | null;
}): number | null {
  const duration = input.contractDurationDays;
  const noticeToProceed = input.noticeToProceed.trim();
  const asOf = input.asOf.trim().slice(0, 10);
  if (!noticeToProceed || !asOf || !(duration > 0)) return null;

  const periodStart = addCalendarDays(noticeToProceed, 9);
  if (!periodStart || asOf < periodStart) return null;
  if (asOf === periodStart) return 0;

  const suspDays = Math.max(0, input.suspensionDays ?? 0);
  const sStart = input.suspensionStart?.slice(0, 10) || '';
  const sEnd = input.suspensionEnd?.slice(0, 10) || '';
  const hasWindow = !!(sStart && sEnd && sEnd >= sStart && suspDays > 0);

  let effectiveAsOf = asOf;
  let effectiveSusp = hasWindow ? 0 : suspDays;

  if (hasWindow && asOf >= sStart && asOf <= sEnd) {
    const dayBefore = addCalendarDays(sStart, -1);
    effectiveAsOf = dayBefore && dayBefore >= periodStart ? dayBefore : periodStart;
    effectiveSusp = 0;
  } else if (hasWindow && asOf > sEnd) {
    effectiveSusp = suspDays;
  }

  const span = excelDateDiff(effectiveAsOf, periodStart);
  if (span == null) return null;
  const planned = plannedSinePercent(Math.max(0, span + 1 - effectiveSusp), duration);
  if (planned == null || !Number.isFinite(planned)) return null;
  return Math.round((planned + Number.EPSILON) * 100) / 100;
}

/**
 * First date the planned sine reaches 100 on the way up (elapsed = contract duration).
 * Earlier dates can also print 100 when a large suspension makes elapsed a negative full cycle.
 * Those dates are still calculated by {@link calculatePlannedPercentage}; this date is the completion point.
 */
export function plannedCompletionDate(input: {
  noticeToProceed: string;
  contractDurationDays: number;
  suspensionDays?: number;
}): string | null {
  const duration = input.contractDurationDays;
  const periodStart = addCalendarDays(input.noticeToProceed.trim(), 9);
  if (!periodStart || !(duration > 0)) return null;
  const suspension = Math.max(0, input.suspensionDays ?? 0);
  return addCalendarDays(periodStart, duration - 1 + suspension);
}

/** Same result as {@link calculatePlannedPercentage}, or 0 when the inputs cannot be calculated. */
export function stewaPlannedFromSchedule(input: {
  noticeToProceed: string;
  contractDurationDays: number;
  asOf: string;
  suspensionDays?: number;
}): number {
  return calculatePlannedPercentage(input) ?? 0;
}

function round2(value: number): string {
  return (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
}

export function stewaDash(value: string | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '-' || raw === '—' || Number(raw) === 0) return '—';
  return raw;
}

export function stewaPercentText(value: string | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const n = Number(raw.replace(/%/g, ''));
  if (!Number.isFinite(n)) return raw;
  return n.toFixed(2);
}

export function applyStewaDerivedFields(data: Record<string, string>): Record<string, string> {
  const next = { ...data };
  const asOf = String(next.report_date ?? '').trim();
  const ntp = String(next.notice_to_proceed ?? '').trim();
  const durationInput = optionalNumber(next.contract_duration);
  const duration = durationInput ?? 0;
  const extension = excelNumber(next.approved_time_extension);
  const suspension = excelNumber(next.approved_time_suspension);

  // D17 = D20+9. D18 = as-of date (B9).
  const periodStart = ntp ? addCalendarDays(ntp, 9) : null;
  const periodEnd = asOf || null;
  next.period_start = periodStart ?? '';
  next.period_end = periodEnd ?? '';
  if (periodStart && periodEnd) {
    const covered = `${formatExcelDate(periodStart)} to ${formatExcelDate(periodEnd)}`;
    next.period_covered = covered;
    next.week_covered = covered;
  } else {
    next.period_covered = '';
    next.week_covered = '';
  }

  // D21 = D17+D19. Blank duration stays blank so an unfilled form does not print the period start as expiry.
  const expiry = periodStart && durationInput != null ? addCalendarDays(periodStart, duration) : null;
  next.expiry_date = expiry ?? '';

  // I24 = D22. I25 = IF(D22>0, D22+I19, 0). D25 = IF(I24>0, I25, 0).
  next.total_time_extension = String(extension);
  const revisedDuration = extension > 0 ? extension + duration : 0;
  next.revised_contract_duration = String(revisedDuration);

  // D26 = D21+D23+D22.
  next.revised_expiry_date = expiry
    ? addCalendarDays(expiry, suspension + extension) ?? ''
    : '';

  // D27 = D18-D17+1-D23.
  if (periodStart && periodEnd) {
    const span = excelDateDiff(periodEnd, periodStart);
    next.calendar_days_elapsed = span == null ? '' : String(span + 1 - suspension);
  } else {
    next.calendar_days_elapsed = '';
  }

  // D29 = I29. I30 (sine on revised duration) is not the printed planned %.
  const planned = calculatePlannedPercentage({
    noticeToProceed: ntp,
    contractDurationDays: duration,
    asOf,
    suspensionDays: suspension,
  });
  next.percent_planned = planned == null ? '' : planned.toFixed(2);

  // D30 = D28-D29, using the 2-decimal percent values the sheet displays.
  const actual = optionalNumber(next.percent_actual);
  if (actual != null && planned != null) {
    next.slippage = round2(Number(round2(actual)) - Number(next.percent_planned));
  } else {
    next.slippage = '';
  }

  return next;
}
