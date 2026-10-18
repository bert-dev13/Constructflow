import type { ReportProgressEntry } from '../components/ReportProgressFeed';
import type { SCurvePoint } from '../types';
import type { SCurveCostItem } from './sCurveItems';
export type { SCurveCostItem } from './sCurveItems';
export type { SCurvePeriodEdit, SCurvePeriodRow, SCurveReportingInterval } from './sCurvePeriods';
import {
  generateSwaStewaSCurveFs,
  getSCurveFs,
  saveSCurveCostItemsFs,
  saveSCurvePeriodsFs,
  saveSCurveSettingsFs,
} from './firebase/sCurves';

export function generateSwaStewaSCurve(projectId: string | number, reportId: string) {
  return generateSwaStewaSCurveFs(projectId, reportId);
}

export interface SCurveActivity {
  id: string;
  number: string;
  name: string;
  duration: number;
  es: number;
  ef: number;
  finish_date: string;
  planned_pct: number;
  is_critical: boolean;
}

export type ScheduleStatusCode = 'target_only' | 'on_schedule' | 'ahead' | 'behind' | 'unknown';

export interface ScheduleStatus {
  status: ScheduleStatusCode;
  slippage_pct: number | null;
  planned_pct: number | null;
  actual_pct: number | null;
  label: string;
}

export interface SCurveSnapshotSummary {
  id: string;
  captured_at: string;
  trigger_type: string;
  trigger_label: string | null;
  as_of_date?: string;
  as_of_label?: string | null;
  source_report_id?: string | null;
  source_report_type?: string | null;
  revision?: number | null;
  schedule_status: string | null;
  slippage_pct: number | null;
  planned_pct: number | null;
  actual_pct: number | null;
}

export interface SCurveComparison {
  date: string;
  date_label: string;
  target_pct: number;
  target_php: number;
  actual_pct: number;
  variance_pct: number;
  status: 'target_only' | 'on_schedule' | 'ahead' | 'behind';
  status_label: string;
}

export type SCurveType = 'pdm_based' | 'ideal_theoretical';

export function getSCurve(
  projectId: string | number = '1',
  snapshotId?: string | number | null,
  reportingInterval?: import('./sCurvePeriods').SCurveReportingInterval,
  curveType?: SCurveType,
) {
  return getSCurveFs(projectId, snapshotId, reportingInterval, curveType ? { curveType } : undefined) as Promise<{
    project_id: string;
    project_duration: number;
    project_start_date: string;
    project_end_date: string;
    critical_path: string[];
    points: SCurvePoint[];
    activities: SCurveActivity[];
    cost_items: SCurveCostItem[];
    periods: import('./sCurvePeriods').SCurvePeriodRow[];
    period_edits: Record<string, import('./sCurvePeriods').SCurvePeriodEdit>;
    total_contract_amount: number;
    total_weight_pct: number;
    weight_note: string;
    pay_item_mappings: import('./sCurveCostWeights').SCurvePayItemMappingLine[];
    synced_from_pdm: boolean;
    has_actual_progress: boolean;
    has_revised_schedule: boolean;
    schedule_status: ScheduleStatus;
    comparisons: SCurveComparison[];
    report_feed: ReportProgressEntry[];
    latest_report_percent: number | null;
    latest_report_date: string | null;
    reporting_interval: import('./sCurvePeriods').SCurveReportingInterval;
    curve_type: SCurveType;
    theoretical_total_periods: number;
    theoretical_duration_days: number;
    target_plan_percent: number | null;
    target_plan_php: number | null;
    actual_plan_percent: number | null;
    versions: SCurveSnapshotSummary[];
    viewing_snapshot_id: string | null;
    viewing_snapshot_label: string | null;
    viewing_snapshot_at: string | null;
  }>;
}

export function saveSCurvePeriods(payload: {
  project_id: string | number;
  theoretical_total_periods?: number;
  period_edits?: Record<string, import('./sCurvePeriods').SCurvePeriodEdit>;
}) {
  return saveSCurvePeriodsFs(payload);
}

export function saveSCurveSettings(payload: {
  project_id: string | number;
  curve_type: SCurveType;
  reporting_interval: import('./sCurvePeriods').SCurveReportingInterval;
  theoretical_total_periods?: number;
}) {
  return saveSCurveSettingsFs(payload) as Promise<{
    curve_type: SCurveType;
    reporting_interval: import('./sCurvePeriods').SCurveReportingInterval;
    theoretical_total_periods: number;
    theoretical_duration_days: number;
  }>;
}

export function saveSCurveCostItems(payload: {
  project_id: string | number;
  items: Array<{
    activityId: string;
    itemNo?: string;
    description?: string;
    quantity: number;
    unitCost: number;
  }>;
}) {
  return saveSCurveCostItemsFs(payload) as Promise<{
    cost_items: SCurveCostItem[];
    total_contract_amount: number;
    total_weight_pct: number;
  }>;
}
