import fs from 'node:fs';
import path from 'node:path';
import admin from 'firebase-admin';

const repoRoot = process.cwd();
const localKey = path.resolve(repoRoot, 'construction-9dd1b-firebase-adminsdk-fbsvc-920488f9d5.json');
const key = JSON.parse(fs.readFileSync(localKey, 'utf8'));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(key),
    projectId: key.project_id,
  });
}

const db = admin.firestore();

async function setup() {
  console.log('Running test setup for project 9wSZsFc2AUsfKDJojOXt and demo accounts...');

  const contractorUid = '2NZ3RiVhU4Qmr9j4mcqJuc55Jnr2';
  const eng1Uid = 'NzjUnZfonHRgOAt2y93vfJnBvQj2';
  const eng2Uid = 'J9PoPjytn1XOgT0A2giLGV9MBRn2';
  const eng3Uid = 'EsGDIN06ZlhEoxULVvMKhUzZZw02';
  const eng4Uid = 'PZk9F1prMXMLQNienfd45GNltcH3';
  const projectId = '9wSZsFc2AUsfKDJojOXt';

  // 1. Update Project 9wSZsFc2AUsfKDJojOXt
  await db.collection('projects').doc(projectId).set(
    {
      contractorId: contractorUid,
      assignedUserIds: [eng1Uid, contractorUid],
      involvedUserIds: [eng2Uid],
      accessUserIds: [contractorUid, eng1Uid, eng2Uid],
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
  console.log('Project 9wSZsFc2AUsfKDJojOXt access updated.');

  // 2. Update Users
  const userUpdates = [
    {
      uid: contractorUid,
      data: {
        email: 'constructflow.contractor.1@gmail.com',
        role: 'contractor',
        fullName: 'Contractor Alpha',
        designation: "Contractor's Representative",
        isActive: true,
        assignedProjectIds: [projectId, 'demo-capitol-annex'],
        accessibleProjectIds: [projectId, 'demo-capitol-annex'],
        updatedAt: new Date().toISOString(),
      },
    },
    {
      uid: eng1Uid,
      data: {
        email: 'constructflow.engineerr1@gmail.com',
        role: 'engineer_1',
        fullName: 'Engineer I',
        designation: 'PEO Engineer I',
        isActive: true,
        assignedProjectIds: [projectId],
        accessibleProjectIds: [projectId],
        updatedAt: new Date().toISOString(),
      },
    },
    {
      uid: eng2Uid,
      data: {
        email: 'constructflow.engineerii@gmail.com',
        role: 'engineer_2',
        fullName: 'Engineer II',
        designation: 'PEO Engineer II',
        isActive: true,
        involvedProjectIds: [projectId],
        accessibleProjectIds: [projectId],
        updatedAt: new Date().toISOString(),
      },
    },
    {
      uid: eng3Uid,
      data: {
        email: 'constructflow.engineeriii@gmail.com',
        role: 'engineer_3',
        fullName: 'Engineer III',
        designation: 'PEO Engineer III',
        isActive: true,
        accessibleProjectIds: [],
        updatedAt: new Date().toISOString(),
      },
    },
    {
      uid: eng4Uid,
      data: {
        email: 'constructflow.engineer4@gmail.com',
        role: 'engineer_4',
        fullName: 'Engineer IV',
        designation: 'PEO Engineer IV',
        isActive: true,
        accessibleProjectIds: [],
        updatedAt: new Date().toISOString(),
      },
    },
  ];

  for (const u of userUpdates) {
    await db.collection('users').doc(u.uid).set(u.data, { merge: true });
    console.log(`Updated users/${u.uid} (${u.data.email}): role=${u.data.role}, fullName=${u.data.fullName}`);
  }

  console.log('Test setup completed successfully.');
  process.exit(0);
}

setup().catch((e) => {
  console.error(e);
  process.exit(1);
});
