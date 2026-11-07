import { createHmac, timingSafeEqual } from 'node:crypto';
import { normTitle, paywallEnabled } from './paypal';

// Server-side Launch Pass check.
//
// After a PayPal payment is captured and verified, the server issues a signed
// pass: { book title, order ID, capture ID, expiry } plus an HMAC signature.
// The browser stores it and sends it back in the X-Quilldeck-Pass header. The
// marketing endpoints verify the signature and the book title before doing any
// work, so the unlock cannot be faked in the browser (the weak spot of an
// on-device-only unlock). No database is needed: only the server can sign.

const PASS_DAYS = 60; // comfortably past the end of judging (15 Dec 2026)

function signingKey(): Buffer {
  const secret = process.env.QUILLDECK_PASS_SECRET || process.env.PAYPAL_CLIENT_SECRET || '';
  if (!secret) throw new Error('No signing secret configured');
  // Derive a separate key so the PayPal secret itself never signs anything.
  return createHmac('sha256', secret).update('quilldeck-launch-pass-v1').digest();
}

const sign = (payload: string) => createHmac('sha256', signingKey()).update(payload).digest('base64url');

export interface PassClaims {
  tier: string;
  title: string; // normalised book title
  orderId: string;
  captureId: string;
  exp: number; // ms since epoch
}

export function issuePass(claims: Omit<PassClaims, 'exp'>): string {
  const full: PassClaims = { ...claims, title: normTitle(claims.title), exp: Date.now() + PASS_DAYS * 86_400_000 };
  const payload = Buffer.from(JSON.stringify(full), 'utf8').toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifyPass(token: unknown): PassClaims | null {
  const [payload, sig] = String(token ?? '').split('.');
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as PassClaims;
    return typeof claims?.exp === 'number' && claims.exp > Date.now() ? claims : null;
  } catch {
    return null;
  }
}

/**
 * For the paid endpoints. Returns true if the request may proceed. Otherwise
 * it has already sent a 402 response and the handler should return.
 * When the paywall is off (production, or PayPal not configured) it always passes.
 */
export function requireLaunchPass(req: any, res: any, bookTitle: unknown): boolean {
  if (!paywallEnabled()) return true;
  const claims = verifyPass(req.headers?.['x-quilldeck-pass']);
  if (!claims) {
    res.status(402).json({ error: 'The launch plan needs a Launch Pass for this book.', code: 'PASS_REQUIRED' });
    return false;
  }
  if (claims.title !== normTitle(bookTitle)) {
    res.status(402).json({
      error: 'Your Launch Pass is for a different book title. Each pass covers one book.',
      code: 'PASS_OTHER_BOOK',
    });
    return false;
  }
  return true;
}
