import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import type { Role } from '../../types';
import type { WorkItem } from '../workItems';
import { computeWorkItems } from '../workItems';
import type {
  ApprovalActorState,
  ContractorChange,
  ContractorConfirmationState,
  OptionalAttachmentKey,
  ReportApprovalFlow,
  ReportReleaseState,
  SwaStewaReport,
  SwaStewaStatus,
} from '../swaStewaApi';
import { COLLECTIONS, reportAuditPath, reportRevisionsPath } from './collections';
import { getAccessContext, getAccessibleProjectIds, readProjectAccess } from './access';
import { chunkIds, mapPool, readListCache, writeListCache, invalidateListCache } from './listCache';
import { auth, db, functions, storage } from './config';
import { asId, nowIso, omitUndefined, omitUndefinedDeep } from './ids';
import { syncProgressCharts } from './sCurves';
import { getPayItem, type PayItem } from './payItems';
import { BASE_URL } from '../paths';
import { pickProjectSwa, pickProjectStewa, stewaPlannedPct, swaPhysicalAccomplishmentPct } from '../iarProgress';
import { buildReportNumberFromData, displayReportNumber } from '../reportNumber';
import { designationForRole, safeSignatureSrc } from '../signatories';

function enrichReportData(
  reportType: 'SWA' | 'STEWA' | 'IAR',
  reportData: Record<string, unknown>,
  lineItems?: WorkItem[],
): Record<string, unknown> {
  const data = { ...reportData };
  if (reportType === 'SWA' && lineItems && lineItems.length > 0) {
    const { totals } = computeWorkItems(lineItems);
    data.percent_actual = Math.round(totals.totalToDateWeightPct * 1000) / 1000;
    data.computed_totals = totals;
  }
  if (
    (reportType === 'STEWA' || reportType === 'IAR') &&
    data.percent_actual != null &&
    !Number.isNaN(Number(data.percent_actual))
  ) {
    data.percent_actual = Math.round(Number(data.percent_actual) * 1000) / 1000;
  }
  if (reportType === 'IAR') {
    const planned = data.percent_planned ?? data.rev_target ?? data.orig_target;
    if (planned != null && !Number.isNaN(Number(planned))) {
      const p = Math.round(Number(planned) * 100) / 100;
      data.percent_planned = String(p);
      if (!data.orig_target) data.orig_target = String(p);
      if (!data.rev_target) data.rev_target = String(p);
    }
  }
  return data;
}

function publicReportUrl(reportNumber: string, reportId?: string) {
  // Static export has no /reports/view/[slug] route — use query params on the
  // existing /reports/view page. Prefer document id when available.
  const qs = reportId
    ? `id=${encodeURIComponent(reportId)}`
    : `reportNumber=${encodeURIComponent(reportNumber)}`;
  return `${typeof window !== 'undefined' ? window.location.origin : ''}${BASE_URL}reports/view/?${qs}`;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? '').trim())
    .filter((item) => item.length > 0);
}

function signatoryFields(data: Record<string, unknown>) {
  return {
    signatory_name: data.signatoryName != null ? String(data.signatoryName) : null,
    signatory_designation: data.signatoryDesignation != null ? String(data.signatoryDesignation) : null,
    signatory_initials: data.signatoryInitials != null ? String(data.signatoryInitials) : null,
    signatory_signature: data.signatorySignature != null ? String(data.signatorySignature) : null,
  };
}

function actorState(value: unknown): ApprovalActorState | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  return {
    approved_by: data.approvedBy != null ? String(data.approvedBy) : null,
    approved_role: data.approvedRole != null ? String(data.approvedRole) : null,
    approved_at: data.approvedAt != null ? String(data.approvedAt) : null,
    ...signatoryFields(data),
  };
}

function contractorConfirmationState(value: unknown): ContractorConfirmationState | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  return {
    confirmed_by: data.confirmedBy != null ? String(data.confirmedBy) : null,
    confirmed_role: data.confirmedRole != null ? String(data.confirmedRole) : null,
    confirmed_at: data.confirmedAt != null ? String(data.confirmedAt) : null,
    confirms_swa: data.confirmsSwa === true,
    confirms_iar: data.confirmsIar === true,
    ...signatoryFields(data),
  };
}

const SIGNATORY_SLOTS = ['engineer_1', 'engineer_2', 'engineer_3', 'engineer_4', 'contractor'] as const;

function typedSignatory(role: Role, reportData: unknown): { name: string; initials: string } {
  const data =
    reportData && typeof reportData === 'object' ? (reportData as Record<string, unknown>) : {};
  return {
    name: String(data[`sig_${role}_name`] ?? '').trim(),
    initials: String(data[`sig_${role}_initials`] ?? '').trim(),
  };
}

/** Keep every other role's saved name and initials. A save may change only the saver's slot. */
function retainOtherSignatories(next: Record<string, unknown>, previous: unknown, role: string | undefined) {
  const prev = previous && typeof previous === 'object' ? (previous as Record<string, unknown>) : {};
  for (const slot of SIGNATORY_SLOTS) {
    if (slot === role) continue;
    for (const key of [`sig_${slot}_name`, `sig_${slot}_initials`]) {
      if (Object.prototype.hasOwnProperty.call(prev, key)) next[key] = prev[key];
      else delete next[key];
    }
  }
}

function reportDataWithOwnSignatory(
  reportData: unknown,
  role: Role,
  entered: { name?: string; initials?: string },
): Record<string, unknown> {
  const next =
    reportData && typeof reportData === 'object' ? { ...(reportData as Record<string, unknown>) } : {};
  next[`sig_${role}_name`] = String(entered.name ?? '').trim();
  next[`sig_${role}_initials`] = String(entered.initials ?? '').trim();
  return next;
}

async function actingSignatory(role: Role, entered?: { name?: string; initials?: string }) {
  const approvedAt = nowIso();
  const uid = auth.currentUser?.uid ?? null;
  let designation = '';
  let signature: string | null = null;
  if (uid) {
    const snap = await getDoc(doc(db, COLLECTIONS.users, uid));
    if (snap.exists()) {
      const data = snap.data() as Record<string, unknown>;
      designation = String(data.designation ?? data.position ?? data.title ?? '').trim();
      signature = safeSignatureSrc(String(data.signature ?? data.signatureUrl ?? ''));
    }
  }
  return omitUndefined({
    approvedBy: uid,
    approvedRole: role,
    approvedAt,
    signatoryName: String(entered?.name ?? '').trim(),
    signatoryDesignation: designationForRole(role, designation),
    signatoryInitials: String(entered?.initials ?? '').trim(),
    signatorySignature: signature,
  });
}

function approvalFlowState(value: unknown): ReportApprovalFlow | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const data = value as Record<string, unknown>;
  return {
    contractor_confirmation: contractorConfirmationState(data.contractorConfirmation),
    engineer_1: actorState(data.engineer1),
    engineer_2: actorState(data.engineer2),
    engineer_3: actorState(data.engineer3),
    engineer_4: actorState(data.engineer4),
    current_stage:
      data.currentStage != null ? String(data.currentStage) as ReportApprovalFlow['current_stage'] : undefined,
    correction_cycle:
      data.correctionCycle != null ? Number(data.correctionCycle) : undefined,
    last_correction_reason:
      data.lastCorrectionReason != null ? String(data.lastCorrectionReason) : null,
    last_correction_by:
      data.lastCorrectionBy != null ? String(data.lastCorrectionBy) : null,
    last_correction_role:
      data.lastCorrectionRole != null ? String(data.lastCorrectionRole) : null,
  };
}

function releaseState(value: unknown): ReportReleaseState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const data = value as Record<string, unknown>;
  const attachmentUrlsRaw =
    data.attachmentUrls && typeof data.attachmentUrls === 'object'
      ? (data.attachmentUrls as Record<string, unknown>)
      : {};
  const attachmentUrls: Partial<Record<OptionalAttachmentKey, string>> = {};
  for (const key of ['pdm', 'bar_chart', 's_curve', 'swa', 'stewa'] as OptionalAttachmentKey[]) {
    if (attachmentUrlsRaw[key] != null) attachmentUrls[key] = String(attachmentUrlsRaw[key]);
  }
  return {
    optional_attachments: stringArray(data.optionalAttachments) as OptionalAttachmentKey[],
    attachments_released_at:
      data.attachmentsReleasedAt != null ? String(data.attachmentsReleasedAt) : null,
    released_by: data.releasedBy != null ? String(data.releasedBy) : null,
    released_role: data.releasedRole != null ? String(data.releasedRole) : null,
    email_sent_at: data.emailSentAt != null ? String(data.emailSentAt) : null,
    attachment_urls: attachmentUrls,
  };
}

function buildEditableUserIds(
  reportType: 'SWA' | 'STEWA' | 'IAR',
  projectAccessUserIds: string[],
  projectData: Record<string, unknown> | null,
  lastViewedBy?: string | null,
): string[] {
  const access = projectData ? readProjectAccess(projectData) : null;
  const engineer1Ids = access ? access.assignedUserIds.filter((id) => id !== access.contractorId) : [];
  const editable = new Set<string>([...engineer1Ids]);
  if (access?.contractorId) editable.add(access.contractorId);
  if ((reportType === 'SWA' || reportType === 'STEWA') && access?.involvedUserIds.length) {
    for (const id of access.involvedUserIds) editable.add(id);
  }
  if (lastViewedBy) editable.add(lastViewedBy);
  if (!editable.size) {
    for (const id of projectAccessUserIds) editable.add(id);
  }
  return [...editable];
}

function initialApprovalFlow(reportType: 'SWA' | 'STEWA' | 'IAR'): ReportApprovalFlow | undefined {
  if (reportType !== 'IAR') return undefined;
  return {
    contractor_confirmation: null,
    engineer_2: null,
    engineer_3: null,
    engineer_4: null,
    current_stage: 'draft',
    correction_cycle: 0,
    last_correction_reason: null,
    last_correction_by: null,
    last_correction_role: null,
  };
}

function selectedOptionalAttachments(generate?: {
  s_curve?: boolean;
  pdm?: boolean;
  bar_chart?: boolean;
  swa?: boolean;
  stewa?: boolean;
}): OptionalAttachmentKey[] {
  if (!generate) return [];
  return ([
    ['s_curve', generate.s_curve],
    ['pdm', generate.pdm],
    ['bar_chart', generate.bar_chart],
    ['swa', generate.swa],
    ['stewa', generate.stewa],
  ] as const)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key);
}

function standardizePayItemRow(row: Record<string, unknown>, masters: Map<string, PayItem>) {
  const payItemId = row.payItemId ? String(row.payItemId) : '';
  const master = payItemId ? masters.get(payItemId) : undefined;
  if (payItemId && !master) {
    throw new Error(`Pay Item ${payItemId} could not be validated.`);
  }
  if (!master) return row;
  return {
    ...row,
    payItemId: master.id,
    payItemVersion: master.version,
    snapshotItemNo: master.itemNo,
    snapshotDescription: master.description,
    snapshotUnit: master.unit,
    itemNo: master.itemNo,
    description: master.description,
    unit: master.unit,
  };
}

function rowNeedsPayItemMaster(row: Record<string, unknown>): boolean {
  const payItemId = String(row.payItemId ?? '').trim();
  if (!payItemId) return false;
  if (payItemId.startsWith('catalog:') || payItemId.startsWith('schedule-')) return false;
  return true;
}

async function standardizeReportPayItems(
  reportData: Record<string, unknown>,
  lineItems: WorkItem[] | undefined,
) {
  const accomplishment = Array.isArray(reportData.accomplishment_items)
    ? (reportData.accomplishment_items as Record<string, unknown>[])
    : [];
  const variation = Array.isArray(reportData.variation_items)
    ? (reportData.variation_items as Record<string, unknown>[])
    : [];
  const candidateRows = [
    ...((lineItems ?? []) as unknown as Record<string, unknown>[]),
    ...accomplishment,
    ...variation,
  ];
  // Only the Pay Item documents this draft actually references. A full master-list
  // scan (thousands of docs) is what exhausts the Firestore read quota on save.
  const masterIds = [
    ...new Set(
      candidateRows
        .filter(rowNeedsPayItemMaster)
        .map((row) => String(row.payItemId).trim())
        .filter(Boolean),
    ),
  ];
  if (masterIds.length === 0) {
    return { reportData, lineItems };
  }
  const masters = new Map<string, PayItem>();
  await Promise.all(
    masterIds.map(async (id) => {
      const master = await getPayItem(id);
      if (master) masters.set(master.id, master);
    }),
  );
  const normalizedLineItems = lineItems?.map((item) =>
    standardizePayItemRow(item as unknown as Record<string, unknown>, masters) as unknown as WorkItem,
  );
  const normalizedData = { ...reportData };
  for (const key of ['accomplishment_items', 'variation_items']) {
    const rows = normalizedData[key];
    if (Array.isArray(rows)) {
      normalizedData[key] = rows.map((row) =>
        standardizePayItemRow(row as Record<string, unknown>, masters),
      );
    }
  }
  return { reportData: normalizedData, lineItems: normalizedLineItems };
}

function mapReport(id: string, data: Record<string, unknown>): SwaStewaReport {
  return {
    id,
    report_number: String(data.reportNumber ?? ''),
    project_id: asId(data.projectId as string),
    report_type: data.reportType as 'SWA' | 'STEWA' | 'IAR',
    report_data: (data.reportData as Record<string, unknown>) ?? {},
    line_items: (data.lineItems as WorkItem[]) ?? [],
    pdf_file: (data.pdfPath as string | undefined) ?? undefined,
    qr_code: (data.qrCode as string | undefined) ?? undefined,
    public_url: (data.publicUrl as string | undefined) ?? undefined,
    status: data.status as SwaStewaStatus,
    project_name: (data.projectName as string | undefined) ?? undefined,
    rejection_reason: (data.rejectionReason as string | undefined) ?? undefined,
    contractor_changes: (data.contractorChanges as ContractorChange[] | undefined) ?? undefined,
    approval_flow: approvalFlowState(data.approvalFlow),
    release_state: releaseState(data.releaseState),
    edit_user_ids: stringArray(data.editUserIds),
    last_viewed_by: data.lastViewedBy != null ? String(data.lastViewedBy) : null,
    last_viewed_at: data.lastViewedAt != null ? String(data.lastViewedAt) : null,
    created_by: data.createdBy != null ? asId(data.createdBy as string) : null,
    created_at: String(data.createdAt ?? ''),
    generated_at: (data.generatedAt as string | undefined) ?? undefined,
    email_status: emailNoticeStatus(data.emailStatus),
    email_sent_at: data.emailSentAt != null ? String(data.emailSentAt) : null,
    email_error: data.emailError != null ? String(data.emailError) : null,
    email_message_id: data.emailMessageId != null ? String(data.emailMessageId) : null,
    email_claimed_at: data.emailClaimedAt != null ? String(data.emailClaimedAt) : null,
    email_recipients: stringArray(data.emailRecipients),
  };
}

function emailNoticeStatus(value: unknown): SwaStewaReport['email_status'] {
  const status = String(value ?? 'NOT_SENT');
  if (status === 'SENDING' || status === 'SENT' || status === 'FAILED' || status === 'NOT_SENT') {
    return status;
  }
  return 'NOT_SENT';
}

async function writeAudit(
  reportId: string,
  action: string,
  details: Record<string, unknown> = {},
  actorName?: string,
) {
  await addDoc(collection(db, reportAuditPath(reportId)), {
    action,
    details,
    actorName: actorName ?? null,
    createdAt: nowIso(),
  });
}

function bumpReportsCache() {
  invalidateListCache('reports:');
  invalidateListCache('dashboard:');
  // Progress feed powers Bar Chart / S-Curve — clear so charts refetch.
  invalidateListCache('reportProgress:');
  invalidateListCache('chartContext:');
}

async function nextReportNumber(
  type: string,
  reportData?: Record<string, unknown> | null,
): Promise<string> {
  const fromPeriod = buildReportNumberFromData(type, reportData ?? null);
  // No reporting period yet (blank draft) — do not stamp today's date into the ID.
  const base = fromPeriod || `${String(type).toUpperCase()}-DRAFT`;
  const counterRef = doc(db, COLLECTIONS.counters, `reportNumber_${base}`);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const nextSuffix = Number((snap.data() as Record<string, unknown> | undefined)?.nextSuffix ?? 1);
    tx.set(
      counterRef,
      {
        kind: 'report_number',
        base,
        nextSuffix: nextSuffix + 1,
        updatedAt: nowIso(),
      },
      { merge: true },
    );
    return nextSuffix <= 1 ? base : `${base}-${nextSuffix}`;
  });
}

export async function listReportsFs(params?: Record<string, string>) {
  const access = await getAccessContext();
  if (!access) return { reports: [] as SwaStewaReport[] };
  const reportType = params?.report_type ?? params?.type;
  const projectFilter = params?.project_id ? asId(params.project_id) : '';
  const statusFilter = params?.status ?? '';
  const cacheKey = `reports:${access.uid}:${projectFilter || 'all'}:${reportType || 'all'}:${statusFilter || 'all'}`;
  const cached = readListCache<SwaStewaReport[]>(cacheKey);
  if (cached) return { reports: cached };

  const baseKey = `reports:${access.uid}:${projectFilter || 'all'}:all:all`;
  const applyFilters = (rows: SwaStewaReport[]) => {
    let reports = rows;
    if (projectFilter) reports = reports.filter((r) => r.project_id === projectFilter);
    if (statusFilter) reports = reports.filter((r) => r.status === statusFilter);
    if (reportType) reports = reports.filter((r) => r.report_type === reportType);
    return reports;
  };

  // Reuse the unfiltered (or project-scoped) set when type/status filters change.
  if (reportType || statusFilter) {
    const baseCached = readListCache<SwaStewaReport[]>(baseKey);
    if (baseCached) {
      const filtered = applyFilters(baseCached);
      writeListCache(cacheKey, filtered, 20_000);
      return { reports: filtered };
    }
  }

  const loadByProjectIds = async (projectIds: string[]) => {
    if (!projectIds.length) return [] as SwaStewaReport[];
    // Firestore `in` supports ≤30 values — far fewer round-trips than one query per project.
    const chunks = chunkIds(projectIds, 30);
    const snaps = await mapPool(chunks, 4, async (chunk) => {
      try {
        if (chunk.length === 1) {
          return await getDocs(
            query(collection(db, COLLECTIONS.reports), where('projectId', '==', chunk[0])),
          );
        }
        return await getDocs(
          query(collection(db, COLLECTIONS.reports), where('projectId', 'in', chunk)),
        );
      } catch {
        // Fallback: per-id queries if `in` is denied by rules.
        const perId = await mapPool(chunk, 6, async (projectId) => {
          try {
            return await getDocs(
              query(collection(db, COLLECTIONS.reports), where('projectId', '==', projectId)),
            );
          } catch {
            return null;
          }
        });
        return { docs: perId.flatMap((s) => (s ? s.docs : [])) };
      }
    });
    const byId = new Map<string, SwaStewaReport>();
    for (const snap of snaps) {
      for (const reportDoc of snap.docs) {
        byId.set(reportDoc.id, mapReport(reportDoc.id, reportDoc.data() as Record<string, unknown>));
      }
    }
    return [...byId.values()];
  };

  let reports: SwaStewaReport[] = [];

  if (access.hasGlobalProjectAccess) {
    try {
      const qRef = projectFilter
        ? query(collection(db, COLLECTIONS.reports), where('projectId', '==', projectFilter))
        : query(collection(db, COLLECTIONS.reports));
      const snap = await getDocs(qRef);
      reports = snap.docs.map((d) => mapReport(d.id, d.data() as Record<string, unknown>));
    } catch {
      reports = await loadByProjectIds(
        projectFilter ? [projectFilter] : await getAccessibleProjectIds(access.uid),
      );
    }
  } else if (access.uid) {
    if (projectFilter) {
      reports = await loadByProjectIds([projectFilter]);
    } else {
      reports = await loadByProjectIds(await getAccessibleProjectIds(access.uid));
      if (!reports.length) {
        try {
          const snap = await getDocs(
            query(collection(db, COLLECTIONS.reports), where('accessUserIds', 'array-contains', access.uid)),
          );
          reports = snap.docs.map((d) => mapReport(d.id, d.data() as Record<string, unknown>));
        } catch {
          reports = [];
        }
      }
    }
  }

  reports.sort((a, b) => b.created_at.localeCompare(a.created_at));
  writeListCache(baseKey, reports, 20_000);
  const filtered = applyFilters(reports);
  writeListCache(cacheKey, filtered, 20_000);
  return { reports: filtered };
}

function decodeReportKey(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  try {
    return decodeURIComponent(trimmed.replace(/\+/g, ' ')).trim();
  } catch {
    return trimmed;
  }
}

export async function getReportFs(idOrNumber: string) {
  const key = decodeReportKey(idOrNumber);
  if (!key) throw new Error('Report not found');

  const wrap = (report: SwaStewaReport) => ({
    report,
    valid: true,
    verified: ['approved', 'generated'].includes(report.status),
    pdf_url: report.pdf_file,
  });

  // Prefer document ID lookup first. Seeded sample reports use hyphenated IDs
  // (e.g. sample-18-pamplona-clinic-iar) that look like report numbers but are
  // not — the old heuristic treated any hyphenated string as a reportNumber.
  const byId = await getDoc(doc(db, COLLECTIONS.reports, key));
  if (byId.exists()) {
    return wrap(mapReport(byId.id, byId.data() as Record<string, unknown>));
  }

  // Rules-friendly path: resolve from reports the caller can already list
  // (project-scoped / accessUserIds). Avoids a bare reportNumber collection
  // query, which Firestore rejects when rules also check project membership.
  try {
    const { reports } = await listReportsFs();
    const match = reports.find(
      (report) => report.id === key || report.report_number === key,
    );
    if (match) {
      const fresh = await getDoc(doc(db, COLLECTIONS.reports, match.id));
      if (fresh.exists()) {
        return wrap(mapReport(fresh.id, fresh.data() as Record<string, unknown>));
      }
      return wrap(match);
    }
  } catch {
    /* fall through to public finalized lookup */
  }

  // Public finalized reports: constrain status so rules can authorize the query.
  // Prefer equality on reportNumber (+ status). If that needs a missing composite
  // index, or returns empty, fall back to a status-only query and match client-side.
  const isMatch = (data: Record<string, unknown>) =>
    String(data.reportNumber ?? '') === key || String(data.report_number ?? '') === key;

  try {
    const q = query(
      collection(db, COLLECTIONS.reports),
      where('reportNumber', '==', key),
      where('status', 'in', ['approved', 'generated']),
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      const d = snap.docs[0];
      return wrap(mapReport(d.id, d.data() as Record<string, unknown>));
    }
  } catch {
    /* try status-only fallback below */
  }

  try {
    const snap = await getDocs(
      query(
        collection(db, COLLECTIONS.reports),
        where('status', 'in', ['approved', 'generated']),
      ),
    );
    const d = snap.docs.find((docSnap) => isMatch(docSnap.data() as Record<string, unknown>));
    if (d) {
      return wrap(mapReport(d.id, d.data() as Record<string, unknown>));
    }
  } catch {
    /* ignore — surface a clear not-found below */
  }

  throw new Error('Report not found');
}

export async function markReportViewedFs(reportId: string | number) {
  const access = await getAccessContext();
  if (!access?.uid) return { ok: false };
  await updateDoc(doc(db, COLLECTIONS.reports, asId(reportId)), {
    lastViewedBy: access.uid,
    lastViewedAt: nowIso(),
    updatedAt: nowIso(),
  });
  return { ok: true };
}

export async function verifyReportQrFs(qr: string) {
  const q = query(collection(db, COLLECTIONS.reports), where('qrCode', '==', qr));
  const snap = await getDocs(q);
  if (snap.empty) {
    // also allow verify by report number
    try {
      const byNumber = await getReportFs(qr);
      const verified = ['approved', 'generated'].includes(byNumber.report.status);
      return {
        valid: true,
        verified,
        report: byNumber.report,
        message: verified ? 'Report verified' : 'Report found but not yet approved',
      };
    } catch {
      return { valid: false, message: 'Invalid QR code' };
    }
  }
  const report = mapReport(snap.docs[0].id, snap.docs[0].data() as Record<string, unknown>);
  const verified = ['approved', 'generated'].includes(report.status);
  return {
    valid: true,
    verified,
    report,
    message: verified ? 'Report verified' : 'Report found but not yet approved',
  };
}

export async function getStewaFromSwaFs(projectId: string | number, reportDate: string) {
  const { reports } = await listReportsFs({
    project_id: asId(projectId),
    report_type: 'SWA',
  });
  const approved = reports.filter((r) => ['approved', 'generated'].includes(r.status));
  const match =
    approved.find((r) => String(r.report_data.report_date ?? '') === reportDate) ||
    approved[0];
  if (!match) {
    return {
      percent_actual: null,
      percent_planned: null,
      swa_report_number: null,
      slippage: null,
    };
  }
  const actual = Number(match.report_data.percent_actual ?? match.report_data.percent_complete ?? 0);
  const planned = Number(match.report_data.percent_planned ?? match.report_data.percent_target ?? null);
  return {
    percent_actual: Number.isFinite(actual) ? actual : null,
    percent_planned: Number.isFinite(planned) ? planned : null,
    swa_report_number: match.report_number,
    slippage:
      Number.isFinite(actual) && Number.isFinite(planned)
        ? Math.round((actual - planned) * 100) / 100
        : null,
  };
}

export async function getIarProgressFs(
  projectId: string | number,
  reportDate?: string,
  iarReportData?: Record<string, unknown>,
) {
  const { reports } = await listReportsFs({ project_id: asId(projectId) });
  const swa = pickProjectSwa(reports, reportDate);
  const stewa = pickProjectStewa(reports, reportDate, swa, iarReportData);
  const stewaPlanned = stewaPlannedPct(stewa);
  const actual = swa ? swaPhysicalAccomplishmentPct(swa) : null;
  const variance =
    actual != null && Number.isFinite(actual) && stewaPlanned != null && Number.isFinite(stewaPlanned)
      ? Math.round((actual - stewaPlanned) * 100) / 100
      : null;

  return {
    orig_target: stewaPlanned,
    rev_target: stewaPlanned,
    percent_planned: stewaPlanned,
    actual_progress: actual != null && Number.isFinite(actual) ? actual : null,
    variance,
    source_swa: swa?.report_number ?? null,
    source_stewa: stewa?.report_number ?? null,
  };
}

function sanitizeLineItemsForFirestore(items: WorkItem[] | undefined): WorkItem[] {
  if (!items?.length) return [];
  return omitUndefinedDeep(
    items.map((item) => {
      const row: Record<string, unknown> = { ...item };
      for (const [key, value] of Object.entries(row)) {
        if (typeof value === 'number' && !Number.isFinite(value)) row[key] = 0;
      }
      return row;
    }),
  ) as unknown as WorkItem[];
}

export async function saveReportFs(payload: {
  id?: string | number;
  report_type: 'SWA' | 'STEWA' | 'IAR';
  project_id: string | number;
  report_data: Record<string, unknown>;
  line_items?: WorkItem[];
  contractor_changes?: ContractorChange[];
  created_by?: string | number;
  actor_name?: string;
}) {
  const projectId = asId(payload.project_id);
  if (!projectId || projectId === '1') {
    throw new Error('Select a project before saving the draft.');
  }
  let projectName: string | undefined;
  let accessUserIds: string[] = [];
  let projectData: Record<string, unknown> | null = null;
  try {
    const proj = await getDoc(doc(db, COLLECTIONS.projects, projectId));
    if (proj.exists()) {
      projectData = proj.data() as Record<string, unknown>;
      projectName = String(projectData.name ?? '');
      accessUserIds = readProjectAccess(projectData).accessUserIds;
    }
  } catch {
    /* ignore */
  }
  if (!projectData) {
    throw new Error('Selected project was not found or is not accessible. Pick a project from the list and try again.');
  }

  const standardized = await standardizeReportPayItems(
    payload.report_data,
    payload.line_items,
  );
  const reportData = omitUndefinedDeep(
    enrichReportData(
      payload.report_type,
      standardized.reportData,
      standardized.lineItems,
    ),
  ) as Record<string, unknown>;
  const lineItems = sanitizeLineItemsForFirestore(
    standardized.lineItems ?? payload.line_items,
  );
  const saver = await getAccessContext();

  if (payload.id) {
    const id = asId(payload.id);
    const ref = doc(db, COLLECTIONS.reports, id);
    const existing = await getDoc(ref);
    if (!existing.exists()) throw new Error('Report not found');
    const prev = existing.data() as Record<string, unknown>;
    retainOtherSignatories(reportData, prev.reportData, saver?.role);
    const existingEditUserIds = stringArray(prev.editUserIds);
    const nextEditUserIds =
      existingEditUserIds.length > 0
        ? existingEditUserIds
        : buildEditableUserIds(
            payload.report_type,
            accessUserIds,
            projectData,
            prev.lastViewedBy != null ? String(prev.lastViewedBy) : null,
          );
    try {
      await addDoc(collection(db, reportRevisionsPath(id)), omitUndefinedDeep({
        revisionNumber: Date.now(),
        reportData: prev.reportData ?? {},
        lineItems: prev.lineItems ?? [],
        createdAt: nowIso(),
        changedByName: payload.actor_name ?? null,
      }));
    } catch {
      /* revision history is best-effort; do not block draft save */
    }
    await updateDoc(ref, omitUndefined({
      reportData,
      lineItems: lineItems.length
        ? lineItems
        : sanitizeLineItemsForFirestore(prev.lineItems as WorkItem[] | undefined),
      projectName: projectName ?? prev.projectName,
      accessUserIds:
        accessUserIds.length > 0
          ? accessUserIds
          : ((prev.accessUserIds as string[] | undefined) ?? []),
      editUserIds: nextEditUserIds,
      contractorChanges: payload.contractor_changes ?? (prev.contractorChanges as ContractorChange[] | undefined) ?? [],
      approvalFlow: (prev.approvalFlow as Record<string, unknown> | undefined)
        ?? initialApprovalFlow(payload.report_type),
      releaseState: (prev.releaseState as Record<string, unknown> | undefined) ?? null,
      updatedAt: nowIso(),
    }));
    await writeAudit(id, 'saved', {}, payload.actor_name);
    const status = String(prev.status ?? '');
    if (['approved', 'generated'].includes(status) && ['SWA', 'STEWA'].includes(payload.report_type)) {
      try {
        await syncProgressCharts(projectId);
      } catch {
        /* charts optional */
      }
    }
    const snap = await getDoc(ref);
    bumpReportsCache();
    return { report: mapReport(snap.id, snap.data() as Record<string, unknown>) };
  }

  retainOtherSignatories(reportData, undefined, saver?.role);
  const reportNumber = await nextReportNumber(payload.report_type, reportData);
  let scheduleVersionId: string | null = null;
  let scheduleVersionLabel: string | null = null;
  try {
    const scheduleSnap = await getDoc(doc(db, COLLECTIONS.schedules, projectId));
    if (scheduleSnap.exists()) {
      const scheduleData = scheduleSnap.data() as Record<string, unknown>;
      if (scheduleData.activeVersionId != null) {
        scheduleVersionId = String(scheduleData.activeVersionId);
        scheduleVersionLabel =
          scheduleData.versionLabel != null ? String(scheduleData.versionLabel) : null;
      }
    }
  } catch {
    /* keep report create independent of schedule version metadata */
  }
  const ref = doc(collection(db, COLLECTIONS.reports));
  const editUserIds = buildEditableUserIds(payload.report_type, accessUserIds, projectData, null);
  const docData = omitUndefinedDeep({
    reportNumber,
    projectId,
    projectName: projectName ?? null,
    accessUserIds,
    editUserIds,
    reportType: payload.report_type,
    reportData,
    lineItems,
    contractorChanges: payload.contractor_changes ?? [],
    status: 'draft' as SwaStewaStatus,
    scheduleVersionId,
    scheduleVersionLabel,
    approvalFlow: initialApprovalFlow(payload.report_type) ?? null,
    releaseState: null,
    publicUrl: publicReportUrl(reportNumber, ref.id),
    createdBy: payload.created_by != null ? asId(payload.created_by) : null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }) as Record<string, unknown>;
  await setDoc(ref, docData);
  await writeAudit(ref.id, 'created', { reportNumber }, payload.actor_name);
  bumpReportsCache();
  return { report: mapReport(ref.id, docData) };
}

export async function previewReportFs(payload: Parameters<typeof saveReportFs>[0]) {
  const saved = await saveReportFs(payload);
  const r = saved.report;
  const preview_html = `<div style="font-family:sans-serif;padding:24px">
    <h1>${r.report_type} Preview</h1>
    <p><strong>Report:</strong> ${displayReportNumber(r)}</p>
    <p><strong>Project:</strong> ${r.project_name ?? r.project_id}</p>
    <p><strong>Status:</strong> ${r.status}</p>
    <pre style="background:#f5f5f5;padding:12px;overflow:auto">${JSON.stringify(r.report_data, null, 2)}</pre>
  </div>`;
  return { report: r, preview_html };
}

export async function sendToContractorFs(reportId: string | number, actorName?: string) {
  const id = asId(reportId);
  const ref = doc(db, COLLECTIONS.reports, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Report not found');
  const data = snap.data() as Record<string, unknown>;
  if (!['draft', 'rejected'].includes(String(data.status))) {
    throw new Error('Report cannot be sent to contractor in current status');
  }
  let projectData: Record<string, unknown> | null = null;
  let accessUserIds = stringArray(data.accessUserIds);
  try {
    const projectSnap = await getDoc(doc(db, COLLECTIONS.projects, asId(data.projectId as string)));
    if (projectSnap.exists()) {
      projectData = projectSnap.data() as Record<string, unknown>;
      accessUserIds = readProjectAccess(projectData).accessUserIds;
    }
  } catch {
    /* ignore */
  }
  const nextEditUserIds = buildEditableUserIds(
    data.reportType as 'SWA' | 'STEWA' | 'IAR',
    accessUserIds,
    projectData,
    data.lastViewedBy != null ? String(data.lastViewedBy) : null,
  );
  await updateDoc(ref, {
    status: 'pending_contractor',
    contractorBaseline: data.reportData ?? {},
    contractorChanges: [],
    rejectionReason: null,
    editUserIds: nextEditUserIds,
    approvalFlow:
      data.reportType === 'IAR'
        ? {
            contractorConfirmation: null,
            engineer2: null,
            engineer3: null,
            engineer4: null,
            currentStage: 'contractor_confirmation',
            correctionCycle: Number(
              (data.approvalFlow as Record<string, unknown> | undefined)?.correctionCycle ?? 0,
            ),
            lastCorrectionReason:
              (data.approvalFlow as Record<string, unknown> | undefined)?.lastCorrectionReason ?? null,
            lastCorrectionBy:
              (data.approvalFlow as Record<string, unknown> | undefined)?.lastCorrectionBy ?? null,
            lastCorrectionRole:
              (data.approvalFlow as Record<string, unknown> | undefined)?.lastCorrectionRole ?? null,
          }
        : (data.approvalFlow ?? null),
    updatedAt: nowIso(),
  });
  await writeAudit(id, 'sent_to_contractor', {}, actorName);
  await queueEmail(id, 'sent_to_contractor');
  bumpReportsCache();
  return { status: 'pending_contractor' };
}

export async function contractorConfirmFs(reportId: string | number, actorName?: string) {
  const access = await getAccessContext();
  const id = asId(reportId);
  const ref = doc(db, COLLECTIONS.reports, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Report not found');
  const data = snap.data() as Record<string, unknown>;
  if (String(data.status) !== 'pending_contractor') {
    throw new Error('Report is not awaiting contractor confirmation');
  }
  const previousFlow = ((data.approvalFlow as Record<string, unknown> | undefined) ?? {}) as Record<
    string,
    unknown
  >;
  const contractorMark = await actingSignatory('contractor', typedSignatory('contractor', data.reportData));
  await updateDoc(ref, {
    status: 'contractor_confirmed',
    approvalFlow: {
      ...previousFlow,
      contractorConfirmation: {
        ...contractorMark,
        confirmedBy: contractorMark.approvedBy ?? access?.uid ?? null,
        confirmedRole: 'contractor',
        confirmedAt: contractorMark.approvedAt,
        confirmsSwa: true,
        confirmsIar: true,
      },
      currentStage: 'engineer_2',
      correctionCycle: Number(previousFlow.correctionCycle ?? 0),
      lastCorrectionReason: previousFlow.lastCorrectionReason ?? null,
      lastCorrectionBy: previousFlow.lastCorrectionBy ?? null,
      lastCorrectionRole: previousFlow.lastCorrectionRole ?? null,
    },
    updatedAt: nowIso(),
  });
  await writeAudit(id, 'contractor_confirmed', {}, actorName);
  const updated = await getDoc(ref);
  bumpReportsCache();
  return {
    status: 'contractor_confirmed',
    report: mapReport(updated.id, updated.data() as Record<string, unknown>),
  };
}

export async function submitReportFs(
  reportId: string | number,
  _actorId?: string | number,
  actorName?: string,
) {
  const id = asId(reportId);
  const ref = doc(db, COLLECTIONS.reports, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Report not found');
  const data = snap.data() as Record<string, unknown>;
  if (String(data.reportType) === 'IAR') {
    if (!['draft', 'rejected', 'contractor_confirmed'].includes(String(data.status))) {
      throw new Error('IAR cannot be submitted for Engineer II review in its current status');
    }
  }

  // Refresh membership from the live project so Engineer II reviewers on
  // involvedUserIds can see the pending_review document and project charts.
  let accessUserIds = stringArray(data.accessUserIds);
  try {
    const projectSnap = await getDoc(doc(db, COLLECTIONS.projects, asId(data.projectId as string)));
    if (projectSnap.exists()) {
      accessUserIds = readProjectAccess(projectSnap.data() as Record<string, unknown>).accessUserIds;
    }
  } catch {
    /* keep prior accessUserIds */
  }

  const submitAccess = await getAccessContext();
  const previousFlow = ((data.approvalFlow as Record<string, unknown> | undefined) ?? {}) as Record<
    string,
    unknown
  >;
  const submitterRole = submitAccess?.role;
  const submitterMark =
    submitterRole === 'engineer_1' || submitterRole === 'contractor'
      ? await actingSignatory(submitterRole, typedSignatory(submitterRole, data.reportData))
      : null;
  await updateDoc(ref, {
    status: 'pending_review',
    accessUserIds,
    approvalFlow: {
      ...previousFlow,
      ...(submitterRole === 'engineer_1' && submitterMark ? { engineer1: submitterMark } : {}),
      ...(submitterRole === 'contractor' && submitterMark
        ? {
            contractorConfirmation: {
              ...submitterMark,
              confirmedBy: submitterMark.approvedBy,
              confirmedRole: 'contractor',
              confirmedAt: submitterMark.approvedAt,
              confirmsSwa: true,
              confirmsIar: true,
            },
          }
        : {}),
      currentStage: 'engineer_2',
    },
    updatedAt: nowIso(),
  });
  await writeAudit(id, 'submitted', {}, actorName);
  await queueEmail(id, 'submitted_for_review');
  bumpReportsCache();
  return { status: 'pending_review' };
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out')), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function finalizeGenerated(reportId: string, actorName?: string) {
  const reportRef = doc(db, COLLECTIONS.reports, reportId);
  const snap = await getDoc(reportRef);
  if (!snap.exists()) throw new Error('Report not found');
  const data = snap.data() as Record<string, unknown>;
  const reportNumber = String(data.reportNumber);
  const qrCode = reportNumber;

  let pdfUrl = String(data.pdfPath ?? '').trim() || undefined;
  let pdfBase64: string | undefined;
  try {
    const { officialReportPdfBase64 } = await import('../downloadReportPdf');
    pdfBase64 = await officialReportPdfBase64(mapReport(reportId, data));
  } catch {
    pdfBase64 = undefined;
  }

  try {
    await deliverFinalApprovalEmail(reportId, pdfBase64);
  } catch {
    /* Approval is already saved. The report shows the email error. */
  }

  if (pdfBase64) {
    try {
      const binary = atob(pdfBase64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      const fileRef = storageRef(storage, `reports/${reportId}/${reportNumber}.pdf`);
      pdfUrl = await withTimeout(
        (async () => {
          await uploadBytes(fileRef, bytes, { contentType: 'application/pdf' });
          return getDownloadURL(fileRef);
        })(),
        8000,
      );
    } catch {
      /* The email already carries the approved PDF when storage is unavailable. */
    }
  }

  try {
    await updateDoc(reportRef, {
      status: 'generated',
      pdfPath: pdfUrl ?? null,
      qrCode,
      publicUrl: publicReportUrl(reportNumber, reportId),
      approvalFlow:
        String(data.reportType) === 'IAR'
          ? {
              ...((data.approvalFlow as Record<string, unknown> | undefined) ?? {}),
              currentStage: 'released',
            }
          : (data.approvalFlow ?? null),
      releaseState:
        String(data.reportType) === 'IAR'
          ? {
              ...((data.releaseState as Record<string, unknown> | undefined) ?? {}),
              attachmentsReleasedAt: nowIso(),
            }
          : (data.releaseState ?? null),
      generatedAt: nowIso(),
      updatedAt: nowIso(),
    });
  } catch (err) {
    const fresh = await getDoc(reportRef);
    const savedStatus = String(fresh.data()?.status ?? '');
    if (savedStatus !== 'generated' && savedStatus !== 'approved') throw err;
    pdfUrl = pdfUrl || String(fresh.data()?.pdfPath ?? '') || undefined;
  }
  await writeAudit(reportId, 'generated', { pdfUrl }, actorName);
  void syncProgressCharts(asId(data.projectId as string)).catch(() => {
    /* schedule/s-curve optional */
  });

  bumpReportsCache();
  return {
    status: 'generated',
    pdf_url: pdfUrl,
    public_url: publicReportUrl(reportNumber, reportId),
  };
}

export async function approveReportFs(
  reportId: string | number,
  _actorId?: string | number,
  actorRole?: string,
  _generate?: { s_curve?: boolean; pdm?: boolean; bar_chart?: boolean; swa?: boolean; stewa?: boolean },
  actorName?: string,
  signatory?: { name?: string; initials?: string },
) {
  const access = await getAccessContext();
  const id = asId(reportId);
  const ref = doc(db, COLLECTIONS.reports, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Report not found');
  const data = snap.data() as Record<string, unknown>;
  const status = String(data.status);
  const role = (actorRole ?? access?.role) as Role | undefined;
  const actorId = _actorId != null ? asId(_actorId) : access?.uid ?? null;
  const selectedAttachments = selectedOptionalAttachments(_generate);
  const isIar = String(data.reportType) === 'IAR';
  const approvalFlowData =
    ((data.approvalFlow as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;

  if (role === 'engineer_2') {
    if (status !== 'pending_review' && status !== 'contractor_confirmed') {
      throw new Error('Report is not pending Engineer II review');
    }
    const engineer2Mark = await actingSignatory('engineer_2', signatory);
    await updateDoc(ref, {
      status: 'with_engineer_3',
      reportData: reportDataWithOwnSignatory(data.reportData, 'engineer_2', signatory ?? {}),
      approvalFlow: {
        ...approvalFlowData,
        engineer2: { ...engineer2Mark, approvedBy: actorId, approvedRole: role },
        currentStage: 'engineer_3',
      },
      updatedAt: nowIso(),
    });
    await writeAudit(id, 'approved_forwarded_e3', {}, actorName);
    await queueEmail(id, 'forwarded_e3');
    bumpReportsCache();
    return { status: 'with_engineer_3', message: 'Forwarded to Engineer III for checking' };
  }

  if (role === 'engineer_3') {
    if (status !== 'with_engineer_3') throw new Error('Report is not with Engineer III');
    if (isIar && !approvalFlowData.engineer2) {
      throw new Error('Engineer II approval is required first');
    }
    const engineer3Mark = await actingSignatory('engineer_3', signatory);
    await updateDoc(ref, {
      status: 'with_engineer_4',
      reportData: reportDataWithOwnSignatory(data.reportData, 'engineer_3', signatory ?? {}),
      approvalFlow: {
        ...approvalFlowData,
        engineer3: { ...engineer3Mark, approvedBy: actorId, approvedRole: role },
        currentStage: 'engineer_4',
      },
      updatedAt: nowIso(),
    });
    await writeAudit(id, 'approved_forwarded_e4', {}, actorName);
    await queueEmail(id, 'forwarded_e4');
    bumpReportsCache();
    return { status: 'with_engineer_4', message: 'Forwarded to Engineer IV for final approval' };
  }

  if (role === 'engineer_4') {
    if (status !== 'with_engineer_4') {
      throw new Error('Report is not ready for final approval');
    }
    if (isIar && (!approvalFlowData.engineer2 || !approvalFlowData.engineer3)) {
      throw new Error('Engineer II and Engineer III approvals are required first');
    }
    const engineer4Mark = await actingSignatory('engineer_4', signatory);
    await updateDoc(ref, {
      status: 'approved',
      reportData: reportDataWithOwnSignatory(data.reportData, 'engineer_4', signatory ?? {}),
      approvalFlow: {
        ...approvalFlowData,
        engineer4: { ...engineer4Mark, approvedBy: actorId, approvedRole: role },
        currentStage: 'engineer_4',
      },
      releaseState: isIar
        ? {
            ...((data.releaseState as Record<string, unknown> | undefined) ?? {}),
            optionalAttachments: selectedAttachments,
            releasedBy: actorId,
            releasedRole: role,
            attachmentsReleasedAt: null,
            emailSentAt: null,
          }
        : data.releaseState ?? null,
      updatedAt: nowIso(),
    });
    await writeAudit(id, 'approved', {}, actorName);
    bumpReportsCache();
    void finalizeGenerated(id, actorName).catch(() => {
      /* Approval is already saved. Email status is recorded separately. */
    });
    return {
      status: 'approved',
      message: 'Report approved. The approval email is sent to the users assigned to this project.',
    };
  }

  throw new Error('This role cannot approve reports');
}

export async function rejectReportFs(
  reportId: string | number,
  reason: string,
  _actorId?: string | number,
  actorName?: string,
) {
  const id = asId(reportId);
  const access = await getAccessContext();
  const reportRef = doc(db, COLLECTIONS.reports, id);
  const snap = await getDoc(reportRef);
  if (!snap.exists()) throw new Error('Report not found');
  const data = snap.data() as Record<string, unknown>;
  let projectData: Record<string, unknown> | null = null;
  let accessUserIds = stringArray(data.accessUserIds);
  try {
    const projectSnap = await getDoc(doc(db, COLLECTIONS.projects, asId(data.projectId as string)));
    if (projectSnap.exists()) {
      projectData = projectSnap.data() as Record<string, unknown>;
      accessUserIds = readProjectAccess(projectData).accessUserIds;
    }
  } catch {
    /* ignore */
  }
  const reopenedEditors = buildEditableUserIds(
    data.reportType as 'SWA' | 'STEWA' | 'IAR',
    accessUserIds,
    projectData,
    data.lastViewedBy != null ? String(data.lastViewedBy) : null,
  );
  const prevApprovalFlow =
    ((data.approvalFlow as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
  await updateDoc(reportRef, {
    status: 'rejected',
    rejectionReason: reason,
    editUserIds: reopenedEditors,
    approvalFlow: {
      contractorConfirmation: null,
      engineer1: null,
      engineer2: null,
      engineer3: null,
      engineer4: null,
      currentStage: 'draft',
      correctionCycle: Number(prevApprovalFlow.correctionCycle ?? 0) + 1,
      lastCorrectionReason: reason,
      lastCorrectionBy: _actorId != null ? asId(_actorId) : access?.uid ?? null,
      lastCorrectionRole: access?.role ?? null,
    },
    emailStatus: 'NOT_SENT',
    emailSentAt: null,
    emailError: null,
    emailMessageId: null,
    emailClaimedAt: null,
    emailRecipients: [],
    updatedAt: nowIso(),
  });
  await writeAudit(id, 'rejected', { reason }, actorName);
  await queueEmail(id, 'revision_requested', { reason });
  bumpReportsCache();
  return { status: 'rejected' };
}

export async function listReportRevisionsFs(reportId: string | number) {
  const snap = await getDocs(collection(db, reportRevisionsPath(asId(reportId))));
  const revisions = snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    return {
      revision_number: Number(data.revisionNumber ?? 0),
      report_data: (data.reportData as Record<string, unknown>) ?? {},
      line_items: (data.lineItems as WorkItem[]) ?? [],
      created_at: String(data.createdAt ?? ''),
      changed_by_name: (data.changedByName as string | undefined) ?? undefined,
    };
  });
  revisions.sort((a, b) => b.revision_number - a.revision_number);
  return { revisions };
}

export async function listReportAuditFs(reportId: string | number) {
  const snap = await getDocs(collection(db, reportAuditPath(asId(reportId))));
  const audit = snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    return {
      action: String(data.action ?? ''),
      details: data.details,
      created_at: String(data.createdAt ?? ''),
      actor_name: (data.actorName as string | undefined) ?? undefined,
    };
  });
  audit.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { audit };
}

export async function regeneratePdfFs(reportIdOrNumber: string | number, actorName?: string) {
  const loaded = await getReportFs(String(reportIdOrNumber));
  const result = await finalizeGenerated(asId(loaded.report.id), actorName);
  return { pdf_url: result.pdf_url ?? '' };
}

async function deleteReportSubcollection(path: string) {
  const snap = await getDocs(collection(db, path));
  await Promise.all(snap.docs.map((entry) => deleteDoc(entry.ref)));
}

export async function deleteReportFs(reportId: string | number) {
  const id = asId(reportId);
  const access = await getAccessContext();
  if (!access) throw new Error('Not signed in');

  const reportRef = doc(db, COLLECTIONS.reports, id);
  const snap = await getDoc(reportRef);
  if (!snap.exists()) throw new Error('Report not found');

  const data = snap.data() as Record<string, unknown>;
  const status = String(data.status ?? '');
  const createdBy = data.createdBy != null ? asId(data.createdBy as string) : null;
  const projectId = asId(data.projectId as string);

  if (access.role === 'engineer_4') {
    // Engineer IV retains unrestricted delete (admin cleanup).
  } else if (access.role === 'engineer_1' || access.role === 'contractor') {
    const projectIds = await getAccessibleProjectIds(access.uid);
    const accessUserIds = stringArray(data.accessUserIds);
    if (!projectIds.includes(projectId) && !accessUserIds.includes(access.uid)) {
      throw new Error('You do not have access to delete this document.');
    }
    if (createdBy && createdBy !== access.uid) {
      throw new Error('You can only delete your own documents.');
    }
  } else {
    throw new Error('You do not have permission to delete this document.');
  }

  // Remove related draft data first (rules still resolve parent while it exists).
  await deleteReportSubcollection(reportAuditPath(id));
  await deleteReportSubcollection(reportRevisionsPath(id));
  await deleteDoc(reportRef);
  bumpReportsCache();
  return { ok: true };
}

export async function emailApproveFromLinkFs(reportId: string | number, token: string) {
  const id = asId(reportId);
  const snap = await getDoc(doc(db, COLLECTIONS.reports, id));
  if (!snap.exists()) throw new Error('Report not found');
  const data = snap.data() as Record<string, unknown>;
  if (String(data.emailApproveToken ?? '') !== token) {
    throw new Error('Invalid or expired token');
  }
  if (String(data.status) !== 'pending_review') {
    throw new Error('Report is not pending review');
  }
  await updateDoc(doc(db, COLLECTIONS.reports, id), {
    status: 'with_engineer_3',
    updatedAt: nowIso(),
  });
  await writeAudit(id, 'email_approved_forwarded');
  return { status: 'with_engineer_3', message: 'Approved via email — forwarded to Engineer III' };
}

export async function emailReviseFromLinkFs(
  reportId: string | number,
  token: string,
  reason: string,
) {
  const id = asId(reportId);
  const snap = await getDoc(doc(db, COLLECTIONS.reports, id));
  if (!snap.exists()) throw new Error('Report not found');
  const data = snap.data() as Record<string, unknown>;
  if (String(data.emailReviseToken ?? '') !== token) {
    throw new Error('Invalid or expired token');
  }
  await updateDoc(doc(db, COLLECTIONS.reports, id), {
    status: 'rejected',
    rejectionReason: reason,
    updatedAt: nowIso(),
  });
  await writeAudit(id, 'email_revise', { reason });
  return { status: 'rejected', message: 'Revision request sent to Engineer I' };
}

export async function retryApprovalEmailFs(reportId: string | number) {
  const access = await getAccessContext();
  if (!access) throw new Error('Not signed in');
  if (!['engineer_2', 'engineer_3', 'engineer_4'].includes(access.role)) {
    throw new Error('You cannot retry this notification');
  }
  await deliverFinalApprovalEmail(asId(reportId));
  bumpReportsCache();
  return { emailStatus: 'SENT' };
}

async function approvedReportPdfBase64(reportId: string) {
  if (typeof document === 'undefined') return undefined;
  const { officialReportPdfBase64 } = await import('../downloadReportPdf');
  const loaded = await getReportFs(reportId);
  return officialReportPdfBase64(loaded.report);
}

async function deliverFinalApprovalEmail(reportId: string, pdfBase64?: string) {
  try {
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error('Not signed in');
    let attachment = pdfBase64;
    if (!attachment) {
      try {
        attachment = await approvedReportPdfBase64(reportId);
      } catch {
        attachment = undefined;
      }
    }
    const origin = typeof window !== 'undefined' ? window.location.origin : (process.env.APP_URL || 'http://localhost:3000');
    const response = await fetch(`${origin}/api/approval-email/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reportId, pdfBase64: attachment }),
      signal: AbortSignal.timeout(90000),
    });
    const payload = (await response.json()) as {
      sent?: boolean;
      skipped?: boolean;
      recipients?: string[];
      messageId?: string | null;
      sentAt?: string;
      error?: string;
    };
    if (!response.ok || !payload.sent) {
      const error = payload.error || 'Approval email failed.';
      await markApprovalEmail(reportId, { status: 'FAILED', error, recipients: payload.recipients ?? [] });
      throw new Error(error);
    }
    if (!payload.skipped) {
      await markApprovalEmail(reportId, {
        status: 'SENT',
        sentAt: payload.sentAt ?? nowIso(),
        messageId: payload.messageId ?? null,
        recipients: payload.recipients ?? [],
      });
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Approval email failed.';
    await markApprovalEmail(reportId, { status: 'FAILED', error, recipients: [] }).catch(() => {
      /* The approval itself stays saved. */
    });
    throw new Error(error);
  }
}

async function markApprovalEmail(
  reportId: string,
  result: {
    status: 'SENT' | 'FAILED';
    sentAt?: string | null;
    error?: string | null;
    messageId?: string | null;
    recipients?: string[];
  },
) {
  await updateDoc(doc(db, COLLECTIONS.reports, reportId), {
    emailStatus: result.status,
    emailSentAt: result.sentAt ?? null,
    emailError: result.error ?? null,
    emailMessageId: result.messageId ?? null,
    emailRecipients: result.recipients ?? [],
    updatedAt: nowIso(),
  });
}

async function queueEmail(
  reportId: string,
  event: string,
  extra: Record<string, unknown> = {},
) {
  await addDoc(collection(db, COLLECTIONS.emailQueue), {
    reportId,
    event,
    status: 'queued',
    ...extra,
    createdAt: nowIso(),
  });
  const send = httpsCallable(functions, 'sendWorkflowEmail');
  void send({ reportId, event, ...extra }).catch(() => {
    /* Queue trigger sends the message if this call does not finish. */
  });
}
