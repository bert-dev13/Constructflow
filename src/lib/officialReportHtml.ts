import type { SwaStewaReport } from './swaStewaApi';
import { BASE_URL } from './paths';
import { displayReportNumber } from './reportNumber';
import { formatExcelDate, formatSwaAsOfLabel, stewaDash, stewaPercentText } from './stewaCalculations';
import {
  computeWorkItems,
  isSwaSectionRow,
  formatMoney,
  formatPct,
  type WorkItem,
  type WorkItemComputed,
} from './workItems';
import { signatureSectionHtml } from './signatories';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truthyFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const s = String(value ?? '')
    .trim()
    .toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function lessAmountOf(data: Record<string, unknown>): number {
  const less = data.less_amount ?? data.lessAmount;
  if (less != null && String(less) !== '') return Number(less) || 0;
  return Number(data.advance_payment ?? data.advancePayment ?? 0) || 0;
}

function lessReasonOf(data: Record<string, unknown>): string {
  const reason = String(data.less_reason ?? data.lessReason ?? '').trim();
  if (reason) return reason;
  return lessAmountOf(data) > 0 ? 'Advance Payment' : '';
}

function formatReportDate(value: unknown, allowEmpty = false): string {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return allowEmpty
      ? ''
      : new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
  }
  const ts = Date.parse(raw);
  if (Number.isNaN(ts)) return raw;
  return new Date(ts).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function field(data: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = data[key];
    if (value != null && String(value).trim() !== '') return String(value);
  }
  return '';
}

function moneyField(data: Record<string, unknown>, ...keys: string[]): string {
  const raw = field(data, ...keys);
  if (!raw) return '';
  const n = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? formatMoney(n) : escapeHtml(raw);
}

/** Absolute public asset URL so logos load inside srcDoc iframes. */
function assetUrl(path: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const base = BASE_URL.endsWith('/') ? BASE_URL : `${BASE_URL}/`;
  return `${origin}${base}${path.replace(/^\//, '')}`;
}

function sealImg(src: string, alt: string): string {
  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" width="68" height="68" style="width:68px;height:68px;object-fit:contain;display:block;border:0" />`;
}

/** Shared provincial letterhead — PGC seal left, PEO seal right. */
function letterheadHtml(): string {
  const pgc = sealImg(assetUrl('img/pgc.jpg'), 'Province of Cagayan Official Seal');
  const peo = sealImg(assetUrl('img/peo.webp'), "Provincial Engineer's Office Seal");
  return `<table class="letterhead" width="100%" cellpadding="0" cellspacing="0">
  <tr>
    <td class="seal seal-left">${pgc}</td>
    <td class="header-text">
      <div class="gov">Republic of the Philippines</div>
      <div class="prov">PROVINCE OF CAGAYAN</div>
      <div class="addr">Capitol Hills, Tuguegarao City</div>
      <div class="office">PROVINCIAL ENGINEER'S OFFICE</div>
    </td>
    <td class="seal seal-right">${peo}</td>
  </tr>
</table>`;
}

const SHARED_CSS = `
  body { font-family: Arial, Helvetica, sans-serif; color:#111; margin:0; padding:18px 22px 48px; background:#fff; }
  .report-no { font-size: 7.5pt; color: #555; text-align: right; margin: 0 0 8px 0; }
  h3, .doc-title { text-align: center; margin: 10px 0 6px; font-size: 11pt; font-weight: bold; letter-spacing: 0.2px; }
  .meta { margin-bottom: 12px; font-size: 9pt; text-align: center; line-height: 1.35; }
  .letterhead { width: 100%; border-collapse: collapse; margin: 0 0 12px 0; }
  .letterhead td { border: none; vertical-align: middle; padding: 0; }
  .letterhead .seal { width: 76px; }
  .letterhead .seal-left { text-align: left; }
  .letterhead .seal-right { text-align: right; }
  .letterhead .header-text { text-align: center; padding: 0 12px; }
  .letterhead .gov { font-size: 8pt; }
  .letterhead .prov { font-size: 11pt; font-weight: bold; margin-top: 1px; }
  .letterhead .addr { font-size: 8pt; margin-top: 1px; }
  .letterhead .office { font-size: 9.5pt; font-weight: bold; text-decoration: underline; margin-top: 2px; }
  table.grid { width: 100%; border-collapse: collapse; }
  table.grid th, table.grid td { border: 1px solid #000; padding: 4px 5px; text-align: center; vertical-align: top; font-size: 7.5pt; white-space: normal; overflow-wrap: anywhere; word-wrap: break-word; height: auto; line-height: 1.3; }
  table.grid th { background: #f0f0f0; font-size: 7pt; }
  td.left { text-align: left; }
  td.right { text-align: right; }
  .total-row { font-weight: bold; }
  table.form { width: 100%; border-collapse: collapse; margin: 6px 0 10px; }
  table.form td { border: none; padding: 5px 4px; vertical-align: top; font-size: 10pt; white-space: normal; overflow-wrap: anywhere; word-wrap: break-word; height: auto; line-height: 1.3; }
  table.form td.lbl { width: 46%; white-space: normal; padding-right: 6px; }
  table.form td.colon { width: 12px; text-align: center; }
  table.form td.val { width: auto; border-bottom: 1px solid #000; min-height: 16px; padding-left: 4px; padding-bottom: 3px; }
  table.form tr.emphasis td.val { font-weight: bold; text-transform: uppercase; }
  .signatures { clear: both; margin-top: 32px; width: 100%; font-size: 8pt; display: flex; justify-content: space-between; gap: 12px; }
  .sig { flex: 1; text-align: center; vertical-align: top; overflow-wrap: anywhere; }
  .sig-mark { min-height: 36px; margin-top: 8px; display: flex; align-items: flex-end; justify-content: center; }
  .sig-image { max-width: 120px; max-height: 36px; object-fit: contain; }
  .sig-initials { font-family: "Segoe Script", "Brush Script MT", cursive; font-size: 13pt; line-height: 1; letter-spacing: 0.5px; }
  .sig-name { font-weight: bold; text-decoration: underline; margin-top: 4px; min-height: 1.2em; text-transform: uppercase; overflow-wrap: anywhere; }
  .sig-title { margin-top: 2px; }
  .sig-date { font-size: 7pt; margin-top: 2px; }
  .two-col td, .meta-table td, .summary td, .lined-box, .problems-box, .lined-box p {
    white-space: normal;
    overflow-wrap: anywhere;
    word-wrap: break-word;
    height: auto;
  }
  tr, .signatures, .section-lbl, .summary, .lined-box, .problems-box {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  thead { display: table-header-group; }
  @media print {
    html, body { overflow: visible; }
    table.grid th, table.grid td, table.form td, .meta-table td { overflow: visible; height: auto; }
  }
`;

function isSectionRow(row: WorkItemComputed): boolean {
  if (row.isSection || isSwaSectionRow(row)) return true;
  const itemNo = String(row.snapshotItemNo || row.itemNo || '').trim();
  const unit = String(row.snapshotUnit || row.unit || '').trim();
  const desc = String(row.snapshotDescription || row.description || '').trim();
  if (/^[A-Z]\.\s+[A-Z]/.test(desc)) return true;
  return !itemNo && !unit && (row.unitPrice || 0) === 0 && (row.programmedQty || 0) === 0;
}

function qtyCell(value: number, blankZero = false): string {
  if (blankZero && (!value || Math.abs(value) < 1e-9)) return '';
  return formatPct(value);
}

function moneyCell(value: number, blankZero = false): string {
  if (blankZero && (!value || Math.abs(value) < 1e-9)) return '';
  return formatMoney(value);
}

function normalizeLineItems(raw: unknown): WorkItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry, index) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    return {
      id: String(item.id ?? `row-${index}`),
      isSection: Boolean(item.isSection ?? item.is_section),
      payItemId: item.payItemId != null ? String(item.payItemId) : undefined,
      payItemVersion: item.payItemVersion != null ? Number(item.payItemVersion) : undefined,
      snapshotItemNo: item.snapshotItemNo != null ? String(item.snapshotItemNo) : undefined,
      snapshotDescription:
        item.snapshotDescription != null ? String(item.snapshotDescription) : undefined,
      snapshotUnit: item.snapshotUnit != null ? String(item.snapshotUnit) : undefined,
      itemNo: String(item.itemNo ?? item.item_no ?? ''),
      description: String(item.description ?? ''),
      unit: String(item.unit ?? ''),
      unitPrice: Number(item.unitPrice ?? item.unit_price ?? 0) || 0,
      programmedQty: Number(item.programmedQty ?? item.programmed_qty ?? 0) || 0,
      revisedQty: Number(item.revisedQty ?? item.revised_qty ?? 0) || 0,
      previous: Number(item.previous ?? 0) || 0,
      thisPeriod: Number(item.thisPeriod ?? item.this_period ?? 0) || 0,
      toDateInput:
        item.toDateInput != null && Number.isFinite(Number(item.toDateInput))
          ? Number(item.toDateInput)
          : undefined,
      remarks: String(item.remarks ?? item.status ?? ''),
    };
  });
}

function padRows<T extends Record<string, unknown>>(items: T[], min: number): T[] {
  const rows = [...items];
  while (rows.length < min) rows.push({} as T);
  return rows;
}

function linedListHtml(value: unknown): string {
  const lines = Array.isArray(value)
    ? value.map((line) => String(line ?? '').trim()).filter(Boolean)
    : String(value ?? '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
  if (!lines.length) return '<p>&nbsp;</p><p>&nbsp;</p><p>&nbsp;</p>';
  let html = lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('');
  while ((html.match(/<p>/g) || []).length < 3) html += '<p>&nbsp;</p>';
  return html;
}

function asRowArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row) => row && typeof row === 'object') as Record<string, unknown>[];
}

function formRow(label: string, value: string, emphasis = false): string {
  return `<tr class="${emphasis ? 'emphasis' : ''}">
    <td class="lbl">${escapeHtml(label)}</td>
    <td class="colon">:</td>
    <td class="val">${value || '&nbsp;'}</td>
  </tr>`;
}

export function buildOfficialSwaHtml(
  report: Pick<SwaStewaReport, 'report_number' | 'report_data' | 'line_items' | 'project_name' | 'approval_flow'>,
): string {
  const data = (report.report_data ?? {}) as Record<string, unknown>;
  const showRevised = truthyFlag(data.show_revised_quantity ?? data.showRevisedQuantity);
  const lessAmount = lessAmountOf(data);
  const { items, totals } = computeWorkItems(
    normalizeLineItems(report.line_items),
    lessAmount,
    showRevised,
  );

  const rows = items
    .map((row) => {
      const section = isSectionRow(row);
      if (row.isSection || section) {
        let html = '<tr class="section-row">';
        html += `<td class="center"><strong>${escapeHtml(String(row.itemNo || row.snapshotItemNo || ''))}</strong></td>`;
        html += `<td class="left" colspan="${showRevised ? 14 : 11}"><strong>${escapeHtml(String(row.description || row.snapshotDescription || ''))}</strong></td>`;
        html += '</tr>';
        return html;
      }
      let html = '<tr>';
      html += `<td class="center">${escapeHtml(String(row.itemNo || row.snapshotItemNo || ''))}</td>`;
      html += `<td class="left">${escapeHtml(String(row.description || row.snapshotDescription || ''))}</td>`;
      html += `<td class="right">${qtyCell(row.programmedQty, false)}</td>`;
      html += `<td class="right">${moneyCell(row.unitPrice, false)}</td>`;
      html += `<td class="center">${escapeHtml(String(row.unit || row.snapshotUnit || ''))}</td>`;
      html += `<td class="right">${moneyCell(row.contractAmount, false)}</td>`;
      html += `<td class="right">${formatPct(row.weightPct)}%</td>`;
      if (showRevised) {
        const rq = row.revisedQty ?? 0;
        html += `<td class="right">${rq > 0 ? formatPct(rq) : ''}</td>`;
        html += `<td class="right">${moneyCell(row.revisedAmount, true)}</td>`;
        html += `<td class="right">${formatPct(row.revisedWeightPct)}%</td>`;
      }
      html += `<td class="right">${row.previous ? moneyCell(row.previous, true) : ''}</td>`;
      html += `<td class="right">${row.thisPeriod ? moneyCell(row.thisPeriod) : '-'}</td>`;
      html += `<td class="right">${row.toDate ? moneyCell(row.toDate) : '-'}</td>`;
      html += `<td class="right">${formatPct(row.accomplishmentWeightPct)}%</td>`;
      html += `<td class="center">${escapeHtml(String(row.remarks || ''))}</td>`;
      html += '</tr>';
      return html;
    })
    .join('');

  const projectName = escapeHtml(
    String(data.project_name ?? data.project_title ?? report.project_name ?? ''),
  );
  const location = escapeHtml(String(data.location ?? ''));
  const contractor = escapeHtml(field(data, 'contractor'));
  const contractAmountFormatted = moneyField(data, 'contract_amount');
  const lessReason = escapeHtml(lessReasonOf(data));

  const reportNo = displayReportNumber({
    report_type: 'SWA',
    report_number: report.report_number,
    report_data: data,
  });

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
@page { size: 13in 8.5in; margin: 0.16in 0.22in 0.16in 0.22in; }
${SHARED_CSS}
body { font-size: 6.7pt; padding: 0; margin: 0; color: #000; background: #fff; position: relative; }
.report-no { font-size: 6.8pt; position: absolute; right: 0; top: 0; margin: 0; color: #444; }
.letterhead { margin: 0 0 1px 0; width: 100%; }
.letterhead .seal { width: 36px; }
.letterhead .seal img { width: 30px !important; height: 30px !important; }
.letterhead .gov { font-size: 6.5pt; line-height: 1.05; }
.letterhead .prov { font-size: 8.5pt; font-weight: bold; line-height: 1.1; margin-top: 0.5px; letter-spacing: 0.2px; }
.letterhead .addr { font-size: 6.5pt; line-height: 1.05; margin-top: 0.5px; }
.letterhead .office { font-size: 7.5pt; font-weight: bold; line-height: 1.1; text-decoration: underline; margin-top: 0.5px; }
h3, .doc-title { margin: 1px 0 0.5px 0; font-size: 8.5pt; font-weight: bold; letter-spacing: 0.3px; line-height: 1.1; }
.meta { margin-bottom: 2px; font-size: 6.7pt; line-height: 1.15; text-align: center; }
.meta .as-of { font-size: 6.7pt; margin-bottom: 0.5px; }
.meta .proj-title { font-size: 7.1pt; font-weight: bold; margin-bottom: 0.5px; }
.meta .proj-info { font-size: 6.7pt; }
table.grid { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 0; }
table.grid th, table.grid td { border: 1px solid #000; padding: 0.6px 2.5px; font-size: 6.7pt; line-height: 1.08; vertical-align: middle; box-sizing: border-box; }
table.grid th { background: #f0f0f0; font-size: 6.4pt; font-weight: bold; text-align: center; padding: 1.2px 2px; }
table.grid td.center { text-align: center; }
table.grid td.left { text-align: left; white-space: normal; overflow-wrap: break-word; word-break: normal; }
table.grid td.right { text-align: right; white-space: nowrap; }
table.grid tr.section-row td { font-weight: bold; background: #f7f7f7; padding: 0.6px 2.5px; }
table.grid tr.total-row td { font-weight: bold; background: #f0f0f0; padding: 0.8px 2.5px; }
.summary { margin-top: 1px; float: right; width: 240px; font-size: 6.6pt; }
.summary td { border: none; padding: 0.3px 2px; line-height: 1.08; }
.summary .label { text-align: left; }
.summary .val { text-align: right; font-weight: bold; white-space: nowrap; }
.signatures { clear: both; margin-top: 2px; width: 100%; font-size: 6.6pt; display: flex; justify-content: space-between; gap: 6px; }
.sig { flex: 1; text-align: center; vertical-align: top; overflow-wrap: break-word; }
.sig-mark { min-height: 16px; margin-top: 1px; display: flex; align-items: flex-end; justify-content: center; }
.sig-image { max-width: 85px; max-height: 18px; object-fit: contain; }
.sig-initials { font-family: "Segoe Script", "Brush Script MT", cursive; font-size: 10pt; line-height: 1; letter-spacing: 0.5px; }
.sig-name { font-weight: bold; text-decoration: underline; margin-top: 1px; min-height: 1.1em; text-transform: uppercase; font-size: 6.6pt; overflow-wrap: break-word; }
.sig-title { font-size: 6.0pt; margin-top: 0.5px; }
.sig-date { font-size: 5.5pt; margin-top: 0.5px; }
tr, .signatures, .summary { break-inside: avoid; page-break-inside: avoid; }
</style></head><body>
<div class="report-no">${escapeHtml(reportNo)}</div>
${letterheadHtml()}
<h3>STATEMENT OF WORK ACCOMPLISHMENT</h3>
<div class="meta">
  <div class="as-of">As of <u>${escapeHtml(formatSwaAsOfLabel(data))}</u></div>
  <div class="proj-title"><strong>${projectName}</strong></div>
  <div class="proj-info">${location ? `${location} &nbsp;&bull;&nbsp; ` : ''}Contractor: <strong>${contractor}</strong> &nbsp;&bull;&nbsp; Contract amount: <strong>${contractAmountFormatted}</strong></div>
</div>
<table class="grid">
  ${
    showRevised
      ? `<colgroup>
    <col style="width: 5.0%;">
    <col style="width: 34.0%;">
    <col style="width: 5.0%;">
    <col style="width: 5.5%;">
    <col style="width: 3.5%;">
    <col style="width: 6.5%;">
    <col style="width: 4.0%;">
    <col style="width: 5.0%;">
    <col style="width: 6.5%;">
    <col style="width: 4.0%;">
    <col style="width: 5.5%;">
    <col style="width: 5.5%;">
    <col style="width: 5.5%;">
    <col style="width: 4.0%;">
    <col style="width: 5.5%;">
  </colgroup>`
      : `<colgroup>
    <col style="width: 5.2%;">
    <col style="width: 43.8%;">
    <col style="width: 6.5%;">
    <col style="width: 6.5%;">
    <col style="width: 4.0%;">
    <col style="width: 7.5%;">
    <col style="width: 4.5%;">
    <col style="width: 6.0%;">
    <col style="width: 6.0%;">
    <col style="width: 6.0%;">
    <col style="width: 4.5%;">
    <col style="width: 5.5%;">
  </colgroup>`
  }
  <thead>
    <tr>
      <th rowspan="2">ITEM NO.</th>
      <th rowspan="2">DESCRIPTION OF WORK</th>
      <th rowspan="2">PROGRAMMED QUANTITY</th>
      <th rowspan="2">UNIT PRICE</th>
      <th rowspan="2">UNIT</th>
      <th rowspan="2">CONTRACT AMOUNT</th>
      <th rowspan="2">WEIGHT %</th>
      ${showRevised ? '<th colspan="3">REVISED</th>' : ''}
      <th colspan="3">ACCOMPLISHMENT</th>
      <th rowspan="2">WEIGHT %</th>
      <th rowspan="2">REMARKS /<br>STATUS</th>
    </tr>
    <tr>
      ${showRevised ? '<th>QUANTITY</th><th>AMOUNT</th><th>WEIGHT %</th>' : ''}
      <th>PREVIOUS</th>
      <th>THIS PERIOD</th>
      <th>TO DATE</th>
    </tr>
  </thead>
  <tbody>
    ${rows}
    <tr class="total-row">
      <td colspan="5" class="center">TOTAL</td>
      <td class="right">${formatMoney(totals.totalContractAmount)}</td>
      <td class="right">${formatPct(totals.totalWeightPct)}%</td>
      ${
        showRevised
          ? `<td></td><td class="right">${formatMoney(totals.totalRevisedAmount)}</td><td class="right">${formatPct(totals.totalRevisedWeightPct)}%</td>`
          : ''
      }
      <td class="right">${totals.totalPreviousAccomplishment ? formatMoney(totals.totalPreviousAccomplishment) : ''}</td>
      <td class="right">${formatMoney(totals.totalThisAccomplishment)}</td>
      <td class="right">${formatMoney(totals.totalToDateAccomplishment)}</td>
      <td class="right">${formatPct(totals.totalToDateWeightPct)}%</td>
      <td></td>
    </tr>
  </tbody>
</table>
<table class="summary">
  <tr><td class="label">% THIS ACCOMPLISHMENT</td><td class="val">${formatPct(totals.pctThisAccomplishment)}%</td></tr>
  <tr><td class="label">TOTAL PROJECT COST</td><td class="val">P ${formatMoney(totals.totalContractAmount)}</td></tr>
  <tr><td class="label">TOTAL THIS ACCOMPLISHMENT</td><td class="val">P ${formatMoney(totals.totalThisAccomplishment)}</td></tr>
  <tr><td class="label">LESS: ${lessReason}</td><td class="val">P ${formatMoney(lessAmount)}</td></tr>
  <tr><td class="label">TOTAL VOUCHER</td><td class="val">P ${formatMoney(totals.totalVoucher)}</td></tr>
</table>
${signatureSectionHtml('SWA', report.approval_flow, data)}
</body></html>`;
}

export function buildOfficialStewaHtml(
  report: Pick<SwaStewaReport, 'report_number' | 'report_data' | 'project_name' | 'approval_flow'>,
): string {
  const data = (report.report_data ?? {}) as Record<string, unknown>;
  const projectName = escapeHtml(
    field(data, 'project_name', 'project_title') || report.project_name || '',
  );

  const asOf = field(data, 'report_date');
  const periodStart = field(data, 'period_start');
  const periodEnd = field(data, 'period_end');
  const periodHtml =
    periodStart && periodEnd
      ? `${escapeHtml(formatExcelDate(periodStart))} to<br>${escapeHtml(formatExcelDate(periodEnd))}`
      : escapeHtml(field(data, 'period_covered', 'week_covered'));
  const pct = (key: string) => {
    const raw = field(data, key);
    if (!raw) return '';
    return `${escapeHtml(stewaPercentText(raw))}%`;
  };
  const excelDate = (key: string) => {
    const raw = field(data, key);
    return escapeHtml(raw ? formatExcelDate(raw) : '');
  };

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
@page { size: 8.5in 13in; margin: 32px 42px 44px 42px; }
${SHARED_CSS}
body { font-size: 10pt; max-width: 780px; margin: 0 auto; }
table.form td.lbl { width: 52%; white-space: normal; }
table.sig-table { width: 100%; border-collapse: collapse; margin-top: 36px; }
table.sig-table td { width: 50%; text-align: center; vertical-align: top; border: none; padding: 8px 16px; font-size: 9.5pt; }
.email-footer { margin-top: 28px; font-size: 9pt; font-weight: bold; }
</style></head><body>
${letterheadHtml()}
<div class="doc-title">STATEMENT OF TIME ELAPSED AND WORK ACCOMPLISHED</div>
<div class="meta">As of <u>${escapeHtml(asOf ? formatExcelDate(asOf) : '')}</u></div>

<table class="form">
  ${formRow('Project Name', projectName, true)}
  ${formRow('Location', escapeHtml(field(data, 'location')))}
  ${formRow('Contract Amount', moneyField(data, 'contract_amount'))}
  ${formRow('Contractor', escapeHtml(field(data, 'contractor')))}
</table>

<table class="form">
  ${formRow('1. Period Covered', periodHtml)}
  ${formRow('2. Contract Duration', escapeHtml(field(data, 'contract_duration')))}
  ${formRow('3. Date of Receipt of Notice to Proceed', excelDate('notice_to_proceed'))}
  ${formRow('4. Expiry Date', excelDate('expiry_date'))}
  ${formRow('5. Approved Time Extension', escapeHtml(stewaDash(field(data, 'approved_time_extension'))))}
  ${formRow('6. Approved Time Suspension', escapeHtml(stewaDash(field(data, 'approved_time_suspension'))))}
  ${formRow('7. Total Time Extension', escapeHtml(stewaDash(field(data, 'total_time_extension'))))}
  ${formRow('8. Revised Contract Duration', escapeHtml(stewaDash(field(data, 'revised_contract_duration'))))}
  ${formRow('9. Revised Expiry Date', excelDate('revised_expiry_date'))}
  ${formRow('10. Total Calendar days Elapsed to Date', escapeHtml(field(data, 'calendar_days_elapsed')))}
  ${formRow('11. Percentage of work accomplished - Actual', pct('percent_actual'))}
  ${formRow('12. Percentage of work accomplished - Planned', pct('percent_planned'))}
  ${formRow('13. Slippage', pct('slippage'))}
  ${formRow('14. Remarks', escapeHtml(field(data, 'remarks')))}
</table>

${signatureSectionHtml('STEWA', report.approval_flow, data)}
<div class="email-footer">EMAIL: peo@cagayan.gov.ph</div>
</body></html>`;
}

export function buildOfficialIarHtml(
  report: Pick<SwaStewaReport, 'report_number' | 'report_data' | 'project_name' | 'approval_flow'>,
): string {
  const data = (report.report_data ?? {}) as Record<string, unknown>;
  const accomplishment = padRows(asRowArray(data.accomplishment_items), 10);
  const variation = padRows(asRowArray(data.variation_items), 4);
  const manpower = padRows(asRowArray(data.manpower), 4);
  const equipment = padRows(asRowArray(data.equipment), 4);

  const accomplishmentRows = accomplishment
    .map((item) => {
      const itemNo = escapeHtml(field(item, 'item_no', 'itemNo', 'snapshotItemNo'));
      const desc = escapeHtml(field(item, 'description', 'snapshotDescription'));
      const location = escapeHtml(field(item, 'location'));
      const physical = escapeHtml(field(item, 'physical_qty', 'physicalQty'));
      const billable = escapeHtml(field(item, 'billable_qty', 'billableQty'));
      const unit = escapeHtml(field(item, 'unit', 'snapshotUnit'));
      return `<tr><td>${itemNo}</td><td class="left">${desc}</td><td>${location}</td><td class="right">${physical}</td><td class="right">${billable}</td><td>${unit}</td></tr>`;
    })
    .join('');

  const variationRows = variation
    .map((item) => {
      const itemNo = escapeHtml(field(item, 'item_no', 'itemNo', 'snapshotItemNo'));
      const desc = escapeHtml(field(item, 'description', 'snapshotDescription'));
      const qty = escapeHtml(field(item, 'quantity'));
      const unit = escapeHtml(field(item, 'unit', 'snapshotUnit'));
      const additive = escapeHtml(field(item, 'additive'));
      const deductive = escapeHtml(field(item, 'deductive'));
      const newItem = escapeHtml(field(item, 'new_item', 'newItem'));
      return `<tr><td>${itemNo}</td><td class="left">${desc}</td><td class="right">${qty}</td><td>${unit}</td><td>${additive}</td><td>${deductive}</td><td>${newItem}</td></tr>`;
    })
    .join('');

  const resourceRows = (rows: Record<string, unknown>[]) =>
    rows
      .map((row) => {
        const desc = escapeHtml(String(row.description ?? ''));
        const qty = escapeHtml(String(row.quantity ?? ''));
        return `<tr><td class="left">${desc}</td><td class="right">${qty}</td></tr>`;
      })
      .join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
@page { size: 8.5in 13in; margin: 0.35in 0.4in 0.4in 0.4in; }
${SHARED_CSS}
body { font-size: 7.5pt; }
.section-lbl { font-weight: bold; font-size: 7.5pt; margin: 8px 0 2px; text-transform: uppercase; }
.two-col { width: 100%; border-collapse: collapse; margin-top: 4px; }
.two-col > tbody > tr > td { width: 50%; vertical-align: top; padding: 0 4px 0 0; border: none; }
.two-col > tbody > tr > td + td { padding: 0 0 0 4px; }
.lined-box, .problems-box { border: 1px solid #000; min-height: 40px; padding: 2px 4px; font-size: 7pt; }
.lined-box p { margin: 0 0 6px; border-bottom: 1px solid #ccc; min-height: 10px; }
.meta-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; font-size: 7.5pt; }
.meta-table td { padding: 3px 4px; vertical-align: bottom; border: none; }
.meta-table td { white-space: normal; overflow-wrap: anywhere; word-wrap: break-word; height: auto; }
.meta-table .lbl { font-weight: bold; white-space: normal; width: 1%; }
.meta-table .val { border-bottom: 1px solid #000; }
</style></head><body>
<div class="report-no">${escapeHtml(report.report_number)}</div>
${letterheadHtml()}
<div class="doc-title">INSPECTION ACCOMPLISHMENT REPORT</div>
<table class="meta-table">
  <tr>
    <td class="lbl">Contract No.:</td><td class="val">${escapeHtml(field(data, 'contract_number'))}</td>
    <td class="lbl">Municipality:</td><td class="val">${escapeHtml(field(data, 'municipality'))}</td>
  </tr>
  <tr>
    <td class="lbl">Project Title:</td>
    <td class="val" colspan="3">${escapeHtml(field(data, 'project_title', 'project_name') || report.project_name || '')}</td>
  </tr>
  <tr>
    <td class="lbl">Contractor:</td><td class="val">${escapeHtml(field(data, 'contractor'))}</td>
    <td class="lbl">Week Covered:</td><td class="val">${escapeHtml(field(data, 'week_covered', 'period_covered'))}</td>
  </tr>
  <tr>
    <td class="lbl">Date:</td><td class="val">${escapeHtml(field(data, 'report_date') ? formatExcelDate(field(data, 'report_date')) : '')}</td>
    <td class="lbl">Representative:</td><td class="val">${escapeHtml(field(data, 'contractor_representative'))}</td>
  </tr>
</table>
<table class="grid">
  <thead>
    <tr>
      <th rowspan="2">Item No.</th>
      <th rowspan="2">Description</th>
      <th rowspan="2">Location / Station</th>
      <th colspan="2">Quantity for the week</th>
      <th rowspan="2">Unit</th>
    </tr>
    <tr><th>Physical</th><th>Billable</th></tr>
  </thead>
  <tbody>${accomplishmentRows}</tbody>
</table>
<div class="section-lbl">For variation order</div>
<table class="grid">
  <thead>
    <tr>
      <th>Item No.</th><th>Description</th><th>Quantity</th><th>Unit</th>
      <th>Additive</th><th>Deductive</th><th>New Item</th>
    </tr>
  </thead>
  <tbody>${variationRows}</tbody>
</table>
<table class="two-col">
  <tr>
    <td><div class="section-lbl">Activities for the week:</div><div class="lined-box">${linedListHtml(data.activities)}</div></td>
    <td><div class="section-lbl">Field instructions:</div><div class="lined-box">${linedListHtml(data.field_instructions)}</div></td>
  </tr>
</table>
<table class="two-col">
  <tr>
    <td>
      <div class="section-lbl">Problems encountered / remarks:</div>
      <div class="problems-box">${escapeHtml(field(data, 'problems_remarks', 'remarks')).replace(/\n/g, '<br>')}</div>
    </td>
    <td>
      <div class="section-lbl" style="text-align:center">Manpower</div>
      <table class="grid"><thead><tr><th>Description</th><th>Quantity</th></tr></thead><tbody>${resourceRows(manpower)}</tbody></table>
      <div class="section-lbl" style="text-align:center">Equipment</div>
      <table class="grid"><thead><tr><th>Description</th><th>Quantity</th></tr></thead><tbody>${resourceRows(equipment)}</tbody></table>
    </td>
  </tr>
</table>
<div class="section-lbl">Weekly physical accomplishment percentage (cumulative):</div>
<table class="grid">
  <thead><tr><th>Orig. Target</th><th>Rev. Target</th><th>Actual</th><th>Variance</th><th>Remarks</th></tr></thead>
  <tbody>
    <tr>
      <td>${field(data, 'orig_target', 'percent_planned') ? `${escapeHtml(stewaPercentText(field(data, 'orig_target', 'percent_planned')))}%` : ''}</td>
      <td>${field(data, 'rev_target', 'percent_planned') ? `${escapeHtml(stewaPercentText(field(data, 'rev_target', 'percent_planned')))}%` : ''}</td>
      <td>${field(data, 'actual_progress', 'percent_complete', 'percent_actual') ? `${escapeHtml(stewaPercentText(field(data, 'actual_progress', 'percent_complete', 'percent_actual')))}%` : ''}</td>
      <td>${field(data, 'variance') ? `${escapeHtml(stewaPercentText(field(data, 'variance')))}%` : ''}</td>
      <td class="left">${escapeHtml(field(data, 'progress_remarks'))}</td>
    </tr>
  </tbody>
</table>
${signatureSectionHtml('IAR', report.approval_flow, data)}
</body></html>`;
}

/** Official print layout for SWA / STEWA / IAR (no QR). */
export function buildOfficialReportHtml(report: SwaStewaReport): string {
  if (report.report_type === 'SWA') return buildOfficialSwaHtml(report);
  if (report.report_type === 'STEWA') return buildOfficialStewaHtml(report);
  if (report.report_type === 'IAR') return buildOfficialIarHtml(report);
  return '';
}
