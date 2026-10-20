import assert from 'node:assert/strict';
import { buildReportNumberFromData, displayReportNumber } from '../src/lib/reportNumber.ts';
import { formatReportDisplayDate } from '../src/lib/stewaCalculations.ts';

const swa = {
  report_type: 'SWA',
  report_number: 'SWA-2026-OCT-12-18',
  report_data: {
    as_of_range: '1',
    as_of_start: '2026-07-06',
    as_of_end: '2026-07-09',
  },
};
const stewa = {
  report_type: 'STEWA',
  report_number: 'STEWA-2026-OCT-01-07',
  report_data: {
    period_start: '2026-07-06',
    period_end: '2026-07-12',
    report_date: '2026-10-18',
  },
};
const iar = {
  report_type: 'IAR',
  report_number: 'IAR-2026-OCT-18',
  report_data: { report_date: '2026-07-06' },
};

assert.equal(displayReportNumber(swa), 'SWA-2026-JUL-06-09');
assert.equal(formatReportDisplayDate(swa), 'July 6–9, 2026');
assert.equal(displayReportNumber(stewa), 'STEWA-2026-JUL-06-12');
assert.equal(formatReportDisplayDate(stewa), 'July 6–12, 2026');
const crossMonthStewa = {
  report_type: 'STEWA',
  report_number: 'STEWA-2026-JAN-04-21',
  report_data: {
    period_start: '2026-01-04',
    period_end: '2026-08-21',
  },
};
assert.equal(displayReportNumber(crossMonthStewa), 'STEWA-2026-JAN-04-AUG-21');
assert.equal(formatReportDisplayDate(crossMonthStewa), 'January 4 – August 21, 2026');
assert.equal(displayReportNumber(iar), 'IAR-2026-JUL-06');
assert.equal(buildReportNumberFromData('IAR', { report_date: '2026-07-06' }), 'IAR-2026-JUL-06');
assert.notEqual(buildReportNumberFromData('IAR', { report_date: '2026-07-06' }), 'IAR-2026-JUL-06-06');

console.log('acceptance IDs OK');
console.log('SWA', displayReportNumber(swa), formatReportDisplayDate(swa));
console.log('STEWA', displayReportNumber(stewa), formatReportDisplayDate(stewa));
console.log('IAR', displayReportNumber(iar), formatReportDisplayDate(iar));
