import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Compile-free check via dynamic ts import through tsx when run with npx tsx
const { buildReportNumberFromData, displayReportNumber } = await import('../src/lib/reportNumber.ts');

assert.equal(
  buildReportNumberFromData('SWA', {
    as_of_range: '1',
    as_of_start: '2026-07-06',
    as_of_end: '2026-07-09',
  }),
  'SWA-2026-JUL-06-09',
);

assert.equal(
  buildReportNumberFromData('STEWA', {
    period_start: '2026-07-06',
    period_end: '2026-07-12',
    report_date: '2026-10-18',
  }),
  'STEWA-2026-JUL-06-12',
);

assert.equal(
  buildReportNumberFromData('IAR', {
    report_date: '2026-07-06',
  }),
  'IAR-2026-JUL-06',
);

assert.equal(
  displayReportNumber({
    report_type: 'SWA',
    report_number: 'SWA-2026-OCT-12-18',
    report_data: {
      as_of_range: '1',
      as_of_start: '2026-07-06',
      as_of_end: '2026-07-09',
    },
  }),
  'SWA-2026-JUL-06-09',
);

assert.equal(
  buildReportNumberFromData('STEWA', {
    period_covered: 'July 6–12, 2026',
  }),
  'STEWA-2026-JUL-06-12',
);

assert.equal(
  buildReportNumberFromData('STEWA', {
    period_start: '2026-01-04',
    period_end: '2026-08-21',
  }),
  'STEWA-2026-JAN-04-AUG-21',
);

assert.equal(
  buildReportNumberFromData('STEWA', {
    period_start: '2026-01-04',
    period_end: '2026-01-21',
  }),
  'STEWA-2026-JAN-04-21',
);

assert.equal(
  buildReportNumberFromData('STEWA', {
    report_date: '2026-08-21',
  }),
  'STEWA-2026-AUG-21',
);

assert.equal(
  buildReportNumberFromData('STEWA', {
    period_start: '2026-12-28',
    period_end: '2027-01-04',
  }),
  'STEWA-2026-DEC-28-2027-JAN-04',
);

assert.equal(
  displayReportNumber({
    report_type: 'STEWA',
    report_number: 'STEWA-2026-JAN-04-21',
    report_data: {
      period_start: '2026-01-04',
      period_end: '2026-08-21',
    },
  }),
  'STEWA-2026-JAN-04-AUG-21',
);

console.log('report number checks OK');
