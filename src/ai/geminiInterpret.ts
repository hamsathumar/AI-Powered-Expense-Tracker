/**
 * Gemini REST wrapper for Transaction AI V1.
 *
 * Structural instruction/data boundary: the rules + entity context go in
 * `system_instruction`; the untrusted audio is the only thing in the user
 * turn. Returns the RAW parsed JSON (typed `unknown`) — it is deliberately not
 * trusted here; src/ai/interpretation/validate.ts is the authoritative check.
 */
import { fileToBase64 } from '@/ai/gemini';
import { buildInterpretationSystemInstruction, type InterpretPromptContext } from '@/ai/interpretPrompt';

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

/** Calls Gemini and returns the raw parsed interpretation JSON (untrusted). */
export async function interpretAudioWithGemini(req: InterpretRequest): Promise<unknown> {
  const url = `${ENDPOINT}/${encodeURIComponent(req.model)}:generateContent?key=${encodeURIComponent(req.apiKey)}`;

  const body = {
    system_instruction: {
      parts: [{ text: buildInterpretationSystemInstruction(req.context) }],
    },
    contents: [
      {
        role: 'user',
        // The audio is the ONLY user-turn content — untrusted data.
        parts: [{ inline_data: { mime_type: req.audioMimeType, data: req.audioBase64 } }],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2,
    },
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Network error — check your connection and try again.');
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    if (response.status === 400 && /API key/i.test(detail)) {
      throw new Error('Gemini rejected the API key. Check it in Settings.');
    }
    if (response.status === 429) {
      throw new Error('Gemini rate limit or quota reached. Try again later.');
    }
    throw new Error(`Gemini error ${response.status}. ${firstLine(detail)}`);
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

export { fileToBase64 };
