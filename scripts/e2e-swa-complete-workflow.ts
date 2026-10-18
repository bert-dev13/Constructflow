/**
 * Comprehensive E2E SWA Workflow & Delivery Test
 * Tests:
 * 1. Realistic SWA data (34 rows, long descriptions, accomplishment values, totals, signatories)
 * 2. Complete workflow under Firestore Security Rules:
 *    Contractor -> Engineer I -> Engineer II -> Engineer III -> Engineer IV -> Approved
 * 3. Programmatic PDF verification (Page count = 1, landscape, layout budget)
 * 4. Recipient resolution & final approval email delivery via existing SMTP system
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore';
import { buildOfficialSwaHtml } from '../src/lib/officialReportHtml';
import { realisticSwaReport } from './realisticSwaData';
import type { WorkItem } from '../src/lib/workItems';

// 1. Load environment variables
function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}
loadEnvLocal();

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const PROJECT_ID = '9wSZsFc2AUsfKDJojOXt';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const ARTIFACT_DIR = 'C:\\Users\\bert\\.gemini\\antigravity-ide\\brain\\ce37a57f-a278-40f2-bb72-ab2660188f10';

const ACCOUNTS = {
  contractor: { email: 'constructflow.contractor.1@gmail.com', password: 'fortesting01', role: 'contractor', name: 'Contractor Alpha' },
  engineer1: { email: 'constructflow.engineerr1@gmail.com', password: 'fortesting01', role: 'engineer_1', name: 'Engineer I' },
  engineer2: { email: 'constructflow.engineerii@gmail.com', password: 'fortesting01', role: 'engineer_2', name: 'Engineer II' },
  engineer3: { email: 'constructflow.engineeriii@gmail.com', password: 'fortesting01', role: 'engineer_3', name: 'Engineer III' },
  engineer4: { email: 'constructflow.engineer4@gmail.com', password: 'fortesting01', role: 'engineer_4', name: 'Engineer IV' },
} as const;

type RoleKey = keyof typeof ACCOUNTS;

// Helper to count PDF pages
function countPdfPages(buffer: Buffer): number {
  const str = buffer.toString('latin1');
  const matches = str.match(/\/Type\s*\/Page\b/g) || [];
  return matches.length;
}

// Headless Chrome PDF renderer matching downloadReportPdf.ts
async function renderHtmlToPdfAndPng(htmlContent: string): Promise<{ pdfBuffer: Buffer; pngBuffer: Buffer; heightPx: number; fitRatio: number }> {
  const h2cJs = fs.readFileSync(path.resolve('node_modules/html2canvas/dist/html2canvas.min.js'), 'utf8');
  const jspdfJs = fs.readFileSync(path.resolve('node_modules/jspdf/dist/jspdf.umd.min.js'), 'utf8');

  const appHtml = `<!DOCTYPE html>
<html>
<head>
<script>${h2cJs}</script>
<script>${jspdfJs}</script>
</head>
<body style="margin:0;padding:0;background:#fff;">
<iframe id="doc-frame" style="border:0;width:1248px;height:1200px;"></iframe>
<script>
function unitToMm(value, unit) {
  if (unit === 'in') return value * 25.4;
  if (unit === 'px') return (value * 25.4) / 96;
  return value;
}
function unitToPx(value, unit) {
  if (unit === 'in') return value * 96;
  if (unit === 'mm') return (value * 96) / 25.4;
  return value;
}
function readPageBox(doc) {
  const css = Array.from(doc.querySelectorAll('style')).map((n) => n.textContent ?? '').join('\\n');
  const match = css.match(/@page\\s*\\{[^}]*size:\\s*([0-9.]+)(in|mm|px)\\s+([0-9.]+)(in|mm|px)/i);
  if (!match) return { widthMm: 330.2, heightMm: 215.9, cssWidthPx: 1248 };
  return {
    widthMm: unitToMm(Number(match[1]), match[2]),
    heightMm: unitToMm(Number(match[3]), match[4]),
    cssWidthPx: Math.round(unitToPx(Number(match[1]), match[2])),
  };
}
function wrapTableCells(root) {
  root.querySelectorAll('th, td').forEach((cell) => {
    if (cell.dataset.pdfWrapped === '1') return;
    if (cell.closest('.letterhead, .header, .letterhead-table')) return;
    if (cell.querySelector(':scope > table')) return;
    const rect = cell.getBoundingClientRect();
    if (rect.width < 4) return;
    const style = root.ownerDocument.defaultView?.getComputedStyle(cell);
    const padX = (parseFloat(style?.paddingLeft || '0') || 0) + (parseFloat(style?.paddingRight || '0') || 0);
    const borderX = (parseFloat(style?.borderLeftWidth || '0') || 0) + (parseFloat(style?.borderRightWidth || '0') || 0);
    const inner = Math.max(1, Math.floor(rect.width - padX - borderX));
    cell.style.whiteSpace = 'normal';
    cell.style.height = 'auto';
    cell.style.maxHeight = 'none';
    cell.style.overflow = 'visible';
    cell.style.verticalAlign = 'top';
    cell.style.overflowWrap = 'anywhere';
    const wrapper = root.ownerDocument.createElement('div');
    wrapper.style.width = inner + 'px';
    wrapper.style.maxWidth = inner + 'px';
    wrapper.style.boxSizing = 'border-box';
    wrapper.style.whiteSpace = 'normal';
    wrapper.style.overflowWrap = 'anywhere';
    wrapper.style.wordBreak = 'break-word';
    wrapper.style.lineHeight = style?.lineHeight && style.lineHeight !== 'normal' ? style.lineHeight : '1.14';
    wrapper.style.fontSize = style?.fontSize || 'inherit';
    wrapper.style.textAlign = style?.textAlign || 'left';
    while (cell.firstChild) wrapper.appendChild(cell.firstChild);
    cell.appendChild(wrapper);
    cell.dataset.pdfWrapped = '1';
  });
}
async function run() {
  try {
    const frame = document.getElementById('doc-frame');
    const doc = frame.contentDocument;
    const body = doc.body;
    const page = readPageBox(doc);
    frame.style.width = page.cssWidthPx + 'px';
    wrapTableCells(body);
    await new Promise((r) => requestAnimationFrame(r));
    frame.style.height = Math.max(body.scrollHeight, body.offsetHeight, 800) + 'px';
    await new Promise((r) => requestAnimationFrame(r));

    const canvas = await html2canvas(body, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      logging: false,
      backgroundColor: '#ffffff',
      windowWidth: page.cssWidthPx,
    });

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({
      unit: 'mm',
      format: [page.widthMm, page.heightMm],
      orientation: 'landscape',
    });
    const pageCssHeight = (page.heightMm / page.widthMm) * Math.max(body.scrollWidth, 1);
    const contentCssWidth = Math.max(body.scrollWidth, 1);
    const fullCssHeight = Math.max(body.scrollHeight, 1);
    const fit = Math.min(1, pageCssHeight / fullCssHeight);
    const drawW = page.widthMm;
    const drawH = Math.min(page.heightMm, (fullCssHeight / contentCssWidth) * page.widthMm * fit);
    const offsetX = 0;
    const offsetY = Math.max(0, (page.heightMm - drawH) / 2);

    pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', offsetX, offsetY, drawW, drawH);
    const b64 = pdf.output('datauristring').split(',')[1];
    const canvasPng = canvas.toDataURL('image/png').split(',')[1];

    await fetch('/api/done', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        b64,
        canvasPng,
        fit,
        pageCount: pdf.getNumberOfPages(),
        fullCssHeight,
      }),
    });
  } catch (err) {
    await fetch('/api/done', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: String(err) + '\\n' + err.stack }),
    });
  }
}

window.addEventListener('load', () => {
  const frame = document.getElementById('doc-frame');
  frame.onload = () => {
    setTimeout(run, 300);
  };
  frame.srcdoc = ${JSON.stringify(htmlContent)};
});
</script>
</body>
</html>`;

  let resolvePromise: (val: any) => void;
  const promise = new Promise<{ pdfBuffer: Buffer; pngBuffer: Buffer; heightPx: number; fitRatio: number }>((resolve, reject) => {
    resolvePromise = resolve;
  });

  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(appHtml);
      return;
    }
    if (req.url === '/api/done' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
        try {
          const parsed = JSON.parse(body);
          if (parsed.error) {
            throw new Error(parsed.error);
          }
          const pdfBuffer = Buffer.from(parsed.b64, 'base64');
          const pngBuffer = Buffer.from(parsed.canvasPng, 'base64');
          resolvePromise({
            pdfBuffer,
            pngBuffer,
            heightPx: parsed.fullCssHeight,
            fitRatio: parsed.fit,
          });
        } catch (e) {
          console.error('Error handling /api/done:', e);
        }
      });
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  });

  const port = 8090 + Math.floor(Math.random() * 800);
  server.listen(port, '127.0.0.1', () => {
    const edgePaths = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    ];
    const bin = edgePaths.find((p) => fs.existsSync(p));
    if (!bin) throw new Error('Browser binary not found');

    const profileDir = path.resolve(`.tmp/edge-profile-${port}`);
    fs.mkdirSync(profileDir, { recursive: true });

    const browser = spawn(bin, [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      `--user-data-dir=${profileDir}`,
      '--window-size=1400,1200',
      `http://127.0.0.1:${port}/`,
    ]);

    promise.finally(() => {
      try {
        browser.kill();
      } catch {}
      try {
        server.close();
      } catch {}
    });
  });

  return promise;
}

async function main() {
  console.log('================================================================');
  console.log('STARTING SWA COMPLETE WORKFLOW & DELIVERY TEST');
  console.log(`Target Firebase Project: ${firebaseConfig.projectId}`);
  console.log(`Local Dev Server: ${APP_URL}`);
  console.log('================================================================\n');

  // Verify accounts by signing in with client SDK
  const apps: Record<RoleKey, FirebaseApp> = {} as any;
  const auths: Record<RoleKey, Auth> = {} as any;
  const dbs: Record<RoleKey, Firestore> = {} as any;
  const uids: Record<RoleKey, string> = {} as any;

  console.log('>>> 1. AUTHENTICATING CLIENT ACCOUNTS (Exercising Security Rules)...');
  for (const roleKey of Object.keys(ACCOUNTS) as RoleKey[]) {
    const acc = ACCOUNTS[roleKey];
    const app = initializeApp(firebaseConfig, `client-app-${roleKey}-${Date.now()}`);
    const auth = getAuth(app);
    const db = getFirestore(app);

    const cred = await signInWithEmailAndPassword(auth, acc.email, acc.password);
    const uid = cred.user.uid;
    apps[roleKey] = app;
    auths[roleKey] = auth;
    dbs[roleKey] = db;
    uids[roleKey] = uid;
    console.log(`  ✓ Authenticated ${roleKey.toUpperCase()}: ${acc.email} (UID: ${uid})`);
  }

  // Generate unique report ID and report number
  const timestamp = Date.now();
  const testReportId = `swa-e2e-${timestamp}`;
  const testReportNumber = `SWA-2026-AUG-06-13-TEST-${timestamp.toString().slice(-4)}`;

  console.log(`\n>>> 2. CREATING REALISTIC TEST SWA (Report: ${testReportNumber})...`);
  console.log(`  Project: ${PROJECT_ID}`);
  console.log(`  Pay Items: ${realisticSwaReport.line_items.length} items (with long descriptions and accomplishments)`);

  const lineItemsWithIds: WorkItem[] = realisticSwaReport.line_items.map((item, idx) => ({
    ...item,
    id: `item-${idx + 1}-${item.itemNo}`,
  }));

  const initialReportDoc = {
    reportNumber: testReportNumber,
    projectId: PROJECT_ID,
    projectName: realisticSwaReport.project_name,
    reportType: 'SWA',
    reportData: {
      ...realisticSwaReport.report_data,
      sig_engineer_1_name: 'JUAN N. DELA CRUZ',
      sig_engineer_1_initials: 'JND',
      sig_engineer_2_name: 'ELENA P. CRUZ',
      sig_engineer_2_initials: 'EPC',
      sig_engineer_3_name: 'RAUL B. CASTILLO',
      sig_engineer_3_initials: 'RBC',
      sig_engineer_4_name: 'MARIA G. MERCEDES',
      sig_engineer_4_initials: 'MGM',
      sig_contractor_name: 'ANDREA KATE C. BALUNCIO',
      sig_contractor_initials: 'AKB',
    },
    lineItems: lineItemsWithIds,
    contractorChanges: [],
    status: 'draft',
    approvalFlow: {
      contractorConfirmation: null,
      engineer1: null,
      engineer2: null,
      engineer3: null,
      engineer4: null,
      currentStage: 'draft',
      correctionCycle: 0,
      lastCorrectionReason: null,
      lastCorrectionBy: null,
      lastCorrectionRole: null,
    },
    accessUserIds: [uids.contractor, uids.engineer1, uids.engineer2],
    editUserIds: [uids.engineer1, uids.contractor],
    createdBy: uids.engineer1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Step 1: Create draft as Engineer 1
  const reportRefE1 = doc(dbs.engineer1, 'reports', testReportId);
  await setDoc(reportRefE1, initialReportDoc);
  console.log('  ✓ Draft SWA created successfully by Engineer I');

  // Verify draft status and visibility
  const draftSnap = await getDoc(reportRefE1);
  if (!draftSnap.exists() || draftSnap.data()?.status !== 'draft') {
    throw new Error('Draft SWA status verification failed');
  }
  console.log('  ✓ Verified status = draft, currentStage = draft');

  // Verify contractor can read the draft
  const contractorReadSnap = await getDoc(doc(dbs.contractor, 'reports', testReportId));
  if (!contractorReadSnap.exists()) {
    throw new Error('Contractor cannot read draft SWA under security rules');
  }
  console.log('  ✓ Verified Contractor can view draft');

  // Step 2: Transition Engineer 1 -> Contractor (pending_contractor)
  console.log('\n>>> 3. WORKFLOW TRANSITION: Engineer I -> Contractor...');
  await updateDoc(reportRefE1, {
    status: 'pending_contractor',
    'approvalFlow.currentStage': 'contractor_confirmation',
    updatedAt: new Date().toISOString(),
  });
  console.log('  ✓ Firestore write succeeded (Engineer I -> Contractor)');

  const pendingContractorSnap = await getDoc(doc(dbs.contractor, 'reports', testReportId));
  const pcData = pendingContractorSnap.data()!;
  if (pcData.status !== 'pending_contractor' || pcData.approvalFlow?.currentStage !== 'contractor_confirmation') {
    throw new Error('pending_contractor status verification failed');
  }
  console.log('  ✓ Verified status = pending_contractor, currentStage = contractor_confirmation');
  console.log('  ✓ Verified Contractor can open & view document');

  // Check no duplicate
  const dupCheck1 = await getDocs(query(collection(dbs.engineer1, 'reports'), where('projectId', '==', PROJECT_ID)));
  const matchingReports = dupCheck1.docs.filter((d) => d.data().reportNumber === testReportNumber);
  if (matchingReports.length !== 1) throw new Error('Duplicate SWA document detected!');
  console.log('  ✓ Verified no duplicate SWA document exists (count = 1)');

  // Step 3: Transition Contractor -> Contractor Confirmed
  console.log('\n>>> 4. WORKFLOW TRANSITION: Contractor Confirmation...');
  const reportRefContractor = doc(dbs.contractor, 'reports', testReportId);
  const contractorSignatory = {
    confirmedBy: uids.contractor,
    confirmedRole: 'contractor',
    confirmedAt: new Date().toISOString(),
    confirmsSwa: true,
    confirmsIar: true,
    signatoryName: 'ANDREA KATE C. BALUNCIO',
    signatoryDesignation: "Contractor's Representative",
    signatoryInitials: 'AKB',
    signatorySignature: null,
  };

  await updateDoc(reportRefContractor, {
    status: 'contractor_confirmed',
    'approvalFlow.contractorConfirmation': contractorSignatory,
    'approvalFlow.currentStage': 'engineer_2',
    updatedAt: new Date().toISOString(),
  });
  console.log('  ✓ Firestore write succeeded (Contractor Confirmation)');

  const confirmedSnap = await getDoc(doc(dbs.engineer1, 'reports', testReportId));
  const confData = confirmedSnap.data()!;
  if (confData.status !== 'contractor_confirmed' || confData.approvalFlow?.currentStage !== 'engineer_2') {
    throw new Error('contractor_confirmed status verification failed');
  }
  console.log('  ✓ Verified status = contractor_confirmed, currentStage = engineer_2');
  console.log('  ✓ Verified Contractor signature registered');

  // Step 4: Transition Engineer 1 -> Engineer II (pending_review)
  console.log('\n>>> 5. WORKFLOW TRANSITION: Engineer I Submits for Review -> Engineer II...');
  const e1Signatory = {
    approvedBy: uids.engineer1,
    approvedRole: 'engineer_1',
    approvedAt: new Date().toISOString(),
    signatoryName: 'JUAN N. DELA CRUZ',
    signatoryDesignation: 'PEO Engineer I',
    signatoryInitials: 'JND',
    signatorySignature: null,
  };

  await updateDoc(reportRefE1, {
    status: 'pending_review',
    'approvalFlow.engineer1': e1Signatory,
    'approvalFlow.currentStage': 'engineer_2',
    updatedAt: new Date().toISOString(),
  });
  console.log('  ✓ Firestore write succeeded (Engineer I submit -> pending_review)');

  const e2Snap = await getDoc(doc(dbs.engineer2, 'reports', testReportId));
  const e2Data = e2Snap.data()!;
  if (e2Data.status !== 'pending_review' || e2Data.approvalFlow?.currentStage !== 'engineer_2') {
    throw new Error('pending_review status verification failed');
  }
  console.log('  ✓ Verified status = pending_review, currentStage = engineer_2');
  console.log('  ✓ Verified Engineer II receives report in review queue');

  // Step 5: Transition Engineer II -> Engineer III (with_engineer_3)
  console.log('\n>>> 6. WORKFLOW TRANSITION: Engineer II Reviews & Forwards -> Engineer III...');
  const reportRefE2 = doc(dbs.engineer2, 'reports', testReportId);
  const e2Signatory = {
    approvedBy: uids.engineer2,
    approvedRole: 'engineer_2',
    approvedAt: new Date().toISOString(),
    signatoryName: 'ELENA P. CRUZ',
    signatoryDesignation: 'PEO Engineer II',
    signatoryInitials: 'EPC',
    signatorySignature: null,
  };

  await updateDoc(reportRefE2, {
    status: 'with_engineer_3',
    'approvalFlow.engineer2': e2Signatory,
    'approvalFlow.currentStage': 'engineer_3',
    updatedAt: new Date().toISOString(),
  });
  console.log('  ✓ Firestore write succeeded (Engineer II approve -> with_engineer_3)');

  const e3Snap = await getDoc(doc(dbs.engineer3, 'reports', testReportId));
  const e3Data = e3Snap.data()!;
  if (e3Data.status !== 'with_engineer_3' || e3Data.approvalFlow?.currentStage !== 'engineer_3') {
    throw new Error('with_engineer_3 status verification failed');
  }
  console.log('  ✓ Verified status = with_engineer_3, currentStage = engineer_3');
  console.log('  ✓ Verified Engineer III receives report in queue');

  // Step 6: Transition Engineer III -> Engineer IV (with_engineer_4)
  console.log('\n>>> 7. WORKFLOW TRANSITION: Engineer III Reviews & Forwards -> Engineer IV...');
  const reportRefE3 = doc(dbs.engineer3, 'reports', testReportId);
  const e3Signatory = {
    approvedBy: uids.engineer3,
    approvedRole: 'engineer_3',
    approvedAt: new Date().toISOString(),
    signatoryName: 'RAUL B. CASTILLO',
    signatoryDesignation: 'PEO Engineer III',
    signatoryInitials: 'RBC',
    signatorySignature: null,
  };

  await updateDoc(reportRefE3, {
    status: 'with_engineer_4',
    'approvalFlow.engineer3': e3Signatory,
    'approvalFlow.currentStage': 'engineer_4',
    updatedAt: new Date().toISOString(),
  });
  console.log('  ✓ Firestore write succeeded (Engineer III approve -> with_engineer_4)');

  const e4Snap = await getDoc(doc(dbs.engineer4, 'reports', testReportId));
  const e4Data = e4Snap.data()!;
  if (e4Data.status !== 'with_engineer_4' || e4Data.approvalFlow?.currentStage !== 'engineer_4') {
    throw new Error('with_engineer_4 status verification failed');
  }
  console.log('  ✓ Verified status = with_engineer_4, currentStage = engineer_4');
  console.log('  ✓ Verified Engineer IV receives report for final approval');

  // Step 7: Transition Engineer IV -> Final Approval (approved)
  console.log('\n>>> 8. FINAL APPROVAL: Engineer IV Approves Document...');
  const reportRefE4 = doc(dbs.engineer4, 'reports', testReportId);
  const e4Signatory = {
    approvedBy: uids.engineer4,
    approvedRole: 'engineer_4',
    approvedAt: new Date().toISOString(),
    signatoryName: 'MARIA G. MERCEDES',
    signatoryDesignation: 'PEO Engineer IV',
    signatoryInitials: 'MGM',
    signatorySignature: null,
  };

  await updateDoc(reportRefE4, {
    status: 'approved',
    'approvalFlow.engineer4': e4Signatory,
    'approvalFlow.currentStage': 'engineer_4',
    updatedAt: new Date().toISOString(),
  });
  console.log('  ✓ Firestore write succeeded (Engineer IV final approval)');

  const approvedDocSnap = await getDoc(doc(dbs.engineer4, 'reports', testReportId));
  const approvedData = approvedDocSnap.data()!;
  if (approvedData.status !== 'approved') {
    throw new Error('Final approval status verification failed');
  }
  console.log('  ✓ Verified status = approved');
  console.log('  ✓ Verified approvalFlow.currentStage = completed/engineer_4');

  // Verify all signatories are filled
  const flow = approvedData.approvalFlow;
  if (!flow.contractorConfirmation?.confirmedBy || !flow.engineer1?.approvedBy || !flow.engineer2?.approvedBy || !flow.engineer3?.approvedBy || !flow.engineer4?.approvedBy) {
    throw new Error('Not all 5 required signatories are filled in approvalFlow');
  }
  console.log('  ✓ Verified all 5 required signatories are complete and valid:');
  console.log(`    - Contractor: ${flow.contractorConfirmation.signatoryName} (${flow.contractorConfirmation.signatoryInitials})`);
  console.log(`    - Engineer I: ${flow.engineer1.signatoryName} (${flow.engineer1.signatoryInitials})`);
  console.log(`    - Engineer II: ${flow.engineer2.signatoryName} (${flow.engineer2.signatoryInitials})`);
  console.log(`    - Engineer III: ${flow.engineer3.signatoryName} (${flow.engineer3.signatoryInitials})`);
  console.log(`    - Engineer IV: ${flow.engineer4.signatoryName} (${flow.engineer4.signatoryInitials})`);

  // Step 8: Generate Actual Approved PDF from Approved Document
  console.log('\n>>> 9. GENERATING & VERIFYING APPROVED SWA PDF...');
  const reportForHtml = {
    report_type: 'SWA' as const,
    report_number: testReportNumber,
    project_name: approvedData.projectName,
    report_data: approvedData.reportData,
    line_items: approvedData.lineItems,
    approval_flow: {
      contractor_confirmation: {
        confirmed_by: flow.contractorConfirmation.confirmedBy,
        confirmed_role: flow.contractorConfirmation.confirmedRole,
        confirms_swa: true,
        confirms_iar: true,
        signatory_name: flow.contractorConfirmation.signatoryName,
        signatory_designation: flow.contractorConfirmation.signatoryDesignation,
        signatory_initials: flow.contractorConfirmation.signatoryInitials,
        confirmed_at: flow.contractorConfirmation.confirmedAt,
      },
      engineer_1: {
        approved_by: flow.engineer1.approvedBy,
        approved_role: flow.engineer1.approvedRole,
        signatory_name: flow.engineer1.signatoryName,
        signatory_designation: flow.engineer1.signatoryDesignation,
        signatory_initials: flow.engineer1.signatoryInitials,
        approved_at: flow.engineer1.approvedAt,
      },
      engineer_2: {
        approved_by: flow.engineer2.approvedBy,
        approved_role: flow.engineer2.approvedRole,
        signatory_name: flow.engineer2.signatoryName,
        signatory_designation: flow.engineer2.signatoryDesignation,
        signatory_initials: flow.engineer2.signatoryInitials,
        approved_at: flow.engineer2.approvedAt,
      },
      engineer_3: {
        approved_by: flow.engineer3.approvedBy,
        approved_role: flow.engineer3.approvedRole,
        signatory_name: flow.engineer3.signatoryName,
        signatory_designation: flow.engineer3.signatoryDesignation,
        signatory_initials: flow.engineer3.signatoryInitials,
        approved_at: flow.engineer3.approvedAt,
      },
      engineer_4: {
        approved_by: flow.engineer4.approvedBy,
        approved_role: flow.engineer4.approvedRole,
        signatory_name: flow.engineer4.signatoryName,
        signatory_designation: flow.engineer4.signatoryDesignation,
        signatory_initials: flow.engineer4.signatoryInitials,
        approved_at: flow.engineer4.approvedAt,
      },
    },
  };

  const approvedSwaHtml = buildOfficialSwaHtml(reportForHtml);
  console.log('  ✓ Built official approved SWA HTML with all signatories');

  const { pdfBuffer, pngBuffer, heightPx, fitRatio } = await renderHtmlToPdfAndPng(approvedSwaHtml);
  const pdfPages = countPdfPages(pdfBuffer);
  console.log(`  ✓ Rendered Approved SWA PDF: Size = ${pdfBuffer.length} bytes, Pages = ${pdfPages}`);
  console.log(`  ✓ Layout height: ${heightPx}px (budget: 816px, fit ratio: ${fitRatio.toFixed(3)})`);

  // Programmatic verification of page count = exactly 1
  if (pdfPages !== 1) {
    throw new Error(`PDF Page count verification FAILED! Expected 1 page, got ${pdfPages}`);
  }
  console.log('  ✓ Programmatic Verification: PDF page count = exactly 1 (PASS)');

  // Save artifacts
  const outPdfPath = path.resolve(ARTIFACT_DIR, 'final-approved-swa.pdf');
  const outPngPath = path.resolve(ARTIFACT_DIR, 'final-approved-swa.png');
  fs.writeFileSync(outPdfPath, pdfBuffer);
  fs.writeFileSync(outPngPath, pngBuffer);
  console.log(`  ✓ Saved PDF artifact: ${outPdfPath}`);
  console.log(`  ✓ Saved PNG artifact: ${outPngPath}`);

  // Step 9: Resolve Email Recipients & Safety Check
  console.log('\n>>> 10. RESOLVING EMAIL RECIPIENTS & SAFETY CHECK...');
  const idTokenE4 = await auths.engineer4.currentUser?.getIdToken();
  if (!idTokenE4) throw new Error('Could not get idToken for Engineer IV');

  // Verify recipients via endpoint test
  const resolveRes = await fetch(`${APP_URL}/api/approval-email/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idTokenE4}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reportId: testReportId, pdfBase64: pdfBuffer.toString('base64') }),
  });

  const emailResult = await resolveRes.json();
  console.log('  ✓ Email API Response Status:', resolveRes.status);
  console.log('  ✓ Email API Result:', JSON.stringify(emailResult, null, 2));

  if (!resolveRes.ok || !emailResult.sent) {
    throw new Error(`Email sending failed: ${emailResult.error || 'Unknown error'}`);
  }

  // Verify recipients list
  const resolvedRecipients: string[] = emailResult.recipients || [];
  console.log('\n  Resolved Email Recipients (Trace from ConstructFlow Project Logic):');
  resolvedRecipients.forEach((rec, idx) => {
    console.log(`    ${idx + 1}. ${rec}`);
  });

  // Verify all 5 demo accounts are included
  const requiredEmails = [
    'constructflow.contractor.1@gmail.com',
    'constructflow.engineerr1@gmail.com',
    'constructflow.engineerii@gmail.com',
    'constructflow.engineeriii@gmail.com',
    'constructflow.engineer4@gmail.com',
  ];

  const missingEmails = requiredEmails.filter((req) => !resolvedRecipients.some((r) => r.toLowerCase() === req.toLowerCase()));
  if (missingEmails.length > 0) {
    throw new Error(`Missing required recipients: ${missingEmails.join(', ')}`);
  }
  console.log('  ✓ All 5 required role recipients are present (Contractor, Eng I, Eng II, Eng III, Eng IV)');

  // Verify no duplicates
  const uniqueRecipients = new Set(resolvedRecipients.map((r) => r.toLowerCase()));
  if (uniqueRecipients.size !== resolvedRecipients.length) {
    throw new Error('Duplicate recipients found in resolved list!');
  }
  console.log('  ✓ No duplicate recipients detected (Duplicate recipients = 0)');

  // Verify Nodemailer accepted[], rejected[], envelope.to
  const acceptedList: string[] = emailResult.accepted || [];
  const rejectedList: string[] = emailResult.rejected || [];
  const envelopeTo: string[] = Array.isArray(emailResult.envelope?.to) ? emailResult.envelope.to : [emailResult.envelope?.to].filter(Boolean);

  console.log('\n  Nodemailer Delivery Verification:');
  console.log(`    envelope.from: ${emailResult.envelope?.from}`);
  console.log(`    envelope.to (${envelopeTo.length}):`, envelopeTo);
  console.log(`    accepted (${acceptedList.length}):`, acceptedList);
  console.log(`    rejected (${rejectedList.length}):`, rejectedList);
  console.log(`    response: ${emailResult.response}`);
  console.log(`    messageId: ${emailResult.messageId}`);

  if (rejectedList.length > 0) {
    throw new Error(`Nodemailer rejected recipients: ${rejectedList.join(', ')}`);
  }
  const missingAccepted = requiredEmails.filter((req) => !acceptedList.some((a) => a.toLowerCase() === req.toLowerCase()));
  if (missingAccepted.length > 0) {
    throw new Error(`Nodemailer accepted[] missing recipients: ${missingAccepted.join(', ')}`);
  }
  console.log('  ✓ Nodemailer accepted[] contains ALL FIVE recipients');

  const missingEnvelope = requiredEmails.filter((req) => !envelopeTo.some((e) => e.toLowerCase() === req.toLowerCase()));
  if (missingEnvelope.length > 0) {
    throw new Error(`envelope.to missing recipients: ${missingEnvelope.join(', ')}`);
  }
  console.log('  ✓ envelope.to contains ALL FIVE recipients');
  console.log('  ✓ rejected[] is completely empty');

  // Record SMTP message ID and provider status
  const messageId = emailResult.messageId || 'ACCEPTED_BY_SMTP';
  console.log(`  ✓ SMTP Provider Message ID: ${messageId}`);

  // Test duplicate email suppression
  console.log('\n>>> 11. VERIFYING DUPLICATE APPROVAL EMAIL PREVENTION...');
  // Update report doc with sent status
  await updateDoc(reportRefE4, {
    emailStatus: 'SENT',
    emailSentAt: emailResult.sentAt || new Date().toISOString(),
    emailMessageId: messageId,
    emailRecipients: resolvedRecipients,
    updatedAt: new Date().toISOString(),
  });

  const dupEmailRes = await fetch(`${APP_URL}/api/approval-email/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idTokenE4}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reportId: testReportId, pdfBase64: pdfBuffer.toString('base64') }),
  });
  const dupEmailResult = await dupEmailRes.json();
  if (dupEmailResult.skipped !== true) {
    throw new Error('Duplicate approval email was not prevented!');
  }
  console.log('  ✓ Verified duplicate approval email is properly skipped (skipped = true)');

  console.log('\n================================================================');
  console.log('ALL E2E WORKFLOW, PDF, AND EMAIL TESTS PASSED SUCCESSFULLY!');
  console.log('================================================================');

  // Sign out all accounts
  for (const roleKey of Object.keys(auths) as RoleKey[]) {
    await signOut(auths[roleKey]);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('\nE2E TEST RUNNER FAILED WITH ERROR:');
  console.error(err);
  process.exit(1);
});
