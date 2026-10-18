import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { buildOfficialSwaHtml } from '../src/lib/officialReportHtml.ts';
import { realisticSwaReport } from './realisticSwaData.ts';

const html = buildOfficialSwaHtml(realisticSwaReport as any);

const appHtml = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;">
<iframe id="doc-frame" style="border:0;width:1248px;height:1200px;"></iframe>
<script>
window.addEventListener('load', () => {
  const frame = document.getElementById('doc-frame');
  frame.onload = () => {
    setTimeout(() => {
      const doc = frame.contentDocument;
      const body = doc.body;
      const elements = [
        ['report-no', doc.querySelector('.report-no')],
        ['letterhead', doc.querySelector('.letterhead')],
        ['title', doc.querySelector('h3, .doc-title')],
        ['meta', doc.querySelector('.meta')],
        ['table', doc.querySelector('table.grid')],
        ['summary', doc.querySelector('.summary')],
        ['signatures', doc.querySelector('.signatures')],
      ].map(([name, el]) => {
        if (!el) return { name, exists: false };
        const rect = el.getBoundingClientRect();
        return {
          name,
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          height: Math.round(rect.height),
          offsetHeight: el.offsetHeight,
        };
      });

      fetch('/api/measure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bodyScrollHeight: body.scrollHeight,
          bodyOffsetHeight: body.offsetHeight,
          elements,
        }),
      });
    }, 200);
  };
  frame.srcdoc = ${JSON.stringify(html)};
});
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(appHtml);
    return;
  }
  if (req.url === '/api/measure' && req.method === 'POST') {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => {
      console.log('MEASURED BREAKDOWN:', JSON.stringify(JSON.parse(b), null, 2));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
      server.close();
      edge.kill();
    });
    return;
  }
});

server.listen(8096, () => {
  console.log('Measuring on 8096');
});

const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless',
  '--disable-gpu',
  '--window-size=1400,1200',
  'http://localhost:8096/',
]);
