import { collection, getDocs, query, where } from 'firebase/firestore';
import type { ReportProgressEntry } from '../../components/ReportProgressFeed';
import {
  calculatePlannedPercentage,
  formatExcelDate,
  formatSwaAsOfLabel,
} from '../stewaCalculations';
import { displayReportNumber } from '../reportNumber';
import { computeWorkItems, type WorkItem } from '../workItems';
import { COLLECTIONS } from './collections';
import { db } from './config';
import { asId } from './ids';

function reportingPeriod(
  reportType: string,
  reportData: Record<string, unknown>,
  fallbackDate: string,
): { date: string; asOfLabel: string } {
  const reportDate = String(reportData.report_date ?? reportData.period_end ?? fallbackDate).slice(0, 10);
  const rangeOn = String(reportData.as_of_range ?? '') === '1';
  const endRaw = String(reportData.as_of_end ?? '').trim();
  const date = (reportType === 'SWA' && rangeOn && endRaw ? endRaw : reportDate).slice(0, 10);
  const asOfLabel =
    reportType === 'SWA'
      ? formatSwaAsOfLabel(reportData) || (date ? formatExcelDate(date) : '')
      : date
        ? formatExcelDate(date)
        : '';
  return { date, asOfLabel };
}

function percentFromReportData(
  reportData: Record<string, unknown>,
  lineItems: unknown,
  reportType: string,
): number | null {
  if (reportType === 'SWA' && Array.isArray(lineItems) && lineItems.length > 0) {
    try {
      const { totals } = computeWorkItems(lineItems as WorkItem[]);
      return Math.round(totals.totalToDateWeightPct * 1000) / 1000;
    } catch {
      /* fall through to the stored percent */
    }
  }

  const pctRaw =
    reportData.percent_actual ??
    reportData.percent_complete ??
    reportData.accomplishment ??
    null;
  if (pctRaw != null && !Number.isNaN(Number(pctRaw))) {
    return Math.round(Number(pctRaw) * 1000) / 1000;
  }
  return null;
}

function mapProgressDocs(
  docs: { id: string; data: () => Record<string, unknown> }[],
): ReportProgressEntry[] {
  const entries: ReportProgressEntry[] = [];

  for (const d of docs) {
    const data = d.data();
    const status = String(data.status ?? '');
    if (!['approved', 'generated'].includes(status)) continue;

    const reportType = String(data.reportType ?? '');
    if (!['SWA', 'STEWA', 'IAR'].includes(reportType)) continue;

    const reportData = (data.reportData as Record<string, unknown>) ?? {};
    const pct = percentFromReportData(reportData, data.lineItems, reportType);
    if (pct == null) continue;

    const { date, asOfLabel } = reportingPeriod(
      reportType,
      reportData,
      String(data.generatedAt ?? data.updatedAt ?? ''),
    );
    if (!date) continue;

    const reportNumber = displayReportNumber({
      report_type: reportType,
      report_number: String(data.reportNumber ?? d.id),
      report_data: reportData,
    });
    const planDuration = Number(reportData.contract_duration);
    const planSuspension = Number(reportData.approved_time_suspension ?? 0);
    const ntp = String(reportData.notice_to_proceed ?? '').trim();
    const asOfStartRaw = String(reportData.as_of_start ?? '').trim().slice(0, 10);
    let stewaPlannedPercent: number | undefined;
    if (reportType === 'STEWA') {
      const fromReport = Number(
        reportData.percent_planned ?? reportData.planned ?? reportData.rev_target ?? reportData.orig_target,
      );
      if (Number.isFinite(fromReport)) {
        stewaPlannedPercent = Math.round(fromReport * 1000) / 1000;
      } else if (ntp && Number.isFinite(planDuration) && planDuration > 0) {
        const calculated = calculatePlannedPercentage({
          noticeToProceed: ntp,
          contractDurationDays: planDuration,
          asOf: date,
          suspensionDays: Number.isFinite(planSuspension) ? planSuspension : 0,
        });
        if (calculated != null) stewaPlannedPercent = calculated;
      }
    }
    entries.push({
      id: d.id,
      reportNumber,
      reportType,
      date,
      asOfStart:
        reportType === 'SWA' && /^\d{4}-\d{2}-\d{2}$/.test(asOfStartRaw) ? asOfStartRaw : undefined,
      asOfLabel,
      percent: pct,
      label: `${reportType} ${reportNumber}`,
      status,
      stewaPlannedPercent,
      planNoticeToProceed: reportType === 'STEWA' && ntp ? ntp : undefined,
      planContractDuration:
        reportType === 'STEWA' && Number.isFinite(planDuration) && planDuration > 0
          ? planDuration
          : undefined,
      planSuspensionDays:
        reportType === 'STEWA' && Number.isFinite(planSuspension) ? planSuspension : undefined,
    });
  }

  entries.sort((a, b) => {
    const d = b.date.localeCompare(a.date);
    return d !== 0 ? d : b.reportNumber.localeCompare(a.reportNumber);
  });
  return entries;
}

/** Approved/generated SWA, STEWA, and IAR progress for a project (newest first). */
export async function listApprovedProgressForProject(
  projectId: string | number,
): Promise<ReportProgressEntry[]> {
  const id = asId(projectId);

  // Prefer status-constrained query so rules can authorize public finalized reads.
  try {
    const snap = await getDocs(
      query(
        collection(db, COLLECTIONS.reports),
        where('projectId', '==', id),
        where('status', 'in', ['approved', 'generated']),
      ),
    );
    return mapProgressDocs(snap.docs);
  } catch {
    /* fall through */
  }

  // Staff with project access can list all project reports, then filter client-side.
  try {
    const snap = await getDocs(
      query(collection(db, COLLECTIONS.reports), where('projectId', '==', id)),
    );
    return mapProgressDocs(snap.docs);
  } catch {
    return [];
  }
}
