import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const PORT = 9334;
const profileDir = path.resolve('.tmp/edge-cdp-profile-' + Date.now());
fs.mkdirSync(profileDir, { recursive: true });

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const edge = spawn(edgePath, [
  '--headless',
  '--disable-gpu',
  '--no-sandbox',
  `--user-data-dir=${profileDir}`,
  `--remote-debugging-port=${PORT}`,
  'about:blank',
]);

async function waitPort() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Edge failed to start');
}

await waitPort();

// Get new page target
const newPageTarget = await (await fetch(`http://127.0.0.1:${PORT}/json/new`, { method: 'PUT' })).json();
const wsUrl = newPageTarget.webSocketDebuggerUrl;

const WebSocket = (await import('ws')).default;
const ws = new WebSocket(wsUrl);
await new Promise((resolve) => ws.on('open', resolve));

let reqId = 1;
function send(method: string, params: any = {}) {
  return new Promise<any>((resolve, reject) => {
    const id = reqId++;
    const handler = (data: any) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === id) {
        ws.off('message', handler);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await send('Page.enable');
await send('Runtime.enable');
ws.on('message', (data: any) => {
  const msg = JSON.parse(data.toString());
  if (msg.method === 'Runtime.consoleAPICalled') {
    console.log('BROWSER CONSOLE:', msg.params.args.map((a: any) => a.value ?? a.description).join(' '));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    console.error('BROWSER EXCEPTION:', msg.params.exceptionDetails);
  }
});

await send('Emulation.setDeviceMetricsOverride', {
  width: 1248,
  height: 816,
  deviceScaleFactor: 1,
  mobile: false,
});

async function navigateAndWait(url: string) {
  const loadPromise = new Promise((resolve) => {
    const handler = (data: any) => {
      const msg = JSON.parse(data.toString());
      if (msg.method === 'Page.loadEventFired') {
        ws.off('message', handler);
        resolve(true);
      }
    };
    ws.on('message', handler);
  });
  await send('Page.navigate', { url });
  await loadPromise;
}

try {
  // Step 1: Measure test-realistic.html
  console.log('Navigating to test-realistic.html...');
  await navigateAndWait('http://localhost:8089/test-realistic.html');
  await new Promise((r) => setTimeout(r, 400));

  const metrics = await send('Runtime.evaluate', {
    expression: `(() => {
      const body = document.body;
      const reportNo = document.querySelector('.report-no');
      const letterhead = document.querySelector('.letterhead');
      const title = document.querySelector('h3, .doc-title');
      const meta = document.querySelector('.meta');
      const table = document.querySelector('table.grid');
      const summary = document.querySelector('.summary');
      const sigs = document.querySelector('.signatures');
      return {
        bodyScrollHeight: body.scrollHeight,
        bodyOffsetHeight: body.offsetHeight,
        bodyScrollWidth: body.scrollWidth,
        reportNoH: reportNo ? reportNo.offsetHeight : 0,
        letterheadH: letterhead ? letterhead.offsetHeight : 0,
        titleH: title ? title.offsetHeight : 0,
        metaH: meta ? meta.offsetHeight : 0,
        tableH: table ? table.offsetHeight : 0,
        summaryH: summary ? summary.offsetHeight : 0,
        sigsH: sigs ? sigs.offsetHeight : 0,
      };
    })()`,
    returnByValue: true,
  });
  console.log('DOM METRICS for test-realistic.html:', metrics.result.value);

  // Step 2: Navigate to runner.html to run in-app rasterize/html2canvas/jsPDF
  console.log('Navigating to runner.html...');
  await navigateAndWait('http://localhost:8089/runner.html');

  // Poll for #pdf-metrics
  let pdfRes: any = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 400));
    const check = await send('Runtime.evaluate', {
      expression: `(() => {
        const el = document.getElementById('pdf-metrics');
        if (!el) return null;
        const b64 = document.getElementById('pdf-b64')?.value;
        const canvasB64 = document.getElementById('canvas-b64')?.value;
        return { metrics: el.textContent, b64, canvasB64 };
      })()`,
      returnByValue: true,
    });
    if (check.result?.value?.metrics) {
      pdfRes = check.result.value;
      break;
    }
  }

  if (!pdfRes) {
    console.error('Timed out waiting for pdf-metrics');
  } else {
    const parsed = JSON.parse(pdfRes.metrics);
    console.log('IN-APP PDF RENDER METRICS:', parsed);
    if (pdfRes.b64) {
      const outPath = path.resolve('.tmp/app-generated-swa.pdf');
      fs.writeFileSync(outPath, Buffer.from(pdfRes.b64, 'base64'));
      console.log('Saved app-generated-swa.pdf, bytes:', fs.statSync(outPath).size);
    }
    if (pdfRes.canvasB64) {
      const canvasPath = path.resolve('.tmp/app-canvas.png');
      fs.writeFileSync(canvasPath, Buffer.from(pdfRes.canvasB64, 'base64'));
      console.log('Saved app-canvas.png, bytes:', fs.statSync(canvasPath).size);
    }
  }
} finally {
  ws.close();
  edge.kill();
}
