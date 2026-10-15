import { generateJson } from '../lib/nebius';

interface MarketingPayload {
  socialPosts: unknown[];
  emails: unknown[];
  adCopy: unknown[];
  calendar: unknown[];
  promoSites: unknown[];
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt, website } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

  const fullPrompt = website
    ? `${prompt}\n\nAuthor website: ${website}`
    : prompt;

  let result = await generateJson<MarketingPayload>(fullPrompt, 8000);

  for (let attempt = 0; attempt < 2; attempt++) {
    if (result.ok && Array.isArray(result.data.socialPosts) && result.data.socialPosts.length > 0) {
      break;
    }
    console.error(`generate-marketing retry ${attempt + 1}:`, result.ok ? 'empty socialPosts array' : result.error);
    result = await generateJson<MarketingPayload>(fullPrompt, 8000);
  }

  if (!result.ok) {
    console.error('generate-marketing failed:', result.error, '|', result.detail);
    return res.status(result.status).json({ error: result.error, detail: result.detail });
  }

  if (!Array.isArray(result.data.socialPosts) || result.data.socialPosts.length === 0) {
    console.error('generate-marketing: parsed JSON has no socialPosts array');
    return res.status(502).json({ error: 'Model returned JSON without a socialPosts array' });
  }

  return res.status(200).json(result.data);
}
