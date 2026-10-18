#!/usr/bin/env node
/**
 * Assign roles in Firestore `users/{uid}` for demo accounts.
 * - Uses admin service account (GOOGLE_APPLICATION_CREDENTIALS or repo-local JSON).
 * - Only writes `role` and `fullName` if missing/overwrites role to desired value.
 * - Does NOT touch Firebase Auth accounts.
 */
import fs from 'node:fs';
import path from 'node:path';
const repoRoot = process.cwd();
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

const mapping = {
  'constructflow.contractor.1@gmail.com': 'contractor',
  'constructflow.engineerr1@gmail.com': 'engineer_1',
  'constructflow.engineerii@gmail.com': 'engineer_2',
  'constructflow.engineerIII@gmail.com': 'engineer_3',
  'constructflow.engineer4@gmail.com': 'engineer_4',
};

async function findUserByEmail(email) {
  // Try to find a users/{uid} doc matching email
  const q = await db.collection('users').where('email', '==', email).get();
  if (!q.empty) return q.docs[0];
  return null;
}

async function ensureRoleFor(email, role) {
  const docRef = await findUserByEmail(email);
  if (docRef) {
    const data = docRef.data();
    const prev = data.role ?? null;
    await docRef.ref.set({ role, fullName: data.fullName ?? null }, { merge: true });
    console.log(`Updated users/${docRef.id}: role ${prev} -> ${role}`);
    return { uid: docRef.id, updated: true, prev };
  }
  // If no users doc, try to find by auth user and create users doc
  try {
    const u = await admin.auth().getUserByEmail(email);
    const uid = u.uid;
    await db.collection('users').doc(uid).set({ email, role, fullName: u.displayName || null, createdAt: new Date().toISOString() }, { merge: true });
    console.log(`Created users/${uid} for ${email} with role ${role}`);
    return { uid, created: true };
  } catch (err) {
    console.warn(`Could not find user doc or auth user for ${email}:`, err.message || err);
    return { error: true };
  }
}

(async function main() {
  for (const [email, role] of Object.entries(mapping)) {
    await ensureRoleFor(email, role);
  }
  console.log('Role assignment complete.');
  process.exit(0);
})();

