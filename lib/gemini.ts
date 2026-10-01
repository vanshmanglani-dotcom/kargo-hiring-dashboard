import 'server-only';

/**
 * AI client for all pipeline steps (Gemini Flash), with JSON-schema output.
 *
 * Two ways to reach Gemini — whichever is configured:
 *   1. GEMINI_API_KEY set           → Google's Gemini API directly.
 *   2. Running on Vercel (or AI_GATEWAY_API_KEY set) → Vercel AI Gateway, model google/<GEMINI_MODEL>.
 *      On Vercel this authenticates automatically with the deployment's OIDC token — no key to manage.
 * Neither → mock mode (keyword heuristics) so the app still runs locally.
 *
 * Data note: on Google's free AI Studio tier, prompts may be used to improve Google's products;
 * the paid Gemini API and AI Gateway do not train on your data.
 */
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

export function aiMode(): 'gemini' | 'gateway' | 'mock' {
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.AI_GATEWAY_API_KEY || process.env.VERCEL) return 'gateway';
  return 'mock';
}

export type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

export async function geminiJSON<T>(opts: { system: string; parts: Part[]; schema: object; temperature?: number }): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return aiMode() === 'gemini' ? await direct<T>(opts) : await viaGateway<T>(opts);
    } catch (e) {
      lastErr = e;
      const msg = String((e as Error)?.message || e);
      if (/\b(400|401|403|404)\b/.test(msg) && !/429/.test(msg)) break; // won't fix itself
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function direct<T>(opts: { system: string; parts: Part[]; schema: object; temperature?: number }): Promise<T> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY! },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: opts.system }] },
      contents: [{ role: 'user', parts: opts.parts }],
      generationConfig: { temperature: opts.temperature ?? 0, responseMimeType: 'application/json', responseSchema: toGemini(opts.schema) },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const json = await res.json();
  const text: string | undefined = json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('');
  if (!text) throw new Error(`Gemini returned no content (${json?.candidates?.[0]?.finishReason ?? 'unknown'})`);
  return JSON.parse(text) as T;
}

async function viaGateway<T>(opts: { system: string; parts: Part[]; schema: object; temperature?: number }): Promise<T> {
  const { generateObject, jsonSchema } = await import('ai');
  const content = opts.parts.map((p) =>
    'text' in p
      ? { type: 'text' as const, text: p.text }
      : { type: 'file' as const, data: p.inline_data.data, mediaType: p.inline_data.mime_type },
  );
  const { object } = await generateObject({
    model: `google/${MODEL}`,
    system: opts.system,
    messages: [{ role: 'user', content }],
    schema: jsonSchema(opts.schema as Parameters<typeof jsonSchema>[0]),
    temperature: opts.temperature ?? 0,
  });
  return object as T;
}

/** Standard JSON Schema → Gemini's OpenAPI-subset schema. */
function toGemini(s: any): any {
  if (Array.isArray(s)) return s.map(toGemini);
  if (!s || typeof s !== 'object') return s;
  const out: any = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === 'additionalProperties') continue;
    if (k === 'type' && typeof v === 'string') out.type = v.toUpperCase();
    else if (k === 'properties') out.properties = Object.fromEntries(Object.entries(v as object).map(([pk, pv]) => [pk, toGemini(pv)]));
    else out[k] = toGemini(v);
  }
  return out;
}

// Schema helpers (standard JSON Schema)
export const S = {
  str: (description?: string) => ({ type: 'string', ...(description ? { description } : {}) }),
  int: (description?: string) => ({ type: 'integer', ...(description ? { description } : {}) }),
  arr: (items: object) => ({ type: 'array', items }),
  obj: (properties: Record<string, object>, required = Object.keys(properties)) => ({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  }),
};
