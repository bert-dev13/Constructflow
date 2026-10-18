#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
const repoRoot = process.cwd();
const localKey = path.resolve(repoRoot, 'construction-9dd1b-firebase-adminsdk-fbsvc-920488f9d5.json');
const adminKeyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || (fs.existsSync(localKey) ? localKey : undefined);
if (!adminKeyPath) {
  console.error('Service account key not found.');
  process.exit(2);
}
import admin from 'firebase-admin';
const key = JSON.parse(fs.readFileSync(adminKeyPath, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(key), projectId: key.project_id });
const afs = admin.firestore();
import { originalBarChartTasks, revisedBarChartTasks, readSuspensionWindow } from '../src/lib/scheduleBaselines';

async function main() {
  const projectId = '9wSZsFc2AUsfKDJojOXt';
  const snap = await afs.doc(`schedules/${projectId}`).get();
  if (!snap.exists) {
    console.error('No schedule doc for', projectId);
    process.exit(1);
  }
  const data = snap.data() || {};
  const activities = (data.activities || []);
  const projectStart = data.projectStart || data.project_start_date || data.projectStartDate || (data.projectId ? null : null);
  // Determine suspension info from schedule doc fields if present
  const suspension = readSuspensionWindow({
    baselineMode: data.baselineMode,
    status: data.status,
    suspensionStart: data.suspensionStartDate || data.suspension_start_date || data.suspensionStart,
    suspensionEnd: data.suspensionEndDate || data.suspension_end_date || data.suspensionEnd,
    revisedCompletion: data.revisedCompletionDate || data.revised_completion_date || null,
    plannedEndDate: data.plannedEndDate || data.planned_end_date || null,
    projectStart: projectStart,
  });
  console.log('suspension detected:', !!suspension, suspension);

  const original = originalBarChartTasks(activities);
  console.log('Original tasks count:', original.length);
  let origHasSusp = 0;
  for (const t of original) {
    const suspSeg = (t.segments || []).find((s) => s.type === 'suspended');
    if (suspSeg) {
      origHasSusp++;
      console.log('Original task with suspended segment:', t.id, t.name, suspSeg);
    }
  }
  console.log('Original tasks with suspended segments:', origHasSusp);

  if (suspension) {
    const revisedRes = revisedBarChartTasks(activities, projectStart || data.projectStart || data.project_start_date || '', suspension);
    console.log('Revised tasks count:', revisedRes.tasks.length, 'suspensionDays', revisedRes.suspensionDays);
    let revHasSusp = 0;
    for (const t of revisedRes.tasks) {
      const suspSeg = (t.segments || []).find((s) => s.type === 'suspended');
      if (suspSeg) {
        revHasSusp++;
      }
    }
    console.log('Revised tasks with suspended segments:', revHasSusp);
  }
}

main().catch((e)=>{ console.error(e); process.exit(1); });

