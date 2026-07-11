import {
  type GatewayGenerateRequest,
  type GatewayGenerateResponse,
  type GatewaySettings,
} from '@/lib/gateway';
import { normalizeSupportedImageMimeType } from '@/lib/image-formats';
import { getPromptLanguageName, type OutputAspectRatio } from './options';
import { ProcessingError } from './batch-state';
import { getResponseText } from './ocr';

export type ImageProcessMode = 'translate_and_remove' | 'translate_only' | 'remove_only';

export function shouldRunOcrTranslationFlow(mode: ImageProcessMode) {
  return mode === 'translate_and_remove' || mode === 'translate_only';
}

export type GenerateApiCaller = (
  payload: GatewayGenerateRequest,
  signal?: AbortSignal,
) => Promise<GatewayGenerateResponse>;

function isChargeAmbiguousImageFailure(error: ProcessingError) {
  if (error.kind === 'timeout' || error.kind === 'network') {
    return true;
  }

  return (
    error.kind === 'server' &&
    (error.status === 500 || error.status === 502 || error.status === 504)
  );
}

function makeChargeSafeFailure(error: ProcessingError, attemptLabel: string) {
  const safetyMessage = '上游可能已经接收了这次生图请求。为避免重复扣费，已立即停止兼容尝试和自动重试。';
  return new ProcessingError(`${attemptLabel}: ${error.message}；${safetyMessage}`, {
    kind: error.kind,
    retryable: false,
    status: error.status,
    requestId: error.requestId,
    details: [...(error.details ?? []), safetyMessage],
  });
}

function normalizeGeneratedImageDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+);base64,([\s\S]+)$/i);
  const mimeType = normalizeSupportedImageMimeType(match?.[1] ?? '');
  const base64Data = match?.[2]?.replace(/\s/g, '') ?? '';

  if (!mimeType) {
    throw new ProcessingError('生图接口返回了无效的图片 MIME 类型。', {
      kind: 'invalid_response',
      retryable: false,
    });
  }

  if (!base64Data || base64Data.length < 16 || base64Data.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64Data)) {
    throw new ProcessingError('生图接口返回了无效或不完整的 Base64 图片数据。', {
      kind: 'invalid_response',
      retryable: false,
    });
  }

  try {
    const decoded = window.atob(base64Data);
    if (decoded.length < 8) throw new Error('decoded image is empty');
  } catch {
    throw new ProcessingError('生图接口返回的图片数据无法解码。', {
      kind: 'invalid_response',
      retryable: false,
    });
  }

  return `data:${mimeType};base64,${base64Data}`;
}

async function validateGeneratedImageDataUrl(dataUrl: string) {
  const normalizedDataUrl = normalizeGeneratedImageDataUrl(dataUrl);

  await new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        resolve();
        return;
      }
      reject(new Error('decoded image has no dimensions'));
    };
    image.onerror = () => reject(new Error('browser failed to decode image'));
    image.src = normalizedDataUrl;
  }).catch(() => {
    throw new ProcessingError('生图接口虽然返回了数据，但浏览器无法解码这张图片。已保留为失败状态，且不会自动重复扣费。', {
      kind: 'invalid_response',
      retryable: false,
    });
  });

  return normalizedDataUrl;
}

function getResponseImage(response: GatewayGenerateResponse) {
  const part = response.candidates
    ?.flatMap((candidate) => candidate.content?.parts ?? [])
    .find((item) => item.inlineData?.data || item.inline_data?.data);

  const inlineData = part?.inlineData;
  const inlineDataSnake = part?.inline_data;
  const imageData = inlineData?.data ?? inlineDataSnake?.data;
  const mimeType = inlineData?.mimeType ?? inlineDataSnake?.mime_type ?? 'image/png';

  if (!imageData) {
    return null;
  }

  return `data:${mimeType};base64,${imageData}`;
}

function buildAspectRatioInstruction(outputAspectRatio: OutputAspectRatio) {
  if (outputAspectRatio === 'original') {
    return 'Keep the same canvas size and the same aspect ratio as the source image. Do not crop, trim, cover, or move any important text or product area.';
  }

  return `Adapt the final output to a ${outputAspectRatio} aspect ratio by extending padding/background or recomposing safely. Never hard-crop, trim, cover, or cut off any important text, product edge, logo, or label. Keep all translated text fully visible and preserve the overall layout intent.`;
}

function buildPureTranslationRules(promptLanguage: string) {
  return `PURE VISIBLE-TEXT TRANSLATION CONTRACT:
- Use the OCR text list below as the only text-editing source of truth.
- Translate ONLY real visible text that already exists in the source image into ${promptLanguage}.
- Replace every OCR-listed source text item with its corresponding translated text, in the same position and approximate same visual hierarchy as the original text.
- Do NOT create, add, invent, infer, autocomplete, summarize, beautify, reinterpret, or delete any text beyond the OCR-listed replacements.
- Do NOT add new slogans, captions, labels, icons, badges, products, people, decorations, UI elements, watermarks, or background details.
- Do NOT remove, rewrite, summarize, beautify, or reinterpret non-text content.
- Keep all non-translated regions unchanged: objects, product shapes, colors, lighting, background, composition, texture, and non-text artwork.
- If a text region is uncertain or not listed in the OCR text, leave that region unchanged instead of inventing words.`;
}

function buildDirectTranslationRules(promptLanguage: string) {
  return `DIRECT VISIBLE-TEXT TRANSLATION CONTRACT:
- Do not wait for or rely on an OCR list. Inspect the source image yourself and read every legible visible text region.
- Translate all visible source-language text into ${promptLanguage}, including headings, labels, prices, captions, badges, and small print.
- Replace each translated text item inside its original text region. Preserve its position, alignment, hierarchy, approximate typography, color, and scale.
- Change only the pixels needed to replace visible text. Keep all non-text pixels and content unchanged: people, products, objects, logos and marks without text, colors, lighting, background, composition, texture, decorations, and geometry.
- Do not add, invent, autocomplete, summarize, beautify, or delete content. Do not create new slogans, captions, labels, icons, badges, products, people, decorations, UI elements, or watermarks.
- Keep every translated line fully visible. If a translation is longer, fit it safely within the same text region without covering nearby content.
- Return one edited image only.`;
}

function buildImagePrompt({
  mode,
  targetLanguage,
  watermarkText,
  extractedText,
  translatedText,
  outputAspectRatio,
}: {
  mode: ImageProcessMode;
  targetLanguage: string;
  watermarkText: string;
  extractedText?: string;
  translatedText?: string;
  outputAspectRatio: OutputAspectRatio;
}) {
  const promptLanguage = getPromptLanguageName(targetLanguage);
  const targetWatermark = watermarkText
    ? ` Specifically remove watermark text related to "${watermarkText}".`
    : '';
  const outputSizingInstruction = buildAspectRatioInstruction(outputAspectRatio);
  const pureTranslationRules = buildPureTranslationRules(promptLanguage);

  if (mode === 'translate_and_remove') {
    return `Edit this image only.
${pureTranslationRules}
Replace the OCR-listed visible text with the provided ${promptLanguage} translation in place.
Also remove only watermark text and semi-transparent watermark overlays.${targetWatermark}
${outputSizingInstruction}
Keep the same layout intent, same background, same decorations, and same non-text elements.
Edit only OCR-listed text regions and explicit watermark regions.

Original OCR text:
${extractedText ?? ''}

Translated OCR text:
${translatedText ?? ''}

Return only the edited image.`;
  }

  if (mode === 'translate_only') {
    return `Edit this image only.
${pureTranslationRules}
Replace the OCR-listed visible text with the provided ${promptLanguage} translation in place.
${outputSizingInstruction}
Keep the same layout intent, same background, same decorations, and same non-text elements.
Edit only OCR-listed text regions. Do not remove watermarks, logos, labels, marks, or any other visible content unless that exact visible text is in the OCR list and has a provided translation.

Original OCR text:
${extractedText ?? ''}

Translated OCR text:
${translatedText ?? ''}

Return only the edited image.`;
  }

  return `You are an expert image editor.
Remove watermarks while preserving all genuine text, objects, and layout.

Instructions:
1. Edit only watermark regions and leave all non-watermark content unchanged.${targetWatermark}
2. ${outputSizingInstruction}
3. Keep the composition, icons, illustrations, decorations, text, and background geometry as consistent as possible with the source.
4. Do not erase product titles, labels, prices, descriptions, or other real content.
5. Keep the final image natural and consistent with the source.`;
}

function buildDirectImagePrompt({
  mode,
  targetLanguage,
  watermarkText,
  extractedText,
  translatedText,
  outputAspectRatio,
}: {
  mode: ImageProcessMode;
  targetLanguage: string;
  watermarkText: string;
  extractedText?: string;
  translatedText?: string;
  outputAspectRatio: OutputAspectRatio;
}) {
  const promptLanguage = getPromptLanguageName(targetLanguage);
  const targetWatermark = watermarkText
    ? ` Specifically remove watermark text related to "${watermarkText}".`
    : '';
  const outputSizingInstruction = buildAspectRatioInstruction(outputAspectRatio);
  const hasStructuredText = Boolean(extractedText?.trim() && translatedText?.trim());

  if (!hasStructuredText && mode === 'translate_and_remove') {
    return `Edit this image only.
${buildDirectTranslationRules(promptLanguage)}
Also remove only watermark text and semi-transparent watermark overlays.${targetWatermark}
${outputSizingInstruction}
Preserve the original layout and every non-text region. Apart from explicit watermark removal, edit only visible text regions.
Return only the edited image.`;
  }

  if (!hasStructuredText && mode === 'translate_only') {
    return `Edit this image only.
${buildDirectTranslationRules(promptLanguage)}
${outputSizingInstruction}
Preserve watermarks, logos, labels, marks, layout, and every non-text region; translate readable text in place without removing the element that contains it.
Edit only visible text regions.
Return only the edited image.`;
  }

  const pureTranslationRules = buildPureTranslationRules(promptLanguage);
  const textReplacementBlock =
    hasStructuredText
      ? `\nOriginal OCR text:\n${extractedText}\n\nTranslated OCR text:\n${translatedText}`
      : '';

  if (mode === 'translate_and_remove') {
    return `Edit this image only.
${pureTranslationRules}
Replace the OCR-listed visible text with the provided ${promptLanguage} translation in place.
Also remove only watermark text and semi-transparent watermark overlays.${targetWatermark}
${outputSizingInstruction}
Keep the same layout intent, same background, same decorations, and same non-text elements.
Edit only OCR-listed text regions and explicit watermark regions.
Return only the edited image.${textReplacementBlock}`;
  }

  if (mode === 'translate_only') {
    return `Edit this image only.
${pureTranslationRules}
Replace the OCR-listed visible text with the provided ${promptLanguage} translation in place.
${outputSizingInstruction}
Keep the same layout intent, same background, same decorations, and same non-text elements.
Edit only OCR-listed text regions. Do not remove watermarks, logos, labels, marks, or any other visible content unless that exact visible text is in the OCR list and has a provided translation.
Return only the edited image.${textReplacementBlock}`;
  }

  return buildImagePrompt({
    mode,
    targetLanguage,
    watermarkText,
    outputAspectRatio,
  });
}

function buildDirectImagePromptVariants({
  mode,
  targetLanguage,
  watermarkText,
  extractedText,
  translatedText,
  outputAspectRatio,
}: {
  mode: ImageProcessMode;
  targetLanguage: string;
  watermarkText: string;
  extractedText?: string;
  translatedText?: string;
  outputAspectRatio: OutputAspectRatio;
}) {
  return [
    {
      label: 'direct-edit',
      text: buildDirectImagePrompt({
        mode,
        targetLanguage,
        watermarkText,
        extractedText,
        translatedText,
        outputAspectRatio,
      }),
    },
  ];
}

function buildStructuredImagePromptVariants({
  mode,
  targetLanguage,
  watermarkText,
  extractedText,
  translatedText,
  outputAspectRatio,
}: {
  mode: ImageProcessMode;
  targetLanguage: string;
  watermarkText: string;
  extractedText?: string;
  translatedText?: string;
  outputAspectRatio: OutputAspectRatio;
}) {
  const detailedPrompt = buildImagePrompt({
    mode,
    targetLanguage,
    watermarkText,
    extractedText,
    translatedText,
    outputAspectRatio,
  });
  return [
    {
      label: '主提示词',
      text: detailedPrompt,
    },
  ];
}

function buildImagePartVariants({
  base64Data,
  mimeType,
  promptVariants,
}: {
  base64Data: string;
  mimeType: string;
  promptVariants: Array<{
    label: string;
    text: string;
  }>;
}) {
  return promptVariants.map((promptVariant) => ({
    label: promptVariant.label,
    parts: [
      {
        inlineData: {
          data: base64Data,
          mimeType,
        },
      },
      {
        text: promptVariant.text,
      },
    ] as GatewayGenerateRequest['parts'],
  }));
}

function buildImageGenerationAttempts({
  settings,
  model,
  partVariants,
  debugLabel,
  operationId,
}: {
  settings: GatewaySettings;
  model: string;
  partVariants: Array<{
    label: string;
    parts: GatewayGenerateRequest['parts'];
  }>;
  debugLabel: string;
  operationId?: string;
}) {
  const attempts: Array<{
    label: string;
    payload: GatewayGenerateRequest;
  }> = [];
  const partVariant = partVariants[0];
  if (!partVariant) return attempts;

  attempts.push({
    label: `${partVariant.label}-role`,
    payload: {
      settings,
      model,
      requestKind: 'image',
      parts: partVariant.parts,
      contentsMode: 'role_parts',
      debugLabel,
      attemptLabel: `${partVariant.label}-role`,
      generationConfig: {
        responseModalities: ['IMAGE'],
      },
      ...(operationId ? { operationId } : {}),
    },
  });

  return attempts;
}

export async function generateImageWithFallbacks({
  callGenerateApi,
  settings,
  model,
  partVariants,
  debugLabel,
  signal,
  operationId,
}: {
  callGenerateApi: GenerateApiCaller;
  settings: GatewaySettings;
  model: string;
  partVariants: Array<{
    label: string;
    parts: GatewayGenerateRequest['parts'];
  }>;
  debugLabel: string;
  timeoutMs: number;
  signal?: AbortSignal;
  operationId?: string;
}) {
  const attempts = buildImageGenerationAttempts({
    settings,
    model,
    partVariants,
    debugLabel,
    operationId,
  });
  const failures: ProcessingError[] = [];
  const failureMessages: string[] = [];

  for (const attempt of attempts) {
    try {
      const response = await callGenerateApiWithoutClientTimeout({
        callGenerateApi,
        payload: attempt.payload,
        signal,
      });
      const imageUrl = getResponseImage(response);

      if (imageUrl) {
        try {
          return await validateGeneratedImageDataUrl(imageUrl);
        } catch (error) {
          const processingError = error instanceof ProcessingError
            ? error
            : new ProcessingError('生图接口返回的图片无法解码。', {
                kind: 'invalid_response',
                retryable: false,
              });
          throw makeChargeSafeFailure(processingError, attempt.label);
        }
      }

      const textMessage = getResponseText(response);
      const responseError = new ProcessingError(
        textMessage
          ? `${attempt.label}: 未返回图片，返回了文本 ${textMessage.slice(0, 120)}`
          : `${attempt.label}: 未返回图片数据`,
        {
          kind: 'invalid_response',
          retryable: false,
        },
      );
      failures.push(responseError);
      failureMessages.push(responseError.message);
      throw makeChargeSafeFailure(responseError, attempt.label);
    } catch (error) {
      const processingError = error instanceof ProcessingError
        ? error
        : new ProcessingError(
            error instanceof Error ? error.message : '图片生成失败。',
            {
              kind: 'unknown',
              retryable: false,
            },
          );
      if (processingError.kind === 'paused') {
        throw processingError;
      }

      if (isChargeAmbiguousImageFailure(processingError)) {
        throw makeChargeSafeFailure(processingError, attempt.label);
      }

      if (processingError.kind === 'invalid_response') {
        throw processingError;
      }

      if (processingError.kind !== 'compatibility') {
        throw processingError;
      }

      failures.push(processingError);
      failureMessages.push(`${attempt.label}: ${processingError.message}`);
    }
  }

  const preferredFailure =
    failures.find((failure) => failure.kind === 'invalid_response') ??
    failures.find((failure) => failure.kind === 'compatibility') ??
    failures.find((failure) => !failure.retryable) ??
    failures.at(-1) ??
    new ProcessingError('图片生成失败。', {
      kind: 'unknown',
      retryable: false,
    });
  const chargeAmbiguousFailure = failures.find(isChargeAmbiguousImageFailure);
  const chargeSafetyMessage = chargeAmbiguousFailure
    ? '；上游可能已经接收了这次生图请求。为避免重复扣费，已停止自动重试，请调高生图超时或稍后手动重试这张图片。'
    : '';

  throw new ProcessingError(
    `图片生成失败。已自动尝试 ${attempts.length} 种兼容方式。${failureMessages
      .slice(0, 3)
      .join('；')}${chargeSafetyMessage}`,
    {
      kind: preferredFailure.kind,
      retryable: chargeAmbiguousFailure ? false : preferredFailure.retryable,
      status: preferredFailure.status,
      requestId: preferredFailure.requestId,
      details: failureMessages,
    },
  );
}

async function callGenerateApiWithoutClientTimeout({
  callGenerateApi,
  payload,
  signal,
}: {
  callGenerateApi: GenerateApiCaller;
  payload: GatewayGenerateRequest;
  signal?: AbortSignal;
}) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abortFromParent, { once: true });

  try {
    return await callGenerateApi(payload, controller.signal);
  } catch (error) {
    if (signal?.aborted) {
      throw new ProcessingError('已暂停。', {
        kind: 'paused',
        retryable: false,
      });
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new ProcessingError('生图请求已在提交前取消。', {
        kind: 'paused',
        retryable: false,
      });
    }

    throw error;
  } finally {
    signal?.removeEventListener('abort', abortFromParent);
  }
}

async function generateImageFromPromptVariants({
  callGenerateApi,
  settings,
  model,
  base64Data,
  mimeType,
  debugLabel,
  promptVariants,
  signal,
  operationId,
}: {
  callGenerateApi: GenerateApiCaller;
  settings: GatewaySettings;
  model: string;
  base64Data: string;
  mimeType: string;
  debugLabel: string;
  promptVariants: Array<{
    label: string;
    text: string;
  }>;
  signal?: AbortSignal;
  operationId?: string;
}) {
  return generateImageWithFallbacks({
    callGenerateApi,
    settings,
    model,
    debugLabel,
    timeoutMs: settings.imageRequestTimeoutMs,
    partVariants: buildImagePartVariants({
      base64Data,
      mimeType,
      promptVariants,
    }),
    signal,
    operationId,
  });
}

export function generateStructuredImageEdit({
  callGenerateApi,
  settings,
  model,
  base64Data,
  mimeType,
  mode,
  targetLanguage,
  watermarkText,
  extractedText,
  translatedText,
  outputAspectRatio,
  debugLabel,
  signal,
  operationId,
}: {
  callGenerateApi: GenerateApiCaller;
  settings: GatewaySettings;
  model: string;
  base64Data: string;
  mimeType: string;
  mode: ImageProcessMode;
  targetLanguage: string;
  watermarkText: string;
  extractedText?: string;
  translatedText?: string;
  outputAspectRatio: OutputAspectRatio;
  debugLabel: string;
  signal?: AbortSignal;
  operationId?: string;
}) {
  return generateImageFromPromptVariants({
    callGenerateApi,
    settings,
    model,
    base64Data,
    mimeType,
    debugLabel,
    promptVariants: buildStructuredImagePromptVariants({
      mode,
      targetLanguage,
      watermarkText,
      extractedText,
      translatedText,
      outputAspectRatio,
    }),
    signal,
    operationId,
  });
}

export function generateDirectImageEdit({
  callGenerateApi,
  settings,
  model,
  base64Data,
  mimeType,
  mode,
  targetLanguage,
  watermarkText,
  extractedText,
  translatedText,
  outputAspectRatio,
  debugLabel,
  signal,
  operationId,
}: {
  callGenerateApi: GenerateApiCaller;
  settings: GatewaySettings;
  model: string;
  base64Data: string;
  mimeType: string;
  mode: ImageProcessMode;
  targetLanguage: string;
  watermarkText: string;
  extractedText?: string;
  translatedText?: string;
  outputAspectRatio: OutputAspectRatio;
  debugLabel: string;
  signal?: AbortSignal;
  operationId?: string;
}) {
  return generateImageFromPromptVariants({
    callGenerateApi,
    settings,
    model,
    base64Data,
    mimeType,
    debugLabel,
    promptVariants: buildDirectImagePromptVariants({
      mode,
      targetLanguage,
      watermarkText,
      extractedText,
      translatedText,
      outputAspectRatio,
    }),
    signal,
    operationId,
  });
}
