/**
 * Deletes Firestore projects and related records.
 * Keeps the five ConstructFlow accounts and does not touch Authentication.
 *
 * Also kept: Pay Item Master and report templates.
 *
 * From the project folder, after `firebase login`:
 *   npm run clear:records -- --yes
 */
import { spawnSync } from 'node:child_process';
import Module from 'node:module';
import path from 'node:path';
import { createRequire } from 'node:module';

import fs from 'node:fs';

let envProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
if (!envProjectId) {
  try {
    const rawEnv = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf8');
    const m = rawEnv.match(/NEXT_PUBLIC_FIREBASE_PROJECT_ID=(.+)/);
    if (m) envProjectId = m[1].trim().replace(/^["']|["']$/g, '');
  } catch {}
}
const PROJECT_ID = envProjectId || 'construction-9dd1b';
const COLLECTIONS = [
  'projects',
  'reports',
  'schedules',
  'sCurves',
  'emailQueue',
  'emailNotifications',
  'counters',
];

const KEEP_ACCOUNTS = [
  { email: 'constructflow.contractor.1@gmail.com', uid: '2NZ3RiVhU4Qmr9j4mcqJuc55Jnr2' },
  { email: 'constructflow.contractor.1@gmail.com', uid: 'seH2VNGkbYayfsOXQv3MWs3iWpQ2' },
  { email: 'constructflow.engineerr1@gmail.com', uid: 'NzjUnZfonHRgOAt2y93vfJnBvQj2' },
  { email: 'constructflow.engineerr1@gmail.com', uid: 'h56w1QM8ulW9Ce04kp58etDBpRA3' },
  { email: 'constructflow.engineerii@gmail.com', uid: 'J9PoPjytn1XOgT0A2giLGV9MBRn2' },
  { email: 'constructflow.engineerii@gmail.com', uid: 'qQgmsn3rfPcozuJqTnuJsJLZex62' },
  { email: 'constructflow.engineerIII@gmail.com', uid: 'EsGDIN06ZlhEoxULVvMKhUzZZw02' },
  { email: 'constructflow.engineerIII@gmail.com', uid: 'wdqmy5ISw6hoJOjyRy7O6UrLbwA3' },
  { email: 'constructflow.engineer4@gmail.com', uid: 'PZk9F1prMXMLQNienfd45GNltcH3' },
  { email: 'constructflow.engineer4@gmail.com', uid: 'rBlH2NpQPuWhrL9g7nqsm3GcUyP2' },
];

const keepEmails = new Set(KEEP_ACCOUNTS.map((account) => account.email.toLowerCase()));
const keepUids = new Set(KEEP_ACCOUNTS.map((account) => account.uid));

function firebaseDelete(target) {
  console.log(`Deleting ${target}…`);
  const result = spawnSync(
    'npx',
    ['firebase', 'firestore:delete', target, '--recursive', '--force', '--project', PROJECT_ID],
    { stdio: 'inherit', shell: true },
  );
  if (result.status !== 0) {
    throw new Error(`Could not delete ${target}`);
  }
}

function fieldString(field) {
  return typeof field?.stringValue === 'string' ? field.stringValue : '';
}

async function cliToken() {
  const require = createRequire(import.meta.url);
  process.env.NODE_PATH = path.join(process.env.APPDATA ?? '', 'npm', 'node_modules');
  Module._initPaths();
  const auth = require('firebase-tools/lib/auth.js');
  const { configstore } = require('firebase-tools/lib/configstore.js');
  const stored = configstore.get('tokens');
  const tokenInfo = await auth.getAccessToken(stored?.refresh_token, stored?.scopes || []);
  const token = typeof tokenInfo === 'string' ? tokenInfo : tokenInfo?.access_token;
  if (!token) throw new Error('Firebase CLI is not signed in. Run firebase login first.');
  return token;
}

async function listUserDocs(token) {
  const users = [];
  let pageToken = '';
  do {
    const url = new URL(
      `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users`,
    );
    url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      throw new Error(`Could not list user records (${response.status}).`);
    }
    const payload = await response.json();
    for (const doc of payload.documents ?? []) {
      const uid = String(doc.name ?? '').split('/').pop() ?? '';
      const email = fieldString(doc.fields?.email);
      users.push({ uid, email });
    }
    pageToken = payload.nextPageToken ?? '';
  } while (pageToken);
  return users;
}

function isKeptAccount(user) {
  return keepUids.has(user.uid) || keepEmails.has(user.email.trim().toLowerCase());
}

async function clearProjectLinks(token, uid) {
  const url = new URL(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}`,
  );
  for (const field of ['assignedProjectIds', 'involvedProjectIds', 'accessibleProjectIds']) {
    url.searchParams.append('updateMask.fieldPaths', field);
  }
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: {
        assignedProjectIds: { arrayValue: {} },
        involvedProjectIds: { arrayValue: {} },
        accessibleProjectIds: { arrayValue: {} },
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`Could not clear project links for ${uid} (${response.status}).`);
  }
}

async function main() {
  if (!process.argv.includes('--yes')) {
    console.log('This deletes projects, reports, schedules, S-curves, and email records.');
    console.log('The five ConstructFlow accounts are kept.');
    console.log('Run: npm run clear:records -- --yes');
    process.exit(1);
  }

  for (const name of COLLECTIONS) {
    firebaseDelete(name);
  }

  const token = await cliToken();
  const users = await listUserDocs(token);
  for (const user of users) {
    if (isKeptAccount(user)) {
      await clearProjectLinks(token, user.uid);
      console.log(`Kept account ${user.email || user.uid} and cleared its project links.`);
      continue;
    }
    firebaseDelete(`users/${user.uid}`);
    console.log(`Removed extra user record ${user.email || user.uid}.`);
  }

  console.log('Done. Projects and records are deleted. The five accounts are still in Authentication.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
