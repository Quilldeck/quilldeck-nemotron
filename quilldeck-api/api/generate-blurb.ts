import { generateJson } from '../lib/nebius';
import { guard } from '../lib/guard';

interface BlurbPayload {
  blurbs: { variant: number; hook: string; text: string }[];
}

// Vercel stops the function at maxDuration (120s in vercel.json). Only start a
// retry if there is realistically time for it to finish.
const RETRY_CUTOFF_MS = 60_000;
const MIN_WORDS = 60;
// The fact-check runs only if there is time left within maxDuration.
const FACT_CHECK_CUTOFF_MS = 70_000;

type Blurb = { variant: number; hook: string; text: string };
interface FactCheckReport {
  checked: boolean;
  fixes: { hook: string; quote: string; problem: string; fix: string }[];
}
interface FactCheckPayload {
  checks: { hook: string; issues?: { quote?: string; problem?: string; fix?: string }[]; revised?: string }[];
}

const clip = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// Generate, critique, revise: a second Nemotron pass acts as a continuity
// editor. It may only flag contradictions, invented specifics and misspelt
// names, and must make the smallest change that fixes each one. A revision is
// accepted only if it still passes the same quality checks as the original.
async function factCheckBlurbs(
  blurbs: Blurb[],
  source: { title?: unknown; synopsis: string; facts?: unknown },
  rejectReason: (b: any) => string | null,
): Promise<{ blurbs: Blurb[]; report: FactCheckReport }> {
  const prompt = `You are a meticulous continuity editor for a publisher. Check book blurbs against the author's source text, which is the ONLY truth about the story.

SOURCE
Title: ${clip(source.title, 160)}
Synopsis: ${clip(source.synopsis, 4000)}${source.facts ? `\nAuthor's facts (always correct): ${clip(source.facts, 1500)}` : ''}

BLURBS
${JSON.stringify(blurbs.map((b) => ({ hook: b.hook, text: b.text })))}

Check every sentence of every blurb. Flag ONLY these problems:
1. It contradicts the source: who someone is, their heritage, gender or relationships, who did what, where or when.
2. It states a specific plot event, name, place, title or quotation that the source does not contain.
3. A name is spelt differently from the source.
Do NOT flag tone, atmosphere, emotion, style, rhetorical questions or general phrasing the source supports. When in doubt, do not flag.

For each blurb with problems, rewrite it with the smallest change that fixes each problem. Keep its hook, length, third person and British English, and do not use em dashes. If a blurb has no problems, give an empty "issues" list and an empty "revised".

Respond in valid JSON only:
{"checks":[{"hook":"emotional","issues":[{"quote":"exact words from the blurb","problem":"why it is wrong, citing the source","fix":"the replacement words"}],"revised":""}]}`;

  const result = await generateJson<FactCheckPayload>(prompt, 4000);
  if (!result.ok || !Array.isArray(result.data?.checks)) {
    console.error('generate-blurb: fact-check unavailable:', result.ok ? 'no checks array' : result.error);
    return { blurbs, report: { checked: false, fixes: [] } };
  }
  const fixes: FactCheckReport['fixes'] = [];
  const out = blurbs.map((b) => {
    const check = result.data.checks.find((c) => String(c?.hook).toLowerCase() === b.hook);
    const issues = Array.isArray(check?.issues) ? check!.issues.filter((i) => i && i.quote && i.problem) : [];
    const revised = typeof check?.revised === 'string' ? check.revised.trim() : '';
    if (issues.length === 0 || !revised) return b;
    const before = b.text.split(/\s+/).length;
    const after = revised.split(/\s+/).length;
    const why = rejectReason({ text: revised });
    if (why || after < before * 0.7 || after > before * 1.3) {
      console.error(`generate-blurb: fact-check revision of ${b.hook} rejected:`, why || `length ${before} -> ${after}`);
      return b;
    }
    for (const i of issues) fixes.push({ hook: b.hook, quote: clip(i.quote, 200), problem: clip(i.problem, 300), fix: clip(i.fix, 200) });
    return { ...b, text: revised };
  });
  console.error(`generate-blurb: fact-check made ${fixes.length} fix(es)`);
  return { blurbs: out, report: { checked: true, fixes } };
}

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
  const { prompt, synopsis, facts, title } = req.body ?? {};
  if (!guard(req, res, ['STORY ACCURACY (most important)', 'Generate exactly 3 different book blurbs'], prompt)) return;

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

  if (kept.size > 0) {
    let blurbs = HOOKS.filter((h) => kept.has(h)).map((h) => kept.get(h)!);
    let factCheck: FactCheckReport = { checked: false, fixes: [] };
    // Agent step: Nemotron reviews its own blurbs against the author's source
    // text and repairs any sentence that contradicts it or invents a fact.
    if (typeof synopsis === 'string' && synopsis.trim() && Date.now() - started < FACT_CHECK_CUTOFF_MS) {
      const checked = await factCheckBlurbs(blurbs, { title, synopsis, facts }, rejectReason);
      blurbs = checked.blurbs;
      factCheck = checked.report;
    }
    if (blurbs.length < 3) console.error('generate-blurb: returning', blurbs.length, 'of 3 blurbs');
    return res.status(200).json({ blurbs, factCheck, ...(blurbs.length < 3 ? { partial: true } : {}) });
  }
  if (kept.size === 0 && lastError) {
    console.error('generate-blurb failed:', lastError.error, '|', lastError.detail);
    return res.status(lastError.status).json({ error: lastError.error, detail: lastError.detail });
  }
  return res.status(502).json({ error: 'The blurbs came back unusable. Please try again.', detail: 'Got 0 of 3 usable blurbs' });
}
