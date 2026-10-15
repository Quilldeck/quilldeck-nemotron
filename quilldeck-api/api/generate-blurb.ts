import { generateJson } from '../lib/nebius';

interface BlurbPayload {
  blurbs: { variant: number; hook: string; text: string }[];
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  let result = await generateJson<BlurbPayload>(prompt, 3000);

  for (let attempt = 0; attempt < 2; attempt++) {
    if (result.ok && Array.isArray(result.data.blurbs) && result.data.blurbs.length === 3) {
      break;
    }
    console.error(`generate-blurb retry ${attempt + 1}:`, result.ok ? 'incomplete blurbs array' : result.error);
    result = await generateJson<BlurbPayload>(prompt, 3000);
  }

  if (!result.ok) {
    console.error('generate-blurb failed:', result.error, '|', result.detail);
    return res.status(result.status).json({ error: result.error, detail: result.detail });
  }

  if (!Array.isArray(result.data.blurbs) || result.data.blurbs.length !== 3) {
    console.error('generate-blurb: expected 3 blurbs, got', result.data.blurbs?.length ?? 0);
    return res.status(502).json({ error: 'Model returned an incomplete set of blurbs. Please try again.' });
  }

  return res.status(200).json(result.data);
}
