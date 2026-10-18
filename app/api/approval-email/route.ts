import nodemailer from 'nodemailer';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

function pdfFromBase64(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(/\s/g, '');
  if (cleaned.length < 100 || cleaned.length > 8_000_000) return undefined;
  const content = Buffer.from(cleaned, 'base64');
  if (content.subarray(0, 5).toString() !== '%PDF-') return undefined;
  return content;
}

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'constructflow-c82cd';
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '';
const FINAL_ROLES = ['contractor', 'engineer_1', 'engineer_2', 'engineer_3', 'engineer_4'] as const;

type Fields = Record<string, FsValue>;
type FsValue = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  nullValue?: null;
  timestampValue?: string;
  arrayValue?: { values?: FsValue[] };
  mapValue?: { fields?: Fields };
};

function decodeValue(value: FsValue | undefined): unknown {
  if (!value) return null;
  if ('stringValue' in value) return value.stringValue ?? '';
  if ('integerValue' in value) return value.integerValue ?? '0';
  if ('doubleValue' in value) return value.doubleValue ?? 0;
  if ('booleanValue' in value) return value.booleanValue ?? false;
  if ('timestampValue' in value) return value.timestampValue ?? '';
  if ('nullValue' in value) return null;
  if (value.arrayValue) return (value.arrayValue.values ?? []).map((item) => decodeValue(item));
  if (value.mapValue) return decodeFields(value.mapValue.fields);
  return null;
}

function decodeFields(fields: Fields | undefined) {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields ?? {})) data[key] = decodeValue(value);
  return data;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item ?? '').trim()).filter(Boolean) : [];
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function lookupUid(idToken: string) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    },
  );
  const payload = (await response.json()) as { users?: { localId?: string }[]; error?: { message?: string } };
  const uid = payload.users?.[0]?.localId;
  if (!response.ok || !uid) {
    throw new Error(payload.error?.message || 'Sign-in token was rejected.');
  }
  return uid;
}

async function readDoc(idToken: string, path: string) {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`,
    { headers: { Authorization: `Bearer ${idToken}` } },
  );
  if (response.status === 404) return null;
  const payload = (await response.json()) as { fields?: Fields; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || `Could not read ${path}`);
  return decodeFields(payload.fields);
}

async function queryByRole(idToken: string, role: string) {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'users' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'role' },
              op: 'EQUAL',
              value: { stringValue: role },
            },
          },
        },
      }),
    },
  );
  const payload = (await response.json()) as { document?: { fields?: Fields }; error?: { message?: string } }[];
  if (!response.ok) throw new Error('Could not look up project reviewers.');
  return payload
    .map((row) => (row.document ? decodeFields(row.document.fields) : null))
    .filter((row): row is Record<string, unknown> => Boolean(row));
}

function remember(list: { email: string; name: string }[], email: string, name: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes('@') || list.some((item) => item.email === normalized)) return;
  list.push({ email: normalized, name: name.trim() || 'Project Stakeholder' });
}

async function resolveRecipients(
  idToken: string,
  projectId: string,
  project: Record<string, unknown>,
  report?: Record<string, unknown>,
) {
  const recipients: { email: string; name: string }[] = [];
  const covered = new Set<string>();
  const approvalFlow = (report?.approvalFlow as Record<string, any>) || {};
  const stageSignatories = [
    approvalFlow.contractorConfirmation?.userId,
    approvalFlow.contractorConfirmation?.approvedBy,
    approvalFlow.engineer1?.userId,
    approvalFlow.engineer1?.approvedBy,
    approvalFlow.engineer2?.userId,
    approvalFlow.engineer2?.approvedBy,
    approvalFlow.engineer3?.userId,
    approvalFlow.engineer3?.approvedBy,
    approvalFlow.engineer4?.userId,
    approvalFlow.engineer4?.approvedBy,
  ];

  const ids = [
    ...new Set(
      [
        typeof project.contractorId === 'string' ? project.contractorId : '',
        ...stringArray(project.assignedUserIds),
        ...stringArray(project.involvedUserIds),
        ...stringArray(project.accessUserIds),
        typeof report?.contractorId === 'string' ? report.contractorId : '',
        typeof report?.createdBy === 'string' ? report.createdBy : '',
        ...stageSignatories.map((id) => (typeof id === 'string' ? id : '')),
      ].filter(Boolean),
    ),
  ];

  for (const id of ids) {
    const user = await readDoc(idToken, `users/${id}`);
    if (!user || user.isActive === false) continue;
    const role = String(user.role ?? '');
    const email = String(user.email ?? '');
    if (!FINAL_ROLES.includes(role as (typeof FINAL_ROLES)[number])) continue;
    remember(recipients, email, String(user.fullName ?? ''));
    covered.add(role);
  }

  for (const role of FINAL_ROLES) {
    if (covered.has(role)) continue;
    const users = await queryByRole(idToken, role);
    for (const user of users) {
      if (user.isActive === false) continue;
      const accessible = stringArray(user.accessibleProjectIds);
      const assigned = stringArray(user.assignedProjectIds);
      const involved = stringArray(user.involvedProjectIds);
      const covers =
        accessible.includes(projectId) ||
        assigned.includes(projectId) ||
        involved.includes(projectId) ||
        accessible.length === 0;
      if (!covers) continue;
      remember(recipients, String(user.email ?? ''), String(user.fullName ?? ''));
      covered.add(role);
      break;
    }
  }

  return recipients;
}

export async function POST(request: Request) {
  try {
    const header = request.headers.get('authorization') || '';
    const idToken = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!idToken || !API_KEY) {
      return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
    }

    const body = (await request.json()) as { reportId?: string; pdfBase64?: string };
    const reportId = String(body.reportId ?? '').trim();
    if (!reportId) return NextResponse.json({ error: 'Report is required.' }, { status: 400 });

    const uid = await lookupUid(idToken);
    const actor = await readDoc(idToken, `users/${uid}`);
    const role = String(actor?.role ?? '');
    if (!actor || actor.isActive === false || !['engineer_2', 'engineer_3', 'engineer_4'].includes(role)) {
      return NextResponse.json({ error: 'You cannot send this notification.' }, { status: 403 });
    }

    const report = await readDoc(idToken, `reports/${reportId}`);
    if (!report) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });
    const status = String(report.status ?? '');
    if (status !== 'approved' && status !== 'generated') {
      return NextResponse.json({ error: 'Report is not fully approved.' }, { status: 409 });
    }
    if (String(report.emailStatus ?? '') === 'SENT') {
      return NextResponse.json({
        sent: true,
        skipped: true,
        recipients: stringArray(report.emailRecipients),
      });
    }

    const projectId = String(report.projectId ?? '');
    const project = await readDoc(idToken, `projects/${projectId}`);
    if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });

    const recipients = await resolveRecipients(idToken, projectId, project, report);
    if (recipients.length === 0) {
      return NextResponse.json({ error: 'No recipient email addresses are stored for this project.' }, { status: 409 });
    }

    const recipientEmails = recipients.map((r) => r.email);
    const uniqueEmails = new Set(recipientEmails.map((e) => e.toLowerCase()));
    const duplicateCount = recipientEmails.length - uniqueEmails.size;

    console.log(`Resolved recipient count = ${recipientEmails.length}`);
    console.log(`Recipient addresses = [${recipientEmails.join(', ')}]`);
    console.log(`Duplicate recipients = ${duplicateCount}`);

    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!host || !user || !pass) {
      return NextResponse.json({ error: 'Email transport is not configured on the server.' }, { status: 503 });
    }

    const projectName = String(project.name ?? report.projectName ?? projectId);
    const reportType = String(report.reportType ?? 'IAR');
    const reportNumber = String(report.reportNumber ?? reportId);
    const pdfUrl = String(report.pdfPath ?? '').trim();
    let attachment: { filename: string; content: Buffer } | undefined;
    const approvedPdf = pdfFromBase64(body.pdfBase64);
    if (approvedPdf) {
      attachment = { filename: `${reportNumber}.pdf`, content: approvedPdf };
    } else if (pdfUrl) {
      const pdf = await fetch(pdfUrl);
      if (pdf.ok) {
        attachment = { filename: `${reportNumber}.pdf`, content: Buffer.from(await pdf.arrayBuffer()) };
      }
    }

    const from = `ConstructFlow <${process.env.MAIL_FROM || user}>`;
    const transport = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: { user, pass },
    });
    const subject = `ConstructFlow - Project Approved - ${projectName}`;

    const text = [
      'Dear ConstructFlow Project Stakeholders,',
      '',
      'The following ConstructFlow project has completed the required approval workflow:',
      '',
      'Project:',
      projectName,
      '',
      'Report:',
      `${reportType} (${reportNumber})`,
      '',
      'Status:',
      'APPROVED',
      '',
      'The project has been fully approved by the required approving personnel (Contractor, Engineer I, Engineer II, Engineer III, and Engineer IV).',
      '',
      attachment ? `The approved ${reportType} report is attached.` : `The approved ${reportType} report is recorded in ConstructFlow.`,
      '',
      'Regards,',
      '',
      'ConstructFlow',
      "Provincial Engineer's Office",
      'Construction Division',
    ].join('\n');

    const html = `<p>Dear ConstructFlow Project Stakeholders,</p><p>The following ConstructFlow project has completed the required approval workflow:</p><p><strong>Project:</strong><br>${escapeHtml(projectName)}</p><p><strong>Report:</strong><br>${escapeHtml(reportType)} (${escapeHtml(reportNumber)})</p><p><strong>Status:</strong><br>APPROVED</p><p>The project has been fully approved by the required approving personnel (Contractor, Engineer I, Engineer II, Engineer III, and Engineer IV).</p><p>${attachment ? `The approved ${escapeHtml(reportType)} report is attached.` : `The approved ${escapeHtml(reportType)} report is recorded in ConstructFlow.`}</p><p>Regards,</p><p><strong>ConstructFlow</strong><br>Provincial Engineer's Office<br>Construction Division</p>`;

    const sent = await transport.sendMail({
      from,
      replyTo: user,
      to: recipientEmails,
      envelope: { from: user, to: recipientEmails },
      subject,
      text,
      html,
      attachments: attachment ? [attachment] : undefined,
    });

    console.log('Nodemailer send result:');
    console.log('  messageId:', sent.messageId);
    console.log('  envelope.from:', sent.envelope?.from);
    console.log('  envelope.to:', sent.envelope?.to);
    console.log('  accepted[]:', sent.accepted);
    console.log('  rejected[]:', sent.rejected);
    console.log('  response:', sent.response);

    if (Array.isArray(sent.rejected) && sent.rejected.length > 0) {
      throw new Error(`Email rejected for recipients: ${sent.rejected.join(', ')}`);
    }

    return NextResponse.json({
      sent: true,
      recipients: recipientEmails,
      messageId: sent.messageId ?? null,
      envelope: sent.envelope,
      accepted: sent.accepted,
      rejected: sent.rejected,
      response: sent.response,
      sentAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Email send failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
