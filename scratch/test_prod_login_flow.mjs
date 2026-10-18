import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import fs from 'node:fs';

const localEnv = fs.readFileSync('.env.local', 'utf8');
const apiKey = localEnv.match(/NEXT_PUBLIC_FIREBASE_API_KEY=(.+)/)?.[1]?.trim().replace(/^["']|["']$/g, '');
const authDomain = localEnv.match(/NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=(.+)/)?.[1]?.trim().replace(/^["']|["']$/g, '');
const projectId = localEnv.match(/NEXT_PUBLIC_FIREBASE_PROJECT_ID=(.+)/)?.[1]?.trim().replace(/^["']|["']$/g, '');

const firebaseConfig = {
  apiKey,
  authDomain,
  projectId,
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const DEMO_ROLES = [
  { roleLabel: 'Contractor', email: 'constructflow.contractor.1@gmail.com', expectedRole: 'contractor', expectedDashboard: 'ContractorDashboard' },
  { roleLabel: 'Engineer I', email: 'constructflow.engineerr1@gmail.com', expectedRole: 'engineer_1', expectedDashboard: 'EngineerIDashboard' },
  { roleLabel: 'Engineer II', email: 'constructflow.engineerii@gmail.com', expectedRole: 'engineer_2', expectedDashboard: 'Reviewer Dashboard (engineer_2)' },
  { roleLabel: 'Engineer III', email: 'constructflow.engineerIII@gmail.com', expectedRole: 'engineer_3', expectedDashboard: 'Reviewer Dashboard (engineer_3)' },
  { roleLabel: 'Engineer IV', email: 'constructflow.engineer4@gmail.com', expectedRole: 'engineer_4', expectedDashboard: 'Reviewer Dashboard (engineer_4)' },
];

const INTENDED_PASSWORD = 'fortesting01';

async function testRoleLogin(account) {
  try {
    const cred = await signInWithEmailAndPassword(auth, account.email.trim(), INTENDED_PASSWORD);
    const uid = cred.user.uid;
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) {
      await signOut(auth);
      return { success: false, error: 'users/{uid} document not found' };
    }
    const data = snap.data();
    if (data.isActive === false) {
      await signOut(auth);
      return { success: false, error: 'account inactive' };
    }
    const role = data.role;
    await signOut(auth);

    if (role !== account.expectedRole) {
      return { success: false, error: `Role mismatch: expected ${account.expectedRole}, got ${role}` };
    }

    let dashboard = '';
    if (role === 'engineer_1') dashboard = 'EngineerIDashboard';
    else if (role === 'contractor') dashboard = 'ContractorDashboard';
    else if (['engineer_2', 'engineer_3', 'engineer_4'].includes(role)) dashboard = `Reviewer Dashboard (${role})`;

    return { success: true, uid, role, fullName: data.fullName, dashboard };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

async function main() {
  console.log(`Testing Production Client Login Flow against ${projectId} (${authDomain})...\n`);
  for (const acc of DEMO_ROLES) {
    const res = await testRoleLogin(acc);
    if (res.success) {
      console.log(`${acc.roleLabel}: PASS`);
      console.log(`  UID: ${res.uid}`);
      console.log(`  Name: ${res.fullName}`);
      console.log(`  Role: ${res.role}`);
      console.log(`  Dashboard Loaded: ${res.dashboard}\n`);
    } else {
      console.log(`${acc.roleLabel}: FAIL`);
      console.log(`  Error: ${res.error}\n`);
    }
  }
}

main().catch(console.error);
