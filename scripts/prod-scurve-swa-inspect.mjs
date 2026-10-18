#!/usr/bin/env node
/**
 * Inspect project by name substring and list SWA reports (dates + percent).
 */
import fs from 'fs';
import path from 'path';
const repoRoot = process.cwd();
const localKey = path.resolve(repoRoot, 'construction-9dd1b-firebase-adminsdk-fbsvc-920488f9d5.json');
const adminKeyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || (fs.existsSync(localKey) ? localKey : undefined);
if (!adminKeyPath) {
  console.error('Service account key not found.');
  process.exit(2);
}
import admin from 'firebase-admin';
const key = JSON.parse(fs.readFileSync(adminKeyPath, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(key), projectId: key.project_id });
const afs = admin.firestore();

async function main() {
  const nameSub = 'Construction/Improvement/Rehabilitation of Bridges';
  const projects = await afs.collection('projects').get();
  let found = null;
  for (const p of projects.docs) {
    const d = p.data();
    if (String(d.name || '').includes(nameSub)) {
      found = { id: p.id, data: d };
      break;
    }
  }
  if (!found) {
    console.log('Project not found by name substring.');
    process.exit(0);
  }
  console.log('ProjectId:', found.id, 'name:', found.data.name);
  const reportsSnap = await afs.collection('reports').where('projectId', '==', found.id).where('reportType', '==', 'SWA').get();
  console.log('SWA reports count:', reportsSnap.size);
  const rows = reportsSnap.docs.map(d => ({ id: d.id, date: d.data().reportData?.report_date || d.data().date || null, percent: d.data().reportData?.percent_actual || d.data().reportData?.percent || d.data().percent || null, status: d.data().status }));
  rows.sort((a,b)=> String(a.date||'').localeCompare(String(b.date||'')));
  for (const r of rows) console.log(r);
}

main().catch(e=>{ console.error(e); process.exit(1); });

