import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import type { BarChartTask, PdmActivity, PdmDependency } from '../../types';
import type { ReportProgressEntry } from '../../components/ReportProgressFeed';
import { applyPdmDerivatives, applyReportProgressToBarChart } from '../scheduleSync';
import { resolveTargetAndActual, compareTargetVsActual } from '../progressStatus';
import {
  dedupeAndSortSCurveVersions,
  originalBarChartTasks,
  readSuspensionWindow,
  reportingDateFromSCurveLabel,
  revisedBarChartTasks,
} from '../scheduleBaselines';
import { deduplicateActivities } from '../pdm';
import type { SCurveReportingInterval } from '../sCurvePeriods';
import { intervalDays, isSCurveReportingInterval } from '../sCurvePeriods';
import { COLLECTIONS, sCurveSnapshotsPath } from './collections';
import { db } from './config';
import { asId, nowIso } from './ids';
import { readListCache, writeListCache, invalidateListCache } from './listCache';
import { listApprovedProgressForProject } from './reportProgress';
import { getProjectFs } from './projects';

type ScheduleStatus = ReturnType<typeof compareTargetVsActual>;
type SCurveType = 'pdm_based' | 'ideal_theoretical';
export interface ProjectScheduleDoc {
  project_id: string;
  activities: PdmActivity[];
  dependencies: PdmDependency[];
  barChartTasks: BarChartTask[];
  barChartTotalDays: number;
  barChartTimeNow: number;
  projectDuration: number;
  criticalPath: string[];
  pdmError?: string | null;
  reportFeed?: ReportProgressEntry[];
  latestReportPercent?: number | null;
  latestReportDate?: string | null;
  targetPlanPercent?: number | null;
  actualPlanPercent?: number | null;
  progressStatus?: ScheduleStatus | null;
}

export interface ChartSettings {
  curveType: SCurveType;
  reportingInterval: SCurveReportingInterval;
  theoreticalTotalPeriods: number;
  theoreticalDurationDays: number;
  costItems: Array<{ activityId: string; quantity: number; unitCost: number }>;
  rawCurveData: Record<string, unknown> | null;
}

/** Shared project chart context — one parallel fetch for schedule/S-curve pages. */
export interface ProjectChartContext {
  projectId: string;
  projectStart: string;
  /** Project Details start_date only (null when unset — not today fallback). */
  originalProjectStart: string | null;
  projectPlannedEnd: string | null;
  /** Project contract amount (₱) — used when S-Curve cost rows are empty. */
  projectContractAmount: number;
  baselineMode: 'active' | 'prior_suspension';
  revisedCompletionDate: string | null;
  suspensionStartDate: string | null;
  suspensionEndDate: string | null;
  schedule: ProjectScheduleDoc;
  feed: ReportProgressEntry[];
  settings: ChartSettings;
  curveRefExists: boolean;
}

export const EMPTY_SCHEDULE = (projectId: string): ProjectScheduleDoc => ({
  project_id: projectId,
  activities: [],
  dependencies: [],
  barChartTasks: [],
  barChartTotalDays: 1,
  barChartTimeNow: 0,
  projectDuration: 0,
  criticalPath: [],
  pdmError: null,
  reportFeed: [],
  latestReportPercent: null,
  latestReportDate: null,
  targetPlanPercent: null,
  actualPlanPercent: null,
  progressStatus: null,
});

function normalizeSettings(
  raw: Record<string, unknown> | null,
  projectDuration: number,
): ChartSettings {
  const reportingInterval = isSCurveReportingInterval(raw?.reportingInterval)
    ? raw.reportingInterval
    : '30_day';
  const curveType =
    raw?.activeCurveType === 'ideal_theoretical'
      ? ('ideal_theoretical' as const)
      : ('pdm_based' as const);
  const fallbackPeriods = Math.max(
    1,
    Math.ceil(Math.max(1, projectDuration) / intervalDays(reportingInterval)),
  );
  const theoreticalTotalPeriods = Math.max(
    1,
    Number(raw?.theoreticalTotalPeriods ?? fallbackPeriods),
  );
  const costItems = (
    (raw?.costItems as Array<{ activityId: string; quantity: number; unitCost: number }> | undefined) ??
    []
  ).filter((item) => item && typeof item.activityId === 'string');

  return {
    curveType,
    reportingInterval,
    theoreticalTotalPeriods,
    theoreticalDurationDays: theoreticalTotalPeriods * intervalDays(reportingInterval),
    costItems,
    rawCurveData: raw,
  };
}

function mapRawSchedule(id: string, data: Record<string, unknown>): ProjectScheduleDoc {
  return {
    project_id: id,
    activities: (data.activities as PdmActivity[]) ?? [],
    dependencies: (data.dependencies as PdmDependency[]) ?? [],
    barChartTasks: (data.barChartTasks as BarChartTask[]) ?? [],
    barChartTotalDays: Number(data.barChartTotalDays ?? 1),
    barChartTimeNow: Number(data.barChartTimeNow ?? 0),
    projectDuration: Number(data.projectDuration ?? 0),
    criticalPath: (data.criticalPath as string[]) ?? [],
    pdmError: (data.pdmError as string | null) ?? null,
  };
}

export function applyFeedToSchedule(
  schedule: ProjectScheduleDoc,
  feed: ReportProgressEntry[],
  projectStart: string,
): ProjectScheduleDoc {
  const { targetPct, actualPct } = resolveTargetAndActual(feed);
  const progressStatus = compareTargetVsActual(targetPct, actualPct);
  const totalDays = Math.max(1, schedule.barChartTotalDays || schedule.projectDuration || 1);
  const applied = applyReportProgressToBarChart(
    schedule.barChartTasks,
    feed,
    projectStart,
    totalDays,
  );
  return {
    ...schedule,
    barChartTasks: applied.tasks,
    barChartTimeNow: applied.timeNow,
    reportFeed: feed,
    latestReportPercent: applied.latestPercent ?? actualPct,
    latestReportDate: applied.latestReportDate,
    targetPlanPercent: null,
    actualPlanPercent: actualPct,
    progressStatus,
  };
}

async function loadProgressCached(projectId: string): Promise<ReportProgressEntry[]> {
  const cacheKey = `reportProgress:${projectId}`;
  const cached = readListCache<ReportProgressEntry[]>(cacheKey);
  if (cached) return cached;
  try {
    const feed = await listApprovedProgressForProject(projectId);
    return writeListCache(cacheKey, feed, 15_000);
  } catch {
    return writeListCache(cacheKey, [], 5_000);
  }
}

const pendingChartContext = new Map<string, Promise<ProjectChartContext>>();

export function invalidateChartCaches(projectId?: string) {
  if (projectId) {
    invalidateListCache(`reportProgress:${projectId}`);
    invalidateListCache(`chartContext:${projectId}`);
    invalidateListCache(`sCurveVersions:${projectId}`);
    pendingChartContext.delete(asId(projectId));
    return;
  }
  invalidateListCache('reportProgress:');
  invalidateListCache('chartContext:');
  invalidateListCache('sCurveVersions:');
  pendingChartContext.clear();
}

/**
 * Single parallel load for the selected project — shared by Bar Chart and S-Curve.
 * Avoids duplicate schedule / progress / project fetches.
 */
export async function loadProjectChartContext(
  projectId: string | number,
): Promise<ProjectChartContext> {
  const id = asId(projectId);
  const cacheKey = `chartContext:${id}`;
  const cached = readListCache<ProjectChartContext>(cacheKey);
  if (cached) return cached;

  const inflight = pendingChartContext.get(id);
  if (inflight) return inflight;

  const promise = (async (): Promise<ProjectChartContext> => {
    const scheduleRef = doc(db, COLLECTIONS.schedules, id);
    const curveRef = doc(db, COLLECTIONS.sCurves, id);

    const [projectResult, scheduleSnap, curveSnap, feed] = await Promise.all([
      getProjectFs(id).catch(() => null),
      getDoc(scheduleRef).catch(() => null),
      getDoc(curveRef).catch(() => null),
      loadProgressCached(id),
    ]);

    const projectStart =
      projectResult?.project.start_date || nowIso().slice(0, 10);
    const originalProjectStart = projectResult?.project.start_date ?? null;
    const projectPlannedEnd = projectResult?.project.planned_end_date ?? null;
    const projectContractAmount = Number(projectResult?.project.contract_amount ?? 0) || 0;
    const baselineMode =
      projectResult?.project.baseline_mode === 'prior_suspension' ? 'prior_suspension' : 'active';

    let raw = EMPTY_SCHEDULE(id);
    if (scheduleSnap?.exists()) {
      raw = mapRawSchedule(id, scheduleSnap.data() as Record<string, unknown>);
    }
    const dedupeResult = deduplicateActivities(raw.activities, raw.dependencies);
    raw.activities = dedupeResult.activities;
    raw.dependencies = dedupeResult.dependencies;
    const derived = applyPdmDerivatives(raw);
    const schedule = applyFeedToSchedule(derived, feed, projectStart);
    const settings = normalizeSettings(
      curveSnap?.exists() ? (curveSnap.data() as Record<string, unknown>) : null,
      Math.max(1, schedule.projectDuration || 110),
    );

    const ctx: ProjectChartContext = {
      projectId: id,
      projectStart,
      originalProjectStart,
      projectPlannedEnd,
      projectContractAmount,
      baselineMode,
      revisedCompletionDate: projectResult?.project.revised_completion_date ?? null,
      suspensionStartDate: projectResult?.project.suspension_start_date ?? null,
      suspensionEndDate: projectResult?.project.suspension_end_date ?? null,
      schedule,
      feed,
      settings,
      curveRefExists: Boolean(curveSnap?.exists()),
    };
    return writeListCache(cacheKey, ctx, 12_000);
  })().finally(() => {
    pendingChartContext.delete(id);
  });

  pendingChartContext.set(id, promise);
  return promise;
}

/** Lightweight bar-chart payload for the selected project only. */
export async function getBarChartFs(projectId: string | number) {
  const ctx = await loadProjectChartContext(projectId);
  const raw = ctx.settings.rawCurveData;
  const storedTarget =
    raw?.targetPlanPct != null && !Number.isNaN(Number(raw.targetPlanPct))
      ? Number(raw.targetPlanPct)
      : null;
  const storedActual =
    raw?.actualPlanPct != null && !Number.isNaN(Number(raw.actualPlanPct))
      ? Number(raw.actualPlanPct)
      : null;
  const targetPlan =
    storedTarget ?? ctx.schedule.targetPlanPercent ?? null;
  const actualPlan =
    storedActual ?? ctx.schedule.actualPlanPercent ?? null;
  const scheduleStatus =
    storedTarget != null || storedActual != null
      ? compareTargetVsActual(targetPlan, actualPlan)
      : ctx.schedule.progressStatus ?? null;

  const suspension = readSuspensionWindow({
    baselineMode: ctx.baselineMode,
    suspensionStart: ctx.suspensionStartDate,
    suspensionEnd: ctx.suspensionEndDate,
    revisedCompletion: ctx.revisedCompletionDate,
    plannedEndDate: ctx.projectPlannedEnd,
    projectStart: ctx.projectStart,
  });
  const revisedResult = suspension
    ? revisedBarChartTasks(ctx.schedule.activities, ctx.projectStart, suspension)
    : null;
  const baselines = suspension && revisedResult
    ? {
        original: {
          tasks: originalBarChartTasks(ctx.schedule.activities),
          totalDays: Math.max(1, ctx.schedule.barChartTotalDays),
        },
        revised: revisedResult,
      }
    : null;
  const suspensionWindow = suspension && revisedResult
    ? {
        start: suspension.start,
        end: suspension.end,
        revisedCompletion: suspension.revisedCompletion,
        startDay: revisedResult.suspensionDays.startDay,
        endDay: revisedResult.suspensionDays.endDay,
        length: revisedResult.suspensionDays.length,
      }
    : null;

  return {
    schedule: ctx.schedule,
    curve_type: ctx.settings.curveType,
    reporting_interval: ctx.settings.reportingInterval,
    theoretical_total_periods: ctx.settings.theoreticalTotalPeriods,
    project_start_date: ctx.projectStart,
    report_feed: ctx.feed,
    target_plan_percent: targetPlan,
    actual_plan_percent: actualPlan,
    schedule_status: scheduleStatus,
    baselines,
    suspension_window: suspensionWindow,
  };
}

export async function loadSCurveVersions(projectId: string) {
  const id = asId(projectId);
  const cacheKey = `sCurveVersions:${id}`;
  const cached = readListCache<
    Array<{
      id: string;
      captured_at: string;
      trigger_type: string;
      trigger_label: string | null;
      as_of_date: string;
      as_of_label: string | null;
      source_report_id: string | null;
      source_report_type: string | null;
      revision: number | null;
      schedule_status: string | null;
      slippage_pct: number | null;
      planned_pct: number | null;
      actual_pct: number | null;
    }>
  >(cacheKey);
  if (cached) return cached;

  try {
    const versionsSnap = await getDocs(collection(db, sCurveSnapshotsPath(id)));
    const versions = versionsSnap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      const triggerLabel = (data.triggerLabel as string | null) ?? null;
      const storedAsOf = String(data.asOfDate ?? '').slice(0, 10);
      const asOfDate =
        /^\d{4}-\d{2}-\d{2}$/.test(storedAsOf)
          ? storedAsOf
          : reportingDateFromSCurveLabel(triggerLabel ?? '') ?? '';
      return {
        id: d.id,
        captured_at: String(data.capturedAt ?? ''),
        trigger_type: String(data.triggerType ?? 'manual'),
        trigger_label: triggerLabel,
        as_of_date: asOfDate,
        as_of_label: (data.asOfLabel as string | null) ?? null,
        source_report_id: (data.sourceReportId as string | null) ?? null,
        source_report_type: (data.sourceReportType as string | null) ?? null,
        revision: data.revision != null ? Number(data.revision) : null,
        schedule_status: (data.scheduleStatus as string | null) ?? null,
        slippage_pct: data.slippagePct != null ? Number(data.slippagePct) : null,
        planned_pct: data.plannedPct != null ? Number(data.plannedPct) : null,
        actual_pct: data.actualPct != null ? Number(data.actualPct) : null,
      };
    });
    return writeListCache(cacheKey, dedupeAndSortSCurveVersions(versions), 20_000);
  } catch {
    return writeListCache(cacheKey, [], 5_000);
  }
}
