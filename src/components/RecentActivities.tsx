'use client';

import { useEffect, useState } from 'react';
import { Link } from '../lib/nextRouter';
import { listReports, type SwaStewaReport } from '../lib/swaStewaApi';
import { getRecentlyViewedReportIds } from '../lib/recentViewed';
import { displayReportNumber } from '../lib/reportNumber';
import { NavIcon } from './NavIcon';

const APPROVED = new Set(['approved', 'generated']);

function projectTitleOf(r: SwaStewaReport): string {
  return (
    (r.report_data?.project_title as string) ||
    (r.report_data?.project_name as string) ||
    r.project_name ||
    `Project #${r.project_id}`
  );
}

export function RecentActivities() {
  const [reports, setReports] = useState<SwaStewaReport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listReports()
      .then((d) => setReports(d.reports))
      .catch(() => setReports([]))
      .finally(() => setLoading(false));
  }, []);

  const viewedIds = getRecentlyViewedReportIds();
  const approved = reports
    .filter((r) => APPROVED.has(r.status))
    .sort((a, b) => {
      const ta = a.generated_at || a.created_at || '';
      const tb = b.generated_at || b.created_at || '';
      return tb.localeCompare(ta);
    });

  const recentlyViewed = viewedIds
    .map((id) => reports.find((r) => r.id === id))
    .filter((r): r is SwaStewaReport => Boolean(r))
    .slice(0, 5);

  const latestApproved = approved.slice(0, 8);
  const items = recentlyViewed.length > 0 ? recentlyViewed : latestApproved;

  return (
    <div
      id="recent-activities"
      className="scroll-mt-6 rounded-2xl border border-border bg-card p-6 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-text">Recent Activities</h3>
          <p className="mt-1 text-sm text-text-muted">
            {recentlyViewed.length > 0
              ? 'Reports you recently viewed'
              : 'Latest approved reports'}
          </p>
        </div>
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-light text-primary">
          <NavIcon name="reports" className="h-5 w-5" />
        </span>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-text-muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="mt-4 text-sm text-text-muted">No approved or recently viewed reports yet.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {items.map((r) => (
            <li key={r.id}>
              <Link
                to={
                  APPROVED.has(r.status)
                    ? `/reports/view?id=${encodeURIComponent(r.id)}`
                    : `/swa-stewa/edit?id=${encodeURIComponent(r.id)}`
                }
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface/60 p-4 transition hover:bg-surface-muted/50"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-text">{projectTitleOf(r)}</p>
                  <p className="text-sm text-text-muted">
                    {r.report_type} · {displayReportNumber(r)}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                    APPROVED.has(r.status)
                      ? 'bg-primary-light text-primary'
                      : 'bg-surface-muted text-text-muted'
                  }`}
                >
                  {APPROVED.has(r.status) ? 'Approved' : r.status.replace(/_/g, ' ')}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
