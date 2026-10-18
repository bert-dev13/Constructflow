import { spawnSync } from 'node:child_process';
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
  // Attempt to add env var using Vercel CLI; capture output for diagnosis.
  const args = ['vercel', 'env', 'add', key, val, 'production', '--yes'];
  const res = spawnSync('npx', args, { encoding: 'utf8', stdio: 'pipe' });
  const ok = res.status === 0;
  console.log(`${key}: ${ok ? 'OK' : 'FAIL (exit ' + res.status + ')'}`);
  if (!ok) {
    console.log('stdout:', (res.stdout || '').slice(0, 200));
    console.log('stderr:', (res.stderr || '').slice(0, 400));
  }
}

console.log('Done. Inspect the output above for any Vercel CLI errors.');
