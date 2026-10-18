/**
 * E2E: client-auth workflow test against real project (uses .env.local NEXT_PUBLIC_FIREBASE_*)
 * Usage: npx tsx scripts/e2e-workflow-client.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  type UserCredential,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getFirestore,
} from 'firebase/firestore';

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

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const ACCOUNTS = {
  contractor: { email: 'constructflow.contractor.1@gmail.com', password: 'fortesting01' },
  engineer1: { email: 'constructflow.engineer1.1@gmail.com', password: 'engineer123' },
  engineer2: { email: 'constructflow.engineer2.1@gmail.com', password: 'engineer123' },
  engineer3: { email: 'constructflow.engineer3.1@gmail.com', password: 'engineer123' },
  engineer4: { email: 'constructflow.engineer4.1@gmail.com', password: 'engineer123' },
} as const;

const mainApp = initializeApp(firebaseConfig, `e2e-workflow-client-main`);
async function signIn(email: string, password: string) {
  const auth = getAuth(mainApp);
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return { app: mainApp, auth, cred };
}

async function run() {
  if (!firebaseConfig.projectId || !firebaseConfig.apiKey) {
    console.error('.env.local must contain NEXT_PUBLIC_FIREBASE_* values');
    process.exit(2);
  }

  console.log('Using project:', firebaseConfig.projectId);

  // Map emails -> uid by signing in briefly
  const uids: Record<string, string> = {};
  for (const k of Object.keys(ACCOUNTS) as Array<keyof typeof ACCOUNTS>) {
    const { email, password } = ACCOUNTS[k];
    try {
      const { auth } = await signIn(email, password);
      const uid = auth.currentUser?.uid;
      if (!uid) throw new Error('No uid');
      uids[k] = uid;
      console.log(`Signed in ${k} -> uid=${uid}`);
      await signOut(auth);
    } catch (err) {
      console.error(`Failed sign-in for ${email}:`, String(err));
      process.exit(1);
    }
  }

  // Use engineer1 to create a report
  const { email: e1email, password: e1pass } = ACCOUNTS.engineer1;
  const { app: app1 } = await signIn(e1email, e1pass);
  const auth1 = getAuth(app1);
  const db1 = getFirestore(app1);
  const reportId = `e2e-workflow-${Date.now()}`;
  const projectId = 'demo-capitol-annex';

  const baseReport = {
    reportNumber: `E2E-${Date.now()}`,
    projectId,
    projectName: 'Provincial Capitol Annex',
    reportType: 'IAR',
    reportData: { report_date: new Date().toISOString().slice(0, 10) },
    lineItems: [],
    accessUserIds: [uids.engineer1, uids.engineer2, uids.contractor],
    editUserIds: [uids.engineer1, uids.contractor],
    status: 'draft',
    approvalFlow: {
      contractorConfirmation: null,
      engineer2: null,
      engineer3: null,
      engineer4: null,
      currentStage: 'draft',
      correctionCycle: 0,
      lastCorrectionReason: null,
      lastCorrectionBy: null,
      lastCorrectionRole: null,
    },
    createdBy: uids.engineer1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  try {
    await setDoc(doc(db1, 'reports', reportId), baseReport);
    console.log('Created report', reportId);
  } catch (err) {
    console.error('Create report failed:', String(err));
    process.exit(1);
  } finally {
    await signOut(auth1);
  }

  const steps: Array<{
    actor: keyof typeof ACCOUNTS;
    action: string;
    update: Record<string, unknown>;
  }> = [
    {
      actor: 'engineer1',
      action: 'submit_to_contractor',
      update: {
        status: 'pending_contractor',
        approvalFlow: { ...baseReport.approvalFlow, currentStage: 'contractor_confirmation' },
        updatedAt: new Date().toISOString(),
      },
    },
    {
      actor: 'contractor',
      action: 'confirm_by_contractor',
      update: {
        status: 'contractor_confirmed',
        approvalFlow: {
          ...baseReport.approvalFlow,
          contractorConfirmation: {
            confirmedBy: uids.contractor,
            confirmedRole: 'contractor',
            confirmedAt: new Date().toISOString(),
            confirmsSwa: true,
            confirmsIar: true,
          },
          currentStage: 'engineer_2',
        },
        updatedAt: new Date().toISOString(),
      },
    },
    {
      actor: 'engineer1',
      action: 'submit_for_review',
      update: {
        status: 'pending_review',
        approvalFlow: {
          ...baseReport.approvalFlow,
          contractorConfirmation: {
            confirmedBy: uids.contractor,
            confirmedRole: 'contractor',
            confirmedAt: new Date().toISOString(),
            confirmsSwa: true,
            confirmsIar: true,
          },
          currentStage: 'engineer_2',
        },
        updatedAt: new Date().toISOString(),
      },
    },
    {
      actor: 'engineer2',
      action: 'engineer2_approve_forward_engineer3',
      update: {
        status: 'with_engineer_3',
        approvalFlow: {
          contractorConfirmation: {
            confirmedBy: uids.contractor,
            confirmedRole: 'contractor',
            confirmedAt: new Date().toISOString(),
            confirmsSwa: true,
            confirmsIar: true,
          },
          engineer2: { approvedBy: uids.engineer2, approvedRole: 'engineer_2', approvedAt: new Date().toISOString() },
          currentStage: 'engineer_3',
        },
        updatedAt: new Date().toISOString(),
      },
    },
    {
      actor: 'engineer3',
      action: 'engineer3_approve_forward_engineer4',
      update: {
        status: 'with_engineer_4',
        approvalFlow: {
          contractorConfirmation: {
            confirmedBy: uids.contractor,
            confirmedRole: 'contractor',
            confirmedAt: new Date().toISOString(),
            confirmsSwa: true,
            confirmsIar: true,
          },
          engineer2: { approvedBy: uids.engineer2, approvedRole: 'engineer_2', approvedAt: new Date().toISOString() },
          engineer3: { approvedBy: uids.engineer3, approvedRole: 'engineer_3', approvedAt: new Date().toISOString() },
          currentStage: 'engineer_4',
        },
        updatedAt: new Date().toISOString(),
      },
    },
    {
      actor: 'engineer4',
      action: 'engineer4_approve_finalize',
      update: {
        status: 'approved',
        approvalFlow: {
          contractorConfirmation: {
            confirmedBy: uids.contractor,
            confirmedRole: 'contractor',
            confirmedAt: new Date().toISOString(),
            confirmsSwa: true,
            confirmsIar: true,
          },
          engineer2: { approvedBy: uids.engineer2, approvedRole: 'engineer_2', approvedAt: new Date().toISOString() },
          engineer3: { approvedBy: uids.engineer3, approvedRole: 'engineer_3', approvedAt: new Date().toISOString() },
          engineer4: { approvedBy: uids.engineer4, approvedRole: 'engineer_4', approvedAt: new Date().toISOString() },
          currentStage: 'engineer_4',
        },
        updatedAt: new Date().toISOString(),
      },
    },
  ];

  const results: Array<{ step: string; ok: boolean; error?: string }> = [];

  for (const s of steps) {
    const { email, password } = ACCOUNTS[s.actor];
    console.log(`\n--- ${s.action} as ${s.actor} (${email}) ---`);
    const { app, auth } = await signIn(email, password);
    const db = getFirestore(app);
    try {
      await updateDoc(doc(db, 'reports', reportId), s.update as any);
      console.log('Update succeeded');
      results.push({ step: s.action, ok: true });
    } catch (err: unknown) {
      console.error('Update failed:', String(err));
      results.push({ step: s.action, ok: false, error: String(err) });
    } finally {
      await signOut(auth);
    }
  }

  // Verify visibility: sign in as engineer2 and read report
  const { app: a2 } = await signIn(ACCOUNTS.engineer2.email, ACCOUNTS.engineer2.password);
  const db2 = getFirestore(a2);
  const snap = await getDoc(doc(db2, 'reports', reportId));
  console.log('\nFinal report snapshot exists:', snap.exists());
  if (snap.exists()) {
    console.log('final status =', snap.data()?.status);
  }
  await signOut(getAuth(a2));

  // Cleanup: delete report as engineer1 (who created it)
  const { app: cleanupApp } = await signIn(ACCOUNTS.engineer1.email, ACCOUNTS.engineer1.password);
  const dbClean = getFirestore(cleanupApp);
  try {
    await deleteDoc(doc(dbClean, 'reports', reportId));
    console.log('Deleted test report', reportId);
  } catch (err) {
    console.warn('Failed to delete test report:', String(err));
  } finally {
    await signOut(getAuth(cleanupApp));
  }

  console.log('\nRESULTS:');
  console.log(JSON.stringify(results, null, 2));

  const allOk = results.every((r) => r.ok);
  console.log(allOk ? 'E2E_WORKFLOW_PASS' : 'E2E_WORKFLOW_FAIL');
  if (!allOk) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

