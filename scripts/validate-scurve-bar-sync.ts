import { deriveBarChartFromPdm } from '../src/lib/scheduleSync';
import { computeSCurveCostSummary } from '../src/lib/sCurveItems';
import {
  buildSCurvePeriods,
  buildTheoreticalBarChartTasks,
  buildTheoreticalSCurvePeriods,
  buildTheoreticalTargetPeriods,
  theoreticalAccomplishmentPct,
  theoreticalPlanPct,
  theoreticalSchedulePct,
} from '../src/lib/sCurvePeriods';
import type { PdmActivity, PdmDependency } from '../src/types';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

const activities: PdmActivity[] = [
  { id: 'a', number: '1.0', name: 'Mobilization', duration: 5 },
  { id: 'b', number: '2.0', name: 'Earthworks', duration: 12 },
  { id: 'c', number: '3.0', name: 'Pavement', duration: 30 },
];

const dependencies: PdmDependency[] = [
  { id: 'ab', fromId: 'a', toId: 'b', type: 'FS' },
  { id: 'bc', fromId: 'b', toId: 'c', type: 'FS' },
];

const derived = deriveBarChartFromPdm(activities, dependencies);

assert(derived.projectDuration === 47, `Expected project duration 47, got ${derived.projectDuration}`);
assert(
  JSON.stringify(
    derived.barChartTasks.map((task) => ({
      name: task.name,
      startDay: task.startDay,
      endDay: task.endDay,
    })),
  ) ===
    JSON.stringify([
      { name: 'Mobilization', startDay: 1, endDay: 5 },
      { name: 'Earthworks', startDay: 6, endDay: 17 },
      { name: 'Pavement', startDay: 18, endDay: 47 },
    ]),
  'PDM-derived bar chart span mismatch',
);

const costSummary = computeSCurveCostSummary([
  { activityId: 'a', itemNo: '1.0', description: 'Mobilization', quantity: 1, unitCost: 100000 },
  { activityId: 'b', itemNo: '2.0', description: 'Earthworks', quantity: 2, unitCost: 150000 },
  { activityId: 'c', itemNo: '3.0', description: 'Pavement', quantity: 4, unitCost: 400000 },
]);

assert(costSummary.totalContractAmount === 2000000, 'Total contract amount should be 2,000,000');
assert(round4(costSummary.totalWeightPct) === 100, 'Weight percentage should total 100%');

const periods10 = buildSCurvePeriods({
  startDate: '2026-01-01',
  projectDuration: derived.projectDuration,
  activities: derived.activities,
  costItems: costSummary.items,
  totalContractAmount: costSummary.totalContractAmount,
  reportingInterval: '10_day',
});

const periods30 = buildSCurvePeriods({
  startDate: '2026-01-01',
  projectDuration: derived.projectDuration,
  activities: derived.activities,
  costItems: costSummary.items,
  totalContractAmount: costSummary.totalContractAmount,
  reportingInterval: '30_day',
});

assert(periods10.length === 5, `Expected 5 ten-day periods, got ${periods10.length}`);
assert(periods30.length === 2, `Expected 2 monthly periods, got ${periods30.length}`);
assert(
  round4(periods10.reduce((sum, period) => sum + period.targetAccomplishmentPct, 0)) === 100,
  '10-day target accomplishment should total 100%',
);
assert(
  round4(periods30.reduce((sum, period) => sum + period.targetAccomplishmentPct, 0)) === 100,
  '30-day target accomplishment should total 100%',
);

// Pro-rata overlap: Pavement (days 18–47) must contribute to BOTH monthly periods,
// not dump its full weight into the finish month only.
const pavementWt =
  costSummary.items.find((item) => item.activityId === 'c')?.weightPct ?? 0;
assert(pavementWt > 0, 'Pavement weight should be positive');
assert(
  periods30[0]!.targetAccomplishmentPct > 0 && periods30[1]!.targetAccomplishmentPct > 0,
  '30-day periods must both receive a portion of cross-boundary activities',
);
assert(
  periods30[1]!.targetAccomplishmentPct < pavementWt + 0.0001,
  'Period 2 must not receive the entire pavement weight when the activity starts in period 1',
);

// Explicit 30-day grouping sample (days 1–15, 16–30, 31–45, 46–60).
const sampleActivities: PdmActivity[] = [
  { id: 's1', number: '1', name: 'A1', duration: 15, es: 1, ef: 15 },
  { id: 's2', number: '2', name: 'A2', duration: 15, es: 16, ef: 30 },
  { id: 's3', number: '3', name: 'A3', duration: 15, es: 31, ef: 45 },
  { id: 's4', number: '4', name: 'A4', duration: 15, es: 46, ef: 60 },
];
const sampleCosts = computeSCurveCostSummary(
  sampleActivities.map((activity) => ({
    activityId: activity.id,
    itemNo: activity.number,
    description: activity.name,
    quantity: 1,
    unitCost: 250000,
  })),
);
const sample30 = buildSCurvePeriods({
  startDate: '2026-01-01',
  projectDuration: 60,
  activities: sampleActivities,
  costItems: sampleCosts.items,
  totalContractAmount: sampleCosts.totalContractAmount,
  reportingInterval: '30_day',
});
assert(sample30.length === 2, 'Sample 60d/30-day should have 2 periods');
assert(
  Math.abs(sample30[0]!.targetAccomplishmentPct - 50) < 0.01,
  `First 30 days should cover A1+A2 (~50%), got ${sample30[0]!.targetAccomplishmentPct}`,
);
assert(
  Math.abs(sample30[1]!.targetAccomplishmentPct - 50) < 0.01,
  `Second 30 days should cover A3+A4 (~50%), got ${sample30[1]!.targetAccomplishmentPct}`,
);

// --- Theoretical: cosine formula over PDM duration + selected interval ---

function assertMonotonicToEnd(
  rows: ReturnType<typeof buildTheoreticalSCurvePeriods>,
  label: string,
) {
  assert(rows.length >= 1, `${label}: expected at least one period`);
  assert(round4(rows[rows.length - 1]!.cumulativePct) === 100, `${label}: must finish at 100%`);
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    if (i > 0) {
      assert(
        row.cumulativePct + 0.0001 >= rows[i - 1]!.cumulativePct,
        `${label}: cumulative must be monotonic at period ${row.periodIndex}`,
      );
      assert(
        rows[i - 1]!.cumulativePct < 100 - 0.0001 || i === rows.length - 1,
        `${label}: must not reach 100% before the final period (hit at period ${rows[i - 1]!.periodIndex})`,
      );
    }
  }
  assert(
    round4(rows.reduce((sum, period) => sum + period.targetAccomplishmentPct, 0)) === 100,
    `${label}: period targets must sum to 100%`,
  );
}

const expectedAt30of180 = theoreticalAccomplishmentPct(30, 180);
assert(
  Math.abs(expectedAt30of180 - 6.6987) < 0.01,
  `Expected ~6.70% at day 30 of 180, got ${expectedAt30of180}`,
);
assert(theoreticalAccomplishmentPct(180, 180) === 100, 'Day 180 of 180 must be 100%');
assert(theoreticalAccomplishmentPct(0, 180) === 0, 'Day 0 must be 0%');

const theoretical180_30 = buildTheoreticalSCurvePeriods({
  startDate: '2026-01-01',
  projectDuration: 180,
  totalContractAmount: costSummary.totalContractAmount,
  reportingInterval: '30_day',
});
assert(theoretical180_30.length === 6, `180d/30-day: expected 6 periods, got ${theoretical180_30.length}`);
assert(
  round4(theoretical180_30[0]!.cumulativePct) === round4(expectedAt30of180),
  `180d/30-day period 1 cumulative should match formula (~6.70%), got ${theoretical180_30[0]!.cumulativePct}`,
);
assertMonotonicToEnd(theoretical180_30, '180d/30-day');
assert(
  round4(theoretical180_30.reduce((sum, row) => sum + row.targetAccomplishmentPhp, 0)) ===
    round4(costSummary.totalContractAmount),
  'Theoretical period amounts must sum to the contract amount',
);
assert(
  round4(theoretical180_30[theoretical180_30.length - 1]!.cumulativePhp) ===
    round4(costSummary.totalContractAmount),
  'Theoretical final cumulative amount must equal the contract amount',
);

const theoretical180_10 = buildTheoreticalSCurvePeriods({
  startDate: '2026-01-01',
  projectDuration: 180,
  totalContractAmount: costSummary.totalContractAmount,
  reportingInterval: '10_day',
});
assert(theoretical180_10.length === 18, `180d/10-day: expected 18 periods, got ${theoretical180_10.length}`);
assert(
  round4(theoretical180_10[2]!.cumulativePct) === round4(expectedAt30of180),
  `180d/10-day period 3 (day 30) should match ~6.70%, got ${theoretical180_10[2]!.cumulativePct}`,
);
assert(
  round4(theoretical180_10[0]!.cumulativePct) === theoreticalAccomplishmentPct(10, 180),
  '180d/10-day period 1 must use Current Period = 10',
);
assertMonotonicToEnd(theoretical180_10, '180d/10-day');

// Not flat/linear: early increment < mid increment for a cosine S-curve
assert(
  theoretical180_30[0]!.targetAccomplishmentPct < theoretical180_30[2]!.targetAccomplishmentPct,
  '180d/30-day: cosine curve should accelerate through the middle periods',
);

const theoreticalBar = buildTheoreticalBarChartTasks({
  totalPeriods: 4,
  reportingInterval: '10_day',
});

assert(theoreticalBar.totalDays === 40, `Expected 40 theoretical days, got ${theoreticalBar.totalDays}`);
assert(theoreticalBar.tasks.length === 4, 'Expected 4 theoretical bar tasks');
assert(
  JSON.stringify(theoreticalBar.tasks.map((task) => [task.startDay, task.endDay])) ===
    JSON.stringify([
      [1, 10],
      [11, 20],
      [21, 30],
      [31, 40],
    ]),
  'Theoretical bar chart task spans do not align with theoretical periods',
);

const targetWindow = {
  startDate: '2026-01-01',
  endDate: '2026-06-30',
  totalDurationDays: 180,
};
assert(theoreticalSchedulePct('2026-01-01', targetWindow) === 0, 'Target starts at 0%');
assert(theoreticalSchedulePct('2026-06-30', targetWindow) === 100, 'Target ends at 100%');
assert(
  theoreticalSchedulePct('2026-01-31', targetWindow) === theoreticalAccomplishmentPct(30, 180),
  'Target on day 30 must use the cosine formula',
);
assert(
  theoreticalPlanPct('2025-12-01', targetWindow) === 0,
  'Target before the schedule is 0%',
);
assert(
  theoreticalPlanPct('2026-07-15', targetWindow) === 100,
  'Target after the schedule is 100%',
);

const suspendedTarget = {
  startDate: '2026-01-01',
  endDate: '2026-07-10',
  totalDurationDays: 180,
  suspensionStart: '2026-02-01',
  suspensionEnd: '2026-02-10',
};
const frozen = theoreticalSchedulePct('2026-01-31', suspendedTarget);
assert(theoreticalSchedulePct('2026-02-01', suspendedTarget) === frozen, 'Target freezes on suspension start');
assert(theoreticalSchedulePct('2026-02-10', suspendedTarget) === frozen, 'Target stays frozen through suspension');
assert(
  (theoreticalSchedulePct('2026-02-11', suspendedTarget) ?? 0) > (frozen ?? 0),
  'Target resumes after suspension',
);
assert(theoreticalSchedulePct('2026-07-10', suspendedTarget) === 100, 'Revised target end is 100%');

const originalOnly = {
  startDate: '2026-01-01',
  endDate: '2026-06-30',
  totalDurationDays: 180,
};
assert(
  theoreticalSchedulePct('2026-03-01', originalOnly) !==
    theoreticalSchedulePct('2026-03-01', suspendedTarget),
  'A revised suspension must not copy the original percentage',
);

const targetPeriods = buildTheoreticalTargetPeriods({
  window: targetWindow,
  totalContractAmount: 1_000_000,
  reportingInterval: '30_day',
});
assert(targetPeriods[0]?.targetAccomplishmentPct === targetPeriods[0]?.cumulativePct, 'First period target is the formula value');
assert(
  targetPeriods[0]?.cumulativePct === theoreticalAccomplishmentPct(30, 180),
  'Initial period cumulative must already be the cosine formula',
);
assert(targetPeriods[targetPeriods.length - 1]?.cumulativePct === 100, 'Target periods end at 100%');
assert(
  Math.abs((targetPeriods[0]?.targetAccomplishmentPhp ?? 0) - (1_000_000 * (targetPeriods[0]?.cumulativePct ?? 0)) / 100) < 0.02,
  'Target PHP follows the same percentage',
);

console.log('S-Curve and Bar Chart synchronization validation passed.');
