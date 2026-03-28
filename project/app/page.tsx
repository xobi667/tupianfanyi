'use client';

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import Image from 'next/image';
import JSZip from 'jszip';
import {
  Archive,
  CheckCircle2,
  Download,
  Eraser,
  Globe,
  Image as ImageIcon,
  KeyRound,
  Languages,
  Loader2,
  Settings,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
  XCircle,
} from 'lucide-react';
import {
  normalizeSettings,
  type GatewayAuthMode,
  type GatewayGenerateRequest,
  type GatewayGenerateResponse,
  type GatewaySettings,
} from '@/lib/gateway';
import { cn } from '@/lib/utils';

type TaskStatus = 'idle' | 'extracting' | 'generating' | 'success' | 'error';
type ProcessMode = 'translate_and_remove' | 'translate_only' | 'remove_only';
type ConnectionStatus = 'idle' | 'testing' | 'success' | 'error';
type ConnectionTestMode = 'quick' | 'full';

interface ImageTask {
  id: string;
  file: File;
  preview: string;
  status: TaskStatus;
  result?: {
    extractedText: string;
    translatedText?: string;
  };
  generatedUrl?: string;
  error?: string;
}

const SETTINGS_STORAGE_KEY = 'image-translator-settings-v2';
const LEGACY_DEFAULT_IMAGE_REQUEST_TIMEOUT_VALUES = new Set([15000, 60000]);
const DEFAULT_IMAGE_REQUEST_TIMEOUT_MS = 120000;
const LANGUAGE_OPTIONS = [
  '中文',
  'English',
  '日本語',
  '한국어',
  'Français',
  'Español',
  'Русский',
  'ไทย',
  'Bahasa Indonesia',
];

const AUTH_MODE_OPTIONS: Array<{
  value: GatewayAuthMode;
  label: string;
  hint: string;
}> = [
  {
    value: 'x-goog-api-key',
    label: '官方 Gemini Header',
    hint: '把 API Key 放在请求头 x-goog-api-key 里。',
  },
  {
    value: 'bearer',
    label: 'Bearer Token',
    hint: '把 API Key 放在 Authorization: Bearer 里。',
  },
  {
    value: 'custom',
    label: '自定义请求头',
    hint: '把 API Key 放在你指定的请求头里，比如 x-api-key。',
  },
  {
    value: 'query',
    label: 'URL 参数',
    hint: '把 API Key 放在 URL 参数里，比如 ?key=xxxx。',
  },
];

const DEFAULT_SETTINGS: GatewaySettings = {
  apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY ?? '',
  apiBaseUrl:
    process.env.NEXT_PUBLIC_GEMINI_API_BASE_URL ??
    'https://generativelanguage.googleapis.com/v1beta',
  authMode: 'bearer',
  customAuthHeader: 'Authorization',
  extraHeadersText: '{}',
  textModel: process.env.NEXT_PUBLIC_GEMINI_TEXT_MODEL ?? 'gemini-2.5-flash',
  imageModel:
    process.env.NEXT_PUBLIC_GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image',
  maxParallelTasks: 3,
  imageRequestTimeoutMs: DEFAULT_IMAGE_REQUEST_TIMEOUT_MS,
};

function inferAuthModeFromApiKey(apiKey: string, currentAuthMode: GatewayAuthMode) {
  const trimmed = apiKey.trim();

  if (!trimmed) {
    return currentAuthMode;
  }

  if (
    (trimmed.startsWith('sk-') || trimmed.startsWith('yw-')) &&
    currentAuthMode === 'x-goog-api-key'
  ) {
    return 'bearer' satisfies GatewayAuthMode;
  }

  return currentAuthMode;
}

function inferCustomAuthHeader(authMode: GatewayAuthMode, currentHeader: string) {
  if (authMode === 'bearer') {
    return 'Authorization';
  }

  if (authMode === 'x-goog-api-key') {
    return 'x-goog-api-key';
  }

  return currentHeader;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '请求失败，请稍后重试。';
}

function getResponseText(response: GatewayGenerateResponse) {
  return (
    response.candidates
      ?.flatMap((candidate) => candidate.content?.parts ?? [])
      .map((part) => part.text?.trim())
      .filter((text): text is string => Boolean(text))
      .join('\n') ?? ''
  ).trim();
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

function dataUrlToBlob(dataUrl: string) {
  const [header, base64Data] = dataUrl.split(',');

  if (!header || !base64Data) {
    throw new Error('图片数据格式无效。');
  }

  const mimeType = header.match(/^data:(.*?);base64$/i)?.[1] ?? 'image/png';
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: mimeType });
}

function parseStructuredText(rawText: string) {
  const cleaned = rawText
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '');

  const parsed = JSON.parse(cleaned) as {
    extractedText?: unknown;
    translatedText?: unknown;
  };

  if (typeof parsed.extractedText !== 'string') {
    throw new Error('文本模型返回了无效的 OCR 结果。');
  }

  if (typeof parsed.translatedText !== 'string') {
    throw new Error('文本模型返回了无效的翻译结果。');
  }

  return {
    extractedText: parsed.extractedText,
    translatedText: parsed.translatedText,
  };
}

function buildExtractPrompt(targetLanguage: string) {
  return `You are an expert OCR, layout understanding, and translation system.
Your task is to understand the whole image first, then extract only the core customer-facing text that should actually be translated.

Core rules:
1. Understand the overall image context before reading text.
   Determine whether the image is a product poster, ecommerce banner, packaging photo, product detail image, real-world photo, label, or other commercial material.
2. Extract only the main intended content text.
   Keep product names, titles, slogans, selling points, specifications, labels, and important notes that belong to the product or poster itself.
3. Ignore irrelevant background text.
   Do NOT extract watermarks, faint overlays, repeating background text, road signs, environment text, store marks, copyright marks, UI chrome, or unrelated scene text unless it is clearly part of the intended product information.
4. Use semantic correction instead of broken OCR fragments.
   If text is blurred, reflective, folded, partially covered, stylized, or slightly cut off, infer the most likely correct wording from surrounding text, layout, and visible product context.
   Never output gibberish, broken characters, or obviously corrupted OCR fragments.
5. Preserve logical hierarchy.
   Large centered text is usually the main title.
   Smaller nearby text is usually subtitle, specification, or supporting description.
   Explicitly distinguish main title, subtitle, and specification/supporting text whenever possible.
   Preserve this structure with sensible line breaks and grouping.
6. Handle mixed languages automatically.
   Detect and understand all languages in the image, then translate the final extracted core text into ${targetLanguage}.
7. Be conservative about uncertain background text.
   If a text fragment looks more like a watermark or unrelated background noise than real product information, exclude it.
8. Infer the product category and design tone from the image itself.
   For example, beauty, fashion, food, electronics, home goods, maternal/baby, sports, etc.
   Use this to improve hierarchy recognition and later typography matching.

Return JSON only with:
- extractedText
- translatedText`;
}

function buildImagePrompt({
  mode,
  targetLanguage,
  watermarkText,
  extractedText,
  translatedText,
}: {
  mode: ProcessMode;
  targetLanguage: string;
  watermarkText: string;
  extractedText?: string;
  translatedText?: string;
}) {
  const targetWatermark = watermarkText
    ? ` Specifically remove watermark text related to "${watermarkText}".`
    : '';

  if (mode === 'translate_and_remove') {
    return `Edit this image only.
Translate the main visible text into ${targetLanguage} and replace it in place.
Remove watermark text and semi-transparent watermark overlays.${targetWatermark}
Keep the same canvas size, same layout, same background, same decorations, and same non-text elements.
Edit only text and watermark regions.

Original text:
${extractedText ?? ''}

Translated text:
${translatedText ?? ''}

Return only the edited image.`;
  }

  if (mode === 'translate_only') {
    return `Edit this image only.
Translate the main visible text into ${targetLanguage} and replace it in place.
${targetWatermark ? `Also remove watermark text related to "${watermarkText}".\n` : ''}Keep the same canvas size, same layout, same background, same decorations, and same non-text elements.
Edit only text regions.

Original text:
${extractedText ?? ''}

Translated text:
${translatedText ?? ''}

Return only the edited image.`;
  }

  return `You are an expert image editor.
Remove watermarks while preserving all genuine text, objects, and layout.

Instructions:
1. Edit only watermark regions and leave all non-watermark content unchanged.${targetWatermark}
2. Keep the exact canvas size, aspect ratio, composition, icons, illustrations, decorations, text, and background geometry unchanged.
3. Do not erase product titles, labels, prices, descriptions, or other real content.
4. Keep the final image natural and consistent with the source.`;
}

function buildDirectImagePrompt({
  mode,
  targetLanguage,
  watermarkText,
  extractedText,
  translatedText,
}: {
  mode: ProcessMode;
  targetLanguage: string;
  watermarkText: string;
  extractedText?: string;
  translatedText?: string;
}) {
  const targetWatermark = watermarkText
    ? ` Specifically remove watermark text related to "${watermarkText}".`
    : '';
  const textReplacementBlock =
    extractedText && translatedText
      ? `\nOriginal text to replace:\n${extractedText}\n\nTranslated text:\n${translatedText}`
      : '';

  if (mode === 'translate_and_remove') {
    return `Edit this image only.
Translate the main visible text into ${targetLanguage} and replace it in place.
Remove watermark text and semi-transparent watermark overlays.${targetWatermark}
Keep the same canvas size, same layout, same background, same decorations, and same non-text elements.
Edit only text and watermark regions.
Return only the edited image.${textReplacementBlock}`;
  }

  if (mode === 'translate_only') {
    return `Edit this image only.
Translate the main visible text into ${targetLanguage} and replace it in place.
${targetWatermark ? `Also remove watermark text related to "${watermarkText}".\n` : ''}Keep the same canvas size, same layout, same background, same decorations, and same non-text elements.
Edit only text regions.
Return only the edited image.${textReplacementBlock}`;
  }

  return buildImagePrompt({
    mode,
    targetLanguage,
    watermarkText,
  });
}

function buildDirectImagePromptVariants({
  mode,
  targetLanguage,
  watermarkText,
  extractedText,
  translatedText,
}: {
  mode: ProcessMode;
  targetLanguage: string;
  watermarkText: string;
  extractedText?: string;
  translatedText?: string;
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
}: {
  mode: ProcessMode;
  targetLanguage: string;
  watermarkText: string;
  extractedText?: string;
  translatedText?: string;
}) {
  const detailedPrompt = buildImagePrompt({
    mode,
    targetLanguage,
    watermarkText,
    extractedText,
    translatedText,
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

async function generateImageFromPromptVariants({
  settings,
  model,
  base64Data,
  mimeType,
  debugLabel,
  promptVariants,
}: {
  settings: GatewaySettings;
  model: string;
  base64Data: string;
  mimeType: string;
  debugLabel: string;
  promptVariants: Array<{
    label: string;
    text: string;
  }>;
}) {
  return generateImageWithFallbacks({
    settings,
    model,
    debugLabel,
    partVariants: buildImagePartVariants({
      base64Data,
      mimeType,
      promptVariants,
    }),
  });
}

async function callGenerateApi(
  payload: GatewayGenerateRequest,
  signal?: AbortSignal,
) {
  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal,
  });

  const rawText = await response.text();
  let parsed: GatewayGenerateResponse | { error?: { message?: string } } = {};

  if (rawText) {
    try {
      parsed = JSON.parse(rawText) as
        | GatewayGenerateResponse
        | { error?: { message?: string } };
    } catch {
      parsed = {};
    }
  }

  if (!response.ok) {
    const message = 'error' in parsed ? parsed.error?.message : undefined;
    throw new Error(message || rawText || `请求失败 (${response.status})`);
  }

  return parsed as GatewayGenerateResponse;
}

async function callGenerateApiWithTimeout(
  payload: GatewayGenerateRequest,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await callGenerateApi(payload, controller.signal);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`生图请求超时，已超过 ${timeoutMs}ms。`);
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function buildImageGenerationAttempts({
  settings,
  model,
  partVariants,
  debugLabel,
}: {
  settings: GatewaySettings;
  model: string;
  partVariants: Array<{
    label: string;
    parts: GatewayGenerateRequest['parts'];
  }>;
  debugLabel: string;
}) {
  const attempts: Array<{
    label: string;
    payload: GatewayGenerateRequest;
  }> = [];

  for (const partVariant of partVariants) {
    attempts.push({
      label: `${partVariant.label}-object`,
      payload: {
        settings,
        model,
        requestKind: 'image',
        parts: partVariant.parts,
        contentsMode: 'object_parts',
        debugLabel,
        attemptLabel: `${partVariant.label}-object`,
        generationConfig: {
          responseModalities: ['IMAGE'],
        },
      },
    });

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
      },
    });
  }

  return attempts;
}

async function generateImageWithFallbacks({
  settings,
  model,
  partVariants,
  debugLabel,
}: {
  settings: GatewaySettings;
  model: string;
  partVariants: Array<{
    label: string;
    parts: GatewayGenerateRequest['parts'];
  }>;
  debugLabel: string;
}) {
  const attempts = buildImageGenerationAttempts({
    settings,
    model,
    partVariants,
    debugLabel,
  });
  const failureMessages: string[] = [];

  for (const attempt of attempts) {
    try {
      const response = await callGenerateApiWithTimeout(
        attempt.payload,
        settings.imageRequestTimeoutMs,
      );
      const imageUrl = getResponseImage(response);

      if (imageUrl) {
        return imageUrl;
      }

      const textMessage = getResponseText(response);
      failureMessages.push(
        textMessage
          ? `${attempt.label}: 未返回图片，返回了文本 ${textMessage.slice(0, 120)}`
          : `${attempt.label}: 未返回图片数据`,
      );
    } catch (error) {
      const message = getErrorMessage(error);
      failureMessages.push(`${attempt.label}: ${message}`);
    }
  }

  throw new Error(
    `图片生成失败。已自动尝试 ${attempts.length} 种兼容方式。${failureMessages
      .slice(0, 3)
      .join('；')}`,
  );
}

function getOriginalExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex >= 0 ? fileName.slice(dotIndex) : '';
}

function buildUniqueFileName(fileName: string, usedNames: Set<string>) {
  const extension = getOriginalExtension(fileName);
  const baseName = extension ? fileName.slice(0, -extension.length) : fileName;
  let candidate = fileName;
  let counter = 2;

  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${baseName} (${counter})${extension}`;
    counter += 1;
  }

  usedNames.add(candidate.toLowerCase());
  return candidate;
}

async function runWithConcurrencyLimit<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
) {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await tasks[currentIndex]();
    }
  }

  const workerCount = Math.min(Math.max(limit, 1), tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export default function ImageTranslator() {
  const [tasks, setTasks] = useState<ImageTask[]>([]);
  const [targetLanguage, setTargetLanguage] = useState('中文');
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [processMode, setProcessMode] =
    useState<ProcessMode>('translate_only');
  const [watermarkText, setWatermarkText] = useState('');
  const [settings, setSettings] = useState<GatewaySettings>(DEFAULT_SETTINGS);
  const [draftSettings, setDraftSettings] =
    useState<GatewaySettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('idle');
  const [connectionMessage, setConnectionMessage] = useState('');
  const [connectionTestMode, setConnectionTestMode] =
    useState<ConnectionTestMode>('quick');

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);

    if (!raw) {
      return;
    }

    try {
      const stored = JSON.parse(raw) as Partial<GatewaySettings>;
      const inferredAuthMode = inferAuthModeFromApiKey(
        String(stored.apiKey ?? ''),
        (stored.authMode ?? DEFAULT_SETTINGS.authMode) as GatewayAuthMode,
      );
      const migratedSettings = {
        ...stored,
        authMode: inferredAuthMode,
        customAuthHeader: inferCustomAuthHeader(
          inferredAuthMode,
          String(stored.customAuthHeader ?? DEFAULT_SETTINGS.customAuthHeader),
        ),
        imageRequestTimeoutMs:
          LEGACY_DEFAULT_IMAGE_REQUEST_TIMEOUT_VALUES.has(
            stored.imageRequestTimeoutMs ?? -1,
          )
            ? DEFAULT_IMAGE_REQUEST_TIMEOUT_MS
            : stored.imageRequestTimeoutMs ?? DEFAULT_IMAGE_REQUEST_TIMEOUT_MS,
      };
      const mergedSettings = {
        ...DEFAULT_SETTINGS,
        ...migratedSettings,
      };

      setSettings(mergedSettings);
      setDraftSettings(mergedSettings);
    } catch {
      window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const openSettings = () => {
    setDraftSettings(settings);
    setSettingsError(null);
    setConnectionStatus('idle');
    setConnectionMessage('');
    setSettingsOpen(true);
  };

  const closeSettings = () => {
    setSettingsOpen(false);
    setSettingsError(null);
    setConnectionStatus('idle');
    setConnectionMessage('');
  };

  const updateDraftSettings = <K extends keyof GatewaySettings>(
    key: K,
    value: GatewaySettings[K],
  ) => {
    setDraftSettings((current) => ({
      ...current,
      [key]: value,
    }));
    setSettingsError(null);
    setConnectionStatus('idle');
    setConnectionMessage('');
  };

  const handleAuthModeChange = (authMode: GatewayAuthMode) => {
    setDraftSettings((current) => ({
      ...current,
      authMode,
      customAuthHeader:
        authMode === 'x-goog-api-key'
          ? 'x-goog-api-key'
          : authMode === 'bearer'
            ? 'Authorization'
            : authMode === 'query'
              ? 'key'
              : current.customAuthHeader || 'x-api-key',
    }));
    setSettingsError(null);
    setConnectionStatus('idle');
    setConnectionMessage('');
  };

  const addFiles = (files: FileList | File[]) => {
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('image/')) {
        return;
      }

      const reader = new FileReader();
      const id = Math.random().toString(36).slice(2, 10);

      reader.onloadend = () => {
        setTasks((current) => [
          ...current,
          {
            id,
            file,
            preview: reader.result as string,
            status: 'idle',
          },
        ]);
      };

      reader.readAsDataURL(file);
    });

    setGlobalError(null);
  };

  const updateTask = (id: string, updates: Partial<ImageTask>) => {
    setTasks((current) =>
      current.map((task) => (task.id === id ? { ...task, ...updates } : task)),
    );
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      addFiles(event.target.files);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();

    if (event.dataTransfer.files) {
      addFiles(event.dataTransfer.files);
    }
  };

  const removeTask = (id: string) => {
    setTasks((current) => current.filter((task) => task.id !== id));
  };

  const handleSaveSettings = () => {
    try {
      const nextAuthMode = inferAuthModeFromApiKey(
        draftSettings.apiKey,
        draftSettings.authMode,
      );
      const nextSettings = normalizeSettings(
        {
          ...draftSettings,
          authMode: nextAuthMode,
          customAuthHeader: inferCustomAuthHeader(
            nextAuthMode,
            draftSettings.customAuthHeader,
          ),
        },
        {
          requireApiKey: false,
        },
      );

      setSettings(nextSettings);
      setGlobalError(null);
      closeSettings();
    } catch (error) {
      setSettingsError(getErrorMessage(error));
    }
  };

  const testConnection = async (mode: ConnectionTestMode) => {
    try {
      const runtimeSettings = normalizeSettings(draftSettings, {
        requireApiKey: true,
      });

      setConnectionTestMode(mode);
      setConnectionStatus('testing');
      setConnectionMessage(
        mode === 'quick'
          ? '正在快速测试文本模型连接...'
          : '正在完整测试文本模型和生图模型连接...',
      );

      if (mode === 'full') {
        const [textCheck] = await Promise.all([
          callGenerateApi({
            settings: runtimeSettings,
            model: runtimeSettings.textModel,
            requestKind: 'text',
            parts: [{ text: 'Reply with the single word OK.' }],
            debugLabel: 'test-text-full',
          }),
          generateImageWithFallbacks({
            settings: runtimeSettings,
            model: runtimeSettings.imageModel,
            partVariants: [
              {
                label: 'prompt-default',
                parts: [{ text: 'Generate a simple blue square icon.' }],
              },
              {
                label: 'prompt-short',
                parts: [{ text: 'Blue square icon.' }],
              },
            ],
            debugLabel: 'test-image-full',
          }),
        ]);

        if (!getResponseText(textCheck)) {
          throw new Error('文本模型连接成功，但没有返回可读文本。');
        }
      } else {
        const textCheck = await callGenerateApi({
          settings: runtimeSettings,
          model: runtimeSettings.textModel,
          requestKind: 'text',
          parts: [{ text: 'Reply with the single word OK.' }],
          debugLabel: 'test-text-quick',
        });

        if (!getResponseText(textCheck)) {
          throw new Error('文本模型连接成功，但没有返回可读文本。');
        }
      }

      setConnectionStatus('success');
      setConnectionMessage(
        mode === 'quick'
          ? '快速测试通过，文本模型可用。需要时再点“完整测试”检查生图模型。'
          : '完整测试通过，文本模型和生图模型都可用。',
      );
    } catch (error) {
      setConnectionStatus('error');
      setConnectionMessage(getErrorMessage(error));
    }
  };

  const processBatch = async () => {
    const pendingTasks = tasks.filter(
      (task) => task.status === 'idle' || task.status === 'error',
    );

    if (pendingTasks.length === 0) {
      return;
    }

    let runtimeSettings: GatewaySettings;

    try {
      runtimeSettings = normalizeSettings(settings, {
        requireApiKey: true,
      });
    } catch (error) {
      setGlobalError(getErrorMessage(error));
      openSettings();
      return;
    }

    setIsProcessingBatch(true);
    setGlobalError(null);

    const currentMode = processMode;
    const currentTargetLanguage = targetLanguage;
    const currentWatermarkText = watermarkText.trim();

    try {
      await runWithConcurrencyLimit(
        pendingTasks.map((task) => async () => {
          try {
            const base64Data = task.preview.split(',')[1];

            if (!base64Data) {
              throw new Error('图片读取失败，请重新上传后再试。');
            }

            let parsedResult:
              | {
                  extractedText: string;
                  translatedText: string;
                }
              | undefined;

            if (
              currentMode === 'translate_and_remove' ||
              currentMode === 'translate_only'
            ) {
              updateTask(task.id, {
                status: 'extracting',
                error: undefined,
                generatedUrl: undefined,
                result: undefined,
              });

              const textResponse = await callGenerateApi({
                settings: runtimeSettings,
                model: runtimeSettings.textModel,
                requestKind: 'text',
                debugLabel: `ocr-${currentMode}`,
                parts: [
                  {
                    inlineData: {
                      data: base64Data,
                      mimeType: task.file.type,
                    },
                  },
                  {
                    text: buildExtractPrompt(currentTargetLanguage),
                  },
                ],
                generationConfig: {
                  responseMimeType: 'application/json',
                  responseSchema: {
                    type: 'OBJECT',
                    properties: {
                    extractedText: {
                      type: 'STRING',
                      description:
                        'Only the core customer-facing text from the image. Exclude watermarks, unrelated background text, and corrupted OCR fragments. Preserve the main hierarchy with line breaks.',
                    },
                    translatedText: {
                      type: 'STRING',
                      description: `The cleaned core text translated into ${currentTargetLanguage}, preserving the main hierarchy and grouping.`,
                    },
                  },
                    required: ['extractedText', 'translatedText'],
                  },
                },
              });

              const rawText = getResponseText(textResponse);

              if (!rawText) {
                throw new Error('文本模型没有返回可解析的结果。');
              }

              parsedResult = parseStructuredText(rawText);

              if (!parsedResult.translatedText.trim()) {
                throw new Error('没有提取到可翻译的正文文本。');
              }

              updateTask(task.id, {
                result: parsedResult,
                status: 'generating',
              });

              try {
                const structuredGeneratedUrl = await generateImageFromPromptVariants({
                  settings: runtimeSettings,
                  model: runtimeSettings.imageModel,
                  base64Data,
                  mimeType: task.file.type,
                  debugLabel: `image-${currentMode}`,
                  promptVariants: buildStructuredImagePromptVariants({
                    mode: currentMode,
                    targetLanguage: currentTargetLanguage,
                    watermarkText: currentWatermarkText,
                    extractedText: parsedResult.extractedText,
                    translatedText: parsedResult.translatedText,
                  }),
                });

                updateTask(task.id, {
                  generatedUrl: structuredGeneratedUrl,
                  status: 'success',
                });
                return;
              } catch (error) {
                throw new Error(
                  `OCR completed, but image redraw failed: ${getErrorMessage(error)}`,
                );
              }
            } else {
              updateTask(task.id, {
                status: 'generating',
                error: undefined,
                generatedUrl: undefined,
                result: undefined,
              });
            }

            try {
              const generatedUrl = await generateImageFromPromptVariants({
                settings: runtimeSettings,
                model: runtimeSettings.imageModel,
                base64Data,
                mimeType: task.file.type,
                debugLabel:
                  currentMode === 'remove_only'
                    ? `image-${currentMode}`
                    : `image-direct-${currentMode}`,
                promptVariants: buildDirectImagePromptVariants({
                  mode: currentMode,
                  targetLanguage: currentTargetLanguage,
                  watermarkText: currentWatermarkText,
                  extractedText: parsedResult?.extractedText,
                  translatedText: parsedResult?.translatedText,
                }),
              });

              updateTask(task.id, {
                generatedUrl,
                status: 'success',
              });
            } catch (error) {
              throw error;
            }
          } catch (error) {
            updateTask(task.id, {
              status: 'error',
              error: getErrorMessage(error),
            });
          }
        }),
        runtimeSettings.maxParallelTasks,
      );
    } finally {
      setIsProcessingBatch(false);
    }
  };

  const handleDownloadZip = async () => {
    const successTasks = tasks.filter(
      (task) => task.status === 'success' && task.generatedUrl,
    );

    if (successTasks.length === 0) {
      return;
    }

    try {
      const zip = new JSZip();
      const usedNames = new Set<string>();

      for (const task of successTasks) {
        const blob = dataUrlToBlob(task.generatedUrl as string);
        const downloadName = buildUniqueFileName(task.file.name, usedNames);

        zip.file(downloadName, blob);
      }

      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const anchor = document.createElement('a');

      anchor.href = url;
      anchor.download = `processed_images_${Date.now()}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (error) {
      setGlobalError(getErrorMessage(error));
    }
  };

  const handleDownloadSingle = (task: ImageTask) => {
    if (!task.generatedUrl) {
      return;
    }

    const blob = dataUrlToBlob(task.generatedUrl);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = task.file.name;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const pendingCount = tasks.filter(
    (task) => task.status === 'idle' || task.status === 'error',
  ).length;
  const successCount = tasks.filter((task) => task.status === 'success').length;
  const hasApiKey = Boolean(settings.apiKey.trim());
  const needsCustomAuthField =
    draftSettings.authMode === 'custom' || draftSettings.authMode === 'query';
  const selectedAuthModeOption = AUTH_MODE_OPTIONS.find(
    (option) => option.value === draftSettings.authMode,
  );
  const usesWatermarkHint = true;

  return (
    <>
      <div className="min-h-screen bg-neutral-100 text-neutral-900">
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-10">
          <header className="relative mb-8 rounded-[28px] border border-neutral-200 bg-white px-6 py-8 shadow-sm md:px-8">
            <button
              type="button"
              onClick={openSettings}
              className="absolute right-4 top-4 inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-50"
            >
              <Settings className="h-4 w-4" />
              设置
            </button>

            <div className="space-y-4 pr-20">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                <Sparkles className="h-3.5 w-3.5" />
                AI 擦除原文并重绘译文
              </div>
              <div className="space-y-3">
                <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
                  先识别翻译，再用 AI 原位擦除与重绘
                </h1>
                <p className="max-w-3xl text-sm leading-6 text-neutral-600 md:text-base">
                  第一步自动提取原文并翻译，第二步把原图交给 AI 生图模型，擦除原文后在原位置按接近原风格重绘译文。
                  下载结果时会尽量保持原图文件名。
                </p>
              </div>

              <div className="flex flex-wrap gap-3 text-xs text-neutral-600">
                <div className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1.5">
                  文本模型: <span className="font-medium text-neutral-800">{settings.textModel}</span>
                </div>
                <div className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1.5">
                  生图模型: <span className="font-medium text-neutral-800">{settings.imageModel}</span>
                </div>
                <div
                  className={cn(
                    'rounded-full border px-3 py-1.5',
                    hasApiKey
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-amber-200 bg-amber-50 text-amber-700',
                  )}
                >
                  {hasApiKey ? 'API Key 已配置' : '尚未配置 API Key'}
                </div>
              </div>
            </div>
          </header>

          <div className="space-y-8">
            {!hasApiKey && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
                请先点击右上角“设置”填写 API Key 和模型配置，再开始处理图片。
              </div>
            )}

            <section className="rounded-[28px] border border-neutral-200 bg-white p-5 shadow-sm md:p-6">
              <div
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className="rounded-[24px] border-2 border-dashed border-neutral-300 bg-neutral-50 px-6 py-10 text-center transition hover:border-neutral-400 hover:bg-neutral-100"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleFileChange}
                  className="hidden"
                />
                <div className="mx-auto flex max-w-md flex-col items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-neutral-200">
                    <UploadCloud className="h-8 w-8 text-neutral-700" />
                  </div>
                  <div className="space-y-2">
                    <p className="text-base font-medium text-neutral-800">
                      点击上传多张图片，或将图片拖到这里
                    </p>
                    <p className="text-sm text-neutral-500">
                      支持 JPG、PNG、WEBP 等常见格式
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex flex-col gap-4 rounded-[24px] border border-neutral-200 bg-neutral-50 p-4">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex flex-wrap rounded-xl border border-neutral-200 bg-white p-1.5">
                      <button
                        type="button"
                        onClick={() => setProcessMode('translate_and_remove')}
                        disabled={isProcessingBatch}
                        className={cn(
                          'rounded-lg px-3 py-2 text-sm font-medium transition',
                          processMode === 'translate_and_remove'
                            ? 'bg-neutral-900 text-white'
                            : 'text-neutral-600 hover:bg-neutral-100',
                        )}
                      >
                        重绘翻译 + 去水印
                      </button>
                      <button
                        type="button"
                        onClick={() => setProcessMode('translate_only')}
                        disabled={isProcessingBatch}
                        className={cn(
                          'rounded-lg px-3 py-2 text-sm font-medium transition',
                          processMode === 'translate_only'
                            ? 'bg-neutral-900 text-white'
                            : 'text-neutral-600 hover:bg-neutral-100',
                        )}
                      >
                        翻译重绘
                      </button>
                      <button
                        type="button"
                        onClick={() => setProcessMode('remove_only')}
                        disabled={isProcessingBatch}
                        className={cn(
                          'rounded-lg px-3 py-2 text-sm font-medium transition',
                          processMode === 'remove_only'
                            ? 'bg-neutral-900 text-white'
                            : 'text-neutral-600 hover:bg-neutral-100',
                        )}
                      >
                        仅去水印
                      </button>
                    </div>

                    {(processMode === 'translate_and_remove' ||
                      processMode === 'translate_only') && (
                      <label className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-700">
                        <Languages className="h-4 w-4 text-neutral-500" />
                        <span>目标语言</span>
                        <select
                          value={targetLanguage}
                          onChange={(event) => setTargetLanguage(event.target.value)}
                          disabled={isProcessingBatch}
                          className="rounded-lg border border-neutral-200 bg-white px-2 py-1 text-sm outline-none"
                        >
                          {LANGUAGE_OPTIONS.map((language) => (
                            <option key={language} value={language}>
                              {language}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}

                    {usesWatermarkHint && (
                      <label className="flex min-w-[260px] flex-1 items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-700">
                        <Eraser className="h-4 w-4 text-neutral-500" />
                        <span className="whitespace-nowrap">指定水印</span>
                        <input
                          value={watermarkText}
                          onChange={(event) => setWatermarkText(event.target.value)}
                          disabled={isProcessingBatch}
                          placeholder="可选，例如店铺名或平台水印"
                          className="w-full bg-transparent text-sm outline-none placeholder:text-neutral-400"
                        />
                      </label>
                    )}
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row xl:ml-auto">
                    <button
                      type="button"
                      onClick={processBatch}
                      disabled={pendingCount === 0 || isProcessingBatch}
                      className={cn(
                        'inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-medium text-white transition',
                        pendingCount === 0 || isProcessingBatch
                          ? 'cursor-not-allowed bg-neutral-300'
                          : 'bg-neutral-900 shadow-sm hover:bg-neutral-800',
                      )}
                    >
                      {isProcessingBatch ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          处理中...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-4 w-4" />
                          批量处理 ({pendingCount})
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={handleDownloadZip}
                      disabled={successCount === 0 || isProcessingBatch}
                      className={cn(
                        'inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-medium text-white transition',
                        successCount === 0 || isProcessingBatch
                          ? 'cursor-not-allowed bg-neutral-300'
                          : 'bg-blue-600 shadow-sm hover:bg-blue-700',
                      )}
                    >
                      <Archive className="h-4 w-4" />
                      打包下载 ({successCount})
                    </button>
                  </div>
                </div>

                {globalError && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {globalError}
                  </div>
                )}

                {false && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    当前这组 `Bearer + gemini-3.1-flash-image-preview` 已实测支持原位翻译重绘，
                    但去水印类请求仍可能失败。要先验证翻译是否正常，优先用“翻译重绘”。
                  </div>
                )}
              </div>
            </section>

            {tasks.length > 0 && (
              <section className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
                {tasks.map((task) => (
                  <article
                    key={task.id}
                    className="overflow-hidden rounded-[24px] border border-neutral-200 bg-white shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-3 border-b border-neutral-200 bg-neutral-50 px-4 py-3">
                      <div className="truncate text-sm font-medium text-neutral-700" title={task.file.name}>
                        {task.file.name}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeTask(task.id)}
                        disabled={isProcessingBatch}
                        className="rounded-lg p-1 text-neutral-400 transition hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="space-y-4 p-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                            原图
                          </span>
                          <div className="relative aspect-square overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-100">
                            <Image
                              src={task.preview}
                              alt="Original"
                              fill
                              unoptimized
                              className="object-cover"
                            />
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                            结果
                          </span>
                          <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50">
                            {task.generatedUrl ? (
                              <Image
                                src={task.generatedUrl}
                                alt="Generated"
                                fill
                                unoptimized
                                className="object-cover"
                              />
                            ) : (
                              <ImageIcon className="h-8 w-8 text-neutral-300" />
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="border-t border-neutral-100 pt-4">
                        {task.status === 'idle' && (
                          <div className="flex items-center text-sm text-neutral-500">
                            <span className="mr-2 h-2 w-2 rounded-full bg-neutral-300" />
                            等待处理
                          </div>
                        )}

                        {task.status === 'extracting' && (
                          <div className="flex items-center text-sm text-blue-600">
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            正在识别原文并翻译...
                          </div>
                        )}

                        {task.status === 'generating' && (
                          <div className="flex items-center text-sm text-amber-600">
                            <Sparkles className="mr-2 h-4 w-4 animate-pulse" />
                            {processMode === 'remove_only'
                              ? '正在 AI 去水印...'
                              : '正在 AI 擦除原文并重绘译文...'}
                          </div>
                        )}

                        {task.status === 'success' && (
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center text-sm text-emerald-600">
                              <CheckCircle2 className="mr-2 h-4 w-4" />
                              处理完成
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDownloadSingle(task)}
                              className="rounded-lg p-1 text-blue-600 transition hover:bg-blue-50 hover:text-blue-700"
                              title="下载当前图片"
                            >
                              <Download className="h-4 w-4" />
                            </button>
                          </div>
                        )}

                        {task.status === 'error' && (
                          <div className="flex items-center text-sm text-red-600" title={task.error}>
                            <XCircle className="mr-2 h-4 w-4 flex-shrink-0" />
                            <span className="truncate">{task.error}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </section>
            )}
          </div>
        </div>
      </div>

      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 py-8">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-[28px] border border-neutral-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-neutral-200 px-6 py-5">
              <div className="space-y-2">
                <h2 className="text-xl font-semibold text-neutral-900">模型与连接设置</h2>
                <p className="text-sm leading-6 text-neutral-600">
                  支持官方 Gemini 接口，也支持兼容 Gemini generateContent
                  协议的第三方服务。快速测试只检查文本模型，完整测试会连生图模型一起检查。
                  也可以设置最大并发任务数和单次生图超时时间，避免第三方通道卡死。
                </p>
              </div>
              <button
                type="button"
                onClick={closeSettings}
                className="rounded-full p-2 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-5 px-6 py-6">
              <div className="grid gap-5 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="flex items-center gap-2 text-sm font-medium text-neutral-700">
                    <KeyRound className="h-4 w-4 text-neutral-500" />
                    API Key
                  </span>
                  <input
                    type="password"
                    value={draftSettings.apiKey}
                    onChange={(event) =>
                      updateDraftSettings('apiKey', event.target.value)
                    }
                    placeholder="填入你的 API Key"
                    className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm outline-none transition focus:border-neutral-400"
                  />
                </label>

                <label className="space-y-2">
                  <span className="flex items-center gap-2 text-sm font-medium text-neutral-700">
                    <Globe className="h-4 w-4 text-neutral-500" />
                    API Base URL
                  </span>
                  <input
                    value={draftSettings.apiBaseUrl}
                    onChange={(event) =>
                      updateDraftSettings('apiBaseUrl', event.target.value)
                    }
                    placeholder="https://generativelanguage.googleapis.com/v1beta"
                    className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm outline-none transition focus:border-neutral-400"
                  />
                </label>
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-neutral-700">文本模型</span>
                  <input
                    value={draftSettings.textModel}
                    onChange={(event) =>
                      updateDraftSettings('textModel', event.target.value)
                    }
                    placeholder="gemini-2.5-flash"
                    className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm outline-none transition focus:border-neutral-400"
                  />
                </label>

                <label className="space-y-2">
                  <span className="text-sm font-medium text-neutral-700">生图模型</span>
                  <input
                    value={draftSettings.imageModel}
                    onChange={(event) =>
                      updateDraftSettings('imageModel', event.target.value)
                    }
                    placeholder="gemini-2.5-flash-image"
                    className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm outline-none transition focus:border-neutral-400"
                  />
                </label>
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-neutral-700">最大并发任务数</span>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={draftSettings.maxParallelTasks}
                    onChange={(event) =>
                      updateDraftSettings(
                        'maxParallelTasks',
                        Number(event.target.value || 1),
                      )
                    }
                    className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm outline-none transition focus:border-neutral-400"
                  />
                </label>

                <label className="space-y-2">
                  <span className="text-sm font-medium text-neutral-700">生图超时毫秒</span>
                  <input
                    type="number"
                    min={1000}
                    step={1000}
                    value={draftSettings.imageRequestTimeoutMs}
                    onChange={(event) =>
                      updateDraftSettings(
                        'imageRequestTimeoutMs',
                        Number(event.target.value || 1000),
                      )
                    }
                    className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm outline-none transition focus:border-neutral-400"
                  />
                </label>
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-neutral-700">
                    API Key 传递方式
                  </span>
                  <select
                    value={draftSettings.authMode}
                    onChange={(event) =>
                      handleAuthModeChange(event.target.value as GatewayAuthMode)
                    }
                    className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-neutral-400"
                  >
                    {AUTH_MODE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                {needsCustomAuthField ? (
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-neutral-700">
                      {draftSettings.authMode === 'query'
                        ? 'URL 参数名'
                        : '请求头名称'}
                    </span>
                    <input
                      value={draftSettings.customAuthHeader}
                      onChange={(event) =>
                        updateDraftSettings('customAuthHeader', event.target.value)
                      }
                      placeholder={
                        draftSettings.authMode === 'query'
                          ? '例如 key'
                          : '例如 x-api-key'
                      }
                      className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm outline-none transition focus:border-neutral-400"
                    />
                  </label>
                ) : (
                  <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
                    当前方式会自动使用
                    {' '}
                    <span className="font-medium text-neutral-800">
                      {draftSettings.authMode === 'x-goog-api-key'
                        ? 'x-goog-api-key'
                        : 'Authorization: Bearer'}
                    </span>
                    ，不需要额外填写字段名。
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                这里不是账号登录认证，只是在告诉程序“API Key 要放在哪”。
                {' '}
                {selectedAuthModeOption?.hint ?? ''}
              </div>

              <label className="space-y-2">
                <span className="text-sm font-medium text-neutral-700">
                  额外请求头 JSON
                </span>
                <textarea
                  value={draftSettings.extraHeadersText}
                  onChange={(event) =>
                    updateDraftSettings('extraHeadersText', event.target.value)
                  }
                  rows={4}
                  placeholder={'{"x-custom-header":"value"}'}
                  className="w-full rounded-2xl border border-neutral-200 px-3 py-3 text-sm outline-none transition focus:border-neutral-400"
                />
                <p className="text-xs leading-5 text-neutral-500">
                  用于第三方网关附加头，例如租户 ID、代理认证等。格式必须是 JSON 对象。
                </p>
              </label>

              {settingsError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {settingsError}
                </div>
              )}

              {connectionStatus !== 'idle' && (
                <div
                  className={cn(
                    'rounded-xl border px-4 py-3 text-sm',
                    connectionStatus === 'success' &&
                      'border-emerald-200 bg-emerald-50 text-emerald-700',
                    connectionStatus === 'error' &&
                      'border-red-200 bg-red-50 text-red-700',
                    connectionStatus === 'testing' &&
                      'border-blue-200 bg-blue-50 text-blue-700',
                  )}
                >
                  <div className="flex items-center gap-2">
                    {connectionStatus === 'testing' && (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )}
                    {connectionStatus === 'success' && (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    {connectionStatus === 'error' && <XCircle className="h-4 w-4" />}
                    <span>{connectionMessage}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 border-t border-neutral-200 px-6 py-5 sm:flex-row sm:justify-between">
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => testConnection('quick')}
                  disabled={connectionStatus === 'testing'}
                  className={cn(
                    'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-white transition',
                    connectionStatus === 'testing'
                      ? 'cursor-not-allowed bg-neutral-300'
                      : 'bg-neutral-900 hover:bg-neutral-800',
                  )}
                >
                  {connectionStatus === 'testing' &&
                  connectionTestMode === 'quick' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      快速测试中...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      快速测试
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => testConnection('full')}
                  disabled={connectionStatus === 'testing'}
                  className={cn(
                    'inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition',
                    connectionStatus === 'testing'
                      ? 'cursor-not-allowed border-neutral-200 bg-neutral-100 text-neutral-400'
                      : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50',
                  )}
                >
                  {connectionStatus === 'testing' &&
                  connectionTestMode === 'full' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      完整测试中...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      完整测试
                    </>
                  )}
                </button>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={closeSettings}
                  className="rounded-xl border border-neutral-200 px-4 py-2.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleSaveSettings}
                  className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700"
                >
                  保存设置
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
