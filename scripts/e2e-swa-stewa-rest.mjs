#!/usr/bin/env node
/**
 * E2E SWA and STEWA workflow tests using Identity Toolkit REST + Firestore REST.
 * Usage: node scripts/e2e-swa-stewa-rest.mjs
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

async function commitWrites(idToken, writes) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`;
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ writes }) });
  const txt = await res.text();
  if (!res.ok) throw new Error(`commit failed: ${res.status} ${txt}`);
  return JSON.parse(txt);
}

async function getDocRest(idToken, collection, docId) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getDoc failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

async function runStructuredQuery(idToken, structuredQuery) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`;
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ structuredQuery }) });
  if (!res.ok) throw new Error(`runQuery failed: ${res.status} ${await res.text()}`);
  const arr = await res.json();
  return arr.map((r) => (r.document ? r.document : null)).filter(Boolean);
}

function docName(collection, id) {
  return `projects/${PROJECT_ID}/databases/(default)/documents/${collection}/${id}`;
}

async function writeDoc(idToken, collection, docId, data) {
  const name = docName(collection, docId);
  const fields = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, toValue(v)]));
  const writes = [{ update: { name, fields } }];
  return commitWrites(idToken, writes);
}

async function deleteDocRest(idToken, collection, docId) {
  const name = docName(collection, docId);
  const writes = [{ delete: name }];
  return commitWrites(idToken, writes);
}

async function testReportFlow(reportType) {
  console.log(`\n=== Testing ${reportType} workflow ===`);
  const tokens = {};
  for (const [k, v] of Object.entries(ACCOUNTS)) {
    tokens[k] = await signIn(v.email, v.password);
  }
  const projectId = 'demo-capitol-annex';
  const reportId = `e2e-${reportType.toLowerCase()}-${Date.now()}`;
  const base = {
    reportNumber: `E2E-${reportType}-${Date.now()}`,
    projectId,
    projectName: 'Provincial Capitol Annex',
    reportType,
    reportData: { report_date: new Date().toISOString().slice(0, 10) },
    lineItems: [],
    accessUserIds: [tokens.engineer1.uid, tokens.engineer2.uid, tokens.contractor.uid],
    editUserIds: [tokens.engineer1.uid, tokens.contractor.uid],
    status: 'draft',
    approvalFlow: reportType === 'IAR' ? { currentStage: 'draft' } : null,
    createdBy: tokens.engineer1.uid,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // create document as engineer1
  await writeDoc(tokens.engineer1.idToken, 'reports', reportId, base);
  console.log('Created', reportId);

  const steps = [
    { actor: 'engineer1', name: 'submit_to_contractor', update: { status: 'pending_contractor', approvalFlow: base.approvalFlow, updatedAt: new Date().toISOString() }, expectNext: 'contractor', expectedStatus: 'pending_contractor', expectedStage: null },
    { actor: 'contractor', name: 'contractor_confirm', update: { status: 'contractor_confirmed', approvalFlow: { currentStage: 'engineer_2' }, updatedAt: new Date().toISOString() }, expectNext: 'engineer1', expectedStatus: 'contractor_confirmed', expectedStage: 'engineer_2' },
    { actor: 'engineer1', name: 'submit_for_review', update: { status: 'pending_review', approvalFlow: { currentStage: 'engineer_2' }, updatedAt: new Date().toISOString() }, expectNext: 'engineer2', expectedStatus: 'pending_review', expectedStage: 'engineer_2' },
    { actor: 'engineer2', name: 'engineer2_approve', update: { status: 'with_engineer_3', approvalFlow: { currentStage: 'engineer_3' }, updatedAt: new Date().toISOString() }, expectNext: 'engineer3', expectedStatus: 'with_engineer_3', expectedStage: 'engineer_3' },
    { actor: 'engineer3', name: 'engineer3_approve', update: { status: 'with_engineer_4', approvalFlow: { currentStage: 'engineer_4' }, updatedAt: new Date().toISOString() }, expectNext: 'engineer4', expectedStatus: 'with_engineer_4', expectedStage: 'engineer_4' },
    { actor: 'engineer4', name: 'engineer4_finalize', update: { status: 'approved', approvalFlow: { currentStage: 'engineer_4' }, updatedAt: new Date().toISOString() }, expectNext: null, expectedStatus: 'approved', expectedStage: 'engineer_4' },
  ];

  const results = [];

  // Contractor bypass check: contractor should NOT be able to set status directly to with_engineer_3
  try {
    await writeDoc(tokens.contractor.idToken, 'reports', reportId, { status: 'with_engineer_3', updatedAt: new Date().toISOString() });
    console.error('Contractor bypass: unexpectedly allowed');
    results.push({ check: 'contractor_bypass_blocked', ok: false, detail: 'write allowed' });
  } catch (err) {
    console.log('Contractor bypass blocked as expected');
    results.push({ check: 'contractor_bypass_blocked', ok: true, detail: String(err).slice(0, 200) });
  }

  // Unauthorized approval attempt: contractor trying to approve as engineer2
  try {
    await writeDoc(tokens.contractor.idToken, 'reports', reportId, { status: 'with_engineer_3', approvalFlow: { currentStage: 'engineer_3' }, updatedAt: new Date().toISOString() });
    console.error('Unauthorized approval by contractor allowed (unexpected)');
    results.push({ check: 'unauthorized_approval_rejected', ok: false });
  } catch (err) {
    console.log('Unauthorized approval rejected as expected');
    results.push({ check: 'unauthorized_approval_rejected', ok: true });
  }

  for (const s of steps) {
    console.log(`\n--- Step: ${s.name} by ${s.actor} ---`);
    const token = tokens[s.actor].idToken;
    // perform update using actor token
    try {
      // Fetch current document to merge preserved fields (email* etc) so rules' clientKeepsEmailClaim passes
      const current = await getDocRest(token, 'reports', reportId);
      let merged = {};
      if (current && current.fields) {
        // convert proto fields to plain JS
        const protoToJs = (fv) => {
          if (!fv) return null;
          if (fv.stringValue != null) return fv.stringValue;
          if (fv.integerValue != null) return Number(fv.integerValue);
          if (fv.doubleValue != null) return fv.doubleValue;
          if (fv.booleanValue != null) return fv.booleanValue;
          if (fv.nullValue !== undefined) return null;
          if (fv.mapValue != null) {
            const out = {};
            const f = fv.mapValue.fields || {};
            for (const k of Object.keys(f)) out[k] = protoToJs(f[k]);
            return out;
          }
          if (fv.arrayValue != null) {
            const vals = fv.arrayValue.values || [];
            return vals.map(protoToJs);
          }
          return null;
        };
        for (const [k, v] of Object.entries(current.fields)) {
          merged[k] = protoToJs(v);
        }
      }
      merged = { ...merged, ...s.update };
      await writeDoc(token, 'reports', reportId, merged);
      console.log('Write succeeded');
    } catch (err) {
      console.error('Write failed:', String(err).slice(0, 200));
      results.push({ step: s.name, ok: false, error: String(err) });
      break;
    }

    // verify next role can read
    if (s.expectNext) {
      const nextToken = tokens[s.expectNext].idToken;
      try {
        const doc = await getDocRest(nextToken, 'reports', reportId);
        if (!doc) throw new Error('Next role cannot read document');
        const status = doc.fields?.status?.stringValue ?? null;
        const stage = doc.fields?.approvalFlow?.mapValue?.fields?.currentStage?.stringValue ?? null;
        const okStatus = status === s.expectedStatus;
        const okStage = !s.expectedStage || stage === s.expectedStage;
        console.log('Next role read ok:', okStatus, okStage, 'status=', status, 'stage=', stage);
        results.push({ step: s.name, ok: okStatus && okStage, status, stage });
      } catch (err) {
        console.error('Next role read failed:', String(err).slice(0, 200));
        results.push({ step: s.name, ok: false, error: String(err) });
      }

      // dashboard inclusion: query by projectId + status
      try {
        const structuredQuery = {
          from: [{ collectionId: 'reports' }],
          where: {
            compositeFilter: {
              op: 'AND',
              filters: [
                { fieldFilter: { field: { fieldPath: 'projectId' }, op: 'EQUAL', value: { stringValue: projectId } } },
                { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: s.expectedStatus } } },
              ],
            },
          },
        };
        const res = await runStructuredQuery(tokens[s.expectNext].idToken, structuredQuery);
        const found = res.some((d) => d.name.endsWith(`/reports/${reportId}`) || d.name === docName('reports', reportId));
        console.log('Dashboard query found by next role:', found);
        results.push({ step: s.name + ':dashboard', ok: found });
      } catch (err) {
        console.error('Dashboard query failed:', String(err).slice(0, 200));
        results.push({ step: s.name + ':dashboard', ok: false, error: String(err) });
      }
    } else {
      // final approved visibility: any role should be able to read via getDoc
      try {
        const doc = await getDocRest(tokens.engineer1.idToken, 'reports', reportId);
        console.log('Approved doc read by engineer1 exists:', !!doc);
        results.push({ step: s.name, ok: !!doc });
      } catch (err) {
        console.error('Approved read failed:', String(err).slice(0, 200));
        results.push({ step: s.name, ok: false, error: String(err) });
      }
    }
  }

  // Cleanup: delete via admin script separately; here attempt client delete (should be allowed for engineer1 createdBy)
  try {
    await deleteDocRest(tokens.engineer1.idToken, 'reports', reportId);
    console.log('Client delete succeeded (engineer1) or allowed by rules');
  } catch (err) {
    console.warn('Client delete failed (expected for some roles):', String(err).slice(0, 200));
  }

  return results;
}

async function main() {
  const swaResults = await testReportFlow('SWA');
  const stewaResults = await testReportFlow('STEWA');
  console.log('\nSWA RESULTS:', JSON.stringify(swaResults, null, 2));
  console.log('\nSTEWA RESULTS:', JSON.stringify(stewaResults, null, 2));
  // Admin cleanup via separate script (only delete E2E- prefix)
  console.log('\nRun scripts/cleanup-e2e-reports-admin.mjs if any test reports remain.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

