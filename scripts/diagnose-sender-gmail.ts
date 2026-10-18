import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';

// 1. Load environment variables
function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}
loadEnvLocal();

const host = process.env.SMTP_HOST || 'smtp.gmail.com';
const port = Number(process.env.SMTP_PORT || 587);
const user = process.env.SMTP_USER || '';
const pass = process.env.SMTP_PASS || '';
const mailFrom = process.env.MAIL_FROM || '';

console.log('==================================================');
console.log('3. RUNTIME SMTP ACCOUNT IDENTITY');
console.log('==================================================');
console.log(`SMTP_HOST = ${host}`);
console.log(`SMTP_PORT = ${port}`);
console.log(`SMTP_SECURE = ${port === 465}`);
console.log(`SMTP_USER = ${user}`);
console.log(`MAIL_FROM = ${mailFrom || user}`);
console.log(`Nodemailer from = ConstructFlow <${mailFrom || user}>`);
console.log(`Nodemailer envelope.from = ${user}`);

console.log('\n==================================================');
console.log('4. RUN transporter.verify()');
console.log('==================================================');

const transporter = nodemailer.createTransport({
  host,
  port,
  secure: port === 465,
  auth: { user, pass },
});

async function runVerify() {
  try {
    const ok = await transporter.verify();
    console.log(`SMTP connection = PASS`);
    console.log(`SMTP authentication = ${ok ? 'PASS' : 'FAIL'}`);
  } catch (err: any) {
    console.log(`SMTP connection/authentication = FAIL: ${err.message}`);
  }
}

// IMAP helper to query Gmail directly
class ImapClient {
  private socket!: tls.TLSSocket;
  private buffer = '';
  private tagIndex = 1;

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = tls.connect(993, 'imap.gmail.com', { rejectUnauthorized: false }, () => {
        // wait for greeting
      });
      this.socket.on('data', (d) => {
        this.buffer += d.toString('utf8');
        if (this.buffer.includes('* OK Gimap ready')) {
          this.buffer = '';
          resolve();
        }
      });
      this.socket.on('error', reject);
    });
  }

  async exec(cmd: string): Promise<string> {
    const tag = `T${this.tagIndex++}`;
    return new Promise((resolve, reject) => {
      let result = '';
      const onData = (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        result += text;
        if (result.includes(`${tag} OK`)) {
          this.socket.off('data', onData);
          resolve(result);
        } else if (result.includes(`${tag} NO`) || result.includes(`${tag} BAD`)) {
          this.socket.off('data', onData);
          reject(new Error(`IMAP command failed: ${result}`));
        }
      };
      this.socket.on('data', onData);
      this.socket.write(`${tag} ${cmd}\r\n`);
    });
  }

  async login(u: string, p: string) {
    await this.exec(`LOGIN ${u} ${p}`);
  }

  async select(folder: string) {
    return await this.exec(`SELECT "${folder}"`);
  }

  async search(query: string) {
    const res = await this.exec(`SEARCH ${query}`);
    const match = res.match(/\* SEARCH ([\d\s]+)/);
    if (!match || !match[1].trim()) return [];
    return match[1].trim().split(/\s+/).map(Number);
  }

  async fetchHeaders(msgSeq: number): Promise<Record<string, string>> {
    const res = await this.exec(`FETCH ${msgSeq} (BODY.PEEK[HEADER.FIELDS (DATE FROM TO SUBJECT MESSAGE-ID)])`);
    const headers: Record<string, string> = {};
    const lines = res.split(/\r?\n/);
    let currentKey = '';
    for (const line of lines) {
      const m = line.match(/^([A-Za-z0-9-]+):\s*(.*)$/);
      if (m) {
        currentKey = m[1].toLowerCase();
        headers[currentKey] = m[2].trim();
      } else if (currentKey && /^\s+/.test(line)) {
        headers[currentKey] += ' ' + line.trim();
      }
    }
    return headers;
  }

  async fetchSnippet(msgSeq: number): Promise<string> {
    const res = await this.exec(`FETCH ${msgSeq} (BODY.PEEK[TEXT]<0.500>)`);
    return res;
  }

  async close() {
    try {
      await this.exec('LOGOUT');
    } catch {}
    this.socket.end();
  }
}

async function runImapDiagnostics() {
  await runVerify();

  console.log('\n==================================================');
  console.log('1. CHECK SENDER GMAIL SENT MAIL (constructflow123@gmail.com)');
  console.log('==================================================');

  const imap = new ImapClient();
  await imap.connect();
  await imap.login(user, pass);

  // Check Sent Mail
  await imap.select('[Gmail]/Sent Mail');
  const allSent = await imap.search('ALL');
  console.log(`Total messages in Sent Mail: ${allSent.length}`);

  // Inspect the last 10 sent messages
  const last10 = allSent.slice(-10);
  console.log(`Inspecting last ${last10.length} sent messages:`);
  
  let targetSentFound = false;
  let targetDetails: any = null;

  for (const seq of last10) {
    const h = await imap.fetchHeaders(seq);
    console.log(`\n  [Sent Msg #${seq}]`);
    console.log(`    Date: ${h['date']}`);
    console.log(`    From: ${h['from']}`);
    console.log(`    To: ${h['to']}`);
    console.log(`    Subject: ${h['subject']}`);
    console.log(`    Message-ID: ${h['message-id']}`);

    const subj = h['subject'] || '';
    const mid = h['message-id'] || '';
    if (
      subj.includes('SWA-2026-AUG-06-13-TEST-6036') ||
      subj.includes('Road Opening') ||
      mid.includes('732be24d-987a-99e8-1c56-e5122ef792f4')
    ) {
      targetSentFound = true;
      targetDetails = h;
    }
  }

  console.log('\n--- TARGET SWA APPROVAL EMAIL IN SENT MAIL ---');
  if (targetSentFound) {
    console.log(`Message exists in Sent = YES`);
    console.log(`Timestamp = ${targetDetails?.date}`);
    console.log(`From = ${targetDetails?.from}`);
    console.log(`To = ${targetDetails?.to}`);
    console.log(`Subject = ${targetDetails?.subject}`);
    console.log(`Message-ID = ${targetDetails?.['message-id']}`);
  } else {
    console.log(`Message exists in Sent = NO`);
  }

  console.log('\n==================================================');
  console.log('2. CHECK FOR BOUNCE / DELIVERY FAILURE');
  console.log('==================================================');

  const foldersToCheck = ['INBOX', '[Gmail]/Spam', '[Gmail]/All Mail'];
  let bounceFound = false;
  const bounceDetails: any[] = [];

  for (const folder of foldersToCheck) {
    try {
      await imap.select(folder);
      const allMsgs = await imap.search('ALL');
      const recent = allMsgs.slice(-15);
      console.log(`Folder "${folder}": total ${allMsgs.length} messages, inspecting last ${recent.length}...`);
      for (const seq of recent) {
        const h = await imap.fetchHeaders(seq);
        const subj = (h['subject'] || '').toLowerCase();
        const from = (h['from'] || '').toLowerCase();
        if (
          subj.includes('delivery') ||
          subj.includes('failure') ||
          subj.includes('subsystem') ||
          subj.includes('undelivered') ||
          subj.includes('incomplete') ||
          subj.includes('blocked') ||
          subj.includes('status notification') ||
          from.includes('mailer-daemon') ||
          from.includes('postmaster')
        ) {
          bounceFound = true;
          bounceDetails.push({ folder, seq, ...h });
          console.log(`  >>> POTENTIAL BOUNCE IN ${folder}:`, h);
        }
      }
    } catch (e: any) {
      console.log(`Could not check folder ${folder}:`, e.message);
    }
  }

  console.log(`\nBounce/DSN found = ${bounceFound ? 'YES' : 'NO'}`);
  if (bounceFound) {
    console.log('Bounce details:', JSON.stringify(bounceDetails, null, 2));
  }

  await imap.close();
}

runImapDiagnostics().catch(console.error);
