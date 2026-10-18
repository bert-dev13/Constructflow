import fs from 'fs';
import path from 'path';
import { buildOfficialSwaHtml } from '../src/lib/officialReportHtml.ts';
import { realisticSwaReport } from './realisticSwaData.ts';

const html = buildOfficialSwaHtml(realisticSwaReport);
const outPath = path.resolve('.tmp/test-realistic.html');
fs.writeFileSync(outPath, html, 'utf8');
console.log('Successfully wrote', outPath, 'bytes:', html.length);
