/**
 * Gemini REST wrapper (technical-plan §5.1/§5.3).
 *
 * Targets the stable `generateContent` endpoint with inline base64 audio and
 * a strict JSON response schema. (Google also offers a newer Interactions
 * API; generateContent is kept backward-compatible and is what this app
 * uses. The model name is a user setting so a deprecation is a one-field fix,
 * not a code change.)
 */
import { buildPrompt, RESPONSE_SCHEMA, type PromptContext, type RawParsedTransaction } from '@/ai/prompt';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface GeminiRequest {
  apiKey: string;
  model: string;
  audioBase64: string;
  audioMimeType: string;
  context: PromptContext;
}

/** Read a local file:// URI as base64 without extra native modules. */
export async function fileToBase64(uri: string): Promise<string> {
  const response = await fetch(uri);
  const blob = await response.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the recording.'));
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

export async function parseAudioWithGemini(req: GeminiRequest): Promise<RawParsedTransaction> {
  const url = `${ENDPOINT}/${encodeURIComponent(req.model)}:generateContent?key=${encodeURIComponent(req.apiKey)}`;

  const body = {
    contents: [
      {
        parts: [
          { text: buildPrompt(req.context) },
          { inline_data: { mime_type: req.audioMimeType, data: req.audioBase64 } },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
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
    return JSON.parse(stripFences(text)) as RawParsedTransaction;
  } catch {
    throw new Error('Gemini returned malformed JSON.');
  }
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  promptFeedback?: { blockReason?: string };
}

/** Defensive: strip stray ```json fences even though JSON mode shouldn't add them. */
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
