#!/usr/bin/env node
/**
 * Seed pay items (DPWH catalog) into Firestore using Admin SDK.
 * - Reads src/data/boq/catalog.json
 * - Writes documents to payItems collection with id `dpwh_{normalizedItemNo}`
 * - Safe to re-run: skips items already present.
 */
import fs from 'node:fs';
import path from 'node:path';
const repoRoot = process.cwd();
const catalogPath = path.join(repoRoot, 'src', 'data', 'boq', 'catalog.json');
if (!fs.existsSync(catalogPath)) {
  console.error('Catalog not found at', catalogPath);
  process.exit(2);
}
const rows = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

const localKey = path.resolve(repoRoot, 'construction-9dd1b-firebase-adminsdk-fbsvc-920488f9d5.json');
const adminKeyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || (fs.existsSync(localKey) ? localKey : undefined);
if (!adminKeyPath) {
  console.error('Service account key not found. Set GOOGLE_APPLICATION_CREDENTIALS or place key at', localKey);
  process.exit(2);
}
import admin from 'firebase-admin';
const key = JSON.parse(fs.readFileSync(adminKeyPath, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(key), projectId: key.project_id });
const db = admin.firestore();

function normalizePayItemNo(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, '').replace(/[.()[\]{}-]/g, '');
}

async function existingNormalizedSet() {
  const snap = await db.collection('payItems').get();
  return new Set(snap.docs.map((d) => String(d.data().normalizedItemNo ?? '').trim()));
}

(async function main() {
  const exist = await existingNormalizedSet();
  const timestamp = new Date().toISOString();
  const toWrite = [];
  for (const row of rows) {
    const itemNo = String(row.itemNo ?? '').trim();
    const description = String(row.description ?? '').trim();
    const unit = String(row.unit ?? '—').trim() || '—';
    if (!itemNo || !description) continue;
    const normalized = normalizePayItemNo(itemNo);
    if (!normalized) continue;
    if (exist.has(normalized)) continue;
    toWrite.push({ itemNo, description, unit, normalized });
  }
  console.log('Will add', toWrite.length, 'items');
  const batchSize = 400;
  let added = 0;
  for (let i = 0; i < toWrite.length; i += batchSize) {
    const batch = db.batch();
    const slice = toWrite.slice(i, i + batchSize);
    for (const it of slice) {
      const id = `dpwh_${it.normalized}`;
      const ref = db.collection('payItems').doc(id);
      batch.set(ref, {
        itemNo: it.itemNo,
        normalizedItemNo: it.normalized,
        description: it.description,
        unit: it.unit,
        active: true,
        version: 1,
        uniquenessKey: `${it.normalized}::v1`,
        source: 'DO 143 s. 2017',
        createdAt: timestamp,
        updatedAt: timestamp,
      }, { merge: false });
    }
    await batch.commit();
    added += slice.length;
    console.log('Wrote', added, '/', toWrite.length);
  }
  console.log('Done. added', added);
  process.exit(0);
})().catch((e)=>{ console.error(e); process.exit(1); });

