import { generateJson } from '../lib/nebius';
import { guard } from '../lib/guard';

// The full launch package has five sections. A caller can ask for a subset
// (the web demo sends two half-packages in parallel, which is faster and makes
// dropped sections far less likely) by listing the keys it needs in `expect`.
// The Android app sends no `expect`, so it keeps the original behaviour.
const SECTIONS = ['socialPosts', 'emails', 'adCopy', 'calendar', 'promoSites'] as const;
type Section = (typeof SECTIONS)[number];
type MarketingPayload = Partial<Record<Section, unknown[]>>;

// Vercel stops the function at maxDuration (120s in vercel.json). Only start a
// retry if there is realistically time for it to finish.
const RETRY_CUTOFF_MS = 55_000;

// Nemotron sometimes renames fields (e.g. "title" or "bodyCopy" instead of
// "headline" and "body"). Map the common variants onto the names the apps use,
// then treat a section as missing if its items have no real text in them.
const ALIASES: Record<string, Record<string, string[]>> = {
  socialPosts: { content: ['content', 'text', 'post', 'caption', 'body', 'script'] },
  emails: { subjectLine: ['subjectLine', 'subject', 'subject_line', 'title'], body: ['body', 'content', 'text', 'email'] },
  adCopy: { headline: ['headline', 'title', 'Headline', 'adHeadline', 'heading'], body: ['body', 'bodyCopy', 'body_copy', 'copy', 'text', 'description', 'adCopy', 'content'] },
  calendar: { content: ['content', 'contentSnippet', 'snippet', 'post', 'text', 'description'] },
};
const REQUIRED: Record<string, string[]> = {
  socialPosts: ['content'], emails: ['body'], adCopy: ['headline', 'body'], calendar: ['content'],
};
const hasText = (v: unknown) => typeof v === 'string' && v.trim().length > 2;

function normalise(data: MarketingPayload): void {
  for (const [section, fields] of Object.entries(ALIASES)) {
    const items = (data as any)[section];
    if (!Array.isArray(items)) continue;
    for (const it of items) {
      if (!it || typeof it !== 'object') continue;
      for (const [field, names] of Object.entries(fields)) {
        if (hasText(it[field])) continue;
        const found = names.map((n) => it[n]).find(hasText);
        if (found) it[field] = found;
      }
    }
  }
}

function missingSections(data: MarketingPayload, expected: readonly Section[]): Section[] {
  normalise(data);
  return expected.filter((key) => {
    const items = data[key];
    if (!Array.isArray(items) || items.length === 0) return true;
    const req = REQUIRED[key];
    if (!req) return false;
    const good = (items as any[]).filter((it) => it && req.every((f) => hasText(it[f])));
    return good.length === 0;
  });
}

export default async function handler(req: any, res: any) {
  const { prompt, website, expect } = req.body ?? {};
  if (!guard(req, res, ['STORY ACCURACY (most important)', 'You are an expert book marketing strategist for independent authors'], prompt)) return;

  const requested: Section[] = Array.isArray(expect)
    ? SECTIONS.filter((key) => expect.includes(key))
    : [];
  // Without `expect`, keep the app's original rule: social posts must be present.
  const expected: readonly Section[] = requested.length > 0 ? requested : ['socialPosts'];
  // A half-package needs less room than the full five-section package.
  const maxTokens = requested.length > 0 ? 5000 : 8000;

  const fullPrompt = website ? `${prompt}\n\nAuthor website: ${website}` : prompt;
  const started = Date.now();

  let result = await generateJson<MarketingPayload>(fullPrompt, maxTokens);

  for (let attempt = 0; attempt < 2; attempt++) {
    const missing = result.ok ? missingSections(result.data, expected) : [];
    if (result.ok && missing.length === 0) break;
    if (Date.now() - started > RETRY_CUTOFF_MS) {
      console.error('generate-marketing: no time left to retry');
      break;
    }
    console.error(
      `generate-marketing retry ${attempt + 1}:`,
      result.ok ? `missing ${missing.join(', ')}` : result.error
    );
    result = await generateJson<MarketingPayload>(fullPrompt, maxTokens);
  }

  if (!result.ok) {
    console.error('generate-marketing failed:', result.error, '|', result.detail);
    return res.status(result.status).json({ error: result.error, detail: result.detail });
  }

  const missing = missingSections(result.data, expected);
  if (missing.length > 0) {
    console.error('generate-marketing: still missing', missing.join(', '));
    return res.status(502).json({
      error: 'The plan came back incomplete. Please try again.',
      detail: `Missing: ${missing.join(', ')}`,
    });
  }

  return res.status(200).json(result.data);
}
