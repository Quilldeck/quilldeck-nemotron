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

function missingSections(data: MarketingPayload, expected: readonly Section[]): Section[] {
  return expected.filter((key) => !Array.isArray(data[key]) || (data[key] as unknown[]).length === 0);
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
