#!/usr/bin/env node
/**
 * Create demo accounts listed in DEMO_ACCOUNTS.md using Admin SDK.
 * - Creates missing auth users with the listed password.
 * - If user exists, does NOT change password; reports it.
 */
import fs from 'node:fs';
import path from 'node:path';
const repoRoot = process.cwd();
const demoPath = path.join(repoRoot, 'DEMO_ACCOUNTS.md');
if (!fs.existsSync(demoPath)) {
  console.error('DEMO_ACCOUNTS.md not found at', demoPath);
  process.exit(2);
}
const raw = fs.readFileSync(demoPath, 'utf8');
// Parse lines: look for email lines (contain @) and following line with pass:
const lines = raw.split(/\r?\n/);
const accounts = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  if (line.includes('@')) {
    const email = line.split(/\s+/)[0].trim();
    // look ahead for pass: pattern
    let pwd = null;
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const l = lines[j].trim();
      const m = l.match(/pass:\s*(.+)/i);
      if (m) {
        pwd = m[1].trim();
        break;
      }
    }
    if (!pwd) {
      console.warn('No password found for', email, '- skipping');
      continue;
    }
    accounts.push({ email, password: pwd });
  }
}
if (!accounts.length) {
  console.log('No accounts parsed from DEMO_ACCOUNTS.md');
  process.exit(0);
}

// admin creds
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

(async function main() {
  for (const acct of accounts) {
    try {
      const existing = await auth.getUserByEmail(acct.email).catch(() => null);
      if (existing) {
        console.log('Already exists:', acct.email, 'uid=' + existing.uid);
        continue;
      }
      const created = await auth.createUser({
        email: acct.email,
        password: acct.password,
        emailVerified: false,
      });
      console.log('Created:', acct.email, 'uid=' + created.uid);
    } catch (err) {
      console.error('Error for', acct.email, err && err.message ? err.message : err);
    }
  }
  console.log('Done.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

