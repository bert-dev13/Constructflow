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
const mailFrom = process.env.MAIL_FROM || user;

const recipient = 'constructflow.contractor.1@gmail.com';
const uniqueTimestamp = new Date().toISOString();
const subject = `ConstructFlow Plain Email Test ${uniqueTimestamp}`;
const text = 'ConstructFlow plain email delivery test.';

class ImapClient {
  private socket!: tls.TLSSocket;
  private buffer = '';
  private tagIndex = 1;

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = tls.connect(993, 'imap.gmail.com', { rejectUnauthorized: false }, () => {});
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
        const t = chunk.toString('utf8');
        result += t;
        if (result.includes(`${tag} OK`)) {
          this.socket.off('data', onData);
          resolve(result);
        } else if (result.includes(`${tag} NO`) || result.includes(`${tag} BAD`)) {
          this.socket.off('data', onData);
          reject(new Error(`IMAP error: ${result}`));
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

  async search(query: string) {
    const res = await this.exec(`SEARCH ${query}`);
    const match = res.match(/\* SEARCH ([\d\s]+)/);
    if (!match || !match[1].trim()) return [];
    return match[1].trim().split(/\s+/).map(Number);
  }

  async close() {
    try {
      await this.exec('LOGOUT');
    } catch {}
    this.socket.end();
  }
}

async function main() {
  console.log('==================================================');
  console.log('ISOLATED PLAIN-TEXT EMAIL TEST');
  console.log('==================================================');
  console.log(`From: ConstructFlow <${mailFrom}>`);
  console.log(`To: ${recipient}`);
  console.log(`Subject: ${subject}`);
  console.log(`Body: ${text}\n`);

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  const sent = await transport.sendMail({
    from: `ConstructFlow <${mailFrom}>`,
    replyTo: user,
    to: recipient,
    envelope: { from: user, to: recipient },
    subject,
    text,
  });

  console.log('Nodemailer send result:');
  console.log(`  messageId: ${sent.messageId}`);
  console.log(`  envelope.from: ${sent.envelope?.from}`);
  console.log(`  envelope.to:`, sent.envelope?.to);
  console.log(`  accepted[]:`, sent.accepted);
  console.log(`  rejected[]:`, sent.rejected);
  console.log(`  response: ${sent.response}\n`);

  console.log('Waiting 5 seconds for Gmail sync & delivery attempt...');
  await new Promise((r) => setTimeout(r, 5000));

  console.log('\n==================================================');
  console.log('VERIFY SENDER SENT MAIL (constructflow123@gmail.com)');
  console.log('==================================================');

  const imap = new ImapClient();
  await imap.connect();
  await imap.login(user, pass);

  // Check Sent Mail
  await imap.select('[Gmail]/Sent Mail');
  const sentMsgs = await imap.search('ALL');
  const latestSentSeq = sentMsgs[sentMsgs.length - 1];
  const sentHeaders = await imap.fetchHeaders(latestSentSeq);

  const foundInSent = sentHeaders['message-id'] === sent.messageId || (sentHeaders['subject'] || '').includes(uniqueTimestamp);

  console.log(`Latest Sent message (#${latestSentSeq}):`);
  console.log(`  Date: ${sentHeaders['date']}`);
  console.log(`  From: ${sentHeaders['from']}`);
  console.log(`  To: ${sentHeaders['to']}`);
  console.log(`  Subject: ${sentHeaders['subject']}`);
  console.log(`  Message-ID: ${sentHeaders['message-id']}`);
  console.log(`\nFound in sender Sent Mail = ${foundInSent ? 'YES' : 'NO'}`);

  // Check Inbox for any immediate bounce
  console.log('\nChecking for immediate bounce notification in INBOX...');
  await imap.select('INBOX');
  const inboxMsgs = await imap.search('ALL');
  const latestInboxSeq = inboxMsgs[inboxMsgs.length - 1];
  const inboxHeaders = await imap.fetchHeaders(latestInboxSeq);

  console.log(`Latest Inbox message (#${latestInboxSeq}):`);
  console.log(`  Date: ${inboxHeaders['date']}`);
  console.log(`  From: ${inboxHeaders['from']}`);
  console.log(`  Subject: ${inboxHeaders['subject']}`);

  await imap.close();
}

main().catch(console.error);
