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
  const HOOKS = ['emotional', 'action', 'mystery'];
  // Nemotron sometimes returns one or two good blurbs instead of three. Keep
  // every usable blurb from each attempt and only ask again for what is missing.
  const kept = new Map<string, { variant: number; hook: string; text: string }>();
  const usable = (b: any) => {
    const text = typeof b?.text === 'string' ? b.text.trim() : '';
    if (/^<[^>]*>$/.test(text) || /full blurb text here/i.test(text)) return false;
    return text.split(/\s+/).filter(Boolean).length >= MIN_WORDS;
  };
  let lastError: { status: number; error: string; detail: string } | null = null;

  for (let attempt = 0; attempt < 3 && kept.size < 3; attempt++) {
    if (attempt > 0 && Date.now() - started > RETRY_CUTOFF_MS) {
      console.error('generate-blurb: no time left to retry');
      break;
    }
    const result = await generateJson<BlurbPayload>(prompt, 3000);
    if (!result.ok) {
      lastError = result;
      console.error(`generate-blurb attempt ${attempt + 1} failed:`, result.error);
      continue;
    }
    const problem = problemWith(result.data);
    if (problem) console.error(`generate-blurb attempt ${attempt + 1}:`, problem);
    for (const [i, b] of (Array.isArray(result.data?.blurbs) ? result.data.blurbs : []).entries()) {
      const hook = HOOKS.includes(String(b?.hook).toLowerCase()) ? String(b.hook).toLowerCase() : HOOKS[i];
      if (hook && !kept.has(hook) && usable(b)) kept.set(hook, { variant: HOOKS.indexOf(hook) + 1, hook, text: b.text.trim() });
    }
  }

  if (kept.size === 3) {
    return res.status(200).json({ blurbs: HOOKS.map((h) => kept.get(h)) });
  }
  if (kept.size === 0 && lastError) {
    console.error('generate-blurb failed:', lastError.error, '|', lastError.detail);
    return res.status(lastError.status).json({ error: lastError.error, detail: lastError.detail });
  }
  console.error('generate-blurb: only', kept.size, 'usable blurbs');
  return res.status(502).json({ error: 'The blurbs came back unusable. Please try again.', detail: `Got ${kept.size} of 3 usable blurbs` });
}
