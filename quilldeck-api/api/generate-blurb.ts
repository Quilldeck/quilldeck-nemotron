import { generateJson } from '../lib/nebius';

interface BlurbPayload {
  blurbs: { variant: number; hook: string; text: string }[];
}

// Vercel stops the function at maxDuration (120s in vercel.json). Only start a
// retry if there is realistically time for it to finish.
const RETRY_CUTOFF_MS = 60_000;
const MIN_WORDS = 60;

// Nemotron occasionally echoes the response template instead of writing
// ("<first blurb>", "Full blurb text here..."). A valid-looking JSON object full
// of placeholders must count as a failure, not a success.
function problemWith(data: BlurbPayload | undefined): string | null {
  const blurbs = data?.blurbs;
  if (!Array.isArray(blurbs) || blurbs.length !== 3) {
    return `expected 3 blurbs, got ${Array.isArray(blurbs) ? blurbs.length : 0}`;
  }
  for (const [i, b] of blurbs.entries()) {
    const text = typeof b?.text === 'string' ? b.text.trim() : '';
    if (/^<[^>]*>$/.test(text) || /full blurb text here/i.test(text)) {
      return `blurb ${i + 1} is a template placeholder`;
    }
    const words = text.split(/\s+/).filter(Boolean).length;
    if (words < MIN_WORDS) return `blurb ${i + 1} has only ${words} words`;
  }
  return null;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt } = req.body ?? {};
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const started = Date.now();
  let result = await generateJson<BlurbPayload>(prompt, 3000);

  for (let attempt = 0; attempt < 2; attempt++) {
    const problem = result.ok ? problemWith(result.data) : result.error;
    if (!problem) break;
    if (Date.now() - started > RETRY_CUTOFF_MS) {
      console.error('generate-blurb: no time left to retry');
      break;
    }
    console.error(`generate-blurb retry ${attempt + 1}:`, problem);
    result = await generateJson<BlurbPayload>(prompt, 3000);
  }

  if (!result.ok) {
    console.error('generate-blurb failed:', result.error, '|', result.detail);
    return res.status(result.status).json({ error: result.error, detail: result.detail });
  }

  const problem = problemWith(result.data);
  if (problem) {
    console.error('generate-blurb: unusable result:', problem);
    return res.status(502).json({ error: 'The blurbs came back unusable. Please try again.', detail: problem });
  }

  return res.status(200).json(result.data);
}
