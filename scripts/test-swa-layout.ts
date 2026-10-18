import fs from 'fs';
import path from 'path';
import { buildOfficialSwaHtml } from '../src/lib/officialReportHtml';
import { realisticSwaReport } from './realisticSwaData';

const outDir = path.resolve(process.cwd(), '.tmp');
fs.mkdirSync(outDir, { recursive: true });

let html = buildOfficialSwaHtml(realisticSwaReport as any);

const measureScript = `
<div id="layout-metrics" style="display:none"></div>
<script>
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

window.addEventListener('load', () => {
  setTimeout(() => {
    const body = document.body;
    const beforeH = body.scrollHeight;
    const beforeW = body.scrollWidth;
    wrapTableCells(body);
    const afterH = body.scrollHeight;
    const afterW = body.scrollWidth;

    const widthMm = 13 * 25.4;
    const heightMm = 8.5 * 25.4;
    const pageCssHeight = (heightMm / widthMm) * Math.max(body.scrollWidth, 1);
    const fit = Math.min(1, pageCssHeight / afterH);

    const metrics = {
      windowWidth: window.innerWidth,
      beforeH,
      beforeW,
      afterH,
      afterW,
      pageCssHeight,
      fit,
    };
    document.getElementById('layout-metrics').innerText = JSON.stringify(metrics);
  }, 100);
});
</script>
`;

html = html.replace('</body>', `${measureScript}</body>`);
const htmlPath = path.join(outDir, 'test-realistic.html');
fs.writeFileSync(htmlPath, html, 'utf8');
