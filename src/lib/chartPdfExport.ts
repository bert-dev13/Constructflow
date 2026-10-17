import { jsPDF } from 'jspdf';
import type { SCurvePoint } from '../types';
import type { BarChartTask } from '../types';
import type { ScheduleStatus, SCurveComparison } from './sCurveApi';
import type { SCurvePeriodRow } from './sCurvePeriods';
import { deduplicateBarTasks } from './scheduleBaselines';

function formatMoney(value: number): string {
  return value.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function asLines(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

function drawWrappedRow(doc: jsPDF, cells: string[], cols: number[], y: number, fontSize: number): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const widths = cols.map((x, index) => (cols[index + 1] ?? pageWidth - 10) - x - 2);
  const wrapped = cells.map((cell, index) => asLines(doc.splitTextToSize(String(cell), Math.max(8, widths[index] ?? 20))));
  const lineCount = Math.max(1, ...wrapped.map((lines) => lines.length));
  const lineHeight = fontSize * doc.getLineHeightFactor();
  let top = y;
  if (top + lineCount * lineHeight > pageHeight - 12) {
    doc.addPage();
    top = 16;
  }
  wrapped.forEach((lines, index) => {
    doc.text(lines, cols[index] ?? 14, top);
  });
  return top + lineCount * lineHeight + 1.2;
}

function addHeader(doc: jsPDF, title: string) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('ConstructFlow', 14, 18);
  doc.setFontSize(12);
  doc.text(title, 14, 26);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(`Generated ${new Date().toLocaleString()}`, 14, 32);
  doc.setTextColor(0);
}

function addStatusBlock(doc: jsPDF, status: ScheduleStatus | null, y: number): number {
  if (!status) return y;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`Status: ${status.label}`, 14, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const lines: string[] = [];
  if (status.planned_pct != null) lines.push(`Target Plan: ${status.planned_pct}%`);
  if (status.actual_pct != null) lines.push(`Actual Plan: ${status.actual_pct}%`);
  if (status.slippage_pct != null) lines.push(`Variance: ${status.slippage_pct}%`);
  doc.text(lines.join('   ·   '), 14, y + 7);
  return y + 16;
}

export type SCurvePdfInput = {
  projectLabel?: string;
  points: SCurvePoint[];
  comparisons: SCurveComparison[];
  periods: SCurvePeriodRow[];
  status: ScheduleStatus | null;
  targetPlanPercent?: number | null;
  targetPlanPhp?: number | null;
  actualPlanPercent?: number | null;
  /** Draw percentage text on the chart. Display only; does not change the values. */
  showPercentLabels?: boolean;
};

/** Whole numbers stay whole. Trailing zeros are dropped, so 25, 42.5, and 7.94 stay readable. */
export function formatChartPercent(value: unknown): string {
  if (value == null || value === '') return '';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '';
  const rounded = Math.round((n + Number.EPSILON) * 100) / 100;
  return `${rounded.toFixed(2).replace(/\.?0+$/, '')}%`;
}

/** Target and Actual labels collide when the percents are this close on the 0–100 scale. */
export function chartPercentsAreClose(value: number, other: number | null | undefined): boolean {
  return other != null && Number.isFinite(other) && Math.abs(value - other) <= 6;
}

export type PercentLabelSeed = {
  x: number;
  y: number;
  value: number;
  series: 'target' | 'original' | 'revised' | 'actual';
  width: number;
  date?: string;
};

export type PlacedPercentLabel = PercentLabelSeed & {
  text: string;
  labelX: number;
  labelY: number;
};

function percentLabelBoxesOverlap(a: PlacedPercentLabel, b: PlacedPercentLabel, fontSize: number): boolean {
  const aTop = a.labelY - fontSize * 0.85;
  const aBottom = a.labelY + fontSize * 0.25;
  const bTop = b.labelY - fontSize * 0.85;
  const bBottom = b.labelY + fontSize * 0.25;
  const xOverlap = Math.abs(a.labelX - b.labelX) < (a.width + b.width) / 2 - fontSize * 0.08;
  const yOverlap = aTop < bBottom && bTop < aBottom;
  return xOverlap && yOverlap;
}

/**
 * Target labels sit above their points and Actual labels sit below.
 * When those boxes still collide — including a crossing at a nearby date —
 * the labels are pushed further apart, then sideways if the plot edge stops them.
 */
export function placePercentLabels(
  items: PercentLabelSeed[],
  options: { fontSize: number; plotTop?: number; plotBottom?: number },
): PlacedPercentLabel[] {
  const { fontSize } = options;
  const minY = options.plotTop != null ? options.plotTop - fontSize * 1.7 : Number.NEGATIVE_INFINITY;
  const maxY = options.plotBottom != null ? options.plotBottom + fontSize * 0.6 : Number.POSITIVE_INFINITY;
  const labels: PlacedPercentLabel[] = items
    .filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y) && Number.isFinite(item.value) && item.width > 0)
    .map((item) => ({
      ...item,
      text: formatChartPercent(item.value),
      labelX: item.x,
      labelY: item.y,
    }))
    .sort((a, b) => a.x - b.x || (a.series === 'actual' ? 1 : 0) - (b.series === 'actual' ? 1 : 0));

  const placed: PlacedPercentLabel[] = [];
  for (const label of labels) {
    const candidates: Array<{ x: number; y: number }> = [];
    const nearBottom =
      label.series === 'actual' &&
      options.plotBottom != null &&
      options.plotBottom - label.y < fontSize * 4;
    for (let row = 0; row < 6; row += 1) {
      const y =
        label.series !== 'actual'
          ? label.y - fontSize * (1.35 + row * 1.2)
          : label.y + fontSize * (nearBottom ? 0.85 : 1.45 + row * 1.15);
      candidates.push({ x: label.x, y });
    }
    const homeY = label.series !== 'actual' ? label.y - fontSize * 1.35 : label.y + fontSize * (nearBottom ? 0.85 : 1.45);
    const insideY = label.series !== 'actual' ? label.y + fontSize * 1.35 : label.y - fontSize * 1.35;
    for (let step = 1; step <= 6; step += 1) {
      const shift = step * Math.max(fontSize, label.width * 0.6);
      candidates.push({ x: label.x - shift, y: homeY });
      candidates.push({ x: label.x + shift, y: homeY });
      candidates.push({ x: label.x, y: insideY + (label.series !== 'actual' ? 1 : -1) * (step - 1) * fontSize });
      candidates.push({ x: label.x - shift, y: insideY });
      candidates.push({ x: label.x + shift, y: insideY });
    }

    let chosen = candidates[0];
    for (const candidate of candidates) {
      const trial: PlacedPercentLabel = {
        ...label,
        labelX: candidate.x,
        labelY: Math.min(maxY, Math.max(minY, candidate.y)),
      };
      if (!placed.some((other) => percentLabelBoxesOverlap(trial, other, fontSize))) {
        chosen = { x: trial.labelX, y: trial.labelY };
        break;
      }
    }
    label.labelX = chosen.x;
    label.labelY = Math.min(maxY, Math.max(minY, chosen.y));
    placed.push(label);
  }

  return labels;
}

export type BarChartPdfInput = {
  projectLabel?: string;
  tasks: BarChartTask[];
  totalDays: number;
  timeNow: number;
  status: ScheduleStatus | null;
  targetPlanPercent?: number | null;
  actualPlanPercent?: number | null;
};

/** Build the S-Curve PDF from the same synchronized page data used on screen. */
export function buildSCurvePdf(input: SCurvePdfInput): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  addHeader(doc, `S-Curve Progress — ${input.projectLabel ?? 'Project'}`);
  let y = addStatusBlock(doc, input.status, 40);

  if (input.showPercentLabels && input.points.length > 0) {
    y = drawLabeledSCurve(doc, input.points, y);
  }

  if (input.targetPlanPercent != null || input.targetPlanPhp != null) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(
      `Current cumulative target: ${
        input.targetPlanPercent != null ? `${input.targetPlanPercent}%` : '—'
      }   ·   ${
        input.targetPlanPhp != null ? `P ${formatMoney(input.targetPlanPhp)}` : '—'
      }`,
      14,
      y,
    );
    y += 8;
  }

  if (input.periods.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Monthly Target Accomplishment Baseline', 14, y);
    y += 6;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    const baselineHeaders = ['Period', 'Date range', 'Target %', 'Target PHP', 'Cumulative %', 'Cumulative PHP'];
    const baselineCols = [14, 36, 98, 126, 162, 190];
    y = drawWrappedRow(doc, baselineHeaders, baselineCols, y, 8);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);

    for (const period of input.periods) {
      y = drawWrappedRow(
        doc,
        [
          period.label,
          `${period.startDate} to ${period.endDate}`,
          `${period.targetAccomplishmentPct.toFixed(2)}%`,
          `P ${formatMoney(period.targetAccomplishmentPhp)}`,
          `${period.cumulativePct.toFixed(2)}%`,
          `P ${formatMoney(period.cumulativePhp)}`,
        ],
        baselineCols,
        y,
        8,
      );
    }
    y += 4;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Target Plan vs Actual Plan (by date)', 14, y);
  y += 6;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  const headers = ['Date', 'Label', 'Target Plan %', 'Target PHP', 'Actual Plan %', 'Variance', 'Status'];
  const cols = [14, 38, 92, 120, 150, 176, 204];
  y = drawWrappedRow(doc, headers, cols, y, 8);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);

  const rows =
    input.comparisons.length > 0
      ? input.comparisons.map((c) => [
          c.date,
          c.date_label,
          String(c.target_pct),
          `P ${formatMoney(c.target_php)}`,
          String(c.actual_pct),
          String(c.variance_pct),
          c.status_label,
        ])
          : input.points
          .filter((p) => p.currentPlan != null || p.originalPlan != null || p.actual != null)
          .map((p) => {
            const target = p.currentPlan != null ? p.currentPlan : p.originalPlan;
            return [
              p.date,
              p.label ?? '',
              target != null ? String(target) : '—',
              p.cumulativePhp != null ? `P ${formatMoney(p.cumulativePhp)}` : '—',
              p.actual != null ? String(p.actual) : '—',
              target != null && p.actual != null
                ? String(Math.round((Number(p.actual) - Number(target)) * 100) / 100)
                : '—',
              '',
            ];
          });

  for (const row of rows) {
    y = drawWrappedRow(doc, row.map((cell) => String(cell)), cols, y, 8);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
  }

  return doc;
}

function drawLabeledSCurve(doc: jsPDF, points: SCurvePoint[], y: number): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  const left = 24;
  const width = 250;
  const height = 62;
  let top = y + 2;
  if (top + height + 16 > pageHeight - 12) {
    doc.addPage();
    top = 16;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(0);
  doc.text('S-Curve with percentage labels', 14, top);
  top += 4;
  const plotTop = top + 2;
  const plotBottom = plotTop + height;
  const plotRight = left + width;

  doc.setDrawColor(224, 223, 216);
  doc.setLineWidth(0.2);
  for (const tick of [0, 50, 100]) {
    const py = plotBottom - (tick / 100) * height;
    doc.line(left, py, plotRight, py);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(80);
    doc.text(`${tick}%`, left - 1.5, py + 1, { align: 'right' });
  }

  const lastIndex = Math.max(1, points.length - 1);
  const xAt = (index: number) => left + (index / lastIndex) * width;
  const yAt = (value: number) => plotBottom - (Math.min(100, Math.max(0, value)) / 100) * height;

  const drawSeries = (
    key: 'originalPlan' | 'currentPlan' | 'actual',
    color: [number, number, number],
    place: 'above' | 'below',
  ) => {
    const coords: Array<{ x: number; y: number; value: number; index: number }> = [];
    points.forEach((point, index) => {
      const value = point[key];
      if (value == null || !Number.isFinite(value)) return;
      coords.push({ x: xAt(index), y: yAt(value), value, index });
    });
    if (coords.length === 0) return;
    doc.setDrawColor(color[0], color[1], color[2]);
    doc.setLineWidth(0.45);
    for (let i = 1; i < coords.length; i += 1) {
      doc.line(coords[i - 1].x, coords[i - 1].y, coords[i].x, coords[i].y);
    }
    coords.forEach((coord) => {
      const point = points[coord.index];
      const other = key === 'originalPlan' ? point?.actual : point?.originalPlan;
      const close = chartPercentsAreClose(coord.value, other);
      const radius = close ? (place === 'above' ? 1.35 : 0.75) : 0.7;
      doc.setFillColor(color[0], color[1], color[2]);
      if (close && place === 'below') {
        doc.setDrawColor(255, 255, 255);
        doc.setLineWidth(0.35);
        doc.circle(coord.x, coord.y, radius, 'FD');
      } else {
        doc.circle(coord.x, coord.y, radius, 'F');
      }
    });
  };

  drawSeries('originalPlan', [37, 99, 235], 'above');
  const showRevised = points.some(
    (point) =>
      point.currentPlan != null &&
      point.originalPlan != null &&
      Math.abs(point.currentPlan - point.originalPlan) >= 0.05,
  );
  if (showRevised) drawSeries('currentPlan', [124, 58, 237], 'above');
  drawSeries('actual', [249, 115, 22], 'below');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);
  const labelFontMm = 2.1;
  const seeds: PercentLabelSeed[] = [];
  points.forEach((point, index) => {
    (['originalPlan', 'currentPlan', 'actual'] as const).forEach((key) => {
      const value = point[key];
      if (value == null || !Number.isFinite(value)) return;
      if (
        key === 'currentPlan' &&
        point.originalPlan != null &&
        Math.abs(value - point.originalPlan) < 0.05
      ) {
        return;
      }
      const text = formatChartPercent(value);
      seeds.push({
        x: xAt(index),
        y: yAt(value),
        value,
        series: key === 'actual' ? 'actual' : key === 'currentPlan' ? 'revised' : 'original',
        width: doc.getTextWidth(text),
      });
    });
  });
  for (const label of placePercentLabels(seeds, { fontSize: labelFontMm, plotTop, plotBottom })) {
    const color =
      label.series === 'actual' ? [249, 115, 22] : label.series === 'revised' ? [124, 58, 237] : [37, 99, 235];
    doc.setTextColor(color[0], color[1], color[2]);
    doc.text(label.text, label.labelX, label.labelY, { align: 'center' });
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(37, 99, 235);
  doc.text('Target Plan %', left, plotBottom + 5);
  doc.setTextColor(249, 115, 22);
  doc.text('Actual Plan %', left + 32, plotBottom + 5);
  doc.setTextColor(0);
  return plotBottom + 10;
}

/** Build the Bar Chart PDF from the same synchronized page data used on screen. */
export function buildBarChartPdf(input: BarChartPdfInput): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  addHeader(doc, `Bar Chart Schedule — ${input.projectLabel ?? 'Project'}`);
  let y = addStatusBlock(doc, input.status, 40);

  doc.setFontSize(9);
  doc.text(
    `Total days: ${input.totalDays}   ·   Time Now: ${input.timeNow || '— (Target Plan only)'}`,
    14,
    y,
  );
  y += 8;

  const tasks = deduplicateBarTasks(input.tasks);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  const hasSuspensions = tasks.some((t) => t.suspension != null);
  const cols = hasSuspensions
    ? [14, 26, 110, 130, 150, 195, 225, 250]
    : [14, 28, 120, 145, 170, 195];
  const headers = hasSuspensions
    ? ['#', 'Task', 'Start', 'End', 'Suspension', 'Actual end', 'Critical']
    : ['#', 'Task', 'Start', 'End', 'Actual end', 'Critical'];
  y = drawWrappedRow(doc, headers, cols, y, 8);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);

  for (const task of tasks) {
    const taskLabel = task.itemNo ? `${task.itemNo} - ${task.name}` : task.name;
    const row = hasSuspensions
      ? [
          String(task.index),
          taskLabel,
          String(task.startDay),
          String(task.endDay),
          task.suspension ? `Days ${task.suspension.startDay}–${task.suspension.endDay}` : '—',
          task.actualEndDay != null ? String(task.actualEndDay) : '—',
          task.isCritical ? 'Yes' : '',
        ]
      : [
          String(task.index),
          taskLabel,
          String(task.startDay),
          String(task.endDay),
          task.actualEndDay != null ? String(task.actualEndDay) : '—',
          task.isCritical ? 'Yes' : '',
        ];
    y = drawWrappedRow(doc, row, cols, y, 8);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
  }

  return doc;
}

export function sCurvePdfObjectUrl(input: SCurvePdfInput): string {
  return URL.createObjectURL(buildSCurvePdf(input).output('blob'));
}

export function barChartPdfObjectUrl(input: BarChartPdfInput): string {
  return URL.createObjectURL(buildBarChartPdf(input).output('blob'));
}

export function exportSCurvePdf(input: SCurvePdfInput) {
  buildSCurvePdf(input).save(`s-curve-${Date.now()}.pdf`);
}

export function exportBarChartPdf(input: BarChartPdfInput) {
  buildBarChartPdf(input).save(`bar-chart-${Date.now()}.pdf`);
}
