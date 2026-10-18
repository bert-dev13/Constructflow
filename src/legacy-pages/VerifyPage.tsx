'use client';

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from '../lib/nextRouter';
import { Logo } from '../components/Logo';
import { SYSTEM_NAME } from '../lib/branding';
import { displayReportNumber } from '../lib/reportNumber';
import { verifyReportQr } from '../lib/swaStewaApi';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  pending_review: 'Pending',
  with_engineer_3: 'Pending',
  with_engineer_4: 'Pending',
  approved: 'Approved',
  rejected: 'Revision Requested',
  generated: 'Approved (PDF generated)',
};

export function VerifyPage() {
  const [params] = useSearchParams();
  const qr = params?.get('qr');
  const [loading, setLoading] = useState(!!qr);
  const [valid, setValid] = useState(false);
  const [verified, setVerified] = useState(false);
  const [message, setMessage] = useState('');
  const [report, setReport] = useState<{
    id?: string;
    report_number: string;
    report_type: string;
    status: string;
    project_name?: string;
    created_at?: string;
    generated_at?: string;
    report_data?: Record<string, unknown>;
  } | null>(null);

  useEffect(() => {
    if (!qr) return;
    verifyReportQr(qr)
      .then((res) => {
        setValid(!!res.valid || !!res.report);
        setVerified(!!res.verified);
        setMessage(String(res.message ?? ''));
        if (res.report) setReport(res.report);
      })
      .catch(() => setValid(false))
      .finally(() => setLoading(false));
  }, [qr]);

  const projectName =
    (report?.report_data?.project_name as string) ||
    (report?.report_data?.project_title as string) ||
    report?.project_name ||
    '—';

  const submittedLabel = report?.created_at
    ? new Date(report.created_at).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : '—';

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-6">
      <div className="w-full max-w-lg rounded-3xl border border-border bg-card p-8 text-center shadow-xl">
        <Logo showText={false} className="items-center" />
        <p className="mt-6 text-[10px] font-bold uppercase tracking-wider text-primary">
          Report verification
        </p>
        <h1 className="mt-2 text-xl font-bold text-text">Document Verification</h1>
        <p className="mt-2 text-sm text-text-muted">
          Confirm report authenticity and live status from {SYSTEM_NAME}.
        </p>

        {!qr ? (
          <p className="mt-6 text-text-muted">No QR code provided.</p>
        ) : loading ? (
          <p className="mt-6 text-text-muted">Verifying…</p>
        ) : valid && report ? (
          <>
            <div className={`mt-6 rounded-xl p-4 ${verified ? 'bg-primary-light' : 'bg-warning-bg'}`}>
              <p className={`text-sm font-semibold ${verified ? 'text-primary' : 'text-warning'}`}>
                {verified ? 'Verified — System Generated' : 'Report found — pending final approval'}
              </p>
              <p className="mt-2 text-sm text-text-muted">
                {message || `This report is stored in ${SYSTEM_NAME}.`}
              </p>
            </div>
            <dl className="mt-6 space-y-3 text-left text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-text-muted">Report No.</dt>
                <dd className="font-mono text-right font-semibold">
                  {displayReportNumber(report)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-text-muted">Project</dt>
                <dd className="text-right">{projectName}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-text-muted">Type</dt>
                <dd className="text-right">{report.report_type}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-text-muted">Submitted</dt>
                <dd className="text-right">{submittedLabel}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-text-muted">Status</dt>
                <dd className="text-right font-semibold">
                  {STATUS_LABELS[report.status] ?? report.status.replace(/_/g, ' ')}
                </dd>
              </div>
            </dl>
            <Link
              to={`/reports/view?id=${encodeURIComponent(String(report.id ?? ''))}`}
              className="mt-6 inline-block rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark"
            >
              Open full report view
            </Link>
          </>
        ) : (
          <p className="mt-6 text-red-600">QR code not found in system records.</p>
        )}
      </div>
    </div>
  );
}
