#!/usr/bin/env node
/*
 * Delete project documents and related records from Firestore using the Admin SDK.
 *
 * Usage:
 *   - Dry run (lists projects and counts):     node scripts/delete-projects-admin.mjs
 *   - Actual delete (must confirm):           CONFIRM_DELETE=YES node scripts/delete-projects-admin.mjs
 *   - Provide explicit project ids:            CONFIRM_DELETE=YES node scripts/delete-projects-admin.mjs proj1 proj2
 *
 * Safety:
 *  - Requires a service account via GOOGLE_APPLICATION_CREDENTIALS or the repo-local
 *    service account file named "construction-9dd1b-firebase-adminsdk-fbsvc-920488f9d5.json".
 *  - Will NOT touch Authentication users or the `users` collection.
 *  - By default runs in dry-run mode unless CONFIRM_DELETE=YES is set.
 */
import fs from 'node:fs';
import path from 'node:path';

const confirm = String(process.env.CONFIRM_DELETE || '').toUpperCase() === 'YES';
const projectArgs = process.argv.slice(2);

// Resolve admin credentials: env var or repo-local file
const localKey = path.resolve(process.cwd(), 'construction-9dd1b-firebase-adminsdk-fbsvc-920488f9d5.json');
const adminKeyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || (fs.existsSync(localKey) ? localKey : undefined);
if (!adminKeyPath) {
  console.error('Service account not found. Set GOOGLE_APPLICATION_CREDENTIALS or place the JSON at', localKey);
  process.exit(2);
}

import admin from 'firebase-admin';
const key = JSON.parse(fs.readFileSync(adminKeyPath, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(key), projectId: key.project_id });
const db = admin.firestore();

async function listAllProjectIds() {
  const snap = await db.collection('projects').get();
  return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
}

async function deleteReportsForProject(projectId) {
  const q = db.collection('reports').where('projectId', '==', projectId);
  const snap = await q.get();
  if (snap.empty) return 0;
  const batchSize = 500;
  let deleted = 0;
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = db.batch();
    const slice = docs.slice(i, i + batchSize);
    slice.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += slice.length;
  }
  return deleted;
}

async function deleteProjectAndRelated(projectId) {
  // delete reports
  const reportsDeleted = await deleteReportsForProject(projectId);
  // delete schedule document
  const scheduleRef = db.collection('schedules').doc(projectId);
  const scheduleSnap = await scheduleRef.get();
  if (scheduleSnap.exists) await scheduleRef.delete();
  // delete project doc
  const projectRef = db.collection('projects').doc(projectId);
  const projectSnap = await projectRef.get();
  if (projectSnap.exists) await projectRef.delete();
  return { reportsDeleted, scheduleDeleted: !!scheduleSnap.exists, projectDeleted: !!projectSnap.exists };
}

async function main() {
  const all = await listAllProjectIds();
  const targetIds = projectArgs.length > 0 ? projectArgs : all.map((p) => p.id);

  console.log('Found projects:', all.map((p) => p.id));
  console.log('Targeting projects for deletion:', targetIds);
  if (!confirm) {
    console.log('\nDry run mode (no deletions). To execute deletions set CONFIRM_DELETE=YES and re-run.');
    // show counts per target
    for (const id of targetIds) {
      const reportCount = (await db.collection('reports').where('projectId', '==', id).get()).size;
      const scheduleExists = (await db.collection('schedules').doc(id).get()).exists;
      console.log(`- ${id}: reports=${reportCount}, schedule=${scheduleExists}`);
    }
    return;
  }

  console.log('\nCONFIRMED: performing deletions...');
  for (const id of targetIds) {
    try {
      const res = await deleteProjectAndRelated(id);
      console.log(`Deleted project ${id}: projectDeleted=${res.projectDeleted}, scheduleDeleted=${res.scheduleDeleted}, reportsDeleted=${res.reportsDeleted}`);
    } catch (err) {
      console.error(`Error deleting project ${id}:`, err && err.message ? err.message : err);
    }
  }
  console.log('Deletion run complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

