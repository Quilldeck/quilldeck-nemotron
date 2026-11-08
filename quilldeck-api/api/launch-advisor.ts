import { generateJson } from '../lib/nebius';
import { guard } from '../lib/guard';
import { CATALOGUE, cleanText } from '../lib/paypal';

// Launch Advisor: the AI step in front of PayPal checkout.
//
// Nemotron reads the author's book details and decides, honestly, whether this
// book needs the Launch Pass now or whether the free blurbs are enough for the
// moment. It explains why in terms of this book, and drafts the PayPal order
// line (item name and description) for this book. The web page shows the
// advice and the drafted order, and the author approves it in PayPal.
//
// The AI never sets the price. The order it drafts is passed to
// paypal-create-order, which takes price and currency from CATALOGUE.
//
// Request:  { title, genre, synopsis, blurb?, launch?, series? }
// Response: { recommendation: "launch_pass" | "free", headline, reasons[],
//             order: { tier, itemName, itemDescription, price, currency }, aiUsed }

interface AdvicePayload {
  recommendation?: string;
  headline?: string;
  reasons?: string[];
  itemDescription?: string;
}

// House style for anything shown to authors: no em or en dashes.
const tidy = (v: unknown, max: number) =>
  cleanText(String(v ?? '').replace(/\s*[—–]\s*/g, ', '), max);

export default async function handler(req: any, res: any) {
  if (!guard(req, res)) return;

  const body = req.body ?? {};
  const title = cleanText(body.title, 120);
  const genre = cleanText(body.genre, 80) || 'fiction';
  const synopsis = cleanText(body.synopsis, 2500);
  const blurb = cleanText(body.blurb, 1500);
  const launch = cleanText(body.launch, 40);
  const series = cleanText(body.series, 120);
  if (!title || synopsis.length < 40) {
    return res.status(400).json({ error: 'Add the title and a short synopsis first.' });
  }

  const pass = CATALOGUE.launch_pass;
  const prompt = `You are Quilldeck's Launch Advisor, an honest adviser to independent authors. Decide whether this author should buy the Launch Pass for this book now.

What the author already has for free: three back-cover blurbs written and fact-checked against their synopsis.
What the Launch Pass adds (one-off, ${pass.price} ${pass.currency}, covers this one book): social posts for five platforms, three launch emails, three Amazon ad variants with keywords, a 14-day posting calendar, and live research of book promotion sites for this genre.

Book:
- Title: "${title}"
- Genre: ${genre}${series ? `\n- Series: ${series}` : ''}
- Launch date: ${launch || 'not set yet'}
- Has the author chosen a blurb: ${blurb ? 'yes' : 'no'}
- Synopsis: ${synopsis}

Recommend "launch_pass" when the author is preparing a launch: a launch date is set, or the book is ready and needs readers. Recommend "free" when the book still looks early (for example no launch date and the author has not yet settled on a blurb), and say what to do first. Be honest: do not push a sale the author does not need yet.

Rules: Speak directly to the author as "you" and "your book", in plain, warm, complete sentences (never note form or semicolon lists). Base every reason on the details above, naming the book, its genre or its launch date. Call the genre exactly "${genre}", never a paraphrase of it. Do not call the book a debut unless the details say so. Do not invent facts about the book, its sales, its audience size or results. Do not promise outcomes. Write in British English. Do not use em dashes or en dashes.

Also write itemDescription: one line of at most 110 characters for the PayPal receipt, describing what this Launch Pass covers for this book and naming the genre exactly as "${genre}" (for example "14-day launch calendar, emails, ads and promo-site research for a ${genre} novel").

Respond in valid JSON only:
{"recommendation":"launch_pass","headline":"one sentence, at most 20 words","reasons":["reason one, at most 30 words","reason two, at most 30 words"],"itemDescription":"..."}`;

  const itemName = cleanText(`Launch Pass: ${title}`, 120);
  const fallback = {
    recommendation: launch ? 'launch_pass' : 'free',
    headline: launch
      ? `"${title}" has a launch date, so a full launch plan will help now.`
      : `Settle on a blurb and a launch date for "${title}" first; the Launch Pass will be here when you are ready.`,
    reasons: [
      `The Launch Pass builds posts, emails, Amazon ads and a 14-day calendar specific to "${title}".`,
      `It covers this one book for a single payment of ${pass.price} ${pass.currency}.`,
    ],
    itemDescription: `14-day launch calendar, emails, ads and promo research for ${title}`,
  };

  const result = await generateJson<AdvicePayload>(prompt, 700);
  const ai = result.ok ? result.data : null;
  if (!result.ok) console.error('launch-advisor: falling back:', result.error);

  const recommendation = ai?.recommendation === 'free' || ai?.recommendation === 'launch_pass'
    ? ai.recommendation
    : fallback.recommendation;
  const reasons = Array.isArray(ai?.reasons)
    ? ai!.reasons.map((r) => tidy(r, 240)).filter(Boolean).slice(0, 3)
    : [];
  const headline = tidy(ai?.headline, 200);
  const itemDescription = tidy(ai?.itemDescription, 120);
  const aiUsed = Boolean(ai && headline && reasons.length);

  return res.status(200).json({
    recommendation,
    headline: aiUsed ? headline : fallback.headline,
    reasons: aiUsed ? reasons : fallback.reasons,
    order: {
      tier: 'launch_pass',
      itemName,
      itemDescription: itemDescription || fallback.itemDescription,
      price: pass.price,
      currency: pass.currency,
    },
    aiUsed,
  });
}
