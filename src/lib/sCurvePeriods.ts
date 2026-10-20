import type { BarChartTask, PdmActivity } from '../types';
import type { SCurveCostItem } from './sCurveItems';

export type SCurveReportingInterval = '5_day' | '10_day' | '15_day' | '20_day' | '30_day';

export const SCurveReportingIntervals: SCurveReportingInterval[] = [
  '5_day',
  '10_day',
  '15_day',
  '20_day',
  '30_day',
];

export function isSCurveReportingInterval(value: unknown): value is SCurveReportingInterval {
  return (
    value === '5_day' ||
    value === '10_day' ||
    value === '15_day' ||
    value === '20_day' ||
    value === '30_day'
  );
}

export interface SCurvePeriodRow {
  periodIndex: number;
  label: string;
  startDate: string;
  endDate: string;
  targetAccomplishmentPct: number;
  targetAccomplishmentPhp: number;
  cumulativePct: number;
  cumulativePhp: number;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

/** Exclusive calendar-day span (end − start). 0 when end ≤ start. */
export function exclusiveDaysBetween(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${endDate.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 86_400_000);
}

export function intervalDays(interval: SCurveReportingInterval): number {
  if (interval === '5_day') return 5;
  if (interval === '10_day') return 10;
  if (interval === '15_day') return 15;
  if (interval === '20_day') return 20;
  return 30;
}

function periodLabel(interval: SCurveReportingInterval, periodIndex: number): string {
  if (interval === '5_day') return `5-Day ${periodIndex}`;
  if (interval === '10_day') return `10-Day ${periodIndex}`;
  if (interval === '15_day') return `15-Day ${periodIndex}`;
  if (interval === '20_day') return `20-Day ${periodIndex}`;
  return `Month ${periodIndex}`;
}

export function periodIndexForDate(
  startDate: string,
  date: string,
  interval: SCurveReportingInterval = '30_day',
): number {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const current = new Date(`${date}T00:00:00Z`).getTime();
  const diffDays = Math.max(0, Math.floor((current - start) / 86400000));
  // Day 0 (project start) belongs to period 1; day 30 of a 30-day interval is still period 1.
  return Math.max(1, Math.floor(diffDays / intervalDays(interval)) + 1);
}

/** Inclusive 1-based schedule span — same mapping as bar chart (ES 0-based → startDay). */
export function activityDaySpan(activity: PdmActivity): { startDay: number; endDay: number } {
  const duration = Math.max(1, Math.floor(Number(activity.duration) || 1));
  const es = Math.max(0, Math.floor(Number(activity.es ?? 0) || 0));
  const startDay = es + 1;
  const ef =
    activity.ef != null && Number.isFinite(Number(activity.ef))
      ? Math.floor(Number(activity.ef))
      : es + duration;
  const endDay = Math.max(startDay, ef);
  return { startDay, endDay };
}

function overlapDays(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): number {
  const start = Math.max(aStart, bStart);
  const end = Math.min(aEnd, bEnd);
  return Math.max(0, end - start + 1);
}

export function buildSCurvePeriods(input: {
  startDate: string;
  projectDuration: number;
  activities: PdmActivity[];
  costItems: SCurveCostItem[];
  totalContractAmount: number;
  reportingInterval?: SCurveReportingInterval;
}): SCurvePeriodRow[] {
  const reportingInterval = input.reportingInterval ?? '30_day';
  const daysPerPeriod = intervalDays(reportingInterval);
  const projectDuration = Math.max(1, Math.floor(input.projectDuration) || 1);
  const periodCount = Math.max(1, Math.ceil(projectDuration / daysPerPeriod));
  const wtByActivityId = new Map(
    input.costItems.map((item) => [item.activityId, item.weightPct]),
  );
  const targetPctByPeriod = new Map<number, number>();

  // Pro-rate each activity's weight across intervals by calendar overlap with
  // its PDM span (ES..EF). Do not dump the full weight into the finish period,
  // and do not count an activity in an interval it does not overlap.
  for (const activity of input.activities) {
    const wt = wtByActivityId.get(activity.id) ?? 0;
    if (wt <= 0) continue;
    const { startDay, endDay } = activityDaySpan(activity);
    const clampedStart = Math.min(projectDuration, startDay);
    const clampedEnd = Math.min(projectDuration, Math.max(clampedStart, endDay));
    const spanDays = clampedEnd - clampedStart + 1;
    if (spanDays <= 0) continue;

    for (let periodIndex = 1; periodIndex <= periodCount; periodIndex += 1) {
      const periodStartDay = (periodIndex - 1) * daysPerPeriod + 1;
      const periodEndDay = Math.min(projectDuration, periodIndex * daysPerPeriod);
      const overlap = overlapDays(clampedStart, clampedEnd, periodStartDay, periodEndDay);
      if (overlap <= 0) continue;
      const portion = (wt * overlap) / spanDays;
      targetPctByPeriod.set(periodIndex, (targetPctByPeriod.get(periodIndex) ?? 0) + portion);
    }
  }

  let runningCumulativePct = 0;
  const rows: SCurvePeriodRow[] = [];

  for (let periodIndex = 1; periodIndex <= periodCount; periodIndex += 1) {
    const periodStartDay = (periodIndex - 1) * daysPerPeriod + 1;
    const periodEndDay = Math.min(projectDuration, periodIndex * daysPerPeriod);
    let targetAccomplishmentPct = round4(targetPctByPeriod.get(periodIndex) ?? 0);
    // Snap the final period so cumulative % is exactly 100 (rounding residuals).
    if (periodIndex === periodCount) {
      targetAccomplishmentPct = round4(Math.max(0, 100 - runningCumulativePct));
    }
    runningCumulativePct = round4(runningCumulativePct + targetAccomplishmentPct);
    if (periodIndex === periodCount) runningCumulativePct = 100;
    const targetAccomplishmentPhp = round4(
      (targetAccomplishmentPct * input.totalContractAmount) / 100,
    );
    const cumulativePhp = round4((runningCumulativePct * input.totalContractAmount) / 100);

    rows.push({
      periodIndex,
      label: periodLabel(reportingInterval, periodIndex),
      // Day 1 = project start date; day N = start + (N - 1).
      startDate: addDays(input.startDate, periodStartDay - 1),
      endDate: addDays(input.startDate, periodEndDay - 1),
      targetAccomplishmentPct,
      targetAccomplishmentPhp,
      cumulativePct: runningCumulativePct,
      cumulativePhp,
    });
  }

  return rows;
}

function daysBetweenStartAndEnd(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.max(1, Math.round((end - start) / 86400000));
}

/**
 * Exact theoretical cumulative accomplishment (%):
 * 100 × (1 − cos(π × (Current Period / Total Duration))) / 2
 *
 * Current Period and Total Duration are both in days.
 */
export function theoreticalAccomplishmentPct(
  currentPeriodDays: number,
  totalDurationDays: number,
): number {
  const total = Math.max(1, totalDurationDays);
  const current = Math.max(0, Math.min(total, currentPeriodDays));
  if (current <= 0) return 0;
  if (current >= total) return 100;
  return round4((100 * (1 - Math.cos(Math.PI * (current / total)))) / 2);
}

/**
 * Schedule window for the theoretical cosine.
 * Total duration is working days (suspension days are not part of the denominator).
 * Current period is working days elapsed from start, frozen across a suspension window.
 */
export interface TheoreticalCurveWindow {
  startDate: string;
  endDate: string;
  totalDurationDays: number;
  suspensionStart?: string | null;
  suspensionEnd?: string | null;
}

function inclusiveSpanDays(startDate: string, endDate: string): number {
  const start = startDate.slice(0, 10);
  const end = endDate.slice(0, 10);
  if (!start || !end || end < start) return 0;
  return exclusiveDaysBetween(start, end) + 1;
}

/** Working days from the schedule start through `asOf`, with a suspension gap removed. */
export function theoreticalElapsedDays(asOf: string, window: TheoreticalCurveWindow): number {
  const start = window.startDate.slice(0, 10);
  const date = asOf.slice(0, 10);
  if (!start || !date || date <= start) return 0;

  const sStart = window.suspensionStart?.slice(0, 10) || '';
  const sEnd = window.suspensionEnd?.slice(0, 10) || '';
  const hasSuspension = !!(sStart && sEnd && sEnd >= sStart);

  if (hasSuspension && date >= sStart && date <= sEnd) {
    const dayBefore = addDays(sStart, -1);
    if (!dayBefore || dayBefore <= start) return 0;
    return exclusiveDaysBetween(start, dayBefore);
  }

  let elapsed = exclusiveDaysBetween(start, date);
  if (hasSuspension && date > sEnd) {
    elapsed -= inclusiveSpanDays(sStart, sEnd);
  }
  return Math.max(0, elapsed);
}

/**
 * Authoritative theoretical Target/Original % for one schedule window.
 * 100 × (1 − cos(π × (Current Period / Total Periods))) / 2
 * Start date is 0%. End date is 100%. Dates outside the window are null.
 */
export function theoreticalSchedulePct(
  asOf: string,
  window: TheoreticalCurveWindow,
): number | null {
  const start = window.startDate.slice(0, 10);
  const end = window.endDate.slice(0, 10);
  const date = asOf.slice(0, 10);
  if (!start || !end || !date || end < start || date < start || date > end) return null;
  if (date === start) return 0;
  if (date === end) return 100;
  const total = Math.max(1, Math.floor(window.totalDurationDays) || 1);
  return theoreticalAccomplishmentPct(theoreticalElapsedDays(date, window), total);
}

/** Same curve as {@link theoreticalSchedulePct}, clamped to 0% before the start and 100% after the end. */
export function theoreticalPlanPct(asOf: string, window: TheoreticalCurveWindow): number | null {
  const start = window.startDate.slice(0, 10);
  const end = window.endDate.slice(0, 10);
  const date = asOf.slice(0, 10);
  if (!start || !end || !date || end < start) return null;
  if (date < start) return 0;
  if (date > end) return 100;
  return theoreticalSchedulePct(date, window);
}

/**
 * Reporting-interval checkpoints whose cumulative Target % is {@link theoreticalSchedulePct}.
 * The interval "target this period" is the difference between those cumulative values.
 */
export function buildTheoreticalTargetPeriods(input: {
  window: TheoreticalCurveWindow;
  totalContractAmount: number;
  reportingInterval?: SCurveReportingInterval;
}): SCurvePeriodRow[] {
  const reportingInterval = input.reportingInterval ?? '30_day';
  const daysPerPeriod = intervalDays(reportingInterval);
  const start = input.window.startDate.slice(0, 10);
  const end = input.window.endDate.slice(0, 10);
  const span = Math.max(1, exclusiveDaysBetween(start, end));
  const periodCount = Math.max(1, Math.ceil(span / daysPerPeriod));
  const amount = Math.max(0, input.totalContractAmount);
  const rows: SCurvePeriodRow[] = [];
  let previousCumulativePct = 0;

  for (let periodIndex = 1; periodIndex <= periodCount; periodIndex += 1) {
    const isLast = periodIndex === periodCount;
    const periodStartDay = (periodIndex - 1) * daysPerPeriod;
    const periodEndExclusive = Math.min(span, periodIndex * daysPerPeriod);
    const startDate = periodIndex === 1 ? start : addDays(start, periodStartDay + 1);
    const endDate = isLast ? end : addDays(start, periodEndExclusive);
    const cumulativePct = isLast ? 100 : (theoreticalSchedulePct(endDate, input.window) ?? 0);
    const cumulativePhp = isLast ? round4(amount) : round4((cumulativePct * amount) / 100);
    const targetAccomplishmentPct = round4(cumulativePct - previousCumulativePct);
    const previousPhp = round4((previousCumulativePct * amount) / 100);
    rows.push({
      periodIndex,
      label: periodLabel(reportingInterval, periodIndex),
      startDate,
      endDate,
      targetAccomplishmentPct,
      targetAccomplishmentPhp: round4(cumulativePhp - previousPhp),
      cumulativePct: round4(cumulativePct),
      cumulativePhp,
    });
    previousCumulativePct = cumulativePct;
  }

  return rows;
}

/**
 * Original (blue) theoretical % — cosine S-curve.
 * With periodStart: STEWA-style inclusive elapsed from NTP+9 / project start, with suspension freeze.
 * Without periodStart: exclusive day count from start→asOf over duration.
 */
export function originalTheoreticalPct(
  startDate: string,
  endDate: string,
  asOf: string,
  durationDays?: number | null,
  periodStart?: string | null,
  suspensionDays?: number | null,
  suspensionStart?: string | null,
  suspensionEnd?: string | null,
): number | null {
  const start = startDate.slice(0, 10);
  const end = endDate.slice(0, 10);
  const date = asOf.slice(0, 10);
  if (!start || !end || !date || date < start || date > end) return null;

  const duration =
    durationDays != null && Number.isFinite(Number(durationDays)) && Number(durationDays) > 0
      ? Math.max(1, Math.floor(Number(durationDays)))
      : exclusiveDaysBetween(start, end);

  if (duration <= 0) return date !== start ? 100 : 0;

  if (periodStart) {
    const period = periodStart.slice(0, 10);
    const suspDays = Math.max(0, Number(suspensionDays ?? 0));
    const sStart = suspensionStart?.slice(0, 10) ?? '';
    const sEnd = suspensionEnd?.slice(0, 10) ?? '';
    const hasWindow = !!(sStart && sEnd && sEnd >= sStart && suspDays > 0);

    let effectiveAsOf = date;
    let effectiveSusp = hasWindow ? 0 : suspDays;

    if (hasWindow && date >= sStart && date <= sEnd) {
      const dayBefore = addDays(sStart, -1);
      effectiveAsOf = dayBefore && dayBefore >= period ? dayBefore : period;
      effectiveSusp = 0;
    } else if (hasWindow && date > sEnd) {
      effectiveSusp = suspDays;
    }

    const asOfMs = Date.parse(`${effectiveAsOf}T00:00:00Z`);
    const periodMs = Date.parse(`${period}T00:00:00Z`);
    if (!Number.isFinite(asOfMs) || !Number.isFinite(periodMs)) return null;
    const span = Math.round((asOfMs - periodMs) / 86_400_000);
    const elapsed = Math.max(0, span + 1 - effectiveSusp);
    const total = Math.max(1, duration);
    const current = Math.max(0, Math.min(total, elapsed));
    return (100 * (1 - Math.cos((current / total) * Math.PI))) / 2;
  }

  const elapsed = exclusiveDaysBetween(start, date);
  const total = Math.max(1, duration);
  const current = Math.max(0, Math.min(total, elapsed));
  return (100 * (1 - Math.cos((current / total) * Math.PI))) / 2;
}

/**
 * Theoretical S-Curve using the cosine formula over PDM/project duration.
 * Period checkpoints follow the selected 10-day or 30-day reporting interval.
 * Cumulative starts at 0% and reaches exactly 100% when Current Period = Total Duration.
 */
export function buildTheoreticalSCurvePeriods(input: {
  startDate: string;
  projectDuration: number;
  /** Optional Project Details planned end — used when later than PDM duration. */
  endDate?: string | null;
  /** Kept for call-site compatibility; theoretical % does not use activity WT. */
  activities?: PdmActivity[];
  costItems?: SCurveCostItem[];
  totalContractAmount: number;
  reportingInterval?: SCurveReportingInterval;
}): SCurvePeriodRow[] {
  const reportingInterval = input.reportingInterval ?? '30_day';
  const daysPerPeriod = intervalDays(reportingInterval);

  const durationFromEnd = input.endDate
    ? daysBetweenStartAndEnd(input.startDate, input.endDate)
    : 0;
  const totalDuration = Math.max(1, Math.floor(input.projectDuration) || 0, durationFromEnd);
  const periodCount = Math.max(1, Math.ceil(totalDuration / daysPerPeriod));
  const projectEndDate = input.endDate?.trim()
    ? input.endDate.trim()
    : addDays(input.startDate, totalDuration);

  const rows: SCurvePeriodRow[] = [];
  let previousCumulativePct = 0;

  for (let periodIndex = 1; periodIndex <= periodCount; periodIndex += 1) {
    const periodStartDay = (periodIndex - 1) * daysPerPeriod + 1;
    const periodEndDay = Math.min(totalDuration, periodIndex * daysPerPeriod);
    const isLast = periodIndex === periodCount;

    // Current Period = elapsed days at the end of this reporting interval.
    const currentPeriodDays = isLast ? totalDuration : periodEndDay;
    const cumulativePct = isLast
      ? 100
      : theoreticalAccomplishmentPct(currentPeriodDays, totalDuration);
    const targetAccomplishmentPct = round4(cumulativePct - previousCumulativePct);

    // Amount follows the same interval % as the cosine curve (not activity WT).
    // Cap cumulative peso at the contract amount on the final period.
    const cumulativePhp = isLast
      ? round4(input.totalContractAmount)
      : round4((cumulativePct * input.totalContractAmount) / 100);
    const previousCumulativePhp = round4(
      (previousCumulativePct * input.totalContractAmount) / 100,
    );
    const targetAccomplishmentPhp = round4(cumulativePhp - previousCumulativePhp);

    rows.push({
      periodIndex,
      label: periodLabel(reportingInterval, periodIndex),
      startDate: addDays(input.startDate, periodStartDay - 1),
      endDate: isLast ? projectEndDate : addDays(input.startDate, periodEndDay - 1),
      targetAccomplishmentPct,
      targetAccomplishmentPhp,
      cumulativePct,
      cumulativePhp,
    });
    previousCumulativePct = cumulativePct;
  }

  return rows;
}

export interface SCurvePeriodEdit {
  targetAccomplishmentPct: number;
}

/** Read a saved period-edit map. Keys are 1-based period indexes. */
export function readSCurvePeriodEdits(raw: unknown): Record<string, SCurvePeriodEdit> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const edits: Record<string, SCurvePeriodEdit> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const pct =
      value && typeof value === 'object'
        ? Number((value as { targetAccomplishmentPct?: unknown }).targetAccomplishmentPct)
        : Number(value);
    if (!Number.isFinite(pct)) continue;
    edits[key] = { targetAccomplishmentPct: round4(Math.max(0, pct)) };
  }
  return edits;
}

export function readStoredSCurvePeriods(raw: unknown): SCurvePeriodRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: SCurvePeriodRow[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const periodIndex = Number(item.periodIndex);
    if (!Number.isFinite(periodIndex)) continue;
    rows.push({
      periodIndex,
      label: String(item.label ?? periodLabel('30_day', periodIndex)),
      startDate: String(item.startDate ?? ''),
      endDate: String(item.endDate ?? ''),
      targetAccomplishmentPct: Number(item.targetAccomplishmentPct) || 0,
      targetAccomplishmentPhp: Number(item.targetAccomplishmentPhp) || 0,
      cumulativePct: Number(item.cumulativePct) || 0,
      cumulativePhp: Number(item.cumulativePhp) || 0,
    });
  }
  return rows.sort((a, b) => a.periodIndex - b.periodIndex);
}

function baselineKnots(baseline: SCurvePeriodRow[]): { date: string; pct: number; php: number }[] {
  const first = baseline[0];
  return [
    { date: first.startDate, pct: 0, php: 0 },
    ...baseline.map((row) => ({
      date: row.endDate,
      pct: row.cumulativePct,
      php: row.cumulativePhp,
    })),
  ];
}

function sampleBaselineAt(
  baseline: SCurvePeriodRow[],
  date: string,
): { pct: number; php: number } {
  const knots = baselineKnots(baseline);
  const last = knots[knots.length - 1];
  if (date <= knots[0].date) return { pct: 0, php: 0 };
  if (date >= last.date) return { pct: last.pct, php: last.php };
  for (let index = 1; index < knots.length; index += 1) {
    const next = knots[index];
    if (date > next.date) continue;
    const prev = knots[index - 1];
    const span = Date.parse(`${next.date}T00:00:00Z`) - Date.parse(`${prev.date}T00:00:00Z`);
    if (span <= 0) return { pct: next.pct, php: next.php };
    const t = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${prev.date}T00:00:00Z`)) / span;
    return {
      pct: prev.pct + (next.pct - prev.pct) * t,
      php: prev.php + (next.php - prev.php) * t,
    };
  }
  return { pct: last.pct, php: last.php };
}

/**
 * Split the frozen baseline into `periodCount` rows.
 * Cumulative % and PHP stay on the original curve. Only the checkpoint dates change.
 */
export function sampleBaselinePeriods(input: {
  baseline: SCurvePeriodRow[];
  periodCount: number;
  reportingInterval: SCurveReportingInterval;
}): SCurvePeriodRow[] {
  const baseline = input.baseline;
  if (baseline.length === 0) return [];
  const count = Math.max(1, Math.floor(input.periodCount) || baseline.length);
  if (count === baseline.length) return baseline.map((row) => ({ ...row }));

  const startMs = Date.parse(`${baseline[0].startDate}T00:00:00Z`);
  const endMs = Date.parse(`${baseline[baseline.length - 1].endDate}T00:00:00Z`);
  const last = baseline[baseline.length - 1];
  const rows: SCurvePeriodRow[] = [];
  let previousPct = 0;
  let previousPhp = 0;

  for (let periodIndex = 1; periodIndex <= count; periodIndex += 1) {
    const segStart = periodIndex === 1 ? startMs : startMs + Math.round(((periodIndex - 1) / count) * (endMs - startMs));
    const segEnd = periodIndex === count ? endMs : startMs + Math.round((periodIndex / count) * (endMs - startMs));
    const endDate = new Date(segEnd).toISOString().slice(0, 10);
    const sampled = periodIndex === count ? { pct: last.cumulativePct, php: last.cumulativePhp } : sampleBaselineAt(baseline, endDate);
    const cumulativePct = round4(sampled.pct);
    const cumulativePhp = round4(sampled.php);
    rows.push({
      periodIndex,
      label: periodLabel(input.reportingInterval, periodIndex),
      startDate: new Date(segStart).toISOString().slice(0, 10),
      endDate,
      cumulativePct,
      cumulativePhp,
      targetAccomplishmentPct: round4(cumulativePct - previousPct),
      targetAccomplishmentPhp: round4(cumulativePhp - previousPhp),
    });
    previousPct = cumulativePct;
    previousPhp = cumulativePhp;
  }
  return rows;
}

/** Replace this-period target % without moving cumulative Target Plan values. */
export function applySCurvePeriodEdits(
  rows: SCurvePeriodRow[],
  edits: Record<string, SCurvePeriodEdit>,
  totalContractAmount: number,
): SCurvePeriodRow[] {
  return rows.map((row) => {
    const edit = edits[String(row.periodIndex)];
    if (!edit) return row;
    const pct = round4(Math.max(0, edit.targetAccomplishmentPct));
    return {
      ...row,
      targetAccomplishmentPct: pct,
      targetAccomplishmentPhp: round4((pct * Math.max(0, totalContractAmount)) / 100),
    };
  });
}

export function buildTheoreticalBarChartTasks(input: {
  totalPeriods: number;
  reportingInterval?: SCurveReportingInterval;
}): { tasks: BarChartTask[]; totalDays: number } {
  const reportingInterval = input.reportingInterval ?? '30_day';
  const daysPerPeriod = intervalDays(reportingInterval);
  const totalPeriods = Math.max(1, input.totalPeriods);
  const tasks: BarChartTask[] = Array.from({ length: totalPeriods }, (_, index) => {
    const startDay = index * daysPerPeriod + 1;
    const endDay = startDay + daysPerPeriod - 1;
    return {
      id: `theoretical-${index + 1}`,
      index: index + 1,
      name: `${periodLabel(reportingInterval, index + 1)}`,
      startDay,
      endDay,
      actualEndDay: null,
      isCritical: false,
    };
  });
  return {
    tasks,
    totalDays: totalPeriods * daysPerPeriod,
  };
}


