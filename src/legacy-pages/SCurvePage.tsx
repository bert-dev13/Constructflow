'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CartesianGrid,
  DefaultZIndexes,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  usePlotArea,
  useXAxisScale,
  useYAxisScale,
  XAxis,
  YAxis,
  ZIndexLayer,
} from 'recharts';
import { ProjectSelect } from '../components/ProjectSelect';
import { DocumentsBackLink } from '../components/DocumentsBackLink';
import { ReportProgressFeed, type ReportProgressEntry } from '../components/ReportProgressFeed';
import { useAuth } from '../context/AuthContext';
import { useSelectedProject } from '../context/SelectedProjectContext';
import { generateSwaStewaSCurve,
  getSCurve,
  saveSCurveCostItems,
  saveSCurvePeriods,
  saveSCurveSettings,
  type SCurveActivity,
  type SCurveCostItem,
  type SCurveComparison,
  type SCurvePeriodEdit,
  type SCurvePeriodRow,
  type SCurveReportingInterval,
  type ScheduleStatus,
  type SCurveSnapshotSummary,
  type SCurveType,
} from '../lib/sCurveApi';
import { computeSCurveCostSummary } from '../lib/sCurveItems';
import type { SCurvePayItemMappingLine } from '../lib/sCurveCostWeights';
import type { SCurvePoint } from '../types';
import { exportSCurvePdf, formatChartPercent, placePercentLabels } from '../lib/chartPdfExport';
import { NavIcon, type NavIconName } from '../components/NavIcon';
import { Pagination } from '../components/ui/Pagination';
import { PreviewModal } from '../components/ui/PreviewModal';
import { usePagination } from '../hooks/usePagination';
import { canEditProjectCharts, canEditSCurvePeriods } from '../lib/chartPermissions';
import { getLocalChartViewMode, setLocalChartViewMode } from '../lib/chartViewPreferences';
import {
  curveSeriesDisplayDates,
  originalCurveDisplayDates,
  thinDatesByPixelGap,
  sampleSeriesDisplayDates,
} from '../lib/curveUtils';

type ChartPoint = SCurvePoint & { t: number };

const STATUS_STYLES: Record<string, { badge: string; label: string }> = {
  target_only: { badge: 'bg-blue-50 text-blue-800', label: 'Target Plan only' },
  on_schedule: { badge: 'bg-primary-light text-primary', label: 'On Track' },
  ahead: { badge: 'bg-emerald-50 text-emerald-800', label: 'Ahead' },
  behind: { badge: 'bg-red-50 text-red-800', label: 'Behind' },
  unknown: { badge: 'bg-surface-muted text-text-muted', label: 'Status unknown' },
};

function formatSnapshotLabel(version: SCurveSnapshotSummary): string {
  const label = version.trigger_label?.trim() ?? '';
  if (label) return label;
  const when = version.captured_at ? new Date(version.captured_at).toLocaleString() : 'Saved';
  return `${when} — ${version.trigger_type.replace(/_/g, ' ')}`;
}

function sourceOptionLabel(entry: ReportProgressEntry): string {
  const type = entry.reportType === 'STEWA' ? 'STEWA' : 'SWA';
  const period = entry.asOfLabel?.trim() || entry.date;
  return `${type} – As of ${period}`;
}

function formatAxisDate(ms: number): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function MarkerDot({
  cx,
  cy,
  payload,
  dates,
  fill,
  active = false,
}: {
  cx?: number;
  cy?: number;
  payload?: ChartPoint | SCurvePoint;
  dates?: Set<string>;
  fill: string;
  active?: boolean;
}) {
  if (cx == null || cy == null || !Number.isFinite(cx) || !Number.isFinite(cy) || !payload?.date) {
    return <g />;
  }
  const key = payload.date.slice(0, 10);
  // If a dates set is provided, only render markers for those dates (covers active and inactive).
  if (dates && !dates.has(key)) return <g />;
  return <circle cx={cx} cy={cy} r={active ? 4.5 : 3.5} fill={fill} />;
}

function PlanLine({
  dataKey,
  name,
  stroke,
  strokeWidth = 2,
  dotDates,
  animationBegin = 0,
  animate = true,
}: {
  dataKey: 'originalPlan' | 'actual';
  name: string;
  stroke: string;
  strokeWidth?: number;
  dotDates?: Set<string>;
  animationBegin?: number;
  animate?: boolean;
}) {
  return (
    <Line
      type={dataKey === 'actual' ? 'linear' : 'monotone'}
      dataKey={dataKey}
      name={name}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      isAnimationActive={animate}
      animationDuration={1200}
      animationEasing="ease-out"
      animationBegin={animationBegin}
      dot={(props) => (
        <MarkerDot
          cx={props.cx}
          cy={props.cy}
          payload={props.payload as ChartPoint | undefined}
          dates={dotDates}
          fill={stroke}
        />
      )}
      activeDot={(props) => (
        <MarkerDot
          cx={props.cx}
          cy={props.cy}
          payload={props.payload as ChartPoint | undefined}
          dates={dotDates}
          fill={stroke}
          active
        />
      )}
      connectNulls
    />
  );
}

function LegendItem({
  color,
  label,
  dashed = false,
}: {
  color: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2 text-xs font-semibold text-text">
      <svg width="28" height="10" aria-hidden="true">
        <line
          x1="1"
          y1="5"
          x2="27"
          y2="5"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={dashed ? '5 3' : undefined}
        />
      </svg>
      {label}
    </span>
  );
}

/** Sparse Original markers + labels (always on; denser when Show percentage labels is checked). */
function OriginalPercentLabels({
  points,
  showLabels,
  periodsCount,
}: {
  points: ChartPoint[];
  showLabels: boolean;
  periodsCount?: number;
}) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  const plot = usePlotArea();
  if (!xScale || !yScale) return null;

  const byDate = new Map(points.map((point) => [point.date.slice(0, 10), point]));
  const xForDate = (date: string) => {
    const point = byDate.get(date);
    if (!point) return null;
    const x = xScale(point.t, { position: 'middle' });
    return x != null && Number.isFinite(x) ? x : null;
  };

  const count = Math.max(1, Math.floor(periodsCount ?? 7));
  const sampled = originalCurveDisplayDates(points, count);
  const sampledXs = sampled.map((date) => xForDate(date)).filter((x): x is number => x != null);
  const span = sampledXs.length >= 2 ? sampledXs[sampledXs.length - 1] - sampledXs[0] : 0;
  const autoCount = span < 1 ? 2 : Math.min(7, Math.max(2, Math.floor(span / 34) + 1));
  // When showLabels is false, do not render percentage text labels (dots remain visible).
  const labelDates = showLabels
    ? sampled
    : [];

  const seeds = labelDates.flatMap((date) => {
    const point = byDate.get(date);
    const value = point?.originalPlan;
    if (!point || value == null || !Number.isFinite(value)) return [];
    const x = xScale(point.t, { position: 'middle' });
    const y = yScale(value);
    if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) return [];
    const text = formatChartPercent(value);
    return [
      {
        x,
        y,
        value,
        series: 'original' as const,
        width: Math.max(10, text.length * 10 * 0.72),
        date,
      },
    ];
  });
  const placed = placePercentLabels(seeds, {
    fontSize: 10,
    plotTop: plot?.y,
    plotBottom: plot ? plot.y + plot.height : undefined,
  });

  return (
    <ZIndexLayer zIndex={DefaultZIndexes.label}>
      <g>
        {sampled.map((date) => {
          const point = byDate.get(date);
          if (!point || point.originalPlan == null) return null;
          const x = xScale(point.t, { position: 'middle' });
          const y = yScale(point.originalPlan);
          if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) return null;
          return <circle key={`dot-${date}`} cx={x} cy={y} r={3.5} fill="#2563eb" />;
        })}
        {placed.map((label) => {
          const point = label.date ? byDate.get(label.date) : undefined;
          const anchorX = point ? xScale(point.t, { position: 'middle' }) : label.x;
          const anchorY = point && point.originalPlan != null ? yScale(point.originalPlan) : label.y;
          const showLeader =
            anchorX != null &&
            anchorY != null &&
            Math.hypot(label.labelX - anchorX, label.labelY - anchorY) > 6;
          return (
            <g key={`label-${label.series}-${label.x}-${label.value}`}>
              {showLeader && (
                <line
                  x1={anchorX}
                  y1={anchorY}
                  x2={label.labelX}
                  y2={label.labelY}
                  stroke="#cbd5e1"
                  strokeWidth={1}
                />
              )}
              <text
                x={label.labelX}
                y={label.labelY}
                textAnchor="middle"
                fill="#2563eb"
                stroke="#ffffff"
                strokeWidth={3}
                fontSize={10}
                fontWeight={600}
                style={{ paintOrder: 'stroke' }}
              >
                {label.text}
              </text>
            </g>
          );
        })}
      </g>
    </ZIndexLayer>
  );
}

/** Target / Actual percentage labels when Show percentage labels is on. */
function ExtraPercentLabels({
  points,
  show,
  datesBySeries,
}: {
  points: ChartPoint[];
  show: boolean;
  datesBySeries: { revised: Set<string>; actual: Set<string> };
}) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  const plot = usePlotArea();
  if (!show || !xScale || !yScale) return null;

  const byDate = new Map(points.map((point) => [point.date.slice(0, 10), point]));
  const seeds = (['revised', 'actual'] as const).flatMap((series) => {
    const key = series === 'revised' ? 'currentPlan' : 'actual';
    return [...datesBySeries[series]].sort().flatMap((date) => {
      const point = byDate.get(date);
      const value = point?.[key];
      if (!point || value == null || !Number.isFinite(value)) return [];
      if (
        series === 'revised' &&
        point.originalPlan != null &&
        Math.abs(value - point.originalPlan) < 0.05
      ) {
        return [];
      }
      const x = xScale(point.t, { position: 'middle' });
      const y = yScale(value);
      if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) return [];
      const text = formatChartPercent(value);
      return [{ x, y, value, series, width: Math.max(10, text.length * 10 * 0.72) }];
    });
  });
  const placed = placePercentLabels(seeds, {
    fontSize: 10,
    plotTop: plot?.y,
    plotBottom: plot ? plot.y + plot.height : undefined,
  });

  return (
    <ZIndexLayer zIndex={DefaultZIndexes.label}>
      <g>
        {placed.map((label) => (
          <text
            key={`${label.series}-${label.x}-${label.value}`}
            x={label.labelX}
            y={label.labelY}
            textAnchor="middle"
            fill={label.series === 'actual' ? '#f97316' : '#7c3aed'}
            stroke="#ffffff"
            strokeWidth={3}
            fontSize={10}
            fontWeight={600}
            style={{ paintOrder: 'stroke' }}
          >
            {label.text}
          </text>
        ))}
      </g>
    </ZIndexLayer>
  );
}

/** Orange markers only on chart points that already carry a recorded Actual value. */
function ActualOverlayMarkers({
  chartPoints,
  dates,
}: {
  chartPoints: ChartPoint[];
  dates: Set<string>;
}) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  if (!xScale || !yScale || chartPoints.length === 0 || dates.size === 0) return null;

  return (
    <g>
      {chartPoints.map((row, idx) => {
        const date = row.date.slice(0, 10);
        if (!dates.has(date) || row.actual == null || !Number.isFinite(Number(row.actual))) return null;
        const x = xScale(row.t, { position: 'middle' }) as number | null;
        const y = yScale(Number(row.actual));
        if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) return null;
        return <circle key={`actual-overlay-${date}-${idx}`} cx={x} cy={y} r={3.5} fill="#f97316" stroke="#fff" strokeWidth={0.5} />;
      })}
    </g>
  );
}

type SCurveTab = 'curve' | 'baseline' | 'cost' | 'activities' | 'history';

function formatMoney(value: number): string {
  return value.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function SCurvePage() {
  const { user } = useAuth();
  const { projectId, setProjectId } = useSelectedProject();
  const [curveType, setCurveType] = useState<SCurveType>('pdm_based');
  const [reportingInterval, setReportingInterval] = useState<SCurveReportingInterval>('30_day');
  const [theoreticalTotalPeriods, setTheoreticalTotalPeriods] = useState(5);
  const [periodInput, setPeriodInput] = useState<string>('5');
  const firstLoadRef = useRef(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [periodSaveError, setPeriodSaveError] = useState('');
  const [generatingCurve, setGeneratingCurve] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [generateMessage, setGenerateMessage] = useState('');
  const [settingsVersion, setSettingsVersion] = useState(0);
  const [points, setPoints] = useState<SCurvePoint[]>([]);
  const [activities, setActivities] = useState<SCurveActivity[]>([]);
  const [costItems, setCostItems] = useState<SCurveCostItem[]>([]);
  const [periods, setPeriods] = useState<SCurvePeriodRow[]>([]);
  const [periodEdits, setPeriodEdits] = useState<Record<string, SCurvePeriodEdit>>({});
  const [criticalPath, setCriticalPath] = useState<string[]>([]);
  const [syncedFromPdm, setSyncedFromPdm] = useState(false);
  const [hasActualProgress, setHasActualProgress] = useState(false);
  const [hasRevisedSchedule, setHasRevisedSchedule] = useState(false);
  const [scheduleStatus, setScheduleStatus] = useState<ScheduleStatus | null>(null);
  const [comparisons, setComparisons] = useState<SCurveComparison[]>([]);
  const [reportFeed, setReportFeed] = useState<ReportProgressEntry[]>([]);
  const [latestReportPercent, setLatestReportPercent] = useState<number | null>(null);
  const [latestReportDate, setLatestReportDate] = useState<string | null>(null);
  const [versions, setVersions] = useState<SCurveSnapshotSummary[]>([]);
  const [viewingSnapshotId, setViewingSnapshotId] = useState<string | null>(null);
  const [viewingSnapshotLabel, setViewingSnapshotLabel] = useState<string | null>(null);
  const [projectStartDate, setProjectStartDate] = useState<string | null>(null);
  const [projectEndDate, setProjectEndDate] = useState<string | null>(null);
  const [targetPlanPercent, setTargetPlanPercent] = useState<number | null>(null);
  const [targetPlanPhp, setTargetPlanPhp] = useState<number | null>(null);
  const [actualPlanPercent, setActualPlanPercent] = useState<number | null>(null);
  const [apiTotalContractAmount, setApiTotalContractAmount] = useState(0);
  const [payItemMappings, setPayItemMappings] = useState<SCurvePayItemMappingLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [chartReady, setChartReady] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [showPercentLabels, setShowPercentLabels] = useState(false);
  const [costSaving, setCostSaving] = useState(false);
  const [costDirty, setCostDirty] = useState(false);
  const [costMessage, setCostMessage] = useState('');
  const savedPeriodCountRef = useRef(1);
  const canEditCharts = canEditProjectCharts(user?.role);
  const canEditPeriods = canEditSCurvePeriods(user?.role);
  const canEditCostItems = canEditCharts;
  // Candidate C: prefer full SWA contract amount from API; keep item weight % when present.
  const costSummary = useMemo(() => {
    if (costDirty) return computeSCurveCostSummary(costItems);
    const mappedWeightPct = costItems.reduce((sum, item) => sum + (Number(item.weightPct) || 0), 0);
    if (mappedWeightPct <= 0) return computeSCurveCostSummary(costItems);
    const itemsAmount = costItems.reduce(
      (sum, item) => sum + (Number(item.amount) || item.quantity * item.unitCost),
      0,
    );
    return {
      items: costItems,
      totalContractAmount: apiTotalContractAmount > 0 ? apiTotalContractAmount : itemsAmount,
      totalWeightPct: mappedWeightPct,
    };
  }, [costDirty, costItems, apiTotalContractAmount]);
  const unmappedWeightPct = payItemMappings
    .filter((line) => line.status !== 'mapped')
    .reduce((sum, line) => sum + (Number(line.weightPct) || 0), 0);
  const [activeTab, setActiveTab] = useState<SCurveTab>('curve');
  const costPaging = usePagination(costSummary.items, { resetKey: `${projectId}-${viewingSnapshotId ?? 'live'}` });
  const activityPaging = usePagination(activities, { resetKey: projectId });
  const periodPaging = usePagination(periods, { resetKey: `${projectId}-${reportingInterval}` });
  const comparisonPaging = usePagination(comparisons, { resetKey: projectId });

  const sourceReports = useMemo(
    () =>
      reportFeed.filter(
        (entry) => (entry.reportType === 'SWA' || entry.reportType === 'STEWA') && entry.id,
      ),
    [reportFeed],
  );

  const chartPoints = useMemo<ChartPoint[]>(
    () =>
      points.map((point) => {
        const iso = String(point.date ?? '').slice(0, 10);
        const ms = Date.parse(`${iso}T00:00:00Z`);
        return {
          ...point,
          // fallback to 0 when date parse fails to avoid runtime exceptions during re-render
          t: Number.isFinite(ms) ? ms : 0,
        } as ChartPoint;
      }),
    [points],
  );
  const originalDotDates = useMemo(() => {
    try {
      return new Set(originalCurveDisplayDates(chartPoints, Math.max(1, Math.floor(theoreticalTotalPeriods || 1))));
    } catch {
      return new Set<string>();
    }
  }, [chartPoints, theoreticalTotalPeriods]);
  // Periods samples Revised markers only. Actual markers stay on recorded report dates.
  const revisedDotDates = useMemo(() => {
    const dates = sampleSeriesDisplayDates(
      chartPoints as unknown as Array<{ date: string } & Record<string, unknown>>,
      'currentPlan',
      Math.max(1, Math.floor(theoreticalTotalPeriods || 1)),
    );
    return new Set(dates);
  }, [chartPoints, theoreticalTotalPeriods]);
 
  // Markers only where the plotted Actual equals a recorded SWA/STEWA percent.
  // Suspension boundary points that merely hold the last value do not match, so they stay unmarked.
  const actualDotDates = useMemo(() => {
    const recordedByDate = new Map<string, number[]>();
    for (const report of reportFeed) {
      if (report.reportType !== 'SWA' && report.reportType !== 'STEWA') continue;
      if (report.percent == null || !Number.isFinite(report.percent) || !report.date) continue;
      const date = report.date.slice(0, 10);
      const values = recordedByDate.get(date) ?? [];
      values.push(report.percent);
      recordedByDate.set(date, values);
    }
    const dots = new Set<string>();
    for (const point of chartPoints) {
      if (point.actual == null || !Number.isFinite(Number(point.actual))) continue;
      const recorded = recordedByDate.get(point.date.slice(0, 10));
      if (!recorded) continue;
      const plotted = Number(point.actual);
      if (recorded.some((value) => Math.abs(value - plotted) < 0.02)) {
        dots.add(point.date.slice(0, 10));
      }
    }
    return dots;
  }, [chartPoints, reportFeed]);

  const extraLabelDates = useMemo(
    () => ({ revised: revisedDotDates, actual: actualDotDates }),
    [revisedDotDates, actualDotDates],
  );

  useEffect(() => {
    setViewingSnapshotId(null);
    setGenerateOpen(false);
    setSelectedSourceId('');
  }, [projectId]);

  useEffect(() => {
    if (!generateOpen) return;
    setSelectedSourceId((current) =>
      sourceReports.some((entry) => entry.id === current) ? current : sourceReports[0]?.id ?? '',
    );
  }, [generateOpen, sourceReports]);

  useEffect(() => {
    setChartReady(true);
  }, []);

  const sCurvePdfInput = () => ({
    projectLabel: `Project ${projectId}`,
    points,
    comparisons,
    periods: curveType === 'pdm_based' ? [] : periods,
    status: scheduleStatus,
    targetPlanPercent,
    targetPlanPhp,
    actualPlanPercent,
    showPercentLabels,
  });

  const updateCostItem = (
    activityId: string,
    patch: Partial<Pick<SCurveCostItem, 'itemNo' | 'description' | 'quantity' | 'unitCost'>>,
  ) => {
    setCostItems((current) =>
      current.map((item) => (item.activityId === activityId ? { ...item, ...patch } : item)),
    );
    setCostDirty(true);
    setCostMessage('');
  };

  const persistScheduleSettings = async (next: {
    curveType?: SCurveType;
    reportingInterval?: SCurveReportingInterval;
    theoreticalTotalPeriods?: number;
  }) => {
    if (viewingSnapshotId || !canEditCharts) return;
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

  const persistPeriodCount = async (count: number) => {
    if (viewingSnapshotId || !canEditPeriods) return;
    const next = Math.max(1, Math.floor(count) || 1);
    if (next === savedPeriodCountRef.current) return;
    setTheoreticalTotalPeriods(next);
    setPeriodSaveError('');
    setSettingsSaving(true);
    try {
      await saveSCurvePeriods({
        project_id: projectId,
        theoretical_total_periods: next,
        period_edits: periodEdits,
      });
      setSettingsVersion((value) => value + 1);
    } catch (err) {
      setPeriodSaveError(err instanceof Error ? err.message : 'Could not save S-Curve periods.');
    } finally {
      setSettingsSaving(false);
    }
  };

  const persistPeriodTarget = async (periodIndex: number, raw: string) => {
    if (viewingSnapshotId || !canEditPeriods) return;
    const pct = Number(raw);
    if (!Number.isFinite(pct)) return;
    const nextEdits = {
      ...periodEdits,
      [String(periodIndex)]: { targetAccomplishmentPct: Math.max(0, pct) },
    };
    setPeriodEdits(nextEdits);
    setPeriodSaveError('');
    setSettingsSaving(true);
    try {
      await saveSCurvePeriods({
        project_id: projectId,
        period_edits: nextEdits,
      });
      setSettingsVersion((value) => value + 1);
    } catch (err) {
      setPeriodSaveError(err instanceof Error ? err.message : 'Could not save S-Curve periods.');
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleCurveTypeChange = (nextType: SCurveType) => {
    if (viewingSnapshotId || settingsSaving) return;
    setCurveType(nextType);
    setLocalChartViewMode(user, projectId, 'scurve', nextType);
    if (canEditCharts) {
      void persistScheduleSettings({ curveType: nextType });
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const viewPreference = getLocalChartViewMode(user, projectId, 'scurve');
    const effectiveCurveType = viewPreference ?? curveType;
    getSCurve(projectId, viewingSnapshotId, undefined, effectiveCurveType)
      .then((res) => {
        if (cancelled) return;
        setPoints(res.points);
        setActivities(res.activities);
        setCostItems(res.cost_items ?? []);
        setPeriods(res.periods ?? []);
        setPeriodEdits(res.period_edits ?? {});
        setCriticalPath(res.critical_path);
        setSyncedFromPdm(res.synced_from_pdm);
        setHasActualProgress(res.has_actual_progress);
        setHasRevisedSchedule(res.has_revised_schedule);
        setScheduleStatus(res.schedule_status);
        setComparisons(res.comparisons ?? []);
        setReportFeed(res.report_feed ?? []);
        setLatestReportPercent(res.latest_report_percent);
        setLatestReportDate(res.latest_report_date);
        setVersions(res.versions ?? []);
        setViewingSnapshotLabel(res.viewing_snapshot_label);
        setProjectStartDate(res.project_start_date ?? null);
        setProjectEndDate(res.project_end_date ?? null);
        if (viewPreference) {
          setCurveType(viewPreference);
        } else {
          setCurveType(res.curve_type);
        }
        setReportingInterval(res.reporting_interval);
        // On first load for this project/viewing snapshot show default = 5.
        if (firstLoadRef.current) {
          setTheoreticalTotalPeriods(5);
          setPeriodInput(String(5));
          firstLoadRef.current = false;
        }
        savedPeriodCountRef.current = res.theoretical_total_periods;
        setTargetPlanPercent(res.target_plan_percent ?? null);
        setTargetPlanPhp(res.target_plan_php ?? null);
        setActualPlanPercent(res.actual_plan_percent ?? null);
        setApiTotalContractAmount(Number(res.total_contract_amount) || 0);
        setPayItemMappings(res.pay_item_mappings ?? []);
        setCostDirty(false);
        setCostMessage('');
      })
      .catch(() => {
        if (cancelled) return;
        setPoints([]);
        setActivities([]);
        setCostItems([]);
        setPeriods([]);
        setPeriodEdits({});
        setCriticalPath([]);
        setSyncedFromPdm(false);
        setHasActualProgress(false);
        setHasRevisedSchedule(false);
        setScheduleStatus(null);
        setComparisons([]);
        setReportFeed([]);
        setLatestReportPercent(null);
        setLatestReportDate(null);
        setVersions([]);
        setViewingSnapshotLabel(null);
        setProjectStartDate(null);
        setProjectEndDate(null);
        setCurveType('pdm_based');
        setReportingInterval('30_day');
        setTheoreticalTotalPeriods(1);
        setTargetPlanPercent(null);
        setTargetPlanPhp(null);
        setActualPlanPercent(null);
        setApiTotalContractAmount(0);
        setPayItemMappings([]);
        setCostDirty(false);
        setCostMessage('');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, viewingSnapshotId, curveType, settingsVersion, user]);
  // Reset first-load flag when user navigates to a different project or snapshot
  useEffect(() => {
    firstLoadRef.current = true;
  }, [projectId, viewingSnapshotId]);

  useEffect(() => {
    if (!canEditCostItems || !costDirty || viewingSnapshotId) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        setCostSaving(true);
        try {
          const res = await saveSCurveCostItems({
            project_id: projectId,
            items: costItems.map((item) => ({
              activityId: item.activityId,
              itemNo: item.itemNo,
              description: item.description,
              quantity: item.quantity,
              unitCost: item.unitCost,
            })),
          });
          setCostItems(res.cost_items);
          setApiTotalContractAmount(Number(res.total_contract_amount) || 0);
          setCostDirty(false);
          setCostMessage('Cost items auto-saved.');
        } catch {
          setCostMessage('Could not save S-Curve cost items.');
        } finally {
          setCostSaving(false);
        }
      })();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [canEditCostItems, costDirty, costItems, projectId, viewingSnapshotId]);

  const statusStyle = STATUS_STYLES[scheduleStatus?.status ?? 'unknown'] ?? STATUS_STYLES.unknown;
  const variance =
    targetPlanPercent != null && actualPlanPercent != null
      ? Math.round((actualPlanPercent - targetPlanPercent) * 100) / 100
      : null;

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
              S-Curve
            </h1>
            {(projectStartDate || projectEndDate) && (
              <p className="mt-0.5 truncate text-[11px] text-text-muted">
                {projectStartDate
                  ? new Date(`${projectStartDate}T00:00:00`).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })
                  : '—'}
                {' → '}
                {projectEndDate
                  ? new Date(`${projectEndDate}T00:00:00`).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })
                  : '—'}
              </p>
            )}
          </div>

          <div className="relative z-30 flex flex-wrap items-center justify-end gap-2">
            {scheduleStatus && (
              <div
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyle.badge}`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
                {statusStyle.label}
                {scheduleStatus.planned_pct != null && (
                  <span className="font-medium opacity-70">
                    {scheduleStatus.planned_pct}%
                    {scheduleStatus.actual_pct != null ? ` · ${scheduleStatus.actual_pct}%` : ''}
                  </span>
                )}
              </div>
            )}

            <div
              role="group"
              aria-label="Schedule basis"
              className="flex shrink-0 rounded-lg bg-surface-muted p-0.5"
            >
              <button
                type="button"
                onClick={() => handleCurveTypeChange('pdm_based')}
                disabled={settingsSaving || !!viewingSnapshotId}
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
                onClick={() => handleCurveTypeChange('ideal_theoretical')}
                disabled={settingsSaving || !!viewingSnapshotId}
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
              <label className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs transition focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/20">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  Interval
                </span>
                <select
                  value={reportingInterval}
                  disabled={settingsSaving || !!viewingSnapshotId}
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

            {curveType === 'ideal_theoretical' && canEditPeriods && !viewingSnapshotId && (
              <label className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs transition focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/20">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  Periods
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={periodInput}
                  disabled={settingsSaving}
                  aria-label="S-Curve periods"
                  onChange={(e) => {
                    // Allow empty during editing, allow numeric text only
                    const v = String(e.target.value || '');
                    // permit digits and empty; strip non-digits
                    if (v === '') {
                      setPeriodInput('');
                    } else {
                      const filtered = v.replace(/[^\d]/g, '');
                      setPeriodInput(filtered);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  onBlur={() => {
                    // Commit on blur: parse, validate, clamp, persist
                    const raw = (periodInput ?? '').trim();
                    let next: number;
                    if (raw === '') {
                      next = 5;
                    } else {
                      const n = Math.floor(Number(raw) || 0);
                      if (!Number.isFinite(n) || n <= 0) {
                        next = 5;
                      } else if (n < 2) {
                        next = 2;
                      } else if (n > 20) {
                        next = 20;
                      } else {
                        next = n;
                      }
                    }
                    // update display and persist
                    setTheoreticalTotalPeriods(next);
                    setPeriodInput(String(next));
                    void persistPeriodCount(next);
                  }}
                  className="w-12 bg-transparent text-xs font-semibold text-text outline-none"
                />
              </label>
            )}

            <div className="relative z-30 min-w-[180px] sm:w-[220px]">
              <ProjectSelect value={projectId} onChange={setProjectId} />
            </div>

            <button
              type="button"
              disabled={points.length === 0}
              onClick={() => setPreviewOpen(true)}
              className="shrink-0 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text transition hover:border-primary/30 hover:bg-primary-light/40 disabled:opacity-50"
            >
              Preview
            </button>
            <button
              type="button"
              disabled={exporting || points.length === 0}
              onClick={() => {
                setExporting(true);
                try {
                  exportSCurvePdf(sCurvePdfInput());
                } finally {
                  setExporting(false);
                }
              }}
              className="shrink-0 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text transition hover:border-primary/30 hover:bg-primary-light/40 disabled:opacity-50"
            >
              {exporting ? 'Exporting…' : 'Export PDF'}
            </button>
          </div>
        </div>
      </header>

      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {([
            ['Target plan', targetPlanPercent != null ? `${targetPlanPercent}%` : '—', curveType === 'pdm_based' || hasRevisedSchedule ? 'Revised planned progress. STEWA Planned uses the same figure.' : 'Original baseline cumulative for this period. Accomplishment does not change it.', 'planned'],
            ['Target plan (PHP)', targetPlanPhp != null ? `P ${formatMoney(targetPlanPhp)}` : '—', 'Current cumulative target amount', 'reports'],
            ['Actual progress', actualPlanPercent != null ? `${actualPlanPercent}%` : '—', latestReportDate ? `Latest report ${latestReportDate}` : 'No approved report yet', 'actual'],
            ['Schedule variance', variance != null ? `${variance > 0 ? '+' : ''}${variance}%` : '—', variance == null ? 'Waiting for actual progress' : variance < 0 ? 'Behind target plan' : variance > 0 ? 'Ahead of target plan' : 'Matching target plan', 's-curve'],
          ] as [string, string | number, string, NavIconName][]).map(([label, value, caption, icon]) => (
            <div key={label} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">{label}</p>
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-light text-primary">
                  <NavIcon name={icon} className="h-5 w-5" />
                </span>
              </div>
              <p className={`mt-3 text-2xl font-semibold ${label === 'Schedule variance' && variance != null ? (variance < 0 ? 'text-red-600' : 'text-emerald-700') : 'text-text'}`}>{value}</p>
              <p className="mt-1 truncate text-xs text-text-muted" title={caption}>{caption}</p>
            </div>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {([
            ['Critical path', criticalPath.length, syncedFromPdm ? 'Synced from PDM schedule' : 'Not synced from PDM', 'approval'],
            ['Total contract amount', `P ${formatMoney(costSummary.totalContractAmount)}`, 'Full SWA contract amount', 'reports'],
            ['Mapped WT%', `${costSummary.totalWeightPct.toFixed(2)}%`, unmappedWeightPct > 0.05 ? `${unmappedWeightPct.toFixed(2)}% of contract weight is not assigned to a PDM activity.` : 'Cost weight currently assigned to PDM activities', 'projects'],
          ] as [string, string | number, string, NavIconName][]).map(([label, value, caption, icon]) => (
            <div key={label} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">{label}</p>
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-muted text-text-muted">
                  <NavIcon name={icon} className="h-5 w-5" />
                </span>
              </div>
              <p className="mt-3 text-xl font-semibold text-text">{value}</p>
              <p className="mt-1 truncate text-xs text-text-muted" title={caption}>{caption}</p>
            </div>
          ))}
        </div>
      </div>


      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="border-b border-border bg-surface-muted/40 px-4 pt-3">
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="S-Curve sections">
            {(
              [
                { id: 'curve' as const, label: 'Progress curve', count: points.length },
                { id: 'baseline' as const, label: 'Baseline', count: periods.length + comparisons.length },
                { id: 'cost' as const, label: 'Cost items', count: costSummary.items.length },
                { id: 'activities' as const, label: 'Activities', count: activities.length },
                { id: 'history' as const, label: 'History', count: versions.length },
              ] as const
            ).map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(tab.id)}
                  className={`-mb-px inline-flex items-center gap-2 rounded-t-xl px-4 py-2.5 text-sm font-semibold transition ${
                    active
                      ? 'border border-b-0 border-border bg-card text-primary'
                      : 'text-text-muted hover:bg-card/60 hover:text-text'
                  }`}
                >
                  {tab.label}
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                      active ? 'bg-primary text-white' : 'bg-surface-muted text-text-muted'
                    }`}
                  >
                    {loading ? '…' : tab.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="p-4 sm:p-5" role="tabpanel">
          {activeTab === 'curve' && (
            <div className="space-y-5">
                      <div>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h2 className="text-lg font-semibold text-text">Progress curve</h2>
                            <p className="mt-1 text-sm leading-relaxed text-text-muted">
                              {curveType === 'pdm_based'
                                ? 'Original ends at the planned finish. Target follows the revised schedule. Actual is reported accomplishment.'
                                : 'Cumulative progress against the approved baseline and the latest reports.'}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <label className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text">
                              <input
                                type="checkbox"
                                checked={showPercentLabels}
                                onChange={(event) => setShowPercentLabels(event.target.checked)}
                              />
                              Show percentage labels
                            </label>
                            {canEditCharts && (
                              <button
                                type="button"
                                disabled={generatingCurve}
                                onClick={() => {
                                  setGenerateMessage('');
                                  setGenerateOpen((open) => {
                                    const next = !open;
                                    if (next) {
                                      setSelectedSourceId((current) =>
                                        sourceReports.some((entry) => entry.id === current)
                                          ? current
                                          : sourceReports[0]?.id ?? '',
                                      );
                                    }
                                    return next;
                                  });
                                }}
                                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                              >
                                {generatingCurve ? 'Generating…' : 'Generate S-Curve from SWA/STEWA'}
                              </button>
                            )}
                          {versions.length > 0 && (
                            <div className="flex flex-wrap items-center gap-2">
                              <label htmlFor="scurve-version" className="text-xs font-medium text-text-muted">
                                Version history
                              </label>
                              <select
                                id="scurve-version"
                                value={viewingSnapshotId ?? ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setViewingSnapshotId(val === '' ? null : val);
                                }}
                                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
                              >
                                <option value="">Current (latest)</option>
                                {versions.map((v) => (
                                  <option key={v.id} value={v.id}>
                                    {formatSnapshotLabel(v)}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                          </div>
                        </div>
                        {generateOpen && canEditCharts && (
                          <div className="mt-3 rounded-xl border border-border bg-surface-muted/40 p-3">
                            <p className="text-sm font-medium text-text">Choose the SWA or STEWA reporting period</p>
                            <p className="mt-1 text-xs text-text-muted">
                              The S-Curve date comes from the selected report. Target Plan stays on the original baseline.
                            </p>
                            {sourceReports.length === 0 ? (
                              <p className="mt-2 text-xs text-red-600">
                                Save an approved SWA or STEWA for this project before generating an S-Curve.
                              </p>
                            ) : (
                              <div className="mt-2 space-y-1">
                                {sourceReports.map((entry) => (
                                  <label
                                    key={entry.id}
                                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-card"
                                  >
                                    <input
                                      type="radio"
                                      name="scurve-source-report"
                                      checked={selectedSourceId === entry.id}
                                      onChange={() => setSelectedSourceId(entry.id ?? '')}
                                    />
                                    <span className="font-medium">{sourceOptionLabel(entry)}</span>
                                    <span className="text-xs text-text-muted">{entry.percent}%</span>
                                  </label>
                                ))}
                                <button
                                  type="button"
                                  disabled={generatingCurve || !selectedSourceId}
                                  onClick={() => {
                                    setGeneratingCurve(true);
                                    setGenerateMessage('');
                                    void generateSwaStewaSCurve(projectId, selectedSourceId)
                                      .then((saved) => {
                                        setGenerateMessage(`Saved ${saved.label}.`);
                                        setGenerateOpen(false);
                                        setViewingSnapshotId(saved.id);
                                        setSettingsVersion((value) => value + 1);
                                      })
                                      .catch((err: unknown) => {
                                        setGenerateMessage(
                                          err instanceof Error ? err.message : 'Could not generate the S-Curve.',
                                        );
                                      })
                                      .finally(() => setGeneratingCurve(false));
                                  }}
                                  className="mt-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                                >
                                  {generatingCurve ? 'Generating…' : 'Generate this period'}
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                        {generateMessage && (
                          <p className={`mt-2 text-xs ${generateMessage.startsWith('Saved') ? 'text-text-muted' : 'text-red-600'}`}>
                            {generateMessage}
                          </p>
                        )}
                        {curveType === 'pdm_based' ? (
                          <p className="mt-2 text-xs text-text-muted">
                            Original uses the STEWA planned formula on the original schedule. Target uses the same formula on the revised schedule. Actual is the SWA accomplished weight. Slippage is Actual minus Target.
                          </p>
                        ) : hasRevisedSchedule ? (
                          <p className="mt-2 text-xs text-text-muted">
                            Revised S-Curve is the monitoring baseline. The SWA/STEWA S-Curve is actual progress.
                          </p>
                        ) : null}

                        {viewingSnapshotLabel && (
                          <p className="mt-2 text-center text-xs text-amber-700 sm:text-left">
                            Viewing archived snapshot: <strong>{viewingSnapshotLabel}</strong>
                          </p>
                        )}

                        {loading ? (
                          <div className="mt-6 h-80 animate-pulse rounded-xl bg-surface-muted" />
                        ) : points.length === 0 ? (
                          <div className="mt-6 rounded-xl border border-dashed border-border px-6 py-16 text-center">
                            <p className="font-semibold text-text">No S-curve points recorded yet</p>
                            <p className="mt-2 text-sm text-text-muted">The target curve comes from the original plan. Approved progress reports add the actual curve.</p>
                          </div>
                        ) : (
                          <div>
                            <div className="scurve-stage mt-4 overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-card to-surface-muted/50">
                              <div className="h-[22rem] w-full px-1 pt-3 sm:px-3">
                              {chartReady ? (
                              <ResponsiveContainer width="100%" height="100%">
                                <LineChart
                                  data={chartPoints}
                                  margin={{
                                    top: showPercentLabels ? 28 : 8,
                                    right: showPercentLabels ? 28 : 16,
                                    left: 0,
                                    bottom: 4,
                                  }}
                                >
                                  <CartesianGrid stroke="#e6ecf2" vertical={false} />
                                  <XAxis
                                    dataKey="t"
                                    type="number"
                                    scale="time"
                                    domain={['dataMin', 'dataMax']}
                                    tickFormatter={(value) => formatAxisDate(Number(value))}
                                    tick={{ fill: '#5a6b7d', fontSize: 11 }}
                                    angle={-32}
                                    textAnchor="end"
                                    height={42}
                                    minTickGap={72}
                                    axisLine={false}
                                    tickLine={false}
                                  />
                                  <YAxis
                                    domain={[0, 100]}
                                    ticks={[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]}
                                    interval={0}
                                    tick={{ fill: '#5a6b7d', fontSize: 11 }}
                                    tickFormatter={(v) => `${v}%`}
                                    width={40}
                                    axisLine={false}
                                    tickLine={false}
                                  />
                                  <Tooltip
                                    content={({ active, payload }) => {
                                      if (!active || !payload?.length) return null;
                                      const row = payload[0]?.payload as ChartPoint | undefined;
                                      const original = row?.originalPlan;
                                      const target = hasRevisedSchedule ? row?.currentPlan : row?.originalPlan;
                                      const actual = row?.actual;
                                      const slip =
                                        actual != null && target != null
                                          ? Math.round((actual - target) * 100) / 100
                                          : null;
                                      return (
                                        <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
                                          <p className="font-semibold text-text">{row?.date}</p>
                                          {row?.periodLabel && (
                                            <p className="text-text-muted">{row.periodLabel}</p>
                                          )}
                                          {(curveType === 'pdm_based' || hasRevisedSchedule) && original != null && (
                                            <p className="text-[#2563eb]">
                                              Original: {formatChartPercent(original)}
                                            </p>
                                          )}
                                          {target != null && (
                                            <p className={hasRevisedSchedule ? 'text-[#7c3aed]' : 'text-[#2563eb]'}>
                                              {hasRevisedSchedule ? 'Target' : 'Target Plan'}:{' '}
                                              {formatChartPercent(target)}
                                            </p>
                                          )}
                                          {row?.targetAccomplishmentPct != null && (
                                            <p className="text-text-muted">
                                              Target this period: {formatChartPercent(row.targetAccomplishmentPct)}
                                              {row.targetAccomplishmentPhp != null
                                                ? ` · P ${formatMoney(row.targetAccomplishmentPhp)}`
                                                : ''}
                                            </p>
                                          )}
                                          {actual != null && (
                                            <p className="text-[#f97316]">
                                              {curveType === 'pdm_based' ? 'Actual' : 'Actual Plan'}:{' '}
                                              {formatChartPercent(actual)}
                                            </p>
                                          )}
                                          {slip != null && (
                                            <p className="mt-1 text-text-muted">
                                              {slip < 0 ? 'Behind' : slip > 0 ? 'Ahead' : 'On Track'}
                                              {' · Slippage '}
                                              {slip > 0 ? '+' : ''}
                                              {slip.toFixed(2)}%
                                            </p>
                                          )}
                                          {row?.label && (
                                            <p className="mt-1 text-text-muted">{row.label}</p>
                                          )}
                                        </div>
                                      );
                                    }}
                                  />
                                  <PlanLine
                                    dataKey="originalPlan"
                                    name={curveType === 'pdm_based' ? 'Original' : hasRevisedSchedule ? 'Original S-Curve' : 'Target Plan %'}
                                    stroke="#2563eb"
                                    dotDates={originalDotDates}
                                    animate={chartReady}
                                  />
                                  {/* Target (currentPlan) intentionally rendered below after labels to ensure it appears above Original when overlapping */}
                                  {hasActualProgress && (
                                    <Line
                                      type="linear"
                                      dataKey="actual"
                                      name={curveType === 'pdm_based' ? 'Actual' : hasRevisedSchedule ? 'SWA/STEWA S-Curve' : 'Actual Plan %'}
                                      stroke="#f97316"
                                      strokeWidth={2.5}
                                      isAnimationActive={chartReady}
                                      animationDuration={1200}
                                      animationBegin={320}
                                      dot={false}
                                      connectNulls
                                    />
                                  )}
                                  {hasActualProgress &&
                                    scheduleStatus?.planned_pct != null &&
                                    scheduleStatus.actual_pct != null && (
                                      <ReferenceLine
                                        y={scheduleStatus.planned_pct}
                                        stroke={hasRevisedSchedule ? '#7c3aed' : '#2563eb'}
                                        strokeDasharray="2 6"
                                        strokeOpacity={0.35}
                                      />
                                    )}
                                  <OriginalPercentLabels
                                    points={chartPoints}
                                    showLabels={showPercentLabels}
                                    periodsCount={theoreticalTotalPeriods}
                                  />
                                  <ExtraPercentLabels
                                    points={chartPoints}
                                    show={showPercentLabels}
                                    datesBySeries={extraLabelDates}
                                  />
                                  {hasRevisedSchedule && (
                                    <Line
                                      type="monotone"
                                      dataKey="currentPlan"
                                      name={curveType === 'pdm_based' ? 'Target' : 'Revised S-Curve'}
                                      stroke="#7c3aed"
                                      strokeWidth={2}
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeDasharray="6 4"
                                      isAnimationActive={chartReady}
                                      animationDuration={1200}
                                      animationEasing="ease-out"
                                      animationBegin={160}
                                      dot={(props) => (
                                        <MarkerDot
                                          cx={props.cx}
                                          cy={props.cy}
                                          payload={props.payload as ChartPoint | undefined}
                                          dates={revisedDotDates}
                                          fill="#7c3aed"
                                        />
                                      )}
                                      activeDot={(props) => (
                                        <MarkerDot
                                          cx={props.cx}
                                          cy={props.cy}
                                          payload={props.payload as ChartPoint | undefined}
                                          dates={revisedDotDates}
                                          fill="#7c3aed"
                                          active
                                        />
                                      )}
                                      connectNulls
                                    />
                                  )}
                                  {/* Overlay actual markers to ensure exactly N visible orange dots when possible */}
                                  <ZIndexLayer zIndex={DefaultZIndexes.label}>
                                    <ActualOverlayMarkers
                                      chartPoints={chartPoints}
                                      dates={actualDotDates}
                                    />
                                  </ZIndexLayer>
                                </LineChart>
                              </ResponsiveContainer>
                              ) : (
                                <div className="flex h-full items-center justify-center text-sm text-text-muted">
                                  Loading chart…
                                </div>
                              )}
                              </div>
                              <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 border-t border-border/80 bg-card/80 px-4 py-3">
                                <LegendItem
                                  color="#f97316"
                                  label={
                                    curveType === 'pdm_based'
                                      ? 'Actual'
                                      : hasRevisedSchedule
                                        ? 'SWA/STEWA'
                                        : 'Actual'
                                  }
                                />
                                <LegendItem
                                  color="#2563eb"
                                  label={
                                    curveType === 'pdm_based' || hasRevisedSchedule
                                      ? 'Original'
                                      : 'Target plan'
                                  }
                                />
                                {hasRevisedSchedule && (
                                  <LegendItem
                                    color="#7c3aed"
                                    label={curveType === 'pdm_based' ? 'Target' : 'Revised'}
                                    dashed
                                  />
                                )}
                              </div>
                            </div>

                            <details className="mt-4 rounded-xl border border-border bg-surface-muted/30">
                              <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-text">
                                Point values table
                                <span className="ml-2 font-normal text-text-muted">({points.length} periods)</span>
                              </summary>
                              <div className="overflow-x-auto border-t border-border px-2 pb-3">
                              <table className="w-full border-collapse text-center text-xs">
                                <thead>
                                  <tr className="border-b-2 border-text bg-surface-muted">
                                    <th className="p-2 text-left font-bold">Curve</th>
                                    {points.map((p) => (
                                      <th key={p.pointDate ?? p.date} className="border-l border-border p-2 font-normal">
                                        {p.date}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr className="border-b border-border">
                                    <td className="p-2 text-left font-semibold text-[#2563eb]">{curveType === 'pdm_based' ? 'Original %' : hasRevisedSchedule ? 'Original S-Curve %' : 'Cumulative target %'}</td>
                                    {points.map((p) => (
                                      <td key={p.pointDate ?? p.date} className="border-l border-border p-2">
                                        {p.originalPlan != null ? `${p.originalPlan}%` : ''}
                                      </td>
                                    ))}
                                  </tr>
                                  {curveType !== 'pdm_based' && (
                                  <>
                                  <tr className="border-b border-border">
                                    <td className="p-2 text-left font-semibold text-text-muted">Target this period %</td>
                                    {points.map((p) => (
                                      <td key={p.pointDate ?? p.date} className="border-l border-border p-2">
                                        {p.targetAccomplishmentPct != null ? `${p.targetAccomplishmentPct.toFixed(2)}%` : ''}
                                      </td>
                                    ))}
                                  </tr>
                                  <tr className="border-b border-border">
                                    <td className="p-2 text-left font-semibold text-text-muted">Target this period (PHP)</td>
                                    {points.map((p) => (
                                      <td key={p.pointDate ?? p.date} className="border-l border-border p-2">
                                        {p.targetAccomplishmentPhp != null ? `P ${formatMoney(p.targetAccomplishmentPhp)}` : ''}
                                      </td>
                                    ))}
                                  </tr>
                                  </>
                                  )}
                                  {hasRevisedSchedule && (
                                    <tr className="border-b border-border">
                                      <td className="p-2 text-left font-semibold text-[#7c3aed]">{curveType === 'pdm_based' ? 'Target %' : 'Revised S-Curve %'}</td>
                                      {points.map((p) => (
                                        <td key={p.pointDate ?? p.date} className="border-l border-border p-2">
                                          {p.currentPlan != null ? `${p.currentPlan}%` : ''}
                                        </td>
                                      ))}
                                    </tr>
                                  )}
                                  {hasActualProgress && (
                                    <tr className="border-b border-border">
                                      <td className="p-2 text-left font-semibold text-[#f97316]">{curveType === 'pdm_based' ? 'Actual %' : hasRevisedSchedule ? 'SWA/STEWA %' : 'Actual %'}</td>
                                      {points.map((p) => (
                                        <td key={p.pointDate ?? p.date} className="border-l border-border p-2">
                                          {p.actual != null ? `${p.actual}%` : ''}
                                        </td>
                                      ))}
                                    </tr>
                                  )}
                                  {hasActualProgress && (
                                    <tr className="border-t border-border">
                                      <td className="p-2 text-left font-semibold text-text-muted">Gap (Actual - Target)</td>
                                      {points.map((p) => (
                                        <td key={p.pointDate ?? p.date} className="border-l border-border p-2">
                                          {(() => {
                                            const basis =
                                              curveType === 'pdm_based' || hasRevisedSchedule
                                                ? p.currentPlan
                                                : p.originalPlan;
                                            const slip =
                                              p.actual != null && basis != null
                                                ? Math.round((p.actual - basis) * 100) / 100
                                                : p.variance ?? null;
                                            if (slip == null) return '';
                                            return (
                                              <span className={slip < 0 ? 'text-red-700' : slip > 0 ? 'text-emerald-700' : ''}>
                                                {slip > 0 ? '+' : ''}
                                                {slip}%
                                              </span>
                                            );
                                          })()}
                                        </td>
                                      ))}
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                              </div>
                            </details>
                          </div>
                        )}

                        <p className="mt-4 text-xs text-text-muted">
                          {hasActualProgress
                            ? 'Compare Actual against the Target Plan to see on-schedule, ahead, or delayed progress. Slippage triggers revised schedule updates when the PDM is changed.'
                            : 'Target Plan is the baseline. The Actual curve appears once approved progress reports are recorded.'}
                          {syncedFromPdm && criticalPath.length > 0 && (
                            <> Critical path: <strong>{criticalPath.join(' → ')}</strong>.</>
                          )}
                        </p>
                      </div>

                      <ReportProgressFeed
                        reports={reportFeed}
                        latestPercent={latestReportPercent}
                        latestDate={latestReportDate}
                        emptyMessage="No approved SWA or STEWA reports yet — Target Plan appears after the first approved progress."
                      />
            </div>
          )}

          {activeTab === 'baseline' && (
            <div className="space-y-5">
              {periods.length === 0 && comparisons.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-6 py-14 text-center">
                  <p className="font-semibold text-text">No baseline periods yet</p>
                  <p className="mt-1 text-sm text-text-muted">
                    Sync a PDM schedule and cost weights to build the target baseline.
                  </p>
                </div>
              ) : (
                <>
                  {periods.length > 0 && (
                          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
                            <h2 className="text-lg font-semibold text-text">
                              {reportingInterval === '5_day'
                                ? '5-day target accomplishment baseline'
                                : reportingInterval === '10_day'
                                  ? '10-day target accomplishment baseline'
                                  : reportingInterval === '15_day'
                                    ? '15-day target accomplishment baseline'
                                    : reportingInterval === '20_day'
                                      ? '20-day target accomplishment baseline'
                                      : 'Monthly target accomplishment baseline'}
                            </h2>
                            <p className="mt-1 text-sm text-text-muted">
                              {reportingInterval === '30_day'
                                ? 'Each month uses a 30-day baseline. Target this period can be edited. Cumulative target stays on the original S-curve.'
                                : `Each period uses a ${
                                    reportingInterval === '5_day'
                                      ? '5'
                                      : reportingInterval === '10_day'
                                        ? '10'
                                        : reportingInterval === '15_day'
                                          ? '15'
                                          : '20'
                                  }-day baseline. Target this period can be edited. Cumulative target stays on the original S-curve.`}
                            </p>
                            {periodSaveError && (
                              <p className="mt-2 text-sm text-red-600">{periodSaveError}</p>
                            )}
                            <div className="mt-4 overflow-x-auto">
                              <table className="w-full text-left text-sm">
                                <thead>
                                  <tr className="border-b border-border text-xs uppercase text-text-muted">
                                    <th className="py-2 pr-3">Period</th>
                                    <th className="py-2 pr-3">Date range</th>
                                    <th className="py-2 pr-3">Target %</th>
                                    <th className="py-2 pr-3">Target (PHP)</th>
                                    <th className="py-2 pr-3">Cumulative %</th>
                                    <th className="py-2">Cumulative (PHP)</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {periodPaging.pageItems.map((period) => (
                                    <tr key={period.periodIndex} className="border-b border-border/50">
                                      <td className="py-2 pr-3 font-medium">{period.label}</td>
                                      <td className="py-2 pr-3">
                                        {period.startDate} to {period.endDate}
                                      </td>
                                      <td className="py-2 pr-3 font-semibold text-[#2563eb]">
                                        {canEditPeriods && !viewingSnapshotId ? (
                                          <input
                                            type="number"
                                            min={0}
                                            step="0.01"
                                            aria-label={`${period.label} target percent`}
                                            defaultValue={period.targetAccomplishmentPct.toFixed(2)}
                                            key={`${period.periodIndex}-${period.targetAccomplishmentPct}`}
                                            disabled={settingsSaving}
                                            onBlur={(e) => {
                              const next = Number(e.currentTarget.value);
                              if (!Number.isFinite(next)) return;
                              if (Math.abs(next - period.targetAccomplishmentPct) < 0.001) return;
                              void persistPeriodTarget(period.periodIndex, e.currentTarget.value);
                            }}
                                            className="w-20 rounded-md border border-border bg-surface px-2 py-1 text-xs font-semibold text-[#2563eb] outline-none focus:border-primary"
                                          />
                                        ) : (
                                          `${period.targetAccomplishmentPct.toFixed(2)}%`
                                        )}
                                      </td>
                                      <td className="py-2 pr-3">P {formatMoney(period.targetAccomplishmentPhp)}</td>
                                      <td className="py-2 pr-3 font-semibold text-primary">
                                        {period.cumulativePct.toFixed(2)}%
                                      </td>
                                      <td className="py-2">P {formatMoney(period.cumulativePhp)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                                  <Pagination
                              page={periodPaging.page}
                              totalPages={periodPaging.totalPages}
                              total={periodPaging.total}
                              from={periodPaging.from}
                              to={periodPaging.to}
                              pageSize={periodPaging.pageSize}
                              onPageChange={periodPaging.setPage}
                            />
                          </div>
                  )}
                  {comparisons.length > 0 && (
                          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
                            <h2 className="text-lg font-semibold text-text">Target plan vs. actual</h2>
                            <p className="mt-1 text-sm text-text-muted">
                              At each reporting date, compare what the baseline schedule expected versus what was
                              actually accomplished.
                            </p>
                            <div className="mt-4 overflow-x-auto">
                              <table className="w-full text-left text-sm">
                                <thead>
                                  <tr className="border-b border-border text-xs uppercase text-text-muted">
                                    <th className="py-2 pr-3">Date</th>
                                    <th className="py-2 pr-3 text-[#2563eb]">Target Plan %</th>
                                    <th className="py-2 pr-3">Target Plan (PHP)</th>
                                    <th className="py-2 pr-3 text-[#f97316]">Actual %</th>
                                    <th className="py-2 pr-3">Difference</th>
                                    <th className="py-2">Status</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {comparisonPaging.pageItems.map((row) => (
                                    <tr key={row.date} className="border-b border-border/50">
                                      <td className="py-2 pr-3 font-medium">{row.date_label}</td>
                                      <td className="py-2 pr-3 font-semibold text-[#2563eb]">{row.target_pct}%</td>
                                      <td className="py-2 pr-3">P {formatMoney(row.target_php)}</td>
                                      <td className="py-2 pr-3 font-semibold text-[#f97316]">{row.actual_pct}%</td>
                                      <td className="py-2 pr-3">
                                        {row.variance_pct > 0 ? '+' : ''}
                                        {row.variance_pct}%
                                      </td>
                                      <td
                                        className={`py-2 capitalize ${
                                          row.status === 'behind'
                                            ? 'text-red-700'
                                            : row.status === 'ahead'
                                              ? 'text-emerald-700'
                                              : 'text-text-muted'
                                        }`}
                                      >
                                        {row.status_label}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                                  <Pagination
                              page={comparisonPaging.page}
                              totalPages={comparisonPaging.totalPages}
                              total={comparisonPaging.total}
                              from={comparisonPaging.from}
                              to={comparisonPaging.to}
                              pageSize={comparisonPaging.pageSize}
                              onPageChange={comparisonPaging.setPage}
                            />
                          </div>
                  )}
                </>
              )}
            </div>
          )}

          {activeTab === 'cost' && (
            <div>
                      <div>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h3 className="font-semibold text-text">PDM-based target S-Curve items</h3>
                          <p className="mt-1 text-sm text-text-muted">
                            Item No. and Description start from the PDM and can be corrected here. Those edits stay on this S-Curve. Qty and Unit Cost calculate Amount and WT%.
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs uppercase tracking-wide text-text-muted">Total contract amount</p>
                          <p className="text-lg font-semibold text-text">P {formatMoney(costSummary.totalContractAmount)}</p>
                          <p className="text-xs text-text-muted">Mapped WT% {costSummary.totalWeightPct.toFixed(2)}%</p>
                        </div>
                      </div>

                      {costMessage && (
                        <p className={`mt-3 text-xs ${costMessage.includes('Could not') ? 'text-red-600' : 'text-text-muted'}`}>
                          {costMessage}
                        </p>
                      )}
                      {costSaving && <p className="mt-2 text-xs text-text-muted">Saving S-Curve cost items…</p>}
                      {viewingSnapshotId && (
                        <p className="mt-2 text-xs text-amber-700">
                          Cost items are read-only while viewing an archived snapshot.
                        </p>
                      )}

                      <div className="mt-4 overflow-x-auto">
                        <table className="w-full min-w-[860px] text-left text-sm">
                          <thead>
                            <tr className="border-b border-border text-xs uppercase text-text-muted">
                              <th className="py-2 pr-3">Item No.</th>
                              <th className="py-2 pr-3">Description</th>
                              <th className="py-2 pr-3">Qty</th>
                              <th className="py-2 pr-3">Unit Cost (PHP)</th>
                              <th className="py-2 pr-3">Amount (PHP)</th>
                              <th className="py-2">WT%</th>
                            </tr>
                          </thead>
                          <tbody>
                            {costSummary.items.length === 0 ? (
                              <tr>
                                <td colSpan={6} className="py-6 text-center text-text-muted">
                                  Add activities in the PDM schedule to populate the S-Curve item table.
                                </td>
                              </tr>
                            ) : (
                              costPaging.pageItems.map((item) => (
                                <tr key={item.activityId} className="border-b border-border/50">
                                  <td className="py-2 pr-3 font-medium">
                                    {canEditCostItems && !viewingSnapshotId ? (
                                      <input
                                        type="text"
                                        value={item.itemNo}
                                        onChange={(e) =>
                                          updateCostItem(item.activityId, { itemNo: e.target.value })
                                        }
                                        className="w-28 rounded border border-border px-2 py-1"
                                      />
                                    ) : (
                                      item.itemNo || '—'
                                    )}
                                  </td>
                                  <td className="py-2 pr-3">
                                    {canEditCostItems && !viewingSnapshotId ? (
                                      <input
                                        type="text"
                                        value={item.description}
                                        onChange={(e) =>
                                          updateCostItem(item.activityId, { description: e.target.value })
                                        }
                                        className="w-full min-w-[12rem] rounded border border-border px-2 py-1"
                                      />
                                    ) : (
                                      item.description || '—'
                                    )}
                                  </td>
                                  <td className="py-2 pr-3">
                                    {canEditCostItems && !viewingSnapshotId ? (
                                      <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={item.quantity || ''}
                                        onChange={(e) =>
                                          updateCostItem(item.activityId, {
                                            quantity: parseFloat(e.target.value) || 0,
                                          })
                                        }
                                        className="w-28 rounded border border-border px-2 py-1 text-right"
                                      />
                                    ) : (
                                      item.quantity
                                    )}
                                  </td>
                                  <td className="py-2 pr-3">
                                    {canEditCostItems && !viewingSnapshotId ? (
                                      <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={item.unitCost || ''}
                                        onChange={(e) =>
                                          updateCostItem(item.activityId, {
                                            unitCost: parseFloat(e.target.value) || 0,
                                          })
                                        }
                                        className="w-32 rounded border border-border px-2 py-1 text-right"
                                      />
                                    ) : (
                                      `P ${formatMoney(item.unitCost)}`
                                    )}
                                  </td>
                                  <td className="py-2 pr-3 font-medium">P {formatMoney(item.amount)}</td>
                                  <td className="py-2">{item.weightPct.toFixed(2)}%</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                          {costSummary.items.length > 0 && (
                            <tfoot>
                              <tr className="bg-surface-muted font-semibold text-text">
                                <td colSpan={4} className="py-2 pr-3 text-right">
                                  Total Contract Amount
                                </td>
                                <td className="py-2 pr-3">P {formatMoney(costSummary.totalContractAmount)}</td>
                                <td className="py-2">{costSummary.totalWeightPct.toFixed(2)}%</td>
                              </tr>
                            </tfoot>
                          )}
                        </table>
                      </div>
                            <Pagination
                        page={costPaging.page}
                        totalPages={costPaging.totalPages}
                        total={costPaging.total}
                        from={costPaging.from}
                        to={costPaging.to}
                        pageSize={costPaging.pageSize}
                        onPageChange={costPaging.setPage}
                      />
                    </div>
            </div>
          )}

          {activeTab === 'activities' && (
            <div>
              {activities.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-6 py-14 text-center">
                  <p className="font-semibold text-text">No PDM activities on this S-curve</p>
                  <p className="mt-1 text-sm text-text-muted">
                    Build the schedule in PDM first, then return here to review planned targets.
                  </p>
                </div>
              ) : (
                      <div>
                        <h3 className="font-semibold text-text">PDM activities on this S-curve</h3>
                        <p className="mt-1 text-sm text-text-muted">
                          Each row is one PDM activity. Planned % is the cumulative target at the end of the
                          selected reporting period where that activity is scheduled to finish. PDM start, end,
                          and duration stay unchanged.
                        </p>
                        <div className="mt-4 overflow-x-auto">
                          <table className="w-full text-left text-sm">
                            <thead>
                              <tr className="border-b border-border text-xs uppercase text-text-muted">
                                <th className="py-2 pr-3">No.</th>
                                <th className="py-2 pr-3">Activity</th>
                                <th className="py-2 pr-3">Duration</th>
                                <th className="py-2 pr-3">ES</th>
                                <th className="py-2 pr-3">EF</th>
                                <th className="py-2 pr-3">Finish date</th>
                                <th className="py-2 pr-3">Cumulative target %</th>
                                <th className="py-2">Critical</th>
                              </tr>
                            </thead>
                            <tbody>
                              {activityPaging.pageItems.map((a, index) => (
                                <tr key={a.id || `${a.number}-${a.name}-${index}`} className="border-b border-border/50">
                                  <td className="py-2 pr-3 font-medium">{a.number}</td>
                                  <td className="py-2 pr-3">{a.name}</td>
                                  <td className="py-2 pr-3">{a.duration}d</td>
                                  <td className="py-2 pr-3">{a.es}</td>
                                  <td className="py-2 pr-3">{a.ef}</td>
                                  <td className="py-2 pr-3">{a.finish_date}</td>
                                  <td className="py-2 pr-3 font-medium text-primary">{a.planned_pct}%</td>
                                  <td className="py-2">{a.is_critical ? 'Yes' : '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                              <Pagination
                          page={activityPaging.page}
                          totalPages={activityPaging.totalPages}
                          total={activityPaging.total}
                          from={activityPaging.from}
                          to={activityPaging.to}
                          pageSize={activityPaging.pageSize}
                          onPageChange={activityPaging.setPage}
                        />
                      </div>
              )}
            </div>
          )}

          {activeTab === 'history' && (
            <div>
              {versions.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-6 py-14 text-center">
                  <p className="font-semibold text-text">No snapshots yet</p>
                  <p className="mt-1 text-sm text-text-muted">
                    Snapshots are saved when the schedule is revised or when approved progress reports are finalized.
                  </p>
                </div>
              ) : (
                      <div>
                        <h3 className="font-semibold text-text">S-Curve version history</h3>
                        <p className="mt-1 text-sm text-text-muted">
                          Each SWA or STEWA reporting period keeps one S-Curve. Generating that period again updates
                          the same version.
                        </p>
                        <div className="mt-4 overflow-x-auto">
                          <table className="w-full text-left text-sm">
                            <thead>
                              <tr className="border-b border-border text-xs uppercase text-text-muted">
                                <th className="py-2 pr-3">Reporting period</th>
                                <th className="py-2 pr-3">Version</th>
                                <th className="py-2 pr-3">Status</th>
                                <th className="py-2 pr-3">Target %</th>
                                <th className="py-2 pr-3">Actual %</th>
                                <th className="py-2">Slippage</th>
                              </tr>
                            </thead>
                            <tbody>
                              {versions.map((v) => (
                                <tr key={v.id} className="border-b border-border/50">
                                  <td className="py-2 pr-3">
                                    {v.as_of_label ||
                                      v.as_of_date ||
                                      (v.captured_at ? new Date(v.captured_at).toLocaleString() : '—')}
                                  </td>
                                  <td className="py-2 pr-3">{formatSnapshotLabel(v)}</td>
                                  <td className="py-2 pr-3 capitalize">
                                    {(v.schedule_status ?? '—').replace(/_/g, ' ')}
                                  </td>
                                  <td className="py-2 pr-3">{v.planned_pct != null ? `${v.planned_pct}%` : '—'}</td>
                                  <td className="py-2 pr-3">{v.actual_pct != null ? `${v.actual_pct}%` : '—'}</td>
                                  <td className="py-2">
                                    {v.slippage_pct != null ? `${v.slippage_pct}%` : '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
              )}
            </div>
          )}
        </div>
      </section>

      </div>

      <PreviewModal
        title="S-Curve preview"
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        wide
        downloading={exporting}
        onDownload={() => {
          setExporting(true);
          try {
            exportSCurvePdf(sCurvePdfInput());
          } finally {
            setExporting(false);
          }
        }}
      >
        <div id="s-curve-preview-print" className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-text">Project {projectId}</p>
            <p className="text-xs text-text-muted">
              Target {targetPlanPercent != null ? `${targetPlanPercent}%` : '—'}
              {' · '}
              Actual {actualPlanPercent != null ? `${actualPlanPercent}%` : '—'}
              {scheduleStatus ? ` · ${scheduleStatus.label}` : ''}
            </p>
          </div>
          {curveType !== 'pdm_based' && periods.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border text-[10px] uppercase text-text-muted">
                    <th className="py-1 pr-2">Period</th>
                    <th className="py-1 pr-2">Date range</th>
                    <th className="py-1 pr-2">Target %</th>
                    <th className="py-1 pr-2">Cumulative target %</th>
                  </tr>
                </thead>
                <tbody>
                  {periods.map((period) => (
                    <tr key={period.periodIndex} className="border-b border-border/50">
                      <td className="py-1 pr-2">{period.label}</td>
                      <td className="py-1 pr-2">
                        {period.startDate} to {period.endDate}
                      </td>
                      <td className="py-1 pr-2">{period.targetAccomplishmentPct.toFixed(2)}%</td>
                      <td className="py-1 pr-2">{period.cumulativePct.toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="h-96 w-full">
            {chartReady ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartPoints}
                  margin={{
                    top: showPercentLabels ? 28 : 8,
                    right: showPercentLabels ? 28 : 16,
                    left: 0,
                    bottom: 4,
                  }}
                >
                  <CartesianGrid stroke="#e6ecf2" vertical={false} />
                  <XAxis
                    dataKey="t"
                    type="number"
                    scale="time"
                    domain={['dataMin', 'dataMax']}
                    tickFormatter={(value) => formatAxisDate(Number(value))}
                    tick={{ fill: '#5a6b7d', fontSize: 11 }}
                    angle={-32}
                    textAnchor="end"
                    height={42}
                    minTickGap={72}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    ticks={[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]}
                    interval={0}
                    tick={{ fill: '#5a6b7d', fontSize: 11 }}
                    tickFormatter={(v) => `${v}%`}
                    width={40}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip />
                  <PlanLine
                    dataKey="originalPlan"
                    name={curveType === 'pdm_based' ? 'Original' : hasRevisedSchedule ? 'Original S-Curve' : 'Target Plan'}
                    stroke="#2563eb"
                    dotDates={originalDotDates}
                  />
                  {/* Target (currentPlan) intentionally rendered later after labels to ensure visibility above Original when overlapping */}
                  <PlanLine
                    dataKey="actual"
                    name={curveType === 'pdm_based' ? 'Actual' : hasRevisedSchedule ? 'SWA/STEWA S-Curve' : 'Actual Plan'}
                    stroke="#f97316"
                    strokeWidth={2.5}
                    dotDates={actualDotDates}
                  />
                  <OriginalPercentLabels
                    points={chartPoints}
                    showLabels={showPercentLabels}
                    periodsCount={theoreticalTotalPeriods}
                  />
                  <ExtraPercentLabels
                    points={chartPoints}
                    show={showPercentLabels}
                    datesBySeries={extraLabelDates}
                  />
                  {hasRevisedSchedule && (
                    <Line
                      type="monotone"
                      dataKey="currentPlan"
                      name={curveType === 'pdm_based' ? 'Target' : 'Revised S-Curve'}
                      stroke="#7c3aed"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray="6 4"
                      isAnimationActive={chartReady}
                      animationDuration={1200}
                      animationEasing="ease-out"
                      animationBegin={160}
                      dot={(props) => (
                        <MarkerDot
                          cx={props.cx}
                          cy={props.cy}
                          payload={props.payload as ChartPoint | undefined}
                          dates={revisedDotDates}
                          fill="#7c3aed"
                        />
                      )}
                      activeDot={(props) => (
                        <MarkerDot
                          cx={props.cx}
                          cy={props.cy}
                          payload={props.payload as ChartPoint | undefined}
                          dates={revisedDotDates}
                          fill="#7c3aed"
                          active
                        />
                      )}
                      connectNulls
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-text-muted">Loading chart…</p>
            )}
          </div>
        </div>
      </PreviewModal>
    </main>
  );
}
