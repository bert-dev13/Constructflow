import fs from 'fs';
import path from 'path';

function countPdfPages(filePath: string): { pages: number; size: number } {
  const buf = fs.readFileSync(filePath);
  const str = buf.toString('latin1');
  // Match /Type /Page (excluding /Pages)
  const matches = str.match(/\/Type\s*\/Page\b/g) || [];
  return { pages: matches.length, size: buf.length };
}

const printPdf = path.resolve('.tmp/test-realistic-print.pdf');
if (fs.existsSync(printPdf)) {
  const info = countPdfPages(printPdf);
  console.log('PRINT PDF (window.print / Edge):', printPdf, '-> Pages:', info.pages, 'Size:', info.size);
}
const appPdf = path.resolve('.tmp/app-generated-swa.pdf');
if (fs.existsSync(appPdf)) {
  const info = countPdfPages(appPdf);
  console.log('APP DOWNLOAD / ATTACHMENT PDF (jsPDF):', appPdf, '-> Pages:', info.pages, 'Size:', info.size);
}
