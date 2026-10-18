'use client';

import { useEffect, useMemo, useState } from 'react';
import { Link } from '../lib/nextRouter';
import { useAuth } from '../context/AuthContext';
import { useSelectedProject } from '../context/SelectedProjectContext';
import { ProjectSelect } from './ProjectSelect';
import { ReportTypeBadge, StatusBadge } from './ui/StatusBadge';
import { PageHeader } from './ui/PageHeader';
import { Pagination } from './ui/Pagination';
import { NavIcon } from './NavIcon';
import { AGENCY_NAME, OFFICE_NAME, SYSTEM_NAME } from '../lib/branding';
import { getDashboardStats, type DashboardData } from '../lib/dashboardApi';
import { listProjects, type ProjectRow } from '../lib/projectsApi';
import { listReports, type SwaStewaReport } from '../lib/swaStewaApi';
import { canEditReport } from '../lib/reportPermissions';
import { displayReportNumber } from '../lib/reportNumber';
import { usePagination } from '../hooks/usePagination';

const ACTIONABLE_STATUSES = new Set([
  'draft',
  'rejected',
  'pending_contractor',
  'contractor_confirmed',
]);

const IN_REVIEW_STATUSES = new Set(['pending_review', 'with_engineer_3', 'with_engineer_4']);

const REPORT_STARTERS = [
  {
    type: 'SWA' as const,
    title: 'SWA',
    desc: 'Summary of Work Accomplished',
    to: '/swa-stewa/new/SWA',
  },
  {
    type: 'STEWA' as const,
    title: 'STEWA',
    desc: 'Time elapsed & work accomplished',
    to: '/swa-stewa/new/STEWA',
  },
  {
    type: 'IAR' as const,
    title: 'IAR',
    desc: 'Inspection & Acceptance Report',
    to: '/swa-stewa/new/IAR',
  },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function isDelayed(project: ProjectRow) {
  const end = project.planned_end_date;
  return Boolean(end && end < todayIso() && project.status === 'active');
}

function formatDate(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function reportHref(report: SwaStewaReport) {
  if (canEditReport('engineer_1', report.report_type, report.status)) {
    return `/swa-stewa/edit?id=${encodeURIComponent(report.id)}`;
  }
  return `/reports/view?id=${encodeURIComponent(report.id)}`;
}

export function EngineerIDashboard() {
  const { user } = useAuth();
  const { projectId, setProjectId } = useSelectedProject();

  const [stats, setStats] = useState<DashboardData | null>(null);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [reports, setReports] = useState<SwaStewaReport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Avoid triple-fetch: dashboard stats already loads projects + reports internally.
    Promise.all([listProjects(), listReports()])
      .then(async ([projectRes, reportRes]) => {
        if (cancelled) return;
        setProjects(projectRes.projects);
        setReports(reportRes.reports);
        // Stats reuse the same short-lived list cache, so this is cheap.
        const dashboard = await getDashboardStats();
        if (!cancelled) setStats(dashboard);
      })
      .catch(() => {
        if (cancelled) return;
        setStats(null);
        setProjects([]);
        setReports([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (projects.length === 0) return;
    if (!projects.some((p) => String(p.id) === projectId)) {
      setProjectId(String(projects[0].id));
    }
  }, [projects, projectId, setProjectId]);

  const uid = user?.id ? String(user.id) : '';

  const myReports = useMemo(() => {
    const mine = reports.filter((r) => !uid || !r.created_by || r.created_by === uid);
    return mine.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [reports, uid]);

  const workQueue = useMemo(
    () =>
      myReports.filter(
        (r) => ACTIONABLE_STATUSES.has(r.status) || IN_REVIEW_STATUSES.has(r.status),
      ),
    [myReports],
  );

  const delayedProjects = useMemo(() => projects.filter(isDelayed), [projects]);
  const projectPaging = usePagination(projects);

  const draftCount =
    stats?.counts.my_drafts ?? workQueue.filter((r) => r.status === 'draft').length;
  const revisionCount =
    stats?.counts.my_rejected ?? workQueue.filter((r) => r.status === 'rejected').length;
  const inReviewCount =
    workQueue.filter((r) => IN_REVIEW_STATUSES.has(r.status)).length;
  const delayedCount = stats?.kpis.delayedProjects.value ?? delayedProjects.length;

  const selectedName =
    projects.find((p) => String(p.id) === projectId)?.name ?? 'Selected project';

  return (
    <main className="flex-1 overflow-y-auto bg-surface">
      <div className="space-y-3 px-8 pb-2 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/80 bg-card px-3 py-2 text-[11px] text-text-muted shadow-sm">
          <p className="font-semibold uppercase tracking-widest">
            {SYSTEM_NAME} · {OFFICE_NAME}
          </p>
          <p className="truncate">{AGENCY_NAME}</p>
        </div>

        <PageHeader
          badge="Engineer I workspace"
          title="Project monitoring & reporting"
          description="Track projects, open schedules, and prepare SWA, STEWA, and IAR reports for Engineer II review."
          actions={
            <>
              <span className="rounded-lg border border-border bg-surface-muted px-2.5 py-1.5 text-[11px] font-medium text-text">
                Period:{' '}
                <span className="font-semibold text-primary">
                  {loading ? '…' : (stats?.period ?? '—')}
                </span>
              </span>
              <Link
                to="/reports"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-primary-dark"
              >
                <NavIcon name="reports" className="h-3.5 w-3.5" />
                Prepare report
              </Link>
              <Link
                to="/workflow"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11px] font-semibold text-text hover:bg-surface-muted"
              >
                <NavIcon name="submissions" className="h-3.5 w-3.5" />
                My submissions
              </Link>
            </>
          }
        />
      </div>

      <div className="space-y-8 px-8 py-6">
        <section aria-labelledby="attention-heading">
          <h2
            id="attention-heading"
            className="text-sm font-semibold uppercase tracking-wide text-text-muted"
          >
            Requires your attention
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <AttentionStat
              label="Drafts to finish"
              value={loading ? '…' : draftCount}
              hint="Saved reports not yet submitted"
              to="/workflow"
              emphasize={draftCount > 0}
            />
            <AttentionStat
              label="Revision requests"
              value={loading ? '…' : revisionCount}
              hint="Returned by Engineer II for changes"
              to="/workflow"
              emphasize={revisionCount > 0}
              warn
            />
            <AttentionStat
              label="Delayed projects"
              value={loading ? '…' : delayedCount}
              hint="Active projects past planned end date"
              to="/projects"
              emphasize={delayedCount > 0}
              warn
            />
            <AttentionStat
              label="In review"
              value={loading ? '…' : inReviewCount}
              hint="Reports currently with reviewers"
              to="/workflow"
              emphasize={inReviewCount > 0}
            />
          </div>
        </section>

        <section aria-labelledby="projects-heading">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="projects-heading" className="text-lg font-semibold text-text">
                Projects
              </h2>
              <p className="mt-1 text-sm text-text-muted">
                {loading
                  ? 'Loading…'
                  : `${projects.length} recorded · ${delayedProjects.length} delayed`}
              </p>
            </div>
            <Link to="/projects" className="text-sm font-semibold text-primary hover:underline">
              Manage projects
            </Link>
          </div>
          <div className="mt-3 overflow-hidden border border-border bg-card">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-border bg-surface-muted/60 text-xs uppercase tracking-wide text-text-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">Project</th>
                  <th className="px-4 py-3 font-semibold">Location</th>
                  <th className="px-4 py-3 font-semibold">Start</th>
                  <th className="px-4 py-3 font-semibold">Planned end</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-text-muted">
                      Loading projects…
                    </td>
                  </tr>
                ) : projects.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-text-muted">
                      No projects yet.{' '}
                      <Link to="/projects" className="font-semibold text-primary hover:underline">
                        Create a project
                      </Link>
                    </td>
                  </tr>
                ) : (
                  projectPaging.pageItems.map((project) => {
                    const delayed = isDelayed(project);
                    return (
                      <tr key={project.id} className="border-b border-border/70 last:border-0">
                        <td className="px-4 py-3 font-medium text-text">{project.name}</td>
                        <td className="px-4 py-3 text-text-muted">{project.location || '—'}</td>
                        <td className="px-4 py-3 text-text-muted">{formatDate(project.start_date)}</td>
                        <td className="px-4 py-3 text-text-muted">
                          {formatDate(project.planned_end_date)}
                        </td>
                        <td className="px-4 py-3">
                          {delayed ? (
                            <span className="inline-flex rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-red-700">
                              Delayed
                            </span>
                          ) : (
                            <span className="inline-flex rounded border border-border bg-surface-muted px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                              {project.status || 'active'}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => setProjectId(String(project.id))}
                            className="text-sm font-semibold text-primary hover:underline"
                          >
                            Select
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            </div>
            <Pagination
              page={projectPaging.page}
              totalPages={projectPaging.totalPages}
              total={projectPaging.total}
              from={projectPaging.from}
              to={projectPaging.to}
              pageSize={projectPaging.pageSize}
              onPageChange={projectPaging.setPage}
            />
          </div>
        </section>

        <section
          aria-labelledby="schedule-heading"
          className="flex flex-wrap items-center justify-between gap-4 border border-border bg-card px-5 py-4"
        >
          <div className="min-w-0 flex-1">
            <h2 id="schedule-heading" className="text-lg font-semibold text-text">
              Schedule tools
            </h2>
            <p className="mt-1 text-sm text-text-muted">
              Working project: <span className="font-medium text-text">{selectedName}</span>
            </p>
          </div>
          <div className="w-full max-w-xs sm:w-64">
            <ProjectSelect value={projectId} onChange={setProjectId} />
          </div>
          <div className="flex flex-wrap gap-2">
            <ToolLink to="/pdm" icon="pdm" label="PDM" />
            <ToolLink to="/bar-chart" icon="bar-chart" label="Bar Chart" />
            <ToolLink to="/s-curve" icon="s-curve" label="S-Curve" />
          </div>
        </section>

        <section aria-labelledby="reporting-heading">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="reporting-heading" className="text-lg font-semibold text-text">
                Reporting
              </h2>
              <p className="mt-1 text-sm text-text-muted">
                Prepare progress reports, then track them under My Submissions.
              </p>
            </div>
            {workQueue.length > 0 && (
              <Link to="/workflow" className="text-sm font-semibold text-primary hover:underline">
                Open My Submissions
              </Link>
            )}
          </div>

          {loading ? (
            <p className="mt-4 text-sm text-text-muted">Loading reports…</p>
          ) : workQueue.length > 0 ? (
            <div className="mt-3 overflow-x-auto border border-border bg-card">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-border bg-surface-muted/60 text-xs uppercase tracking-wide text-text-muted">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Report</th>
                    <th className="px-4 py-3 font-semibold">Type</th>
                    <th className="px-4 py-3 font-semibold">Project</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold" />
                  </tr>
                </thead>
                <tbody>
                  {workQueue.slice(0, 10).map((report) => (
                    <tr key={report.id} className="border-b border-border/70 last:border-0">
                      <td className="px-4 py-3 font-medium text-text">{displayReportNumber(report)}</td>
                      <td className="px-4 py-3">
                        <ReportTypeBadge type={report.report_type} />
                      </td>
                      <td className="px-4 py-3 text-text-muted">
                        {report.project_name || report.project_id}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={report.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          to={reportHref(report)}
                          className="text-sm font-semibold text-primary hover:underline"
                        >
                          {canEditReport('engineer_1', report.report_type, report.status)
                            ? 'Continue'
                            : 'View'}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {REPORT_STARTERS.map((item) => (
                <Link
                  key={item.type}
                  to={item.to}
                  className="border border-border bg-card px-4 py-4 transition hover:border-primary/40"
                >
                  <p className="text-sm font-bold text-text">{item.title}</p>
                  <p className="mt-1 text-xs text-text-muted">{item.desc}</p>
                  <p className="mt-3 text-xs font-semibold text-primary">Start report</p>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function AttentionStat({
  label,
  value,
  hint,
  to,
  emphasize,
  warn,
}: {
  label: string;
  value: number | string;
  hint: string;
  to: string;
  emphasize?: boolean;
  warn?: boolean;
}) {
  return (
    <Link
      to={to}
      className={`block border px-4 py-4 transition hover:border-primary/40 ${
        emphasize
          ? warn
            ? 'border-amber-300 bg-amber-50'
            : 'border-primary/30 bg-primary-light/40'
          : 'border-border bg-card'
      }`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</p>
      <p className="mt-2 text-3xl font-bold text-text">{value}</p>
      <p className="mt-1 text-xs text-text-muted">{hint}</p>
    </Link>
  );
}

function ToolLink({
  to,
  icon,
  label,
}: {
  to: string;
  icon: 'pdm' | 'bar-chart' | 's-curve';
  label: string;
}) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1.5 border border-border bg-surface-muted/50 px-3 py-2 text-sm font-semibold text-text hover:border-primary/40 hover:bg-card"
    >
      <NavIcon name={icon} className="h-4 w-4" />
      {label}
    </Link>
  );
}
