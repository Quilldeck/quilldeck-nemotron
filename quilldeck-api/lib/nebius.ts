// Shared inference client for the Quilldeck endpoints.
//
// Quilldeck runs on NVIDIA Nemotron through Nebius Token Factory's
// OpenAI-compatible Chat Completions API. Every endpoint asks the model for a
// JSON object and then parses it, and that parse is the most fragile step in
// the API: the model can answer with prose, the provider can return an error
// envelope or an empty body, and a long generation can be cut off by
// max_tokens mid-object. Each of those used to surface as a generic 500 whose
// message pointed at the wrong cause, so the guard lives here once instead of
// being reimplemented per endpoint.

// Use the global endpoint. The Token Factory console also shows region-specific
// URLs (e.g. api.tokenfactory.us-central1...), but it warns those can stop
// working when the shared endpoint's region changes.
const NEBIUS_URL = 'https://api.tokenfactory.nebius.com/v1/chat/completions';

// Models are tried in order, moving on only when one is busy (429/503).
// Nemotron 3 Super is the default: strong enough for long creative copy, fast
// enough (~125 tokens/s) for a phone app. Add fallbacks with a comma separated
// NEBIUS_MODELS env var, e.g. "nvidia/nemotron-3-super-120b-a12b,<nano model id>".
const DEFAULT_MODELS = ['nvidia/nemotron-3-super-120b-a12b'];

// Nemotron 3 is a reasoning model: it thinks first (returned separately from
// the answer) and those thinking tokens count against max_tokens. Without
// headroom, a long marketing package can run out of budget mid-answer.
const REASONING_HEADROOM = 4000;

function modelList(): string[] {
  const fromEnv = (process.env.NEBIUS_MODELS ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  return fromEnv.length > 0 ? fromEnv : DEFAULT_MODELS;
}

// HTTP statuses that mean "this model is busy right now", not "this request is bad".
const BUSY_STATUSES = new Set([429, 503]);

export type LlmResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; detail: string };

// Diagnostic snippets go to the logs and to the client, so keep them short.
function snippet(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 300 ? `${clean.slice(0, 300)}...` : clean;
}

function fail(status: number, error: string, detail: string): LlmResult<never> {
  return { ok: false, status, error, detail: snippet(detail) };
}

function parseOrNull(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Pull the outermost JSON object out of a model reply and parse it. Tolerates
 * markdown fences, <think> blocks and leading or trailing chatter around it.
 */
export function extractJsonObject<T>(raw: string, truncated: boolean): LlmResult<T> {
  // Some serving stacks inline the reasoning as <think>...</think> instead of
  // returning it in a separate field. Drop it so braces inside the thinking
  // can't be mistaken for the answer.
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');

  // Guard the indices explicitly. When the reply contains no brace at all both
  // are -1, and slice(-1, 0) quietly returns '' -- JSON.parse('') then reports
  // "Unexpected end of JSON input", which reads like truncation and sends you
  // looking in the wrong place.
  if (start === -1 || end <= start) {
    return truncated
      ? fail(502, 'Model response was cut off before it produced any JSON', text)
      : fail(502, 'Model replied with prose instead of JSON', text);
  }

  const parsed = parseOrNull(text.slice(start, end + 1));
  if (parsed === null) {
    return truncated
      ? fail(502, 'Model response was cut off mid-JSON', text)
      : fail(502, 'Model returned malformed JSON', text);
  }

  return { ok: true, data: parsed as T };
}

type Attempt<T> = { result: LlmResult<T>; busy: boolean };

async function post(model: string, prompt: string, maxTokens: number, jsonMode: boolean) {
  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens + REASONING_HEADROOM,
    // A little above the default so separate generations for the same book
    // don't come back near-identical -- the whole pitch is fresh creative copy.
    temperature: 1.0,
    messages: [{ role: 'user', content: prompt }],
  };
  // Ask the server to constrain output to a JSON object. Every prompt already
  // says "JSON only", so this is a belt-and-braces measure.
  if (jsonMode) body.response_format = { type: 'json_object' };

  const response = await fetch(NEBIUS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.NEBIUS_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  // Read the body as text first. An empty body or an HTML error page makes
  // response.json() throw the same "Unexpected end of JSON input" the parse
  // guard above is meant to explain.
  return { response, text: await response.text() };
}

/** One call to one model. `busy` is true when the model is rate limited or over capacity. */
async function attemptModel<T>(model: string, prompt: string, maxTokens: number): Promise<Attempt<T>> {
  try {
    let { response, text } = await post(model, prompt, maxTokens, true);

    // If this model or endpoint doesn't accept response_format, retry once
    // without it rather than failing: the prompt still demands JSON and the
    // parse guard still catches anything else.
    if (response.status === 400 && /response_format|json_object|json mode/i.test(text)) {
      console.warn(`nebius: ${model} rejected JSON mode, retrying without it`);
      ({ response, text } = await post(model, prompt, maxTokens, false));
    }

    if (!response.ok) {
      return {
        result: fail(502, `Nebius returned HTTP ${response.status}`, text),
        busy: BUSY_STATUSES.has(response.status),
      };
    }

    const payload = parseOrNull(text);
    if (payload === null) {
      return { result: fail(502, 'Nebius returned a non-JSON response envelope', text), busy: false };
    }

    const choice = payload?.choices?.[0];
    const message = choice?.message ?? {};
    const truncated = choice?.finish_reason === 'length';
    let content: unknown = message.content;

    // The answer belongs in `content`, with the thinking in a separate field.
    // If content is empty, a stack that misroutes the answer may have put it in
    // the reasoning field, so look there before giving up.
    if (typeof content !== 'string' || content.trim() === '') {
      const reasoning = message.reasoning_content ?? message.reasoning;
      if (typeof reasoning === 'string' && reasoning.includes('{')) {
        console.warn(`nebius: ${model} returned empty content; reading JSON from the reasoning field`);
        content = reasoning;
      } else {
        return {
          result: truncated
            ? fail(502, 'Model spent its whole token budget thinking and gave no answer', text)
            : fail(502, 'Nebius returned no completion text', text),
          busy: false,
        };
      }
    }

    return { result: extractJsonObject<T>(content as string, truncated), busy: false };
  } catch (error: any) {
    return { result: fail(502, 'Could not reach Nebius', error?.message ?? String(error)), busy: false };
  }
}

/**
 * Prompt Nemotron for a JSON object, returning a typed result rather than
 * throwing. Falls through the model list only when a model is busy (429/503);
 * any other failure is returned as-is so real errors are not hidden.
 */
export async function generateJson<T>(prompt: string, maxTokens: number): Promise<LlmResult<T>> {
  if (!process.env.NEBIUS_API_KEY) {
    return fail(500, 'Server is not configured: NEBIUS_API_KEY is missing', '');
  }

  const models = modelList();
  let last: Attempt<T> | undefined;

  for (const model of models) {
    last = await attemptModel<T>(model, prompt, maxTokens);
    if (!last.busy) {
      if (!last.result.ok) {
        console.error(`nebius: ${model} failed:`, last.result.error);
      } else if (model !== models[0]) {
        console.warn(`nebius: served by fallback model ${model}`);
      }
      return last.result;
    }
    console.warn(`nebius: ${model} is busy, trying next model`);
  }

  return fail(
    503,
    'The AI service is busy right now. Please try again in a minute.',
    last && !last.result.ok ? last.result.detail : ''
  );
}
