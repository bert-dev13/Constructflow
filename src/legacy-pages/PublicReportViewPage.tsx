'use client';

import { useEffect, useState } from 'react';
import { Link, useParams, usePathname, useSearchParams } from '../lib/nextRouter';
import { Logo } from '../components/Logo';
import { NavIcon } from '../components/NavIcon';
import { useAuth } from '../context/AuthContext';
import { downloadReportPreviewPdf } from '../lib/downloadReportPdf';
import { buildOfficialReportHtml } from '../lib/officialReportHtml';
import { printPreviewIframe } from '../lib/previewHelpers';
import { trackReportViewed } from '../lib/recentViewed';
import { buildReportPreviewHtml } from '../lib/reportVerification';
import { getReport, type SwaStewaReport } from '../lib/swaStewaApi';

function decodeKey(raw: string | null | undefined): string {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  try {
    return decodeURIComponent(value.replace(/\+/g, ' ')).trim();
  } catch {
    return value;
  }
}

export function PublicReportViewPage() {
  const { reportNumber: routeReportNumber } = useParams<{ reportNumber: string }>();
  const pathname = usePathname();
  const [searchParams] = useSearchParams();
  const reportId = decodeKey(searchParams?.get('id'));
  const reportNumber = decodeKey(
    routeReportNumber
      || searchParams?.get('reportNumber')
      || pathname?.match(/\/reports\/view\/([^/?#]+)/)?.[1]
      || '',
  );
  const lookupKey = reportId || reportNumber;
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [valid, setValid] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [report, setReport] = useState<SwaStewaReport | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');

  useEffect(() => {
    if (authLoading) return;

    if (!lookupKey) {
      setLoading(false);
      setValid(false);
      setReport(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    getReport(lookupKey)
      .then((res) => {
        if (cancelled) return;
        const loaded = res.report as SwaStewaReport;
        setValid(res.valid !== false);
        setReport(loaded);
        const official = buildOfficialReportHtml(loaded);
        setPreviewHtml(official || buildReportPreviewHtml(loaded));
        if (loaded.id) trackReportViewed(loaded.id);
      })
      .catch(() => {
        if (cancelled) return;
        setValid(false);
        setReport(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [lookupKey, authLoading]);

  const handlePrint = () => {
    const frame = document.getElementById('official-report-frame') as HTMLIFrameElement | null;
    printPreviewIframe(frame);
  };

  const handleDownloadPdf = async () => {
    if (!report) return;
    setDownloadError('');
    setDownloading(true);
    try {
      const frame = document.getElementById('official-report-frame') as HTMLIFrameElement | null;
      await downloadReportPreviewPdf({
        fileName: `${report.report_number || report.report_type || 'report'}.pdf`,
        pdfUrl: report.pdf_file,
        frame,
      });
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Could not download PDF.');
    } finally {
      setDownloading(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <p className="text-text-muted">Loading report…</p>
      </div>
    );
  }

  if (!valid || !report) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface p-6">
        <div className="w-full max-w-md rounded-3xl border border-red-200 bg-card p-8 text-center shadow-xl">
          <Logo showText={false} className="items-center" />
          <p className="mt-6 text-2xl font-bold text-red-600">INVALID REPORT</p>
          <p className="mt-2 text-text-muted">Record Not Found</p>
          <Link to="/" className="mt-6 inline-block text-sm text-primary underline">
            Return to home
          </Link>
        </div>
      </div>
    );
  }

  const backTo = user ? '/reports' : '/';
  const backLabel = user ? 'Back to Documents' : 'Return to home';

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-border bg-card px-6 py-3">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3">
          <Logo size="sm" showText={false} />
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={backTo}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-text shadow-sm transition hover:bg-surface-muted"
            >
              <NavIcon name="arrow-left" className="h-4 w-4" />
              {backLabel}
            </Link>
            <button
              type="button"
              onClick={() => void handleDownloadPdf()}
              disabled={downloading}
              className="rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-text shadow-sm transition hover:bg-surface-muted disabled:opacity-50"
            >
              {downloading ? 'Preparing PDF…' : 'Download PDF'}
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark"
            >
              Print
            </button>
          </div>
        </div>
        {downloadError ? (
          <p className="mx-auto mt-2 max-w-[1400px] text-sm text-red-600">{downloadError}</p>
        ) : null}
      </header>

      <div className="mx-auto max-w-[1400px] px-3 py-4 sm:px-6">
        <p className="mb-3 text-center text-sm text-text-muted">
          {report.report_type} · {report.report_number}
        </p>
        <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
          <iframe
            id="official-report-frame"
            title={`${report.report_number} official report`}
            srcDoc={previewHtml}
            className="h-[calc(100vh-140px)] min-h-[640px] w-full border-0 bg-white"
          />
        </section>
      </div>
    </div>
  );
}
