async function checkHtml() {
  const url = 'https://constructflow-plgu.vercel.app/';
  const res = await fetch(url);
  const html = await res.text();
  console.log('Status:', res.status);
  console.log('HTML length:', html.length);
  console.log('Snippet:\n', html.slice(0, 1000));
}
checkHtml().catch(console.error);
