// Request guard for the public demo.
//
// The web page builds its prompts in the browser, so the endpoints receive a
// prompt string. Without checks, anyone could use them as a free general AI
// service on this project's Nebius key and drain the credits judges rely on.
// The guard only lets through requests that look like they came from this
// app's own page:
//   1. same-origin browser requests (the Origin header must match this host);
//   2. a prompt of a sensible size;
//   3. the Quilldeck markers each endpoint's prompts always contain;
//   4. a per-visitor rate limit (best effort: it is kept per server instance).

const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 30;
const hits = new Map<string, number[]>();

export const MAX_PROMPT_CHARS = 14_000;

function clientIp(req: any): string {
  const fwd = String(req.headers?.['x-forwarded-for'] ?? '');
  return fwd.split(',')[0].trim() || String(req.headers?.['x-real-ip'] ?? 'unknown');
}

function sameOrigin(req: any): boolean {
  const hosts = [req.headers?.host, req.headers?.['x-forwarded-host']]
    .flatMap((h) => String(h ?? '').split(','))
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  const origin = String(req.headers?.origin ?? req.headers?.referer ?? '');
  if (hosts.length === 0 || !origin) return false;
  try {
    return hosts.includes(new URL(origin).host.toLowerCase());
  } catch {
    return false;
  }
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear(); // keep memory bounded
  return recent.length > MAX_REQUESTS;
}

/**
 * Returns true if the request may proceed. Otherwise it has already sent the
 * error response and the handler should return.
 * `markers`: text every genuine prompt for this endpoint contains.
 */
export function guard(req: any, res: any, markers: string[] = [], prompt?: unknown): boolean {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return false;
  }
  if (!sameOrigin(req)) {
    res.status(403).json({ error: 'This endpoint only serves the Quilldeck web app.' });
    return false;
  }
  if (rateLimited(clientIp(req))) {
    res.status(429).json({ error: 'Too many requests in a short time. Please wait a few minutes and try again.' });
    return false;
  }
  if (prompt !== undefined) {
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      res.status(400).json({ error: 'Prompt is required' });
      return false;
    }
    if (prompt.length > MAX_PROMPT_CHARS) {
      res.status(413).json({ error: 'That request is too long. Please shorten the synopsis or facts.' });
      return false;
    }
    if (!markers.every((m) => prompt.includes(m))) {
      res.status(403).json({ error: 'This endpoint only serves the Quilldeck web app.' });
      return false;
    }
  }
  return true;
}
