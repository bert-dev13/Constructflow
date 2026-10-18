import fs from 'node:fs';

const raw = fs.readFileSync('.env.local', 'utf8');
let apiKey = raw.match(/NEXT_PUBLIC_FIREBASE_API_KEY=(.+)/)?.[1]?.trim() || '';
apiKey = apiKey.replace(/^["']|["']$/g, '');

const accounts = [
  { role: 'Contractor', email: 'constructflow.contractor.1@gmail.com' },
  { role: 'Engineer I', email: 'constructflow.engineerr1@gmail.com' },
  { role: 'Engineer II', email: 'constructflow.engineerii@gmail.com' },
  { role: 'Engineer III (lower)', email: 'constructflow.engineeriii@gmail.com' },
  { role: 'Engineer III (upper)', email: 'constructflow.engineerIII@gmail.com' },
  { role: 'Engineer IV', email: 'constructflow.engineer4@gmail.com' },
];

const passwordsToTest = ['fortesting01', 'contractor123', 'engineer123', 'EngineerII', 'Engineer 3', 'Engineer 4'];

async function testAuth(email, password) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const data = await res.json();
  if (res.ok) {
    return { ok: true, uid: data.localId };
  } else {
    return { ok: false, error: data.error?.message };
  }
}

async function main() {
  console.log('Testing authentication against construction-9dd1b...\n');
  for (const acc of accounts) {
    console.log(`=== ${acc.role}: ${acc.email} ===`);
    for (const pwd of passwordsToTest) {
      const res = await testAuth(acc.email, pwd);
      if (res.ok) {
        console.log(`  Password '${pwd}': PASS (uid=${res.uid})`);
      } else {
        console.log(`  Password '${pwd}': FAIL (${res.error})`);
      }
    }
  }
}

main().catch(console.error);
