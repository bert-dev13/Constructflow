#!/usr/bin/env node
/**
 * Cleanup reports created by E2E runs (reportNumber starting with E2E-)
 */
import fs from 'fs';
import path from 'path';
const repoRoot = process.cwd();
const localKey = path.resolve(repoRoot, 'construction-9dd1b-firebase-adminsdk-fbsvc-920488f9d5.json');
const adminKeyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || (fs.existsSync(localKey) ? localKey : undefined);
if (!adminKeyPath) {
  console.error('Service account key not found. Set GOOGLE_APPLICATION_CREDENTIALS or place service account JSON at', localKey);
  process.exit(2);
}
import admin from 'firebase-admin';
const key = JSON.parse(fs.readFileSync(adminKeyPath, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(key), projectId: key.project_id });
const afs = admin.firestore();

(async function main(){
  const snaps = await afs.collection('reports').where('reportNumber', '>=', 'E2E-').where('reportNumber', '<=', 'E2E-\uf8ff').get();
  console.log('Found', snaps.size, 'E2E reports to delete');
  for (const d of snaps.docs) {
    console.log('Deleting', d.id, d.data().reportNumber);
    await d.ref.delete();
  }
  console.log('Cleanup complete');
  process.exit(0);
})().catch((e)=>{ console.error(e); process.exit(1); });

