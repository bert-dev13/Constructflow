'use client';

import { useEffect, useMemo, useState } from 'react';
import { Link } from '../lib/nextRouter';
import { useSelectedProject } from '../context/SelectedProjectContext';
import { getDashboardStats, type DashboardData } from '../lib/dashboardApi';
import { listProjects, type ProjectRow } from '../lib/projectsApi';
import { listReports, type SwaStewaReport } from '../lib/swaStewaApi';
import { displayReportNumber } from '../lib/reportNumber';
import { NavIcon, type NavIconName } from './NavIcon';
import { ReportTypeBadge, StatusBadge } from './ui/StatusBadge';
import { PageHeader } from './ui/PageHeader';
import { Pagination } from './ui/Pagination';
import { usePagination } from '../hooks/usePagination';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function isDelayed(project: ProjectRow) {
  return Boolean(project.planned_end_date && project.planned_end_date < todayIso() && project.status === 'active');
}

function projectTitle(report: SwaStewaReport) {
  return (report.report_data?.project_title as string) || report.project_name || `Project #${report.project_id}`;
}

export function ContractorDashboard() {
  const { projectId, setProjectId } = useSelectedProject();
  const [stats, setStats] = useState<DashboardData | null>(null);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [reports, setReports] = useState<SwaStewaReport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listProjects(), listReports()])
      .then(async ([projectRes, reportRes]) => {
        if (cancelled) return;
        setProjects(projectRes.projects);
        setReports(reportRes.reports);
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
    if (projects.length > 0 && !projects.some((project) => String(project.id) === projectId)) {
      setProjectId(String(projects[0].id));
    }
  }, [projects, projectId, setProjectId]);

  const delayedProjects = useMemo(() => projects.filter(isDelayed), [projects]);
  const projectPaging = usePagination(projects);
  const iarReports = reports.filter((report) => report.report_type === 'IAR');
  const reportsInReview = reports.filter((report) =>
    ['pending_review', 'with_engineer_3', 'with_engineer_4', 'contractor_confirmed'].includes(report.status),
  );
  const selectedName = projects.find((project) => String(project.id) === projectId)?.name ?? 'Selected project';

  const cards: [string, string | number, string, NavIconName][] = [
    ['Active projects', stats?.kpis.visibleProjects.value ?? projects.length, 'Projects available to you', 'projects'],
    ['Delayed projects', stats?.kpis.delayedProjects.value ?? delayedProjects.length, 'Past planned completion date', 'schedule'],
    ['IAR reports', iarReports.length, 'Inspection reports submitted', 'iar'],
    ['Reports in review', reportsInReview.length, 'Awaiting engineer action', 'approval'],
  ];

  return (
    <main className="flex-1 overflow-y-auto bg-surface">
      <div className="space-y-5 px-8 pb-10 pt-6">
        <PageHeader
          badge="Contractor workspace"
          title="Construction dashboard"
          description="Prepare schedules, monitor project delivery, and submit progress reports for review."
          actions={
            <>
              <Link
                to="/schedule"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-primary/90"
              >
                <NavIcon name="schedule" className="h-3.5 w-3.5" />
                Prepare schedule
              </Link>
              <Link
                to="/swa-stewa/new/IAR"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11px] font-semibold text-text hover:bg-surface-muted"
              >
                <NavIcon name="iar" className="h-3.5 w-3.5" />
                New IAR
              </Link>
            </>
          }
        />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map(([label, value, caption, icon]) => (
            <div key={label} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">{label}</p>
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-light text-primary">
                  <NavIcon name={icon} className="h-5 w-5" />
                </span>
              </div>
              <p className={`mt-3 text-2xl font-semibold ${label === 'Delayed projects' && Number(value) > 0 ? 'text-red-600' : 'text-text'}`}>
                {loading ? '…' : value}
              </p>
              <p className="mt-1 text-xs text-text-muted">{caption}</p>
            </div>
          ))}
        </div>

        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-text">My projects</h2>
              <p className="mt-1 text-sm text-text-muted">Select a project to open its schedules and reports.</p>
            </div>
            <Link to="/projects" className="text-sm font-semibold text-primary hover:underline">View all projects</Link>
          </div>
          <div className="mt-4 overflow-hidden rounded-xl border border-border">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead className="bg-surface-muted/60 text-[11px] uppercase tracking-wider text-text-muted">
                <tr className="border-b border-border">
                  <th className="px-4 py-3 font-semibold">Project</th>
                  <th className="px-4 py-3 font-semibold">Location</th>
                  <th className="px-4 py-3 font-semibold">Planned end</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/80">
                {loading ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-text-muted">Loading projects…</td></tr>
                ) : projects.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-text-muted">No projects assigned yet.</td></tr>
                ) : projectPaging.pageItems.map((project) => {
                  const delayed = isDelayed(project);
                  return (
                    <tr key={project.id} className="transition hover:bg-surface-muted/40">
                      <td className="px-4 py-4 font-semibold text-text">{project.name}</td>
                      <td className="px-4 py-4 text-text-muted">{project.location || '—'}</td>
                      <td className="px-4 py-4 text-text-muted">{project.planned_end_date || 'Not set'}</td>
                      <td className="px-4 py-4"><span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase ${delayed ? 'border-red-200 bg-red-50 text-red-700' : 'border-border bg-surface-muted text-text-muted'}`}>{delayed ? 'Delayed' : project.status}</span></td>
                      <td className="px-4 py-4 text-right"><button type="button" onClick={() => setProjectId(String(project.id))} className="rounded-lg bg-primary-light px-3 py-1.5 text-xs font-semibold text-primary">Select</button></td>
                    </tr>
                  );
                })}
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

        <div className="grid gap-6 xl:grid-cols-2">
          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div><h2 className="text-lg font-semibold text-text">Schedule tools</h2><p className="mt-1 text-sm text-text-muted">Open the tools for {selectedName}.</p></div>
              <NavIcon name="pdm" className="h-6 w-6 text-primary" />
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {[
                ['/schedule', 'Prepare', 'Enter activities', 'schedule'],
                ['/pdm', 'PDM', 'Review dependencies', 'pdm'],
                ['/bar-chart', 'Bar chart', 'Track timeline', 'bar-chart'],
              ].map(([to, label, description, icon]) => (
                <Link key={to} to={to} className="rounded-xl border border-border bg-surface-muted/40 p-3 transition hover:border-primary/40 hover:bg-primary-light/30">
                  <NavIcon name={icon as NavIconName} className="h-5 w-5 text-primary" />
                  <p className="mt-3 text-sm font-semibold text-text">{label}</p>
                  <p className="mt-1 text-xs text-text-muted">{description}</p>
                </Link>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div><h2 className="text-lg font-semibold text-text">Recent reports</h2><p className="mt-1 text-sm text-text-muted">Track reports submitted for review.</p></div>
              <NavIcon name="reports" className="h-6 w-6 text-primary" />
            </div>
            <div className="mt-4 space-y-2">
              {reports.slice(0, 5).map((report) => (
                <Link key={report.id} to={`/swa-stewa/edit?id=${encodeURIComponent(report.id)}`} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-muted/40 px-3 py-2.5 hover:bg-surface-muted">
                  <div className="min-w-0"><p className="truncate text-sm font-medium text-text">{projectTitle(report)}</p><p className="mt-0.5 text-xs text-text-muted">{displayReportNumber(report)}</p></div>
                  <div className="flex shrink-0 items-center gap-2"><ReportTypeBadge type={report.report_type} /><StatusBadge status={report.status} /></div>
                </Link>
              ))}
              {reports.length === 0 && <p className="py-6 text-sm text-text-muted">No reports submitted yet.</p>}
            </div>
            <Link to="/reports" className="mt-4 inline-block text-sm font-semibold text-primary hover:underline">Open reports</Link>
          </section>
        </div>
      </div>
    </main>
  );
}
