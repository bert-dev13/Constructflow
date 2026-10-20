import {
  collection,
  doc,
  getDoc,
  setDoc,
} from 'firebase/firestore';
import type { SCurvePoint } from '../../types';
import type {
  SCurveActivity,
  SCurveComparison,
  SCurveSnapshotSummary,
  SCurveType,
} from '../sCurveApi';
import {
  computeSCurveCostSummary,
  type SCurveCostItem,
  type SCurveCostItemInput,
} from '../sCurveItems';
import {
  applySCurvePeriodEdits,
  buildSCurvePeriods,
  buildTheoreticalTargetPeriods,
  exclusiveDaysBetween,
  intervalDays,
  isSCurveReportingInterval,
  originalTheoreticalPct,
  periodIndexForDate,
  readSCurvePeriodEdits,
  readStoredSCurvePeriods,
  theoreticalElapsedDays,
  theoreticalPlanPct,
  theoreticalSchedulePct,
  type SCurvePeriodEdit,
  type SCurveReportingInterval,
  type SCurvePeriodRow,
  type TheoreticalCurveWindow,
} from '../sCurvePeriods';
import {
  compareTargetVsActual,
  resolveTargetAndActual,
  statusDisplayLabel,
} from '../progressStatus';
import type { ReportProgressEntry } from '../../components/ReportProgressFeed';
import {
  addCalendarDays,
  formatExcelDate,
  plannedCompletionDate,
  revisedStewaPlannedPercent,
} from '../stewaCalculations';
import {
  buildRevisedBaselinePeriods,
  flattenSuspensionPoints,
  pdmPlannedPercentOnDate,
  readSuspensionWindow,
  reportingDateFromSCurveLabel,
  sCurveSourceVersionLabel,
  stampOriginalPlan,
  type SuspensionWindow,
} from '../scheduleBaselines';
import { COLLECTIONS, sCurveSnapshotsPath } from './collections';
import { db } from './config';
import { asId, nowIso } from './ids';
import { getAccessContext } from './access';
import {
  invalidateChartCaches,
  loadProjectChartContext,
  loadSCurveVersions,
} from './chartContext';
import { canEditProjectCharts, canEditSCurvePeriods } from '../chartPermissions';
import { resolveSCurveCostWeights } from '../sCurveCostWeights';
import type { PdmActivity } from '../../types';

async function assertCanEditProjectCharts() {
  const access = await getAccessContext();
  if (!canEditProjectCharts(access?.role)) {
    throw new Error('You have view-only access to PDM / S-Curve / Bar Chart for this project.');
  }
}

interface StoredSCurveCostItem {
  activityId: string;
  itemNo?: string;
  description?: string;
  quantity: number;
  unitCost: number;
}

interface StewaPlanBasis {
  noticeToProceed: string;
  contractDurationDays: number;
  suspensionDays: number;
  asOf: string;
}

function resolveStewaPlan(stewaReports: ReportProgressEntry[]): StewaPlanBasis | null {
  const ranked = stewaReports
    .filter(
      (entry) =>
        entry.planNoticeToProceed &&
        entry.planContractDuration != null &&
        entry.planContractDuration > 0,
    )
    .sort((a, b) => {
      const rank = (status: string) => (status === 'approved' || status === 'generated' ? 1 : 0);
      const byStatus = rank(b.status) - rank(a.status);
      return byStatus !== 0 ? byStatus : b.date.localeCompare(a.date);
    });
  const best = ranked[0];
  if (!best?.planNoticeToProceed || best.planContractDuration == null) return null;
  return {
    noticeToProceed: best.planNoticeToProceed,
    contractDurationDays: best.planContractDuration,
    suspensionDays: best.planSuspensionDays ?? 0,
    asOf: best.date.slice(0, 10),
  };
}

/**
 * One Actual % per reporting date.
 * SWA accomplishment wins when SWA and STEWA share that date.
 * Equal percentages on different dates stay separate.
 */
export function genuineActualByDate(reports: ReportProgressEntry[]): Map<string, number> {
  const ranked = reports
    .filter(
      (report) =>
        (report.reportType === 'SWA' || report.reportType === 'STEWA') &&
        report.date &&
        Number.isFinite(report.percent),
    )
    .slice()
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.reportNumber.localeCompare(b.reportNumber),
    );
  const byDate = new Map<string, { percent: number; type: string }>();
  for (const report of ranked) {
    const date = report.date.slice(0, 10);
    const existing = byDate.get(date);
    if (existing?.type === 'SWA' && report.reportType === 'STEWA') continue;
    byDate.set(date, { percent: report.percent, type: report.reportType });
  }
  return new Map([...byDate].map(([date, value]) => [date, value.percent]));
}

/**
 * Actual is only the recorded SWA/STEWA percent on that report date, plus one
 * 0% anchor on the project start date. A suspension holds the last actual at
 * or before the suspension start through the suspension end. The 0% anchor and
 * the suspension boundary points are not reports.
 */
export function stampRecordedActual(
  points: SCurvePoint[],
  reports: ReportProgressEntry[],
  suspension: SuspensionWindow | null,
  projectStart?: string | null,
): SCurvePoint[] {
  const genuine = genuineActualByDate(reports);
  const byDate = new Map<string, SCurvePoint>();
  for (const point of points) {
    const date = point.date.slice(0, 10);
    byDate.set(date, {
      ...point,
      date,
      pointDate: point.pointDate ?? date,
      actual: null,
      variance: null,
    });
  }

  const ensure = (date: string): SCurvePoint => {
    const key = date.slice(0, 10);
    const existing = byDate.get(key);
    if (existing) return existing;
    const created: SCurvePoint = {
      date: key,
      pointDate: key,
      label: key,
      periodLabel: null,
      originalPlan: null,
      currentPlan: null,
      actual: null,
    };
    byDate.set(key, created);
    return created;
  };

  const start = suspension?.start?.slice(0, 10) || '';
  const end = suspension?.end?.slice(0, 10) || '';
  const hasSuspension = !!(start && end && end >= start);

  for (const [date, percent] of genuine) {
    if (hasSuspension && date > start && date <= end) continue;
    ensure(date).actual = round2(percent);
  }

  if (hasSuspension) {
    let held: number | null = null;
    for (const [date, percent] of [...genuine].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (date <= start) held = percent;
    }
    const curveStart = projectStart?.slice(0, 10) || '';
    // The 0% project-start anchor is the latest Actual when no report exists yet.
    if (held == null && curveStart && curveStart <= start && genuine.size > 0) held = 0;
    if (held != null) {
      const frozen = round2(held);
      for (const point of byDate.values()) {
        if (point.date >= start && point.date <= end) point.actual = frozen;
      }
      ensure(start).actual = frozen;
      ensure(end).actual = frozen;
    }
  }

  const curveStart = projectStart?.slice(0, 10) || '';
  if (curveStart && genuine.size > 0) {
    const anchor = ensure(curveStart);
    if (anchor.actual == null) anchor.actual = 0;
  }

  for (const point of byDate.values()) {
    point.variance =
      point.actual != null && point.currentPlan != null
        ? round2(point.actual - point.currentPlan)
        : null;
  }

  return [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter(
      (point) => point.originalPlan != null || point.currentPlan != null || point.actual != null,
    );
}

/** SWA accomplishment by date; fill STEWA sample dates inside an SWA as-of range. */
function buildSwaAccomplishmentByDate(
  swaReports: ReportProgressEntry[],
  stewaDates: string[] = [],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const report of [...swaReports].sort((a, b) => a.date.localeCompare(b.date))) {
    if (report.percent == null || !Number.isFinite(report.percent) || !report.date) continue;
    const end = report.date.slice(0, 10);
    map.set(end, report.percent);
    const start = report.asOfStart?.slice(0, 10);
    if (start && !(start > end)) {
      for (const raw of stewaDates) {
        const date = raw.slice(0, 10);
        if (date >= start && date <= end && !map.has(date)) {
          map.set(date, report.percent);
        }
      }
    }
  }
  return map;
}

function hideSeriesAfter(
  points: SCurvePoint[],
  key: 'originalPlan' | 'currentPlan',
  endDate: string | null,
): SCurvePoint[] {
  if (!endDate) return points;
  return points.map((point) => {
    if (point.date <= endDate) return point;
    const next = { ...point, [key]: null };
    if (key === 'currentPlan') next.variance = null;
    return next;
  });
}

function endSeriesAtFirstFull(
  points: SCurvePoint[],
  key: 'originalPlan' | 'currentPlan' | 'actual',
): SCurvePoint[] {
  let ended = false;
  return points.map((point) => {
    if (ended) return { ...point, [key]: null };
    const value = point[key];
    if (value == null || !Number.isFinite(value)) return point;
    const capped = Math.min(100, value);
    if (capped >= 100) {
      ended = true;
      return { ...point, [key]: 100 };
    }
    return { ...point, [key]: capped };
  });
}

function inclusiveSpanDays(startDate: string, endDate: string): number {
  if (!startDate || !endDate || endDate < startDate) return 0;
  return exclusiveDaysBetween(startDate, endDate) + 1;
}

/**
 * Original approved window vs Target/revised window.
 * Target uses the revised completion date and drops suspension days from elapsed time.
 * When there is no revision, both windows match and the curves overlap.
 */
function resolveTheoreticalWindows(input: {
  projectStart: string;
  originalStart: string | null;
  plannedEnd: string | null;
  projectDuration: number;
  suspension: SuspensionWindow | null;
}): { original: TheoreticalCurveWindow; target: TheoreticalCurveWindow; differs: boolean } {
  const duration = Math.max(1, Math.floor(input.projectDuration) || 1);
  const start = (input.originalStart || input.projectStart).slice(0, 10);
  const originalEnd = (input.plannedEnd || addDays(start, duration)).slice(0, 10);
  const originalSpan = Math.max(1, exclusiveDaysBetween(start, originalEnd));
  const original: TheoreticalCurveWindow = {
    startDate: start,
    endDate: originalEnd,
    totalDurationDays: originalSpan,
  };

  const suspension = input.suspension;
  const sStart = suspension?.start?.slice(0, 10) || '';
  const sEnd = suspension?.end?.slice(0, 10) || '';
  const hasSuspension = !!(sStart && sEnd && sEnd >= sStart);
  const revisedEnd = (suspension?.revisedCompletion || originalEnd).slice(0, 10);
  const targetEnd = revisedEnd >= start ? revisedEnd : originalEnd;
  const targetWindow: TheoreticalCurveWindow = {
    startDate: start,
    endDate: targetEnd,
    totalDurationDays: 1,
    suspensionStart: hasSuspension ? sStart : null,
    suspensionEnd: hasSuspension ? sEnd : null,
  };
  const suspDays =
    hasSuspension && targetEnd > sEnd ? inclusiveSpanDays(sStart, sEnd) : 0;
  const workingAtEnd = Math.max(1, exclusiveDaysBetween(start, targetEnd) - suspDays);
  targetWindow.totalDurationDays = Math.max(1, theoreticalElapsedDays(targetEnd, targetWindow) || workingAtEnd);

  const differs =
    targetWindow.endDate !== original.endDate ||
    targetWindow.totalDurationDays !== original.totalDurationDays ||
    hasSuspension;
  return { original, target: targetWindow, differs };
}

/** Daily cosine fill for Original or Target. Does not change Actual. */
function fillTheoreticalDaily(
  points: SCurvePoint[],
  window: TheoreticalCurveWindow,
  key: 'originalPlan' | 'currentPlan',
): SCurvePoint[] {
  const start = window.startDate.slice(0, 10);
  const end = window.endDate.slice(0, 10);
  if (!start || !end || end < start) return points;

  const byDate = new Map<string, SCurvePoint>();
  for (const point of points) {
    const date = point.date.slice(0, 10);
    byDate.set(date, { ...point, date, pointDate: point.pointDate ?? date });
  }

  let cursor = start;
  for (let guard = 0; cursor && cursor <= end && guard < 1200; guard += 1) {
    const prior = byDate.get(cursor) ?? {
      date: cursor,
      pointDate: cursor,
      label: cursor,
      periodLabel: null,
      originalPlan: null,
      currentPlan: null,
      actual: null,
    };
    const raw = theoreticalSchedulePct(cursor, window);
    const value = raw == null ? null : round2(raw);
    const nextPoint: SCurvePoint = { ...prior, [key]: value };
    if (key === 'currentPlan') {
      nextPoint.variance =
        prior.actual != null && value != null ? round2(prior.actual - value) : null;
    }
    byDate.set(cursor, nextPoint);
    if (cursor === end) break;
    const next = addCalendarDays(cursor, 1);
    if (!next || next <= cursor) break;
    cursor = next;
  }

  for (const [date, point] of byDate) {
    if ((date < start || date > end) && point[key] != null) {
      const cleared: SCurvePoint = { ...point, [key]: null };
      if (key === 'currentPlan') cleared.variance = null;
      byDate.set(date, cleared);
    }
  }

  return [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter(
      (point) => point.originalPlan != null || point.currentPlan != null || point.actual != null,
    );
}

/** Daily Original cosine fill from planned start → planned end (overwrites Original). */
function fillOriginalTheoreticalDaily(
  points: SCurvePoint[],
  startDate: string | null | undefined,
  endDate: string | null | undefined,
): SCurvePoint[] {
  const start = startDate?.slice(0, 10) || '';
  const end = endDate?.slice(0, 10) || '';
  if (!start || !end || end < start) return points;

  const byDate = new Map<string, SCurvePoint>();
  for (const point of points) {
    const date = point.date.slice(0, 10);
    byDate.set(date, { ...point, date, pointDate: point.pointDate ?? date });
  }

  let cursor = start;
  for (let guard = 0; cursor && cursor <= end && guard < 800; guard += 1) {
    const prior = byDate.get(cursor) ?? {
      date: cursor,
      pointDate: cursor,
      label: cursor,
      periodLabel: null,
      originalPlan: null,
      currentPlan: null,
      actual: null,
    };
    const raw = originalTheoreticalPct(start, end, cursor);
    byDate.set(cursor, {
      ...prior,
      originalPlan: raw == null ? null : round2(raw),
    });
    if (cursor === end) break;
    const next = addCalendarDays(cursor, 1);
    if (!next || next <= cursor) break;
    cursor = next;
  }

  for (const [date, point] of byDate) {
    if (date > end && point.originalPlan != null) {
      byDate.set(date, { ...point, originalPlan: null });
    }
  }

  return [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter(
      (point) => point.originalPlan != null || point.currentPlan != null || point.actual != null,
    );
}

function targetPctOnDate(
  asOf: string,
  stewaPlan: StewaPlanBasis | null,
  ctx: {
    projectStart: string;
    activities: PdmActivity[];
    costItems: SCurveCostItem[];
    suspension?: SuspensionWindow | null;
  },
): number | null {
  if (stewaPlan) {
    const full = plannedCompletionDate(stewaPlan);
    const clamped = full && asOf > full ? full : asOf;
    return revisedStewaPlannedPercent({
      noticeToProceed: stewaPlan.noticeToProceed,
      contractDurationDays: stewaPlan.contractDurationDays,
      suspensionDays: stewaPlan.suspensionDays,
      asOf: clamped,
      suspensionStart: ctx.suspension?.start,
      suspensionEnd: ctx.suspension?.end,
    });
  }
  return pdmPlannedPercentOnDate({
    projectStart: ctx.projectStart,
    activities: ctx.activities,
    costItems: ctx.costItems,
    date: asOf,
    suspension: ctx.suspension,
  });
}

/**
 * Candidate C reshape: Original = cosine theoretical, Target = revised STEWA / PDM weight,
 * Actual = SWA accomplishment only. Dense daily sampling from NTP+9 when a STEWA plan exists.
 */
function reshapePlanCurves(
  points: SCurvePoint[],
  input: {
    noticeToProceed: string;
    suspension?: SuspensionWindow | null;
    originalPlannedEndDate?: string | null;
    plannedStartDate?: string | null;
    activities: PdmActivity[];
    costItems: SCurveCostItem[];
    swaAccomplishmentByDate: Map<string, number>;
    swaReports: ReportProgressEntry[];
    stewaPlan: StewaPlanBasis | null;
    originalDurationDays?: number | null;
  },
): SCurvePoint[] {
  const suspension = input.suspension;
  const stewaPlan =
    input.stewaPlan?.contractDurationDays ? input.stewaPlan : null;
  const plannedStart = input.plannedStartDate?.slice(0, 10) || null;
  const originalEnd = input.originalPlannedEndDate?.slice(0, 10) || null;
  const periodStartNtp = stewaPlan
    ? addCalendarDays(stewaPlan.noticeToProceed, 9)
    : null;
  const revisedEnd =
    (stewaPlan
      ? plannedCompletionDate({
          noticeToProceed: stewaPlan.noticeToProceed,
          contractDurationDays: stewaPlan.contractDurationDays,
          suspensionDays: stewaPlan.suspensionDays,
        })
      : null) ||
    suspension?.revisedCompletion ||
    originalEnd;
  const horizon = (
    [originalEnd, revisedEnd].filter((date): date is string => !!date).sort().at(-1) ||
    plannedStart ||
    input.plannedStartDate ||
    input.noticeToProceed
  ).slice(0, 10);

  const dates = new Set<string>();
  if (plannedStart) dates.add(plannedStart);
  let cursor = plannedStart;
  for (let guard = 0; cursor && cursor < horizon && guard < 500; guard += 1) {
    const next = addCalendarDays(cursor, 7);
    if (!next || next > horizon) break;
    dates.add(next);
    cursor = next;
  }
  if (originalEnd) dates.add(originalEnd);
  if (revisedEnd) dates.add(revisedEnd);
  if (periodStartNtp && revisedEnd) {
    let day = periodStartNtp;
    for (let guard = 0; day && day <= revisedEnd && guard < 800; guard += 1) {
      dates.add(day);
      const next = addCalendarDays(day, 1);
      if (!next || next <= day) break;
      day = next;
    }
  }
  if (suspension?.start && suspension.end) {
    dates.add(suspension.start);
    dates.add(suspension.end);
    const dayBefore = addCalendarDays(suspension.start, -1);
    if (dayBefore) dates.add(dayBefore);
    const dayAfter = addCalendarDays(suspension.end, 1);
    if (dayAfter) dates.add(dayAfter);
    if (suspension.revisedCompletion) dates.add(suspension.revisedCompletion);
  }
  for (const report of input.swaReports) {
    if (report.date) dates.add(report.date.slice(0, 10));
  }
  const priorByDate = new Map(points.map((point) => [point.date.slice(0, 10), point]));
  for (const point of points) dates.add(point.date.slice(0, 10));
  if (plannedStart) dates.add(plannedStart);
  if (originalEnd) dates.add(originalEnd);

  let shaped = [...dates].sort().map((date): SCurvePoint => {
    const prior = priorByDate.get(date);
    const duration =
      input.originalDurationDays != null && Number(input.originalDurationDays) > 0
        ? Number(input.originalDurationDays)
        : (stewaPlan?.contractDurationDays ?? null);
    const periodStart =
      (plannedStart
        ? null
        : stewaPlan?.noticeToProceed
          ? addCalendarDays(stewaPlan.noticeToProceed, 9)
          : null) ?? plannedStart;
    const suspDays = stewaPlan?.suspensionDays ?? null;
    const rawOriginal =
      periodStart && duration
        ? originalTheoreticalPct(
            plannedStart ?? periodStart,
            originalEnd ?? periodStart,
            date,
            duration,
            periodStart,
            suspDays,
            suspension?.start ?? null,
            suspension?.end ?? null,
          )
        : plannedStart && originalEnd
          ? originalTheoreticalPct(plannedStart, originalEnd, date, duration)
          : null;
    const originalPlan = rawOriginal == null ? null : round2(rawOriginal);

    const currentPlan = stewaPlan
      ? revisedStewaPlannedPercent({
          noticeToProceed: stewaPlan.noticeToProceed,
          contractDurationDays: stewaPlan.contractDurationDays,
          suspensionDays: stewaPlan.suspensionDays,
          asOf: date,
          suspensionStart: suspension?.start,
          suspensionEnd: suspension?.end,
        })
      : plannedStart && date >= plannedStart
        ? pdmPlannedPercentOnDate({
            projectStart: plannedStart,
            activities: input.activities,
            costItems: input.costItems,
            date,
            suspension,
          })
        : null;

    let actual: number | null = null;
    if (plannedStart) {
      if (date < plannedStart) {
        actual = null;
      } else if (input.swaAccomplishmentByDate.has(date)) {
        actual = input.swaAccomplishmentByDate.get(date) ?? null;
      } else if (date === plannedStart && input.swaReports.length > 0) {
        actual = 0;
      }
    } else if (input.swaAccomplishmentByDate.has(date)) {
      actual = input.swaAccomplishmentByDate.get(date) ?? null;
    } else if (
      input.swaReports.length > 0 &&
      date === input.noticeToProceed?.slice(0, 10)
    ) {
      actual = 0;
    }

    return {
      date,
      pointDate: date,
      label: prior?.label || date,
      periodLabel: prior?.periodLabel ?? null,
      originalPlan,
      currentPlan,
      actual,
      variance:
        actual != null && currentPlan != null ? round2(actual - currentPlan) : null,
      targetAccomplishmentPct: null,
      targetAccomplishmentPhp: null,
      cumulativePct: null,
      cumulativePhp: null,
    };
  });

  shaped = hideSeriesAfter(shaped, 'originalPlan', originalEnd);
  shaped = hideSeriesAfter(shaped, 'currentPlan', revisedEnd);
  shaped = endSeriesAtFirstFull(shaped, 'actual');
  shaped = fillOriginalTheoreticalDaily(shaped, plannedStart, originalEnd);
  return shaped.filter(
    (point) => point.originalPlan != null || point.currentPlan != null || point.actual != null,
  );
}

interface SCurveSettingsState {
  curveType: SCurveType;
  reportingInterval: SCurveReportingInterval;
  theoreticalTotalPeriods: number;
  theoreticalDurationDays: number;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeSCurveSettings(
  raw: Record<string, unknown> | null,
  projectDuration: number,
): SCurveSettingsState {
  const reportingInterval = isSCurveReportingInterval(raw?.reportingInterval)
    ? raw.reportingInterval
    : '30_day';
  const curveType =
    raw?.activeCurveType === 'ideal_theoretical'
      ? ('ideal_theoretical' as const)
      : ('pdm_based' as const);
  const fallbackPeriods = Math.max(1, Math.ceil(Math.max(1, projectDuration) / intervalDays(reportingInterval)));
  const theoreticalTotalPeriods = Math.max(
    1,
    Number(raw?.theoreticalTotalPeriods ?? fallbackPeriods),
  );
  return {
    curveType,
    reportingInterval,
    theoreticalTotalPeriods,
    theoreticalDurationDays: theoreticalTotalPeriods * intervalDays(reportingInterval),
  };
}

/** Actual accomplishment is 0 at the project start, then follows reported values only. */
function anchorActualSeriesAtStart(points: SCurvePoint[]): SCurvePoint[] {
  if (!points.some((point) => point.actual != null)) return points;
  const start = [...points].sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!start || start.actual != null) return points;
  return points.map((point) => (point.date === start.date ? { ...point, actual: 0 } : point));
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function periodForDate(
  startDate: string,
  periods: SCurvePeriodRow[],
  date: string,
  reportingInterval: SCurveReportingInterval,
): SCurvePeriodRow | null {
  if (periods.length === 0) return null;
  const index = Math.min(periods.length, periodIndexForDate(startDate, date, reportingInterval));
  return periods.find((period) => period.periodIndex === index) ?? periods[periods.length - 1];
}

/**
 * Build S-Curve skeleton points:
 * - Period ends seed Original/Target from baseline cumulative
 * - SWA sets Actual; STEWA sets Target when stewaPlannedPercent is present
 */
export function buildProgressSCurvePoints(
  startDate: string,
  periods: SCurvePeriodRow[],
  chronological: {
    date: string;
    percent: number;
    label: string;
    reportType?: string;
    stewaPlannedPercent?: number;
  }[],
  reportingInterval: SCurveReportingInterval,
): SCurvePoint[] {
  const points = new Map<string, SCurvePoint>();
  const hasSwa = chronological.some(
    (entry) =>
      entry.reportType === 'SWA' ||
      (!entry.reportType && entry.stewaPlannedPercent == null),
  );

  points.set(startDate, {
    date: startDate,
    pointDate: startDate,
    label: 'Project start',
    periodLabel: periods[0]?.label ?? 'Month 1',
    originalPlan: 0,
    currentPlan: 0,
    actual: hasSwa ? 0 : null,
    targetAccomplishmentPct: 0,
    targetAccomplishmentPhp: 0,
    cumulativePct: 0,
    cumulativePhp: 0,
  });

  for (const period of periods) {
    points.set(period.endDate, {
      date: period.endDate,
      pointDate: period.endDate,
      label: period.label,
      periodLabel: period.label,
      originalPlan: round2(period.cumulativePct),
      currentPlan: round2(period.cumulativePct),
      actual: null,
      targetAccomplishmentPct: round2(period.targetAccomplishmentPct),
      targetAccomplishmentPhp: round2(period.targetAccomplishmentPhp),
      cumulativePct: round2(period.cumulativePct),
      cumulativePhp: round2(period.cumulativePhp),
    });
  }

  for (const entry of chronological) {
    const isSwa =
      entry.reportType === 'SWA' ||
      (!entry.reportType && entry.stewaPlannedPercent == null);
    const isStewa = entry.reportType === 'STEWA';
    const existing = points.get(entry.date);
    if (existing) {
      if (isSwa) existing.actual = entry.percent;
      if (isStewa && entry.stewaPlannedPercent != null) {
        existing.currentPlan = entry.stewaPlannedPercent;
      }
      if (
        !existing.label ||
        existing.label.startsWith('Month') ||
        existing.label.startsWith('5-Day') ||
        existing.label.startsWith('10-Day') ||
        existing.label.startsWith('15-Day') ||
        existing.label.startsWith('20-Day')
      ) {
        existing.label = entry.label;
      }
      continue;
    }
    const period = periodForDate(startDate, periods, entry.date, reportingInterval);
    points.set(entry.date, {
      date: entry.date,
      pointDate: entry.date,
      label: entry.label,
      periodLabel: period?.label ?? null,
      originalPlan: null,
      currentPlan: isStewa ? (entry.stewaPlannedPercent ?? null) : null,
      actual: isSwa ? entry.percent : null,
      targetAccomplishmentPct: null,
      targetAccomplishmentPhp: null,
      cumulativePct: null,
      cumulativePhp: null,
    });
  }

  return anchorActualSeriesAtStart([...points.values()].sort((a, b) => a.date.localeCompare(b.date)));
}

function presentSCurveVersions(
  versions: SCurveSnapshotSummary[],
  feed: ReportProgressEntry[],
): SCurveSnapshotSummary[] {
  const sources = feed.filter(
    (entry) => (entry.reportType === 'SWA' || entry.reportType === 'STEWA') && entry.date,
  );
  return versions.map((version) => {
    const label = version.trigger_label?.trim() ?? '';
    if (label.startsWith('SWA') || label.startsWith('STEWA')) return version;
    const matches = sources.filter((entry) => entry.date === version.as_of_date);
    if (matches.length !== 1) return version;
    const entry = matches[0];
    const asOfLabel = entry.asOfLabel?.trim() || formatExcelDate(entry.date);
    const status = compareTargetVsActual(version.planned_pct, entry.percent);
    return {
      ...version,
      trigger_label: sCurveSourceVersionLabel(entry.reportType, asOfLabel, version.revision ?? 1),
      as_of_label: asOfLabel,
      source_report_type: entry.reportType,
      actual_pct: entry.percent,
      slippage_pct: status.slippage_pct,
      schedule_status: status.status,
    };
  });
}

function retargetPdmVersions(
  versions: SCurveSnapshotSummary[],
  input: {
    stewaPlan: StewaPlanBasis | null;
    projectStart: string;
    activities: PdmActivity[];
    costItems: SCurveCostItem[];
    suspension?: SuspensionWindow | null;
  },
): SCurveSnapshotSummary[] {
  return versions.map((version) => {
    const asOf = version.as_of_date || reportingDateFromSCurveLabel(version.trigger_label ?? '') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return version;
    const target = targetPctOnDate(asOf, input.stewaPlan, {
      projectStart: input.projectStart,
      activities: input.activities,
      costItems: input.costItems,
      suspension: input.suspension,
    });
    const status = compareTargetVsActual(target, version.actual_pct);
    return {
      ...version,
      planned_pct: target,
      slippage_pct: status.slippage_pct,
      schedule_status: status.status,
    };
  });
}

function chronologicalThroughReport(
  chronological: ReportProgressEntry[],
  reportId: string,
): { entries: ReportProgressEntry[]; selected: ReportProgressEntry } | null {
  const selected = chronological.find((entry) => entry.id === reportId);
  if (!selected) return null;
  return {
    selected,
    entries: chronological.filter((entry) => entry.date < selected.date || entry.id === selected.id),
  };
}

export async function getSCurveFs(
  projectId: string | number,
  snapshotId?: string | number | null,
  reportingInterval?: SCurveReportingInterval,
  options?: { throughReportId?: string; curveType?: SCurveType },
) {
  const id = asId(projectId);

  // One shared context for the selected project + versions in parallel.
  const [ctx, versions, snapshotData] = await Promise.all([
    loadProjectChartContext(id),
    loadSCurveVersions(id),
    snapshotId != null && asId(snapshotId)
      ? getDoc(doc(db, sCurveSnapshotsPath(id), asId(snapshotId)))
          .then((snap) => (snap.exists() ? (snap.data() as Record<string, unknown>) : null))
          .catch(() => null)
      : Promise.resolve(null),
  ]);
  const snapshotPoints = (snapshotData?.points as SCurvePoint[] | undefined) ?? null;
  const snapshotAsOf = String(snapshotData?.asOfDate ?? '').slice(0, 10);
  const snapshotReportingDate =
    /^\d{4}-\d{2}-\d{2}$/.test(snapshotAsOf)
      ? snapshotAsOf
      : reportingDateFromSCurveLabel(String(snapshotData?.triggerLabel ?? '')) ?? '';
  const snapshotActual = snapshotData?.actualPct != null ? Number(snapshotData.actualPct) : null;
  const snapshotLabel = (snapshotData?.triggerLabel as string | null) ?? null;

  const schedule = ctx.schedule;
  const feed = ctx.feed;
  const swaReports = feed
    .filter((entry) => entry.reportType === 'SWA' && entry.date)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  const stewaReports = feed
    .filter((entry) => entry.reportType === 'STEWA' && entry.date)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  const stewaPlan = resolveStewaPlan(stewaReports);
  const swaAccomplishmentByDate = buildSwaAccomplishmentByDate(
    swaReports,
    stewaReports.map((entry) => entry.date),
  );
  let { actualPct, latestReport, chronological } = resolveTargetAndActual(feed);
  const allChronological = chronological;
  let viewingMatchedReport = false;
  if (options?.throughReportId) {
    const through = chronologicalThroughReport(chronological, options.throughReportId);
    if (!through) {
      throw new Error('Choose an SWA or STEWA that belongs to this project.');
    }
    chronological = through.entries;
    const swaMatch = swaReports.find((entry) => entry.id === options.throughReportId);
    if (swaMatch) {
      actualPct = swaMatch.percent;
      latestReport = swaMatch;
    } else {
      const stewaMatch = stewaReports.find((entry) => entry.id === options.throughReportId);
      if (stewaMatch) {
        latestReport = stewaMatch;
        const priorSwa = swaReports.filter((entry) => entry.date <= stewaMatch.date).at(-1);
        actualPct = priorSwa ? priorSwa.percent : null;
      } else {
        actualPct = through.selected.percent;
        latestReport = through.selected;
      }
    }
  }
  if (snapshotData) {
    const sourceId = snapshotData.sourceReportId ? String(snapshotData.sourceReportId) : '';
    const dated = snapshotReportingDate
      ? allChronological.filter((entry) => entry.date === snapshotReportingDate && entry.id)
      : [];
    const through =
      (sourceId ? chronologicalThroughReport(allChronological, sourceId) : null) ??
      (dated.length === 1 ? chronologicalThroughReport(allChronological, dated[0].id ?? '') : null);
    if (through) {
      chronological = through.entries;
      actualPct = through.selected.percent;
      latestReport = through.selected;
      viewingMatchedReport = true;
    } else if (snapshotReportingDate) {
      chronological = allChronological.filter((entry) => entry.date <= snapshotReportingDate);
      latestReport = chronological[chronological.length - 1] ?? null;
      if (latestReport) actualPct = latestReport.percent;
    }
    if (!viewingMatchedReport && snapshotActual != null && Number.isFinite(snapshotActual)) {
      actualPct = snapshotActual;
    }
  }
  const start = ctx.projectStart;
  const duration = Math.max(1, schedule.projectDuration || 110);

  const effectiveCurveType = options?.curveType ?? ctx.settings.curveType;
  const settingsBase: SCurveSettingsState = {
    curveType: effectiveCurveType,
    reportingInterval: ctx.settings.reportingInterval,
    theoreticalTotalPeriods: ctx.settings.theoreticalTotalPeriods,
    theoreticalDurationDays: ctx.settings.theoreticalDurationDays,
  };
  const settings =
    reportingInterval == null
      ? settingsBase
      : {
          ...settingsBase,
          reportingInterval,
          theoreticalDurationDays:
            settingsBase.theoreticalTotalPeriods * intervalDays(reportingInterval),
        };

  const storedCostItems = ctx.settings.costItems as StoredSCurveCostItem[];
  const costWeights = await resolveSCurveCostWeights(
    id,
    schedule.activities,
    storedCostItems,
    ctx.settings.rawCurveData?.costWeightMappings,
  );
  const costSummary = costWeights.summary;
  // Amounts must track theoretical / PDM interval % against a real contract total.
  // When mapped cost rows are empty, fall back to the project's contract amount.
  const totalContractAmount =
    costSummary.totalContractAmount > 0
      ? costSummary.totalContractAmount
      : Math.max(0, Number(ctx.projectContractAmount) || 0);
  const suspension = readSuspensionWindow({
    baselineMode:
      ctx.baselineMode === 'prior_suspension' ||
      (ctx.suspensionStartDate && ctx.suspensionEndDate)
        ? 'prior_suspension'
        : ctx.baselineMode,
    suspensionStart: ctx.suspensionStartDate,
    suspensionEnd: ctx.suspensionEndDate,
    revisedCompletion: ctx.revisedCompletionDate,
    plannedEndDate: ctx.projectPlannedEnd,
    projectStart: ctx.projectStart,
  });
  const theoreticalWindows =
    settings.curveType === 'ideal_theoretical'
      ? resolveTheoreticalWindows({
          projectStart: start,
          originalStart: ctx.originalProjectStart,
          plannedEnd: ctx.projectPlannedEnd,
          projectDuration: duration,
          suspension,
        })
      : null;
  const periods = theoreticalWindows
    ? buildTheoreticalTargetPeriods({
        window: theoreticalWindows.target,
        totalContractAmount,
        reportingInterval: settings.reportingInterval,
      })
    : buildSCurvePeriods({
        startDate: start,
        projectDuration: duration,
        activities: schedule.activities,
        costItems: costSummary.items,
        totalContractAmount,
        reportingInterval: settings.reportingInterval,
      });
  const revisedPeriods = suspension
    ? buildRevisedBaselinePeriods({
        projectStart: start,
        activities: schedule.activities,
        costItems: costSummary.items,
        totalContractAmount,
        reportingInterval: settings.reportingInterval,
        suspension,
      })
    : null;
  const rawCurve = ctx.settings.rawCurveData;
  const periodsCustomized = rawCurve?.periodsCustomized === true;
  const periodCountCustomized = rawCurve?.periodCountCustomized === true;
  const storedBaseline = readStoredSCurvePeriods(rawCurve?.baselinePeriods);
  const periodEdits = readSCurvePeriodEdits(rawCurve?.periodEdits);
  // Candidate C: use locked baseline only while viewing a snapshot; live view stays on formula periods.
  const viewingSnapshot = snapshotId != null && Boolean(asId(snapshotId));
  const targetPeriods =
    viewingSnapshot && periodsCustomized && storedBaseline.length > 0 ? storedBaseline : periods;
  if (periodsCustomized && storedBaseline.length === 0) {
    const access = await getAccessContext();
    if (canEditSCurvePeriods(access?.role)) {
      void setDoc(
        doc(db, COLLECTIONS.sCurves, id),
        {
          projectId: id,
          baselinePeriods: periods,
          periodsCustomized: true,
          updatedAt: nowIso(),
        },
        { merge: true },
      ).catch(() => {
        /* period editors lock the baseline once; ignore a denied write */
      });
    }
  }
  let displayPeriods = targetPeriods.map((row) => ({ ...row }));
  displayPeriods = applySCurvePeriodEdits(displayPeriods, periodEdits, totalContractAmount);
  const monitoringPeriods = revisedPeriods ?? displayPeriods;
  const theoreticalLive = theoreticalWindows != null && !viewingSnapshot;
  const usePlanCurves =
    settings.curveType === 'pdm_based' || (stewaPlan != null && !theoreticalLive);
  const activities: SCurveActivity[] = schedule.activities.map((activity) => {
    const finishDate = addDays(start, activity.ef ?? activity.duration);
    const period = periodForDate(start, targetPeriods, finishDate, settings.reportingInterval);
    const plannedPct =
      settings.curveType === 'pdm_based'
        ? pdmPlannedPercentOnDate({
            projectStart: start,
            activities: schedule.activities,
            costItems: costSummary.items,
            date: finishDate,
            suspension,
          })
        : period
          ? round2(period.cumulativePct)
          : 0;
    return {
      id: activity.id,
      number: activity.number,
      name: activity.name,
      duration: activity.duration,
      es: activity.es ?? 0,
      ef: activity.ef ?? activity.duration,
      finish_date: finishDate,
      planned_pct: plannedPct,
      is_critical: !!activity.isCritical,
    };
  });
  let points = buildProgressSCurvePoints(
    start,
    theoreticalLive ? displayPeriods : monitoringPeriods,
    chronological.map((entry) => ({
      date: entry.date,
      percent: entry.percent,
      label: entry.label,
      reportType: entry.reportType,
      stewaPlannedPercent: entry.stewaPlannedPercent,
    })),
    settings.reportingInterval,
  );
  if (theoreticalLive && theoreticalWindows) {
    points = fillTheoreticalDaily(points, theoreticalWindows.original, 'originalPlan');
    points = fillTheoreticalDaily(points, theoreticalWindows.target, 'currentPlan');
  } else if (usePlanCurves) {
    points = reshapePlanCurves(points, {
      noticeToProceed: start,
      suspension,
      originalPlannedEndDate: ctx.projectPlannedEnd,
      plannedStartDate: ctx.originalProjectStart ?? null,
      activities: schedule.activities,
      costItems: costSummary.items,
      swaAccomplishmentByDate,
      swaReports,
      stewaPlan,
      originalDurationDays: schedule.projectDuration || null,
    });
  } else if (revisedPeriods && suspension) {
    points = stampOriginalPlan(points, targetPeriods, revisedPeriods);
    points = flattenSuspensionPoints(
      points,
      targetPeriods,
      start,
      schedule.activities,
      costSummary.items,
      suspension,
    );
    const originalEnd =
      ctx.projectPlannedEnd || targetPeriods[targetPeriods.length - 1]?.endDate || null;
    if (originalEnd) {
      points = points.map((point) =>
        point.date > originalEnd ? { ...point, originalPlan: null } : point,
      );
    }
    points = fillOriginalTheoreticalDaily(points, start, ctx.projectPlannedEnd || originalEnd);
  } else {
    points = fillOriginalTheoreticalDaily(points, start, ctx.projectPlannedEnd);
  }

  const asOfDate = snapshotReportingDate || latestReport?.date || nowIso().slice(0, 10);
  const originalTargetPeriod = periodForDate(start, targetPeriods, asOfDate, settings.reportingInterval);
  const theoreticalTarget =
    theoreticalLive && theoreticalWindows
      ? theoreticalPlanPct(asOfDate, theoreticalWindows.target)
      : null;
  const planTarget = usePlanCurves
    ? targetPctOnDate(asOfDate, stewaPlan, {
        projectStart: start,
        activities: schedule.activities,
        costItems: costSummary.items,
        suspension,
      })
    : null;
  const effectiveTarget =
    theoreticalTarget != null
      ? round2(theoreticalTarget)
      : planTarget != null
        ? planTarget
        : originalTargetPeriod
          ? round2(originalTargetPeriod.cumulativePct)
          : null;
  const effectiveTargetPhp =
    theoreticalTarget != null
      ? round2((theoreticalTarget * totalContractAmount) / 100)
      : planTarget != null
        ? round2((planTarget * totalContractAmount) / 100)
        : originalTargetPeriod
          ? round2(originalTargetPeriod.cumulativePhp)
          : null;

  if (snapshotPoints && !viewingMatchedReport) {
    points = snapshotPoints;
    if (usePlanCurves) {
      points = reshapePlanCurves(points, {
        noticeToProceed: start,
        suspension,
        originalPlannedEndDate: ctx.projectPlannedEnd,
        plannedStartDate: ctx.originalProjectStart ?? null,
        activities: schedule.activities,
        costItems: costSummary.items,
        swaAccomplishmentByDate,
        swaReports,
        stewaPlan,
        originalDurationDays: schedule.projectDuration || null,
      });
    }
  } else if (!options?.curveType && !options?.throughReportId && !snapshotData) {
    // Persist in the background — do not block the page render on Firestore write.
    // Skip entirely for view-only roles (Engineer II–IV) to avoid permission-denied noise.
    const access = await getAccessContext();
    if (canEditProjectCharts(access?.role)) {
      // Candidate C: never persist SWA-derived cost rows — that would replace the
      // full SWA contract total with only the mapped activity amounts.
      const payload: Record<string, unknown> = {
        projectId: id,
        points,
        activeCurveType: settings.curveType,
        reportingInterval: settings.reportingInterval,
        theoreticalTotalPeriods: settings.theoreticalTotalPeriods,
        targetPlanPct: effectiveTarget,
        targetPlanPhp: effectiveTargetPhp,
        actualPlanPct: actualPct,
        baselineReportNumber: latestReport?.reportNumber ?? null,
        updatedAt: nowIso(),
      };
      if (costWeights.source !== 'swa') {
        payload.costItems = costSummary.items.map((item) => ({
          activityId: item.activityId,
          itemNo: item.itemNo,
          description: item.description,
          quantity: Number(item.quantity) || 0,
          unitCost: Number(item.unitCost) || 0,
        }));
      }
      void setDoc(doc(db, COLLECTIONS.sCurves, id), payload, { merge: true }).catch(() => {
        /* ignore transient write failures */
      });
    }
  }

  points = anchorActualSeriesAtStart(points);
  points = stampRecordedActual(points, [...swaReports, ...stewaReports], suspension, start);

  const status = compareTargetVsActual(effectiveTarget, actualPct);
  const recordedActualByDate = genuineActualByDate([...swaReports, ...stewaReports]);

  // Candidate C: one comparison row per unique SWA/STEWA date (not per chronological feed entry).
  const comparisonRows: SCurveComparison[] = Array.from(
    new Set([
      ...swaReports.map((entry) => entry.date.slice(0, 10)),
      ...stewaReports.map((entry) => entry.date.slice(0, 10)),
    ]),
  )
    .sort()
    .map((date) => {
      const swaEntry = swaReports.find((entry) => entry.date.slice(0, 10) === date);
      const stewaEntry = stewaReports.find((entry) => entry.date.slice(0, 10) === date);
      const label = swaEntry?.label ?? stewaEntry?.label ?? date;
      const period = periodForDate(start, targetPeriods, date, settings.reportingInterval);
      const theoreticalRow =
        theoreticalLive && theoreticalWindows
          ? theoreticalPlanPct(date, theoreticalWindows.target)
          : null;
      const target =
        theoreticalRow != null
          ? theoreticalRow
          : usePlanCurves
            ? (targetPctOnDate(date, stewaPlan, {
                projectStart: start,
                activities: schedule.activities,
                costItems: costSummary.items,
                suspension,
              }) ?? 0)
            : period
              ? round2(period.cumulativePct)
              : 0;
      const targetPhp = round2((target * totalContractAmount) / 100);
      const actual = recordedActualByDate.get(date) ?? null;
      const variance = actual != null ? Math.round((actual - target) * 100) / 100 : 0;
      const st =
        actual == null
          ? 'target_only'
          : Math.abs(variance) < 0.05
            ? 'on_schedule'
            : actual > target
              ? 'ahead'
              : 'behind';
      return {
        date,
        date_label: label,
        target_pct: round2(target),
        target_php: targetPhp,
        actual_pct: actual != null ? round2(actual) : 0,
        variance_pct: variance,
        status: st as SCurveComparison['status'],
        status_label: statusDisplayLabel(st),
      };
    });

  const projectEndDate = revisedPeriods
    ? suspension?.revisedCompletion ||
      revisedPeriods[revisedPeriods.length - 1]?.endDate ||
      addDays(start, duration)
    : ctx.projectPlannedEnd || displayPeriods[displayPeriods.length - 1]?.endDate || addDays(start, duration);

  return {
    project_id: id,
    project_duration: duration,
    project_start_date: start,
    project_end_date: projectEndDate,
    critical_path: schedule.criticalPath,
    points,
    activities,
    cost_items: costSummary.items,
    periods: displayPeriods,
    period_edits: periodEdits,
    total_contract_amount: costSummary.totalContractAmount,
    total_weight_pct: costSummary.totalWeightPct,
    weight_note: costWeights.weightNote,
    pay_item_mappings: costWeights.payItemMappings,
    synced_from_pdm: schedule.activities.length > 0,
    has_actual_progress: chronological.length >= 1,
    has_revised_schedule:
      settings.curveType === 'pdm_based' ||
      revisedPeriods != null ||
      Boolean(theoreticalWindows?.differs),
    schedule_status: status,
    comparisons: comparisonRows,
    report_feed: feed,
    latest_report_percent: actualPct ?? effectiveTarget,
    latest_report_date:
      snapshotReportingDate ||
      latestReport?.date ||
      (chronological.length ? chronological[chronological.length - 1].date : null),
    reporting_interval: settings.reportingInterval,
    curve_type: settings.curveType,
    theoretical_total_periods: periodCountCustomized
      ? settings.theoreticalTotalPeriods
      : Math.max(1, displayPeriods.length),
    theoretical_duration_days: periodCountCustomized
      ? settings.theoreticalTotalPeriods * intervalDays(settings.reportingInterval)
      : settings.curveType === 'ideal_theoretical'
        ? Math.max(1, displayPeriods.length) * intervalDays(settings.reportingInterval)
        : settings.theoreticalDurationDays,
    target_plan_percent: effectiveTarget,
    target_plan_php: effectiveTargetPhp,
    actual_plan_percent: actualPct,
    versions: usePlanCurves
      ? retargetPdmVersions(presentSCurveVersions(versions as SCurveSnapshotSummary[], feed), {
          stewaPlan,
          projectStart: start,
          activities: schedule.activities,
          costItems: costSummary.items,
          suspension,
        })
      : presentSCurveVersions(versions as SCurveSnapshotSummary[], feed),
    viewing_snapshot_id: snapshotId != null ? asId(snapshotId) : null,
    viewing_snapshot_label:
      (snapshotId != null
        ? presentSCurveVersions(versions as SCurveSnapshotSummary[], feed).find(
            (version) => version.id === asId(snapshotId),
          )?.trigger_label
        : null) ?? snapshotLabel,
    viewing_snapshot_at: snapshotData?.capturedAt != null ? String(snapshotData.capturedAt) : null,
  };
}

function sourceSnapshotId(reportId: string): string {
  return `src_${reportId}`;
}

/** One snapshot document per SWA/STEWA. A later explicit generate updates that same version. */
async function writeReportSCurveSnapshot(args: {
  projectId: string;
  report: ReportProgressEntry;
  curve: Awaited<ReturnType<typeof getSCurveFs>>;
  bumpRevision: boolean;
}) {
  if (!args.report.id) {
    throw new Error('Choose an SWA or STEWA reporting period.');
  }
  const ref = doc(db, sCurveSnapshotsPath(args.projectId), sourceSnapshotId(args.report.id));
  const existing = await getDoc(ref);
  const previousRevision = existing.exists() ? Number(existing.data().revision ?? 1) || 1 : 0;
  const previousTrigger = existing.exists() ? String(existing.data().triggerType ?? '') : '';
  let revision = 1;
  if (existing.exists()) {
    revision =
      args.bumpRevision && previousTrigger === 'swa_stewa'
        ? previousRevision + 1
        : Math.max(1, previousRevision);
  }
  const asOfLabel = args.report.asOfLabel?.trim() || formatExcelDate(args.report.date);
  const label = sCurveSourceVersionLabel(args.report.reportType, asOfLabel, revision);
  await setDoc(ref, {
    points: args.curve.points,
    capturedAt: nowIso(),
    triggerType: args.bumpRevision || previousTrigger === 'swa_stewa' ? 'swa_stewa' : 'swa_stewa_progress',
    triggerLabel: label,
    asOfDate: args.report.date,
    asOfLabel,
    sourceReportId: args.report.id,
    sourceReportType: args.report.reportType,
    sourceReportNumber: args.report.reportNumber,
    revision,
    basis: args.curve.has_revised_schedule ? 'revised' : 'pdm',
    scheduleStatus: args.curve.schedule_status.status,
    slippagePct: args.curve.schedule_status.slippage_pct,
    plannedPct: args.curve.schedule_status.planned_pct,
    actualPct: args.curve.schedule_status.actual_pct,
  });
  return { id: ref.id, label, asOfDate: args.report.date, asOfLabel, revision };
}

/** Rebuild and persist S-Curve after SWA/STEWA approve/update. */
export async function syncProgressCharts(projectId: string) {
  invalidateChartCaches(projectId);
  const curve = await getSCurveFs(projectId);
  const latest = curve.report_feed.find(
    (entry) => (entry.reportType === 'SWA' || entry.reportType === 'STEWA') && entry.id,
  );
  if (latest?.id) {
    await writeReportSCurveSnapshot({
      projectId,
      report: latest,
      curve,
      bumpRevision: false,
    });
  }
  invalidateChartCaches(projectId);
  return curve;
}

export async function recordSCurveSnapshot(
  projectId: string,
  meta: {
    triggerType: string;
    triggerLabel?: string;
    scheduleStatus?: string;
    slippagePct?: number | null;
    plannedPct?: number | null;
    actualPct?: number | null;
  },
) {
  const curve = await getSCurveFs(projectId);
  const ref = doc(collection(db, sCurveSnapshotsPath(projectId)));
  await setDoc(ref, {
    points: curve.points,
    capturedAt: nowIso(),
    triggerType: meta.triggerType,
    triggerLabel: meta.triggerLabel ?? null,
    scheduleStatus: meta.scheduleStatus ?? curve.schedule_status.status,
    slippagePct: meta.slippagePct ?? curve.schedule_status.slippage_pct,
    plannedPct: meta.plannedPct ?? curve.schedule_status.planned_pct,
    actualPct: meta.actualPct ?? curve.schedule_status.actual_pct,
  });
  invalidateChartCaches(projectId);
  return ref.id;
}

/** Store the S-Curve for one SWA/STEWA. Its reporting date comes from that report. */
export async function generateSwaStewaSCurveFs(projectId: string | number, reportId: string) {
  const id = asId(projectId);
  if (!reportId) {
    throw new Error('Choose an SWA or STEWA reporting period.');
  }
  const curve = await getSCurveFs(id, null, undefined, { throughReportId: reportId });
  const report = curve.report_feed.find((entry) => entry.id === reportId);
  if (!report?.id || (report.reportType !== 'SWA' && report.reportType !== 'STEWA')) {
    throw new Error('Choose an SWA or STEWA that belongs to this project.');
  }
  const saved = await writeReportSCurveSnapshot({
    projectId: id,
    report,
    curve,
    bumpRevision: true,
  });
  invalidateChartCaches(id);
  return saved;
}

export async function saveSCurveCostItemsFs(payload: {
  project_id: string | number;
  items: Array<{ activityId: string; itemNo?: string; description?: string; quantity: number; unitCost: number }>;
}) {
  await assertCanEditProjectCharts();
  const id = asId(payload.project_id);
  const ctx = await loadProjectChartContext(id);
  const schedule = ctx.schedule;
  const incomingByActivityId = new Map(payload.items.map((item) => [item.activityId, item]));
  const summary = computeSCurveCostSummary(
    schedule.activities.map((activity): SCurveCostItemInput => {
      const incoming = incomingByActivityId.get(activity.id);
      return {
        activityId: activity.id,
        itemNo: incoming && incoming.itemNo != null ? String(incoming.itemNo) : activity.number,
        description: incoming && incoming.description != null ? String(incoming.description) : activity.name,
        quantity: Number(incoming?.quantity ?? 0),
        unitCost: Number(incoming?.unitCost ?? 0),
      };
    }),
  );

  await setDoc(
    doc(db, COLLECTIONS.sCurves, id),
    {
      projectId: id,
      costItems: summary.items.map((item) => ({
        activityId: item.activityId,
        itemNo: item.itemNo,
        description: item.description,
        quantity: item.quantity,
        unitCost: item.unitCost,
      })),
      updatedAt: nowIso(),
    },
    { merge: true },
  );
  invalidateChartCaches(id);

  return {
    cost_items: summary.items as SCurveCostItem[],
    total_contract_amount: summary.totalContractAmount,
    total_weight_pct: summary.totalWeightPct,
  };
}

export async function saveSCurvePeriodsFs(payload: {
  project_id: string | number;
  theoretical_total_periods?: number;
  period_edits?: Record<string, SCurvePeriodEdit>;
}) {
  const access = await getAccessContext();
  if (!canEditSCurvePeriods(access?.role)) {
    throw new Error('You cannot edit S-Curve periods for this project.');
  }
  const id = asId(payload.project_id);
  const patch: Record<string, unknown> = {
    projectId: id,
    periodsCustomized: true,
    updatedAt: nowIso(),
  };
  if (payload.theoretical_total_periods != null) {
    patch.theoreticalTotalPeriods = Math.max(1, Math.floor(Number(payload.theoretical_total_periods) || 1));
    patch.periodCountCustomized = true;
  }
  if (payload.period_edits) {
    patch.periodEdits = payload.period_edits;
  }
  await setDoc(doc(db, COLLECTIONS.sCurves, id), patch, { merge: true });
  invalidateChartCaches(id);
  return {
    theoretical_total_periods:
      payload.theoretical_total_periods != null
        ? Math.max(1, Math.floor(Number(payload.theoretical_total_periods) || 1))
        : null,
    period_edits: payload.period_edits ?? null,
  };
}

export async function saveSCurveSettingsFs(payload: {
  project_id: string | number;
  curve_type: SCurveType;
  reporting_interval: SCurveReportingInterval;
  theoretical_total_periods?: number;
}) {
  await assertCanEditProjectCharts();
  const id = asId(payload.project_id);
  const ctx = await loadProjectChartContext(id);
  const schedule = ctx.schedule;
  const normalized = normalizeSCurveSettings(
    {
      activeCurveType: payload.curve_type,
      reportingInterval: payload.reporting_interval,
      theoreticalTotalPeriods:
        payload.theoretical_total_periods ??
        Math.max(
          1,
          Math.ceil(Math.max(1, schedule.projectDuration) / intervalDays(payload.reporting_interval)),
        ),
    },
    schedule.projectDuration,
  );

  await setDoc(
    doc(db, COLLECTIONS.sCurves, id),
    {
      projectId: id,
      activeCurveType: normalized.curveType,
      reportingInterval: normalized.reportingInterval,
      theoreticalTotalPeriods: normalized.theoreticalTotalPeriods,
      updatedAt: nowIso(),
    },
    { merge: true },
  );
  invalidateChartCaches(id);

  return {
    curve_type: normalized.curveType,
    reporting_interval: normalized.reportingInterval,
    theoretical_total_periods: normalized.theoreticalTotalPeriods,
    theoretical_duration_days: normalized.theoreticalDurationDays,
  };
}
