// Shared PayPal client for the Quilldeck endpoints.
//
// Sandbox only. The base URL is fixed to PayPal's sandbox, so these endpoints
// cannot move real money even if live credentials were pasted in by mistake
// (live credentials are rejected by the sandbox).
//
// Credentials come from Vercel environment variables PAYPAL_CLIENT_ID and
// PAYPAL_CLIENT_SECRET (set for the Preview environment). Only the Client ID,
// which PayPal treats as public, is ever sent to the browser.

export const PAYPAL_BASE = 'https://api-m.sandbox.paypal.com';

// The price list lives on the server. The Launch Advisor (AI) may recommend a
// tier and write the order wording, but it can never set or change a price:
// create-order and capture both look the price up here by tier ID.
export const CATALOGUE = {
  launch_pass: {
    sku: 'QD-LAUNCH-PASS',
    name: 'Quilldeck Launch Pass',
    price: '59.00',
    currency: 'USD',
    includes: 'one book, a 14-day posting calendar and the complete Go Market This marketing package',
  },
} as const;

export type TierId = keyof typeof CATALOGUE;

export function isTierId(value: unknown): value is TierId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CATALOGUE, value);
}

export class PayPalError extends Error {
  constructor(public status: number, message: string, public detail: string, public issue = '') {
    super(message);
  }
}

let cachedToken: { value: string; expiresAt: number } | null = null;

/** OAuth client-credentials token, cached in memory until shortly before it expires. */
export async function getAccessToken(): Promise<string> {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) {
    throw new PayPalError(500, 'Server is not configured: PayPal credentials are missing', '');
  }
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  const response = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const text = await response.text();
  if (!response.ok) {
    // 401 here almost always means the Client ID or Secret was pasted wrongly.
    throw new PayPalError(502, `PayPal login failed (HTTP ${response.status})`, text.slice(0, 300));
  }
  const data = JSON.parse(text);
  const ttlMs = Math.max(60, Number(data.expires_in ?? 0) - 120) * 1000;
  cachedToken = { value: data.access_token, expiresAt: Date.now() + ttlMs };
  return cachedToken.value;
}

async function paypalRequest(method: 'GET' | 'POST', path: string, body?: unknown): Promise<any> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
  // Lets PayPal recognise a retried POST instead of acting on it twice.
  if (method === 'POST') headers['PayPal-Request-Id'] = crypto.randomUUID();

  const response = await fetch(`${PAYPAL_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // leave data as null
  }
  if (!response.ok) {
    const issue = String(data?.details?.[0]?.issue ?? data?.name ?? '');
    throw new PayPalError(502, `PayPal rejected the request (${issue || `HTTP ${response.status}`})`, text.slice(0, 300), issue);
  }
  return data;
}

/** POST to a PayPal REST endpoint. Throws PayPalError on failure. */
export const paypalPost = (path: string, body?: unknown) => paypalRequest('POST', path, body);

/** GET a PayPal REST endpoint. Throws PayPalError on failure. */
export const paypalGet = (path: string) => paypalRequest('GET', path);

/** Collapse whitespace, strip angle brackets and trim to a maximum length. */
export function cleanText(value: unknown, max: number): string {
  return String(value ?? '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** The form of a book title used to tie a Launch Pass to one book. */
export function normTitle(value: unknown): string {
  return cleanText(value, 120).toLowerCase();
}

// The order's custom_id carries the tier and the book title, so capture can
// confirm what was bought without a database: "quilldeck:launch_pass:<title>".
const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const unb64url = (s: string) => Buffer.from(s, 'base64url').toString('utf8');

export function makeCustomId(tier: TierId, title: string): string {
  return `quilldeck:${tier}:${b64url(title)}`;
}

export function readCustomId(customId: unknown): { tier: TierId; title: string } | null {
  const m = /^quilldeck:([a-z_]+):([A-Za-z0-9_-]+)$/.exec(String(customId ?? ''));
  if (!m || !isTierId(m[1])) return null;
  const title = cleanText(unb64url(m[2]), 120);
  return title ? { tier: m[1], title } : null;
}

/** True when payments should be required: PayPal is configured and this is not the production site. */
export function paywallEnabled(): boolean {
  const configured = Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
  // The live Nebius demo (production) stays free until judging ends on 15 Dec,
  // even if the PayPal keys are ever added there. QUILLDECK_PAYWALL=on overrides.
  const notProduction = process.env.VERCEL_ENV !== 'production' || process.env.QUILLDECK_PAYWALL === 'on';
  return configured && notProduction && process.env.QUILLDECK_PAYWALL !== 'off';
}
