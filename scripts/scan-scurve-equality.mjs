#!/usr/bin/env node
/**
 * Scan sCurves documents and report equality between originalPlan and currentPlan.
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
  const snaps = await afs.collection('sCurves').listDocuments();
  if (snaps.length === 0) {
    console.log('No sCurves root documents.');
    return;
  }
  const report = [];
  for (const docRef of snaps) {
    try {
      const snap = await docRef.get();
      if (!snap.exists) continue;
      const data = snap.data() || {};
      const points = data.points || [];
      if (!Array.isArray(points) || points.length === 0) continue;
      let equal = 0;
      let diff = 0;
      for (const p of points) {
        const o = p.originalPlan;
        const c = p.currentPlan;
        if (o == null && c == null) continue;
        if (o === c) equal++;
        else diff++;
      }
      report.push({ projectId: docRef.id, points: points.length, equal, diff, percentEqual: points.length ? Math.round((equal / points.length) * 10000) / 100 : 0 });
    } catch (e) {
      console.warn('error', docRef.id, e.message || e);
    }
  }
  report.sort((a, b) => b.percentEqual - a.percentEqual);
  console.log(JSON.stringify(report.slice(0, 50), null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });

