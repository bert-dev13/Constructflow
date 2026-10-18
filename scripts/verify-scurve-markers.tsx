#!/usr/bin/env tsx
import fs from 'fs';
import path from 'path';
import admin from 'firebase-admin';
import { originalCurveDisplayDates, sampleSeriesDisplayDates } from '../src/lib/curveUtils';

const repoRoot = process.cwd();
const localKey = path.resolve(repoRoot, 'construction-9dd1b-firebase-adminsdk-fbsvc-920488f9d5.json');
const adminKeyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || (fs.existsSync(localKey) ? localKey : undefined);
if (!adminKeyPath) {
  console.error('Service account key not found. Set GOOGLE_APPLICATION_CREDENTIALS or place service account JSON at', localKey);
  process.exit(2);
}
const key = JSON.parse(fs.readFileSync(adminKeyPath, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(key), projectId: key.project_id });
const afs = admin.firestore();

async function main() {
  // Find a project that has sCurves snapshot and SWA reports
  const projectsSnap = await afs.collection('projects').get();
  let found = null as null | { projectId: string; points: any[]; genuineSwaDates: string[] };
  for (const p of projectsSnap.docs) {
    const pid = p.id;
    const sCurveSnap = await afs.collection('sCurves').doc(pid).get();
    if (!sCurveSnap.exists) continue;
    const data = sCurveSnap.data() as any;
    const points = (data.points ?? []) as Array<{ date: string; originalPlan?: number; currentPlan?: number; actual?: number }>;
    const reportsSnap = await afs.collection('reports').where('projectId', '==', pid).where('reportType', '==', 'SWA').get();
    const swaReports = reportsSnap.docs.map((d) => d.data()).filter((r) => r.date && r.percent != null);
    if (points.length > 0 && swaReports.length > 0) {
      found = { projectId: pid, points, genuineSwaDates: swaReports.map((r) => String(r.date).slice(0, 10)) };
      break;
    }
  }
  let projectId: string;
  let points: Array<{ date: string; originalPlan?: number; currentPlan?: number; actual?: number }>;
  let genuineSwaDates: string[];
  if (!found) {
    console.warn('No project with sCurves snapshot and SWA reports found — running synthetic test.');
    // Build synthetic daily points for 30 days with three genuine SWA actuals.
    const start = new Date('2026-07-01T00:00:00Z');
    const makeIso = (d: Date) => d.toISOString().slice(0, 10);
    const syntheticPoints = [];
    for (let i = 0; i < 30; i += 1) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      syntheticPoints.push({
        date: `${makeIso(d)}T00:00:00Z`,
        originalPlan: Math.round((i / 29) * 100 * 100) / 100,
        currentPlan: Math.round((i / 29) * 100 * 100) / 100,
        actual: null,
      });
    }
    // genuine SWA actuals at day 5, 12, 25
    const swaIdx = [5, 12, 25];
    const genuineDates: string[] = [];
    for (const idx of swaIdx) {
      syntheticPoints[idx].actual = Math.round(( (idx+1) / 29) * 100 * 100) / 100;
      genuineDates.push(syntheticPoints[idx].date.slice(0, 10));
    }
    projectId = 'synthetic-e2e';
    points = syntheticPoints;
    genuineSwaDates = genuineDates;
    console.log('Using synthetic project', projectId, 'with genuine SWA dates:', genuineSwaDates);
  } else {
    projectId = found.projectId;
    points = found.points;
    genuineSwaDates = found.genuineSwaDates;
    console.log('Using project', projectId);
  }

  const periodsList = [5, 10, 15, 20];
  for (const periods of periodsList) {
    const originalDates = originalCurveDisplayDates(points.map((p) => ({ date: p.date, originalPlan: p.originalPlan })), periods);
    const targetDates = sampleSeriesDisplayDates(points.map((p) => ({ date: p.date, currentPlan: p.currentPlan })), 'currentPlan', periods);
    // Actual visible dots per new logic: only genuine SWA dates that exist in points actual
    const pointDatesSet = new Set(points.filter((p) => typeof p.actual === 'number' && Number.isFinite(p.actual)).map((p) => p.date.slice(0, 10)));
    const actualVisible = genuineSwaDates.filter((d) => pointDatesSet.has(d));

    console.log(`Periods = ${periods}`);
    console.log(`  Original visible dots = ${originalDates.length}`);
    console.log(`  Target visible dots = ${targetDates.length}`);
    console.log(`  Genuine SWA records = ${genuineSwaDates.length}`);
    console.log(`  Actual visible dots = ${actualVisible.length}`);
    console.log('----');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

