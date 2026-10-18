import admin from 'firebase-admin';
import path from 'node:path';
import fs from 'node:fs';

const serviceAccountPath = path.resolve(process.cwd(), 'construction-9dd1b-firebase-adminsdk-fbsvc-920488f9d5.json');
if (!fs.existsSync(serviceAccountPath)) {
  console.error('Service account key not found:', serviceAccountPath);
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'construction-9dd1b',
  });
}

const auth = admin.auth();

const targetEmails = [
  'constructflow.contractor.1@gmail.com',
  'constructflow.engineerr1@gmail.com',
  'constructflow.engineerii@gmail.com',
  'constructflow.engineerIII@gmail.com',
  'constructflow.engineer4@gmail.com',
];

async function checkAuthUsers() {
  console.log('Listing all Auth users in construction-9dd1b...');
  const listUsersResult = await auth.listUsers(100);
  console.log(`Total users in Firebase Auth: ${listUsersResult.users.length}`);

  for (const target of targetEmails) {
    const match = listUsersResult.users.find(
      (u) => (u.email || '').toLowerCase() === target.toLowerCase(),
    );
    if (match) {
      console.log(`\nAccount: ${target}`);
      console.log(`  email: ${match.email}`);
      console.log(`  UID: ${match.uid}`);
      console.log(`  exists = YES`);
      console.log(`  disabled = ${match.disabled ? 'YES' : 'NO'}`);
      console.log(`  passwordHash length: ${match.passwordHash?.length || 0}`);
      console.log(`  lastSignInTime: ${match.metadata.lastSignInTime}`);
      console.log(`  creationTime: ${match.metadata.creationTime}`);
    } else {
      console.log(`\nAccount: ${target}`);
      console.log(`  exists = NO`);
    }
  }
}

checkAuthUsers().catch(console.error);
