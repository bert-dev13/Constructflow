import fs from 'node:fs';

async function main() {
  const res = await fetch('https://constructflow-plgu.vercel.app/_next/static/immutable/chunks/2rxwvwll1-x6x.js');
  const code = await res.text();
  const proj = code.match(/projectId:"([^"]+)"/)?.[1];
  const authDom = code.match(/authDomain:"([^"]+)"/)?.[1];
  console.log('Production projectId =', proj);
  console.log('Production authDomain =', authDom);

  const localEnv = fs.readFileSync('.env.local', 'utf8');
  const localProj = localEnv.match(/NEXT_PUBLIC_FIREBASE_PROJECT_ID=(.+)/)?.[1]?.trim().replace(/^["']|["']$/g, '');
  const localAuthDom = localEnv.match(/NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=(.+)/)?.[1]?.trim().replace(/^["']|["']$/g, '');

  console.log('Local projectId =', localProj);
  console.log('Local authDomain =', localAuthDom);
}

main().catch(console.error);
