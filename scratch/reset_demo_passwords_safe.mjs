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

const auth = admin.auth();

const TARGET_USERS = [
  { role: 'Contractor', email: 'constructflow.contractor.1@gmail.com', uid: '2NZ3RiVhU4Qmr9j4mcqJuc55Jnr2' },
  { role: 'Engineer I', email: 'constructflow.engineerr1@gmail.com', uid: 'NzjUnZfonHRgOAt2y93vfJnBvQj2' },
  { role: 'Engineer II', email: 'constructflow.engineerii@gmail.com', uid: 'J9PoPjytn1XOgT0A2giLGV9MBRn2' },
  { role: 'Engineer III', email: 'constructflow.engineeriii@gmail.com', uid: 'EsGDIN06ZlhEoxULVvMKhUzZZw02' },
  { role: 'Engineer IV', email: 'constructflow.engineer4@gmail.com', uid: 'PZk9F1prMXMLQNienfd45GNltcH3' },
];

const INTENDED_PASSWORD = 'fortesting01';

async function main() {
  console.log(`Setting password to intended credential for all 5 demo accounts in project ${key.project_id}...`);
  for (const target of TARGET_USERS) {
    const existing = await auth.getUser(target.uid);
    if (!existing) {
      throw new Error(`User with uid ${target.uid} not found!`);
    }
    await auth.updateUser(target.uid, { password: INTENDED_PASSWORD });
    console.log(`Updated password for ${target.role} (${target.email}, UID=${target.uid}) - UID PRESERVED`);
  }
  console.log('All 5 demo accounts updated successfully.');
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
