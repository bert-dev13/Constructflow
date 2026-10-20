import assert from 'node:assert/strict';
import type { ReportProgressEntry } from '../src/components/ReportProgressFeed';
import { genuineActualByDate, stampRecordedActual } from '../src/lib/firebase/sCurves.ts';
import type { SCurvePoint } from '../src/types';

function report(type: 'SWA' | 'STEWA', date: string, percent: number): ReportProgressEntry {
  return {
    reportNumber: `${type}-${date}`,
    reportType: type,
    date,
    percent,
    label: `${type} ${date}`,
    status: 'approved',
  };
}

function point(date: string): SCurvePoint {
  return { date, originalPlan: 1, currentPlan: 1, actual: 99 };
}

const reports = [
  report('SWA', '2026-08-06', 4.18),
  report('STEWA', '2026-08-06', 4.18),
  report('SWA', '2026-08-13', 6.36),
  report('SWA', '2026-08-27', 10.72),
  report('STEWA', '2026-09-10', 15.4),
];

const genuine = genuineActualByDate(reports);
assert.equal(genuine.size, 4, 'same-date SWA and STEWA are one point');
assert.equal(genuine.get('2026-08-06'), 4.18);
assert.equal(genuine.has('2026-08-20'), false);

const stamped = stampRecordedActual(
  ['2026-08-01', '2026-08-03', '2026-08-06', '2026-08-13', '2026-08-20', '2026-08-27', '2026-09-10'].map(point),
  reports,
  { start: '2026-08-20', end: '2026-09-03', revisedCompletion: '2026-09-20' },
  '2026-08-01',
);
const actualOn = (date: string) => stamped.find((row) => row.date === date)?.actual ?? null;

assert.equal(stamped.find((row) => row.actual != null)?.date, '2026-08-01');
assert.equal(actualOn('2026-08-01'), 0, 'project start anchors Actual at 0%');
assert.equal(actualOn('2026-08-03'), null, 'a date with no report has no Actual');
assert.equal(actualOn('2026-08-06'), 4.18);
assert.equal(actualOn('2026-08-13'), 6.36);
assert.equal(actualOn('2026-08-20'), 6.36, 'suspension start holds the last actual');
assert.equal(actualOn('2026-09-03'), 6.36, 'suspension end stays flat');
assert.equal(actualOn('2026-08-27'), null, 'a report inside suspension does not raise Actual');
assert.equal(actualOn('2026-09-10'), 15.4, 'the next report after suspension is kept');
assert.equal(
  stamped.filter((row) => row.date === '2026-08-20' || row.date === '2026-09-03').length,
  2,
);

const equalButDifferentDays = genuineActualByDate([
  report('SWA', '2026-08-06', 10),
  report('STEWA', '2026-08-13', 10),
]);
assert.equal(equalButDifferentDays.size, 2, 'equal percentages on different dates both remain');

console.log('actual suspension checks OK');
