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

const results = [];
for (const key of KEYS) {
  const val = map[key];
  if (!val) {
    results.push({ key, ok: false, reason: 'missing in .env.local' });
    continue;
  }
  // Use vercel CLI via npx to add the env var to production. Suppress stdout/stderr to avoid leaking values.
  const args = ['vercel', 'env', 'add', key, val, 'production', '--yes'];
  const res = spawnSync('npx', args, { encoding: 'utf8', stdio: 'ignore' });
  results.push({ key, ok: res.status === 0, code: res.status });
}

// Print summary (no values)
console.log('Vercel env set summary:');
for (const r of results) {
  console.log(`${r.key}: ${r.ok ? 'OK' : `FAIL (code ${r.code || r.reason})`}`);
}
