import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';

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

const user = process.env.SMTP_USER || '';
const pass = process.env.SMTP_PASS || '';
const TARGET_MID = '<732be24d-987a-99e8-1c56-e5122ef792f4@gmail.com>';

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

  async search(query: string) {
    const res = await this.exec(`SEARCH ${query}`);
    const match = res.match(/\* SEARCH ([\d\s]+)/);
    if (!match || !match[1].trim()) return [];
    return match[1].trim().split(/\s+/).map(Number);
  }

  async fetchBody(msgSeq: number): Promise<string> {
    return await this.exec(`FETCH ${msgSeq} (BODY[TEXT])`);
  }

  async fetchFull(msgSeq: number): Promise<string> {
    return await this.exec(`FETCH ${msgSeq} (BODY[])`);
  }

  async fetchHeaders(msgSeq: number): Promise<Record<string, string>> {
    const res = await this.exec(`FETCH ${msgSeq} (BODY.PEEK[HEADER.FIELDS (DATE FROM TO SUBJECT MESSAGE-ID REFERENCES IN-REPLY-TO)])`);
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

  async close() {
    try {
      await this.exec('LOGOUT');
    } catch {}
    this.socket.end();
  }
}

async function main() {
  const imap = new ImapClient();
  await imap.connect();
  await imap.login(user, pass);

  console.log('Connected and authenticated as', user);

  // Check INBOX for all bounces
  await imap.select('INBOX');
  const inboxAll = await imap.search('ALL');
  console.log(`Total messages in INBOX: ${inboxAll.length}`);

  // Check the last 20 messages in INBOX
  const recentInbox = inboxAll.slice(-20);
  const targetBounces: any[] = [];

  for (const seq of recentInbox) {
    const text = await imap.fetchBody(seq);
    if (text.includes('732be24d-987a-99e8-1c56-e5122ef792f4') || text.includes('SWA-2026-AUG-06-13-TEST-6036')) {
      const h = await imap.fetchHeaders(seq);
      const mRecipient = text.match(/Final-Recipient: rfc822;\s*([^\r\n]+)/i);
      const mDiag = text.match(/Diagnostic-Code:\s*([^\r\n]+(?:\r?\n\s+[^\r\n]+)*)/i);
      const mAction = text.match(/Action:\s*([^\r\n]+)/i);
      const mStatus = text.match(/Status:\s*([^\r\n]+)/i);

      targetBounces.push({
        seq,
        date: h['date'],
        from: h['from'],
        subject: h['subject'],
        finalRecipient: mRecipient ? mRecipient[1].trim() : 'unknown',
        action: mAction ? mAction[1].trim() : 'failed',
        status: mStatus ? mStatus[1].trim() : 'unknown',
        diagnostic: mDiag ? mDiag[1].replace(/\r?\n\s+/g, ' ').trim() : 'none',
      });
    }
  }

  console.log(`\nFound ${targetBounces.length} bounce notifications directly referencing Message-ID ${TARGET_MID}:`);
  targetBounces.forEach((b, i) => {
    console.log(`\n[Bounce #${i + 1}] (Inbox Seq ${b.seq})`);
    console.log(`  Date: ${b.date}`);
    console.log(`  Final-Recipient: ${b.finalRecipient}`);
    console.log(`  Status: ${b.status}`);
    console.log(`  Diagnostic: ${b.diagnostic}`);
  });

  // Now search for any mention of engineerii or engineeriii across all mail
  console.log('\nSearching for any bounces concerning engineerii or engineeriii...');
  for (const acc of ['constructflow.engineerii@gmail.com', 'constructflow.engineeriii@gmail.com']) {
    let foundBounce = false;
    for (const seq of recentInbox) {
      const text = await imap.fetchBody(seq);
      if (text.toLowerCase().includes(acc.toLowerCase())) {
        console.log(`  Found mention of ${acc} in Inbox Seq #${seq}`);
        foundBounce = true;
      }
    }
    if (!foundBounce) {
      console.log(`  No bounce/failure notification found for ${acc}`);
    }
  }

  await imap.close();
}

main().catch(console.error);
