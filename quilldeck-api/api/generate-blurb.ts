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
  // Returns null if the blurb is usable, otherwise the reason it was rejected.
  const rejectReason = (b: any): string | null => {
    const text = typeof b?.text === 'string' ? b.text.trim() : '';
    if (/^<[^>]*>$/.test(text) || /full blurb text here/i.test(text)) return 'template placeholder';
    const words = text.split(/\s+/).filter(Boolean).length;
    if (words < MIN_WORDS) return `only ${words} words`;
    // Degraded output: Nemotron occasionally drops nearly all punctuation.
    // Dramatic back-cover copy can run long sentences, so only reject text with
    // almost no sentence breaks (fewer than one per 50 words, minimum 2).
    const sentenceBreaks = (text.match(/[.!?…](?=["'”’)]?(\s|$))/g) ?? []).length;
    if (sentenceBreaks < Math.max(2, Math.floor(words / 50))) return `only ${sentenceBreaks} sentence breaks in ${words} words`;
    // Back-cover copy is third person; a blurb narrated as "I/we" is a miss.
    const outsideQuotes = text.replace(/["“][^"”]*["”]/g, ' ');
    const firstPerson = (outsideQuotes.match(/\b(?:I|me|my|we|us|our)\b/g) ?? []).length;
    if (firstPerson >= 3) return `first person (${firstPerson} times)`;
    return null;
  };
  let lastError: { status: number; error: string; detail: string } | null = null;

  for (let attempt = 0; attempt < 4 && kept.size < 3; attempt++) {
    if (attempt > 0 && Date.now() - started > RETRY_CUTOFF_MS) {
      console.error('generate-blurb: no time left to retry');
      break;
    }
    const missing = HOOKS.filter((h) => !kept.has(h));
    const ask = attempt === 0 ? prompt
      : `${prompt}\n\nThis time write ONLY the ${missing.join(' and ')} blurb${missing.length > 1 ? 's' : ''}, with "hook" set to ${missing.map((h) => `"${h}"`).join(' and ')}. Use full sentences with normal punctuation, in the third person.`;
    const result = await generateJson<BlurbPayload>(ask, 3000);
    if (!result.ok) {
      lastError = result;
      console.error(`generate-blurb attempt ${attempt + 1} failed:`, result.error);
      continue;
    }
    const problem = problemWith(result.data);
    if (problem) console.error(`generate-blurb attempt ${attempt + 1}:`, problem);
    for (const [i, b] of (Array.isArray(result.data?.blurbs) ? result.data.blurbs : []).entries()) {
      const hook = HOOKS.includes(String(b?.hook).toLowerCase()) ? String(b.hook).toLowerCase() : HOOKS[i];
      if (!hook || kept.has(hook)) continue;
      const why = rejectReason(b);
      if (why) console.error(`generate-blurb attempt ${attempt + 1}: rejected ${hook} blurb: ${why}`);
      else kept.set(hook, { variant: HOOKS.indexOf(hook) + 1, hook, text: b.text.trim() });
    }
  }

  if (kept.size === 3) {
    return res.status(200).json({ blurbs: HOOKS.map((h) => kept.get(h)) });
  }
  if (kept.size === 0 && lastError) {
    console.error('generate-blurb failed:', lastError.error, '|', lastError.detail);
    return res.status(lastError.status).json({ error: lastError.error, detail: lastError.detail });
  }
  if (kept.size > 0) {
    console.error('generate-blurb: returning', kept.size, 'of 3 blurbs');
    return res.status(200).json({ blurbs: HOOKS.filter((h) => kept.has(h)).map((h) => kept.get(h)), partial: true });
  }
  return res.status(502).json({ error: 'The blurbs came back unusable. Please try again.', detail: 'Got 0 of 3 usable blurbs' });
}
