/**
 * Gemini REST wrapper for Transaction AI V1.
 *
 * Structural instruction/data boundary: the rules + entity context go in
 * `system_instruction`; the untrusted utterance — audio or text — is the only
 * thing in the user turn. Returns the RAW parsed JSON (typed `unknown`) — it is
 * deliberately not trusted here; src/ai/interpretation/validate.ts is the
 * authoritative check.
 *
 * V1.2 (audit F8) adds three things:
 *  - a declared `responseSchema`, so a malformed or mis-keyed response is not
 *    something we have to survive at all (with a fallback, below),
 *  - temperature 0, because interpretation is extraction, not composition,
 *  - a TEXT entry point beside the audio one. Production still sends audio
 *    straight to interpretation — one call, no transcription step to lose
 *    information at — but the same prompt can now be driven from a transcript,
 *    which is what the compound-utterance critic and the offline eval harness
 *    need.
 */
import { fileToBase64 } from '@/ai/gemini';
import { buildInterpretationSystemInstruction, type InterpretPromptContext } from '@/ai/interpretPrompt';
import { INTERPRETATION_RESPONSE_SCHEMA } from '@/ai/interpretSchema';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface InterpretRequest {
  apiKey: string;
  model: string;
  audioBase64: string;
  audioMimeType: string;
  context: InterpretPromptContext;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  promptFeedback?: { blockReason?: string };
}

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

export interface GeminiCall {
  apiKey: string;
  model: string;
  systemInstruction: string;
  parts: Part[];
  /** Declared output shape. Omitted on the retry described in `callGemini`. */
  responseSchema?: unknown;
}

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function firstLine(text: string): string {
  return text.split('\n')[0]?.slice(0, 200) ?? '';
}

/** A 400 that is specifically about the schema we sent, not the request as a whole. */
function looksLikeSchemaRejection(status: number, detail: string): boolean {
  return status === 400 && /schema|response_schema|responseSchema|propertyOrdering/i.test(detail);
}

async function post(call: GeminiCall): Promise<Response> {
  const body = {
    system_instruction: { parts: [{ text: call.systemInstruction }] },
    // The utterance is the ONLY user-turn content — untrusted data.
    contents: [{ role: 'user', parts: call.parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      // Extraction, not composition: the same words should give the same
      // reading every time.
      temperature: 0,
      ...(call.responseSchema ? { responseSchema: call.responseSchema } : {}),
    },
  };

  try {
    return await fetch(`${ENDPOINT}/${encodeURIComponent(call.model)}:generateContent`, {
      method: 'POST',
      // The key travels in a header, never the URL — query strings end up in
      // request logs and proxies (audit F11).
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': call.apiKey },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Network error — check your connection and try again.');
  }
}

/**
 * One Gemini call returning parsed JSON.
 *
 * If the API rejects the declared schema — a model that does not support
 * structured output, or a schema feature it dislikes — the call is retried
 * once WITHOUT the schema. Voice capture then behaves exactly as it did before
 * structured output existed rather than failing outright; validation is
 * unaffected either way, since it never trusted the shape to begin with.
 */
export async function callGemini(call: GeminiCall): Promise<unknown> {
  let response = await post(call);

  if (!response.ok) {
    const detail = await response.text().catch(() => '');

    if (call.responseSchema && looksLikeSchemaRejection(response.status, detail)) {
      response = await post({ ...call, responseSchema: undefined });
    } else if (response.status === 400 && /API key/i.test(detail)) {
      throw new Error('Gemini rejected the API key. Check it in Settings.');
    } else if (response.status === 429) {
      throw new Error('Gemini rate limit or quota reached. Try again later.');
    } else {
      throw new Error(`Gemini error ${response.status}. ${firstLine(detail)}`);
    }

    if (!response.ok) {
      const retryDetail = await response.text().catch(() => '');
      throw new Error(`Gemini error ${response.status}. ${firstLine(retryDetail)}`);
    }
  }

  const data = (await response.json()) as GeminiResponse;
  const blocked = data.promptFeedback?.blockReason;
  if (blocked) throw new Error(`Gemini blocked the request (${blocked}).`);

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no content.');

  try {
    return JSON.parse(stripFences(text)) as unknown;
  } catch {
    throw new Error('Gemini returned malformed JSON.');
  }
}

/** Calls Gemini with the recorded audio and returns the raw interpretation (untrusted). */
export async function interpretAudioWithGemini(req: InterpretRequest): Promise<unknown> {
  return callGemini({
    apiKey: req.apiKey,
    model: req.model,
    systemInstruction: buildInterpretationSystemInstruction(req.context),
    parts: [{ inline_data: { mime_type: req.audioMimeType, data: req.audioBase64 } }],
    responseSchema: INTERPRETATION_RESPONSE_SCHEMA,
  });
}

export interface InterpretTextRequest {
  apiKey: string;
  model: string;
  transcript: string;
  context: InterpretPromptContext;
  /**
   * An app-authored correction appended to the SYSTEM side (never the user
   * turn), used by the critic's repair pass. It describes what the first
   * reading appears to have missed; it never asserts a value.
   */
  correctionNote?: string;
}

/**
 * Interpret an already-transcribed utterance. Used by the critic's repair pass
 * and by the offline eval harness — the production voice path sends audio.
 */
export async function interpretTextWithGemini(req: InterpretTextRequest): Promise<unknown> {
  const system = req.correctionNote
    ? `${buildInterpretationSystemInstruction(req.context)}\n\n${req.correctionNote}`
    : buildInterpretationSystemInstruction(req.context);

  return callGemini({
    apiKey: req.apiKey,
    model: req.model,
    systemInstruction: system,
    parts: [{ text: req.transcript }],
    responseSchema: INTERPRETATION_RESPONSE_SCHEMA,
  });
}

export { fileToBase64 };
