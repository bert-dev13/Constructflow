import { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';

const OUT = path.join(process.cwd(), 'scurve-debug.json');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');
  try {
    const body = req.body;
    const entry = {
      time: new Date().toISOString(),
      payload: body,
    };
    const cur = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8') || '[]') : [];
    cur.push(entry);
    fs.writeFileSync(OUT, JSON.stringify(cur, null, 2));
    res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('save_scurve error', err?.message || err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}

