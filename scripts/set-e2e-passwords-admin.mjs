#!/usr/bin/env node
/**
 * Set known passwords for E2E test accounts using Admin SDK.
 * WARNING: This modifies Firebase Auth live accounts.
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
const auth = admin.auth();

const accounts = [
  { email: 'constructflow.contractor.1@gmail.com', password: 'fortesting01' },
  { email: 'constructflow.engineer1.1@gmail.com', password: 'engineer123' },
  { email: 'constructflow.engineer2.1@gmail.com', password: 'engineer123' },
  { email: 'constructflow.engineer3.1@gmail.com', password: 'engineer123' },
  { email: 'constructflow.engineer4.1@gmail.com', password: 'engineer123' },
];

(async function main(){
  for (const acct of accounts) {
    try {
      const user = await auth.getUserByEmail(acct.email).catch(()=>null);
      if (user) {
        await auth.updateUser(user.uid, { password: acct.password });
        console.log(`Updated password for ${acct.email} (uid=${user.uid})`);
      } else {
        const created = await auth.createUser({ email: acct.email, password: acct.password, emailVerified: false });
        console.log(`Created user ${acct.email} (uid=${created.uid})`);
      }
    } catch (err) {
      console.error(`Error for ${acct.email}:`, err && err.message ? err.message : err);
    }
  }
  console.log('Password set run complete.');
  process.exit(0);
})().catch((e)=>{ console.error(e); process.exit(1); });

