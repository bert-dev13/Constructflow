import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { buildOfficialSwaHtml } from '../src/lib/officialReportHtml.ts';
import { realisticSwaReport } from './realisticSwaData.ts';

const outDir = path.resolve(process.cwd(), '.tmp');
fs.mkdirSync(outDir, { recursive: true });

// Read dependencies
const h2cJs = fs.readFileSync(path.resolve('node_modules/html2canvas/dist/html2canvas.min.js'), 'utf8');
const jspdfJs = fs.readFileSync(path.resolve('node_modules/jspdf/dist/jspdf.umd.min.js'), 'utf8');

// Generate realistic SWA HTML
const swaHtml = buildOfficialSwaHtml(realisticSwaReport);

const appHtml = `<!DOCTYPE html>
<html>
<head>
<script>${h2cJs}</script>
<script>${jspdfJs}</script>
</head>
<body style="margin:0;padding:0;background:#fff;">
<iframe id="doc-frame" style="border:0;width:1248px;height:1200px;"></iframe>
<script>
function unitToMm(value, unit) {
  if (unit === 'in') return value * 25.4;
  if (unit === 'px') return (value * 25.4) / 96;
  return value;
}
function unitToPx(value, unit) {
  if (unit === 'in') return value * 96;
  if (unit === 'mm') return (value * 96) / 25.4;
  return value;
}
function readPageBox(doc) {
  const css = Array.from(doc.querySelectorAll('style'))
    .map((node) => node.textContent ?? '')
    .join('\\n');
  const match = css.match(/@page\\s*\\{[^}]*size:\\s*([0-9.]+)(in|mm|px)\\s+([0-9.]+)(in|mm|px)/i);
  if (!match) return { widthMm: 210, heightMm: 297, cssWidthPx: 794 };
  const width = Number(match[1]);
  const height = Number(match[3]);
  return {
    widthMm: unitToMm(width, match[2]),
    heightMm: unitToMm(height, match[4]),
    cssWidthPx: Math.round(unitToPx(width, match[2])),
  };
}

function wrapTableCells(root) {
  root.querySelectorAll('th, td').forEach((cell) => {
    if (cell.dataset.pdfWrapped === '1') return;
    if (cell.closest('.letterhead, .header, .letterhead-table')) return;
    if (cell.querySelector(':scope > table')) return;
    const rect = cell.getBoundingClientRect();
    if (rect.width < 4) return;
    const style = root.ownerDocument.defaultView?.getComputedStyle(cell);
    const padX = (parseFloat(style?.paddingLeft || '0') || 0) + (parseFloat(style?.paddingRight || '0') || 0);
    const borderX =
      (parseFloat(style?.borderLeftWidth || '0') || 0) + (parseFloat(style?.borderRightWidth || '0') || 0);
    const inner = Math.max(1, Math.floor(rect.width - padX - borderX));
    cell.style.whiteSpace = 'normal';
    cell.style.height = 'auto';
    cell.style.maxHeight = 'none';
    cell.style.overflow = 'visible';
    cell.style.verticalAlign = 'top';
    cell.style.overflowWrap = 'anywhere';
    const wrapper = root.ownerDocument.createElement('div');
    wrapper.style.width = inner + 'px';
    wrapper.style.maxWidth = inner + 'px';
    wrapper.style.boxSizing = 'border-box';
    wrapper.style.whiteSpace = 'normal';
    wrapper.style.overflowWrap = 'anywhere';
    wrapper.style.wordBreak = 'break-word';
    wrapper.style.lineHeight = style?.lineHeight && style.lineHeight !== 'normal' ? style.lineHeight : '1.14';
    wrapper.style.fontSize = style?.fontSize || 'inherit';
    wrapper.style.textAlign = style?.textAlign || 'left';
    while (cell.firstChild) wrapper.appendChild(cell.firstChild);
    cell.appendChild(wrapper);
    cell.dataset.pdfWrapped = '1';
  });
}

function isSwaLandscapePage(page) {
  return page.widthMm > page.heightMm && page.widthMm >= 320 && page.heightMm <= 230;
}

async function run() {
  try {
    const frame = document.getElementById('doc-frame');
    const doc = frame.contentDocument;
    const body = doc.body;
    const page = readPageBox(doc);
    frame.style.width = page.cssWidthPx + 'px';
    wrapTableCells(body);
    await new Promise((r) => requestAnimationFrame(r));
    frame.style.height = Math.max(body.scrollHeight, body.offsetHeight, 800) + 'px';
    await new Promise((r) => requestAnimationFrame(r));

    const canvas = await html2canvas(body, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      logging: false,
      backgroundColor: '#ffffff',
      windowWidth: page.cssWidthPx,
    });

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({
      unit: 'mm',
      format: [page.widthMm, page.heightMm],
      orientation: 'landscape',
    });
    const pageCssHeight = (page.heightMm / page.widthMm) * Math.max(body.scrollWidth, 1);
    const contentCssWidth = Math.max(body.scrollWidth, 1);
    const fullCssHeight = Math.max(body.scrollHeight, 1);
    const fit = Math.min(1, pageCssHeight / fullCssHeight);
    const drawW = page.widthMm;
    const drawH = Math.min(page.heightMm, (fullCssHeight / contentCssWidth) * page.widthMm * fit);
    const offsetX = 0;
    const offsetY = Math.max(0, (page.heightMm - drawH) / 2);

    pdf.addImage(
      canvas.toDataURL('image/jpeg', 0.95),
      'JPEG',
      offsetX,
      offsetY,
      drawW,
      drawH,
    );

    const b64 = pdf.output('datauristring').split(',')[1];
    const canvasPng = canvas.toDataURL('image/png').split(',')[1];

    const elements = [
      ['report-no', doc.querySelector('.report-no')],
      ['letterhead', doc.querySelector('.letterhead')],
      ['title', doc.querySelector('h3, .doc-title')],
      ['meta', doc.querySelector('.meta')],
      ['table', doc.querySelector('table.grid')],
      ['summary', doc.querySelector('.summary')],
      ['signatures', doc.querySelector('.signatures')],
    ].map(([name, el]) => ({
      name,
      h: el ? el.offsetHeight : 0,
    }));

    const rows = Array.from(doc.querySelectorAll('table.grid tr')).map((tr: any, idx) => ({
      idx,
      text: tr.innerText.slice(0, 25).replace(/\n/g, ' '),
      h: tr.offsetHeight,
    }));

    await fetch('/api/done', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fit,
        pageCount: pdf.getNumberOfPages(),
        fullCssHeight,
        pageCssHeight,
        drawW,
        drawH,
        elements,
        tallRows: rows.filter((r) => r.h > 15),
        avgRowH: rows.reduce((s, r) => s + r.h, 0) / rows.length,
        b64,
        canvasPng,
      }),
    });
  } catch (err) {
    await fetch('/api/done', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: String(err) + '\\n' + err.stack }),
    });
  }
}

window.addEventListener('load', () => {
  const frame = document.getElementById('doc-frame');
  frame.onload = () => {
    setTimeout(run, 300);
  };
  frame.srcdoc = ${JSON.stringify(swaHtml)};
});
</script>
</body>
</html>`;

const PORT = 8099;
let resolvePromise: (value: any) => void;
const donePromise = new Promise<any>((resolve) => {
  resolvePromise = resolve;
});

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(appHtml);
    return;
  }
  if (req.url === '/api/done' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
      resolvePromise(JSON.parse(body));
    });
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', async () => {
  console.log('Server listening on port', PORT);
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const profileDir = path.join(outDir, 'edge-profile');
  const edge = spawn(edgePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `--user-data-dir=${profileDir}`,
    '--window-size=1400,1200',
    `http://127.0.0.1:${PORT}/`,
  ]);

  edge.stdout.on('data', (d) => console.log('Edge out:', d.toString()));
  edge.stderr.on('data', (d) => console.log('Edge err:', d.toString()));

  try {
    const result = await Promise.race([
      donePromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout after 25s')), 25000)),
    ]);
    console.log('PDF Result:', {
      fit: (result as any).fit,
      pageCount: (result as any).pageCount,
      fullCssHeight: (result as any).fullCssHeight,
      pageCssHeight: (result as any).pageCssHeight,
      drawW: (result as any).drawW,
      drawH: (result as any).drawH,
      elements: (result as any).elements,
      error: (result as any).error,
    });
    if ((result as any).b64) {
      const pdfPath = path.join(outDir, 'app-generated-swa.pdf');
      fs.writeFileSync(pdfPath, Buffer.from((result as any).b64, 'base64'));
      console.log('Saved PDF to:', pdfPath);
    }
    if ((result as any).canvasPng) {
      const canvasPath = path.join(outDir, 'app-canvas.png');
      fs.writeFileSync(canvasPath, Buffer.from((result as any).canvasPng, 'base64'));
      console.log('Saved canvas to:', canvasPath);
    }
  } catch (e) {
    console.error('Execution failed:', e);
  } finally {
    edge.kill();
    server.close();
  }
});
