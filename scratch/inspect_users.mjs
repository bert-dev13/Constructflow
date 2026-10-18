import admin from 'firebase-admin';
import fs from 'node:fs';

const key = JSON.parse(fs.readFileSync('construction-9dd1b-firebase-adminsdk-fbsvc-920488f9d5.json', 'utf8'));
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(key) });
const auth = admin.auth();
const db = admin.firestore();

async function main() {
  console.log('--- ALL FIRESTORE USERS ---');
  const usersSnap = await db.collection('users').get();
  usersSnap.forEach(doc => {
    console.log(doc.id, '=>', JSON.stringify(doc.data()));
  });

  console.log('--- ALL AUTH USERS ---');
  const authUsers = await auth.listUsers();
  authUsers.users.forEach(u => {
    console.log(u.uid, u.email, 'disabled:', u.disabled);
  });
}

main().catch(console.error);
