/**
 * Print realistic IAR and STEWA official documents and require exactly one
 * portrait 8.5in × 13in page each.
 *
 * Run: npx tsx scripts/verify-iar-stewa-pdf.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOfficialIarHtml, buildOfficialStewaHtml } from '../src/lib/officialReportHtml.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', '.tmp');
fs.mkdirSync(outDir, { recursive: true });

const chrome =
  process.env.CHROME_PATH ||
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';

const desc =
  'Structural concrete Class A including forms, rebar placement, and curing for the box culvert barrel';

function acc(n, location) {
  return {
    item_no: `10${n}(1)`,
    description: `${desc} — item ${n}.`,
    location,
    physical_qty: '12.50',
    billable_qty: '11.25',
    unit: 'cu.m.',
  };
}

const iarHtml = buildOfficialIarHtml({
  report_number: 'IAR-2026-OCT-13-19',
  project_name: 'Construction of Box Culvert along Provincial Road',
  approval_flow: {
    engineer_1: {
      approved_by: 'u1',
      approved_role: 'engineer_1',
      approved_at: '2026-10-19T00:00:00.000Z',
      signatory_name: 'Juan Dela Cruz',
      signatory_initials: 'JD',
      signatory_designation: 'PEO Engineer I',
    },
    engineer_2: {
      approved_by: 'u2',
      approved_role: 'engineer_2',
      approved_at: '2026-10-19T00:00:00.000Z',
      signatory_name: 'Maria Santos',
      signatory_initials: 'MS',
      signatory_designation: 'PEO Engineer II',
    },
    engineer_3: {
      approved_by: 'u3',
      approved_role: 'engineer_3',
      approved_at: '2026-10-19T00:00:00.000Z',
      signatory_name: 'Pedro Reyes',
      signatory_initials: 'PR',
      signatory_designation: 'PEO Engineer III',
    },
    engineer_4: {
      approved_by: 'u4',
      approved_role: 'engineer_4',
      approved_at: '2026-10-19T00:00:00.000Z',
      signatory_name: 'Ana Villanueva',
      signatory_initials: 'AV',
      signatory_designation: 'PEO Engineer IV',
    },
    contractor_confirmation: {
      confirmed_by: 'c1',
      confirmed_role: 'contractor',
      confirmed_at: '2026-10-19T00:00:00.000Z',
      signatory_name: 'Jose Cruz',
      signatory_initials: 'JC',
      signatory_designation: "Contractor's Representative",
    },
  },
  report_data: {
    contract_number: 'INFRA-2026-014',
    municipality: 'Tuguegarao City',
    project_title: 'Construction of Reinforced Concrete Box Culvert along the Provincial Road, Barangay Carig',
    contractor: 'ABC Construction and Development Corporation',
    week_covered: 'October 13–19, 2026',
    report_date: '2026-10-19',
    contractor_representative: 'Jose Cruz',
    accomplishment_items: [
      acc(1, 'Sta. 0+120 – 0+180, left barrel'),
      acc(2, 'Sta. 0+180 – 0+240, right barrel'),
      acc(3, 'Sta. 0+240 – 0+300, wingwall'),
      acc(4, 'Sta. 0+080 – 0+120, inlet'),
      acc(5, 'Sta. 0+300 – 0+360, outlet'),
      acc(6, 'Sta. 0+000 – 0+080, approach'),
      acc(7, 'Sta. 0+360 – 0+420, riprap'),
      acc(8, 'Sta. 0+420 – 0+480, pavement'),
      acc(9, 'Sta. 0+480 – 0+540, shoulder'),
      acc(10, 'Sta. 0+540 – 0+600, slope protection'),
    ],
    variation_items: [
      {
        item_no: '103(2)',
        description: 'Additional structural excavation for the revised wingwall footing.',
        quantity: '18.00',
        unit: 'cu.m.',
        additive: 'Yes',
        deductive: '',
        new_item: '',
      },
      {
        item_no: '405(1)',
        description: 'Extra reinforcing steel for the thickened top slab.',
        quantity: '420',
        unit: 'kg',
        additive: 'Yes',
        deductive: '',
        new_item: '',
      },
      {
        item_no: '506',
        description: 'Stone masonry deleted at the original outlet alignment.',
        quantity: '6.50',
        unit: 'cu.m.',
        additive: '',
        deductive: 'Yes',
        new_item: '',
      },
      {
        item_no: '611',
        description: 'New item for geotextile filter under the riprap apron.',
        quantity: '85',
        unit: 'sq.m.',
        additive: '',
        deductive: '',
        new_item: 'Yes',
      },
    ],
    activities: [
      'Completed wall pours at stations 0+120 to 0+240.',
      'Installed reinforcing steel for the top slab of the left barrel.',
      'Stripped forms on the cured wall segments and cured the new pours.',
      'Placed lean concrete bedding at the revised outlet apron.',
    ],
    field_instructions: [
      'Maintain the approved concrete mix and slump before each pour.',
      'Protect fresh concrete from rain and keep it continuously wet for seven days.',
      'Do not backfill against walls until the cylinder breaks meet the required strength.',
    ],
    problems_remarks:
      'Two afternoon rain showers delayed the top-slab pour by half a day. The batch plant delivered late on Wednesday, so the remaining wall segment was rescheduled to Thursday morning.',
    manpower: [
      { description: 'Foreman', quantity: '1' },
      { description: 'Skilled mason', quantity: '4' },
      { description: 'Steelman', quantity: '6' },
      { description: 'Laborer', quantity: '12' },
      { description: 'Equipment operator', quantity: '2' },
    ],
    equipment: [
      { description: 'Concrete mixer, 1-bagger', quantity: '2' },
      { description: 'Vibrator', quantity: '2' },
      { description: 'Backhoe', quantity: '1' },
      { description: 'Dump truck', quantity: '2' },
    ],
    orig_target: '18.40',
    rev_target: '16.10',
    actual_progress: '14.72',
    variance: '-1.38',
    progress_remarks: 'Slightly behind the revised target because of weather.',
    sig_engineer_1_name: 'Juan Dela Cruz',
    sig_engineer_2_name: 'Maria Santos',
    sig_engineer_3_name: 'Pedro Reyes',
    sig_engineer_4_name: 'Ana Villanueva',
    sig_contractor_name: 'Jose Cruz',
  },
});

const stewaHtml = buildOfficialStewaHtml({
  report_number: 'STEWA-2026-JAN-04-AUG-21',
  project_name: 'Construction of Box Culvert along Provincial Road',
  approval_flow: {
    engineer_1: {
      approved_by: 'u1',
      approved_role: 'engineer_1',
      approved_at: '2026-08-21T00:00:00.000Z',
      signatory_name: 'Juan Dela Cruz',
      signatory_initials: 'JD',
      signatory_designation: 'Engineer I',
    },
    engineer_2: {
      approved_by: 'u2',
      approved_role: 'engineer_2',
      approved_at: '2026-08-21T00:00:00.000Z',
      signatory_name: 'Maria Santos',
      signatory_initials: 'MS',
      signatory_designation: 'Engineer II',
    },
    engineer_3: {
      approved_by: 'u3',
      approved_role: 'engineer_3',
      approved_at: '2026-08-21T00:00:00.000Z',
      signatory_name: 'Pedro Reyes',
      signatory_initials: 'PR',
      signatory_designation: 'Engineer III',
    },
    engineer_4: {
      approved_by: 'u4',
      approved_role: 'engineer_4',
      approved_at: '2026-08-21T00:00:00.000Z',
      signatory_name: 'Ana Villanueva',
      signatory_initials: 'AV',
      signatory_designation: 'Engineer IV',
    },
    contractor_confirmation: {
      confirmed_by: 'c1',
      confirmed_role: 'contractor',
      confirmed_at: '2026-08-21T00:00:00.000Z',
      signatory_name: 'Jose Cruz',
      signatory_initials: 'JC',
      signatory_designation: "Contractor's Representative",
    },
  },
  report_data: {
    project_name: 'Construction of Reinforced Concrete Box Culvert along the Provincial Road',
    location: 'Barangay Carig, Tuguegarao City, Cagayan',
    contract_amount: '2987425.26',
    contractor: 'ABC Construction and Development Corporation',
    report_date: '2026-08-21',
    period_start: '2026-01-04',
    period_end: '2026-08-21',
    contract_duration: '180 calendar days',
    notice_to_proceed: '2026-01-04',
    expiry_date: '2026-07-03',
    approved_time_extension: '15 calendar days',
    approved_time_suspension: '21 calendar days',
    total_time_extension: '15 calendar days',
    revised_contract_duration: '195 calendar days',
    revised_expiry_date: '2026-08-08',
    calendar_days_elapsed: '229',
    percent_actual: '42.18',
    percent_planned: '48.60',
    slippage: '-6.42',
    remarks:
      'Actual accomplishment is behind the planned sine curve because work stopped during the recorded suspension and rain delayed the top-slab pours after resumption.',
    sig_engineer_1_name: 'Juan Dela Cruz',
    sig_engineer_2_name: 'Maria Santos',
    sig_engineer_3_name: 'Pedro Reyes',
    sig_engineer_4_name: 'Ana Villanueva',
    sig_contractor_name: 'Jose Cruz',
  },
});

const docs = [
  {
    name: 'IAR',
    html: iarHtml,
    required: [
      'INSPECTION ACCOMPLISHMENT REPORT',
      'IAR-2026-OCT-13-19',
      'INFRA-2026-014',
      'Tuguegarao City',
      'ABC Construction and Development Corporation',
      'October 13–19, 2026',
      '101(1)',
      '1010(1)',
      'For variation order',
      '103(2)',
      '611',
      'Completed wall pours',
      'Maintain the approved concrete mix',
      'Two afternoon rain showers',
      'Foreman',
      'Concrete mixer',
      '14.72%',
      'Slightly behind the revised target',
      'Prepared by:',
      'Approved by:',
      'Ana Villanueva',
      'Jose Cruz',
    ],
  },
  {
    name: 'STEWA',
    html: stewaHtml,
    required: [
      'STATEMENT OF TIME ELAPSED AND WORK ACCOMPLISHED',
      'STEWA-2026-JAN-04-AUG-21',
      'January 04, 2026',
      'August 21, 2026',
      'Barangay Carig',
      '180 calendar days',
      '42.18%',
      '48.60%',
      '-6.42%',
      'Actual accomplishment is behind',
      'Submitted by:',
      'Approved:',
      'peo@cagayan.gov.ph',
      'Juan Dela Cruz',
      'Jose Cruz',
    ],
  },
];

function countPdfPages(buf) {
  const text = buf.toString('latin1');
  return (text.match(/\/Type\s*\/Page\b/g) || []).length;
}

function mediaBoxInches(buf) {
  const text = buf.toString('latin1');
  const match = text.match(/\/MediaBox\s*\[\s*0\s+0\s+([0-9.]+)\s+([0-9.]+)\s*\]/);
  if (!match) return null;
  return { widthIn: Number(match[1]) / 72, heightIn: Number(match[2]) / 72 };
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.next = 1;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      ws.addEventListener('open', () => resolve(undefined));
      ws.addEventListener('error', () => reject(new Error('Chrome debugging socket failed.')));
    });
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = this.next++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }
}

async function waitForVersion(port) {
  const started = Date.now();
  while (Date.now() - started < 20000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return response.json();
    } catch {
      /* chrome is still starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Chrome debugging port did not open.');
}

async function inspect(htmlPath) {
  const port = 9333 + Math.floor(Math.random() * 400);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-pdf-'));
  const proc = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${port}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  try {
    const version = await waitForVersion(port);
    const browser = new Cdp(new WebSocket(version.webSocketDebuggerUrl));
    const { targetId } = await browser.send('Target.createTarget', {
      url: `file:///${htmlPath.replace(/\\/g, '/')}`,
    });
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = targets.find((target) => target.id === targetId);
    if (!page?.webSocketDebuggerUrl) throw new Error('Print target was not created.');
    const session = new Cdp(new WebSocket(page.webSocketDebuggerUrl));
    await session.send('Page.enable');
    await session.send('Emulation.setDeviceMetricsOverride', {
      width: 816,
      height: 1248,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await session.send('Emulation.setEmulatedMedia', { media: 'print' });
    await session.send('Page.navigate', { url: `file:///${htmlPath.replace(/\\/g, '/')}` });
    await new Promise((resolve) => setTimeout(resolve, 800));
    const metrics = await session.send('Runtime.evaluate', {
      expression: `(() => {
        const body = document.body;
        const pageH = 13 * 96;
        const pageW = 8.5 * 96;
        const sizes = [...document.querySelectorAll('body *')]
          .map((el) => parseFloat(getComputedStyle(el).fontSize))
          .filter((n) => Number.isFinite(n) && n > 0);
        const overflow = [...document.querySelectorAll('td, th, .sig, .lined-box, .problems-box, .doc-title, .meta')].filter((el) => {
          return el.scrollWidth > el.clientWidth + 4 || el.scrollHeight > el.clientHeight + 4;
        }).slice(0, 8).map((el) => (el.innerText || el.className || el.tagName).replace(/\\s+/g, ' ').slice(0, 70));
        return {
          scrollH: Math.max(body.scrollHeight, body.offsetHeight),
          scrollW: Math.max(body.scrollWidth, body.offsetWidth),
          pageH,
          pageW,
          minFontPx: sizes.length ? Math.min(...sizes) : 0,
          overflow,
          text: body.innerText.slice(0, 4000),
        };
      })()`,
      returnByValue: true,
    });
    const printed = await session.send('Page.printToPDF', {
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      marginRight: 0,
    });
    const shot = await session.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
    });
    session.ws.close();
    browser.ws.close();
    return {
      metrics: metrics.result.value,
      pdf: Buffer.from(printed.data, 'base64'),
      png: Buffer.from(shot.data, 'base64'),
    };
  } finally {
    proc.kill();
    await new Promise((resolve) => setTimeout(resolve, 300));
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {
      /* Chrome may still hold the temporary profile. */
    }
  }
}

let failed = false;
for (const doc of docs) {
  for (const phrase of doc.required) {
    if (!doc.html.includes(phrase)) {
      console.error(`${doc.name} missing content: ${phrase}`);
      failed = true;
    }
  }
  const sealDir = path.join(__dirname, '..', 'public', 'img').replace(/\\/g, '/');
  const html = doc.html
    .replaceAll('src="/img/pgc.jpg"', `src="file:///${sealDir}/pgc.jpg"`)
    .replaceAll('src="/img/peo.webp"', `src="file:///${sealDir}/peo.webp"`);
  const htmlPath = path.join(outDir, `${doc.name.toLowerCase()}-verify.html`);
  const pdfPath = path.join(outDir, `${doc.name.toLowerCase()}-verify.pdf`);
  fs.writeFileSync(htmlPath, html, 'utf8');
  const { metrics, pdf, png } = await inspect(htmlPath);
  fs.writeFileSync(pdfPath, pdf);
  fs.writeFileSync(path.join(outDir, `${doc.name.toLowerCase()}-verify.png`), png);
  const pages = countPdfPages(pdf);
  const box = mediaBoxInches(pdf);
  const minPt = metrics.minFontPx / (96 / 72);
  console.log(doc.name, {
    pages,
    paper: box ? `${box.widthIn.toFixed(2)}in x ${box.heightIn.toFixed(2)}in` : 'unknown',
    scrollH: metrics.scrollH,
    pageH: metrics.pageH,
    minFontPx: Number(metrics.minFontPx.toFixed(2)),
    minFontPt: Number(minPt.toFixed(2)),
    overflow: metrics.overflow,
    pdf: pdfPath,
  });
  const portrait = box && box.heightIn > box.widthIn;
  const bond =
    box &&
    Math.abs(box.widthIn - 8.5) < 0.08 &&
    Math.abs(box.heightIn - 13) < 0.08;
  if (pages !== 1 || !portrait || !bond || metrics.overflow.length || minPt < 6.4) {
    console.error(`${doc.name} FAIL`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log('IAR and STEWA PDF verification OK');
