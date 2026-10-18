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

  async close() {
    try {
      await this.exec('LOGOUT');
    } catch {}
    this.socket.end();
  }
}

async function run() {
  const client = new ImapClient();
  await client.connect();
  await client.exec(`LOGIN ${user} ${pass}`);
  await client.exec('SELECT "INBOX"');

  const bouncesByRecipient: Record<string, number> = {};

  for (let seq = 70; seq <= 90; seq++) {
    const text = await client.exec(`FETCH ${seq} (BODY.PEEK[TEXT]<0.1500>)`);
    const mRec = text.match(/Final-Recipient: rfc822;\s*([^\r\n;]+)/i);
    const mDiag = text.match(/Diagnostic-Code:\s*([^\r\n]+)/i);
    if (mRec) {
      const rec = mRec[1].trim();
      bouncesByRecipient[rec] = (bouncesByRecipient[rec] || 0) + 1;
      console.log(`Seq #${seq}: Recipient = ${rec} | Diag = ${mDiag ? mDiag[1] : 'none'}`);
    }
  }

  console.log('\nSummary of bounces in recent history (Seqs 70-90):');
  console.log(JSON.stringify(bouncesByRecipient, null, 2));

  await client.close();
}

run().catch(console.error);
