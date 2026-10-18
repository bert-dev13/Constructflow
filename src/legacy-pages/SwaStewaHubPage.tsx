'use client';

import { useEffect, useState } from 'react';
import { Link } from '../lib/nextRouter';
import { useAuth } from '../context/AuthContext';
import { listReports, type SwaStewaReport } from '../lib/swaStewaApi';
import { canUserCreateReportType, reportIsViewOnly } from '../lib/reportPermissions';
import { ButtonLink } from '../components/ui/Button';
import { PageHeader } from '../components/ui/PageHeader';
import { Pagination } from '../components/ui/Pagination';
import { StatusBadge } from '../components/ui/StatusBadge';
import { NavIcon, type NavIconName } from '../components/NavIcon';
import { usePagination } from '../hooks/usePagination';
import { displayReportNumber } from '../lib/reportNumber';
import { formatReportDisplayDate } from '../lib/stewaCalculations';

function projectTitleOf(r: SwaStewaReport): string {
  return (
    (r.report_data?.project_title as string) ||
    (r.report_data?.project_name as string) ||
    r.project_name ||
    `Project #${r.project_id}`
  );
}

function reportDateOf(r: SwaStewaReport): Date {
  const data = r.report_data ?? {};
  const raw =
    (data.report_date as string) ||
    (data.as_of_end as string) ||
    (data.as_of_start as string) ||
    (data.period_end as string) ||
    r.created_at;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date(r.created_at) : d;
}

export function SwaStewaHubPage() {
  const { user } = useAuth();
  const [reports, setReports] = useState<SwaStewaReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const canCreateIar = canUserCreateReportType(user?.role, 'IAR');

  useEffect(() => {
    setLoading(true);
    listReports({ type: 'IAR' })
      .then((d) => setReports(d.reports))
      .catch(() => setReports([]))
      .finally(() => setLoading(false));
  }, []);

  const reportLink = (report: SwaStewaReport) => {
    if (
      (report.status === 'generated' || report.status === 'approved') &&
      reportIsViewOnly(
        user?.role,
        report.report_type,
        report.status,
        report.edit_user_ids,
        user?.id ? String(user.id) : null,
      )
    ) {
      return `/reports/view?id=${encodeURIComponent(report.id)}`;
    }
    return `/swa-stewa/edit?id=${encodeURIComponent(report.id)}`;
  };

  const sorted = [...reports].sort(
    (a, b) => reportDateOf(b).getTime() - reportDateOf(a).getTime(),
  );
  const filtered = sorted.filter((report) => {
    const search = query.trim().toLowerCase();
    const matchesQuery =
      !search ||
      [projectTitleOf(report), report.report_number, displayReportNumber(report), report.status]
        .some((value) => value.toLowerCase().includes(search));
    const matchesStatus = statusFilter === 'all' || report.status === statusFilter;
    return matchesQuery && matchesStatus;
  });
  const {
    page,
    setPage,
    pageItems,
    totalPages,
    from,
    to,
    total,
    pageSize,
  } = usePagination(filtered, {
    resetKey: `${query}|${statusFilter}`,
  });
  const approvedCount = reports.filter((report) => ['approved', 'generated'].includes(report.status)).length;
  const pendingCount = reports.filter((report) => !['approved', 'generated', 'rejected'].includes(report.status)).length;
  const revisionCount = reports.filter((report) => report.status === 'rejected').length;

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="space-y-5 px-8 pb-10 pt-6">
        <PageHeader
          badge="Report workspace"
          title="Inspection & Acceptance Reports"
          description="Create, track, and access inspection reports for completed and ongoing construction work."
          actions={
            canCreateIar ? (
              <ButtonLink to="/swa-stewa/new/IAR" variant="primary" className="!rounded-lg !px-2.5 !py-1.5 !text-[11px]">
                + New IAR
              </ButtonLink>
            ) : undefined
          }
        />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ['Total IAR reports', reports.length, 'All saved reports', 'iar'],
            ['Approved', approvedCount, 'Accepted and finalized', 'check'],
            ['Pending', pendingCount, 'Still in workflow', 'approval'],
            ['Revision requested', revisionCount, 'Needs attention', 'cross'],
          ].map(([label, value, caption, icon]) => (
            <div key={label} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">{label}</p>
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-50 text-teal-700"><NavIcon name={icon as NavIconName} className="h-5 w-5" /></span>
              </div>
              <p className="mt-3 text-2xl font-semibold text-text">{loading ? '…' : value}</p>
              <p className="mt-1 text-xs text-text-muted">{caption}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm sm:flex-row">
          <label className="flex-1"><span className="sr-only">Search IAR reports</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search project or report number…" className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" /></label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-primary">
            <option value="all">All statuses</option><option value="draft">Draft</option><option value="pending_review">Pending review</option><option value="approved">Approved</option><option value="generated">Finalized</option><option value="rejected">Revision requested</option>
          </select>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 className="text-lg font-semibold text-text">IAR register</h2><p className="mt-1 text-sm text-text-muted">{loading ? 'Loading reports…' : `${filtered.length} of ${reports.length} reports`}</p></div>
          <span className="inline-flex items-center gap-2 text-sm text-text-muted"><NavIcon name="iar" className="h-4 w-4 text-teal-700" />Inspection & Acceptance Report</span>
        </div>

        {loading ? (
          <div className="h-64 animate-pulse rounded-2xl border border-border bg-card" />
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center">
            <p className="font-semibold text-text">{reports.length ? 'No matching IAR reports' : 'No IAR reports yet'}</p>
            <p className="mt-2 text-sm text-text-muted">{reports.length ? 'Try changing your search or filter.' : canCreateIar ? 'Create your first IAR to begin the inspection record.' : 'IAR reports will appear here when available.'}</p>
            {canCreateIar && !reports.length && <ButtonLink to="/swa-stewa/new/IAR" variant="primary" className="mt-5">Create first IAR</ButtonLink>}
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[850px] border-collapse text-left text-sm">
                <thead className="bg-surface-muted/60"><tr className="border-b border-border text-[11px] uppercase tracking-wider text-text-muted"><th className="px-5 py-3 font-semibold">Report</th><th className="px-5 py-3 font-semibold">Project</th><th className="px-5 py-3 font-semibold">Report date</th><th className="px-5 py-3 font-semibold">Status</th><th className="px-5 py-3 text-right font-semibold">Action</th></tr></thead>
                <tbody className="divide-y divide-border/80">
                  {pageItems.map((report) => <tr key={report.id} className="transition hover:bg-surface-muted/40"><td className="px-5 py-4"><p className="font-semibold text-text">{displayReportNumber(report)}</p><p className="mt-1 text-xs text-text-muted">{formatReportDisplayDate(report)}</p></td><td className="max-w-[360px] px-5 py-4"><p className="truncate font-medium text-text">{projectTitleOf(report)}</p>{report.rejection_reason && <p className="mt-1 truncate text-xs text-warning">Revision: {report.rejection_reason}</p>}</td><td className="px-5 py-4 text-text-muted">{formatReportDisplayDate(report)}</td><td className="px-5 py-4"><StatusBadge status={report.status} /></td><td className="px-5 py-4 text-right"><Link to={reportLink(report)} className="rounded-lg bg-primary-light px-3 py-1.5 text-xs font-semibold text-primary">{reportIsViewOnly(user?.role, report.report_type, report.status, report.edit_user_ids, user?.id ? String(user.id) : null) || report.status === 'generated' || report.status === 'approved' ? 'View report' : 'Open report'}</Link></td></tr>)}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              from={from}
              to={to}
              pageSize={pageSize}
              onPageChange={setPage}
            />
          </div>
        )}
      </div>
    </main>
  );
}
