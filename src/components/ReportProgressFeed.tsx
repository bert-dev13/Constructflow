'use client';

export interface ReportProgressEntry {
  id?: string;
  reportNumber: string;
  reportType: string;
  date: string;
  /** SWA as-of range start (yyyy-mm-dd), when the report covers a date range. */
  asOfStart?: string;
  /** Printed reporting period, such as "July 6–10, 2026" or "July 20, 2026". */
  asOfLabel?: string;
  percent: number;
  label: string;
  status: string;
  /** STEWA printed / calculated planned % (Target), when available. */
  stewaPlannedPercent?: number;
  /** STEWA formula inputs. The planned percent is recalculated from these, not copied from the report. */
  planNoticeToProceed?: string;
  planContractDuration?: number;
  planSuspensionDays?: number;
}

interface ReportProgressFeedProps {
  reports: ReportProgressEntry[];
  latestPercent?: number | null;
  latestDate?: string | null;
  emptyMessage?: string;
  /** Omit outer card chrome when embedded in another panel. */
  bare?: boolean;
}

const TYPE_COLORS: Record<string, string> = {
  SWA: 'bg-violet-100 text-violet-800',
  STEWA: 'bg-amber-100 text-amber-900',
  IAR: 'bg-teal-100 text-teal-900',
};

export function ReportProgressFeed({
  reports,
  latestPercent,
  latestDate,
  emptyMessage = 'No SWA, STEWA, or IAR reports with progress data yet.',
  bare = false,
}: ReportProgressFeedProps) {
  return (
    <div className={bare ? '' : 'rounded-2xl border border-border bg-card p-5 shadow-sm'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-text">Progress from reports</h3>
          <p className="mt-1 text-sm text-text-muted">
            Actual progress comes from approved SWA, STEWA, and IAR reports.
          </p>
        </div>
        {latestPercent != null && (
          <div className="rounded-xl bg-orange-50 px-4 py-2 text-right">
            <p className="text-[10px] font-bold uppercase tracking-wide text-orange-700">Latest actual</p>
            <p className="text-xl font-bold text-orange-600">{latestPercent}%</p>
            {latestDate && <p className="text-xs text-text-muted">as of {latestDate}</p>}
          </div>
        )}
      </div>

      {reports.length === 0 ? (
        <p className="mt-4 text-sm text-text-muted">{emptyMessage}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase text-text-muted">
                <th className="py-2 pr-3">Report</th>
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">Actual %</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={`${r.reportNumber}-${r.date}`} className="border-b border-border/50">
                  <td className="py-2 pr-3 font-medium">{r.reportNumber}</td>
                  <td className="py-2 pr-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${TYPE_COLORS[r.reportType] ?? 'bg-surface-muted text-text'}`}
                    >
                      {r.reportType}
                    </span>
                  </td>
                  <td className="py-2 pr-3">{r.date}</td>
                  <td className="py-2 pr-3 font-semibold text-orange-600">{r.percent}%</td>
                  <td className="py-2 capitalize text-text-muted">{r.status.replace(/_/g, ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
