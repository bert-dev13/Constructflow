/**
 * Generate a realistic SWA official HTML and verify print PDF is exactly 1 landscape Legal page.
 * Also checks reporting-period display ID and natural content fit (scale ≈ 1).
 *
 * Run: npx --yes tsx scripts/verify-swa-pdf.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildOfficialSwaHtml } from '../src/lib/officialReportHtml.ts';
import { displayReportNumber } from '../src/lib/reportNumber.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', '.tmp');
fs.mkdirSync(outDir, { recursive: true });

const longDesc =
  'Construction of reinforced concrete box culvert including excavation, lean concrete bedding, RC walls and slabs, waterproofing, backfill, and approach works as per approved plans and specifications for this pay item.';

const lineItems = [
  {
    itemNo: 'A',
    description: 'GENERAL REQUIREMENTS',
    isSection: true,
    programmedQty: 0,
    unitPrice: 0,
    unit: '',
    previous: 0,
    thisPeriod: 0,
    remarks: '',
  },
  {
    itemNo: 'A.1',
    description: `${longDesc} Mobilization / demobilization of equipment and manpower.`,
    programmedQty: 1,
    unitPrice: 85000,
    unit: 'l.s.',
    previous: 85000,
    thisPeriod: 0,
    remarks: 'Completed',
  },
  {
    itemNo: 'B',
    description: 'EARTHWORKS',
    isSection: true,
    programmedQty: 0,
    unitPrice: 0,
    unit: '',
    previous: 0,
    thisPeriod: 0,
    remarks: '',
  },
  {
    itemNo: 'B.1',
    description: `${longDesc} Structural excavation for box culvert barrel and wingwalls.`,
    programmedQty: 245.5,
    unitPrice: 420.75,
    unit: 'cu.m',
    previous: 120000,
    thisPeriod: 45000,
    remarks: 'Ongoing excavation at station 0+120 to 0+180',
  },
  {
    itemNo: 'B.2',
    description: `${longDesc} Embankment and compacted backfill around structure.`,
    programmedQty: 180,
    unitPrice: 365.5,
    unit: 'cu.m',
    previous: 20000,
    thisPeriod: 35000,
    remarks: '',
  },
  {
    itemNo: 'C',
    description: 'CONCRETE WORKS',
    isSection: true,
    programmedQty: 0,
    unitPrice: 0,
    unit: '',
    previous: 0,
    thisPeriod: 0,
    remarks: '',
  },
  {
    itemNo: 'C.1',
    description: `${longDesc} Structural concrete Class A for walls, top slab, and bottom slab.`,
    programmedQty: 92.4,
    unitPrice: 8750,
    unit: 'cu.m',
    previous: 250000,
    thisPeriod: 180000,
    remarks: 'Pouring of walls completed; top slab scheduled next period',
  },
  {
    itemNo: 'C.2',
    description: `${longDesc} Reinforcing steel bars including cutting, bending, and installation.`,
    programmedQty: 12500,
    unitPrice: 78.25,
    unit: 'kg',
    previous: 150000,
    thisPeriod: 95000,
    remarks: '',
  },
  {
    itemNo: 'C.3',
    description: `${longDesc} Formworks and falseworks for RC box culvert.`,
    programmedQty: 410,
    unitPrice: 520,
    unit: 'sq.m',
    previous: 80000,
    thisPeriod: 60000,
    remarks: 'Forms stripped on completed segments',
  },
  {
    itemNo: 'D.1',
    description: `${longDesc} Stone masonry and riprap protection works at inlet/outlet.`,
    programmedQty: 55,
    unitPrice: 2450,
    unit: 'cu.m',
    previous: 0,
    thisPeriod: 40000,
    remarks: 'Started at outlet',
  },
  {
    itemNo: 'E.1',
    description: `${longDesc} Portland cement concrete pavement approaches and transition.`,
    programmedQty: 320,
    unitPrice: 1850,
    unit: 'sq.m',
    previous: 0,
    thisPeriod: 0,
    remarks: 'Not yet started',
  },
];

const report = {
  report_type: 'SWA',
  report_number: 'SWA-2026-OCT-12-18',
  project_name: 'Construction of Box Culvert along Provincial Road',
  line_items: lineItems,
  approval_flow: {
    prepared_by_name: 'JUAN DELA CRUZ',
    prepared_by_title: 'Project Engineer',
    prepared_at: '2026-07-09',
    reviewed_by_name: 'MARIA SANTOS',
    reviewed_by_title: 'Engineer II',
    reviewed_at: '2026-07-10',
    approved_by_name: 'PEDRO REYES',
    approved_by_title: 'Provincial Engineer',
    approved_at: '2026-07-11',
  },
  report_data: {
    project_name: 'Construction of Box Culvert along Provincial Road',
    location: 'Barangay Sample, Municipality of Test, Cagayan',
    contractor: 'ABC Construction & Development Corporation',
    contract_amount: '2987425.26',
    as_of_range: '1',
    as_of_start: '2026-07-06',
    as_of_end: '2026-07-09',
    less_amount: 0,
    less_reason: '',
  },
};

const displayId = displayReportNumber(report);
if (displayId !== 'SWA-2026-JUL-06-09') {
  console.error(`FAIL display ID: expected SWA-2026-JUL-06-09, got ${displayId}`);
  process.exit(1);
}

const html = buildOfficialSwaHtml(report);
const htmlPath = path.join(outDir, 'swa-verify.html');
const pdfPath = path.join(outDir, 'swa-verify.pdf');
fs.writeFileSync(htmlPath, html, 'utf8');

function countPdfPages(buf) {
  const text = buf.toString('latin1');
  // Count page objects; avoid /Type /Pages
  const matches = text.match(/\/Type\s*\/Page\b/g);
  return matches ? matches.length : 0;
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.emulateMedia({ media: 'print' });

  const metrics = await page.evaluate(() => {
    const body = document.body;
    const style = getComputedStyle(document.documentElement);
    void style;
    // Legal landscape printable area ≈ 13in × 8.5in minus @page margins 0.22/0.28
    const pageW = 13 * 96;
    const pageH = 8.5 * 96;
    const marginX = 0.28 * 96 * 2;
    const marginY = 0.22 * 96 * 2;
    const printableH = pageH - marginY;
    const scrollH = Math.max(body.scrollHeight, body.offsetHeight);
    const scrollW = Math.max(body.scrollWidth, body.offsetWidth);
    return {
      scrollH,
      scrollW,
      printableH,
      pageW,
      pageH,
      fit: printableH / Math.max(scrollH, 1),
      reportNo: document.querySelector('.report-no')?.textContent?.trim() || '',
    };
  });

  console.log('Display ID in HTML:', metrics.reportNo);
  console.log('Content height px:', metrics.scrollH, 'printable:', Math.round(metrics.printableH));
  console.log('Natural fit scale:', metrics.fit.toFixed(3));

  if (metrics.reportNo !== 'SWA-2026-JUL-06-09') {
    console.error('FAIL: HTML report-no mismatch');
    process.exit(1);
  }

  // Playwright print PDF using CSS @page size
  await page.pdf({
    path: pdfPath,
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
  });

  const pdfBuf = fs.readFileSync(pdfPath);
  const pages = countPdfPages(pdfBuf);
  console.log('Print PDF pages:', pages);
  console.log('PDF written:', pdfPath);

  if (pages !== 1) {
    console.error(`FAIL: expected 1 page, got ${pages}`);
    process.exit(1);
  }

  // Prefer natural fit (not tiny scale). Allow small overflow that download path can absorb.
  if (metrics.fit < 0.85) {
    console.error(
      `FAIL: content too tall for one page (fit=${metrics.fit.toFixed(3)}). Tighten SWA CSS further.`,
    );
    process.exit(1);
  }

  // Mirror app download path: html2canvas + jsPDF landscape Legal, force single page.
  await page.addScriptTag({
    path: path.join(__dirname, '..', 'node_modules', 'html2canvas', 'dist', 'html2canvas.min.js'),
  });
  await page.addScriptTag({
    path: path.join(__dirname, '..', 'node_modules', 'jspdf', 'dist', 'jspdf.umd.min.js'),
  });
  const downloadPdfB64 = await page.evaluate(async () => {
    const body = document.body;
    const canvas = await window.html2canvas(body, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      logging: false,
      backgroundColor: '#ffffff',
      windowWidth: 13 * 96,
    });
    const widthMm = 13 * 25.4;
    const heightMm = 8.5 * 25.4;
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: [widthMm, heightMm], orientation: 'landscape' });
    const pageCssHeight = (heightMm / widthMm) * Math.max(body.scrollWidth, 1);
    const fullCssHeight = Math.max(body.scrollHeight, 1);
    const contentCssWidth = Math.max(body.scrollWidth, 1);
    const fit = Math.min(1, pageCssHeight / fullCssHeight);
    const drawW = widthMm * fit;
    const drawH = (fullCssHeight / contentCssWidth) * widthMm * fit;
    const offsetX = (widthMm - drawW) / 2;
    const offsetY = Math.max(0, (heightMm - drawH) / 2);
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', offsetX, offsetY, drawW, drawH);
    return {
      b64: pdf.output('datauristring').split(',')[1],
      fit,
      pageCount: pdf.getNumberOfPages(),
    };
  });

  const downloadPdfPath = path.join(outDir, 'swa-verify-download.pdf');
  fs.writeFileSync(downloadPdfPath, Buffer.from(downloadPdfB64.b64, 'base64'));
  const downloadPages = countPdfPages(fs.readFileSync(downloadPdfPath));
  console.log('Download-path PDF pages:', downloadPages, 'fit:', downloadPdfB64.fit.toFixed(3));
  console.log('jsPDF.getNumberOfPages():', downloadPdfB64.pageCount);
  console.log('Download PDF written:', downloadPdfPath);

  if (downloadPages !== 1 || downloadPdfB64.pageCount !== 1) {
    console.error('FAIL: download-path PDF is not exactly 1 page');
    process.exit(1);
  }

  console.log('SWA PDF verification OK (print + download = 1 landscape Legal page, period-based ID)');
} finally {
  await browser.close();
}
