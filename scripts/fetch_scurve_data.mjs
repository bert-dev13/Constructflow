import fs from 'fs';
import path from 'path';
// load .env.local if present
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) {
      const k = m[1].trim();
      let v = m[2].trim();
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      process.env[k] = v;
    }
  }
}

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, getDoc } from 'firebase/firestore';

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

if (!config.apiKey || !config.projectId) {
  console.error('Missing Firebase config in .env.local');
  process.exit(1);
}

const app = initializeApp(config);
const db = getFirestore(app);

async function main() {
  const out = { fetchedAt: new Date().toISOString(), projectDocs: {} };
  console.log('Listing sCurves collection documents (project IDs)...');
  const col = collection(db, 'sCurves');
  const snap = await getDocs(col);
  for (const d of snap.docs) {
    const id = d.id;
    out.projectDocs[id] = { id, hasDoc: true };
    try {
      const docRef = doc(db, 'sCurves', id);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        out.projectDocs[id].data = docSnap.data();
      } else {
        out.projectDocs[id].data = null;
      }
      // try snapshots subcollection first snapshot
      const snapCol = collection(db, `sCurves/${id}/snapshots`);
      const snapSnap = await getDocs(snapCol);
      out.projectDocs[id].snapshots = snapSnap.docs.map((ds) => ({ id: ds.id, data: ds.data() }));
    } catch (err) {
      out.projectDocs[id].error = String(err?.message || err);
    }
  }
  const OUT = path.join(process.cwd(), 'scurve-remote.json');
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log('Wrote', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

