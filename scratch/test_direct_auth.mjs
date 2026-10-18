import fs from 'node:fs';

const localEnv = fs.readFileSync('.env.local', 'utf8');
const apiKey = localEnv.match(/NEXT_PUBLIC_FIREBASE_API_KEY=(.+)/)?.[1]?.trim().replace(/^["']|["']$/g, '');
const projectId = localEnv.match(/NEXT_PUBLIC_FIREBASE_PROJECT_ID=(.+)/)?.[1]?.trim().replace(/^["']|["']$/g, '');

const demoAccounts = [
  { role: 'Contractor', email: 'constructflow.contractor.1@gmail.com', expectedUid: '2NZ3RiVhU4Qmr9j4mcqJuc55Jnr2' },
  { role: 'Engineer I', email: 'constructflow.engineerr1@gmail.com', expectedUid: 'NzjUnZfonHRgOAt2y93vfJnBvQj2' },
  { role: 'Engineer II', email: 'constructflow.engineerii@gmail.com', expectedUid: 'J9PoPjytn1XOgT0A2giLGV9MBRn2' },
  { role: 'Engineer III (lower)', email: 'constructflow.engineeriii@gmail.com', expectedUid: 'EsGDIN06ZlhEoxULVvMKhUzZZw02' },
  { role: 'Engineer III (upper)', email: 'constructflow.engineerIII@gmail.com', expectedUid: 'EsGDIN06ZlhEoxULVvMKhUzZZw02' },
  { role: 'Engineer IV', email: 'constructflow.engineer4@gmail.com', expectedUid: 'PZk9F1prMXMLQNienfd45GNltcH3' },
];

const INTENDED_PASSWORD = 'fortesting01';

async function testSignIn(email, password) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
  const res = await fetch(url, {
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
  console.log(`Direct Auth Test against project: ${projectId}`);
  console.log('Using intended demo credential.\n');

  for (const acc of demoAccounts) {
    const res = await testSignIn(acc.email, INTENDED_PASSWORD);
    if (res.ok) {
      const match = res.uid === acc.expectedUid ? 'UID MATCH' : 'UID MISMATCH';
      console.log(`${acc.role} (${acc.email}): PASS [${match}, UID=${res.uid}]`);
    } else {
      console.log(`${acc.role} (${acc.email}): FAIL [Error: ${res.error}]`);
    }
  }
}

main().catch(console.error);
