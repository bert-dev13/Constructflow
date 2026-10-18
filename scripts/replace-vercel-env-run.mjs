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
  try {
    console.log(`Removing existing ${key} (production) if present...`);
    execSync(`npx vercel env rm ${key} production --yes`, { stdio: 'inherit' });
  } catch (err) {
    console.warn(`Ignore remove error for ${key}:`, err && err.message ? err.message : err);
  }
  try {
    console.log(`Adding ${key} as config to production...`);
    execSync(`npx vercel env add ${key} --type config --value "${val}" production --yes`, { stdio: 'inherit' });
    console.log(`${key}: set`);
  } catch (err) {
    console.error(`${key}: failed to add:`, err && err.message ? err.message : err);
  }
}

console.log('Vercel environment replacement complete.');
