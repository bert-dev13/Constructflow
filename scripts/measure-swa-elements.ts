import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { buildOfficialSwaHtml } from '../src/lib/officialReportHtml.ts';
import { realisticSwaReport } from './realisticSwaData.ts';

const html = buildOfficialSwaHtml(realisticSwaReport as any);

const probeHtml = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;">
<iframe id="f" style="width:1248px;height:1200px;border:0;"></iframe>
<script>
window.addEventListener('load', () => {
  const f = document.getElementById('f');
  f.onload = () => {
    setTimeout(() => {
      const doc = f.contentDocument;
      const b = doc.body;
      const header = doc.querySelector('.letterhead');
      const meta = doc.querySelector('.meta');
      const table = doc.querySelector('table.grid');
      const summary = doc.querySelector('.summary');
      const sigs = doc.querySelector('.signatures');

      const rows = Array.from(doc.querySelectorAll('table.grid tr')).map((tr, idx) => ({
        idx,
        text: tr.innerText.slice(0, 30).replace(/\\n/g, ' '),
        h: tr.offsetHeight,
      }));

      const data = {
        bodyScrollHeight: b.scrollHeight,
        bodyOffsetHeight: b.offsetHeight,
        headerH: header ? header.offsetHeight : 0,
        metaH: meta ? meta.offsetHeight : 0,
        tableH: table ? table.offsetHeight : 0,
        summaryH: summary ? summary.offsetHeight : 0,
        sigsH: sigs ? sigs.offsetHeight : 0,
        rowCount: rows.length,
        rowsHSum: rows.reduce((acc, r) => acc + r.h, 0),
        tallRows: rows.filter(r => r.h > 18),
      };
      fetch('/done', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    }, 100);
  };
  f.srcdoc = ${JSON.stringify(html)};
});
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(probeHtml);
    return;
  }
  if (req.url === '/done') {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => {
      console.log('MEASURED DATA:', JSON.stringify(JSON.parse(b), null, 2));
      res.end('ok');
      server.close();
      edge.kill();
    });
    return;
  }
});

server.listen(8097, () => {
  console.log('Listening 8097');
});

const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless',
  '--disable-gpu',
  '--window-size=1400,1200',
  'http://localhost:8097/',
]);
