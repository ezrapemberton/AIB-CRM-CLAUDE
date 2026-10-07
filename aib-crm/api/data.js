// Sync endpoint for the AIB recruitment workspace.
// Stores the whole workspace as one JSON document in Upstash Redis (Vercel Marketplace).
// Env vars: KV_REST_API_URL + KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)
//           APP_PASSCODE  — required; every request must send it in the x-passcode header.
import { createHash, timingSafeEqual } from 'node:crypto';

const KEY = 'aib:workspace:v1';
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const PASS = process.env.APP_PASSCODE;

const sha = (s) => createHash('sha256').update(String(s)).digest();
const passOk = (given) => !!given && timingSafeEqual(sha(given), sha(PASS));

async function redis(cmd) {
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error(`Redis ${r.status}`);
  return (await r.json()).result;
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_ || !TOKEN || !PASS) {
    return res.status(503).json({ configured: false, missing: { redis: !URL_ || !TOKEN, passcode: !PASS } });
  }
  if (!passOk(req.headers['x-passcode'])) return res.status(401).json({ error: 'bad passcode' });

  try {
    const raw = await redis(['GET', KEY]);
    const current = raw ? JSON.parse(raw) : { rev: 0, state: null };

    if (req.method === 'GET') return res.status(200).json(current);

    if (req.method === 'PUT') {
      const body = await readBody(req);
      if (!body || typeof body.state !== 'object') return res.status(400).json({ error: 'missing state' });
      if (Number(body.baseRev) !== current.rev) return res.status(409).json(current);
      const next = { rev: current.rev + 1, savedAt: new Date().toISOString(), state: body.state };
      const json = JSON.stringify(next);
      if (json.length > 900_000) return res.status(413).json({ error: 'workspace too large' });
      await redis(['SET', KEY, json]);
      return res.status(200).json({ rev: next.rev, savedAt: next.savedAt });
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(502).json({ error: 'storage error' });
  }
}
