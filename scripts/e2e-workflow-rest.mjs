#!/usr/bin/env node
/**
 * E2E workflow using Identity Toolkit REST + Firestore REST so rules are enforced.
 * Usage: node scripts/e2e-workflow-rest.mjs
 */
import fs from 'fs';
import path from 'path';

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

const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
if (!API_KEY || !PROJECT_ID) {
  console.error('Need NEXT_PUBLIC_FIREBASE_API_KEY and NEXT_PUBLIC_FIREBASE_PROJECT_ID in .env.local');
  process.exit(2);
}

const ACCOUNTS = {
  contractor: { email: 'constructflow.contractor.1@gmail.com', password: 'fortesting01' },
  engineer1: { email: 'constructflow.engineer1.1@gmail.com', password: 'engineer123' },
  engineer2: { email: 'constructflow.engineer2.1@gmail.com', password: 'engineer123' },
  engineer3: { email: 'constructflow.engineer3.1@gmail.com', password: 'engineer123' },
  engineer4: { email: 'constructflow.engineer4.1@gmail.com', password: 'engineer123' },
};

async function signIn(email, password) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(body));
  return { idToken: body.idToken, uid: body.localId };
}

function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return { integerValue: String(v) };
    return { doubleValue: v };
  }
  if (typeof v === 'object') {
    const fields = {};
    for (const [k, val] of Object.entries(v)) fields[k] = toValue(val);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

async function writeDocument(idToken, collection, docId, data) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`;
  const name = `projects/${PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`;
  const body = {
    writes: [
      {
        update: {
          name,
          fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, toValue(v)])),
        },
      },
    ],
  };
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const out = await res.text();
  if (!res.ok) throw new Error(`writeDocument failed: ${res.status} ${out}`);
  return out;
}

async function getDocument(idToken, collection, docId) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getDocument failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  return body;
}

async function deleteDocument(idToken, collection, docId) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collection}/${docId}:delete`;
  // Firestore REST doesn't expose delete as simple endpoint; use commit with delete write
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`;
  const name = `projects/${PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`;
  const body = { writes: [{ delete: name }] };
  const res = await fetch(commitUrl, { method: 'POST', headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`deleteDocument failed: ${res.status} ${await res.text()}`);
  return true;
}

async function main() {
  console.log('Signing in accounts to get tokens...');
  const tokens = {};
  for (const [k, v] of Object.entries(ACCOUNTS)) {
    const r = await signIn(v.email, v.password);
    tokens[k] = r;
    console.log(`${k} -> uid=${r.uid}`);
  }

  const reportId = `e2e-rest-${Date.now()}`;
  const projectId = 'demo-capitol-annex';
  const baseReport = {
    reportNumber: `E2E-${Date.now()}`,
    projectId,
    projectName: 'Provincial Capitol Annex',
    reportType: 'IAR',
    reportData: { report_date: new Date().toISOString().slice(0, 10) },
    lineItems: [],
    accessUserIds: [tokens.engineer1.uid, tokens.engineer2.uid, tokens.contractor.uid],
    editUserIds: [tokens.engineer1.uid, tokens.contractor.uid],
    status: 'draft',
    approvalFlow: {
      contractorConfirmation: null,
      engineer2: null,
      engineer3: null,
      engineer4: null,
      currentStage: 'draft',
      correctionCycle: 0,
      lastCorrectionReason: null,
      lastCorrectionBy: null,
      lastCorrectionRole: null,
    },
    createdBy: tokens.engineer1.uid,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  console.log('Creating report as engineer1 via REST write...');
  await writeDocument(tokens.engineer1.idToken, 'reports', reportId, baseReport);
  console.log('Created report', reportId);

  const steps = [
    { actor: 'engineer1', desc: 'submit_to_contractor', update: { status: 'pending_contractor', approvalFlow: { ...baseReport.approvalFlow, currentStage: 'contractor_confirmation' }, updatedAt: new Date().toISOString() } },
    { actor: 'contractor', desc: 'contractor_confirm', update: { status: 'contractor_confirmed', approvalFlow: { ...baseReport.approvalFlow, contractorConfirmation: { confirmedBy: tokens.contractor.uid, confirmedRole: 'contractor', confirmedAt: new Date().toISOString(), confirmsSwa: true, confirmsIar: true }, currentStage: 'engineer_2' }, updatedAt: new Date().toISOString() } },
    { actor: 'engineer1', desc: 'submit_for_review', update: { status: 'pending_review', approvalFlow: { ...baseReport.approvalFlow, contractorConfirmation: { confirmedBy: tokens.contractor.uid, confirmedRole: 'contractor', confirmedAt: new Date().toISOString(), confirmsSwa: true, confirmsIar: true }, currentStage: 'engineer_2' }, updatedAt: new Date().toISOString() } },
    { actor: 'engineer2', desc: 'engineer2_approve', update: { status: 'with_engineer_3', approvalFlow: { ...baseReport.approvalFlow, contractorConfirmation: { confirmedBy: tokens.contractor.uid, confirmedRole: 'contractor', confirmedAt: new Date().toISOString(), confirmsSwa: true, confirmsIar: true }, engineer2: { approvedBy: tokens.engineer2.uid, approvedRole: 'engineer_2', approvedAt: new Date().toISOString() }, currentStage: 'engineer_3' }, updatedAt: new Date().toISOString() } },
    { actor: 'engineer3', desc: 'engineer3_approve', update: { status: 'with_engineer_4', approvalFlow: { ...baseReport.approvalFlow, contractorConfirmation: { confirmedBy: tokens.contractor.uid, confirmedRole: 'contractor', confirmedAt: new Date().toISOString(), confirmsSwa: true, confirmsIar: true }, engineer2: { approvedBy: tokens.engineer2.uid, approvedRole: 'engineer_2', approvedAt: new Date().toISOString() }, engineer3: { approvedBy: tokens.engineer3.uid, approvedRole: 'engineer_3', approvedAt: new Date().toISOString() }, currentStage: 'engineer_4' }, updatedAt: new Date().toISOString() } },
    { actor: 'engineer4', desc: 'engineer4_finalize', update: { status: 'approved', approvalFlow: { ...baseReport.approvalFlow, contractorConfirmation: { confirmedBy: tokens.contractor.uid, confirmedRole: 'contractor', confirmedAt: new Date().toISOString(), confirmsSwa: true, confirmsIar: true }, engineer2: { approvedBy: tokens.engineer2.uid, approvedRole: 'engineer_2', approvedAt: new Date().toISOString() }, engineer3: { approvedBy: tokens.engineer3.uid, approvedRole: 'engineer_3', approvedAt: new Date().toISOString() }, engineer4: { approvedBy: tokens.engineer4.uid, approvedRole: 'engineer_4', approvedAt: new Date().toISOString() }, currentStage: 'engineer_4' }, updatedAt: new Date().toISOString() } },
  ];

  const results = [];
  for (const s of steps) {
    try {
      await writeDocument(tokens[s.actor].idToken, 'reports', reportId, { ...baseReport, ...s.update });
      console.log(`Step ${s.desc} by ${s.actor} succeeded`);
      results.push({ step: s.desc, ok: true });
    } catch (err) {
      console.error(`Step ${s.desc} by ${s.actor} FAILED:`, String(err));
      results.push({ step: s.desc, ok: false, error: String(err) });
    }
  }

  console.log('Reading final report as engineer2...');
  const final = await getDocument(tokens.engineer2.idToken, 'reports', reportId);
  console.log('Final doc exists?', Boolean(final));
  if (final) {
    const status = final.fields?.status?.stringValue ?? '(unknown)';
    console.log('Final status:', status);
  }

  console.log('Cleaning up: deleting report');
  try {
    await deleteDocument(tokens.engineer1.idToken, 'reports', reportId);
    console.log('Deleted');
  } catch (err) {
    console.warn('Delete failed:', String(err));
  }

  console.log('RESULTS:', JSON.stringify(results, null, 2));
  if (results.some((r) => !r.ok)) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

