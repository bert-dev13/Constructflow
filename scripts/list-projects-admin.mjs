#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const localKey = path.resolve(process.cwd(), 'construction-9dd1b-firebase-adminsdk-fbsvc-920488f9d5.json');
const adminKeyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || (fs.existsSync(localKey) ? localKey : undefined);
if (!adminKeyPath) { console.error('Service account not found'); process.exit(2); }
import admin from 'firebase-admin';
const key = JSON.parse(fs.readFileSync(adminKeyPath,'utf8'));
admin.initializeApp({ credential: admin.credential.cert(key), projectId: key.project_id });
const db = admin.firestore();
(async function main(){
  const snap = await db.collection('projects').get();
  console.log('Projects in Firestore:', snap.size);
  for(const doc of snap.docs){
    const d = doc.data();
    console.log('-', doc.id, '|', d.name || '(no name)', '| contractor:', d.contractorName || d.contractorId || '(none)', '| amount:', d.contractAmount ?? '—');
  }
  process.exit(0);
})().catch((e)=>{ console.error(e); process.exit(1); });

