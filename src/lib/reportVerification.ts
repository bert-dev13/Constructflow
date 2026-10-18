import QRCode from 'qrcode';
import { BASE_URL } from './paths';
import { displayReportNumber } from './reportNumber';

/** Stable verification code stored on the report (qrCode / report number). */
export function reportVerificationCode(report: {
  qr_code?: string | null;
  report_number?: string | null;
  id?: string | null;
}): string {
  return String(report.qr_code || report.report_number || report.id || '').trim();
}

/** Absolute URL encoded in the QR — opens the public Report Verification page. */
export function reportVerificationUrl(code: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const base = BASE_URL.endsWith('/') ? BASE_URL : `${BASE_URL}/`;
  return `${origin}${base}verify?qr=${encodeURIComponent(code)}`;
}

export async function reportQrDataUrl(code: string): Promise<string> {
  const url = reportVerificationUrl(code);
  return QRCode.toDataURL(url, {
    width: 280,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: '#0B3D2E', light: '#FFFFFF' },
  });
}

export function buildReportPreviewHtml(report: {
  report_number: string;
  report_type: string;
  status: string;
  project_name?: string | null;
  created_at?: string;
  generated_at?: string;
  report_data?: Record<string, unknown>;
  line_items?: unknown;
}): string {
  const data = report.report_data ?? {};
  const projectName =
    String(data.project_name ?? data.project_title ?? report.project_name ?? '—');
  const rows = Object.entries(data)
    .filter(([, value]) => value != null && value !== '' && typeof value !== 'object')
    .map(
      ([key, value]) =>
        `<tr><td style="padding:6px 10px;color:#64748b;border-bottom:1px solid #e2e8f0">${escapeHtml(key.replace(/_/g, ' '))}</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0">${escapeHtml(String(value))}</td></tr>`,
    )
    .join('');

  const lineItems = Array.isArray(report.line_items)
    ? (report.line_items as Array<Record<string, unknown>>)
    : [];
  const lineRows = lineItems
    .slice(0, 40)
    .map((item) => {
      const no = String(item.item_no ?? item.itemNo ?? item.pay_item_no ?? '—');
      const desc = String(item.description ?? item.snapshotDescription ?? '—');
      const unit = String(item.unit ?? item.snapshotUnit ?? '—');
      const qty = String(item.quantity ?? item.qty ?? item.accomplished_qty ?? '—');
      return `<tr><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0">${escapeHtml(no)}</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0">${escapeHtml(desc)}</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0">${escapeHtml(unit)}</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right">${escapeHtml(qty)}</td></tr>`;
    })
    .join('');

  const reportNo = displayReportNumber(report);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(reportNo)}</title>
<style>
  body{font-family:Georgia,'Times New Roman',serif;color:#0f172a;margin:0;padding:32px;background:#fff}
  h1{font-size:22px;margin:0 0 4px;color:#0B3D2E}
  h2{font-size:16px;margin:24px 0 8px;color:#0B3D2E}
  .meta{color:#64748b;font-size:13px;margin-bottom:20px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  .badge{display:inline-block;padding:4px 10px;border-radius:999px;background:#ecfdf5;color:#047857;font-size:11px;font-weight:700;text-transform:uppercase}
</style></head><body>
  <h1>ConstructFlow — ${escapeHtml(report.report_type)} Report</h1>
  <p class="meta">${escapeHtml(reportNo)} · ${escapeHtml(projectName)}</p>
  <p><span class="badge">${escapeHtml(report.status.replace(/_/g, ' '))}</span></p>
  <h2>Report details</h2>
  <table>${rows || '<tr><td style="padding:8px;color:#64748b">No field data available.</td></tr>'}</table>
  ${lineRows ? `<h2>Line items</h2><table><thead><tr><th style="text-align:left;padding:6px 10px;border-bottom:2px solid #cbd5e1">Item No.</th><th style="text-align:left;padding:6px 10px;border-bottom:2px solid #cbd5e1">Description</th><th style="text-align:left;padding:6px 10px;border-bottom:2px solid #cbd5e1">Unit</th><th style="text-align:right;padding:6px 10px;border-bottom:2px solid #cbd5e1">Qty</th></tr></thead><tbody>${lineRows}</tbody></table>` : ''}
</body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
