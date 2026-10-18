import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(process.cwd(), '.env.local');
const raw = readFileSync(envPath, 'utf8');
const map = {};
for (const line of raw.split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i === -1) continue;
  const key = t.slice(0, i).trim();
  let val = t.slice(i + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
  map[key] = val;
}

const KEYS = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
];

for (const key of KEYS) {
  const val = map[key];
  if (!val) {
    console.log(`${key}: missing in .env.local`);
    continue;
  }
  console.log(`=== Adding ${key} to Vercel (production) ===`);
  const cmd = `npx vercel env add ${key} --value "${val}" production --yes`;
  try {
    execSync(cmd, { stdio: 'inherit', env: process.env });
    console.log(`${key}: OK`);
  } catch (err) {
    console.error(`${key}: FAILED`, err && err.message ? err.message : err);
  }
}

console.log('Finished setting Vercel env vars.');
