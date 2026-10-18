import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  where,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyCP8rGySmmAcy_i8UfQxnus5Cfc0wJVRN0',
  authDomain:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'constructflow-c82cd.firebaseapp.com',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'constructflow-c82cd',
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'constructflow-c82cd.firebasestorage.app',
  messagingSenderId:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '173177123241',
  appId:
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '1:173177123241:web:cb0aea82e4e8e9cf1cd4b8',
};

const ROLE_CHECKS = [
  {
    label: 'Contractor',
    email: 'constructflow.contractor.1@gmail.com',
    password: 'fortesting01',
    expectedRole: 'contractor',
    expectedProjects: ['demo-capitol-annex'],
  },
  {
    label: 'Engineer I',
    email: 'constructflow.engineer1.1@gmail.com',
    password: 'engineer123',
    expectedRole: 'engineer_1',
    expectedProjects: ['demo-capitol-annex'],
  },
  {
    label: 'Engineer II',
    email: 'constructflow.engineer2.1@gmail.com',
    password: 'engineer123',
    expectedRole: 'engineer_2',
    expectedProjects: ['demo-capitol-annex'],
  },
  {
    label: 'Engineer III',
    email: 'constructflow.engineer3.1@gmail.com',
    password: 'engineer123',
    expectedRole: 'engineer_3',
    expectedProjects: ['demo-capitol-annex', 'demo-north-zone-pipe', 'demo-remebella-road'],
  },
  {
    label: 'Engineer IV',
    email: 'constructflow.engineer4.1@gmail.com',
    password: 'engineer123',
    expectedRole: 'engineer_4',
    expectedProjects: ['demo-capitol-annex', 'demo-north-zone-pipe', 'demo-remebella-road'],
  },
] as const;

async function main() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const results: Array<Record<string, unknown>> = [];

  for (const check of ROLE_CHECKS) {
    const cred = await signInWithEmailAndPassword(auth, check.email, check.password);
    const uid = cred.user.uid;
    const userSnap = await getDoc(doc(db, 'users', uid));
    const userData = userSnap.data() as Record<string, unknown> | undefined;
    const actualRole = String(userData?.role ?? '');
    const visibleProjects =
      actualRole === 'engineer_3' || actualRole === 'engineer_4'
        ? await getDocs(collection(db, 'projects'))
        : await getDocs(
            query(collection(db, 'projects'), where('accessUserIds', 'array-contains', uid)),
          );
    const projectIds = visibleProjects.docs.map((projectDoc) => projectDoc.id).sort();

    results.push({
      role: check.label,
      email: check.email,
      uid,
      roleMatches: actualRole === check.expectedRole,
      actualRole,
      expectedRole: check.expectedRole,
      projectsMatch:
        JSON.stringify(projectIds) === JSON.stringify([...check.expectedProjects].sort()),
      visibleProjectIds: projectIds,
      expectedProjectIds: [...check.expectedProjects].sort(),
    });

    await signOut(auth);
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
