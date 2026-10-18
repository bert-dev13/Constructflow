import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { buildOfficialReportHtml } from './officialReportHtml';
import type { SwaStewaReport } from './swaStewaApi';

function triggerAnchorDownload(href: string, fileName: string) {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.target = '_blank';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/** Download an existing PDF URL (Storage / CDN). */
export async function downloadPdfFromUrl(url: string, fileName: string) {
  const safeName = fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Could not fetch PDF');
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    triggerAnchorDownload(objectUrl, safeName);
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch {
    // Cross-origin Storage URLs may block fetch; open in a new tab instead.
    triggerAnchorDownload(url, safeName);
  }
}

type PageBox = { widthMm: number; heightMm: number; cssWidthPx: number };

function unitToMm(value: number, unit: string) {
  if (unit === 'in') return value * 25.4;
  if (unit === 'px') return (value * 25.4) / 96;
  return value;
}

function unitToPx(value: number, unit: string) {
  if (unit === 'in') return value * 96;
  if (unit === 'mm') return (value * 96) / 25.4;
  return value;
}

/** Read the document's own @page size. Falls back to A4. */
function readPageBox(doc: Document): PageBox {
  const css = Array.from(doc.querySelectorAll('style'))
    .map((node) => node.textContent ?? '')
    .join('\n');
  const match = css.match(/@page\s*\{[^}]*size:\s*([0-9.]+)(in|mm|px)\s+([0-9.]+)(in|mm|px)/i);
  if (!match) return { widthMm: 210, heightMm: 297, cssWidthPx: 794 };
  const width = Number(match[1]);
  const height = Number(match[3]);
  return {
    widthMm: unitToMm(width, match[2]),
    heightMm: unitToMm(height, match[4]),
    cssWidthPx: Math.round(unitToPx(width, match[2])),
  };
}

/** Give each cell an inner block at its real width so long text wraps instead of painting over the next cell. */
function wrapTableCells(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('th, td').forEach((cell) => {
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
    wrapper.style.width = `${inner}px`;
    wrapper.style.maxWidth = `${inner}px`;
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

function rowBreaks(element: HTMLElement, pageCssHeight: number): number[] {
  const total = element.scrollHeight;
  const rootTop = element.getBoundingClientRect().top;
  const blocks = Array.from(
    element.querySelectorAll<HTMLElement>('tr, .signatures, .section-lbl, .summary, .lined-box, .problems-box'),
  )
    .map((node) => {
      const rect = node.getBoundingClientRect();
      return { top: rect.top - rootTop, bottom: rect.bottom - rootTop };
    })
    .filter((block) => block.bottom - block.top > 1)
    .sort((a, b) => a.top - b.top || a.bottom - b.bottom);

  const cuts = [0];
  let cursor = 0;
  while (total - cursor > pageCssHeight + 1) {
    const limit = cursor + pageCssHeight;
    let cut = limit;
    for (const block of blocks) {
      if (block.bottom <= cursor + 2) continue;
      if (block.top >= limit) break;
      if (block.top > cursor + 12 && block.bottom > limit) {
        cut = block.top;
        break;
      }
      if (block.bottom <= limit) cut = block.bottom;
    }
    if (cut <= cursor + 8) cut = Math.min(limit, total);
    cuts.push(Math.min(cut, total));
    cursor = cuts[cuts.length - 1]!;
  }
  return cuts;
}

async function waitForImages(doc: Document) {
  await Promise.all(
    Array.from(doc.images).map(
      (img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              img.onload = () => resolve();
              img.onerror = () => resolve();
            }),
    ),
  );
}

function isSwaLandscapePage(page: PageBox): boolean {
  // Official SWA uses 13in × 8.5in (Legal landscape).
  return page.widthMm > page.heightMm && page.widthMm >= 320 && page.heightMm <= 230;
}

async function rasterize(element: HTMLElement, page: PageBox, format: 'PNG' | 'JPEG'): Promise<Blob> {
  wrapTableCells(element);
  await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)));
  const frame = element.ownerDocument.defaultView?.frameElement as HTMLElement | null;
  if (frame) frame.style.height = `${Math.max(element.scrollHeight, element.offsetHeight, 800)}px`;
  await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)));
  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    allowTaint: true,
    logging: false,
    backgroundColor: '#ffffff',
    windowWidth: page.cssWidthPx,
  });

  const pdf = new jsPDF({
    unit: 'mm',
    format: [page.widthMm, page.heightMm],
    orientation: page.widthMm > page.heightMm ? 'landscape' : 'portrait',
  });
  const scale = canvas.width / Math.max(element.scrollWidth, 1);
  const pageCssHeight = (page.heightMm / page.widthMm) * Math.max(element.scrollWidth, 1);
  const contentCssWidth = Math.max(element.scrollWidth, 1);

  // SWA must always be exactly one landscape bond page.
  if (isSwaLandscapePage(page)) {
    const fullCssHeight = Math.max(element.scrollHeight, 1);
    const fit = Math.min(1, pageCssHeight / fullCssHeight);
    const drawW = page.widthMm;
    const drawH = Math.min(page.heightMm, (fullCssHeight / contentCssWidth) * page.widthMm * fit);
    const offsetX = 0;
    const offsetY = Math.max(0, (page.heightMm - drawH) / 2);
    pdf.addImage(
      format === 'JPEG' ? canvas.toDataURL('image/jpeg', 0.95) : canvas.toDataURL('image/png'),
      format,
      offsetX,
      offsetY,
      drawW,
      drawH,
    );
    return pdf.output('blob');
  }

  const cuts = rowBreaks(element, pageCssHeight);
  cuts.forEach((start, index) => {
    const end = index + 1 < cuts.length ? cuts[index + 1]! : element.scrollHeight;
    const srcY = Math.max(0, Math.round(start * scale));
    const srcH = Math.max(1, Math.round(end * scale) - srcY);
    const pageCanvas = element.ownerDocument.createElement('canvas');
    pageCanvas.width = canvas.width;
    pageCanvas.height = srcH;
    const context = pageCanvas.getContext('2d');
    if (!context) return;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    context.drawImage(canvas, 0, srcY, canvas.width, srcH, 0, 0, canvas.width, srcH);
    const sliceMm = (srcH / scale / contentCssWidth) * page.widthMm;
    if (index > 0) pdf.addPage();
    pdf.addImage(
      format === 'JPEG' ? pageCanvas.toDataURL('image/jpeg', 0.92) : pageCanvas.toDataURL('image/png'),
      format,
      0,
      0,
      page.widthMm,
      sliceMm,
    );
  });

  return pdf.output('blob');
}

async function htmlDocumentToPdfBlob(html: string, format: 'PNG' | 'JPEG'): Promise<Blob> {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;left:-12000px;top:0;width:900px;height:1200px;border:0;background:#fff;';
  document.body.appendChild(iframe);
  try {
    await new Promise<void>((resolve) => {
      iframe.onload = () => resolve();
      iframe.srcdoc = html;
    });
    const doc = iframe.contentDocument;
    const body = doc?.body;
    if (!doc || !body) throw new Error('Could not render the document.');
    const page = readPageBox(doc);
    iframe.style.width = `${page.cssWidthPx}px`;
    await waitForImages(doc);
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)));
    iframe.style.height = `${Math.max(body.scrollHeight, body.offsetHeight, 800)}px`;
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)));
    return await rasterize(body, page, format);
  } finally {
    iframe.remove();
  }
}

/** Same capture used by report download and the approval-email attachment. */
export async function elementToPdfBlob(element: HTMLElement, format: 'PNG' | 'JPEG' = 'PNG'): Promise<Blob> {
  const doc = element.ownerDocument;
  if (doc.defaultView && doc.defaultView !== window && doc.documentElement) {
    return htmlDocumentToPdfBlob(`<!DOCTYPE html>${doc.documentElement.outerHTML}`, format);
  }
  return rasterize(element, readPageBox(doc), format);
}

/** Render an HTML element (or iframe body) to a multi-page A4 PDF and download it. */
export async function downloadElementAsPdf(element: HTMLElement, fileName: string) {
  const safeName = fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`;
  const blob = await elementToPdfBlob(element);
  const objectUrl = URL.createObjectURL(blob);
  triggerAnchorDownload(objectUrl, safeName);
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the approved PDF.'));
    reader.readAsDataURL(blob);
  });
}

/** Official approved report, rendered the same way as Download PDF. */
export async function officialReportPdfBase64(report: SwaStewaReport): Promise<string> {
  const html = buildOfficialReportHtml(report);
  if (!html) throw new Error('This report has no approved document.');

  const blob = await htmlDocumentToPdfBlob(html, 'JPEG');
  return blobToBase64(blob);
}

/** Capture the open preview. Use a stored PDF only when that preview is not on screen. */
export async function downloadReportPreviewPdf(options: {
  fileName: string;
  pdfUrl?: string | null;
  frame?: HTMLIFrameElement | null;
  element?: HTMLElement | null;
}) {
  const { fileName, pdfUrl, frame, element } = options;
  const frameBody = frame?.contentDocument?.body ?? null;
  const target = [element, frameBody].find((node) => node && node.innerText.trim()) ?? null;

  if (target) {
    await downloadElementAsPdf(target, fileName);
    return;
  }
  if (pdfUrl) {
    await downloadPdfFromUrl(pdfUrl, fileName);
    return;
  }

  throw new Error('Preview content is not ready to download.');
}
