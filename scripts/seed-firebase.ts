/**
 * Seeds the official ConstructFlow Firebase account data.
 *
 * Usage: npx tsx scripts/seed-firebase.ts
 *
 * Strategy:
 * 1. Try the deployed admin-backed callable `seedDemoData`.
 * 2. If it is unavailable, fall back to direct client SDK writes.
 */
import { initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
} from 'firebase/auth';
import {
  collection,
  deleteField,
  doc,
  getDocs,
  getFirestore,
  runTransaction,
  setDoc,
} from 'firebase/firestore';
import fs from 'node:fs';
import path from 'node:path';

// Load .env.local into process.env when present so scripts pick up NEXT_PUBLIC_FIREBASE_* values.
// We avoid adding a new dependency by doing a tiny parser here. This does not log secrets.
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const raw = fs.readFileSync(envPath, 'utf8');
  const FIRE_KEYS = [
    'NEXT_PUBLIC_FIREBASE_API_KEY',
    'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
    'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
    'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
    'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
    'NEXT_PUBLIC_FIREBASE_APP_ID',
  ];

  for (const key of FIRE_KEYS) {
    const re = new RegExp(`^${key}\\s*=\\s*(?:"([^"]+)"|'([^']+)'|([^\\r\\n]+))`, 'm');
    const m = raw.match(re);
    if (m) {
      const val = m[1] || m[2] || m[3] || '';
      process.env[key] = val;
      if (key === 'NEXT_PUBLIC_FIREBASE_PROJECT_ID') {
        console.log('.env.local sets NEXT_PUBLIC_FIREBASE_PROJECT_ID =', val);
      }
    }
  }

  // Also load other non-FIRE keys if not present
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (FIRE_KEYS.includes(key)) continue;
    if (!process.env[key]) {
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
}
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'constructflow-c82cd';
const region = process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION || 'us-central1';
const seedUrl = `https://${region}-${projectId}.cloudfunctions.net/seedDemoData`;
console.log('Seeding target project:', projectId);

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyCP8rGySmmAcy_i8UfQxnus5Cfc0wJVRN0',
  authDomain:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'constructflow-c82cd.firebaseapp.com',
  projectId,
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'constructflow-c82cd.firebasestorage.app',
  messagingSenderId:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '173177123241',
  appId:
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '1:173177123241:web:cb0aea82e4e8e9cf1cd4b8',
};

const ACCOUNTS = [
  { email: 'constructflow.contractor.1@gmail.com', password: 'fortesting01', fullName: 'Contractor Alpha', role: 'contractor' },
  { email: 'constructflow.contractor.2@gmail.com', password: 'contractor123', fullName: 'Contractor Bravo', role: 'contractor' },
  { email: 'constructflow.contractor.3@gmail.com', password: 'contractor123', fullName: 'Contractor Charlie', role: 'contractor' },
  { email: 'constructflow.engineerr1@gmail.com', password: 'fortesting01', fullName: 'Engineer I', role: 'engineer_1' },
  { email: 'constructflow.engineerii@gmail.com', password: 'fortesting01', fullName: 'Engineer II', role: 'engineer_2' },
  { email: 'constructflow.engineeriii@gmail.com', password: 'fortesting01', fullName: 'Engineer III', role: 'engineer_3' },
  { email: 'constructflow.engineer4@gmail.com', password: 'fortesting01', fullName: 'Engineer IV', role: 'engineer_4' },
  { email: 'constructflow.engineer1.1@gmail.com', password: 'engineer123', fullName: 'Engr. Juan Dela Cruz', role: 'engineer_1' },
  { email: 'constructflow.engineer1.2@gmail.com', password: 'engineer123', fullName: 'Engr. Carlos Mendoza', role: 'engineer_1' },
  { email: 'constructflow.engineer1.3@gmail.com', password: 'engineer123', fullName: 'Engr. Sofia Ramirez', role: 'engineer_1' },
  { email: 'constructflow.engineer2.1@gmail.com', password: 'engineer123', fullName: 'Engr. Maria Santos', role: 'engineer_2' },
  { email: 'constructflow.engineer2.2@gmail.com', password: 'engineer123', fullName: 'Engr. Luis Garcia', role: 'engineer_2' },
  { email: 'constructflow.engineer2.3@gmail.com', password: 'engineer123', fullName: 'Engr. Elena Cruz', role: 'engineer_2' },
  { email: 'constructflow.engineer3.1@gmail.com', password: 'engineer123', fullName: 'Engr. Pedro Reyes', role: 'engineer_3' },
  { email: 'constructflow.engineer4.1@gmail.com', password: 'engineer123', fullName: 'Engr. Ana Lopez', role: 'engineer_4' },
] as const;

const PROJECT_SPECS = [
  {
    id: 'demo-capitol-annex',
    name: 'Provincial Capitol Annex',
    location: 'Tuguegarao City, Cagayan',
    status: 'active',
    startDate: '2025-07-01',
    plannedEndDate: '2025-10-19',
    contractAmount: 5991119.01,
    contractorEmail: 'constructflow.contractor.1@gmail.com',
    engineer1Email: 'constructflow.engineer1.1@gmail.com',
    engineer2Emails: ['constructflow.engineer2.1@gmail.com'],
  },
  {
    id: 'demo-remebella-road',
    name: 'Remebella Road Improvement',
    location: 'Remebella, Buguey, Cagayan',
    status: 'active',
    startDate: '2025-07-01',
    plannedEndDate: '2025-10-19',
    contractAmount: 5991119.01,
    contractorEmail: 'constructflow.contractor.2@gmail.com',
    engineer1Email: 'constructflow.engineer1.2@gmail.com',
    engineer2Emails: ['constructflow.engineer2.2@gmail.com'],
  },
  {
    id: 'demo-north-zone-pipe',
    name: 'North Zone Pipe Replacement',
    location: 'North Zone, Cagayan',
    status: 'active',
    startDate: '2025-08-01',
    plannedEndDate: '2025-12-15',
    contractAmount: 2500000,
    contractorEmail: 'constructflow.contractor.3@gmail.com',
    engineer1Email: 'constructflow.engineer1.3@gmail.com',
    engineer2Emails: ['constructflow.engineer2.3@gmail.com'],
  },
] as const;

const LEGACY_PASSWORDS = ['fortesting01', 'demo123', 'engineer123', 'contractor123'] as const;

function uniqueIds(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function buildProjectAccess(input: {
  contractorId?: string | null;
  assignedUserIds?: string[];
  involvedUserIds?: string[];
}) {
  const assignedUserIds = uniqueIds([
    ...(input.assignedUserIds ?? []),
    input.contractorId ?? null,
  ]);
  const involvedUserIds = uniqueIds(input.involvedUserIds ?? []);
  return {
    contractorId: input.contractorId ?? null,
    assignedUserIds,
    involvedUserIds,
    accessUserIds: uniqueIds([input.contractorId ?? null, ...assignedUserIds, ...involvedUserIds]),
  };
}

function parseReportNumberCounter(reportNumber: string) {
  const parts = reportNumber.split('-');
  if (parts.length > 5) {
    const suffix = Number(parts[parts.length - 1]);
    if (Number.isFinite(suffix)) {
      return { base: parts.slice(0, -1).join('-'), nextSuffix: suffix + 1 };
    }
  }
  return { base: reportNumber, nextSuffix: 2 };
}

async function tryCallableSeed() {
  const response = await fetch(seedUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ data: {} }),
  });

  if (!response.ok) {
    throw new Error(`Seed request failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    result?: Record<string, unknown>;
    error?: { message?: string };
  };
  if (payload.error) {
    throw new Error(payload.error.message || 'Seed function returned an error');
  }
  return payload.result ?? {};
}

async function signInWithKnownPassword(
  auth: ReturnType<typeof getAuth>,
  email: string,
  requiredPassword: string,
) {
  try {
    return await signInWithEmailAndPassword(auth, email, requiredPassword);
  } catch (primaryError) {
    for (const legacyPassword of LEGACY_PASSWORDS) {
      if (legacyPassword === requiredPassword) continue;
      try {
        const cred = await signInWithEmailAndPassword(auth, email, legacyPassword);
        return cred;
      } catch {
        /* try next known legacy password */
      }
    }
    throw primaryError;
  }
}

async function directSeed() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const now = new Date().toISOString();
  const usersByEmail = new Map<string, { uid: string; role: string; fullName: string }>();

  for (const account of ACCOUNTS) {
    let uid: string;
    try {
      const created = await createUserWithEmailAndPassword(auth, account.email, account.password);
      uid = created.user.uid;
      console.log('Created auth user', account.email);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code !== 'auth/email-already-in-use') throw err;
      // Existing auth user. Try signing in with required or legacy passwords.
      try {
        const signedIn = await signInWithKnownPassword(auth, account.email, account.password);
        uid = signedIn.user.uid;
        console.log('Signed in existing auth user', account.email);
      } catch (signInError) {
        // Could not sign in. Attempt to locate an existing user document in Firestore
        // to map the account to a uid without modifying Auth or passwords.
        console.warn(
          `Conflict: existing auth user ${account.email} could not be signed in with the seed passwords.`,
        );
        console.warn('Will try to locate an existing users document to map UID (no password changes will be made).');
        try {
          const usersQuery = await getDocs(collection(db, 'users'));
          const match = usersQuery.docs.find((d) => {
            const data = d.data() as Record<string, unknown>;
            return String(data.email ?? '').toLowerCase() === account.email.toLowerCase();
          });
          if (match) {
            uid = match.id;
            console.log(`Mapped ${account.email} -> existing users doc uid ${uid} (no password changed).`);
          } else {
            throw signInError;
          }
        } catch (lookupError) {
          throw new Error(
            `Existing auth user ${account.email} could not be signed in with the required password and no users doc was found to map UID. Resolve by signing in to that account or resetting its password before running the seed.`,
            { cause: lookupError },
          );
        }
      }
    }

    usersByEmail.set(account.email, {
      uid,
      role: account.role,
      fullName: account.fullName,
    });
    await signOut(auth);
  }

  const allProjectIds = PROJECT_SPECS.map((project) => project.id);

  for (const account of ACCOUNTS) {
    const user = usersByEmail.get(account.email)!;
    // Try to sign in to allow writing the user's own profile document.
    // If sign-in fails but an existing users doc was mapped, skip signing in and do not overwrite.
    let canWriteUserDoc = true;
    try {
      await signInWithEmailAndPassword(auth, account.email, account.password);
    } catch {
      // If the users collection already has a document for this uid, we will not overwrite it.
      const existingUserDoc = await getDocs(collection(db, 'users'));
      const exists = existingUserDoc.docs.some((d) => d.id === user.uid);
      if (!exists) {
        throw new Error(
          `Cannot sign in as ${account.email} to create/update its users document and no existing users doc was found. Resolve credentials or create the users doc manually.`,
        );
      }
      console.warn(`Skipping sign-in for ${account.email}; using existing users doc (no password changes).`);
      canWriteUserDoc = false;
    }
    const assignedProjectIds = PROJECT_SPECS
      .filter((project) =>
        project.contractorEmail === account.email || project.engineer1Email === account.email,
      )
      .map((project) => project.id);
    const involvedProjectIds = PROJECT_SPECS
      .filter((project) => project.engineer2Emails.some((email) => email === account.email))
      .map((project) => project.id);
    const accessibleProjectIds =
      account.role === 'engineer_3' || account.role === 'engineer_4'
        ? allProjectIds
        : uniqueIds([...assignedProjectIds, ...involvedProjectIds]);

    await setDoc(
      doc(db, 'users', user.uid),
      {
        email: account.email,
        fullName: account.fullName,
        role: account.role,
        isActive: true,
        isTestAccount: deleteField(),
        isDevelopmentAccount: deleteField(),
        accountType: deleteField(),
        notes: deleteField(),
        assignedProjectIds,
        involvedProjectIds,
        accessibleProjectIds,
        createdAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
    if (canWriteUserDoc) await signOut(auth);
  }

  await signInWithEmailAndPassword(auth, 'constructflow.engineer1.1@gmail.com', 'engineer123');

  for (const project of PROJECT_SPECS) {
    const contractor = usersByEmail.get(project.contractorEmail);
    const engineer1 = usersByEmail.get(project.engineer1Email);
    const engineer2Uids = project.engineer2Emails
      .map((email) => usersByEmail.get(email)?.uid ?? null)
      .filter((uid): uid is string => Boolean(uid));
    const access = buildProjectAccess({
      contractorId: contractor?.uid ?? null,
      assignedUserIds: [engineer1?.uid ?? null].filter((uid): uid is string => Boolean(uid)),
      involvedUserIds: engineer2Uids,
    });
    await setDoc(
      doc(db, 'projects', project.id),
      {
        name: project.name,
        location: project.location,
        status: project.status,
        startDate: project.startDate,
        plannedEndDate: project.plannedEndDate,
        contractAmount: project.contractAmount,
        contractorId: access.contractorId,
        contractorName: contractor?.fullName ?? null,
        assignedUserIds: access.assignedUserIds,
        involvedUserIds: access.involvedUserIds,
        accessUserIds: access.accessUserIds,
        isTestProject: deleteField(),
        createdAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
    await setDoc(
      doc(db, 'schedules', project.id),
      {
        projectId: project.id,
        activities: [],
        dependencies: [],
        barChartTasks: [],
        barChartTotalDays: 1,
        barChartTimeNow: 0,
        projectDuration: 0,
        criticalPath: [],
        updatedAt: now,
      },
      { merge: true },
    );
  }

  const projectsSnap = await getDocs(collection(db, 'projects'));
  const projectAccessById = new Map<string, { accessUserIds: string[] }>();
  for (const projectDoc of projectsSnap.docs) {
    const data = projectDoc.data() as Record<string, unknown>;
    const access = buildProjectAccess({
      contractorId: typeof data.contractorId === 'string' ? data.contractorId : null,
      assignedUserIds: Array.isArray(data.assignedUserIds)
        ? data.assignedUserIds.filter((value): value is string => typeof value === 'string')
        : [],
      involvedUserIds: Array.isArray(data.involvedUserIds)
        ? data.involvedUserIds.filter((value): value is string => typeof value === 'string')
        : [],
    });
    projectAccessById.set(projectDoc.id, { accessUserIds: access.accessUserIds });
    await setDoc(
      projectDoc.ref,
      {
        contractorId: access.contractorId,
        assignedUserIds: access.assignedUserIds,
        involvedUserIds: access.involvedUserIds,
        accessUserIds: access.accessUserIds,
        updatedAt: now,
      },
      { merge: true },
    );
  }

  const reportsSnap = await getDocs(collection(db, 'reports'));
  const counterNextSuffix = new Map<string, number>();
  for (const reportDoc of reportsSnap.docs) {
    const data = reportDoc.data() as Record<string, unknown>;
    const projectAccess = projectAccessById.get(String(data.projectId ?? ''));
    const reportNumber = String(data.reportNumber ?? '');
    if (reportNumber) {
      const parsed = parseReportNumberCounter(reportNumber);
      const prev = counterNextSuffix.get(parsed.base) ?? 1;
      counterNextSuffix.set(parsed.base, Math.max(prev, parsed.nextSuffix));
    }
    if (!projectAccess) continue;
    await setDoc(
      reportDoc.ref,
      {
        accessUserIds: projectAccess.accessUserIds,
        updatedAt: now,
      },
      { merge: true },
    );
  }

  for (const [base, nextSuffix] of counterNextSuffix.entries()) {
    await runTransaction(db, async (tx) => {
      tx.set(
        doc(db, 'counters', `reportNumber_${base}`),
        {
          kind: 'report_number',
          base,
          nextSuffix,
          updatedAt: now,
        },
        { merge: true },
      );
    });
  }

  await signOut(auth);
  return {
    ok: true,
    mode: 'direct-client',
    users: ACCOUNTS.length,
    projects: PROJECT_SPECS.length,
    reportsUpdated: reportsSnap.size,
    countersUpdated: counterNextSuffix.size,
  };
}

async function main() {
  try {
    const result = await tryCallableSeed();
    console.log('Seed complete via callable.');
    console.log(JSON.stringify(result, null, 2));
    return;
  } catch (callableError) {
    console.warn('Callable seed unavailable, falling back to direct client seeding.');
    console.warn(callableError instanceof Error ? callableError.message : String(callableError));
  }

  // If admin credentials are available, prefer admin seeding which can run safely
  // against the target project without relying on client sign-in or deployed functions.
  // Admin seeding will not overwrite passwords for existing users; it will only
  // create missing users and set up Firestore documents.
  // Allow an automatically-detected local service-account JSON file in repo root for convenience.
  // This enables running the admin seed locally without manually exporting env vars.
  // NOTE: Do NOT commit service-account JSON to source control.
  // The filename below is intentionally specific to avoid accidental discovery.
  // It will only be used when present in the project root.
  const fs = await import('node:fs');
  const path = await import('node:path');
  const localKeyCandidate = path.resolve(process.cwd(), 'construction-9dd1b-firebase-adminsdk-fbsvc-920488f9d5.json');
  const adminKeyPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.FIREBASE_ADMIN_KEY_PATH ||
    (fs.existsSync(localKeyCandidate) ? localKeyCandidate : undefined);
  const adminKeyJson = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON;
  if (adminKeyPath || adminKeyJson) {
    try {
      // Import firebase-admin dynamically to keep dev env lightweight when not used.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const admin = await import('firebase-admin');
      let adminApp;
      if (adminKeyJson && !adminKeyPath) {
        adminApp = admin.initializeApp({
          credential: admin.credential.cert(JSON.parse(adminKeyJson)),
          projectId,
        });
      } else if (adminKeyPath) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const key = await import('node:fs').then((fs) => JSON.parse(fs.readFileSync(adminKeyPath, 'utf8')));
        adminApp = admin.initializeApp({
          credential: admin.credential.cert(key as any),
          projectId,
        });
      } else {
        adminApp = admin.initializeApp({
          credential: admin.credential.applicationDefault(),
          projectId,
        });
      }

      async function adminSeed() {
        const auth = admin.auth();
        const afs = admin.firestore();
        const now = new Date().toISOString();
        const usersByEmail = new Map<string, { uid: string; role: string; fullName: string }>();

        for (const account of ACCOUNTS) {
          let uid: string;
          try {
            const u = await auth.getUserByEmail(account.email);
            uid = u.uid;
            console.log(`Found existing auth user ${account.email} -> ${uid} (password not modified).`);
          } catch (err: unknown) {
            // user not found; create with provided password
            try {
              const created = await auth.createUser({
                email: account.email,
                emailVerified: false,
                password: account.password,
                displayName: account.fullName,
              });
              uid = created.uid;
              console.log(`Created auth user ${account.email} -> ${uid}`);
            } catch (createErr) {
              throw createErr;
            }
          }

          usersByEmail.set(account.email, {
            uid,
            role: account.role,
            fullName: account.fullName,
          });
        }

        // Now write Firestore documents using admin privileges
        for (const [email, info] of usersByEmail.entries()) {
          await afs.doc(`users/${info.uid}`).set(
            {
              email,
              fullName: info.fullName,
              role: info.role,
              isActive: true,
              assignedProjectIds: [],
              involvedProjectIds: [],
              accessibleProjectIds: [],
              createdAt: now,
              updatedAt: now,
            },
            { merge: true },
          );
        }

        // Projects and other seed data
        for (const project of PROJECT_SPECS) {
          const contractor = usersByEmail.get(project.contractorEmail);
          const engineer1 = usersByEmail.get(project.engineer1Email);
          const engineer2Uids = project.engineer2Emails
            .map((email) => usersByEmail.get(email)?.uid ?? null)
            .filter((uid): uid is string => Boolean(uid));
          const access = buildProjectAccess({
            contractorId: contractor?.uid ?? null,
            assignedUserIds: [engineer1?.uid ?? null].filter((uid): uid is string => Boolean(uid)),
            involvedUserIds: engineer2Uids,
          });
          await afs.doc(`projects/${project.id}`).set(
            {
              name: project.name,
              location: project.location,
              status: project.status,
              startDate: project.startDate,
              plannedEndDate: project.plannedEndDate,
              contractAmount: project.contractAmount,
              contractorId: access.contractorId,
              contractorName: contractor?.fullName ?? null,
              assignedUserIds: access.assignedUserIds,
              involvedUserIds: access.involvedUserIds,
              accessUserIds: access.accessUserIds,
              createdAt: now,
              updatedAt: now,
            },
            { merge: true },
          );
          await afs.doc(`schedules/${project.id}`).set(
            {
              projectId: project.id,
              activities: [],
              dependencies: [],
              barChartTasks: [],
              barChartTotalDays: 1,
              barChartTimeNow: 0,
              projectDuration: 0,
              criticalPath: [],
              updatedAt: now,
            },
            { merge: true },
          );
        }

        // Reports / counters update pass-through (no destructive changes)
        const allReports = await afs.collection('reports').get();
        const counterNextSuffix = new Map<string, number>();
        for (const reportDoc of allReports.docs) {
          const data = reportDoc.data() as Record<string, unknown>;
          const projectAccess = null; // admin can recalc if needed later
          const reportNumber = String(data.reportNumber ?? '');
          if (reportNumber) {
            const parsed = parseReportNumberCounter(reportNumber);
            const prev = counterNextSuffix.get(parsed.base) ?? 1;
            counterNextSuffix.set(parsed.base, Math.max(prev, parsed.nextSuffix));
          }
        }

        for (const [base, nextSuffix] of counterNextSuffix.entries()) {
          await afs.doc(`counters/reportNumber_${base}`).set(
            { kind: 'report_number', base, nextSuffix, updatedAt: new Date().toISOString() },
            { merge: true },
          );
        }

        return {
          ok: true,
          mode: 'admin',
          users: usersByEmail.size,
          projects: PROJECT_SPECS.length,
          countersUpdated: counterNextSuffix.size,
        };
      }

      const adminResult = await adminSeed();
      console.log('Seed complete via admin SDK.');
      console.log(JSON.stringify(adminResult, null, 2));
      return;
    } catch (adminErr) {
      console.warn('Admin seeding failed or admin SDK not available; falling back to client seeding.');
      console.warn(adminErr instanceof Error ? adminErr.message : String(adminErr));
    }
  }

  const result = await directSeed();

  console.log('Seed complete.');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
