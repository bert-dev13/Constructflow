import fs from 'node:fs';
import path from 'node:path';

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

const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
const targetAccounts = [
  { role: 'Contractor', email: 'constructflow.contractor.1@gmail.com' },
  { role: 'Engineer I', email: 'constructflow.engineerr1@gmail.com' },
  { role: 'Engineer II', email: 'constructflow.engineerii@gmail.com' },
  { role: 'Engineer III', email: 'constructflow.engineerIII@gmail.com' },
  { role: 'Engineer IV', email: 'constructflow.engineer4@gmail.com' },
];

async function signIn(email: string, pass: string) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pass, returnSecureToken: true }),
  });
  const data = (await res.json()) as any;
  return { ok: res.ok, status: res.status, error: data.error?.message, uid: data.localId };
}

async function testCredentials() {
  console.log('Testing intended demo credential (from DEMO_ACCOUNTS.md: fortesting01):');
  const intendedPassword = 'fortesting01';

  for (const acc of targetAccounts) {
    const r = await signIn(acc.email, intendedPassword);
    if (r.ok) {
      console.log(`  ${acc.role} (${acc.email}): AUTH = PASS (UID: ${r.uid})`);
    } else {
      console.log(`  ${acc.role} (${acc.email}): AUTH = FAIL [${r.error}]`);
    }
  }

  console.log('\nTesting alternative known password contractor123 for Contractor:');
  const rContractor = await signIn('constructflow.contractor.1@gmail.com', 'contractor123');
  console.log(`  Contractor with contractor123: ${rContractor.ok ? 'PASS' : 'FAIL [' + rContractor.error + ']'}`);

  console.log('\nTesting alternative known password engineer123 for Engineers:');
  for (const acc of targetAccounts.slice(1)) {
    const r = await signIn(acc.email, 'engineer123');
    console.log(`  ${acc.role} with engineer123: ${r.ok ? 'PASS' : 'FAIL [' + r.error + ']'}`);
  }
}

testCredentials().catch(console.error);
