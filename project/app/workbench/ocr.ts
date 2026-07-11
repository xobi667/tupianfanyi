import { type GatewayGenerateRequest, type GatewayGenerateResponse, type GatewaySettings } from '@/lib/gateway';
import { getPromptLanguageName } from './options';
import { ProcessingError } from './batch-state';

export interface OcrTaskResult {
  hasText?: boolean;
  extractedText: string;
  translatedText?: string;
  detectionError?: string;
}

export type GenerateApiCaller = (
  payload: GatewayGenerateRequest,
  signal?: AbortSignal,
) => Promise<GatewayGenerateResponse>;

export function parseStructuredText(rawText: string): OcrTaskResult {
  const cleaned = rawText
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '');

  let parsed: {
    hasText?: unknown;
    extractedText?: unknown;
    translatedText?: unknown;
  };

  try {
    parsed = JSON.parse(cleaned);
  } catch (error) {
    throw new ProcessingError(
      `无法解析文本模型返回的 JSON 结果: ${error instanceof Error ? error.message : String(error)}`,
      {
        kind: 'invalid_response',
        retryable: false,
      },
    );
  }

  if (typeof parsed.extractedText !== 'string') {
    throw new ProcessingError('文本模型返回了无效的 OCR 结果，缺少 extractedText。', {
      kind: 'invalid_response',
      retryable: false,
    });
  }

  if (typeof parsed.translatedText !== 'string') {
    throw new ProcessingError('文本模型返回了无效的翻译结果，缺少 translatedText。', {
      kind: 'invalid_response',
      retryable: false,
    });
  }

  return {
    hasText:
      typeof parsed.hasText === 'boolean'
        ? parsed.hasText
        : Boolean(parsed.extractedText.trim() || parsed.translatedText.trim()),
    extractedText: parsed.extractedText,
    translatedText: parsed.translatedText,
  };
}

export function parseDetectionResult(rawText: string) {
  const cleaned = rawText
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '');

  let parsed: {
    hasText?: unknown;
  };

  try {
    parsed = JSON.parse(cleaned);
  } catch (error) {
    throw new ProcessingError(
      `无法解析文本模型返回的 JSON 结果: ${error instanceof Error ? error.message : String(error)}`,
      {
        kind: 'invalid_response',
        retryable: false,
      },
    );
  }

  if (typeof parsed.hasText !== 'boolean') {
    throw new ProcessingError('文本模型返回了无效的含字判断结果。', {
      kind: 'invalid_response',
      retryable: false,
    });
  }

  return parsed.hasText;
}

export function buildDetectionStageResult(hasText: boolean): OcrTaskResult {
  return {
    hasText,
    extractedText: '',
    translatedText: '',
  };
}

export function buildDetectionFallbackResult(detectionError: string): OcrTaskResult {
  return {
    ...buildDetectionStageResult(true),
    detectionError,
  };
}

export function mergeOcrResultWithDetectionError(result: OcrTaskResult, detectionError?: string) {
  return {
    ...result,
    detectionError,
  };
}

export function buildDetectTextPrompt() {
  return `You are a strict visual text detector.
Decide whether the image contains any visible, legible text.

Count any real readable text, including tiny text, labels, watermarks, UI text, background signs, scene text, packaging text, overlays, captions, logos, marks, and fragments if they are legible.
Do not require the text to be meaningful, customer-facing, commercially relevant, or worth translating.
Do not guess or infer text that is blurred, cut off, too small, distorted, or otherwise uncertain.

Return JSON only with:
- hasText`;
}

export function buildExtractPrompt(targetLanguage: string) {
  const promptLanguage = getPromptLanguageName(targetLanguage);

  return `You are a strict OCR and translation system.
Extract every visible, legible text string from the image, then translate it into ${promptLanguage}.

Core rules:
1. Extract any real readable text visible in the image.
   Include product text, labels, specs, badges, notes, logos, watermarks, UI text, background signs, scene text, overlays, captions, tiny text, and text fragments if they are legible.
2. Do not filter by meaning or usefulness.
   Do NOT limit extraction to customer-facing, commercial, intended, important, or translation-worthy text.
3. Do not guess, infer, autocomplete, or semantically correct uncertain text.
   If text is blurred, reflective, folded, partially covered, stylized, cut off, too small, distorted, or ambiguous, include only the characters that are clearly legible.
   If no characters are clearly legible, omit that uncertain fragment.
4. Preserve visible reading order and grouping as much as possible.
   Use line breaks to reflect the visual layout.
5. Handle mixed languages automatically.
   Translate the extracted text into ${promptLanguage} while preserving line breaks and grouping.
6. If the image has no visible legible text, return hasText as false and leave extractedText and translatedText empty.
7. If any visible legible text is extracted, return hasText as true.

Return JSON only with:
- hasText
- extractedText
- translatedText`;
}

export function getResponseText(response: GatewayGenerateResponse) {
  return (
    response.candidates
      ?.flatMap((candidate) => candidate.content?.parts ?? [])
      .map((part) => part.text?.trim())
      .filter((text): text is string => Boolean(text))
      .join('\n') ?? ''
  ).trim();
}

export async function detectImageText({
  callGenerateApi,
  settings,
  model,
  base64Data,
  mimeType,
  debugLabel,
  signal,
}: {
  callGenerateApi: GenerateApiCaller;
  settings: GatewaySettings;
  model: string;
  base64Data: string;
  mimeType: string;
  debugLabel: string;
  signal?: AbortSignal;
}) {
  const textResponse = await callGenerateApi({
    settings,
    model,
    requestKind: 'text',
    debugLabel,
    parts: [
      {
        inlineData: {
          data: base64Data,
          mimeType,
        },
      },
      {
        text: buildDetectTextPrompt(),
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          hasText: {
            type: 'BOOLEAN',
            description:
              'Whether the image contains any visible legible text.',
          },
        },
        required: ['hasText'],
      },
    },
  }, signal);

  const rawText = getResponseText(textResponse);

  if (!rawText) {
    throw new ProcessingError('文本模型没有返回可解析的含字判断结果。', {
      kind: 'invalid_response',
      retryable: false,
    });
  }

  return parseDetectionResult(rawText);
}

export async function extractAndTranslateImageText({
  callGenerateApi,
  settings,
  model,
  base64Data,
  mimeType,
  targetLanguage,
  debugLabel,
  signal,
}: {
  callGenerateApi: GenerateApiCaller;
  settings: GatewaySettings;
  model: string;
  base64Data: string;
  mimeType: string;
  targetLanguage: string;
  debugLabel: string;
  signal?: AbortSignal;
}) {
  const textResponse = await callGenerateApi({
    settings,
    model,
    requestKind: 'text',
    debugLabel,
    parts: [
      {
        inlineData: {
          data: base64Data,
          mimeType,
        },
      },
      {
        text: buildExtractPrompt(targetLanguage),
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          hasText: {
            type: 'BOOLEAN',
            description:
              'Whether the image contains any visible legible text.',
          },
          extractedText: {
            type: 'STRING',
            description:
              'Every visible legible text string from the image. Do not exclude text for being non-customer-facing, background, watermark, UI, or low-importance. Do not guess uncertain text.',
          },
          translatedText: {
            type: 'STRING',
            description: `The extracted visible legible text translated into ${targetLanguage}, preserving line breaks and grouping.`,
          },
        },
        required: ['hasText', 'extractedText', 'translatedText'],
      },
    },
  }, signal);

  const rawText = getResponseText(textResponse);

  if (!rawText) {
    throw new ProcessingError('文本模型没有返回可解析的 OCR 结果。', {
      kind: 'invalid_response',
      retryable: false,
    });
  }

  return parseStructuredText(rawText);
}
