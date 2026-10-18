import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';

// Launch Edge with remote debugging
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = 9222;

const profileDir = path.resolve('.tmp/edge-cdp-profile');
const edge = spawn(edgePath, [
  '--headless=new',
  '--disable-gpu',
  `--user-data-dir=${profileDir}`,
  `--remote-debugging-port=${port}`,
  'about:blank',
]);

async function waitPort() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Edge failed to start');
}

await waitPort();

// Get webSocketDebuggerUrl
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const wsUrl = targets[0].webSocketDebuggerUrl;

// Connect via WebSocket
const WebSocket = (await import('ws')).default;
const ws = new WebSocket(wsUrl);

await new Promise((resolve) => ws.on('open', resolve));

let id = 1;
function send(method: string, params: any = {}) {
  return new Promise<any>((resolve, reject) => {
    const curId = id++;
    const handler = (data: any) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === curId) {
        ws.off('message', handler);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id: curId, method, params }));
  });
}

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1248,
  height: 816,
  deviceScaleFactor: 1,
  mobile: false,
});
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

await send('Page.navigate', {
  url: 'file:///' + path.resolve('.tmp/test-realistic.html').replace(/\\/g, '/'),
});

await loadPromise;
await new Promise((r) => setTimeout(r, 500));

const evalRes = await send('Runtime.evaluate', {
  expression: `(() => {
    const body = document.body;
    const table = document.querySelector('table.grid');
    const summary = document.querySelector('.summary');
    const sigs = document.querySelector('.signatures');
    return {
      bodyScrollHeight: body.scrollHeight,
      bodyOffsetHeight: body.offsetHeight,
      bodyScrollWidth: body.scrollWidth,
      tableHeight: table ? table.offsetHeight : 0,
      summaryHeight: summary ? summary.offsetHeight : 0,
      sigsHeight: sigs ? sigs.offsetHeight : 0,
    };
  })()`,
  returnByValue: true,
});

console.log('Metrics:', evalRes.result.value);

ws.close();
edge.kill();
