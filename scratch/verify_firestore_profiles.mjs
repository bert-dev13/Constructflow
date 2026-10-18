import admin from 'firebase-admin';
import fs from 'node:fs';

const serviceAccountPath = 'construction-9dd1b-firebase-adminsdk-fbsvc-920488f9d5.json';
const key = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(key),
    projectId: key.project_id,
  });
}

const db = admin.firestore();

const EXPECTED_PROFILES = [
  { roleName: 'Contractor', expectedRole: 'contractor', uid: '2NZ3RiVhU4Qmr9j4mcqJuc55Jnr2' },
  { roleName: 'Engineer I', expectedRole: 'engineer_1', uid: 'NzjUnZfonHRgOAt2y93vfJnBvQj2' },
  { roleName: 'Engineer II', expectedRole: 'engineer_2', uid: 'J9PoPjytn1XOgT0A2giLGV9MBRn2' },
  { roleName: 'Engineer III', expectedRole: 'engineer_3', uid: 'EsGDIN06ZlhEoxULVvMKhUzZZw02' },
  { roleName: 'Engineer IV', expectedRole: 'engineer_4', uid: 'PZk9F1prMXMLQNienfd45GNltcH3' },
];

async function main() {
  console.log('Verifying Firestore users/{uid} profiles...\n');
  let allMatched = true;

  for (const item of EXPECTED_PROFILES) {
    const docRef = db.collection('users').doc(item.uid);
    const snap = await docRef.get();
    if (!snap.exists) {
      console.log(`${item.roleName} (UID: ${item.uid}): NOT FOUND in Firestore!`);
      allMatched = false;
      continue;
    }
    const data = snap.data();
    const roleMatch = data.role === item.expectedRole;
    if (!roleMatch) allMatched = false;
    console.log(`${item.roleName} (UID: ${item.uid}):`);
    console.log(`  email: ${data.email}`);
    console.log(`  role in doc: ${data.role} (expected: ${item.expectedRole}) => ${roleMatch ? 'MATCH' : 'MISMATCH'}`);
    console.log(`  fullName: ${data.fullName}`);
    console.log(`  isActive: ${data.isActive}`);
  }

  if (allMatched) {
    console.log('\nAll Firestore profile mappings verified successfully.');
  } else {
    console.log('\nSome Firestore profiles mismatched or missing!');
    process.exit(1);
  }
}

main().catch(console.error);
