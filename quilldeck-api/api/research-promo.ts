import { generateJson } from '../lib/nebius';

// Live promo-site research: Tavily searches the web for book promotion
// services that suit this genre, then Nemotron picks the best five using ONLY
// what those pages say. Every recommendation must cite one of the URLs Tavily
// returned; anything else is dropped, so prices and rules cannot be invented.

const TAVILY_URL = 'https://api.tavily.com/search';
const MAX_SITES = 5;

interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

interface PromoSite {
  name: string;
  url: string;
  cost: string;
  genre: string;
  notes: string;
  source: string;
}

function clip(text: unknown, max: number): string {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

async function tavilySearch(query: string): Promise<TavilyResult[]> {
  const response = await fetch(TAVILY_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, search_depth: 'basic', max_results: 6, topic: 'general' }),
  });
  if (!response.ok) {
    throw new Error(`Tavily returned HTTP ${response.status}: ${clip(await response.text(), 200)}`);
  }
  const data: any = await response.json();
  return Array.isArray(data?.results)
    ? data.results
        .filter((r: any) => typeof r?.url === 'string' && /^https?:\/\//.test(r.url))
        .map((r: any) => ({ title: clip(r.title, 150), url: r.url, content: clip(r.content, 700) }))
    : [];
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.TAVILY_API_KEY) {
    return res.status(500).json({ error: 'Server is not configured: TAVILY_API_KEY is missing' });
  }

  // The server builds the searches from plain book fields; it never accepts a
  // free-form prompt, so this endpoint cannot be used as a general AI proxy.
  const genre = clip(req.body?.genre, 80);
  const title = clip(req.body?.title, 160);
  const format = clip(req.body?.format || 'ebook', 40);
  if (!genre) return res.status(400).json({ error: 'Genre is required' });

  const year = new Date().getFullYear();
  const queries = [
    `best book promotion sites for ${genre} ${format} authors ${year} prices`,
    `${genre} book newsletter promotion submission requirements indie authors`,
    `ebook promotion services UK authors ${year} cost`,
  ];

  let results: TavilyResult[];
  try {
    const batches = await Promise.all(queries.map(tavilySearch));
    const seen = new Set<string>();
    results = batches.flat().filter((r) => (seen.has(r.url) ? false : (seen.add(r.url), true)));
  } catch (error: any) {
    console.error('research-promo: Tavily failed:', error?.message);
    return res.status(502).json({ error: 'Live research is unavailable right now. Please try again.', detail: clip(error?.message, 200) });
  }

  if (results.length === 0) {
    return res.status(502).json({ error: 'Live research found no promotion sites. Please try again.' });
  }

  const sources = results.slice(0, 15);
  const sourceText = sources
    .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content}`)
    .join('\n\n');

  const prompt = `You are a book marketing researcher. An independent author needs promotion sites for a ${genre} ${format}${title ? ` called "${title}"` : ''}.

Below are live web search results. Using ONLY these results, recommend up to ${MAX_SITES} specific book promotion services (newsletters, deal sites, review or discovery platforms) that suit this book.

Rules:
- Every fact (name, cost, requirements) must come from the search results. Do not use outside knowledge.
- "cost": the price exactly as a source states it; if no source states a price, write "Check the site".
- "url": the promotion service's own website if it appears in the results, otherwise the source URL.
- "source": the URL of the search result your facts came from, copied exactly from the list.
- "notes": one or two sentences on fit and submission requirements, as stated in the source.
- Skip list articles, forums and the search results that are not themselves a promotion service, except as a source.
- Write in British English. Do not use em dashes.

Search results:
${sourceText}

Respond in valid JSON only:
{"promoSites":[{"name":"...","url":"...","cost":"...","genre":"...","notes":"...","source":"..."}]}`;

  const result = await generateJson<{ promoSites: PromoSite[] }>(prompt, 2500);
  if (!result.ok) {
    console.error('research-promo: model failed:', result.error, '|', result.detail);
    return res.status(result.status).json({ error: result.error, detail: result.detail });
  }

  // Keep only recommendations that cite a real search result.
  const sourceUrls = new Set(sources.map((s) => s.url));
  const sourceHosts = new Set(sources.map((s) => hostOf(s.url)));
  const promoSites = (Array.isArray(result.data?.promoSites) ? result.data.promoSites : [])
    .filter((s) => s && typeof s.name === 'string' && sourceUrls.has(s.source))
    .map((s) => ({
      name: clip(s.name, 80),
      url: /^https?:\/\//.test(s.url) && sourceHosts.has(hostOf(s.url)) ? s.url : s.source,
      cost: clip(s.cost || 'Check the site', 80),
      genre: clip(s.genre || genre, 60),
      notes: clip(s.notes, 400),
      source: s.source,
    }))
    .slice(0, MAX_SITES);

  if (promoSites.length === 0) {
    return res.status(502).json({ error: 'The research came back without sourced recommendations. Please try again.' });
  }

  return res.status(200).json({ promoSites, researchedAt: new Date().toISOString(), searches: queries.length });
}
