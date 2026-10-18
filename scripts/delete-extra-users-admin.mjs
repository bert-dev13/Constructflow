#!/usr/bin/env node
/**
 * Delete Firebase Auth users and users/{uid} docs not listed in DEMO_ACCOUNTS.md
 * WARNING: irreversible. Use with care.
 */
import fs from 'fs';
import path from 'path';
const repoRoot = process.cwd();
const demoPath = path.join(repoRoot, 'DEMO_ACCOUNTS.md');
if (!fs.existsSync(demoPath)) {
  console.error('DEMO_ACCOUNTS.md not found at', demoPath);
  process.exit(2);
}
const raw = fs.readFileSync(demoPath, 'utf8');
const allowedEmails = new Set(
  raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => l.includes('@'))
    .map((e) => e.split(/\s+/)[0].toLowerCase()),
);
if (!allowedEmails.size) {
  console.error('No emails parsed from DEMO_ACCOUNTS.md - aborting');
  process.exit(2);
}
console.log('Allowed emails:', [...allowedEmails]);

const localKey = path.resolve(repoRoot, 'construction-9dd1b-firebase-adminsdk-fbsvc-920488f9d5.json');
const adminKeyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || (fs.existsSync(localKey) ? localKey : undefined);
if (!adminKeyPath) {
  console.error('Service account key not found. Set GOOGLE_APPLICATION_CREDENTIALS or place service account JSON at', localKey);
  process.exit(2);
}
import admin from 'firebase-admin';
const key = JSON.parse(fs.readFileSync(adminKeyPath, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(key), projectId: key.project_id });
const auth = admin.auth();
const afs = admin.firestore();

async function listAllUsers() {
  const out = [];
  let nextPageToken;
  do {
    const res = await auth.listUsers(1000, nextPageToken);
    out.push(...res.users);
    nextPageToken = res.pageToken;
  } while (nextPageToken);
  return out;
}

(async function main() {
  try {
    const users = await listAllUsers();
    console.log(`Found ${users.length} auth users`);
    const toDelete = users.filter((u) => {
      const email = (u.email || '').toLowerCase();
      return email && !allowedEmails.has(email);
    });
    if (!toDelete.length) {
      console.log('No extra users to delete.');
      process.exit(0);
    }

    console.log('Users to delete (email -> uid):');
    for (const u of toDelete) console.log(`  ${u.email} -> ${u.uid}`);

    // Proceed without interactive prompt (user requested deletion)
    console.log('Proceeding to delete listed users without interactive confirmation as requested.');

    const deleted = [];
    for (const u of toDelete) {
      try {
        await auth.deleteUser(u.uid);
        console.log(`Deleted auth user ${u.uid} (${u.email})`);
      } catch (err) {
        console.warn(`Failed to delete auth user ${u.uid}:`, err && err.message ? err.message : String(err));
      }
      try {
        const docRef = afs.doc(`users/${u.uid}`);
        const snap = await docRef.get();
        if (snap.exists) {
          await docRef.delete();
          console.log(`Deleted users/${u.uid} doc`);
        }
      } catch (err) {
        console.warn(`Failed to delete users/${u.uid} doc:`, err && err.message ? err.message : String(err));
      }
      deleted.push({ uid: u.uid, email: u.email || null });
    }

    console.log('Deletion complete. Summary:');
    console.log(JSON.stringify({ deleted, remainingAllowed: [...allowedEmails] }, null, 2));
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();

