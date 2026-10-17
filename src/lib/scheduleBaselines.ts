import type { BarChartTask, BarChartTaskSegment, PdmActivity, SCurvePoint } from '../types';
import {
  activityDaySpan,
  buildSCurvePeriods,
  type SCurvePeriodRow,
  type SCurveReportingInterval,
} from './sCurvePeriods';
import type { SCurveCostItem } from './sCurveItems';
import { deduplicateActivities, normalizeActivityNameKey } from './pdm';

export type ProjectBaselineMode = 'active' | 'prior_suspension';

export interface SuspensionWindow {
  start: string;
  end: string;
  revisedCompletion: string;
}

function addCalendarDays(iso: string, days: number): string {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function revisedSegments(startDay: number, endDay: number, suspStartDay: number, suspLen: number) {
  if (endDay < suspStartDay) return [{ start: startDay, end: endDay }];
  if (startDay >= suspStartDay) {
    return [{ start: startDay + suspLen, end: endDay + suspLen }];
  }
  return [
    { start: startDay, end: suspStartDay - 1 },
    { start: suspStartDay + suspLen, end: endDay + suspLen },
  ];
}

/** Revised cumulative on a calendar day. Suspension days stay at the pre-suspension value. */
export function revisedCumulativeOnDay(input: {
  projectStart: string;
  activities: PdmActivity[];
  costItems: SCurveCostItem[];
  suspension: SuspensionWindow;
  date: string;
}): number {
  const day = inclusiveDayCount(input.projectStart, input.date);
  const suspStartDay = inclusiveDayCount(input.projectStart, input.suspension.start);
  const suspLen = inclusiveDayCount(input.suspension.start, input.suspension.end);
  const suspEndDay = suspStartDay + suspLen - 1;
  const asOf = day >= suspStartDay && day <= suspEndDay ? suspStartDay - 1 : day;
  const weightById = new Map(input.costItems.map((item) => [item.activityId, item.weightPct]));
  let total = 0;
  for (const activity of input.activities) {
    const weight = weightById.get(activity.id) ?? 0;
    if (weight <= 0) continue;
    const { startDay, endDay } = activityDaySpan(activity);
    const segments = revisedSegments(startDay, endDay, suspStartDay, suspLen);
    const workingDays = segments.reduce((sum, segment) => sum + (segment.end - segment.start + 1), 0);
    if (workingDays <= 0) continue;
    let elapsed = 0;
    for (const segment of segments) {
      if (asOf < segment.start) continue;
      elapsed += Math.max(0, Math.min(segment.end, asOf) - segment.start + 1);
    }
    total += (weight * elapsed) / workingDays;
  }
  return Math.min(100, Math.round(total * 100) / 100);
}

/**
 * Chart points follow period ends, so a period that straddles the suspension
 * would slope through the gap. Pin the cumulative on the suspension boundaries.
 */
export function flattenSuspensionPoints(
  points: SCurvePoint[],
  originalPeriods: SCurvePeriodRow[],
  projectStart: string,
  activities: PdmActivity[],
  costItems: SCurveCostItem[],
  suspension: SuspensionWindow,
): SCurvePoint[] {
  const frozen = revisedCumulativeOnDay({
    projectStart,
    activities,
    costItems,
    suspension,
    date: addCalendarDays(suspension.start, -1),
  });
  const next = points.map((point) =>
    point.date >= suspension.start && point.date <= suspension.end
      ? { ...point, currentPlan: frozen }
      : point,
  );
  for (const date of [suspension.start, suspension.end]) {
    if (next.some((point) => point.date === date)) continue;
    next.push({
      date,
      originalPlan: Math.round(cumulativeAtDate(originalPeriods, date) * 100) / 100,
      currentPlan: frozen,
      actual: null,
    });
  }
  next.sort((a, b) => a.date.localeCompare(b.date));
  return next;
}

/** Inclusive calendar day count. Day 1 is `start`. */
export function inclusiveDayCount(start: string, end: string): number {
  const s = Date.parse(`${start.slice(0, 10)}T00:00:00Z`);
  const e = Date.parse(`${end.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return 1;
  return Math.round((e - s) / 86_400_000) + 1;
}

/** PDM weight cumulative on a calendar date (Target fallback when no STEWA plan). */
export function pdmPlannedPercentOnDate(input: {
  projectStart: string;
  activities: PdmActivity[];
  costItems: SCurveCostItem[];
  date: string;
  suspension?: SuspensionWindow | null;
}): number {
  const projectStart = input.projectStart.slice(0, 10);
  const date = input.date.slice(0, 10);
  if (!projectStart || !date || date <= projectStart || input.activities.length === 0) return 0;

  const weightById = new Map(
    input.costItems.map((item) => [item.activityId, Number(item.weightPct) || 0]),
  );
  const costItems: SCurveCostItem[] = input.activities.map((activity) => ({
    activityId: activity.id,
    itemNo: activity.number,
    description: activity.name,
    quantity: 0,
    unitCost: 0,
    amount: 0,
    weightPct: weightById.get(activity.id) ?? 0,
  }));

  if (input.suspension) {
    return revisedCumulativeOnDay({
      projectStart,
      activities: input.activities,
      costItems,
      suspension: input.suspension,
      date,
    });
  }

  const day = inclusiveDayCount(projectStart, date);
  let total = 0;
  for (const activity of input.activities) {
    const weight = weightById.get(activity.id) ?? 0;
    if (weight <= 0) continue;
    const { startDay, endDay } = activityDaySpan(activity);
    const span = endDay - startDay + 1;
    if (span <= 0 || day < startDay) continue;
    total += (weight * (Math.min(endDay, day) - startDay + 1)) / span;
  }
  return Math.min(100, Math.round(total * 100) / 100);
}

export function readSuspensionWindow(input: {
  baselineMode?: string | null;
  status?: string | null;
  suspensionStart?: string | null;
  suspensionEnd?: string | null;
  revisedCompletion?: string | null;
  plannedEndDate?: string | null;
  projectStart?: string | null;
}): SuspensionWindow | null {
  const isSuspended =
    input.baselineMode === 'prior_suspension' ||
    input.status === 'suspended' ||
    (input.baselineMode !== 'active' && Boolean(input.suspensionStart && input.suspensionEnd));
  if (!isSuspended) return null;
  const start = input.suspensionStart?.slice(0, 10) ?? '';
  const end = input.suspensionEnd?.slice(0, 10) ?? '';
  if (!start || !end || end < start) return null;
  let revisedCompletion = input.revisedCompletion?.slice(0, 10) ?? '';
  if (!revisedCompletion && input.plannedEndDate) {
    const suspLen = inclusiveDayCount(start, end);
    revisedCompletion = addCalendarDays(input.plannedEndDate, suspLen);
  }
  if (!revisedCompletion) {
    revisedCompletion = end;
  }
  return { start, end, revisedCompletion };
}

/**
 * Revised baseline periods.
 * Original PDM days are kept. The suspension is a gap with no accomplishment.
 * Work that has not started by the suspension shifts forward by the suspension
 * length. Work that crosses the gap is split so no weight falls inside it.
 * The curve ends on the revised completion date.
 */
export function buildRevisedBaselinePeriods(input: {
  projectStart: string;
  activities: PdmActivity[];
  costItems: SCurveCostItem[];
  totalContractAmount: number;
  reportingInterval: SCurveReportingInterval;
  suspension: SuspensionWindow;
}): SCurvePeriodRow[] {
  const suspStartDay = inclusiveDayCount(input.projectStart, input.suspension.start);
  const suspLen = inclusiveDayCount(input.suspension.start, input.suspension.end);
  const revisedSpan = inclusiveDayCount(input.projectStart, input.suspension.revisedCompletion);
  const weightById = new Map(input.costItems.map((item) => [item.activityId, item]));
  const activities: PdmActivity[] = [];
  const costItems: SCurveCostItem[] = [];

  for (const activity of input.activities) {
    const source = weightById.get(activity.id);
    const weight = source?.weightPct ?? 0;
    const { startDay, endDay } = activityDaySpan(activity);
    const baseItem = source ?? {
      activityId: activity.id,
      itemNo: activity.number,
      description: activity.name,
      quantity: 0,
      unitCost: 0,
      amount: 0,
      weightPct: 0,
    };

    const push = (id: string, spanStart: number, spanEnd: number, portion: number) => {
      const clampedEnd = Math.max(spanStart, Math.min(revisedSpan, spanEnd));
      if (clampedEnd < spanStart || spanStart > revisedSpan) return;
      activities.push({
        ...activity,
        id,
        es: spanStart - 1,
        ef: clampedEnd,
        duration: clampedEnd - spanStart + 1,
      });
      costItems.push({
        ...baseItem,
        activityId: id,
        weightPct: portion,
      });
    };

    if (endDay < suspStartDay) {
      push(activity.id, startDay, endDay, weight);
      continue;
    }
    if (startDay >= suspStartDay) {
      push(activity.id, startDay + suspLen, endDay + suspLen, weight);
      continue;
    }

    const beforeDays = suspStartDay - startDay;
    const afterDays = endDay - suspStartDay + 1;
    const working = Math.max(1, beforeDays + afterDays);
    const beforeWeight = (weight * beforeDays) / working;
    push(`${activity.id}:pre`, startDay, suspStartDay - 1, beforeWeight);
    push(`${activity.id}:post`, suspStartDay + suspLen, endDay + suspLen, weight - beforeWeight);
  }

  return buildSCurvePeriods({
    startDate: input.projectStart,
    projectDuration: Math.max(1, revisedSpan),
    activities,
    costItems,
    totalContractAmount: input.totalContractAmount,
    reportingInterval: input.reportingInterval,
  });
}

/** Last planned cumulative at `date`. A date inside the suspension keeps the pre-suspension value. */
export function cumulativeAtDate(periods: SCurvePeriodRow[], date: string): number {
  if (!periods.length || date < periods[0].startDate) return 0;
  let last = 0;
  for (const period of periods) {
    if (period.endDate <= date) last = period.cumulativePct;
    if (period.startDate <= date && date <= period.endDate) return period.cumulativePct;
  }
  return last;
}

/** Keep the revised curve as currentPlan and stamp the unshifted PDM curve as originalPlan. */
export function stampOriginalPlan(
  points: SCurvePoint[],
  originalPeriods: SCurvePeriodRow[],
  revisedPeriods: SCurvePeriodRow[],
): SCurvePoint[] {
  const stamped = points.map((point) => ({
    ...point,
    currentPlan: point.originalPlan,
    originalPlan: Math.round(cumulativeAtDate(originalPeriods, point.date) * 100) / 100,
  }));
  const seen = new Set(stamped.map((point) => point.date));
  for (const period of originalPeriods) {
    if (seen.has(period.endDate)) continue;
    stamped.push({
      date: period.endDate,
      originalPlan: Math.round(period.cumulativePct * 100) / 100,
      currentPlan: Math.round(cumulativeAtDate(revisedPeriods, period.endDate) * 100) / 100,
      actual: null,
    });
  }
  stamped.sort((a, b) => a.date.localeCompare(b.date));
  return stamped;
}

export function extractCanonicalPdmId(id?: string | null): string {
  if (!id) return '';
  let clean = String(id).trim();
  clean = clean.replace(/^derived-/i, '');
  clean = clean.replace(/:(pre|post|resumed|suspended|active)$/i, '');
  clean = clean.replace(/[-_](resumed|post|suspended|active|r)$/i, '');
  clean = clean.replace(/\s*\((resumed|suspended|active|post)\)$/i, '');
  return clean.trim();
}

export function extractCanonicalItemNo(itemNo?: string | null): string {
  if (!itemNo) return '';
  let clean = String(itemNo).trim();
  clean = clean.replace(/\s*[\(\[\{]?(?:resumed|post|suspended|active)[\)\]\}]?\s*$/i, '');
  clean = clean.replace(/[-_](?:resumed|post|suspended|active|r)$/i, '');
  return clean.trim();
}

export function extractCanonicalActivityName(name?: string | null): string {
  if (!name) return '';
  let clean = String(name).trim();
  clean = clean.replace(/\s*[\(\[\{]?(?:resumed|resumption|post[-\s]?suspension|suspended)[\)\]\}]?\s*$/i, '');
  clean = clean.replace(/\s*[-–—:]\s*(?:resumed|resumption|post[-\s]?suspension|suspended)\s*$/i, '');
  clean = clean.replace(/\s*[\(\[\{]part\s*\d+[\)\]\}]\s*$/i, '');
  return clean.trim();
}

function isSamePdmActivity(a: BarChartTask, b: BarChartTask): boolean {
  // 1. Pay Item ID (Cost Item ID) match
  const payItemA = a.payItemId?.trim();
  const payItemB = b.payItemId?.trim();
  if (payItemA && payItemB && payItemA.toLowerCase() === payItemB.toLowerCase()) {
    return true;
  }

  // 2. Canonical PDM Activity ID match
  const canonIdA = extractCanonicalPdmId(a.activityId || a.id);
  const canonIdB = extractCanonicalPdmId(b.activityId || b.id);
  if (canonIdA && canonIdB && canonIdA.toLowerCase() === canonIdB.toLowerCase()) {
    return true;
  }

  // 3. Item No match
  const itemNoA = extractCanonicalItemNo(a.itemNo);
  const itemNoB = extractCanonicalItemNo(b.itemNo);
  const hasSpecificItemNo = Boolean(itemNoA && itemNoB && itemNoA.toLowerCase() === itemNoB.toLowerCase());

  // If item numbers exist and are different specific numbers (e.g. 100(1) vs 100(2)), they are NOT the same activity!
  if (itemNoA && itemNoB && itemNoA.toLowerCase() !== itemNoB.toLowerCase()) {
    return false;
  }

  // 4. Canonical Name match
  const nameA = extractCanonicalActivityName(a.name);
  const nameB = extractCanonicalActivityName(b.name);
  const nameKeyA = normalizeActivityNameKey(nameA);
  const nameKeyB = normalizeActivityNameKey(nameB);
  const hasNameMatch = Boolean(nameKeyA && nameKeyB && nameKeyA === nameKeyB);

  // If specific item numbers match AND names match (or one is generic single letter):
  if (hasSpecificItemNo) {
    if (hasNameMatch) return true;
    if (nameKeyA.includes(nameKeyB) || nameKeyB.includes(nameKeyA)) return true;
    if (/\d/.test(itemNoA)) return true;
  }

  // If name matches and neither has conflicting canonical ID or conflicting item number
  if (hasNameMatch) {
    const isExplicitResumption =
      /resumed|post|susp/i.test(a.id) ||
      /resumed|post|susp/i.test(b.id) ||
      /resumed|post|susp/i.test(a.name) ||
      /resumed|post|susp/i.test(b.name) ||
      /resumed|post|susp/i.test(String(a.itemNo ?? '')) ||
      /resumed|post|susp/i.test(String(b.itemNo ?? ''));
    if (isExplicitResumption) {
      return true;
    }
    if (a.id === b.id || (canonIdA && canonIdB && canonIdA === canonIdB)) {
      return true;
    }
    if (!a.id || !b.id || a.id.includes(b.id) || b.id.includes(a.id)) {
      return true;
    }
  }

  return false;
}

function mergeBarTasks(
  existing: BarChartTask,
  incoming: BarChartTask,
  suspensionWindow?: { startDay: number; endDay: number } | null,
): BarChartTask {
  const canonicalId =
    extractCanonicalPdmId(existing.activityId || existing.id) ||
    extractCanonicalPdmId(incoming.activityId || incoming.id) ||
    existing.id;
  const itemNo =
    extractCanonicalItemNo(existing.itemNo) ||
    extractCanonicalItemNo(incoming.itemNo) ||
    existing.itemNo ||
    incoming.itemNo;
  const name =
    extractCanonicalActivityName(existing.name) ||
    extractCanonicalActivityName(incoming.name) ||
    existing.name;
  const payItemId = existing.payItemId || incoming.payItemId;
  const activityId = canonicalId;
  const isCritical = Boolean(existing.isCritical || incoming.isCritical);
  const actualEndDay = incoming.actualEndDay ?? existing.actualEndDay ?? null;

  const origStart = Math.min(
    existing.originalStartDay ?? existing.startDay,
    incoming.originalStartDay ?? incoming.startDay,
  );
  const origEnd = Math.max(
    existing.originalEndDay ?? existing.endDay,
    incoming.originalEndDay ?? incoming.endDay,
  );
  const overallStart = Math.min(existing.startDay, incoming.startDay);
  const overallEnd = Math.max(existing.endDay, incoming.endDay);

  const suspWindow =
    suspensionWindow ||
    existing.suspension ||
    incoming.suspension ||
    (() => {
      const allSegs = [...(existing.segments ?? []), ...(incoming.segments ?? [])];
      const suspSeg = allSegs.find((s) => s.type === 'suspended');
      if (suspSeg) return { startDay: suspSeg.startDay, endDay: suspSeg.endDay };
      const firstEnd = Math.min(existing.endDay, incoming.endDay);
      const secondStart = Math.max(existing.startDay, incoming.startDay);
      if (secondStart > firstEnd + 1) {
        return { startDay: firstEnd + 1, endDay: secondStart - 1 };
      }
      return null;
    })();

  let segments: BarChartTaskSegment[];

  if (suspWindow && overallStart < suspWindow.startDay && overallEnd > suspWindow.startDay) {
    const activeStart = overallStart;
    const activeEnd = Math.max(activeStart, suspWindow.startDay - 1);
    const suspStart = suspWindow.startDay;
    const suspEnd = suspWindow.endDay;
    const resumedStart = suspEnd + 1;
    const resumedEnd = Math.max(resumedStart, overallEnd);

    segments = [
      { startDay: activeStart, endDay: activeEnd, type: 'active' },
      { startDay: suspStart, endDay: suspEnd, type: 'suspended' },
      { startDay: resumedStart, endDay: resumedEnd, type: 'resumed' },
    ];
  } else {
    const rawSegs = [...(existing.segments ?? []), ...(incoming.segments ?? [])];
    if (rawSegs.length === 0) {
      segments = [{ startDay: overallStart, endDay: overallEnd, type: 'active' }];
    } else {
      rawSegs.sort((a, b) => a.startDay - b.startDay || a.endDay - b.endDay);
      segments = [];
      for (const seg of rawSegs) {
        if (segments.length === 0) {
          segments.push({ ...seg });
        } else {
          const prev = segments[segments.length - 1];
          if (seg.startDay <= prev.endDay + 1 && seg.type === prev.type) {
            prev.endDay = Math.max(prev.endDay, seg.endDay);
          } else if (seg.startDay > prev.endDay) {
            segments.push({ ...seg });
          }
        }
      }
    }
  }

  return {
    ...existing,
    id: canonicalId,
    itemNo,
    activityId,
    payItemId,
    name,
    startDay: overallStart,
    endDay: overallEnd,
    originalStartDay: origStart,
    originalEndDay: origEnd,
    isCritical,
    actualEndDay,
    suspension: suspWindow,
    segments,
  };
}

/** Deduplicate bar tasks by PDM/Cost Item ID to ensure each unique PDM/Cost Item has ONE row only. */
export function deduplicateBarTasks(
  tasks: BarChartTask[],
  suspensionWindow?: { startDay: number; endDay: number } | null,
): BarChartTask[] {
  let globalSuspWindow = suspensionWindow;
  if (!globalSuspWindow) {
    for (const t of tasks) {
      if (t.suspension) {
        globalSuspWindow = t.suspension;
        break;
      }
      const sSeg = t.segments?.find((s) => s.type === 'suspended');
      if (sSeg) {
        globalSuspWindow = { startDay: sSeg.startDay, endDay: sSeg.endDay };
        break;
      }
    }
  }

  const result: BarChartTask[] = [];

  for (const task of tasks) {
    const existingIndex = result.findIndex((r) => isSamePdmActivity(r, task));
    if (existingIndex >= 0) {
      result[existingIndex] = mergeBarTasks(result[existingIndex], task, globalSuspWindow);
    } else {
      const canonicalId = extractCanonicalPdmId(task.activityId || task.id) || task.id;
      const canonicalName = extractCanonicalActivityName(task.name) || task.name;
      const canonicalItemNo = extractCanonicalItemNo(task.itemNo) || task.itemNo;

      let formattedTask: BarChartTask = {
        ...task,
        id: canonicalId,
        name: canonicalName,
        itemNo: canonicalItemNo,
        activityId: task.activityId || canonicalId,
      };

      if (
        globalSuspWindow &&
        formattedTask.startDay < globalSuspWindow.startDay &&
        formattedTask.endDay > globalSuspWindow.startDay
      ) {
        const hasSuspSeg = formattedTask.segments?.some((s) => s.type === 'suspended');
        if (!hasSuspSeg) {
          formattedTask = mergeBarTasks(
            formattedTask,
            { ...formattedTask },
            globalSuspWindow,
          );
        }
      }

      result.push(formattedTask);
    }
  }

  return result.map((task, idx) => ({
    ...task,
    index: idx + 1,
  }));
}

/** Original PDM bars with actuals cleared. The baseline does not follow SWA/STEWA. */
export function originalBarChartTasks(rawActivities: PdmActivity[]): BarChartTask[] {
  const activities = rawActivities;
  const tasks = activities.map((activity, index) => {
    const { startDay, endDay } = activityDaySpan(activity);
    return {
      id: activity.id,
      index: index + 1,
      name: activity.name,
      startDay,
      endDay,
      actualEndDay: null,
      isCritical: !!activity.isCritical,
      segments: [{ startDay, endDay, type: 'original' as const }],
      originalStartDay: startDay,
      originalEndDay: endDay,
      itemNo: activity.number,
      activityId: activity.id,
      payItemId: activity.payItemId,
    };
  });
  return deduplicateBarTasks(tasks);
}

/**
 * Revised bars. Durations stay the same.
 * Work finished before suspension stays at original dates.
 * Work starting at or after suspension shifts by the suspension length.
 * Work that was active during suspension contains pre-suspension active work,
 * the suspended non-working gap (rendered in red), and the resumed post-suspension portion.
 * Each activity remains on a SINGLE task row without duplicate rows.
 */
export function revisedBarChartTasks(
  rawActivities: PdmActivity[],
  projectStart: string,
  suspension: SuspensionWindow,
): {
  tasks: BarChartTask[];
  totalDays: number;
  suspensionDays: { startDay: number; endDay: number; length: number };
} {
  const activities = rawActivities;
  const suspStartDay = inclusiveDayCount(projectStart, suspension.start);
  const suspLen = inclusiveDayCount(suspension.start, suspension.end);
  const suspEndDay = suspStartDay + suspLen - 1;
  const completionDays = inclusiveDayCount(projectStart, suspension.revisedCompletion);
  const rawTasks: BarChartTask[] = [];

  for (let i = 0; i < activities.length; i += 1) {
    const activity = activities[i];
    const { startDay: origStart, endDay: origEnd } = activityDaySpan(activity);

    if (origEnd < suspStartDay) {
      // Finished before suspension started
      rawTasks.push({
        id: activity.id,
        index: i + 1,
        name: activity.name,
        startDay: origStart,
        endDay: origEnd,
        actualEndDay: null,
        isCritical: !!activity.isCritical,
        segments: [{ startDay: origStart, endDay: origEnd, type: 'active' }],
        originalStartDay: origStart,
        originalEndDay: origEnd,
        itemNo: activity.number,
        activityId: activity.id,
        payItemId: activity.payItemId,
      });
    } else if (origStart >= suspStartDay) {
      // Starts during or after suspension -> shifts by suspension length
      const shiftedStart = origStart + suspLen;
      const shiftedEnd = origEnd + suspLen;
      rawTasks.push({
        id: activity.id,
        index: i + 1,
        name: activity.name,
        startDay: shiftedStart,
        endDay: shiftedEnd,
        actualEndDay: null,
        isCritical: !!activity.isCritical,
        segments: [{ startDay: shiftedStart, endDay: shiftedEnd, type: 'resumed' }],
        originalStartDay: origStart,
        originalEndDay: origEnd,
        itemNo: activity.number,
        activityId: activity.id,
        payItemId: activity.payItemId,
      });
    } else {
      // Activity was active when suspension occurred:
      // Active portion: origStart to suspStartDay - 1
      // Suspended portion: suspStartDay to suspEndDay
      // Resumed portion: suspEndDay + 1 to origEnd + suspLen
      const activeEnd = suspStartDay - 1;
      const resumedStart = suspEndDay + 1;
      const resumedEnd = origEnd + suspLen;

      rawTasks.push({
        id: activity.id,
        index: i + 1,
        name: activity.name,
        startDay: origStart,
        endDay: resumedEnd,
        actualEndDay: null,
        isCritical: !!activity.isCritical,
        segments: [
          { startDay: origStart, endDay: activeEnd, type: 'active' },
          { startDay: suspStartDay, endDay: suspEndDay, type: 'suspended' },
          { startDay: resumedStart, endDay: resumedEnd, type: 'resumed' },
        ],
        suspension: { startDay: suspStartDay, endDay: suspEndDay },
        originalStartDay: origStart,
        originalEndDay: origEnd,
        itemNo: activity.number,
        activityId: activity.id,
        payItemId: activity.payItemId,
      });
    }
  }

  const tasks = deduplicateBarTasks(rawTasks, { startDay: suspStartDay, endDay: suspEndDay });
  const maxTaskEnd = Math.max(0, ...tasks.map((t) => t.endDay));
  const totalDays = Math.max(completionDays, maxTaskEnd, 1);

  return {
    tasks,
    totalDays,
    suspensionDays: {
      startDay: suspStartDay,
      endDay: suspEndDay,
      length: suspLen,
    },
  };
}

/** `S-Curve - August 2026` on the 1st; otherwise `S-Curve - As of September 15, 2026`. */
export function sCurveRecordLabel(asOfDate: string): string {
  const date = new Date(`${asOfDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return 'S-Curve';
  const month = date.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
  const year = date.getUTCFullYear();
  if (date.getUTCDate() === 1) return `S-Curve - ${month} ${year}`;
  const pretty = date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `S-Curve - As of ${pretty}`;
}

/** `SWA – As of July 6–10, 2026`, with a revision only after an intentional regenerate. */
export function sCurveSourceVersionLabel(
  reportType: string,
  asOfText: string,
  revision = 1,
): string {
  const type = reportType === 'STEWA' ? 'STEWA' : reportType === 'SWA' ? 'SWA' : reportType;
  const period = asOfText.trim() || 'undated';
  const base = `${type} – As of ${period}`;
  const rev = Math.max(1, Math.floor(revision) || 1);
  return rev > 1 ? `${base} (rev ${rev})` : base;
}

const LABEL_MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

function isoFromParts(year: number, month: number, day: number): string | null {
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** End date of a stored or legacy version label, used to sort history. */
export function reportingDateFromSCurveLabel(label: string): string | null {
  const text = label
    .replace(/\s*\(rev\s+\d+\)\s*$/i, '')
    .replace(/^S-Curve\s*-\s*/i, '')
    .replace(/^(SWA|STEWA)\s*[–-]\s*/i, '')
    .replace(/^As of\s+/i, '')
    .trim();
  if (!text) return null;

  const crossYear = text.match(
    /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})\s*[–-]\s*([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/,
  );
  if (crossYear) {
    const month = LABEL_MONTHS[crossYear[4].toLowerCase()];
    return isoFromParts(Number(crossYear[6]), month, Number(crossYear[5]));
  }

  const crossMonth = text.match(
    /^([A-Za-z]+)\s+(\d{1,2})\s*[–-]\s*([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/,
  );
  if (crossMonth) {
    const month = LABEL_MONTHS[crossMonth[3].toLowerCase()];
    return isoFromParts(Number(crossMonth[5]), month, Number(crossMonth[4]));
  }

  const sameMonth = text.match(/^([A-Za-z]+)\s+(\d{1,2})\s*[–-]\s*(\d{1,2}),?\s+(\d{4})$/);
  if (sameMonth) {
    const month = LABEL_MONTHS[sameMonth[1].toLowerCase()];
    return isoFromParts(Number(sameMonth[4]), month, Number(sameMonth[3]));
  }

  const single = text.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (single) {
    const month = LABEL_MONTHS[single[1].toLowerCase()];
    return isoFromParts(Number(single[3]), month, Number(single[2]));
  }

  const monthYear = text.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (monthYear) {
    const month = LABEL_MONTHS[monthYear[1].toLowerCase()];
    return isoFromParts(Number(monthYear[2]), month, 1);
  }
  return null;
}

export interface SCurveVersionIdentity {
  id: string;
  captured_at: string;
  trigger_label: string | null;
  as_of_date: string;
  source_report_id: string | null;
}

/** One row per source report. Legacy snapshots with the same label or date collapse to the newest. */
export function dedupeAndSortSCurveVersions<T extends SCurveVersionIdentity>(versions: T[]): T[] {
  const newestByKey = new Map<string, T>();
  for (const version of versions) {
    const key = version.source_report_id
      ? `report:${version.source_report_id}`
      : `legacy:${version.as_of_date || (version.trigger_label ?? version.id).trim().toLowerCase()}`;
    const current = newestByKey.get(key);
    if (!current || version.captured_at > current.captured_at) newestByKey.set(key, version);
  }

  const sourcedDates = new Set(
    [...newestByKey.values()]
      .filter((version) => version.source_report_id && version.as_of_date)
      .map((version) => version.as_of_date),
  );

  return [...newestByKey.values()]
    .filter(
      (version) =>
        Boolean(version.source_report_id) || !version.as_of_date || !sourcedDates.has(version.as_of_date),
    )
    .sort((a, b) => {
      const byDate = (b.as_of_date || b.captured_at).localeCompare(a.as_of_date || a.captured_at);
      return byDate !== 0 ? byDate : b.captured_at.localeCompare(a.captured_at);
    });
}
