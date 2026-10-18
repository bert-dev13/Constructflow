'use client';

import { useEffect, useState } from 'react';
import { Link } from '../lib/nextRouter';
import type { Role } from '../types';
import { listProjects, type ProjectRow } from '../lib/projectsApi';
import { listReports, type SwaStewaReport } from '../lib/swaStewaApi';
import { displayReportNumber } from '../lib/reportNumber';
import { NavIcon } from './NavIcon';

const APPROVED_STATUSES = new Set(['approved', 'generated']);

function projectTitleOf(r: SwaStewaReport): string {
  return (
    (r.report_data?.project_title as string) ||
    (r.report_data?.project_name as string) ||
    r.project_name ||
    `Project #${r.project_id}`
  );
}

function ContractorIarAlerts() {
  const [reports, setReports] = useState<SwaStewaReport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listReports({ type: 'IAR' })
      .then((d) => setReports(d.reports))
      .catch(() => setReports([]))
      .finally(() => setLoading(false));
  }, []);

  const approvedCount = reports.filter((r) => APPROVED_STATUSES.has(r.status)).length;
  const pendingCount = reports.length - approvedCount;

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-text">IAR Status</h3>
      <p className="mt-1 text-sm text-text-muted">Approval status of your inspection reports</p>

      {loading ? (
        <p className="mt-4 text-sm text-text-muted">Loading IAR reports…</p>
      ) : reports.length === 0 ? (
        <p className="mt-4 text-sm text-text-muted">No IAR reports yet.</p>
      ) : (
        <>
          <div className="mt-4 flex items-center justify-between rounded-xl border border-border bg-surface/60 p-4">
            <div>
              <p className="font-medium text-text">IAR approvals</p>
              <p className="mt-0.5 text-sm text-text-muted">
                {approvedCount} approved · {pendingCount} pending approval
              </p>
            </div>
            <span className="text-2xl font-bold text-text">
              {approvedCount}/{reports.length}
            </span>
          </div>

          <ul className="mt-3 space-y-3">
            {reports.map((r) => {
              const approved = APPROVED_STATUSES.has(r.status);
              return (
                <li key={r.id}>
                  <Link
                    to="/swa-stewa"
                    className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface/60 p-4 transition hover:bg-surface-muted/50"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-text">{projectTitleOf(r)}</p>
                      <p className="truncate font-mono text-xs text-text-muted">{displayReportNumber(r)}</p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                        approved ? 'bg-primary-light text-primary' : 'bg-warning-bg text-warning'
                      }`}
                    >
                      {approved ? 'Approved' : 'Pending'}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function waitingStatuses(role?: Role) {
  if (role === 'engineer_2') return ['pending_review', 'contractor_confirmed'];
  if (role === 'engineer_3') return ['with_engineer_3'];
  if (role === 'engineer_4') return ['with_engineer_4'];
  return ['pending_review', 'contractor_confirmed', 'with_engineer_3', 'with_engineer_4'];
}

function reviewerLabel(role?: Role) {
  if (role === 'engineer_3') return 'Engineer III';
  if (role === 'engineer_4') return 'Engineer IV';
  return 'Engineer II';
}

function stageTag(status: string) {
  if (status === 'with_engineer_3') return 'ENGINEER III';
  if (status === 'with_engineer_4') return 'ENGINEER IV';
  return 'ENGINEER II';
}

function ReviewerAlerts({ role }: { role?: Role }) {
  const [reports, setReports] = useState<SwaStewaReport[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([listReports(), listProjects()])
      .then(([reportRes, projectRes]) => {
        setReports(reportRes.reports);
        setProjects(projectRes.projects);
      })
      .catch(() => {
        setReports([]);
        setProjects([]);
      })
      .finally(() => setLoading(false));
  }, []);

  const waiting = reports.filter((report) => waitingStatuses(role).includes(report.status));
  const byProject = new Map<string, { title: string; count: number; tag: string }>();
  for (const report of waiting) {
    const title = projectTitleOf(report);
    const current = byProject.get(title);
    if (current) {
      current.count += 1;
    } else {
      byProject.set(title, { title, count: 1, tag: stageTag(report.status) });
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  const delayed = projects.filter((project) => {
    const end = project.planned_end_date ? String(project.planned_end_date) : '';
    return project.lifecycle_state !== 'archived' && project.status === 'active' && Boolean(end) && end < today;
  });

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-text">Management Alerts</h3>
          <p className="mt-1 text-sm text-text-muted">Items needing attention</p>
        </div>
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
          <NavIcon name="approval" className="h-5 w-5" />
        </span>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-text-muted">Loading alerts…</p>
      ) : waiting.length === 0 && delayed.length === 0 ? (
        <p className="mt-4 text-sm text-text-muted">No items needing attention.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          <li>
            <Link
              to="/workflow"
              className="flex items-start justify-between gap-3 rounded-xl border border-border bg-surface/60 p-4 transition hover:bg-surface-muted/50"
            >
              <div>
                <p className="font-medium text-text">Pending approvals</p>
                <p className="mt-0.5 text-sm text-text-muted">
                  {waiting.length === 0
                    ? `No reports are waiting for ${reviewerLabel(role)} review.`
                    : `${waiting.length} report${waiting.length === 1 ? '' : 's'} waiting for ${reviewerLabel(role)} review.`}
                </p>
              </div>
              <span className="text-2xl font-bold text-text">{waiting.length}</span>
            </Link>
          </li>
          {delayed.map((project) => (
            <li key={project.id} className="rounded-xl border border-border bg-surface/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate font-medium text-text">{project.name}</p>
                <span className="shrink-0 rounded-full bg-warning-bg px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-warning">
                  Delayed
                </span>
              </div>
            </li>
          ))}
          {[...byProject.values()].map((item) => (
            <li key={item.title}>
              <Link
                to="/workflow"
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface/60 p-4 transition hover:bg-surface-muted/50"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-text">{item.title}</p>
                  <p className="text-xs text-text-muted">
                    {item.count} report{item.count === 1 ? '' : 's'} waiting
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-pm-tag px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  {item.tag}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ManagementAlerts({ role }: { role?: Role }) {
  if (role === 'contractor') {
    return <ContractorIarAlerts />;
  }

  return <ReviewerAlerts role={role} />;
}
