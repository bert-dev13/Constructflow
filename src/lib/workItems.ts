export interface WorkItem {
  id: string;
  isSection?: boolean;
  payItemId?: string;
  payItemVersion?: number;
  snapshotItemNo?: string;
  snapshotDescription?: string;
  snapshotUnit?: string;
  itemNo: string;
  description: string;
  unit: string;
  unitPrice: number;
  programmedQty: number;
  /** Optional revised quantity — used when showRevisedQuantity is on. */
  revisedQty?: number;
  previous: number;
  /** Manually entered THIS PERIOD amount (peso). */
  thisPeriod: number;
  /** Manually entered TO DATE amount (peso). */
  toDateInput?: number;
  remarks: string;
}

export interface WorkItemComputed extends WorkItem {
  contractAmount: number;
  weightPct: number;
  revisedAmount: number;
  revisedWeightPct: number;
  toDate: number;
  accomplishmentWeightPct: number;
  status: string;
  /** Section/subheader row. Stored data is unchanged; this is derived for display and totals. */
  isSection: boolean;
}

export interface SwaTotals {
  totalContractAmount: number;
  totalWeightPct: number;
  totalRevisedAmount: number;
  totalRevisedWeightPct: number;
  totalPreviousAccomplishment: number;
  totalThisAccomplishment: number;
  totalToDateAccomplishment: number;
  totalToDateWeightPct: number;
  pctThisAccomplishment: number;
  totalVoucher: number;
}

/**
 * Excel Remarks/Status:
 * IF(L=H,"COMPLETED",IF(L=0,"Not Yet Started","On going"))
 * where L and H are ROUND(amount / totalContract, 5) fractions.
 */
export function workItemRemarksStatus(
  accomplishmentWeightPct: number,
  plannedWeightPct: number,
): string {
  const accompFrac = Math.round((accomplishmentWeightPct / 100) * 1e5) / 1e5;
  const plannedFrac = Math.round((plannedWeightPct / 100) * 1e5) / 1e5;
  if (accompFrac === 0) return 'Not Yet Started';
  if (plannedFrac > 0 && accompFrac === plannedFrac) return 'COMPLETED';
  return 'On going';
}

/** A real Roman numeral, not a pay-item fragment such as "C" inside "C.1". */
function isRomanNumeral(token: string): boolean {
  return /^(?=[IVXLCDM])M{0,4}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/i.test(
    token,
  );
}

/**
 * Section headings typed in Item No., such as "I. OTHER GENERAL REQUIREMENTS",
 * "II. SITE WORKS", or a bare marker "I" / "II." / "III.".
 * Ordinary item numbers ("1", "B.5", "101(3)b1", "C.1") are not headings.
 */
export function isSwaSectionHeading(itemNo: string): boolean {
  const text = itemNo.trim();
  if (!text) return false;
  if (/^[IVXLCDM]+(?:\.[A-Za-z]+)?(?:\s*[.\-–—:])?\s*$/i.test(text)) {
    const roman = text.replace(/[^IVXLCDM]/gi, '');
    return isRomanNumeral(roman);
  }
  const titled = text.match(/^([IVXLCDM]+)(?:\.[A-Za-z]+)?\s*[.\-–—:]\s+[A-Za-z]/i);
  return titled != null && isRomanNumeral(titled[1] ?? '');
}

/**
 * A section/header row. The Item No. decides this. Leftover quantity or price
 * on a heading stays stored, but the row is not a pay item.
 */
export function isSwaSectionRow(item: WorkItem): boolean {
  if (item.isSection) return true;
  const itemNo = String(item.snapshotItemNo || item.itemNo || '').trim();
  const description = String(item.snapshotDescription || item.description || '').trim();
  if (isSwaSectionHeading(itemNo)) return true;
  return itemNo === '' && isSwaSectionHeading(description);
}

function blankSectionRow(item: WorkItem): WorkItemComputed {
  return {
    ...item,
    previous: Number(item.previous) || 0,
    revisedQty: item.revisedQty ?? 0,
    thisPeriod: 0,
    contractAmount: 0,
    weightPct: 0,
    revisedAmount: 0,
    revisedWeightPct: 0,
    toDate: 0,
    accomplishmentWeightPct: 0,
    status: '',
    remarks: item.remarks?.trim() ? item.remarks : '',
    isSection: true,
  };
}

/** Lump sum units such as "L.S.", "LS", or "lump sum". */
export function isLumpSumUnit(unit: string | null | undefined): boolean {
  const normalized = String(unit ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  return normalized === 'ls' || normalized === 'lumpsum';
}

/**
 * TO DATE for L.S. = (Programmed Quantity / 2) × Unit Price.
 * TO DATE for every other unit = Contract Amount (Programmed Quantity × Unit Price).
 */
export function swaToDateAmount(programmedQty: number, unitPrice: number, unit = ''): number {
  const qty = Number(programmedQty) || 0;
  const price = Number(unitPrice) || 0;
  if (isLumpSumUnit(unit)) return (qty / 2) * price;
  return qty * price;
}

/** THIS PERIOD = TO DATE − PREVIOUS */
export function swaThisPeriodAmount(toDate: number, previous: number): number {
  return (Number(toDate) || 0) - (Number(previous) || 0);
}

/**
 * Excel WEIGHT %: (Item Contract Amount / Total Contract Amount) × 100.
 * Calculated using full precision first, with rounding applied only at final display formatting.
 * WEIGHT % ACCOMPLISHMENT uses the same full-precision calculation on TO DATE ÷ Total Contract Amount.
 */
export function swaWeightPct(amount: number, totalProjectCost: number): number {
  const cost = Number(totalProjectCost) || 0;
  if (cost <= 0) return 0;
  return ((Number(amount) || 0) / cost) * 100;
}

export function computeWorkItems(
  items: WorkItem[],
  lessAmount = 0,
  showRevised = false,
): { items: WorkItemComputed[]; totals: SwaTotals } {
  // Section headings stay on the form but do not enter Total Project Cost or accomplishment.
  const billable = items.filter((item) => !isSwaSectionRow(item));
  const totalProjectCost = billable.reduce(
    (sum, i) => sum + (Number(i.unitPrice) || 0) * (Number(i.programmedQty) || 0),
    0,
  );

  const totalRevised = showRevised
    ? billable.reduce((sum, i) => {
        const rq = Number(i.revisedQty) || 0;
        const up = Number(i.unitPrice) || 0;
        const pq = Number(i.programmedQty) || 0;
        return sum + (rq > 0 ? up * rq : up * pq);
      }, 0)
    : 0;

  const computed: WorkItemComputed[] = items.map((item) => {
    if (isSwaSectionRow(item)) return blankSectionRow(item);
    const contractAmount = (Number(item.unitPrice) || 0) * (Number(item.programmedQty) || 0);
    // WEIGHT % = (Contract Amount / Total Project Cost) × 100
    const weightPct = swaWeightPct(contractAmount, totalProjectCost);
    const revisedQty = Number(item.revisedQty) || 0;
    const useRevised = showRevised && revisedQty > 0;
    const revisedAmount = useRevised
      ? (Number(item.unitPrice) || 0) * revisedQty
      : showRevised
        ? contractAmount
        : 0;
    const revisedWeightPct = showRevised
      ? swaWeightPct(revisedAmount, totalRevised)
      : 0;

    const previous = Number(item.previous) || 0;
    let thisPeriod = Number(item.thisPeriod) || 0;
    // TO DATE = PREVIOUS + THIS PERIOD
    // If thisPeriod is 0 and previous is 0, but toDateInput was entered (legacy data), infer thisPeriod:
    if (
      thisPeriod === 0 &&
      item.toDateInput != null &&
      Number.isFinite(Number(item.toDateInput)) &&
      Number(item.toDateInput) > previous
    ) {
      thisPeriod = Number(item.toDateInput) - previous;
    }
    const toDate = previous + thisPeriod;

    // WEIGHT % ACCOMPLISHMENT = (TO DATE / Total Project Cost) × 100
    const accomplishmentWeightPct = swaWeightPct(toDate, totalProjectCost);
    const plannedWeight = useRevised ? revisedWeightPct : weightPct;
    const status = workItemRemarksStatus(accomplishmentWeightPct, plannedWeight);

    return {
      ...item,
      previous,
      revisedQty,
      thisPeriod,
      contractAmount,
      weightPct,
      revisedAmount,
      revisedWeightPct,
      toDate,
      toDateInput: toDate,
      accomplishmentWeightPct,
      status,
      isSection: false,
      // Keep user-entered remarks; fall back to Excel status when blank.
      remarks: item.remarks?.trim() ? item.remarks : status,
    };
  });

  const billableComputed = computed.filter((row) => !row.isSection);
  const totalWeightPct = billableComputed.reduce((s, i) => s + (Number(i.weightPct) || 0), 0);
  const totalRevisedAmount = billableComputed.reduce((s, i) => s + (Number(i.revisedAmount) || 0), 0);
  const totalRevisedWeightPct = billableComputed.reduce((s, i) => s + (Number(i.revisedWeightPct) || 0), 0);
  const totalPreviousAccomplishment = billableComputed.reduce((s, i) => s + (Number(i.previous) || 0), 0);
  const totalThisAccomplishment = billableComputed.reduce((s, i) => s + (Number(i.thisPeriod) || 0), 0);
  const totalToDateAccomplishment = billableComputed.reduce((s, i) => s + (Number(i.toDate) || 0), 0);
  // Full-precision summation of accomplished Weight % for all applicable items
  const totalToDateWeightPct = billableComputed.reduce((s, i) => s + (Number(i.accomplishmentWeightPct) || 0), 0);
  // % This Accomplishment in SWA represents the cumulative physical accomplishment certified as of this statement (matching Excel cell =L34 / sum of row %W)
  const pctThisAccomplishment = totalToDateWeightPct;

  return {
    items: computed,
    totals: {
      totalContractAmount: totalProjectCost,
      totalWeightPct,
      totalRevisedAmount,
      totalRevisedWeightPct,
      totalPreviousAccomplishment,
      totalThisAccomplishment,
      totalToDateAccomplishment,
      totalToDateWeightPct,
      pctThisAccomplishment,
      totalVoucher: totalThisAccomplishment - lessAmount,
    },
  };
}

export function computeStewaSlippage(actual: number, planned: number): number {
  return Math.round((actual - planned) * 100) / 100;
}

export function formatMoney(n: number): string {
  const value = Number(n) || 0;
  if (!Number.isFinite(value)) return '0.00';
  return value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Two-decimal percent, rounding 5 away from zero the way the Excel percent format does. */
export function formatPct(n: number): string {
  const value = Number(n) || 0;
  if (!Number.isFinite(value)) return '0.00';
  const sign = value < 0 ? -1 : 1;
  const hundredths = Math.round(Number((Math.abs(value) * 100).toFixed(8))) / 100;
  return (sign * hundredths).toFixed(2);
}

export function newWorkItem(): WorkItem {
  return {
    id: crypto.randomUUID(),
    payItemId: '',
    payItemVersion: undefined,
    snapshotItemNo: '',
    snapshotDescription: '',
    snapshotUnit: '',
    itemNo: '',
    description: '',
    unit: '',
    unitPrice: 0,
    programmedQty: 0,
    revisedQty: 0,
    previous: 0,
    thisPeriod: 0,
    remarks: '',
  };
}
