import { generateJson } from '../lib/nebius';

// Deliberately small schema -- roughly the size of the blurb payload. The large
// Go Market This schema has been unreliable on gpt-oss-120b; small ones hold up.
interface MetadataPayload {
  categories: string[];
  keywords: string[];
  listing: { title: string; subtitle: string; bullets: string[] };
}

function isComplete(data: MetadataPayload | undefined): boolean {
  if (!data) return false;
  const { categories, keywords, listing } = data;
  return (
    Array.isArray(categories) && categories.length === 7 &&
    Array.isArray(keywords) && keywords.length === 7 &&
    !!listing && typeof listing.title === 'string' && listing.title.trim() !== '' &&
    typeof listing.subtitle === 'string' &&
    Array.isArray(listing.bullets) && listing.bullets.length >= 3 && listing.bullets.length <= 5
  );
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  let result = await generateJson<MetadataPayload>(prompt, 3000);

  for (let attempt = 0; attempt < 2; attempt++) {
    if (result.ok && isComplete(result.data)) {
      break;
    }
    console.error(`generate-metadata retry ${attempt + 1}:`, result.ok ? 'incomplete metadata' : result.error);
    result = await generateJson<MetadataPayload>(prompt, 3000);
  }

  if (!result.ok) {
    console.error('generate-metadata failed:', result.error, '|', result.detail);
    return res.status(result.status).json({ error: result.error, detail: result.detail });
  }

  if (!isComplete(result.data)) {
    console.error('generate-metadata: incomplete payload', JSON.stringify(result.data).slice(0, 300));
    return res.status(502).json({ error: 'Model returned incomplete metadata. Please try again.' });
  }

  return res.status(200).json(result.data);
}
