async function checkProd() {
  const url = 'https://constructflow-plgu.vercel.app/';
  const res = await fetch(url);
  const html = await res.text();
  console.log('Production URL status:', res.status);
  const chunks = html.match(/\/static\/immutable\/chunks\/[^\"]+\.js/g) || [];
  console.log('Found chunks in HTML:', chunks.length);

  for (const chunk of chunks) {
    const chunkUrl = `https://constructflow-plgu.vercel.app/_next${chunk}`;
    const jsRes = await fetch(chunkUrl);
    const js = await jsRes.text();
    const mProj = js.match(/["']?projectId["']?\s*:\s*["']([^"']+)["']/i) || js.match(/projectId:"([^"]+)"/);
    const mAuth = js.match(/["']?authDomain["']?\s*:\s*["']([^"']+)["']/i) || js.match(/authDomain:"([^"]+)"/);
    const mKey = js.match(/["']?apiKey["']?\s*:\s*["']([^"']+)["']/i) || js.match(/apiKey:"([^"]+)"/);
    if (mProj || mAuth) {
      console.log('Found Firebase configuration in chunk:', chunk);
      console.log('  Production projectId =', mProj ? mProj[1] : 'unknown');
      console.log('  Production authDomain =', mAuth ? mAuth[1] : 'unknown');
      console.log('  Production apiKey prefix =', mKey ? mKey[1].slice(0, 10) + '...' : 'unknown');
      return;
    }
  }

  // Also check all script src matches
  const scripts = html.match(/src="([^"]+\.js)"/g) || [];
  console.log('Found script tags:', scripts.length);
  for (const scriptTag of scripts) {
    const src = scriptTag.slice(5, -1);
    const scriptUrl = src.startsWith('http') ? src : `https://constructflow-plgu.vercel.app${src}`;
    const jsRes = await fetch(scriptUrl);
    const js = await jsRes.text();
    if (js.includes('firebase') || js.includes('construction-') || js.includes('constructflow-')) {
      console.log('Found relevant script:', src);
      const mProj = js.match(/projectId:[\s]*["']([^"']+)["']/);
      const mAuth = js.match(/authDomain:[\s]*["']([^"']+)["']/);
      console.log('  projectId:', mProj ? mProj[1] : 'none');
      console.log('  authDomain:', mAuth ? mAuth[1] : 'none');
    }
  }
}

checkProd().catch(console.error);
