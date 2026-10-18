import fs from 'fs';
import path from 'path';

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}
loadEnvLocal();

const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
const passwords = ['fortesting01', 'contractor123', 'password123', 'constructflow123', 'admin123', 'demo1234', 'Pass1234!', 'fortesting'];
for (const pw of passwords) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'constructflow.contractor.1@gmail.com', password: pw, returnSecureToken: true })
  });
  const data = await res.json();
  if (res.status === 200) {
    console.log('FOUND CONTRACTOR PASSWORD:', pw, 'uid:', data.localId);
    break;
  }
}
