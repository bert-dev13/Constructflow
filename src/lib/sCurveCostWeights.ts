import { collection, getDocs, query, where } from 'firebase/firestore';
import type { PdmActivity } from '../types';
import { isSwaSectionRow, type WorkItem } from './workItems';
import { normalizeActivityNameKey } from './pdm';
import { computeSCurveCostSummary, type SCurveCostItemInput, type SCurveCostSummary } from './sCurveItems';
import { db } from './firebase/config';
import { COLLECTIONS } from './firebase/collections';
import { listProjectBoq } from './firebase/projectBoq';
import { normalizePayItemNo } from './firebase/payItems';

export type SCurvePayItemMappingStatus = 'mapped' | 'unmapped' | 'needs_allocation';

export interface SCurveCostWeightAllocation {
  activityId: string;
  share: number;
}

export interface SCurveCostWeightMapping {
  key: string;
  allocations: SCurveCostWeightAllocation[];
}

export interface SCurvePayItemMappingLine {
  key: string;
  itemNo: string;
  description: string;
  amount: number;
  weightPct: number;
  status: SCurvePayItemMappingStatus;
  match: string;
  allocations: SCurveCostWeightAllocation[];
  candidateActivityIds: string[];
}

export interface SCurveCostWeightResult {
  summary: SCurveCostSummary;
  source: 'stored' | 'boq' | 'swa' | 'missing';
  weightNote: string;
  payItemMappings: SCurvePayItemMappingLine[];
}

const NAME_STOP_WORDS = new Set([
  'construction',
  'preparation',
  'course',
  'works',
  'work',
  'item',
  'items',
  'general',
  'other',
  'requirements',
]);

const ACTIVITY_ALIASES: Record<string, string[]> = {
  pccp: ['portland', 'cement', 'concrete', 'pavement'],
};

function significantTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/-/g, '')
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !NAME_STOP_WORDS.has(token));
}

function tokensCover(haystack: string, needle: string): boolean {
  const needleTokens = significantTokens(needle);
  if (needleTokens.length === 0) return false;
  const haystackTokens = new Set(significantTokens(haystack));
  return needleTokens.every((token) => haystackTokens.has(token));
}

function descriptionMatchesActivity(itemDescription: string, activityName: string): boolean {
  const activityTokens = significantTokens(activityName);
  return !(activityTokens.length === 1 && activityTokens[0]!.length <= 4) && tokensCover(itemDescription, activityName);
}

function aliasPhraseInDescription(description: string, phrase: string[]): boolean {
  const tokens = description
    .toLowerCase()
    .replace(/-/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (phrase.length === 0 || tokens.length < phrase.length) return false;
  for (let i = 0; i <= tokens.length - phrase.length; i += 1) {
    if (phrase.every((word, offset) => tokens[i + offset] === word)) return true;
  }
  return false;
}

function aliasMatchesActivity(itemDescription: string, activityName: string): boolean {
  const activityTokens = significantTokens(activityName);
  if (activityTokens.length !== 1) return false;
  const phrase = ACTIVITY_ALIASES[activityTokens[0]!];
  return !!phrase && aliasPhraseInDescription(itemDescription, phrase);
}

function uniqueMatch<T>(items: T[], predicate: (item: T) => boolean): T | null {
  const matches = items.filter(predicate);
  return matches.length === 1 ? matches[0]! : null;
}

function weightPctOf(amount: number, total: number): number {
  return total <= 0 || amount <= 0 ? 0 : Math.round((amount / total) * 1e6) / 1e4;
}

function lineAmount(row: WorkItem): number {
  const amount = (Number(row.programmedQty) || 0) * (Number(row.unitPrice) || 0);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function mappingKey(section: string, itemNo: string, description: string, occurrence: number): string {
  const base = [section, itemNo, description]
    .map((part) => part.trim().toLowerCase().replace(/\s+/g, ' '))
    .join('||');
  return occurrence > 1 ? `${base}#${occurrence}` : base;
}

function validAllocations(
  allocations: SCurveCostWeightAllocation[] | undefined,
  activities: PdmActivity[],
): SCurveCostWeightAllocation[] | null {
  if (!allocations || allocations.length === 0) return null;
  const activityIds = new Set(activities.map((activity) => activity.id));
  const valid = allocations.filter(
    (row) => activityIds.has(row.activityId) && Number(row.share) > 0 && Number.isFinite(row.share),
  );
  if (Math.abs(valid.reduce((sum, row) => sum + row.share, 0) - 1) > 0.005) return null;
  return valid;
}

function readStoredMappings(raw: unknown): SCurveCostWeightMapping[] {
  if (!Array.isArray(raw)) return [];
  const mappings: SCurveCostWeightMapping[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const key = String((entry as { key?: unknown }).key ?? '').trim();
    const allocationsRaw = (entry as { allocations?: unknown }).allocations;
    if (!key || !Array.isArray(allocationsRaw)) continue;
    const allocations: SCurveCostWeightAllocation[] = [];
    for (const allocation of allocationsRaw) {
      if (!allocation || typeof allocation !== 'object') continue;
      const activityId = String((allocation as { activityId?: unknown }).activityId ?? '').trim();
      const share = Number((allocation as { share?: unknown }).share);
      if (activityId && Number.isFinite(share)) {
        allocations.push({ activityId, share });
      }
    }
    mappings.push({ key, allocations });
  }
  return mappings;
}

/** Largest non-rejected SWA line-item set for the project (Candidate C `W`). */
async function loadLargestSwaLineItems(projectId: string): Promise<WorkItem[]> {
  try {
    const snap = await getDocs(query(collection(db, COLLECTIONS.reports), where('projectId', '==', projectId)));
    let best: WorkItem[] = [];
    let bestTotal = 0;
    for (const docSnap of snap.docs) {
      const data = docSnap.data() as Record<string, unknown>;
      if (String(data.reportType ?? '') !== 'SWA') continue;
      if (String(data.status ?? '') === 'rejected') continue;
      const rows = (data.lineItems ?? data.line_items) as WorkItem[] | undefined;
      if (!Array.isArray(rows) || rows.length === 0) continue;
      const total = rows.reduce((sum, row) => {
        const amount = (Number(row.programmedQty) || 0) * (Number(row.unitPrice) || 0);
        return sum + (Number.isFinite(amount) ? amount : 0);
      }, 0);
      if (total > bestTotal) {
        best = rows;
        bestTotal = total;
      }
    }
    return best;
  } catch {
    return [];
  }
}

function mapSwaPayItems(
  activities: PdmActivity[],
  swaRows: WorkItem[],
  storedMappings: SCurveCostWeightMapping[] = [],
) {
  const amountsByActivityId = new Map<string, number>();
  const storedByKey = new Map(storedMappings.map((row) => [row.key, row]));
  const occurrenceByIdentity = new Map<string, number>();
  const lines: SCurvePayItemMappingLine[] = [];
  let totalAmount = 0;
  let mappedAmount = 0;
  let sectionLabel = '';

  for (const row of swaRows) {
    if (isSwaSectionRow(row)) {
      sectionLabel = `${row.itemNo} ${row.description}`.trim();
      continue;
    }
    const amount = lineAmount(row);
    if (amount <= 0) continue;
    totalAmount += amount;

    const itemNo = String(row.itemNo ?? '');
    const description = String(row.description ?? '');
    const identity = `${sectionLabel}||${itemNo.trim().toLowerCase()}||${description.trim().toLowerCase()}`;
    const occurrence = (occurrenceByIdentity.get(identity) ?? 0) + 1;
    occurrenceByIdentity.set(identity, occurrence);
    const key = mappingKey(sectionLabel, itemNo, description, occurrence);
    const stored = storedByKey.get(key);
    const explicit = validAllocations(stored?.allocations, activities);
    const payItemId = String(row.payItemId ?? '').trim();
    const normalizedItemNo = normalizePayItemNo(itemNo);

    const byPayItem = uniqueMatch(activities, (activity) => !!payItemId && activity.payItemId === payItemId);
    const byItemNo = uniqueMatch(
      activities,
      (activity) => !!normalizedItemNo && normalizePayItemNo(activity.number) === normalizedItemNo,
    );
    const byName = uniqueMatch(activities, (activity) => {
      const nameKey = normalizeActivityNameKey(activity.name);
      return !!nameKey && nameKey === normalizeActivityNameKey(description);
    });
    const bySection = uniqueMatch(activities, (activity) => tokensCover(sectionLabel, activity.name));
    const descriptionMatches = activities.filter(
      (activity) =>
        descriptionMatchesActivity(description, activity.name) ||
        aliasMatchesActivity(description, activity.name),
    );
    const aliasOnly =
      descriptionMatches.length === 1 &&
      aliasMatchesActivity(description, descriptionMatches[0]!.name) &&
      !descriptionMatchesActivity(description, descriptionMatches[0]!.name);

    let status: SCurvePayItemMappingStatus = 'unmapped';
    let match = '';
    let allocations: SCurveCostWeightAllocation[] = stored?.allocations ?? [];
    let candidateActivityIds: string[] = [];

    if (explicit) {
      status = 'mapped';
      match = 'explicit';
      allocations = explicit;
    } else if (byPayItem) {
      status = 'mapped';
      match = 'pay_item';
      allocations = [{ activityId: byPayItem.id, share: 1 }];
    } else if (byItemNo) {
      status = 'mapped';
      match = 'item_no';
      allocations = [{ activityId: byItemNo.id, share: 1 }];
    } else if (byName) {
      status = 'mapped';
      match = 'name';
      allocations = [{ activityId: byName.id, share: 1 }];
    } else if (bySection) {
      status = 'mapped';
      match = 'section';
      allocations = [{ activityId: bySection.id, share: 1 }];
    } else if (descriptionMatches.length === 1) {
      status = 'mapped';
      match = aliasOnly ? 'alias' : 'description';
      allocations = [{ activityId: descriptionMatches[0]!.id, share: 1 }];
    } else if (descriptionMatches.length > 1) {
      status = 'needs_allocation';
      candidateActivityIds = descriptionMatches.map((activity) => activity.id);
      allocations = stored?.allocations ?? [];
    }

    if (status === 'mapped') {
      for (const allocation of allocations) {
        amountsByActivityId.set(
          allocation.activityId,
          (amountsByActivityId.get(allocation.activityId) ?? 0) + amount * allocation.share,
        );
      }
      mappedAmount += amount;
    }

    lines.push({
      key,
      itemNo,
      description,
      amount,
      weightPct: 0,
      status,
      match,
      allocations,
      candidateActivityIds,
    });
  }

  if (totalAmount > 0) {
    let running = 0;
    lines.forEach((line, index) => {
      const weightPct =
        index === lines.length - 1
          ? Math.round((100 - running) * 1e4) / 1e4
          : Math.round((line.amount / totalAmount) * 1e6) / 1e4;
      line.weightPct = weightPct;
      running += weightPct;
    });
  }

  return {
    amountsByActivityId,
    unmapped: lines
      .filter((line) => line.status !== 'mapped')
      .map((line) => ({ itemNo: line.itemNo, description: line.description, amount: line.amount })),
    lines,
    totalAmount,
    mappedAmount,
  };
}

/**
 * Candidate C cost-weight pipeline:
 * stored activity amounts → project BOQ → largest SWA line-item set.
 */
export async function resolveSCurveCostWeights(
  projectId: string,
  activities: PdmActivity[],
  storedCostItems: Array<Partial<SCurveCostItemInput> & { activityId: string }>,
  costWeightMappings?: unknown,
): Promise<SCurveCostWeightResult> {
  const storedByActivityId = new Map(storedCostItems.map((item) => [item.activityId, item]));
  const storedHasAmount = [...storedByActivityId.values()].some(
    (item) => Number(item.quantity) > 0 && Number(item.unitCost) > 0,
  );

  const boqByPayItemId = new Map<string, { programmedQty: number; unitPrice: number }>();
  const boqByItemNo = new Map<string, { programmedQty: number; unitPrice: number }>();
  if (activities.length > 0 && !storedHasAmount) {
    try {
      for (const row of await listProjectBoq(projectId)) {
        if (!row.active) continue;
        const values = {
          programmedQty:
            row.revisedQty != null && row.revisedQty > 0 ? row.revisedQty : row.programmedQty,
          unitPrice: row.unitPrice,
        };
        if (row.payItemId) boqByPayItemId.set(row.payItemId, values);
        if (row.itemNo) boqByItemNo.set(normalizePayItemNo(row.itemNo), values);
      }
    } catch {
      /* leave empty maps */
    }
  }

  const activityCostInputs = activities.map((activity) => {
    const stored = storedByActivityId.get(activity.id);
    const useStored = Number(stored?.quantity) > 0 && Number(stored?.unitCost) > 0;
    const fromBoq = useStored
      ? undefined
      : (activity.payItemId ? boqByPayItemId.get(activity.payItemId) : undefined) ??
        boqByItemNo.get(normalizePayItemNo(activity.number));
    return {
      activityId: activity.id,
      itemNo: stored && stored.itemNo != null ? String(stored.itemNo) : activity.number,
      description: stored && stored.description != null ? String(stored.description) : activity.name,
      quantity: useStored ? Number(stored?.quantity) : Number(fromBoq?.programmedQty ?? 0),
      unitCost: useStored ? Number(stored?.unitCost) : Number(fromBoq?.unitPrice ?? 0),
    };
  });

  const activitySummary = computeSCurveCostSummary(activityCostInputs);
  // Candidate C never persists SWA-derived rows (qty is only 0/1 with lump unitCost).
  // Treat that shape as absent so the full SWA contract amount can still resolve.
  const looksLikeSwaDerivedStored =
    storedHasAmount &&
    [...storedByActivityId.values()].every((item) => {
      const qty = Number(item.quantity) || 0;
      return qty === 0 || qty === 1;
    });

  if (activitySummary.totalContractAmount > 0 && !looksLikeSwaDerivedStored) {
    return {
      summary: activitySummary,
      source: storedHasAmount ? 'stored' : 'boq',
      weightNote: '',
      payItemMappings: [],
    };
  }

  const mapped = mapSwaPayItems(
    activities,
    await loadLargestSwaLineItems(projectId),
    readStoredMappings(costWeightMappings),
  );

  if (mapped.totalAmount <= 0) {
    if (activitySummary.totalContractAmount > 0) {
      return {
        summary: activitySummary,
        source: storedHasAmount ? 'stored' : 'boq',
        weightNote: '',
        payItemMappings: [],
      };
    }
    return {
      summary: activitySummary,
      source: 'missing',
      weightNote:
        'PDM cost weights are missing. Activity amounts, the project BOQ, and linked SWA items are all zero, so the PDM Target stays on that cost-weight result.',
      payItemMappings: [],
    };
  }

  const totalContractAmount = Math.round(100 * mapped.totalAmount) / 100;
  const items = activities.map((activity) => {
    const amount = Math.round((mapped.amountsByActivityId.get(activity.id) ?? 0) * 100) / 100;
    const stored = storedByActivityId.get(activity.id);
    return {
      activityId: activity.id,
      itemNo: stored && stored.itemNo != null ? String(stored.itemNo) : activity.number,
      description: stored && stored.description != null ? String(stored.description) : activity.name,
      quantity: +(amount > 0),
      unitCost: amount,
      amount,
      weightPct: weightPctOf(amount, totalContractAmount),
    };
  });
  const unmappedWeightPct = weightPctOf(
    totalContractAmount - items.reduce((sum, item) => sum + item.amount, 0),
    totalContractAmount,
  );

  return {
    summary: {
      items,
      totalContractAmount,
      totalWeightPct: items.reduce((sum, item) => sum + item.weightPct, 0),
    },
    source: 'swa',
    weightNote:
      unmappedWeightPct > 0.05
        ? `PDM Target incomplete — ${unmappedWeightPct.toFixed(2)}% of contract weight still requires activity mapping.`
        : '',
    payItemMappings: mapped.lines,
  };
}
