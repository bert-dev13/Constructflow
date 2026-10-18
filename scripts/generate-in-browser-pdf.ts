import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const outDir = path.resolve(process.cwd(), '.tmp');
fs.mkdirSync(outDir, { recursive: true });

// Read html2canvas and jsPDF libraries from node_modules
const h2cJs = fs.readFileSync(path.resolve('node_modules/html2canvas/dist/html2canvas.min.js'), 'utf8');
const jspdfJs = fs.readFileSync(path.resolve('node_modules/jspdf/dist/jspdf.umd.min.js'), 'utf8');

// Build test runner HTML that executes the rasterize function from downloadReportPdf
const runnerHtml = `<!DOCTYPE html>
<html>
<head>
<script>${h2cJs}</script>
<script>${jspdfJs}</script>
</head>
<body style="margin:0;padding:0;background:#fff;">
<iframe id="test-frame" src="test-realistic.html" style="border:0;width:1248px;height:1200px;"></iframe>
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
    wrapper.style.lineHeight = '1.3';
    wrapper.style.textAlign = style?.textAlign || 'left';
    while (cell.firstChild) wrapper.appendChild(cell.firstChild);
    cell.appendChild(wrapper);
    cell.dataset.pdfWrapped = '1';
  });
}

function isSwaLandscapePage(page) {
  return page.widthMm > page.heightMm && page.widthMm >= 320 && page.heightMm <= 230;
}

async function renderPdf() {
  const frame = document.getElementById('test-frame');
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
  const drawW = page.widthMm * fit;
  const drawH = (fullCssHeight / contentCssWidth) * page.widthMm * fit;
  const offsetX = (page.widthMm - drawW) / 2;
  const offsetY = Math.max(0, (page.heightMm - drawH) / 2);

  pdf.addImage(
    canvas.toDataURL('image/jpeg', 0.92),
    'JPEG',
    offsetX,
    offsetY,
    drawW,
    drawH,
  );

  const b64 = pdf.output('datauristring').split(',')[1];
  window.__PDF_RESULT__ = {
    b64,
    fit,
    pageCount: pdf.getNumberOfPages(),
    bodyScrollHeight: body.scrollHeight,
    pageCssHeight,
    drawW,
    drawH,
    offsetX,
    offsetY,
  };
}

window.addEventListener('load', () => {
  const frame = document.getElementById('test-frame');
  frame.onload = () => {
    setTimeout(renderPdf, 300);
  };
});
</script>
</body>
</html>`;

const runnerPath = path.join(outDir, 'runner.html');
fs.writeFileSync(runnerPath, runnerHtml, 'utf8');

console.log('Runner HTML written:', runnerPath);
