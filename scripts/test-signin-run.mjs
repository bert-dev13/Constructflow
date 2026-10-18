import fs from 'fs';
import path from 'path';
const [,, emailArg, passwordArg] = process.argv;
if (!emailArg || !passwordArg) {
  console.error('Usage: node scripts/test-signin-run.mjs <email> <password>');
  process.exit(2);
}
const envPath = path.join(process.cwd(), '.env.local');
const env = fs.readFileSync(envPath, 'utf8');
const m = env.match(/^NEXT_PUBLIC_FIREBASE_API_KEY=(?:"([^"]+)"|'([^']+)'|([^\r\n]+))/m);
const key = m ? (m[1] || m[2] || m[3]) : null;
if (!key) {
  console.error('API key not found in .env.local');
  process.exit(2);
}
const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${key}`;
const body = { email: emailArg, password: passwordArg, returnSecureToken: true };
(async () => {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const txt = await res.text();
  console.log('status', res.status);
  try { console.log(JSON.stringify(JSON.parse(txt), null, 2)); } catch (e) { console.log(txt); }
})();

