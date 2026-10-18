'use client';

import { useEffect, useMemo, useState } from 'react';
import { Link } from '../lib/nextRouter';
import { useAuth } from '../context/AuthContext';
import { useSelectedProject } from '../context/SelectedProjectContext';
import { ProjectSelect } from '../components/ProjectSelect';
import { DocumentsBackLink } from '../components/DocumentsBackLink';
import { ReportProgressFeed, type ReportProgressEntry } from '../components/ReportProgressFeed';
import { NavIcon, type NavIconName } from '../components/NavIcon';
import { getBarChart } from '../lib/scheduleApi';
import type { BarChartTask } from '../types';
import { exportBarChartPdf } from '../lib/chartPdfExport';
import { saveSCurveSettings, type SCurveReportingInterval, type SCurveType, type ScheduleStatus } from '../lib/sCurveApi';
import { applyReportProgressToBarChart } from '../lib/scheduleSync';
import { buildTheoreticalBarChartTasks } from '../lib/sCurvePeriods';
import { PreviewModal } from '../components/ui/PreviewModal';
import { canEditProjectCharts } from '../lib/chartPermissions';
import { deduplicateBarTasks } from '../lib/scheduleBaselines';
import { getLocalChartViewMode, setLocalChartViewMode } from '../lib/chartViewPreferences';

function getScheduleStatus(
  plannedEnd: number,
  actualEnd: number | null | undefined,
  timeNow: number,
): 'ahead' | 'on' | 'behind' | 'planned' {
  // No reports yet → Target Plan only. Delay / ahead / on-schedule starts after
  // SWA, STEWA, or IAR actual % is recorded.
  if (timeNow < 1 || actualEnd == null) return 'planned';
  if (actualEnd < timeNow && plannedEnd >= timeNow) return 'behind';
  if (actualEnd > plannedEnd) return 'behind';
  if (actualEnd < plannedEnd) return 'ahead';
  if (actualEnd === timeNow || actualEnd === plannedEnd) return 'on';
  return 'on';
}

const STATUS_COLORS = {
  ahead: 'bg-primary',
  on: 'bg-amber-500',
  behind: 'bg-red-500',
  /** Target plan — used when schedule is first entered (no actual progress yet). */
  planned: 'bg-blue-600',
};

function buildGroups(totalDays: number, reportingInterval: SCurveReportingInterval) {
  const groups: { label: string; start: number; end: number }[] = [];
  const span =
    reportingInterval === '5_day'
      ? 5
      : reportingInterval === '10_day'
        ? 10
        : reportingInterval === '15_day'
          ? 15
          : reportingInterval === '20_day'
            ? 20
            : 30;
  let day = 1;
  let index = 1;
  while (day <= totalDays) {
    const end = Math.min(day + span - 1, totalDays);
    groups.push({
      label: reportingInterval === '30_day' ? `Month ${index}` : `Days ${day}-${end}`,
      start: day,
      end,
    });
    day = end + 1;
    index += 1;
  }
  return groups;
}

export function BarChartPage() {
  const { user } = useAuth();
  const { projectId, setProjectId } = useSelectedProject();
  const canEditCharts = canEditProjectCharts(user?.role);
  const [tasks, setTasks] = useState<BarChartTask[]>([]);
  const [totalDays, setTotalDays] = useState(24);
  const [timeNow, setTimeNow] = useState(10);
  const [reportFeed, setReportFeed] = useState<ReportProgressEntry[]>([]);
  const [latestReportPercent, setLatestReportPercent] = useState<number | null>(null);
  const [latestReportDate, setLatestReportDate] = useState<string | null>(null);
  const [targetPlanPercent, setTargetPlanPercent] = useState<number | null>(null);
  const [actualPlanPercent, setActualPlanPercent] = useState<number | null>(null);
  const [progressStatus, setProgressStatus] = useState<ScheduleStatus | null>(null);
  const [curveType, setCurveType] = useState<SCurveType>('pdm_based');
  const [reportingInterval, setReportingInterval] = useState<SCurveReportingInterval>('30_day');
  const [theoreticalTotalPeriods, setTheoreticalTotalPeriods] = useState(1);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsVersion, setSettingsVersion] = useState(0);
  const [baselineView, setBaselineView] = useState<'original' | 'revised'>('revised');
  const [baselineSets, setBaselineSets] = useState<{
    original: { tasks: BarChartTask[]; totalDays: number };
    revised: { tasks: BarChartTask[]; totalDays: number };
  } | null>(null);
  const [suspensionWindow, setSuspensionWindow] = useState<{
    start: string;
    end: string;
    revisedCompletion: string;
    startDay: number;
    endDay: number;
    length: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const renderedTasks = useMemo(
    () =>
      deduplicateBarTasks(
        tasks,
        suspensionWindow
          ? { startDay: suspensionWindow.startDay, endDay: suspensionWindow.endDay }
          : null,
      ),
    [tasks, suspensionWindow],
  );

  const barChartPdfInput = () => ({
    projectLabel: `Project ${projectId}`,
    tasks: renderedTasks,
    totalDays,
    timeNow,
    status: progressStatus,
    targetPlanPercent,
    actualPlanPercent,
  });

  const persistScheduleSettings = async (next: {
    curveType?: SCurveType;
    reportingInterval?: SCurveReportingInterval;
    theoreticalTotalPeriods?: number;
  }) => {
    if (!canEditCharts) return;
    const nextCurveType = next.curveType ?? curveType;
    const nextReportingInterval = next.reportingInterval ?? reportingInterval;
    const nextTheoreticalTotalPeriods = Math.max(
      1,
      next.theoreticalTotalPeriods ?? theoreticalTotalPeriods,
    );

    setSettingsSaving(true);
    try {
      const saved = await saveSCurveSettings({
        project_id: projectId,
        curve_type: nextCurveType,
        reporting_interval: nextReportingInterval,
        theoretical_total_periods: nextTheoreticalTotalPeriods,
      });
      setCurveType(saved.curve_type);
      setReportingInterval(saved.reporting_interval);
      setTheoreticalTotalPeriods(saved.theoretical_total_periods);
      setSettingsVersion((value) => value + 1);
    } finally {
      setSettingsSaving(false);
    }
  };

  const [projectStartDate, setProjectStartDate] = useState<string | null>(null);
  const [rawScheduleData, setRawScheduleData] = useState<
    Awaited<ReturnType<typeof getBarChart>>['schedule'] | null
  >(null);

  const handleSelectCurveType = (nextCurveType: SCurveType) => {
    setCurveType(nextCurveType);
    setLocalChartViewMode(user, projectId, 'barchart', nextCurveType);
    if (canEditCharts) {
      void persistScheduleSettings({ curveType: nextCurveType });
    }
  };

  useEffect(() => {
    const saved = getLocalChartViewMode(user, projectId, 'barchart');
    if (saved) {
      setCurveType(saved);
    }
  }, [user, projectId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Lightweight load: schedule + settings + progress for the selected project only.
        const payload = await getBarChart(projectId);
        const data = payload.schedule;
        if (!cancelled) {
          const savedPref = getLocalChartViewMode(user, projectId, 'barchart');
          if (savedPref) {
            setCurveType(savedPref);
          } else {
            setCurveType(payload.curve_type);
          }
          setReportingInterval(payload.reporting_interval);
          setTheoreticalTotalPeriods(payload.theoretical_total_periods);
          setBaselineSets(payload.baselines ?? null);
          setSuspensionWindow(payload.suspension_window ?? null);
          setProjectStartDate(payload.project_start_date ?? null);
          setRawScheduleData(data ?? null);
          setReportFeed(payload.report_feed ?? data?.reportFeed ?? []);
          setTargetPlanPercent(payload.target_plan_percent ?? data?.targetPlanPercent ?? null);
          setActualPlanPercent(payload.actual_plan_percent ?? data?.actualPlanPercent ?? null);
          setProgressStatus(payload.schedule_status ?? data?.progressStatus ?? null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load bar chart from database.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, settingsVersion, user]);

  useEffect(() => {
    if (curveType === 'ideal_theoretical' && projectStartDate) {
      const theoretical = buildTheoreticalBarChartTasks({
        totalPeriods: theoreticalTotalPeriods,
        reportingInterval,
      });
      const applied = applyReportProgressToBarChart(
        theoretical.tasks,
        reportFeed,
        projectStartDate,
        theoretical.totalDays,
      );
      setTasks(deduplicateBarTasks(applied.tasks));
      setTotalDays(theoretical.totalDays);
      setTimeNow(applied.timeNow);
      setLatestReportPercent(applied.latestPercent);
      setLatestReportDate(applied.latestReportDate);
    } else if (curveType === 'pdm_based') {
      if (baselineSets) {
        const chosen = baselineView === 'original' ? baselineSets.original : baselineSets.revised;
        setTasks(deduplicateBarTasks(chosen.tasks));
        setTotalDays(chosen.totalDays);
        setTimeNow(0);
      } else if (rawScheduleData) {
        setTasks(deduplicateBarTasks(rawScheduleData.barChartTasks));
        setTotalDays(rawScheduleData.barChartTotalDays);
        setTimeNow(rawScheduleData.barChartTimeNow);
      }
      if (rawScheduleData) {
        setLatestReportPercent(rawScheduleData.latestReportPercent ?? null);
        setLatestReportDate(rawScheduleData.latestReportDate ?? null);
      }
    }
  }, [
    curveType,
    baselineView,
    baselineSets,
    rawScheduleData,
    projectStartDate,
    reportFeed,
    theoreticalTotalPeriods,
    reportingInterval,
  ]);

  const days = useMemo(
    () => Array.from({ length: totalDays }, (_, i) => i + 1),
    [totalDays],
  );
  const groups = useMemo(() => buildGroups(totalDays, reportingInterval), [reportingInterval, totalDays]);
  const hasReportActuals = timeNow >= 1 && latestReportPercent != null;

  const isSuspendedDay = (day: number) => {
    if (baselineView !== 'revised' || !suspensionWindow) return false;
    return day >= suspensionWindow.startDay && day <= suspensionWindow.endDay;
  };

  const { behindTaskCount, criticalTaskCount, plannedTaskCount } = useMemo(() => {
    let behind = 0;
    let critical = 0;
    let planned = 0;
    for (const task of renderedTasks) {
      if (task.isCritical) critical += 1;
      if (!task.actualEndDay) planned += 1;
      if (
        getScheduleStatus(task.endDay, hasReportActuals ? task.actualEndDay : null, timeNow) ===
        'behind'
      ) {
        behind += 1;
      }
    }
    return {
      behindTaskCount: behind,
      criticalTaskCount: critical,
      plannedTaskCount: planned,
    };
  }, [renderedTasks, hasReportActuals, timeNow]);
  const latestProgressLabel = latestReportPercent != null ? `${latestReportPercent}%` : 'Not reported';

  return (
    <main className="flex-1 overflow-y-auto">
      <DocumentsBackLink />
      <div className="space-y-5 px-8 pb-10 pt-6">
      <header className="page-header-in relative z-20 overflow-visible rounded-xl border border-border/80 bg-card/90 px-4 py-3 shadow-sm sm:px-5">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden rounded-t-xl"
        >
          <div className="page-accent-sweep h-full bg-gradient-to-r from-primary via-accent to-transparent" />
        </div>

        <div className="page-toolbar-in flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
              Schedule
            </p>
            <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold leading-tight tracking-tight text-text sm:text-2xl">
              Bar chart
            </h1>
          </div>

          <div className="relative z-30 flex flex-wrap items-center justify-end gap-2">
            {progressStatus && (
              <div
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                  progressStatus.status === 'ahead'
                    ? 'bg-emerald-50 text-emerald-800'
                    : progressStatus.status === 'behind'
                      ? 'bg-red-50 text-red-800'
                      : progressStatus.status === 'on_schedule'
                        ? 'bg-primary-light text-primary'
                        : 'bg-blue-50 text-blue-800'
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
                {progressStatus.label}
                {progressStatus.planned_pct != null && (
                  <span className="font-medium opacity-70">
                    {progressStatus.planned_pct}%
                    {progressStatus.actual_pct != null ? ` · ${progressStatus.actual_pct}%` : ''}
                  </span>
                )}
              </div>
            )}

            {baselineSets && curveType === 'pdm_based' && (
              <div role="group" aria-label="Bar chart baseline" className="flex shrink-0 rounded-lg bg-surface-muted p-0.5">
                <button
                  type="button"
                  onClick={() => setBaselineView('original')}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors duration-200 ${
                    baselineView === 'original' ? 'bg-primary text-white shadow-sm' : 'text-text-muted hover:text-text'
                  }`}
                >
                  Original Bar Chart
                </button>
                <button
                  type="button"
                  onClick={() => setBaselineView('revised')}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors duration-200 ${
                    baselineView === 'revised' ? 'bg-primary text-white shadow-sm' : 'text-text-muted hover:text-text'
                  }`}
                >
                  Revised Bar Chart
                </button>
              </div>
            )}

            <div
              role="group"
              aria-label="Schedule basis"
              className="flex shrink-0 rounded-lg bg-surface-muted p-0.5"
            >
              <button
                type="button"
                onClick={() => handleSelectCurveType('pdm_based')}
                disabled={settingsSaving}
                className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors duration-200 ${
                  curveType === 'pdm_based'
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-text-muted hover:text-text'
                }`}
              >
                PDM target
              </button>
              <button
                type="button"
                onClick={() => handleSelectCurveType('ideal_theoretical')}
                disabled={settingsSaving}
                className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors duration-200 ${
                  curveType === 'ideal_theoretical'
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-text-muted hover:text-text'
                }`}
              >
                Theoretical
              </button>
            </div>

            {canEditCharts ? (
              <>
                <label className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs transition focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/20">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                    Interval
                  </span>
                  <select
                    value={reportingInterval}
                    disabled={settingsSaving}
                    onChange={(e) =>
                      void persistScheduleSettings({
                        reportingInterval: e.target.value as SCurveReportingInterval,
                      })
                    }
                    className="bg-transparent text-xs font-semibold text-text outline-none"
                  >
                    <option value="5_day">5-day</option>
                    <option value="10_day">10-day</option>
                    <option value="15_day">15-day</option>
                    <option value="20_day">20-day</option>
                    <option value="30_day">30-day</option>
                  </select>
                </label>

                {curveType === 'ideal_theoretical' && (
                  <label className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs transition focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/20">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                      Periods
                    </span>
                    <input
                      type="number"
                      min={1}
                      value={theoreticalTotalPeriods}
                      disabled={settingsSaving}
                      onChange={(e) =>
                        setTheoreticalTotalPeriods(Math.max(1, Number(e.target.value || 1)))
                      }
                      onBlur={(e) =>
                        void persistScheduleSettings({
                          theoreticalTotalPeriods: Math.max(1, Number(e.currentTarget.value || 1)),
                        })
                      }
                      className="w-10 bg-transparent text-xs font-semibold text-text outline-none"
                    />
                  </label>
                )}
              </>
            ) : (
              <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-xs">
                <span className="rounded-lg border border-border bg-surface px-2.5 py-1.5 font-semibold text-text">
                  {reportingInterval === '5_day'
                    ? '5-day'
                    : reportingInterval === '10_day'
                      ? '10-day'
                      : reportingInterval === '15_day'
                        ? '15-day'
                        : reportingInterval === '20_day'
                          ? '20-day'
                          : '30-day'}{' '}
                  interval
                </span>
                <span className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 font-semibold text-amber-900">
                  View only
                </span>
              </div>
            )}

            <div className="relative z-30 min-w-[180px] sm:w-[220px]">
              <ProjectSelect value={projectId} onChange={setProjectId} />
            </div>

            <button
              type="button"
              disabled={tasks.length === 0}
              onClick={() => setPreviewOpen(true)}
              className="shrink-0 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text transition hover:border-primary/30 hover:bg-primary-light/40 disabled:opacity-50"
            >
              Preview
            </button>
            <button
              type="button"
              disabled={exporting || tasks.length === 0}
              onClick={() => {
                setExporting(true);
                try {
                  exportBarChartPdf(barChartPdfInput());
                } finally {
                  setExporting(false);
                }
              }}
              className="shrink-0 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text transition hover:border-primary/30 hover:bg-primary-light/40 disabled:opacity-50"
            >
              {exporting ? 'Exporting…' : 'Export PDF'}
            </button>
            {user?.role === 'contractor' && (
              <Link
                to="/schedule"
                className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-primary-dark"
              >
                Prepare schedule
              </Link>
            )}
          </div>
        </div>
      </header>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">{error}</div>}

      <div className="relative z-0 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {([
          ['Schedule duration', `${totalDays} days`, 'Total planned timeline', 'schedule'],
          ['Activities', tasks.length, `${plannedTaskCount} awaiting actual progress · ${behindTaskCount} delayed`, 'projects'],
          ['Critical tasks', criticalTaskCount, 'Zero-float activities', 'approval'],
          ['Latest progress', latestProgressLabel, latestReportDate ? `Reported ${latestReportDate}` : 'No approved report yet', 'reports'],
        ] as [string, string | number, string, NavIconName][]).map(([label, value, caption, icon]) => (
          <div key={label} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">{label}</p>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-light text-primary">
                <NavIcon name={icon} className="h-5 w-5" />
              </span>
            </div>
            <p className={`mt-3 text-2xl font-semibold ${label === 'Critical tasks' && criticalTaskCount > 0 ? 'text-red-600' : 'text-text'}`}>{value}</p>
            <p className="mt-1 truncate text-xs text-text-muted" title={caption}>{caption}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-card px-5 py-4 text-sm shadow-sm">
        <p className="mr-2 font-semibold text-text">Chart legend</p>
        <span className="flex items-center gap-2">
          <span className="h-3 w-6 rounded bg-blue-600" /> Active / Continuation (Target Plan)
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-flex h-4 items-center justify-center rounded bg-red-600 px-2 text-[10px] font-bold uppercase tracking-wider text-white shadow-xs">
            Suspended
          </span>
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-6 rounded bg-primary" /> Ahead
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-6 rounded bg-amber-500" /> On Track
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-6 rounded bg-red-500" /> Behind
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-6 rounded border-2 border-red-600 bg-blue-600" /> Critical path
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-8 w-3 rounded bg-amber-200 ring-1 ring-amber-500" /> Time Now (latest report)
        </span>
      </div>

      {suspensionWindow && baselineView === 'revised' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50/70 px-4 py-2.5 text-xs text-red-900">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-5 items-center rounded-md bg-red-600 px-2 text-[10px] font-bold uppercase tracking-wider text-white">
              Suspended Period
            </span>
            <span className="font-semibold">
              {suspensionWindow.start} → {suspensionWindow.end} ({suspensionWindow.length} calendar days · Days {suspensionWindow.startDay}–{suspensionWindow.endDay})
            </span>
          </div>
          <span className="text-red-700">
            Revised completion date: <strong>{suspensionWindow.revisedCompletion}</strong>
          </span>
        </div>
      )}

      <ReportProgressFeed
        reports={reportFeed}
        latestPercent={latestReportPercent}
        latestDate={latestReportDate}
      />

      {loading ? (
        <div className="h-80 animate-pulse rounded-2xl border border-border bg-card" />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold text-text">Construction timeline</h2>
              <p className="mt-1 text-sm text-text-muted">Target plan, actual progress, suspension periods, and the current reporting day.</p>
            </div>
            <div className="text-right text-xs text-text-muted">
              <p>{groups.length} planning {reportingInterval === '10_day' ? 'intervals' : 'months'}</p>
              {hasReportActuals && <p className="mt-1 font-semibold text-amber-700">Time now: Day {timeNow}</p>}
            </div>
          </div>
          <div className="overflow-x-auto p-5">
          <table className="w-full min-w-[900px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-border bg-surface-muted">
                <th className="w-8 p-2 text-left">#</th>
                <th className="min-w-[200px] p-2 text-left">Task</th>
                {groups.map((w) => (
                  <th
                    key={w.label}
                    colSpan={w.end - w.start + 1}
                    className="border-l border-border p-2 text-center"
                  >
                    {w.label}
                  </th>
                ))}
              </tr>
              <tr className="border-b border-border bg-surface/80">
                <th colSpan={2} />
                {days.map((d) => {
                  const isSusp = isSuspendedDay(d);
                  const isSuspStart = suspensionWindow && d === suspensionWindow.startDay;
                  return (
                    <th
                      key={d}
                      className={`w-7 border-l border-border/50 p-1 text-center font-normal ${
                        isSusp
                          ? 'bg-red-100/90 font-semibold text-red-900 ring-1 ring-inset ring-red-400/50'
                          : hasReportActuals && d === timeNow
                            ? 'bg-amber-100 font-semibold text-amber-900 ring-1 ring-inset ring-amber-400'
                            : 'text-text-muted'
                      }`}
                      title={
                        isSusp
                          ? `Suspension period (Day ${d}${suspensionWindow ? ` · ${suspensionWindow.start} to ${suspensionWindow.end}` : ''})`
                          : undefined
                      }
                    >
                      {d}
                      {isSuspStart ? (
                        <span className="block text-[7px] font-bold uppercase tracking-tight text-red-700">
                          Susp
                        </span>
                      ) : hasReportActuals && d === timeNow ? (
                        <span className="block text-[8px] font-bold uppercase">Now</span>
                      ) : null}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {renderedTasks.map((task) => {
                const hasActual = hasReportActuals && task.actualEndDay != null;
                const status = getScheduleStatus(
                  task.endDay,
                  hasReportActuals ? task.actualEndDay : null,
                  timeNow,
                );
                const critical = !!task.isCritical;
                const hasSegments = Array.isArray(task.segments) && task.segments.length > 0;

                return (
                  <tr
                    key={task.id}
                    className={`border-b border-border/50 ${critical ? 'bg-red-50/60' : ''}`}
                  >
                    <td className="p-2 text-text-muted">{task.index}</td>
                    <td className={`p-2 font-medium ${critical ? 'text-red-700' : 'text-text'}`}>
                      {task.itemNo ? (
                        <span className="mr-2 font-mono text-[11px] font-semibold text-text-muted">
                          {task.itemNo}
                        </span>
                      ) : null}
                      {task.name}
                      {critical ? (
                        <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-red-600">
                          Critical
                        </span>
                      ) : null}
                    </td>
                    {days.map((d) => {
                      const isSuspendedColumn = isSuspendedDay(d);

                      if (hasSegments) {
                        const seg = task.segments!.find((s) => s.startDay === d);
                        const insideAnySeg = task.segments!.some((s) => d >= s.startDay && d <= s.endDay);

                        if (seg) {
                          const span = Math.max(1, seg.endDay - seg.startDay + 1);
                          const isSusp = seg.type === 'suspended';
                          return (
                            <td
                              key={d}
                              colSpan={span}
                              className={`relative h-10 border-l border-border/30 p-1 align-middle ${
                                isSusp
                                  ? 'bg-red-50/50'
                                  : hasReportActuals && timeNow >= seg.startDay && timeNow <= seg.endDay
                                    ? 'bg-amber-50/40'
                                    : 'bg-card'
                              }`}
                            >
                              {isSusp ? (
                                <div
                                  className="group relative flex h-4.5 w-full items-center justify-center rounded-sm bg-red-600 px-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-sm ring-1 ring-red-700/60 transition-transform hover:scale-[1.01]"
                                  title={`Suspended Period: Days ${seg.startDay}–${seg.endDay}${
                                    suspensionWindow ? ` (${suspensionWindow.start} to ${suspensionWindow.end})` : ''
                                  }`}
                                >
                                  <span className="truncate">Suspended</span>
                                </div>
                              ) : (
                                <div
                                  className={`h-4.5 w-full rounded-sm ${
                                    hasActual
                                      ? STATUS_COLORS[status]
                                      : STATUS_COLORS.planned
                                  } ${critical ? 'ring-2 ring-red-600 ring-offset-1' : ''}`}
                                  title={`Days ${seg.startDay}–${seg.endDay}${
                                    seg.type === 'resumed'
                                      ? ' (Resumed Continuation)'
                                      : seg.type === 'active'
                                        ? ' (Active Schedule)'
                                        : ' (Target Plan)'
                                  }${hasActual ? ` · actual end ${task.actualEndDay}` : ''}${
                                    critical ? ' · Critical path' : ''
                                  }`}
                                />
                              )}
                            </td>
                          );
                        }

                        if (insideAnySeg) {
                          return null;
                        }

                        return (
                          <td
                            key={d}
                            className={`h-10 min-w-[1.75rem] border-l border-border/30 ${
                              isSuspendedColumn
                                ? 'bg-red-50/25'
                                : hasReportActuals && d === timeNow
                                  ? 'bg-amber-50/80'
                                  : 'bg-card'
                            }`}
                          />
                        );
                      }

                      // Fallback when no segments are explicitly provided (e.g. original unshifted plan)
                      const inPlanned = d >= task.startDay && d <= task.endDay;
                      const isBarStart = d === task.startDay;
                      const plannedSpan = Math.max(0, task.endDay - task.startDay + 1);

                      if (!inPlanned) {
                        return (
                          <td
                            key={d}
                            className={`h-10 min-w-[1.75rem] border-l border-border/30 ${
                              isSuspendedColumn
                                ? 'bg-red-50/25'
                                : hasReportActuals && d === timeNow
                                  ? 'bg-amber-50/80'
                                  : 'bg-card'
                            }`}
                          />
                        );
                      }

                      if (isBarStart && plannedSpan > 0) {
                        return (
                          <td
                            key={d}
                            colSpan={plannedSpan}
                            className={`relative h-10 border-l border-border/30 bg-card p-1 align-middle ${
                              hasReportActuals && timeNow >= task.startDay && timeNow <= task.endDay
                                ? 'bg-amber-50/40'
                                : ''
                            }`}
                          >
                            <div
                              className={`h-4.5 w-full rounded-sm ${
                                hasActual ? STATUS_COLORS[status] : STATUS_COLORS.planned
                              } ${critical ? 'ring-2 ring-red-600 ring-offset-1' : ''}`}
                              title={`Days ${task.startDay}–${task.endDay}${
                                hasActual ? ` · actual end ${task.actualEndDay}` : ' · Target Plan'
                              }${critical ? ' · Critical path' : ''}`}
                            />
                          </td>
                        );
                      }

                      return null;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
      </div>

      <PreviewModal
        title="Bar Chart preview"
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        wide
        downloading={exporting}
        onDownload={() => {
          setExporting(true);
          try {
            exportBarChartPdf(barChartPdfInput());
          } finally {
            setExporting(false);
          }
        }}
      >
        <div id="bar-chart-preview-print" className="space-y-3">
          <div>
            <p className="text-sm font-semibold text-text">Project {projectId}</p>
            <p className="text-xs text-text-muted">
              {totalDays} days
              {hasReportActuals ? ` · Time now: Day ${timeNow}` : ' · Target Plan only'}
              {progressStatus ? ` · ${progressStatus.label}` : ''}
              {suspensionWindow && baselineView === 'revised'
                ? ` · Suspended: Days ${suspensionWindow.startDay}–${suspensionWindow.endDay}`
                : ''}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-xs">
              <thead>
                <tr className="border-b border-border bg-surface-muted">
                  <th className="p-2 text-left">#</th>
                  <th className="min-w-[180px] p-2 text-left">Task</th>
                  <th className="p-2 text-left">Start</th>
                  <th className="p-2 text-left">End</th>
                  <th className="p-2 text-left">Actual end</th>
                  <th className="min-w-[220px] p-2 text-left">Timeline</th>
                </tr>
              </thead>
              <tbody>
                {renderedTasks.map((task) => {
                  const hasActual = hasReportActuals && task.actualEndDay != null;
                  const status = getScheduleStatus(
                    task.endDay,
                    hasReportActuals ? task.actualEndDay : null,
                    timeNow,
                  );
                  const hasSegments = Array.isArray(task.segments) && task.segments.length > 0;
                  return (
                    <tr key={task.id} className="border-b border-border/50">
                      <td className="p-2 text-text-muted">{task.index}</td>
                      <td className={`p-2 font-medium ${task.isCritical ? 'text-red-700' : 'text-text'}`}>
                        {task.itemNo ? (
                          <span className="mr-2 font-mono text-[11px] font-semibold text-text-muted">
                            {task.itemNo}
                          </span>
                        ) : null}
                        {task.name}
                        {task.isCritical ? (
                          <span className="ml-2 text-[10px] font-bold uppercase text-red-600">Critical</span>
                        ) : null}
                      </td>
                      <td className="p-2">{task.startDay}</td>
                      <td className="p-2">{task.endDay}</td>
                      <td className="p-2">{hasActual ? task.actualEndDay : '—'}</td>
                      <td className="p-2">
                        <div className="relative h-4 w-full rounded bg-surface-muted">
                          {hasSegments ? (
                            task.segments!.map((seg, sIdx) => {
                              const leftPct = totalDays > 0 ? ((seg.startDay - 1) / totalDays) * 100 : 0;
                              const widthPct =
                                totalDays > 0
                                  ? (Math.max(0, seg.endDay - seg.startDay + 1) / totalDays) * 100
                                  : 0;
                              const isSusp = seg.type === 'suspended';
                              return (
                                <div
                                  key={sIdx}
                                  className={`absolute top-0 h-4 rounded-sm ${
                                    isSusp
                                      ? 'bg-red-600'
                                      : hasActual
                                        ? STATUS_COLORS[status]
                                        : STATUS_COLORS.planned
                                  } ${!isSusp && task.isCritical ? 'ring-1 ring-red-600' : ''}`}
                                  style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 0.5)}%` }}
                                  title={`${isSusp ? 'Suspended' : seg.type === 'resumed' ? 'Resumed Continuation' : 'Active'}: Days ${seg.startDay}–${seg.endDay}`}
                                />
                              );
                            })
                          ) : (
                            <div
                              className={`absolute top-0 h-4 rounded-sm ${
                                hasActual ? STATUS_COLORS[status] : STATUS_COLORS.planned
                              } ${task.isCritical ? 'ring-1 ring-red-600' : ''}`}
                              style={{
                                left: `${totalDays > 0 ? ((task.startDay - 1) / totalDays) * 100 : 0}%`,
                                width: `${totalDays > 0 ? (Math.max(0, task.endDay - task.startDay + 1) / totalDays) * 100 : 0}%`,
                              }}
                              title={`Days ${task.startDay}–${task.endDay}`}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </PreviewModal>
    </main>
  );
}
