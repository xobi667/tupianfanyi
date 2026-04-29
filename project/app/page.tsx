'use client';

/* eslint-disable @next/next/no-img-element -- Local data URL previews are faster with native lazy images. */
import {
  useCallback,
  useEffect,
  useMemo,
  memo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import JSZip from 'jszip';
import {
  Archive,
  CheckCircle2,
  Download,
  FolderOpen,
  Globe,
  Image as ImageIcon,
  Languages,
  Loader2,
  PauseCircle,
  Pencil,
  PlayCircle,
  RefreshCw,
  Settings,
  Sparkles,
  Save,
  Trash2,
  UploadCloud,
  X,
  XCircle,
} from 'lucide-react';
import {
  getPrimaryImageRequestTransport,
  normalizeSettings,
  type GatewayGenerateRequest,
  type GatewayGenerateResponse,
  type GatewaySettings,
} from '@/lib/gateway';
import { cn } from '@/lib/utils';

type TaskStatus =
  | 'idle'
  | 'detecting'
  | 'extracting'
  | 'generating'
  | 'retrying'
  | 'paused'
  | 'copied'
  | 'success'
  | 'error';
type ProcessMode = 'translate_and_remove' | 'translate_only' | 'remove_only';
type BatchRunState = 'idle' | 'running' | 'paused' | 'completed';
type ConnectionStatus = 'idle' | 'testing' | 'success' | 'error';
type ConnectionTestMode = 'quick' | 'full';
type OutputAspectRatio =
  | 'original'
  | '1:1'
  | '3:2'
  | '2:3'
  | '4:3'
  | '3:4'
  | '4:5'
  | '16:9'
  | '9:16'
  | '21:9'
  | '5:4'
  | '2:1'
  | '1:2'
  | '3:1'
  | '1:3'
  | '5:7';
type TaskPhase =
  | 'idle'
  | 'detecting'
  | 'direct_image'
  | 'ocr_extract'
  | 'ocr_generate'
  | 'remove_image'
  | 'copied'
  | 'done'
  | 'error';
type UploadMode = 'append' | 'new';

interface PendingUpload {
  files: File[];
  sourceKind: 'file' | 'folder';
}

type TaskErrorKind =
  | 'rate_limit'
  | 'timeout'
  | 'network'
  | 'server'
  | 'compatibility'
  | 'invalid_response'
  | 'client'
  | 'paused'
  | 'unknown';

interface TaskResult {
  hasText?: boolean;
  extractedText: string;
  translatedText?: string;
  detectionError?: string;
}

interface BatchManifestEntry {
  pathKey: string;
  relativePath: string;
  outputRelativePath: string;
  groupLabel: string;
  rootFolder?: string;
}

interface ImageTask {
  id: string;
  file: File;
  preview: string;
  status: TaskStatus;
  phase: TaskPhase;
  pathKey: string;
  relativePath: string;
  outputRelativePath: string;
  groupLabel: string;
  rootFolder?: string;
  sourceKind: 'file' | 'folder';
  sourceFileKey: string;
  historyTaskId?: string;
  historyImageId?: string;
  reprocessMode?: 'translate' | 'redraw';
  wasCopiedWithoutTranslation?: boolean;
  result?: TaskResult;
  generatedUrl?: string;
  error?: string;
  attemptCount: number;
  retryCount: number;
  lastErrorKind?: TaskErrorKind;
  startedAt?: number;
  completedAt?: number;
  lastAttemptAt?: number;
}

interface BatchIntegrityState {
  isComplete: boolean;
  readyCount: number;
  missingPaths: string[];
  duplicateManifestPaths: string[];
  duplicateOutputPaths: string[];
}

interface RemovedTaskRecord {
  task: ImageTask;
  index: number;
}

interface SelectionBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface SelectionRect {
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  element?: HTMLElement;
}

interface TaskGroup {
  groupLabel: string;
  tasks: ImageTask[];
}

interface TaskMenuState {
  taskIds: string[];
  x: number;
  y: number;
}

interface StartConfirmState {
  taskIds?: string[];
  count: number;
  language: string;
  ratio: OutputAspectRatio;
  mode: 'start' | 'continue';
}

interface ReturnHomeConfirmState {
  hasWorkspace: boolean;
}

interface ConfirmDialogState {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  onConfirm: () => Promise<void> | void;
}

interface HistoryPreviewImage {
  id: string;
  name: string;
  dataUrl: string | null;
  kind: 'result' | 'original';
}

interface HistoryImageRecord {
  id: string;
  name: string;
  relativePath: string;
  outputRelativePath: string;
  groupLabel: string;
  status: TaskStatus;
  phase?: TaskPhase;
  pathKey: string;
  sourceKind?: 'file' | 'folder';
  error?: string;
  hasText?: boolean;
  extractedText?: string;
  translatedText?: string;
  retryCount?: number;
  attemptCount?: number;
  startedAt?: number;
  completedAt?: number;
  originalPath?: string;
  resultPath?: string;
  originalDataUrl?: string | null;
  resultDataUrl?: string | null;
}

interface HistoryTaskRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  language: string;
  ratio: string;
  mode: string;
  totalCount: number;
  doneCount: number;
  failCount: number;
  copiedCount: number;
  status: 'idle' | 'running' | 'partial' | 'done' | 'failed';
  storageDirName?: string;
  previewImages?: HistoryPreviewImage[];
  hasMoreImages?: boolean;
  imageOffset?: number;
  imageLimit?: number;
  totalImages?: number;
  images: HistoryImageRecord[];
}

interface ProcessingErrorOptions {
  kind: TaskErrorKind;
  retryable: boolean;
  status?: number;
  requestId?: string;
  details?: string[];
}

class ProcessingError extends Error {
  kind: TaskErrorKind;
  retryable: boolean;
  status?: number;
  requestId?: string;
  details?: string[];

  constructor(message: string, options: ProcessingErrorOptions) {
    super(message);
    this.name = 'ProcessingError';
    this.kind = options.kind;
    this.retryable = options.retryable;
    this.status = options.status;
    this.requestId = options.requestId;
    this.details = options.details;
  }
}

const SETTINGS_STORAGE_KEY = 'image-translator-settings-v2';
const HISTORY_TASK_ID_PREFIX = 'task';
const LEGACY_DEFAULT_IMAGE_REQUEST_TIMEOUT_VALUES = new Set([15000, 60000]);
const DEFAULT_IMAGE_REQUEST_TIMEOUT_MS = 120000;
const GPT_IMAGE_MIN_TIMEOUT_MS = 360000;
const DEFAULT_GEMINI_TEXT_MODEL = 'gemini-3.1-flash-lite-preview';
const DEFAULT_GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-image-preview';
const MAX_STAGE_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [2000, 5000, 10000, 20000];
const MAX_UPLOAD_BATCH_COUNT = 1000;
const MAX_SINGLE_IMAGE_SIZE_BYTES = 60 * 1024 * 1024;
const UPLOAD_READ_CONCURRENCY = 3;
const HISTORY_LIST_PAGE_SIZE = 60;
const HISTORY_DETAIL_PAGE_SIZE = 24;
const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'bmp',
  'gif',
]);
const TRANSIENT_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const ASPECT_RATIO_OPTIONS: Array<{
  value: OutputAspectRatio;
  label: string;
  hint: string;
}> = [
  { value: 'original', label: '原图', hint: '保持原始画布比例' },
  { value: '1:1', label: '1:1', hint: '方图封面' },
  { value: '3:2', label: '3:2', hint: '横版摄影' },
  { value: '2:3', label: '2:3', hint: '竖版海报' },
  { value: '4:3', label: '4:3', hint: '标准横图' },
  { value: '3:4', label: '3:4', hint: '标准竖图' },
  { value: '4:5', label: '4:5', hint: '电商主图' },
  { value: '16:9', label: '16:9', hint: '宽屏横版' },
  { value: '9:16', label: '9:16', hint: '短视频竖版' },
  { value: '21:9', label: '21:9', hint: '超宽横版' },
  { value: '5:4', label: '5:4', hint: '打印/产品图' },
  { value: '2:1', label: '2:1', hint: '横幅海报' },
  { value: '1:2', label: '1:2', hint: '长竖海报' },
  { value: '3:1', label: '3:1', hint: '超横幅' },
  { value: '1:3', label: '1:3', hint: '长竖幅' },
  { value: '5:7', label: '5:7', hint: '竖版卡片' },
];

function getAspectRatioOption(value: OutputAspectRatio) {
  return ASPECT_RATIO_OPTIONS.find((option) => option.value === value) ?? ASPECT_RATIO_OPTIONS[0];
}

function getAspectRatioPreviewStyle(value: OutputAspectRatio) {
  if (value === 'original') {
    return { width: '78px', height: '50px' };
  }

  const [rawWidth, rawHeight] = value.split(':').map(Number);
  const width = Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : 1;
  const height = Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : 1;
  const maxWidth = 86;
  const maxHeight = 86;
  const scale = Math.min(maxWidth / width, maxHeight / height);

  return {
    width: `${Math.max(22, Math.round(width * scale))}px`,
    height: `${Math.max(22, Math.round(height * scale))}px`,
  };
}

const LANGUAGE_OPTIONS = [
  { value: '中文', label: '中文', promptName: 'Simplified Chinese' },
  { value: '英语', label: '英语', promptName: 'English' },
  { value: '日语', label: '日语', promptName: 'Japanese' },
  { value: '韩语', label: '韩语', promptName: 'Korean' },
  { value: '法语', label: '法语', promptName: 'French' },
  { value: '西班牙语', label: '西班牙语', promptName: 'Spanish' },
  { value: '俄语', label: '俄语', promptName: 'Russian' },
  { value: '泰语', label: '泰语', promptName: 'Thai' },
  { value: '印尼语', label: '印尼语', promptName: 'Indonesian' },
] as const;

function getPromptLanguageName(targetLanguage: string) {
  const normalized = targetLanguage.trim();
  const matched = LANGUAGE_OPTIONS.find(
    (language) => language.value === normalized || language.label === normalized,
  );

  return matched?.promptName ?? (normalized || 'English');
}
const DEFAULT_API_BASE_URL = 'https://yunwu.ai/v1';

const DEFAULT_SETTINGS: GatewaySettings = {
  apiBaseUrl: DEFAULT_API_BASE_URL,
  requestHeadersText: '{}',
  requestQueryParamsText: '{}',
  textModel: DEFAULT_GEMINI_TEXT_MODEL,
  imageModel: DEFAULT_GEMINI_IMAGE_MODEL,
  maxParallelTasks: 3,
  imageRequestTimeoutMs: DEFAULT_IMAGE_REQUEST_TIMEOUT_MS,
};

function applyModelRecommendedSettings<T extends Partial<GatewaySettings>>(settings: T) {
  const normalizedImageModel = (settings.imageModel ?? '').trim().toLowerCase();
  const nextSettings: Partial<GatewaySettings> = { ...settings };

  if (
    normalizedImageModel.includes('flash-lite') &&
    !normalizedImageModel.includes('image')
  ) {
    nextSettings.imageModel = DEFAULT_GEMINI_IMAGE_MODEL;
  }

  if ((nextSettings.imageModel ?? '').trim().toLowerCase().startsWith('gpt-image-')) {
    nextSettings.imageRequestTimeoutMs = Math.max(
      settings.imageRequestTimeoutMs ?? DEFAULT_IMAGE_REQUEST_TIMEOUT_MS,
      GPT_IMAGE_MIN_TIMEOUT_MS,
    );
  }

  return nextSettings as T;
}

function getPersistableSettings(settings: GatewaySettings): GatewaySettings {
  return settings;
}

function migrateStoredSettings(stored: Partial<GatewaySettings>) {
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    apiBaseUrl: typeof stored.apiBaseUrl === 'string' && stored.apiBaseUrl.trim()
      ? stored.apiBaseUrl
      : DEFAULT_API_BASE_URL,
    textModel: typeof stored.textModel === 'string' && stored.textModel.trim()
      ? stored.textModel
      : DEFAULT_GEMINI_TEXT_MODEL,
    imageModel: typeof stored.imageModel === 'string' && stored.imageModel.trim()
      ? stored.imageModel
      : DEFAULT_GEMINI_IMAGE_MODEL,
    requestHeadersText:
      typeof stored.requestHeadersText === 'string'
        ? stored.requestHeadersText
        : '{}',
    requestQueryParamsText:
      typeof stored.requestQueryParamsText === 'string'
        ? stored.requestQueryParamsText
        : '{}',
  } satisfies Partial<GatewaySettings>;
}

function getBearerApiKeyFromHeaders(requestHeadersText?: string) {
  if (!requestHeadersText) {
    return '';
  }

  try {
    const headers = JSON.parse(requestHeadersText) as Record<string, unknown>;
    const authorization = headers.Authorization ?? headers.authorization;

    if (typeof authorization !== 'string') {
      return '';
    }

    return authorization.replace(/^Bearer\s+/i, '').trim();
  } catch {
    return '';
  }
}

function applyBearerApiKeyToHeaders(requestHeadersText: string, apiKey: string) {
  let headers: Record<string, string> = {};

  try {
    const parsed = JSON.parse(requestHeadersText || '{}') as Record<string, unknown>;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      headers = Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [key, String(value)]),
      );
    }
  } catch {
    headers = {};
  }

  const trimmedApiKey = apiKey.trim();
  delete headers.authorization;

  if (trimmedApiKey) {
    headers.Authorization = `Bearer ${trimmedApiKey}`;
  } else {
    delete headers.Authorization;
  }

  return Object.keys(headers).length === 0 ? '{}' : JSON.stringify(headers, null, 2);
}

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function normalizeRelativePath(relativePath: string) {
  return relativePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function sanitizePathSegment(value: string) {
  return value.trim().replace(/[<>:"\/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').slice(0, 80) || 'history_project';
}

function getPathKey(relativePath: string) {
  return normalizeRelativePath(relativePath).toLowerCase();
}

function getSourceFileKey(file: File, sourceKind: 'file' | 'folder') {
  const relativePath =
    sourceKind === 'folder' && file.webkitRelativePath
      ? normalizeRelativePath(file.webkitRelativePath)
      : file.name;

  return [
    sourceKind,
    getPathKey(relativePath),
    file.size,
    file.lastModified,
  ].join('|');
}

function getTaskPathInfo(file: File, sourceKind: 'file' | 'folder') {
  const rawRelativePath =
    sourceKind === 'folder' && file.webkitRelativePath
      ? normalizeRelativePath(file.webkitRelativePath)
      : file.name;
  const segments = rawRelativePath.split('/').filter(Boolean);
  const rootFolder = sourceKind === 'folder' && segments.length > 1 ? segments[0] : undefined;
  const relativeSegments = rootFolder ? segments.slice(1) : segments;
  const relativePath = relativeSegments.join('/') || file.name;
  const outputRelativePath = rootFolder ? `${rootFolder}/${relativePath}` : relativePath;
  const groupSegments = outputRelativePath.split('/').slice(0, -1);

  return {
    relativePath: outputRelativePath,
    outputRelativePath,
    rootFolder,
    groupLabel: groupSegments.join('/') || '单独上传',
  };
}

function buildAutoProjectName(tasks: ImageTask[], language: string) {
  const firstFolder = tasks.find((task) => task.rootFolder)?.rootFolder;
  const firstGroup = tasks.find((task) => task.groupLabel !== '单独上传')?.groupLabel;
  const baseName = firstFolder ?? firstGroup ?? (tasks.length > 1 ? '批量图片' : '单图项目');
  const timestamp = new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date()).replace(/[\/:]/g, '-').replace(/\s+/g, ' ');
  return `${baseName} · ${language} · ${timestamp}`;
}

function isSupportedImageFile(file: File) {
  if (file.type.startsWith('image/')) {
    return true;
  }

  const extension = file.name.includes('.')
    ? file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase()
    : '';
  return SUPPORTED_IMAGE_EXTENSIONS.has(extension);
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }

      reject(new Error(`无法读取图片：${file.name}`));
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error(`无法读取图片：${file.name}`));
    };
    reader.readAsDataURL(file);
  });
}

function getOutputPathExtension(mimeType: string) {
  const normalizedMimeType = mimeType.toLowerCase();

  if (normalizedMimeType === 'image/jpeg') {
    return '.jpg';
  }

  if (normalizedMimeType === 'image/png') {
    return '.png';
  }

  if (normalizedMimeType === 'image/webp') {
    return '.webp';
  }

  if (normalizedMimeType === 'image/bmp') {
    return '.bmp';
  }

  return '';
}

function resolveOutputRelativePath(relativePath: string, dataUrl?: string) {
  if (!dataUrl) {
    return relativePath;
  }

  const mimeType = dataUrl.match(/^data:(.*?);base64,/i)?.[1];
  const nextExtension = mimeType ? getOutputPathExtension(mimeType) : '';

  if (!nextExtension) {
    return relativePath;
  }

  const normalizedPath = normalizeRelativePath(relativePath);
  const currentExtension = normalizedPath.includes('.')
    ? normalizedPath.slice(normalizedPath.lastIndexOf('.'))
    : '';

  if (!currentExtension || currentExtension.toLowerCase() === nextExtension) {
    return normalizedPath;
  }

  return `${normalizedPath.slice(0, -currentExtension.length)}${nextExtension}`;
}

function getErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (
    /failed to fetch|load failed|networkerror|fetch failed|network request failed/i.test(message)
  ) {
    return '网络请求失败：请检查本地服务、上游接口地址或网络连接。';
  }
  if (/aborted|aborterror/i.test(message)) {
    return '请求已取消或超时。';
  }
  return message.trim() || '请求失败，请稍后重试。';
}

function getGlobalMessageTone(message: string) {
  return /失败|错误|异常|无效|不能|缺少|不存在|太大|读取失败|保存失败|连接失败|超时|限流/.test(message)
    ? 'error'
    : 'info';
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

function downloadDataUrl(dataUrl: string, fileName: string) {
  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

function createHistoryTaskId() {
  return `${HISTORY_TASK_ID_PREFIX}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function dataUrlToFile(dataUrl: string, fileName: string) {
  const blob = dataUrlToBlob(dataUrl);
  return new File([blob], fileName, { type: blob.type });
}

function getTaskStatusText(status: TaskStatus) {
  if (status === 'idle') return '等待处理';
  if (status === 'detecting') return '正在识别';
  if (status === 'extracting') return '正在翻译';
  if (status === 'generating') return '正在重绘';
  if (status === 'retrying') return '自动重试';
  if (status === 'paused') return '已暂停';
  if (status === 'copied') return '无字已复制';
  if (status === 'success') return '翻译完成';
  return '处理失败';
}

function getHistoryStatusText(status: HistoryTaskRecord['status']) {
  if (status === 'done') return '全部完成';
  if (status === 'running') return '进行中';
  if (status === 'partial') return '部分完成';
  if (status === 'failed') return '全部失败';
  return '待翻译';
}

function getHistoryPreviewImages(task: HistoryTaskRecord) {
  return task.previewImages?.filter((image) => image.dataUrl) ?? [];
}

function mergeHistoryTaskImages(
  currentTask: HistoryTaskRecord | undefined,
  incomingTask: HistoryTaskRecord,
  appendImages: boolean,
) {
  if (!appendImages || !currentTask) return incomingTask;
  const imageMap = new Map(currentTask.images.map((image) => [image.id, image]));
  incomingTask.images.forEach((image) => {
    const existing = imageMap.get(image.id);
    imageMap.set(image.id, existing ? { ...existing, ...image } : image);
  });

  return {
    ...incomingTask,
    previewImages: incomingTask.previewImages?.length ? incomingTask.previewImages : currentTask.previewImages,
    images: Array.from(imageMap.values()),
  };
}

async function postHistory(action: string, payload: Record<string, unknown>) {
  const response = await fetch('/api/history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });

  const parsed = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = parsed?.error?.message ?? `历史记录写入失败 (${response.status})`;
    throw new Error(message);
  }
  return parsed;
}

function parseStructuredText(rawText: string) {
  const cleaned = rawText
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '');

  const parsed = JSON.parse(cleaned) as {
    hasText?: unknown;
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
    hasText:
      typeof parsed.hasText === 'boolean'
        ? parsed.hasText
        : Boolean(parsed.extractedText.trim() || parsed.translatedText.trim()),
    extractedText: parsed.extractedText,
    translatedText: parsed.translatedText,
  };
}

function parseDetectionResult(rawText: string) {
  const cleaned = rawText
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '');

  const parsed = JSON.parse(cleaned) as {
    hasText?: unknown;
  };

  if (typeof parsed.hasText !== 'boolean') {
    throw new Error('文本模型返回了无效的含字判断结果。');
  }

  return parsed.hasText;
}

function buildDetectTextPrompt() {
  return `You are a visual text detector for ecommerce images.
Decide whether the image contains meaningful customer-facing text that should be translated.

Count only real content text such as product titles, selling points, labels, specs, badges, or important notes.
Ignore watermarks, faint repeating overlays, platform marks, scene background text, tiny noise, and broken OCR fragments.

Return JSON only with:
- hasText`;
}

function buildExtractPrompt(targetLanguage: string) {
  const promptLanguage = getPromptLanguageName(targetLanguage);

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
   Detect and understand all languages in the image, then translate the final extracted core text into ${promptLanguage}.
7. Be conservative about uncertain background text.
   If a text fragment looks more like a watermark or unrelated background noise than real product information, exclude it.
8. Infer the product category and design tone from the image itself.
   For example, beauty, fashion, food, electronics, home goods, maternal/baby, sports, etc.
   Use this to improve hierarchy recognition and later typography matching.
9. If the image has no meaningful customer-facing text that needs translation, return hasText as false and leave extractedText and translatedText empty.

Return JSON only with:
- hasText
- extractedText
- translatedText`;
}

function getRetryDelayMs(retryIndex: number) {
  return RETRY_DELAYS_MS[Math.min(retryIndex - 1, RETRY_DELAYS_MS.length - 1)];
}

function waitForDelay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function formatDuration(durationMs: number) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return '0s';
  }

  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function getErrorClassification(
  message: string,
  status?: number,
): Pick<ProcessingErrorOptions, 'kind' | 'retryable'> {
  const lowered = message.toLowerCase();

  if (
    /invalid url|not found|unsupported media type|不安全的远程图片|远程图片 url|私网地址|本地地址|localhost/i.test(
      message,
    )
  ) {
    return {
      kind: 'compatibility',
      retryable: false,
    };
  }

  if (
    /未返回图片|没有返回图片|returned text|可解析的结果|ocr 结果|无效的.*结果|no image|无法解析的(?:图片|响应)格式|不是有效的图片|content-type .*不是图片/i.test(
      message,
    )
  ) {
    return {
      kind: 'invalid_response',
      retryable: false,
    };
  }

  if (typeof status === 'number') {
    if (status === 429) {
      return {
        kind: 'rate_limit',
        retryable: true,
      };
    }

    if (status === 408) {
      return {
        kind: 'timeout',
        retryable: true,
      };
    }

    if (TRANSIENT_STATUS_CODES.has(status)) {
      return {
        kind: 'server',
        retryable: true,
      };
    }

    if (
      status === 404 ||
      status === 405 ||
      status === 415 ||
      /invalid url|not found|unsupported media type/i.test(message)
    ) {
      return {
        kind: 'compatibility',
        retryable: false,
      };
    }

    if (status >= 400 && status < 500) {
      return {
        kind: 'client',
        retryable: false,
      };
    }
  }

  if (/abort|timeout|timed out|超时/i.test(message)) {
    return {
      kind: 'timeout',
      retryable: true,
    };
  }

  if (
    /fetch failed|network|socket hang up|connection reset|econnreset|ecanceled/i.test(
      lowered,
    )
  ) {
    return {
      kind: 'network',
      retryable: true,
    };
  }

  if (
    /未返回图片|没有返回图片|returned text|可解析的结果|ocr 结果|无效的.*结果|no image/i.test(
      message,
    )
  ) {
    return {
      kind: 'invalid_response',
      retryable: false,
    };
  }

  if (/invalid url|not found|unsupported media type/i.test(message)) {
    return {
      kind: 'compatibility',
      retryable: false,
    };
  }

  return {
    kind: 'unknown',
    retryable: false,
  };
}

function toProcessingError(
  error: unknown,
  fallbackMessage = '请求失败，请稍后重试。',
) {
  if (error instanceof ProcessingError) {
    return error;
  }

  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return new ProcessingError('已暂停。', {
        kind: 'paused',
        retryable: false,
      });
    }

    const candidate = error as Error & {
      status?: number;
      requestId?: string;
    };
    const message = candidate.message || fallbackMessage;
    const classification = getErrorClassification(message, candidate.status);

    return new ProcessingError(message, {
      ...classification,
      status: candidate.status,
      requestId: candidate.requestId,
    });
  }

  return new ProcessingError(fallbackMessage, {
    kind: 'unknown',
    retryable: false,
  });
}

function shouldUseOcrFallback(error: ProcessingError) {
  return (
    !error.retryable &&
    (error.kind === 'invalid_response' ||
      error.kind === 'compatibility' ||
      error.kind === 'unknown')
  );
}

function getDefaultImageQueueLimit(settings: GatewaySettings) {
  return Math.max(settings.maxParallelTasks, 1);
}

function createAdaptiveLimiter(initialLimit: number) {
  let activeCount = 0;
  let currentLimit = Math.max(1, initialLimit);
  const queue: Array<() => void> = [];

  const flushQueue = () => {
    while (activeCount < currentLimit && queue.length > 0) {
      const next = queue.shift();

      if (!next) {
        break;
      }

      activeCount += 1;
      next();
    }
  };

  const acquire = () =>
    new Promise<void>((resolve) => {
      if (activeCount < currentLimit) {
        activeCount += 1;
        resolve();
        return;
      }

      queue.push(resolve);
    });

  const release = () => {
    activeCount = Math.max(0, activeCount - 1);
    flushQueue();
  };

  return {
    getLimit() {
      return currentLimit;
    },
    setLimit(nextLimit: number) {
      currentLimit = Math.max(1, nextLimit);
      flushQueue();
    },
    async run<T>(task: () => Promise<T>) {
      await acquire();

      try {
        return await task();
      } finally {
        release();
      }
    },
  };
}

function buildAspectRatioInstruction(outputAspectRatio: OutputAspectRatio) {
  if (outputAspectRatio === 'original') {
    return 'Keep the same canvas size and the same aspect ratio as the source image. Do not crop, trim, cover, or move any important text or product area.';
  }

  return `Adapt the final output to a ${outputAspectRatio} aspect ratio by extending padding/background or recomposing safely. Never hard-crop, trim, cover, or cut off any important text, product edge, logo, or label. Keep all translated text fully visible and preserve the overall layout intent.`;
}

function buildImagePrompt({
  mode,
  targetLanguage,
  watermarkText,
  extractedText,
  translatedText,
  outputAspectRatio,
}: {
  mode: ProcessMode;
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

  if (mode === 'translate_and_remove') {
    return `Edit this image only.
Translate the main visible text into ${promptLanguage} and replace it in place.
Remove watermark text and semi-transparent watermark overlays.${targetWatermark}
${outputSizingInstruction}
Keep the same layout intent, same background, same decorations, and same non-text elements.
Edit only text and watermark regions.

Original text:
${extractedText ?? ''}

Translated text:
${translatedText ?? ''}

Return only the edited image.`;
  }

  if (mode === 'translate_only') {
    return `Edit this image only.
Translate the main visible text into ${promptLanguage} and replace it in place.
${targetWatermark ? `Also remove watermark text related to "${watermarkText}".\n` : ''}${outputSizingInstruction}
Keep the same layout intent, same background, same decorations, and same non-text elements.
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
  mode: ProcessMode;
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
  const textReplacementBlock =
    extractedText && translatedText
      ? `\nOriginal text to replace:\n${extractedText}\n\nTranslated text:\n${translatedText}`
      : '';

  if (mode === 'translate_and_remove') {
    return `Edit this image only.
Translate the main visible text into ${promptLanguage} and replace it in place.
Remove watermark text and semi-transparent watermark overlays.${targetWatermark}
${outputSizingInstruction}
Keep the same layout intent, same background, same decorations, and same non-text elements.
Edit only text and watermark regions.
Return only the edited image.${textReplacementBlock}`;
  }

  if (mode === 'translate_only') {
    return `Edit this image only.
Translate the main visible text into ${promptLanguage} and replace it in place.
${targetWatermark ? `Also remove watermark text related to "${watermarkText}".\n` : ''}${outputSizingInstruction}
Keep the same layout intent, same background, same decorations, and same non-text elements.
Edit only text regions.
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
  mode: ProcessMode;
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
  mode: ProcessMode;
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

async function generateImageFromPromptVariants({
  settings,
  model,
  base64Data,
  mimeType,
  debugLabel,
  promptVariants,
  signal,
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
  signal?: AbortSignal;
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
    signal,
  });
}

async function callGenerateApi(
  payload: GatewayGenerateRequest,
  signal?: AbortSignal,
) {
  let response: Response;

  try {
    response = await fetch('/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    throw toProcessingError(error, '网关请求失败，请稍后重试。');
  }

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
    const finalMessage = message || rawText || `请求失败 (${response.status})`;
    const classification = getErrorClassification(finalMessage, response.status);

    throw new ProcessingError(finalMessage, {
      ...classification,
      status: response.status,
      requestId: response.headers.get('X-Debug-Request-Id') ?? undefined,
    });
  }

  return parsed as GatewayGenerateResponse;
}

async function callGenerateApiWithTimeout(
  payload: GatewayGenerateRequest,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abortFromParent, { once: true });
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

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
      throw new ProcessingError(`生图请求超时，已超过 ${timeoutMs}ms。`, {
        kind: 'timeout',
        retryable: true,
      });
    }

    throw toProcessingError(error, `请求失败，已超过 ${timeoutMs}ms。`);
  } finally {
    signal?.removeEventListener('abort', abortFromParent);
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
  signal?: AbortSignal;
}) {
  const attempts: Array<{
    label: string;
    payload: GatewayGenerateRequest;
  }> = [];
  const primaryTransport = getPrimaryImageRequestTransport(model, settings);

  for (const partVariant of partVariants) {
    const contentsModes =
      primaryTransport === 'generate-content'
        ? (['object_parts', 'role_parts'] as const)
        : (['role_parts'] as const);

    contentsModes.forEach((contentsMode) => {
      const modeLabel = contentsMode === 'object_parts' ? 'object' : 'role';
      attempts.push({
        label: `${partVariant.label}-${modeLabel}`,
        payload: {
          settings,
          model,
          requestKind: 'image',
          parts: partVariant.parts,
          contentsMode,
          debugLabel,
          attemptLabel: `${partVariant.label}-${modeLabel}`,
          generationConfig: {
            responseModalities: ['IMAGE'],
          },
        },
      });
    });
  }

  return attempts;
}

async function generateImageWithFallbacks({
  settings,
  model,
  partVariants,
  debugLabel,
  signal,
}: {
  settings: GatewaySettings;
  model: string;
  partVariants: Array<{
    label: string;
    parts: GatewayGenerateRequest['parts'];
  }>;
  debugLabel: string;
  signal?: AbortSignal;
}) {
  const attempts = buildImageGenerationAttempts({
    settings,
    model,
    partVariants,
    debugLabel,
  });
  const failures: ProcessingError[] = [];
  const failureMessages: string[] = [];

  for (const attempt of attempts) {
    try {
      const response = await callGenerateApiWithTimeout(
        attempt.payload,
        settings.imageRequestTimeoutMs,
        signal,
      );
      const imageUrl = getResponseImage(response);

      if (imageUrl) {
        return imageUrl;
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
    } catch (error) {
      const processingError = toProcessingError(error);
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

  throw new ProcessingError(
    `图片生成失败。已自动尝试 ${attempts.length} 种兼容方式。${failureMessages
      .slice(0, 3)
      .join('；')}`,
    {
      kind: preferredFailure.kind,
      retryable: preferredFailure.retryable,
      status: preferredFailure.status,
      requestId: preferredFailure.requestId,
      details: failureMessages,
    },
  );
}

function getOriginalExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex >= 0 ? fileName.slice(dotIndex) : '';
}

function buildUniqueRelativePath(relativePath: string, usedPaths: Set<string>) {
  const normalizedPath = normalizeRelativePath(relativePath);
  const segments = normalizedPath.split('/');
  const fileName = segments.pop() ?? normalizedPath;
  const extension = getOriginalExtension(fileName);
  const baseName = extension ? fileName.slice(0, -extension.length) : fileName;
  const directoryPath = segments.join('/');
  let candidateFileName = fileName;
  let candidatePath = normalizedPath;
  let counter = 2;

  while (usedPaths.has(candidatePath.toLowerCase())) {
    candidateFileName = `${baseName} (${counter})${extension}`;
    candidatePath = directoryPath
      ? `${directoryPath}/${candidateFileName}`
      : candidateFileName;
    counter += 1;
  }

  usedPaths.add(candidatePath.toLowerCase());
  return candidatePath;
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

interface LocalPreviewImageProps {
  src: string;
  alt: string;
  className?: string;
}

const LocalPreviewImage = memo(function LocalPreviewImage({
  src,
  alt,
  className,
}: LocalPreviewImageProps) {
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable={false}
      className={cn('absolute inset-0 h-full w-full object-contain', className)}
    />
  );
});

function isBlankSelectionSurfaceClick(
  event: MouseEvent<HTMLElement>,
  protectedSelector: string,
) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target || !event.currentTarget.contains(target)) return false;
  return !target.closest(
    `${protectedSelector},button,input,textarea,select,a,[role="menu"],[data-no-clear-selection]`,
  );
}

const FOCUSABLE_DIALOG_SELECTOR = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusableDialogElements(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_DIALOG_SELECTOR))
    .filter((element) => !element.hasAttribute('disabled') && element.getClientRects().length > 0);
}

function trapFocusInDialog(event: globalThis.KeyboardEvent, root: HTMLElement) {
  if (event.key !== 'Tab') return;

  const focusable = getFocusableDialogElements(root);
  if (focusable.length === 0) {
    event.preventDefault();
    root.focus();
    return;
  }

  const firstElement = focusable[0];
  const lastElement = focusable[focusable.length - 1];
  const activeElement = document.activeElement;

  if (event.shiftKey && activeElement === firstElement) {
    event.preventDefault();
    lastElement.focus();
    return;
  }

  if (!event.shiftKey && activeElement === lastElement) {
    event.preventDefault();
    firstElement.focus();
  }
}

interface TaskCardProps {
  task: ImageTask;
  selected: boolean;
  isProcessingBatch: boolean;
  cardSizeClass: string;
  onToggle: (taskId: string, event: MouseEvent<HTMLElement>) => void;
  onOpenMenu: (event: MouseEvent, taskId: string) => void;
  onOpenKeyboardMenu: (taskId: string, element: HTMLElement) => void;
  onRemove: (taskId: string) => void;
  onDownload: (task: ImageTask) => void;
}

const TaskCard = memo(function TaskCard({
  task,
  selected,
  isProcessingBatch,
  cardSizeClass,
  onToggle,
  onOpenMenu,
  onOpenKeyboardMenu,
  onRemove,
  onDownload,
}: TaskCardProps) {
  return (
    <article
      data-task-id={task.id}
      data-task-card
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={(event) => onToggle(task.id, event)}
      onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onToggle(task.id, event as unknown as MouseEvent<HTMLElement>);
        }
        if (event.key === 'F10' && event.shiftKey) {
          event.preventDefault();
          onOpenKeyboardMenu(task.id, event.currentTarget);
        }
      }}
      onContextMenu={(event) => onOpenMenu(event, task.id)}
      className={cn(
        'ui-task-card overflow-hidden rounded-[20px] border border-white/10 transition-[border-color,box-shadow,background-color] duration-200 hover:border-emerald-400/35 hover:shadow-[0_10px_36px_rgba(0,0,0,0.55)]',
        cardSizeClass,
        selected && 'ui-task-card-selected',
      )}
    >
      <div className="flex h-10 items-center gap-2 border-b border-white/10 px-3">
        <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] transition', selected ? 'border-emerald-300 bg-emerald-400 text-black' : 'border-white/15 bg-white/[0.03] text-transparent')}>✓</span>
        <div className="min-w-0 flex-1 truncate text-[11px] text-white/58" title={task.relativePath}>{task.file.name}</div>
        <button type="button" aria-label={`从工作台移除 ${task.file.name}`} title="从工作台移除" onClick={(event) => { event.stopPropagation(); onRemove(task.id); }} disabled={isProcessingBatch} className="flex min-h-9 min-w-9 items-center justify-center rounded-lg text-white/28 transition hover:bg-red-500/10 hover:text-red-300 disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>

      <div className="grid grid-cols-2 gap-1 bg-black/70 p-1">
        <div className="ui-preview-pane relative flex aspect-square min-h-0 items-center justify-center overflow-hidden rounded-xl">
          <span className="absolute left-2 top-2 z-10 rounded bg-black/65 px-1.5 py-0.5 text-[9px] text-white/55">原图</span>
          <LocalPreviewImage src={task.preview} alt="Original" className="p-3" />
        </div>
        <div className="ui-preview-pane ui-preview-result relative flex aspect-square min-h-0 items-center justify-center overflow-hidden rounded-xl">
          <span className="absolute left-2 top-2 z-10 rounded bg-emerald-600/85 px-1.5 py-0.5 text-[9px] text-white">结果</span>
          {task.generatedUrl ? <LocalPreviewImage src={task.generatedUrl} alt="Generated" className="p-3" /> : task.status === 'generating' || task.status === 'extracting' || task.status === 'detecting' ? <Loader2 className="h-5 w-5 animate-spin text-emerald-300" /> : <ImageIcon className="h-6 w-6 text-white/14" />}
        </div>
      </div>

      <div className="px-2.5 py-2">
        {task.result?.extractedText && <div className="mb-2 truncate rounded-lg border border-white/8 bg-white/[0.03] px-2 py-1.5 text-[10px] text-white/38">识别：{task.result.extractedText.slice(0, 96)}{task.result.extractedText.length > 96 ? '...' : ''}</div>}
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1 truncate text-[11px]">
            {task.status === 'idle' && <span className="text-white/28">等待处理</span>}
            {task.status === 'detecting' && <span className="text-emerald-200">正在识别是否有字...</span>}
            {task.status === 'retrying' && <span className="text-amber-300" title={task.error}>{task.error ?? '正在等待自动重试...'}</span>}
            {task.status === 'paused' && <span className="text-amber-200">已暂停</span>}
            {task.status === 'extracting' && <span className="text-emerald-200">正在提取原文并翻译...</span>}
            {task.status === 'generating' && <span className="text-emerald-200">正在 AI 翻译重绘...</span>}
            {task.status === 'copied' && <span className="text-sky-300">无字图片，已复制</span>}
            {task.status === 'success' && <span className="text-emerald-300">翻译完成</span>}
            {task.status === 'error' && <span className="text-red-300" title={task.error}>{task.error}{task.retryCount > 0 ? ` / 已重试 ${task.retryCount} 次` : ''}</span>}
          </div>
          <button type="button" onClick={(event) => { event.stopPropagation(); onOpenMenu(event, task.id); }} className="min-h-8 rounded-lg border border-white/10 px-3 py-1 text-[11px] text-white/48 transition hover:bg-white/[0.06] hover:text-white/75">操作</button>
          {(task.status === 'success' || task.status === 'copied') && <button type="button" aria-label={`下载 ${task.file.name} 的结果图`} onClick={(event) => { event.stopPropagation(); onDownload(task); }} className="flex min-h-9 min-w-9 items-center justify-center rounded-lg text-emerald-200 transition hover:bg-emerald-500/10 hover:text-white" title="下载当前图片"><Download className="h-3.5 w-3.5" /></button>}
        </div>
      </div>
    </article>
  );
}, (previous, next) =>
  previous.task === next.task &&
  previous.selected === next.selected &&
  previous.isProcessingBatch === next.isProcessingBatch &&
  previous.cardSizeClass === next.cardSizeClass
);

interface TaskGroupsViewProps {
  groupedTasks: TaskGroup[];
  selectedTaskIds: Set<string>;
  isProcessingBatch: boolean;
  canvasGridClass: string;
  cardSizeClass: string;
  onToggle: (taskId: string, event: MouseEvent<HTMLElement>) => void;
  onOpenMenu: (event: MouseEvent, taskId: string) => void;
  onOpenKeyboardMenu: (taskId: string, element: HTMLElement) => void;
  onRemove: (taskId: string) => void;
  onDownload: (task: ImageTask) => void;
}

const TaskGroupsView = memo(function TaskGroupsView({
  groupedTasks,
  selectedTaskIds,
  isProcessingBatch,
  canvasGridClass,
  cardSizeClass,
  onToggle,
  onOpenMenu,
  onOpenKeyboardMenu,
  onRemove,
  onDownload,
}: TaskGroupsViewProps) {
  return (
    <>
      {groupedTasks.map((group) => (
        <div key={group.groupLabel} className="space-y-2">
          {groupedTasks.length > 1 && <div className="flex items-center justify-between gap-3 px-1">
            <h2 className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1 text-xs font-medium text-white/70">{group.groupLabel} · {group.tasks.length}</h2>
          </div>}

          <div className={canvasGridClass}>
            {group.tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                selected={selectedTaskIds.has(task.id)}
                isProcessingBatch={isProcessingBatch}
                cardSizeClass={cardSizeClass}
                onToggle={onToggle}
                onOpenMenu={onOpenMenu}
                onOpenKeyboardMenu={onOpenKeyboardMenu}
                onRemove={onRemove}
                onDownload={onDownload}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}, (previous, next) =>
  previous.groupedTasks === next.groupedTasks &&
  previous.selectedTaskIds === next.selectedTaskIds &&
  previous.isProcessingBatch === next.isProcessingBatch &&
  previous.canvasGridClass === next.canvasGridClass &&
  previous.cardSizeClass === next.cardSizeClass
);

export default function ImageTranslator() {
  const [tasks, setTasks] = useState<ImageTask[]>([]);
  const [targetLanguage, setTargetLanguage] = useState('中文');
  const [outputAspectRatio, setOutputAspectRatio] =
    useState<OutputAspectRatio>('original');
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const [batchRunState, setBatchRunState] = useState<BatchRunState>('idle');
  const [globalError, setGlobalError] = useState<string | null>(null);
  const processMode = 'translate_only' as ProcessMode;
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
  const [skippedDuplicateCount, setSkippedDuplicateCount] = useState(0);
  const [batchStartedAt, setBatchStartedAt] = useState<number | null>(null);
  const [batchCompletedAt, setBatchCompletedAt] = useState<number | null>(null);
  const [imageQueueLimit, setImageQueueLimit] = useState<number | null>(null);
  const [nowTimestamp, setNowTimestamp] = useState(() => Date.now());
  const [activeHistoryTaskId, setActiveHistoryTaskId] = useState<string | null>(null);
  const [historyTasks, setHistoryTasks] = useState<HistoryTaskRecord[]>([]);
  const [historyListCursor, setHistoryListCursor] = useState<number | null>(null);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyTotalCount, setHistoryTotalCount] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLogs, setHistoryLogs] = useState('');
  const [selectedHistoryLogs, setSelectedHistoryLogs] = useState('');
  const [resourceDir, setResourceDir] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedHistoryTaskId, setSelectedHistoryTaskId] = useState<string | null>(null);
  const [selectedHistoryTaskIds, setSelectedHistoryTaskIds] = useState<Set<string>>(() => new Set());
  const [historyMenu, setHistoryMenu] = useState<TaskMenuState | null>(null);
  const [historyDetailTaskIds, setHistoryDetailTaskIds] = useState<Set<string>>(() => new Set());
  const [historyDetailHasMore, setHistoryDetailHasMore] = useState(false);
  const [historyDetailLoadingMore, setHistoryDetailLoadingMore] = useState(false);
  const [activeProjectName, setActiveProjectName] = useState('');
  const [draftProjectName, setDraftProjectName] = useState('');
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const [startConfirm, setStartConfirm] = useState<StartConfirmState | null>(null);
  const [returnHomeConfirm, setReturnHomeConfirm] = useState<ReturnHomeConfirmState | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [mobileConsoleOpen, setMobileConsoleOpen] = useState(false);
  const [desktopConsoleOpen, setDesktopConsoleOpen] = useState(false);
  const [taskMenu, setTaskMenu] = useState<TaskMenuState | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(() => new Set());
  const [undoStack, setUndoStack] = useState<RemovedTaskRecord[][]>([]);
  const [softDeletedTasks, setSoftDeletedTasks] = useState<RemovedTaskRecord[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const workbenchRef = useRef<HTMLElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const settingsDialogRef = useRef<HTMLFormElement>(null);
  const confirmDialogRef = useRef<HTMLDivElement>(null);
  const startConfirmDialogRef = useRef<HTMLDivElement>(null);
  const returnHomeDialogRef = useRef<HTMLDivElement>(null);
  const pendingUploadDialogRef = useRef<HTMLDivElement>(null);
  const historyDialogRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLElement>(null);
  const historyGalleryRef = useRef<HTMLElement>(null);
  const selectionOverlayRef = useRef<HTMLDivElement>(null);
  const tasksRef = useRef<ImageTask[]>([]);
  const taskRenderFrameRef = useRef<number | null>(null);
  const selectedTaskIdsRef = useRef<Set<string>>(new Set());
  const selectedHistoryTaskIdsRef = useRef<Set<string>>(new Set());
  const softDeletedTasksRef = useRef<RemovedTaskRecord[]>([]);
  const activeTaskControllersRef = useRef<Map<string, AbortController>>(new Map());
  const historyRefreshTimerRef = useRef<number | null>(null);
  const historyRefreshPromiseRef = useRef<Promise<HistoryTaskRecord[]> | null>(null);
  const historyRefreshAgainRef = useRef(false);
  const consoleCloseTimerRef = useRef<number | null>(null);
  const selectionDragRef = useRef<{ startX: number; startY: number; additive: boolean; isSelecting: boolean } | null>(null);
  const taskSelectionRectsRef = useRef<SelectionRect[]>([]);
  const taskSelectionElementMapRef = useRef<Map<string, HTMLElement>>(new Map());
  const taskSelectionBaseIdsRef = useRef<Set<string>>(new Set());
  const taskSelectionLiveIdsRef = useRef<Set<string> | null>(null);
  const taskSelectionFrameRef = useRef<number | null>(null);
  const taskSelectionPointRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const historySelectionDragRef = useRef<{ startX: number; startY: number; additive: boolean; isSelecting: boolean } | null>(null);
  const historySelectionRectsRef = useRef<SelectionRect[]>([]);
  const historySelectionElementMapRef = useRef<Map<string, HTMLElement>>(new Map());
  const historySelectionBaseIdsRef = useRef<Set<string>>(new Set());
  const historySelectionLiveIdsRef = useRef<Set<string> | null>(null);
  const historySelectionFrameRef = useRef<number | null>(null);
  const historySelectionPointRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const selectionSuppressClickRef = useRef(false);

  const scheduleTasksRender = useCallback(() => {
    if (taskRenderFrameRef.current !== null) return;
    taskRenderFrameRef.current = window.requestAnimationFrame(() => {
      taskRenderFrameRef.current = null;
      setTasks(tasksRef.current);
    });
  }, []);

  const closeConfirmDialog = useCallback(() => {
    if (isConfirming) return;
    setConfirmDialog(null);
  }, [isConfirming]);

  const openConfirmDialog = useCallback((dialog: ConfirmDialogState) => {
    setHistoryMenu(null);
    setTaskMenu(null);
    setConfirmDialog(dialog);
  }, []);

  const runConfirmDialogAction = useCallback(async () => {
    if (!confirmDialog || isConfirming) return;
    setIsConfirming(true);
    try {
      await confirmDialog.onConfirm();
      setConfirmDialog(null);
    } catch (error) {
      setGlobalError(getErrorMessage(error));
    } finally {
      setIsConfirming(false);
    }
  }, [confirmDialog, isConfirming]);

  const clearConsoleCloseTimer = useCallback(() => {
    if (consoleCloseTimerRef.current === null) return;
    window.clearTimeout(consoleCloseTimerRef.current);
    consoleCloseTimerRef.current = null;
  }, []);

  const openDesktopConsole = useCallback(() => {
    if (window.matchMedia('(max-width: 1279px)').matches) return;
    clearConsoleCloseTimer();
    setDesktopConsoleOpen(true);
  }, [clearConsoleCloseTimer]);

  const closeDesktopConsole = useCallback(() => {
    clearConsoleCloseTimer();
    setDesktopConsoleOpen(false);
  }, [clearConsoleCloseTimer]);

  const scheduleDesktopConsoleClose = useCallback(() => {
    clearConsoleCloseTimer();
    consoleCloseTimerRef.current = window.setTimeout(() => {
      setDesktopConsoleOpen(false);
      consoleCloseTimerRef.current = null;
    }, 25);
  }, [clearConsoleCloseTimer]);

  useEffect(() => () => clearConsoleCloseTimer(), [clearConsoleCloseTimer]);

  useEffect(() => () => {
    if (taskRenderFrameRef.current !== null) {
      window.cancelAnimationFrame(taskRenderFrameRef.current);
      taskRenderFrameRef.current = null;
    }
  }, []);

  useEffect(() => {
    const handleResize = () => {
      if (window.matchMedia('(max-width: 1279px)').matches) {
        setDesktopConsoleOpen(false);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);

    if (!raw) {
      return;
    }

    try {
      const stored = JSON.parse(raw) as Partial<GatewaySettings>;
      const migratedSettings = {
        ...migrateStoredSettings(stored),
        imageRequestTimeoutMs:
          LEGACY_DEFAULT_IMAGE_REQUEST_TIMEOUT_VALUES.has(
            stored.imageRequestTimeoutMs ?? -1,
          )
            ? DEFAULT_IMAGE_REQUEST_TIMEOUT_MS
            : stored.imageRequestTimeoutMs ?? DEFAULT_IMAGE_REQUEST_TIMEOUT_MS,
      };
      const mergedSettings = normalizeSettings(
        applyModelRecommendedSettings(migratedSettings),
        {
          requireApiKey: false,
        },
      );

      setSettings(mergedSettings);
      setDraftSettings(mergedSettings);
    } catch {
      window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(getPersistableSettings(settings)));
    } catch {
      setGlobalError('本机浏览器设置保存失败，可能是存储空间已满或隐私模式限制。');
    }
  }, [settings]);

  useEffect(() => {
    if (!batchStartedAt || batchCompletedAt) {
      return;
    }

    const timer = window.setInterval(() => {
      setNowTimestamp(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [batchCompletedAt, batchStartedAt]);

  useEffect(() => {
    if (!globalError) return;

    const tone = getGlobalMessageTone(globalError);
    const timer = window.setTimeout(() => {
      setGlobalError((current) => current === globalError ? null : current);
    }, tone === 'error' ? 6500 : 2800);

    return () => window.clearTimeout(timer);
  }, [globalError]);

  useEffect(() => {
    if (tasks.length > 0) {
      return;
    }

    setBatchStartedAt(null);
    setBatchCompletedAt(null);
    setBatchRunState('idle');
    setImageQueueLimit(null);
    setSkippedDuplicateCount(0);
    setActiveHistoryTaskId(null);
    setActiveProjectName('');
    setDraftProjectName('');
    setIsEditingProjectName(false);
    setHistoryLogs('');
    setMobileConsoleOpen(false);
  }, [tasks.length]);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    selectedTaskIdsRef.current = selectedTaskIds;
  }, [selectedTaskIds]);

  useEffect(() => {
    selectedHistoryTaskIdsRef.current = selectedHistoryTaskIds;
  }, [selectedHistoryTaskIds]);

  useEffect(() => {
    if (selectedHistoryTaskIdsRef.current.size === 0) return;
    setSelectedHistoryTaskIds((current) => {
      const historyIds = new Set(historyTasks.map((task) => task.id));
      const next = new Set([...current].filter((id) => historyIds.has(id)));
      if (next.size === current.size && [...next].every((id) => current.has(id))) {
        return current;
      }
      selectedHistoryTaskIdsRef.current = next;
      return next;
    });
  }, [historyTasks]);

  useEffect(() => {
    softDeletedTasksRef.current = softDeletedTasks;
  }, [softDeletedTasks]);

  useEffect(() => {
    if (selectedTaskIdsRef.current.size === 0) return;
    setSelectedTaskIds((current) => {
      const taskIds = new Set(tasks.map((task) => task.id));
      const next = new Set([...current].filter((id) => taskIds.has(id)));
      if (next.size === current.size && [...next].every((id) => current.has(id))) {
        return current;
      }
      selectedTaskIdsRef.current = next;
      return next;
    });
  }, [tasks]);

  useEffect(() => {
    if (!taskMenu) return;
    const closeMenu = () => setTaskMenu(null);
    window.addEventListener('click', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, [taskMenu]);

  useEffect(() => {
    if (!historyMenu) return;
    const closeMenu = () => setHistoryMenu(null);
    window.addEventListener('click', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, [historyMenu]);

  useEffect(() => {
    const dialogElement =
      confirmDialogRef.current ??
      startConfirmDialogRef.current ??
      returnHomeDialogRef.current ??
      pendingUploadDialogRef.current;

    if (!dialogElement) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    window.setTimeout(() => {
      const focusTarget = dialogElement.querySelector<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      );
      focusTarget?.focus();
    }, 0);

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      trapFocusInDialog(event, dialogElement);
      if (event.key === 'Escape') {
        event.preventDefault();
        if (confirmDialog) closeConfirmDialog();
        else if (startConfirm) setStartConfirm(null);
        else if (returnHomeConfirm) setReturnHomeConfirm(null);
        else if (pendingUpload) setPendingUpload(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused?.isConnected) {
        window.setTimeout(() => previouslyFocused.focus(), 0);
      }
    };
  }, [closeConfirmDialog, confirmDialog, pendingUpload, returnHomeConfirm, startConfirm]);

  useEffect(() => {
    if (!historyOpen) return;

    setDesktopConsoleOpen(false);
    setMobileConsoleOpen(false);
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    window.setTimeout(() => {
      const focusTarget = historyDialogRef.current?.querySelector<HTMLElement>('button:not(:disabled)');
      focusTarget?.focus();
    }, 0);

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (historyDialogRef.current) {
        trapFocusInDialog(event, historyDialogRef.current);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused?.isConnected) {
        window.setTimeout(() => previouslyFocused.focus(), 0);
      }
    };
  }, [historyOpen]);

  useEffect(() => {
    if (!historyOpen) return;

    const canvasElement = canvasRef.current;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousCanvasOverflow = canvasElement?.style.overflow;

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    if (canvasElement) {
      canvasElement.style.overflow = 'hidden';
    }

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      if (canvasElement && previousCanvasOverflow !== undefined) {
        canvasElement.style.overflow = previousCanvasOverflow;
      }
    };
  }, [historyOpen]);

  useEffect(() => {
    if (!settingsOpen && !confirmDialog && !startConfirm && !returnHomeConfirm && !pendingUpload) return;
    setDesktopConsoleOpen(false);
  }, [confirmDialog, pendingUpload, returnHomeConfirm, settingsOpen, startConfirm]);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      const element = target instanceof HTMLElement ? target : null;
      return Boolean(element?.closest('input, textarea, select, [contenteditable="true"]'));
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (settingsOpen || confirmDialog || startConfirm || returnHomeConfirm || pendingUpload || isEditableTarget(event.target)) return;

      if (event.key === 'Escape' && desktopConsoleOpen) {
        event.preventDefault();
        closeDesktopConsole();
        return;
      }

      if (historyOpen) {
        if (event.key === 'Escape') {
          event.preventDefault();
          hideSelectionOverlay();
          if (historyMenu) setHistoryMenu(null);
          else if (selectedHistoryTaskId) setSelectedHistoryTaskId(null);
          else if (selectedHistoryTaskIdsRef.current.size > 0) {
            selectedHistoryTaskIdsRef.current = new Set();
            setSelectedHistoryTaskIds(selectedHistoryTaskIdsRef.current);
          }
          else setHistoryOpen(false);
          return;
        }
        if (!selectedHistoryTaskId && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
          event.preventDefault();
          selectedHistoryTaskIdsRef.current = new Set(historyTasks.map((task) => task.id));
          setSelectedHistoryTaskIds(selectedHistoryTaskIdsRef.current);
          return;
        }
        if (!selectedHistoryTaskId && (event.key === 'Delete' || event.key === 'Backspace')) {
          const selectedIds = [...selectedHistoryTaskIdsRef.current];
          if (selectedIds.length > 0) {
            event.preventDefault();
            requestDeleteHistoryTasks(selectedIds);
          }
          return;
        }
        if (!selectedHistoryTaskId && event.key.toLowerCase() === 'd') {
          const selectedIds = [...selectedHistoryTaskIdsRef.current];
          if (selectedIds.length > 0) {
            event.preventDefault();
            void downloadHistoryTasks(selectedIds);
          }
        }
        return;
      }

      if (event.key === 'Escape') {
        setTaskMenu(null);
        hideSelectionOverlay();
        setSelectedTaskIdsIfChanged(new Set());
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        setSelectedTaskIdsIfChanged(new Set(tasksRef.current.map((task) => task.id)));
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undoLastSoftDelete();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        const selectedIds = [...selectedTaskIdsRef.current];
        if (selectedIds.length > 0 && !isProcessingBatch) {
          event.preventDefault();
          softRemoveTasks(selectedIds);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeDesktopConsole, confirmDialog, desktopConsoleOpen, historyMenu, historyOpen, historyTasks, isProcessingBatch, pendingUpload, returnHomeConfirm, selectedHistoryTaskId, settingsOpen, startConfirm]);

  const refreshHistory = async () => {
    if (historyRefreshPromiseRef.current) {
      historyRefreshAgainRef.current = true;
      return historyRefreshPromiseRef.current;
    }

    const refreshPromise = (async () => {
    try {
      const response = await fetch(`/api/history?preview=1&limit=${HISTORY_LIST_PAGE_SIZE}`);
      const parsed = await response.json();
      if (!response.ok) {
        throw new Error(parsed?.error?.message ?? '历史记录读取失败。');
      }
      const nextTasks = parsed.tasks ?? [];
      setHistoryTasks((current) => {
        const currentById = new Map(current.map((task) => [task.id, task]));
        return (nextTasks as HistoryTaskRecord[]).map((task) => {
          const existing = currentById.get(task.id);
          if (!existing) return task;
          return {
            ...task,
            previewImages: task.previewImages?.length ? task.previewImages : existing.previewImages,
            images: task.images.map((image) => {
              const existingImage = existing.images.find((item) => item.id === image.id);
              return existingImage?.originalDataUrl !== undefined || existingImage?.resultDataUrl !== undefined
                ? { ...image, originalDataUrl: existingImage.originalDataUrl, resultDataUrl: existingImage.resultDataUrl }
                : image;
            }),
          };
        });
      });
      setSelectedHistoryTaskId((current) => current && nextTasks.some((task: HistoryTaskRecord) => task.id === current) ? current : null);
      setResourceDir(parsed.resourceDir ?? '');
      setHistoryListCursor(typeof parsed.nextCursor === 'number' ? parsed.nextCursor : null);
      setHistoryHasMore(Boolean(parsed.hasMore));
      setHistoryTotalCount(Number(parsed.totalCount ?? nextTasks.length));
      return nextTasks as HistoryTaskRecord[];
    } catch (error) {
      setGlobalError(getErrorMessage(error));
      return [] as HistoryTaskRecord[];
    } finally {
      historyRefreshPromiseRef.current = null;
      if (historyRefreshAgainRef.current) {
        historyRefreshAgainRef.current = false;
        window.setTimeout(() => {
          void refreshHistory();
        }, 120);
      }
    }
    })();

    historyRefreshPromiseRef.current = refreshPromise;
    return refreshPromise;
  };

  const loadMoreHistoryTasks = async () => {
    if (!historyHasMore || historyListCursor === null || historyLoading) return;
    setHistoryLoading(true);
    try {
      const response = await fetch(`/api/history?preview=1&limit=${HISTORY_LIST_PAGE_SIZE}&cursor=${historyListCursor}`);
      const parsed = await response.json();
      if (!response.ok) throw new Error(parsed?.error?.message ?? '历史记录读取失败。');
      const nextTasks = (parsed.tasks ?? []) as HistoryTaskRecord[];
      setHistoryTasks((current) => {
        const merged = new Map(current.map((task) => [task.id, task]));
        nextTasks.forEach((task) => {
          const existing = merged.get(task.id);
          merged.set(task.id, existing ? { ...task, previewImages: task.previewImages?.length ? task.previewImages : existing.previewImages } : task);
        });
        return Array.from(merged.values()).sort((a, b) => b.updatedAt - a.updatedAt);
      });
      setHistoryListCursor(typeof parsed.nextCursor === 'number' ? parsed.nextCursor : null);
      setHistoryHasMore(Boolean(parsed.hasMore));
      setHistoryTotalCount(Number(parsed.totalCount ?? historyTotalCount));
      setResourceDir(parsed.resourceDir ?? resourceDir);
    } catch (error) {
      setGlobalError(getErrorMessage(error));
    } finally {
      setHistoryLoading(false);
    }
  };

  const scheduleHistoryRefresh = (delayMs = 900) => {
    if (historyRefreshTimerRef.current !== null) {
      window.clearTimeout(historyRefreshTimerRef.current);
    }

    historyRefreshTimerRef.current = window.setTimeout(() => {
      historyRefreshTimerRef.current = null;
      void refreshHistory();
    }, delayMs);
  };

  useEffect(() => {
    void refreshHistory();
    return () => {
      if (historyRefreshTimerRef.current !== null) {
        window.clearTimeout(historyRefreshTimerRef.current);
      }
    };
  }, []);

  const buildHistoryTaskPayload = (historyTaskId: string, allTasks: ImageTask[], nameOverride?: string) => ({
    id: historyTaskId,
    name: nameOverride?.trim() || activeProjectName.trim() || buildAutoProjectName(allTasks, targetLanguage),
    language: targetLanguage,
    ratio: outputAspectRatio === 'original' ? '原图' : outputAspectRatio,
    mode: processMode,
    settingsSummary: {
      apiBaseUrl: settings.apiBaseUrl,
      textModel: settings.textModel,
      imageModel: settings.imageModel,
      maxParallelTasks: settings.maxParallelTasks,
    },
  });

  const toHistoryImage = (task: ImageTask) => ({
    id: task.historyImageId ?? task.id,
    name: task.file.name,
    relativePath: task.relativePath,
    outputRelativePath: task.outputRelativePath,
    groupLabel: task.groupLabel,
    status: task.status,
    phase: task.phase,
    sourceKind: task.sourceKind,
    pathKey: task.pathKey,
    error: task.error,
    hasText: task.result?.hasText,
    extractedText: task.result?.extractedText,
    translatedText: task.result?.translatedText,
    retryCount: task.retryCount,
    attemptCount: task.attemptCount,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
  });

  const persistHistoryTask = async (historyTaskId: string, allTasks: ImageTask[], nameOverride?: string) => {
    const parsed = await postHistory('upsert-task', {
      task: buildHistoryTaskPayload(historyTaskId, allTasks, nameOverride),
      images: allTasks.map(toHistoryImage),
    });
    setHistoryTasks((current) => parsed.tasks ?? (parsed.task ? [parsed.task, ...current.filter((task) => task.id !== parsed.task.id)] : current));
    if (parsed.resourceDir) setResourceDir(parsed.resourceDir);
  };

  const persistOriginalImage = async (task: ImageTask) => {
    if (!task.historyTaskId || !task.historyImageId) return;
    await postHistory('save-image', {
      taskId: task.historyTaskId,
      imageId: task.historyImageId,
      kind: 'original',
      relativePath: task.relativePath,
      dataUrl: task.preview,
    });
  };

  const persistTaskProgress = (task: ImageTask, updates: Partial<ImageTask>, resultDataUrl?: string) => {
    const latestTask = tasksRef.current.find((item) => item.id === task.id) ?? task;
    const historyTaskId = latestTask.historyTaskId ?? task.historyTaskId ?? activeHistoryTaskId;
    const historyImageId = latestTask.historyImageId ?? task.historyImageId ?? task.id;
    if (!historyTaskId) return;

    const merged = { ...latestTask, ...updates, historyTaskId, historyImageId };
    void postHistory('update-image', {
      taskId: historyTaskId,
      imageId: historyImageId,
      patch: toHistoryImage(merged),
    }).then(() => scheduleHistoryRefresh()).catch((error) => setGlobalError(getErrorMessage(error)));

    if (resultDataUrl) {
      void postHistory('save-image', {
        taskId: historyTaskId,
        imageId: historyImageId,
        kind: 'result',
        relativePath: merged.outputRelativePath,
        dataUrl: resultDataUrl,
      }).then(() => scheduleHistoryRefresh()).catch((error) => setGlobalError(getErrorMessage(error)));
    }
  };

  const flushCurrentWorkspaceToHistory = async () => {
    const currentTasks = tasksRef.current;
    if (!activeHistoryTaskId || currentTasks.length === 0) return;
    await persistHistoryTask(activeHistoryTaskId, currentTasks);
    await Promise.all(
      currentTasks.map(async (task) => {
        await persistOriginalImage(task);
        if (task.generatedUrl) {
          await postHistory('save-image', {
            taskId: task.historyTaskId ?? activeHistoryTaskId,
            imageId: task.historyImageId ?? task.id,
            kind: 'result',
            relativePath: task.outputRelativePath,
            dataUrl: task.generatedUrl,
          });
        }
      }),
    );
    await postHistory('append-log', {
      taskId: activeHistoryTaskId,
      event: { type: 'workspace-flush', count: currentTasks.length },
    });
  };

  const saveProjectName = async () => {
    const nextName = draftProjectName.trim();
    if (!nextName) {
      setGlobalError('项目名不能为空。');
      return;
    }

    setActiveProjectName(nextName);
    setIsEditingProjectName(false);
    if (activeHistoryTaskId && tasksRef.current.length > 0) {
      try {
        await persistHistoryTask(activeHistoryTaskId, tasksRef.current, nextName);
        await refreshHistory();
      } catch (error) {
        setGlobalError(getErrorMessage(error));
      }
    }
  };

  const archiveCurrentProject = async () => {
    if (!activeHistoryTaskId || tasksRef.current.length === 0) return;
    try {
      await flushCurrentWorkspaceToHistory();
      const deletedRecords = softDeletedTasksRef.current.filter((record) => {
        const historyTaskId = record.task.historyTaskId ?? activeHistoryTaskId;
        return historyTaskId === activeHistoryTaskId;
      });
      for (const record of deletedRecords) {
        const historyImageId = record.task.historyImageId ?? record.task.id;
        await postHistory('delete-image', {
          taskId: activeHistoryTaskId,
          imageId: historyImageId,
        });
      }
      tasksRef.current = [];
      setTasks([]);
      setSelectedTaskIdsIfChanged(new Set());
      setUndoStack([]);
      setSoftDeletedTasks((current) => current.filter((record) => (record.task.historyTaskId ?? activeHistoryTaskId) !== activeHistoryTaskId));
      setActiveHistoryTaskId(null);
      setActiveProjectName('');
      setDraftProjectName('');
      setIsEditingProjectName(false);
      await refreshHistory();
      setGlobalError(deletedRecords.length > 0 ? `已归档当前项目，并彻底清理 ${deletedRecords.length} 张已软删除图片。` : null);
    } catch (error) {
      setGlobalError(getErrorMessage(error));
    }
  };

  const loadHistoryTaskDetail = async (
    historyTaskId: string,
    options: { offset?: number; append?: boolean; limit?: number } = {},
  ) => {
    const offset = options.offset ?? 0;
    const limit = options.limit ?? HISTORY_DETAIL_PAGE_SIZE;
    const response = await fetch(
      `/api/history?taskId=${encodeURIComponent(historyTaskId)}&includeData=1&imageOffset=${offset}&imageLimit=${limit}`,
    );
    const parsed = await response.json();
    if (!response.ok) throw new Error(parsed?.error?.message ?? '历史任务读取失败。');
    const detailTask = parsed.task as HistoryTaskRecord;
    setSelectedHistoryLogs(parsed.logs ?? '');
    setHistoryDetailTaskIds((current) => new Set(current).add(detailTask.id));
    setHistoryDetailHasMore(Boolean(parsed.hasMoreImages ?? detailTask.hasMoreImages));
    setHistoryTasks((current) => {
      const existing = current.find((task) => task.id === detailTask.id);
      const mergedTask = mergeHistoryTaskImages(existing, detailTask, Boolean(options.append));
      return [mergedTask, ...current.filter((task) => task.id !== detailTask.id)].sort((a, b) => b.updatedAt - a.updatedAt);
    });
    return detailTask;
  };

  const selectHistoryTask = async (historyTaskId: string) => {
    selectedHistoryTaskIdsRef.current = new Set();
    setSelectedHistoryTaskIds(selectedHistoryTaskIdsRef.current);
    setHistoryMenu(null);
    setSelectedHistoryTaskId(historyTaskId);
    setHistoryDetailHasMore(false);
    setHistoryLoading(true);
    try {
      await loadHistoryTaskDetail(historyTaskId);
    } catch (error) {
      setGlobalError(getErrorMessage(error));
    } finally {
      setHistoryLoading(false);
    }
  };

  const loadMoreHistoryTaskImages = async () => {
    const task = selectedHistoryTaskId
      ? historyTasks.find((item) => item.id === selectedHistoryTaskId)
      : null;
    if (!task || !historyDetailHasMore || historyDetailLoadingMore) return;
    setHistoryDetailLoadingMore(true);
    try {
      await loadHistoryTaskDetail(task.id, {
        offset: task.images.length,
        append: true,
      });
    } catch (error) {
      setGlobalError(getErrorMessage(error));
    } finally {
      setHistoryDetailLoadingMore(false);
    }
  };

  const fetchFullHistoryTaskWithData = async (historyTaskId: string) => {
    let offset = 0;
    let mergedTask: HistoryTaskRecord | null = null;
    let logs = '';

    while (true) {
      const response = await fetch(
        `/api/history?taskId=${encodeURIComponent(historyTaskId)}&includeData=1&imageOffset=${offset}&imageLimit=${HISTORY_DETAIL_PAGE_SIZE}`,
      );
      const parsed = await response.json();
      if (!response.ok) throw new Error(parsed?.error?.message ?? '历史任务读取失败。');
      const pageTask = parsed.task as HistoryTaskRecord;
      logs = parsed.logs ?? logs;
      mergedTask = mergeHistoryTaskImages(mergedTask ?? undefined, pageTask, Boolean(mergedTask));

      if (!parsed.hasMoreImages) break;
      offset = Number(parsed.nextImageOffset ?? (offset + HISTORY_DETAIL_PAGE_SIZE));
    }

    if (!mergedTask) throw new Error('历史任务读取失败。');
    return { task: mergedTask, logs };
  };

  const openHistoryPanel = async () => {
    setHistoryOpen(true);
    setSelectedHistoryTaskId(null);
    setHistoryDetailHasMore(false);
    selectedHistoryTaskIdsRef.current = new Set();
    setSelectedHistoryTaskIds(selectedHistoryTaskIdsRef.current);
    setSelectedHistoryLogs('');
    setHistoryLoading(true);
    try {
      await refreshHistory();
    } finally {
      setHistoryLoading(false);
    }
  };

  const performDeleteHistoryTask = async (historyTaskId: string) => {
    setHistoryLoading(true);
    try {
      const deletedIndex = historyTasks.findIndex((task) => task.id === historyTaskId);
      const nextTasks = historyTasks.filter((task) => task.id !== historyTaskId);
      const nextSelectedTask = nextTasks[Math.max(0, Math.min(deletedIndex, nextTasks.length - 1))] ?? nextTasks[0];

      await postHistory('delete-task', { taskId: historyTaskId });
      setHistoryTasks(nextTasks);

      if (activeHistoryTaskId === historyTaskId) {
        setActiveHistoryTaskId(null);
        setHistoryLogs('');
      }

      setSelectedHistoryTaskId(null);
      setSelectedHistoryLogs('');
      if (!nextSelectedTask) {
        setHistoryDetailTaskIds(new Set());
      } else if (selectedHistoryTaskId === historyTaskId) {
        setSelectedHistoryTaskId(nextSelectedTask.id);
        await loadHistoryTaskDetail(nextSelectedTask.id);
      }
      setGlobalError('已删除 1 个历史项目。');
    } catch (error) {
      setGlobalError(getErrorMessage(error));
    } finally {
      setHistoryLoading(false);
    }
  };

  const requestDeleteHistoryTask = (historyTaskId: string) => {
    const task = historyTasks.find((item) => item.id === historyTaskId);
    openConfirmDialog({
      title: '删除这个历史项目？',
      message: `将彻底删除「${task?.name ?? historyTaskId}」的本地记录和已保存图片。这个操作不能撤销。`,
      confirmLabel: '确认删除',
      tone: 'danger',
      onConfirm: () => performDeleteHistoryTask(historyTaskId),
    });
  };

  const performDeleteHistoryTasks = async (historyTaskIds: string[]) => {
    const uniqueIds = [...new Set(historyTaskIds)].filter(Boolean);
    if (uniqueIds.length === 0 || historyLoading) return;
    setHistoryMenu(null);
    setHistoryLoading(true);
    try {
      const deletedIndex = historyTasks.findIndex((task) => uniqueIds.includes(task.id));
      const nextTasks = historyTasks.filter((task) => !uniqueIds.includes(task.id));
      const nextSelectedTask = nextTasks[Math.max(0, Math.min(deletedIndex, nextTasks.length - 1))] ?? nextTasks[0];
      for (const taskId of uniqueIds) {
        await postHistory('delete-task', { taskId });
      }
      setHistoryTasks(nextTasks);
      selectedHistoryTaskIdsRef.current = new Set();
      setSelectedHistoryTaskIds(selectedHistoryTaskIdsRef.current);
      if (selectedHistoryTaskId && uniqueIds.includes(selectedHistoryTaskId)) {
        setSelectedHistoryTaskId(null);
        setSelectedHistoryLogs('');
        if (nextSelectedTask) {
          setSelectedHistoryTaskId(nextSelectedTask.id);
          await loadHistoryTaskDetail(nextSelectedTask.id);
        } else {
          setHistoryDetailTaskIds(new Set());
        }
      }
      if (activeHistoryTaskId && uniqueIds.includes(activeHistoryTaskId)) {
        setActiveHistoryTaskId(null);
        setHistoryLogs('');
      }
      setGlobalError(`已删除 ${uniqueIds.length} 个历史项目。`);
      scheduleHistoryRefresh(120);
    } catch (error) {
      setGlobalError(getErrorMessage(error));
    } finally {
      setHistoryLoading(false);
    }
  };

  const requestDeleteHistoryTasks = (historyTaskIds: string[]) => {
    const uniqueIds = [...new Set(historyTaskIds)].filter(Boolean);
    if (uniqueIds.length === 0 || historyLoading) return;
    openConfirmDialog({
      title: uniqueIds.length === 1 ? '删除这个历史项目？' : `删除 ${uniqueIds.length} 个历史项目？`,
      message: uniqueIds.length === 1
        ? `将彻底删除「${historyTasks.find((task) => task.id === uniqueIds[0])?.name ?? uniqueIds[0]}」的本地记录和已保存图片。这个操作不能撤销。`
        : `将彻底删除选中的 ${uniqueIds.length} 个历史项目及其本地图片。这个操作不能撤销。`,
      confirmLabel: uniqueIds.length === 1 ? '确认删除' : '全部删除',
      tone: 'danger',
      onConfirm: () => performDeleteHistoryTasks(uniqueIds),
    });
  };

  const downloadHistoryTasks = async (historyTaskIds: string[]) => {
    const uniqueIds = [...new Set(historyTaskIds)].filter(Boolean);
    if (uniqueIds.length === 0 || historyLoading) return;
    setHistoryMenu(null);
    setHistoryLoading(true);
    try {
      const zip = new JSZip();
      const usedPaths = new Set<string>();
      for (const taskId of uniqueIds) {
        const { task, logs } = await fetchFullHistoryTaskWithData(taskId);
        const safeRoot = sanitizePathSegment(task.name || task.id);
        task.images.forEach((image) => {
          if (image.originalDataUrl) {
            zip.file(buildUniqueRelativePath(`${safeRoot}/originals/${image.relativePath.split('/').at(-1) ?? image.name}`, usedPaths), dataUrlToBlob(image.originalDataUrl));
          }
          if (image.resultDataUrl) {
            zip.file(buildUniqueRelativePath(`${safeRoot}/results/${image.outputRelativePath.split('/').at(-1) ?? image.name}`, usedPaths), dataUrlToBlob(image.resultDataUrl));
          }
        });
        if (logs) {
          zip.file(buildUniqueRelativePath(`${safeRoot}/logs.ndjson`, usedPaths), logs);
        }
      }
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${uniqueIds.length === 1 ? 'history_project' : 'history_projects'}_${Date.now()}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      setGlobalError(`已打包 ${uniqueIds.length} 个历史项目。`);
    } catch (error) {
      setGlobalError(getErrorMessage(error));
    } finally {
      setHistoryLoading(false);
    }
  };

  const restoreHistoryTask = async (historyTaskId: string) => {
      setHistoryLoading(true);
    try {
      await flushCurrentWorkspaceToHistory();
      const { task: historyTask, logs } = await fetchFullHistoryTaskWithData(historyTaskId);
      const restoredTasks = await Promise.all(
        historyTask.images.map(async (image) => {
          if (!image.originalDataUrl) throw new Error(`缺少原图：${image.relativePath}`);
          const file = dataUrlToFile(image.originalDataUrl, image.name);
          return {
            id: image.id,
            file,
            preview: image.originalDataUrl,
            status: image.status === 'success' || image.status === 'copied' ? image.status : 'idle',
            phase: image.phase ?? 'idle',
            pathKey: image.pathKey,
            relativePath: image.relativePath,
            outputRelativePath: image.outputRelativePath,
            groupLabel: image.groupLabel,
            sourceKind: image.sourceKind ?? 'file',
            sourceFileKey: `${image.sourceKind ?? 'file'}|${image.pathKey}`,
            historyTaskId,
            historyImageId: image.id,
            generatedUrl: image.resultDataUrl ?? undefined,
            wasCopiedWithoutTranslation: image.status === 'copied',
            result: image.hasText === undefined ? undefined : {
              hasText: image.hasText,
              extractedText: image.extractedText ?? '',
              translatedText: image.translatedText,
            },
            error: image.error,
            attemptCount: image.attemptCount ?? 0,
            retryCount: image.retryCount ?? 0,
            startedAt: image.startedAt,
            completedAt: image.completedAt,
          } satisfies ImageTask;
        }),
      );
      setTasks(restoredTasks);
      tasksRef.current = restoredTasks;
      setTargetLanguage(historyTask.language);
      setOutputAspectRatio((historyTask.ratio === '原图' ? 'original' : historyTask.ratio) as OutputAspectRatio);
      setActiveHistoryTaskId(historyTask.id);
      setActiveProjectName(historyTask.name);
      setDraftProjectName(historyTask.name);
      setSelectedHistoryTaskId(historyTask.id);
      setHistoryLogs(logs);
      setSelectedHistoryLogs(logs);
      setHistoryOpen(false);
      setGlobalError(null);
      window.setTimeout(() => workbenchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
    } catch (error) {
      setGlobalError(getErrorMessage(error));
    } finally {
      setHistoryLoading(false);
    }
  };

  const openSettings = () => {
    setDraftSettings(settings);
    setSettingsError(null);
    setConnectionStatus('idle');
    setConnectionMessage('');
    setSettingsOpen(true);
  };

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    setSettingsError(null);
    setConnectionStatus('idle');
    setConnectionMessage('');
    window.setTimeout(() => settingsButtonRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => {
      const firstInput = settingsDialogRef.current?.querySelector<HTMLElement>('input, textarea, select');
      firstInput?.focus();
    }, 0);

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (settingsDialogRef.current) {
        trapFocusInDialog(event, settingsDialogRef.current);
      }

      if (event.key === 'Escape') {
        closeSettings();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [settingsOpen, closeSettings]);

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

  const addFiles = async (
    files: FileList | File[],
    sourceKind: 'file' | 'folder' = 'file',
    uploadMode: UploadMode = 'append',
  ) => {
    const supportedFiles = Array.from(files).filter((file) => isSupportedImageFile(file));
    const oversizedFiles = supportedFiles.filter((file) => file.size > MAX_SINGLE_IMAGE_SIZE_BYTES);
    const incomingFiles = supportedFiles
      .filter((file) => file.size <= MAX_SINGLE_IMAGE_SIZE_BYTES)
      .slice(0, MAX_UPLOAD_BATCH_COUNT);
    const limitedCount = Math.max(supportedFiles.length - oversizedFiles.length - incomingFiles.length, 0);

    if (incomingFiles.length === 0) {
      setGlobalError(
        oversizedFiles.length > 0
          ? `图片太大，单张最多 ${formatFileSize(MAX_SINGLE_IMAGE_SIZE_BYTES)}。`
          : '没有检测到可处理的图片文件。',
      );
      return;
    }

    try {
      const currentTasks = tasksRef.current;
      const shouldCreateNewProject = uploadMode === 'new' || !activeHistoryTaskId || currentTasks.length === 0;
      if (shouldCreateNewProject && currentTasks.length > 0) {
        await flushCurrentWorkspaceToHistory();
        if (activeHistoryTaskId) {
          const deletedRecords = softDeletedTasksRef.current.filter((record) => (record.task.historyTaskId ?? activeHistoryTaskId) === activeHistoryTaskId);
          for (const record of deletedRecords) {
            await postHistory('delete-image', {
              taskId: activeHistoryTaskId,
              imageId: record.task.historyImageId ?? record.task.id,
            });
          }
          setSoftDeletedTasks((current) => current.filter((record) => (record.task.historyTaskId ?? activeHistoryTaskId) !== activeHistoryTaskId));
          setUndoStack([]);
        }
      }

      const existingTasks = shouldCreateNewProject ? [] : currentTasks;
      const historyTaskId = shouldCreateNewProject ? createHistoryTaskId() : activeHistoryTaskId!;
      if (shouldCreateNewProject) {
        setBatchStartedAt(null);
        setBatchCompletedAt(null);
        setBatchRunState('idle');
        setImageQueueLimit(null);
        setSkippedDuplicateCount(0);
        setHistoryLogs('');
        setActiveHistoryTaskId(historyTaskId);
        setSelectedHistoryTaskId(historyTaskId);
      }

      const existingFolderPathKeys = new Set(
        existingTasks
          .filter((task) => task.sourceKind === 'folder')
          .map((task) => task.pathKey),
      );
      const existingSourceFileKeys = new Set(
        existingTasks.map((task) => task.sourceFileKey),
      );
      const usedOutputPaths = new Set(
        existingTasks.map((task) =>
          normalizeRelativePath(task.outputRelativePath).toLowerCase(),
        ),
      );
      let skippedCount = 0;
      const taskFactories = incomingFiles.flatMap((file) => {
        const sourceFileKey = getSourceFileKey(file, sourceKind);
        if (existingSourceFileKeys.has(sourceFileKey)) {
          skippedCount += 1;
          return [];
        }
        existingSourceFileKeys.add(sourceFileKey);

        return [
          async () => {
            const preview = await readFileAsDataUrl(file);
            const pathInfo = getTaskPathInfo(file, sourceKind);
            const outputRelativePath =
              sourceKind === 'file'
                ? buildUniqueRelativePath(pathInfo.outputRelativePath, usedOutputPaths)
                : pathInfo.outputRelativePath;
            const relativePath =
              sourceKind === 'file' ? outputRelativePath : pathInfo.relativePath;

            return {
              id: Math.random().toString(36).slice(2, 10),
              file,
              preview,
              status: 'idle' as const,
              phase: 'idle' as const,
              pathKey: getPathKey(relativePath),
              sourceFileKey,
              historyTaskId,
              historyImageId: sourceFileKey,
              relativePath,
              outputRelativePath,
              groupLabel: pathInfo.groupLabel,
              rootFolder: pathInfo.rootFolder,
              sourceKind,
              attemptCount: 0,
              retryCount: 0,
            } satisfies ImageTask;
          },
        ];
      });
      const preparedTasks = await runWithConcurrencyLimit(taskFactories, UPLOAD_READ_CONCURRENCY);

      const dedupedTasks = preparedTasks.filter((task) => {
        if (task.sourceKind === 'folder' && existingFolderPathKeys.has(task.pathKey)) {
          skippedCount += 1;
          return false;
        }

        if (task.sourceKind === 'folder') {
          existingFolderPathKeys.add(task.pathKey);
        }
        return true;
      });

      if (dedupedTasks.length > 0) {
        const nextTasks = [...existingTasks, ...dedupedTasks];
        const nextProjectName = shouldCreateNewProject
          ? buildAutoProjectName(nextTasks, targetLanguage)
          : activeProjectName;
        tasksRef.current = nextTasks;
        setTasks(nextTasks);
        if (shouldCreateNewProject) {
          setActiveProjectName(nextProjectName);
          setDraftProjectName(nextProjectName);
          setIsEditingProjectName(false);
        }
        await persistHistoryTask(historyTaskId, nextTasks, nextProjectName);
        await runWithConcurrencyLimit(
          dedupedTasks.map((task) => () => persistOriginalImage(task)),
          UPLOAD_READ_CONCURRENCY,
        );
        await postHistory('append-log', {
          taskId: historyTaskId,
          event: { type: shouldCreateNewProject ? 'upload-new-project' : 'upload-batch', count: dedupedTasks.length, sourceKind },
        });
        await refreshHistory();
      }

      if (skippedCount > 0) {
        setSkippedDuplicateCount((current) => current + skippedCount);
      }

      const uploadWarnings = [
        oversizedFiles.length > 0
          ? `${oversizedFiles.length} 张图片超过 ${formatFileSize(MAX_SINGLE_IMAGE_SIZE_BYTES)}，已跳过。`
          : '',
        limitedCount > 0
          ? `单次最多导入 ${MAX_UPLOAD_BATCH_COUNT} 张图片，剩余 ${limitedCount} 张已跳过。`
          : '',
      ].filter(Boolean);

      setGlobalError(
        dedupedTasks.length === 0
          ? ['没有新增图片，重复路径的文件已自动跳过。', ...uploadWarnings].join(' ')
          : uploadWarnings.length > 0
            ? uploadWarnings.join(' ')
            : null,
      );
    } catch (error) {
      setGlobalError(getErrorMessage(error));
    }
  };

  const updateTask = (
    id: string,
    updates: Partial<ImageTask> | ((task: ImageTask) => Partial<ImageTask>),
  ) => {
    const nextTasks = tasksRef.current.map((task) =>
      task.id === id
        ? {
            ...task,
            ...(typeof updates === 'function' ? updates(task) : updates),
          }
        : task,
    );
    tasksRef.current = nextTasks;
    scheduleTasksRender();
  };

  const requestUpload = (files: FileList | File[], sourceKind: 'file' | 'folder') => {
    const nextFiles = Array.from(files);
    if (nextFiles.length === 0) return;
    if (tasksRef.current.length > 0) {
      setPendingUpload({ files: nextFiles, sourceKind });
      return;
    }
    void addFiles(nextFiles, sourceKind, 'new');
  };

  const handlePendingUpload = (uploadMode: UploadMode) => {
    if (!pendingUpload) return;
    const upload = pendingUpload;
    setPendingUpload(null);
    void addFiles(upload.files, upload.sourceKind, uploadMode);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      requestUpload(event.target.files, 'file');
    }

    event.target.value = '';
  };

  const handleFolderChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      requestUpload(event.target.files, 'folder');
    }

    event.target.value = '';
  };

  const openImagePicker = () => {
    fileInputRef.current?.click();
  };

  const openFolderPicker = () => {
    folderInputRef.current?.click();
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();

    if (event.dataTransfer.files) {
      requestUpload(event.dataTransfer.files, 'file');
    }
  };

  const setSelectedTaskIdsIfChanged = useCallback((nextIds: Set<string>) => {
    const currentIds = selectedTaskIdsRef.current;
    if (currentIds.size === nextIds.size && [...nextIds].every((id) => currentIds.has(id))) {
      return;
    }

    selectedTaskIdsRef.current = nextIds;
    setSelectedTaskIds(nextIds);
  }, []);

  const getTasksByIds = (taskIds: string[]) => {
    const idSet = new Set(taskIds);
    return tasksRef.current.filter((task) => idSet.has(task.id));
  };

  const softRemoveTasks = useCallback((taskIds: string[]) => {
    if (isProcessingBatch) return;
    const idSet = new Set(taskIds);
    const removedRecords = tasksRef.current
      .map((task, index) => ({ task, index }))
      .filter((record) => idSet.has(record.task.id));

    if (removedRecords.length === 0) return;

    const nextTasks = tasksRef.current.filter((task) => !idSet.has(task.id));
    tasksRef.current = nextTasks;
    scheduleTasksRender();
    setTaskMenu(null);
    setSelectedTaskIdsIfChanged(new Set());
    setUndoStack((current) => [...current, removedRecords].slice(-20));
    setSoftDeletedTasks((current) => [...current, ...removedRecords]);
    setGlobalError(`已从当前工作台移除 ${removedRecords.length} 张图片。按 Ctrl+Z 可撤销；归档开启新项目时才会彻底清理。`);
  }, [isProcessingBatch, scheduleTasksRender, setSelectedTaskIdsIfChanged]);

  const undoLastSoftDelete = () => {
    setUndoStack((current) => {
      const lastBatch = current.at(-1);
      if (!lastBatch) return current;
      const existingIds = new Set(tasksRef.current.map((task) => task.id));
      const restoredRecords = lastBatch.filter((record) => !existingIds.has(record.task.id));
      if (restoredRecords.length === 0) return current.slice(0, -1);

      const nextTasks = [...tasksRef.current];
      restoredRecords
        .sort((a, b) => a.index - b.index)
        .forEach((record) => {
          nextTasks.splice(Math.min(record.index, nextTasks.length), 0, record.task);
      });
      tasksRef.current = nextTasks;
      scheduleTasksRender();
      setSelectedTaskIdsIfChanged(new Set(restoredRecords.map((record) => record.task.id)));
      setSoftDeletedTasks((deleted) => {
        const restoredIds = new Set(restoredRecords.map((record) => record.task.id));
        return deleted.filter((record) => !restoredIds.has(record.task.id));
      });
      setGlobalError(`已恢复 ${restoredRecords.length} 张图片。`);
      return current.slice(0, -1);
    });
  };

  const removeTask = useCallback((id: string) => {
    softRemoveTasks([id]);
  }, [softRemoveTasks]);

  const removeSelectedTasks = () => {
    const taskIds = [...selectedTaskIdsRef.current];
    if (taskIds.length === 0) return;
    softRemoveTasks(taskIds);
  };

  const pauseTasks = (taskIds: string[]) => {
    const idSet = new Set(taskIds);
    const pausableIds = tasksRef.current
      .filter((task) => idSet.has(task.id) && !['success', 'copied', 'paused'].includes(task.status))
      .map((task) => task.id);

    if (pausableIds.length === 0) return;

    pausableIds.forEach((id) => activeTaskControllersRef.current.get(id)?.abort());
    const nextTasks = tasksRef.current.map((task) =>
      pausableIds.includes(task.id)
        ? {
            ...task,
            status: 'paused' as const,
            error: undefined,
            completedAt: undefined,
          }
        : task,
    );
    tasksRef.current = nextTasks;
    scheduleTasksRender();
    setBatchRunState('paused');
    setBatchCompletedAt(null);
    nextTasks
      .filter((task) => pausableIds.includes(task.id))
      .forEach((task) => {
        persistTaskProgress(task, {
          status: 'paused',
          error: undefined,
          completedAt: undefined,
        });
      });
    setTaskMenu(null);
    setGlobalError(`已暂停 ${pausableIds.length} 张图片，点继续可接着处理。`);
  };

  const runOrPauseSelectedTasks = () => {
    const taskIds = [...selectedTaskIdsRef.current];
    if (taskIds.length === 0) return;
    const taskIdSet = new Set(taskIds);
    const pausedIds = tasksRef.current
      .filter((task) => taskIdSet.has(task.id) && task.status === 'paused')
      .map((task) => task.id);
    const pausableIds = tasksRef.current
      .filter((task) => taskIdSet.has(task.id) && !['success', 'copied', 'paused'].includes(task.status))
      .map((task) => task.id);

    if (pausableIds.length > 0) {
      pauseTasks(taskIds);
      return;
    }

    if (pausedIds.length > 0) {
      confirmAndProcessBatch(pausedIds);
      return;
    }
  };

  const pauseAllTasks = () => {
    const taskIds = tasksRef.current
      .filter((task) => !['success', 'copied', 'paused'].includes(task.status))
      .map((task) => task.id);
    pauseTasks(taskIds);
  };

  const openTaskMenu = useCallback((event: MouseEvent, taskId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const selectedIds = selectedTaskIdsRef.current;
    const taskIds = selectedIds.has(taskId) && selectedIds.size > 0 ? [...selectedIds] : [taskId];
    setSelectedTaskIdsIfChanged(new Set(taskIds));
    setTaskMenu({ taskIds, x: event.clientX, y: event.clientY });
  }, [setSelectedTaskIdsIfChanged]);

  const openTaskKeyboardMenu = useCallback((taskId: string, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    setSelectedTaskIdsIfChanged(new Set([taskId]));
    setTaskMenu({ taskIds: [taskId], x: rect.left + 24, y: rect.top + 24 });
  }, [setSelectedTaskIdsIfChanged]);

  const reprocessTasks = (taskIds: string[], mode: 'translate' | 'redraw') => {
    setTaskMenu(null);
    const targetIds = new Set(taskIds);
    const runnableIds: string[] = [];
    const nextTasks = tasksRef.current.map((task) => {
      if (!targetIds.has(task.id)) return task;
      if (mode === 'redraw' && !task.result?.translatedText) return task;
      runnableIds.push(task.id);
      return {
        ...task,
        status: 'idle' as const,
        phase: 'idle' as const,
        error: undefined,
        generatedUrl: undefined,
        completedAt: undefined,
        wasCopiedWithoutTranslation: false,
        reprocessMode: mode,
        result: mode === 'translate' ? undefined : task.result,
      };
    });

    if (runnableIds.length === 0) {
      setGlobalError(mode === 'redraw' ? '选中的图片还没有翻译文本，不能只重绘。' : '没有可重新处理的图片。');
      return;
    }

    tasksRef.current = nextTasks;
    scheduleTasksRender();
    void postHistory('append-log', {
      taskId: nextTasks.find((task) => runnableIds.includes(task.id))?.historyTaskId ?? activeHistoryTaskId ?? '',
      event: { type: mode === 'translate' ? 'batch-retranslate' : 'batch-redraw', imageIds: runnableIds },
    }).catch(() => undefined);
    window.setTimeout(() => confirmAndProcessBatch(runnableIds), 80);
  };

  const reprocessTask = (taskId: string, mode: 'translate' | 'redraw') => {
    reprocessTasks([taskId], mode);
  };

  const downloadOriginalTask = (taskId: string) => {
    const task = tasksRef.current.find((item) => item.id === taskId);
    if (!task) return;
    setTaskMenu(null);
    downloadDataUrl(task.preview, task.file.name);
  };

  const downloadSelectedResults = async (taskIds: string[]) => {
    const selectedTasks = getTasksByIds(taskIds);
    const resultTasks = selectedTasks.filter((task) => task.generatedUrl);
    const skippedCount = selectedTasks.length - resultTasks.length;

    setTaskMenu(null);

    if (resultTasks.length === 0) {
      setGlobalError('选中的图片还没有可下载的结果图。');
      return;
    }

    if (resultTasks.length === 1) {
      handleDownloadSingle(resultTasks[0]);
      setGlobalError(skippedCount > 0 ? `已下载 1 张结果图，跳过 ${skippedCount} 张未完成图片。` : null);
      return;
    }

    try {
      const zip = new JSZip();
      const usedPaths = new Set<string>();
      resultTasks
        .sort((taskA, taskB) => taskA.outputRelativePath.localeCompare(taskB.outputRelativePath, 'zh-CN'))
        .forEach((task) => {
          if (!task.generatedUrl) return;
          zip.file(buildUniqueRelativePath(task.outputRelativePath, usedPaths), dataUrlToBlob(task.generatedUrl));
        });
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `selected_results_${Date.now()}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      setGlobalError(skippedCount > 0 ? `已打包 ${resultTasks.length} 张结果图，跳过 ${skippedCount} 张未完成图片。` : null);
    } catch (error) {
      setGlobalError(getErrorMessage(error));
    }
  };

  const downloadHistoryImage = (image: HistoryImageRecord, kind: 'original' | 'result') => {
    const dataUrl = kind === 'original' ? image.originalDataUrl : image.resultDataUrl;
    if (!dataUrl) return;
    const fileName = (kind === 'result' ? image.outputRelativePath : image.relativePath).split('/').at(-1) ?? image.name;
    downloadDataUrl(dataUrl, fileName);
  };

  const performDeleteHistoryImage = async (image: HistoryImageRecord) => {
    if (!selectedHistoryTask) return;
    setHistoryLoading(true);
    try {
      await postHistory('delete-image', {
        taskId: selectedHistoryTask.id,
        imageId: image.id,
      });
      await selectHistoryTask(selectedHistoryTask.id);
      await refreshHistory();
    } catch (error) {
      setGlobalError(getErrorMessage(error));
    } finally {
      setHistoryLoading(false);
    }
  };

  const requestDeleteHistoryImage = (image: HistoryImageRecord) => {
    if (!selectedHistoryTask) return;
    openConfirmDialog({
      title: '删除这张历史图片？',
      message: `将从「${selectedHistoryTask.name}」里彻底删除「${image.name}」的原图和结果图。这个操作不能撤销。`,
      confirmLabel: '删除这张',
      tone: 'danger',
      onConfirm: () => performDeleteHistoryImage(image),
    });
  };

  const restoreHistoryImageForReprocess = async (image: HistoryImageRecord, mode: 'translate' | 'redraw') => {
    if (!selectedHistoryTask || !image.originalDataUrl) return;
    setHistoryLoading(true);
    try {
      await flushCurrentWorkspaceToHistory();
      const file = dataUrlToFile(image.originalDataUrl, image.name);
      const restoredTask = {
        id: image.id,
        file,
        preview: image.originalDataUrl,
        status: 'idle' as const,
        phase: 'idle' as const,
        pathKey: image.pathKey,
        relativePath: image.relativePath,
        outputRelativePath: image.outputRelativePath,
        groupLabel: image.groupLabel,
        sourceKind: image.sourceKind ?? 'file',
        sourceFileKey: `${image.sourceKind ?? 'file'}|${image.pathKey}`,
        historyTaskId: selectedHistoryTask.id,
        historyImageId: image.id,
        reprocessMode: mode,
        generatedUrl: mode === 'redraw' ? image.resultDataUrl ?? undefined : undefined,
        result: mode === 'redraw' && image.translatedText
          ? { hasText: image.hasText, extractedText: image.extractedText ?? '', translatedText: image.translatedText }
          : undefined,
        attemptCount: image.attemptCount ?? 0,
        retryCount: image.retryCount ?? 0,
      } satisfies ImageTask;
      setTasks([restoredTask]);
      tasksRef.current = [restoredTask];
      setActiveHistoryTaskId(selectedHistoryTask.id);
      setSelectedHistoryTaskId(selectedHistoryTask.id);
      setHistoryOpen(false);
      window.setTimeout(() => {
        workbenchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        confirmAndProcessBatch([restoredTask.id]);
      }, 80);
    } catch (error) {
      setGlobalError(getErrorMessage(error));
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleSaveSettings = () => {
    try {
      const nextSettings = normalizeSettings(
        applyModelRecommendedSettings({
          ...draftSettings,
          apiBaseUrl: draftSettings.apiBaseUrl.trim() || DEFAULT_API_BASE_URL,
          textModel: draftSettings.textModel.trim() || DEFAULT_GEMINI_TEXT_MODEL,
          imageModel: draftSettings.imageModel.trim() || DEFAULT_GEMINI_IMAGE_MODEL,
        }),
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

  const clearLocalSettings = () => {
    window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
    setSettings(DEFAULT_SETTINGS);
    setDraftSettings(DEFAULT_SETTINGS);
    setSettingsError(null);
    setConnectionStatus('idle');
    setConnectionMessage('');
    setGlobalError('已清除这台电脑当前浏览器里的接口设置和秘钥。');
  };

  const testConnection = async (mode: ConnectionTestMode) => {
    try {
      const runtimeSettings = normalizeSettings(
        applyModelRecommendedSettings(draftSettings),
        {
          requireApiKey: true,
        },
      );

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

  const processBatch = async (onlyTaskIds?: string[], overrides?: { targetLanguage?: string; outputAspectRatio?: OutputAspectRatio }) => {
    const onlyTaskIdSet = onlyTaskIds ? new Set(onlyTaskIds) : null;
    const pendingTasks = tasksRef.current.filter(
      (task) =>
        (task.status === 'idle' || task.status === 'error' || task.status === 'paused') &&
        (!onlyTaskIdSet || onlyTaskIdSet.has(task.id)),
    );

    if (pendingTasks.length === 0) {
      return;
    }

    let runtimeSettings: GatewaySettings;

    try {
      runtimeSettings = normalizeSettings(
        applyModelRecommendedSettings(settings),
        {
          requireApiKey: true,
        },
      );
    } catch (error) {
      setGlobalError(getErrorMessage(error));
      openSettings();
      return;
    }

    setIsProcessingBatch(true);
    setBatchRunState('running');
    setGlobalError(null);
    const batchRunStartedAt =
      batchStartedAt &&
      tasksRef.current.some((task) => task.status === 'success' || task.status === 'copied') &&
      tasksRef.current.some((task) => task.status === 'idle' || task.status === 'error' || task.status === 'paused')
        ? batchStartedAt
        : Date.now();
    setBatchStartedAt(batchRunStartedAt);
    setBatchCompletedAt(null);
    setNowTimestamp(batchRunStartedAt);

    const currentMode: ProcessMode = processMode;
    const currentTargetLanguage = overrides?.targetLanguage ?? targetLanguage;
    const currentWatermarkText = '';
    const currentOutputAspectRatio = overrides?.outputAspectRatio ?? outputAspectRatio;
    const textQueue = createAdaptiveLimiter(Math.max(runtimeSettings.maxParallelTasks, 1));
    const imageQueue = createAdaptiveLimiter(
      getDefaultImageQueueLimit(runtimeSettings),
    );
    let consecutiveTransientImageFailures = 0;

    setImageQueueLimit(imageQueue.getLimit());

    try {
      const registerImageSuccess = () => {
        consecutiveTransientImageFailures = 0;
      };

      const registerImageFailure = (error: ProcessingError) => {
        if (
          error.retryable &&
          (error.kind === 'rate_limit' ||
            error.kind === 'timeout' ||
            error.kind === 'network' ||
            error.kind === 'server')
        ) {
          consecutiveTransientImageFailures += 1;

          if (
            consecutiveTransientImageFailures >= 2 &&
            imageQueue.getLimit() > 1
          ) {
            imageQueue.setLimit(1);
            setImageQueueLimit(1);
          }

          return;
        }

        consecutiveTransientImageFailures = 0;
      };

      await runWithConcurrencyLimit(
        pendingTasks.map((task) => async () => {
          const taskStartedAt = Date.now();
          const taskController = new AbortController();
          activeTaskControllersRef.current.set(task.id, taskController);
          let attemptCount = task.attemptCount ?? 0;
          let retryCount = task.retryCount ?? 0;
          let pauseGuardActive = task.status !== 'paused';

          const applyTaskUpdate = (updates: Partial<ImageTask>) => {
            if (updates.status && updates.status !== 'paused') {
              pauseGuardActive = true;
            }

            const nextUpdates = {
              attemptCount,
              retryCount,
              startedAt: taskStartedAt,
              ...updates,
            };
            updateTask(task.id, nextUpdates);
            persistTaskProgress(
              task,
              nextUpdates,
              typeof nextUpdates.generatedUrl === 'string' ? nextUpdates.generatedUrl : undefined,
            );
          };

          const throwIfPaused = () => {
            const taskPausedAfterResume =
              pauseGuardActive &&
              tasksRef.current.find((item) => item.id === task.id)?.status === 'paused';

            if (taskController.signal.aborted || taskPausedAfterResume) {
              throw new ProcessingError('已暂停。', {
                kind: 'paused',
                retryable: false,
              });
            }
          };

          const runStageWithRetries = async <T,>({
            label,
            status,
            phase,
            run,
            onTransientFailure,
            onSuccess,
          }: {
            label: string;
            status: TaskStatus;
            phase: TaskPhase;
            run: () => Promise<T>;
            onTransientFailure?: (error: ProcessingError) => void;
            onSuccess?: () => void;
          }) => {
            for (
              let stageAttempt = 1;
              stageAttempt <= MAX_STAGE_ATTEMPTS;
              stageAttempt += 1
            ) {
              throwIfPaused();
              attemptCount += 1;
              applyTaskUpdate({
                status,
                phase,
                error: undefined,
                lastErrorKind: undefined,
                lastAttemptAt: Date.now(),
              });

              try {
                const result = await run();
                throwIfPaused();
                onSuccess?.();
                return result;
              } catch (error) {
                const processingError = toProcessingError(error);
                if (processingError.kind === 'paused') throw processingError;
                onTransientFailure?.(processingError);

                if (
                  !processingError.retryable ||
                  stageAttempt === MAX_STAGE_ATTEMPTS
                ) {
                  throw processingError;
                }

                retryCount += 1;
                const delayMs = getRetryDelayMs(stageAttempt);
                applyTaskUpdate({
                  status: 'retrying',
                  phase,
                  retryCount,
                  lastErrorKind: processingError.kind,
                  error: `${label}失败：${processingError.message}，${Math.ceil(
                    delayMs / 1000,
                  )} 秒后自动重试...`,
                });
                await waitForDelay(delayMs);
                throwIfPaused();
              }
            }

            throw new ProcessingError(`${label}失败。`, {
              kind: 'unknown',
              retryable: false,
            });
          };

          try {
            throwIfPaused();
            const base64Data = task.preview.split(',')[1];

            if (!base64Data) {
              throw new ProcessingError('图片读取失败，请重新上传后再试。', {
                kind: 'client',
                retryable: false,
              });
            }

            let taskResult: TaskResult | undefined;

            if (task.status === 'paused' && task.result?.hasText === false && task.generatedUrl) {
              applyTaskUpdate({
                status: 'copied',
                phase: 'copied',
                completedAt: task.completedAt ?? Date.now(),
              });
              return;
            }

            if (task.status === 'paused' && task.result?.translatedText) {
              taskResult = task.result;
              applyTaskUpdate({
                result: taskResult,
                status: 'generating',
                phase: 'ocr_generate',
                error: undefined,
                completedAt: undefined,
              });

              const continuedUrl = await runStageWithRetries({
                label: '继续重绘',
                status: 'generating',
                phase: 'ocr_generate',
                run: () =>
                  imageQueue.run(() =>
                    generateImageFromPromptVariants({
                      settings: runtimeSettings,
                      model: runtimeSettings.imageModel,
                      base64Data,
                      mimeType: task.file.type,
                      debugLabel: `continue-${currentMode}`,
                      promptVariants: buildStructuredImagePromptVariants({
                        mode: currentMode,
                        targetLanguage: currentTargetLanguage,
                        watermarkText: currentWatermarkText,
                        extractedText: taskResult?.extractedText,
                        translatedText: taskResult?.translatedText,
                        outputAspectRatio: currentOutputAspectRatio,
                      }),
                      signal: taskController.signal,
                    }),
                  ),
                onTransientFailure: registerImageFailure,
                onSuccess: registerImageSuccess,
              });

              applyTaskUpdate({
                generatedUrl: continuedUrl,
                outputRelativePath: resolveOutputRelativePath(task.relativePath, continuedUrl),
                status: 'success',
                phase: 'done',
                completedAt: Date.now(),
                reprocessMode: undefined,
              });
              return;
            }

            if (task.reprocessMode === 'redraw' && task.result?.translatedText) {
              taskResult = task.result;
              applyTaskUpdate({
                result: taskResult,
                status: 'generating',
                phase: 'ocr_generate',
                error: undefined,
                generatedUrl: undefined,
                completedAt: undefined,
                reprocessMode: undefined,
              });

              const regeneratedUrl = await runStageWithRetries({
                label: '单图重新重绘',
                status: 'generating',
                phase: 'ocr_generate',
                run: () =>
                  imageQueue.run(() =>
                    generateImageFromPromptVariants({
                      settings: runtimeSettings,
                      model: runtimeSettings.imageModel,
                      base64Data,
                      mimeType: task.file.type,
                      debugLabel: `redraw-${currentMode}`,
                      promptVariants: buildStructuredImagePromptVariants({
                        mode: currentMode,
                        targetLanguage: currentTargetLanguage,
                        watermarkText: currentWatermarkText,
                        extractedText: taskResult?.extractedText,
                        translatedText: taskResult?.translatedText,
                        outputAspectRatio: currentOutputAspectRatio,
                      }),
                      signal: taskController.signal,
                    }),
                  ),
                onTransientFailure: registerImageFailure,
                onSuccess: registerImageSuccess,
              });

              applyTaskUpdate({
                generatedUrl: regeneratedUrl,
                outputRelativePath: resolveOutputRelativePath(task.relativePath, regeneratedUrl),
                status: 'success',
                phase: 'done',
                completedAt: Date.now(),
                reprocessMode: undefined,
              });
              return;
            }

            if (
              currentMode === 'translate_and_remove' ||
              currentMode === 'translate_only'
            ) {
              applyTaskUpdate({
                status: 'detecting',
                phase: 'detecting',
                error: undefined,
                generatedUrl: undefined,
                result: task.status === 'paused' ? task.result : undefined,
                wasCopiedWithoutTranslation: false,
                completedAt: undefined,
                reprocessMode: undefined,
              });

              try {
                const hasText = await runStageWithRetries({
                  label: '含字识别',
                  status: 'detecting',
                  phase: 'detecting',
                  run: () =>
                    textQueue.run(async () => {
                      const textResponse = await callGenerateApi({
                        settings: runtimeSettings,
                        model: runtimeSettings.textModel,
                        requestKind: 'text',
                        debugLabel: `detect-${currentMode}`,
                        parts: [
                          {
                            inlineData: {
                              data: base64Data,
                              mimeType: task.file.type,
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
                                  'Whether the image contains meaningful customer-facing text that needs translation.',
                              },
                            },
                            required: ['hasText'],
                          },
                        },
                      }, taskController.signal);

                      const rawText = getResponseText(textResponse);

                      if (!rawText) {
                        throw new ProcessingError(
                          '文本模型没有返回可解析的含字判断结果。',
                          {
                            kind: 'invalid_response',
                            retryable: false,
                          },
                        );
                      }

                      return parseDetectionResult(rawText);
                    }),
                });

                taskResult = {
                  hasText,
                  extractedText: '',
                  translatedText: '',
                };
              } catch (error) {
                const detectionError = toProcessingError(error);
                taskResult = {
                  hasText: true,
                  extractedText: '',
                  translatedText: '',
                  detectionError: detectionError.message,
                };
              }

              if (taskResult.hasText === false) {
                applyTaskUpdate({
                  result: taskResult,
                  generatedUrl: task.preview,
                  status: 'copied',
                  phase: 'copied',
                  wasCopiedWithoutTranslation: true,
                  outputRelativePath: resolveOutputRelativePath(
                    task.relativePath,
                    task.preview,
                  ),
                  completedAt: Date.now(),
                });
                return;
              }

              applyTaskUpdate({
                result: taskResult,
                status: 'generating',
                phase: 'direct_image',
                wasCopiedWithoutTranslation: false,
              });

              try {
                const directGeneratedUrl = await runStageWithRetries({
                  label: '直接多模态重绘',
                  status: 'generating',
                  phase: 'direct_image',
                  run: () =>
                    imageQueue.run(() =>
                      generateImageFromPromptVariants({
                        settings: runtimeSettings,
                        model: runtimeSettings.imageModel,
                        base64Data,
                        mimeType: task.file.type,
                        debugLabel: `image-direct-${currentMode}`,
                        promptVariants: buildDirectImagePromptVariants({
                          mode: currentMode,
                          targetLanguage: currentTargetLanguage,
                          watermarkText: currentWatermarkText,
                          outputAspectRatio: currentOutputAspectRatio,
                        }),
                        signal: taskController.signal,
                      }),
                    ),
                  onTransientFailure: registerImageFailure,
                  onSuccess: registerImageSuccess,
                });

                applyTaskUpdate({
                  generatedUrl: directGeneratedUrl,
                  outputRelativePath: resolveOutputRelativePath(
                    task.relativePath,
                    directGeneratedUrl,
                  ),
                  status: 'success',
                  phase: 'done',
                  completedAt: Date.now(),
                });
                return;
              } catch (error) {
                const directError = toProcessingError(error);

                if (!shouldUseOcrFallback(directError)) {
                  throw directError;
                }
              }

              const extractedResult = await runStageWithRetries({
                label: 'OCR 提取与翻译',
                status: 'extracting',
                phase: 'ocr_extract',
                run: () =>
                  textQueue.run(async () => {
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
                            hasText: {
                              type: 'BOOLEAN',
                              description:
                                'Whether the image contains meaningful customer-facing text that needs translation.',
                            },
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
                          required: ['hasText', 'extractedText', 'translatedText'],
                        },
                      },
                    }, taskController.signal);

                    const rawText = getResponseText(textResponse);

                    if (!rawText) {
                      throw new ProcessingError(
                        '文本模型没有返回可解析的 OCR 结果。',
                        {
                          kind: 'invalid_response',
                          retryable: false,
                        },
                      );
                    }

                    return parseStructuredText(rawText);
                  }),
              });

              taskResult = {
                ...extractedResult,
                detectionError: taskResult.detectionError,
              };
              applyTaskUpdate({
                result: taskResult,
                status: 'generating',
                phase: 'ocr_generate',
              });

              const structuredGeneratedUrl = await runStageWithRetries({
                label: 'OCR 回退重绘',
                status: 'generating',
                phase: 'ocr_generate',
                run: () =>
                  imageQueue.run(() =>
                    generateImageFromPromptVariants({
                      settings: runtimeSettings,
                      model: runtimeSettings.imageModel,
                      base64Data,
                      mimeType: task.file.type,
                      debugLabel: `image-${currentMode}`,
                      promptVariants: buildStructuredImagePromptVariants({
                        mode: currentMode,
                        targetLanguage: currentTargetLanguage,
                        watermarkText: currentWatermarkText,
                        extractedText: taskResult?.extractedText,
                        translatedText: taskResult?.translatedText,
                        outputAspectRatio: currentOutputAspectRatio,
                      }),
                      signal: taskController.signal,
                    }),
                  ),
                onTransientFailure: registerImageFailure,
                onSuccess: registerImageSuccess,
              });

              applyTaskUpdate({
                generatedUrl: structuredGeneratedUrl,
                outputRelativePath: resolveOutputRelativePath(
                  task.relativePath,
                  structuredGeneratedUrl,
                ),
                status: 'success',
                phase: 'done',
                completedAt: Date.now(),
              });
              return;
            } else {
              applyTaskUpdate({
                status: 'generating',
                phase: 'remove_image',
                error: undefined,
                generatedUrl: undefined,
                result: undefined,
                completedAt: undefined,
              });
            }

            const generatedUrl = await runStageWithRetries({
              label: '去水印重绘',
              status: 'generating',
              phase: 'remove_image',
              run: () =>
                imageQueue.run(() =>
                  generateImageFromPromptVariants({
                    settings: runtimeSettings,
                    model: runtimeSettings.imageModel,
                    base64Data,
                    mimeType: task.file.type,
                    debugLabel: `image-${currentMode}`,
                    promptVariants: buildDirectImagePromptVariants({
                      mode: currentMode,
                      targetLanguage: currentTargetLanguage,
                      watermarkText: currentWatermarkText,
                      outputAspectRatio: currentOutputAspectRatio,
                    }),
                    signal: taskController.signal,
                  }),
                ),
              onTransientFailure: registerImageFailure,
              onSuccess: registerImageSuccess,
            });

            applyTaskUpdate({
              generatedUrl,
              outputRelativePath: resolveOutputRelativePath(
                task.relativePath,
                generatedUrl,
              ),
              status: 'success',
              phase: 'done',
              completedAt: Date.now(),
            });
          } catch (error) {
            const processingError = toProcessingError(error);
            if (processingError.kind === 'paused') {
              applyTaskUpdate({
                status: 'paused',
                completedAt: undefined,
                lastErrorKind: 'paused',
                error: undefined,
              });
            } else {
              applyTaskUpdate({
                status: 'error',
                phase: 'error',
                completedAt: Date.now(),
                lastErrorKind: processingError.kind,
                error: processingError.message,
              });
            }
          } finally {
            activeTaskControllersRef.current.delete(task.id);
          }
        }),
        Math.min(Math.max(runtimeSettings.maxParallelTasks, 1), pendingTasks.length),
      );
    } finally {
      setIsProcessingBatch(false);
      const finishedAt = Date.now();
      const hasPausedTasks = tasksRef.current.some((task) => task.status === 'paused');
      setBatchRunState(hasPausedTasks ? 'paused' : 'completed');
      if (!hasPausedTasks) {
        setBatchCompletedAt(finishedAt);
      }
      setNowTimestamp(finishedAt);
      scheduleHistoryRefresh(120);
    }
  };

  const confirmAndProcessBatch = (onlyTaskIds?: string[]) => {
    if (isProcessingBatch) return;
    const scopeTasks = onlyTaskIds ? getTasksByIds(onlyTaskIds) : tasksRef.current;
    const count = scopeTasks.filter((task) => task.status === 'idle' || task.status === 'error' || task.status === 'paused').length;
    if (count === 0) return;
    const pausedInScope = scopeTasks.filter((task) => task.status === 'paused').length;
    const startableInScope = scopeTasks.filter((task) => task.status === 'idle' || task.status === 'error').length;

    if (pausedInScope > 0 && startableInScope === 0) {
      void processBatch(onlyTaskIds);
      return;
    }

    setStartConfirm({
      taskIds: onlyTaskIds,
      count,
      language: targetLanguage,
      ratio: outputAspectRatio,
      mode: 'start',
    });
  };

  const startConfirmedBatch = () => {
    if (!startConfirm) return;
    setTargetLanguage(startConfirm.language);
    setOutputAspectRatio(startConfirm.ratio);
    const taskIds = startConfirm.taskIds;
    const language = startConfirm.language;
    const ratio = startConfirm.ratio;
    setStartConfirm(null);
    void processBatch(taskIds, { targetLanguage: language, outputAspectRatio: ratio });
  };

  const handlePrimaryRunAction = () => {
    if (isProcessingBatch) {
      pauseAllTasks();
      return;
    }

    if (pausedCount > 0 && startableCount === 0) {
      void processBatch();
      return;
    }

    confirmAndProcessBatch();
  };

  const returnToHome = () => {
    setReturnHomeConfirm({ hasWorkspace: tasksRef.current.length > 0 });
  };

  const confirmReturnToHome = () => {
    if (isProcessingBatch) pauseAllTasks();
    tasksRef.current = [];
    setTasks([]);
    setSelectedTaskIdsIfChanged(new Set());
    setTaskMenu(null);
    setPendingUpload(null);
    setStartConfirm(null);
    setReturnHomeConfirm(null);
    hideSelectionOverlay();
    setActiveHistoryTaskId(null);
    setActiveProjectName('');
    setDraftProjectName('');
    setHistoryOpen(false);
    setSettingsOpen(false);
    setGlobalError(null);
  };

  const handleDownloadZip = async () => {
    const readyTasks = tasks.filter(
      (task) =>
        (task.status === 'success' || task.status === 'copied') && task.generatedUrl,
    );

    if (readyTasks.length === 0) {
      setGlobalError('当前还没有可下载的结果图。');
      return;
    }

    if (batchIntegrity.duplicateManifestPaths[0] || batchIntegrity.duplicateOutputPaths[0]) {
      setGlobalError(
        batchIntegrity.duplicateManifestPaths[0]
          ? `存在重复导入路径：${batchIntegrity.duplicateManifestPaths[0]}`
          : `存在重复输出路径：${batchIntegrity.duplicateOutputPaths[0]}`,
      );
      return;
    }

    try {
      const zip = new JSZip();
      const usedPaths = new Set<string>();
      const orderedReadyTasks = [...readyTasks].sort((taskA, taskB) =>
        taskA.outputRelativePath.localeCompare(taskB.outputRelativePath, 'zh-CN'),
      );

      orderedReadyTasks.forEach((task) => {
        if (!task.generatedUrl) return;
        const blob = dataUrlToBlob(task.generatedUrl);
        const downloadPath = buildUniqueRelativePath(task.outputRelativePath, usedPaths);
        zip.file(downloadPath, blob);
      });

      zip.file(
        'manifest.json',
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            complete: batchIntegrity.isComplete,
            totalCount: totalImageCount,
            readyCount: readyTasks.length,
            failedCount,
            pendingCount,
            language: targetLanguage,
            ratio: outputAspectRatio,
            images: tasks.map((task) => ({
              relativePath: task.relativePath,
              outputRelativePath: task.outputRelativePath,
              status: task.status,
              error: task.error,
              hasText: task.result?.hasText,
            })),
          },
          null,
          2,
        ),
      );

      let logsForZip = historyLogs;
      if (activeHistoryTaskId && !logsForZip) {
        const historyResponse = await fetch(`/api/history?taskId=${encodeURIComponent(activeHistoryTaskId)}`);
        if (historyResponse.ok) {
          const historyPayload = await historyResponse.json();
          logsForZip = historyPayload.logs ?? '';
        }
      }

      if (logsForZip) {
        zip.file('logs.ndjson', logsForZip);
      }

      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const anchor = document.createElement('a');

      anchor.href = url;
      anchor.download = `${batchIntegrity.isComplete ? 'processed_images' : 'partial_processed_images'}_${Date.now()}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (error) {
      setGlobalError(getErrorMessage(error));
    }
  };

  const handleDownloadSingle = useCallback((task: ImageTask) => {
    if (!task.generatedUrl) {
      return;
    }

    const blob = dataUrlToBlob(task.generatedUrl);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download =
      task.outputRelativePath.split('/').at(-1) ?? task.file.name;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, []);

  const selectOutputAspectRatio = useCallback((ratio: OutputAspectRatio) => {
    setOutputAspectRatio((current) => current === ratio ? current : ratio);
  }, []);

  const toggleTaskSelection = useCallback((taskId: string, event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    if (selectionSuppressClickRef.current) {
      event.preventDefault();
      return;
    }
    setTaskMenu(null);
    setSelectedTaskIds((current) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey) {
        const next = new Set(current);
        if (next.has(taskId)) next.delete(taskId);
        else next.add(taskId);
        selectedTaskIdsRef.current = next;
        return next;
      }
      if (current.size === 1 && current.has(taskId)) {
        return current;
      }
      const next = new Set([taskId]);
      selectedTaskIdsRef.current = next;
      return next;
    });
  }, []);

  const clearTaskSelection = useCallback(() => {
    setSelectedTaskIdsIfChanged(new Set());
    setTaskMenu(null);
  }, [setSelectedTaskIdsIfChanged]);

  const updateSelectionOverlay = (startX: number, startY: number, currentX: number, currentY: number) => {
    const overlay = selectionOverlayRef.current;
    if (!overlay) return;
    overlay.style.display = 'block';
    overlay.style.left = `${Math.min(startX, currentX)}px`;
    overlay.style.top = `${Math.min(startY, currentY)}px`;
    overlay.style.width = `${Math.abs(currentX - startX)}px`;
    overlay.style.height = `${Math.abs(currentY - startY)}px`;
  };

  const hideSelectionOverlay = () => {
    const overlay = selectionOverlayRef.current;
    if (!overlay) return;
    overlay.style.display = 'none';
    overlay.style.width = '0px';
    overlay.style.height = '0px';
  };

  const cacheTaskSelectionRects = () => {
    const rects: SelectionRect[] = [];
    const elementMap = new Map<string, HTMLElement>();
    canvasRef.current?.querySelectorAll<HTMLElement>('[data-task-id]').forEach((element) => {
      const taskId = element.dataset.taskId;
      if (!taskId) return;
      const rect = element.getBoundingClientRect();
      rects.push({
        id: taskId,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        element,
      });
      elementMap.set(taskId, element);
    });
    taskSelectionRectsRef.current = rects.sort((rectA, rectB) => rectA.top - rectB.top || rectA.left - rectB.left);
    taskSelectionElementMapRef.current = elementMap;
  };

  const toggleTaskSelectionPreviewClass = (taskId: string, selected: boolean) => {
    const element = taskSelectionElementMapRef.current.get(taskId);
    if (!element) return;
    element.classList.toggle('ui-task-card-selected', selected);
    element.setAttribute('aria-pressed', selected ? 'true' : 'false');
  };

  const applyTaskSelectionPreview = (nextIds: Set<string>) => {
    const currentIds = taskSelectionLiveIdsRef.current ?? selectedTaskIdsRef.current;
    if (currentIds.size === nextIds.size && [...nextIds].every((id) => currentIds.has(id))) {
      return;
    }

    currentIds.forEach((id) => {
      if (!nextIds.has(id)) toggleTaskSelectionPreviewClass(id, false);
    });
    nextIds.forEach((id) => {
      if (!currentIds.has(id)) toggleTaskSelectionPreviewClass(id, true);
    });
    taskSelectionLiveIdsRef.current = nextIds;
  };

  const selectTasksInBox = (box: SelectionBounds) => {
    const nextIds = new Set(taskSelectionBaseIdsRef.current);
    for (const rect of taskSelectionRectsRef.current) {
      if (rect.bottom < box.top) continue;
      if (rect.top > box.bottom) break;
      const intersects = rect.left <= box.right && rect.right >= box.left && rect.top <= box.bottom && rect.bottom >= box.top;
      if (intersects) nextIds.add(rect.id);
    }
    applyTaskSelectionPreview(nextIds);
  };

  const beginCanvasSelection = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('button,input,textarea,select,a')) return;
    if (target.closest('[data-task-card]')) return;

    event.preventDefault();
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    if (!additive && selectedTaskIdsRef.current.size > 0) {
      clearTaskSelection();
    }
    taskSelectionBaseIdsRef.current = new Set(additive ? selectedTaskIdsRef.current : []);
    cacheTaskSelectionRects();
    selectionDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      additive,
      isSelecting: false,
    };

    const makeBox = (clientX: number, clientY: number) => {
      const drag = selectionDragRef.current;
      const rootRect = canvasRef.current?.getBoundingClientRect();
      if (!drag || !rootRect) return null;
      return drag ? {
        left: Math.max(Math.min(drag.startX, clientX), rootRect.left),
        right: Math.min(Math.max(drag.startX, clientX), rootRect.right),
        top: Math.max(Math.min(drag.startY, clientY), rootRect.top),
        bottom: Math.min(Math.max(drag.startY, clientY), rootRect.bottom),
      } : null;
    };

    const finishSelection = (wasDragging: boolean) => {
      const finalIds = taskSelectionLiveIdsRef.current;
      selectionDragRef.current = null;
      taskSelectionPointRef.current = null;
      taskSelectionLiveIdsRef.current = null;
      taskSelectionRectsRef.current = [];
      taskSelectionElementMapRef.current = new Map();
      if (taskSelectionFrameRef.current !== null) {
        window.cancelAnimationFrame(taskSelectionFrameRef.current);
        taskSelectionFrameRef.current = null;
      }
      document.body.classList.remove('ui-is-box-selecting');
      hideSelectionOverlay();
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      if (wasDragging) {
        if (finalIds) {
          setSelectedTaskIdsIfChanged(finalIds);
        }
        selectionSuppressClickRef.current = true;
        window.setTimeout(() => {
          selectionSuppressClickRef.current = false;
        }, 120);
      }
    };

    const runSelectionFrame = () => {
      taskSelectionFrameRef.current = null;
      const drag = selectionDragRef.current;
      const point = taskSelectionPointRef.current;
      if (!drag || !point) return;

      const distance = Math.hypot(point.clientX - drag.startX, point.clientY - drag.startY);
      if (!drag.isSelecting && distance < 5) return;

      if (!drag.isSelecting) {
        drag.isSelecting = true;
        setTaskMenu(null);
        if (!drag.additive) applyTaskSelectionPreview(new Set());
        document.body.classList.add('ui-is-box-selecting');
      }

      updateSelectionOverlay(drag.startX, drag.startY, point.clientX, point.clientY);
      const box = makeBox(point.clientX, point.clientY);
      if (box) selectTasksInBox(box);
    };

    const scheduleSelectionFrame = () => {
      if (taskSelectionFrameRef.current !== null) return;
      taskSelectionFrameRef.current = window.requestAnimationFrame(runSelectionFrame);
    };

    const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
      const drag = selectionDragRef.current;
      if (!drag) return;
      taskSelectionPointRef.current = {
        clientX: moveEvent.clientX,
        clientY: moveEvent.clientY,
      };
      moveEvent.preventDefault();
      scheduleSelectionFrame();
    };

    const handleMouseUp = (upEvent: globalThis.MouseEvent) => {
      const drag = selectionDragRef.current;
      if (!drag) return;
      const wasDragging = drag.isSelecting;
      const box = makeBox(upEvent.clientX, upEvent.clientY);
      if (wasDragging && box) selectTasksInBox(box);
      finishSelection(wasDragging);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const toggleHistoryTaskSelection = (taskId: string, event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    if (selectionSuppressClickRef.current) {
      event.preventDefault();
      return;
    }
    setHistoryMenu(null);
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      setSelectedHistoryTaskIds((current) => {
        const next = new Set(current);
        if (next.has(taskId)) next.delete(taskId);
        else next.add(taskId);
        selectedHistoryTaskIdsRef.current = next;
        return next;
      });
      return;
    }
    void selectHistoryTask(taskId);
  };

  const cacheHistorySelectionRects = () => {
    const rects: SelectionRect[] = [];
    const elementMap = new Map<string, HTMLElement>();
    historyGalleryRef.current?.querySelectorAll<HTMLElement>('[data-history-task-id]').forEach((element) => {
      const taskId = element.dataset.historyTaskId;
      if (!taskId) return;
      const rect = element.getBoundingClientRect();
      rects.push({
        id: taskId,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        element,
      });
      elementMap.set(taskId, element);
    });
    historySelectionRectsRef.current = rects.sort((rectA, rectB) => rectA.top - rectB.top || rectA.left - rectB.left);
    historySelectionElementMapRef.current = elementMap;
  };

  const setSelectedHistoryTaskIdsIfChanged = (nextIds: Set<string>) => {
    const currentIds = selectedHistoryTaskIdsRef.current;
    if (currentIds.size === nextIds.size && [...nextIds].every((id) => currentIds.has(id))) {
      return;
    }

    selectedHistoryTaskIdsRef.current = nextIds;
    setSelectedHistoryTaskIds(nextIds);
  };

  const toggleHistorySelectionPreviewClass = (taskId: string, selected: boolean) => {
    const element = historySelectionElementMapRef.current.get(taskId);
    if (!element) return;
    element.classList.toggle('xobi-history-card-active', selected);
    element.classList.toggle('xobi-history-card-selected', selected);
    element.setAttribute('aria-pressed', selected ? 'true' : 'false');
  };

  const applyHistorySelectionPreview = (nextIds: Set<string>) => {
    const currentIds = historySelectionLiveIdsRef.current ?? selectedHistoryTaskIdsRef.current;
    if (currentIds.size === nextIds.size && [...nextIds].every((id) => currentIds.has(id))) {
      return;
    }

    currentIds.forEach((id) => {
      if (!nextIds.has(id)) toggleHistorySelectionPreviewClass(id, false);
    });
    nextIds.forEach((id) => {
      if (!currentIds.has(id)) toggleHistorySelectionPreviewClass(id, true);
    });
    historySelectionLiveIdsRef.current = nextIds;
  };

  const selectHistoryTasksInBox = (box: SelectionBounds) => {
    const nextIds = new Set(historySelectionBaseIdsRef.current);
    for (const rect of historySelectionRectsRef.current) {
      if (rect.bottom < box.top) continue;
      if (rect.top > box.bottom) break;
      const intersects = rect.left <= box.right && rect.right >= box.left && rect.top <= box.bottom && rect.bottom >= box.top;
      if (intersects) nextIds.add(rect.id);
    }
    applyHistorySelectionPreview(nextIds);
  };

  const beginHistorySelection = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0 || selectedHistoryTaskId) return;
    const target = event.target as HTMLElement;
    if (target.closest('input,textarea,select,a,[data-history-menu-button],button:not([data-history-task-id])')) return;
    if (target.closest('[data-history-task-id]')) return;

    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    if (!additive && selectedHistoryTaskIdsRef.current.size > 0) {
      setSelectedHistoryTaskIdsIfChanged(new Set());
    }
    historySelectionBaseIdsRef.current = new Set(additive ? selectedHistoryTaskIdsRef.current : []);
    cacheHistorySelectionRects();
    historySelectionDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      additive,
      isSelecting: false,
    };

    const makeBox = (clientX: number, clientY: number) => {
      const drag = historySelectionDragRef.current;
      const rootRect = historyGalleryRef.current?.getBoundingClientRect();
      if (!drag || !rootRect) return null;
      return {
        left: Math.max(Math.min(drag.startX, clientX), rootRect.left),
        right: Math.min(Math.max(drag.startX, clientX), rootRect.right),
        top: Math.max(Math.min(drag.startY, clientY), rootRect.top),
        bottom: Math.min(Math.max(drag.startY, clientY), rootRect.bottom),
      };
    };

    const finishSelection = (wasDragging: boolean) => {
      const finalIds = historySelectionLiveIdsRef.current;
      historySelectionDragRef.current = null;
      historySelectionPointRef.current = null;
      historySelectionLiveIdsRef.current = null;
      historySelectionRectsRef.current = [];
      historySelectionElementMapRef.current = new Map();
      if (historySelectionFrameRef.current !== null) {
        window.cancelAnimationFrame(historySelectionFrameRef.current);
        historySelectionFrameRef.current = null;
      }
      document.body.classList.remove('ui-is-box-selecting');
      hideSelectionOverlay();
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      if (wasDragging) {
        if (finalIds) {
          setSelectedHistoryTaskIdsIfChanged(finalIds);
        }
        selectionSuppressClickRef.current = true;
        window.setTimeout(() => {
          selectionSuppressClickRef.current = false;
        }, 120);
      }
    };

    const runSelectionFrame = () => {
      historySelectionFrameRef.current = null;
      const drag = historySelectionDragRef.current;
      const point = historySelectionPointRef.current;
      if (!drag || !point) return;

      const distance = Math.hypot(point.clientX - drag.startX, point.clientY - drag.startY);
      if (!drag.isSelecting && distance < 5) return;

      if (!drag.isSelecting) {
        drag.isSelecting = true;
        setHistoryMenu(null);
        if (!drag.additive) applyHistorySelectionPreview(new Set());
        document.body.classList.add('ui-is-box-selecting');
      }

      updateSelectionOverlay(drag.startX, drag.startY, point.clientX, point.clientY);
      const box = makeBox(point.clientX, point.clientY);
      if (box) selectHistoryTasksInBox(box);
    };

    const scheduleSelectionFrame = () => {
      if (historySelectionFrameRef.current !== null) return;
      historySelectionFrameRef.current = window.requestAnimationFrame(runSelectionFrame);
    };

    const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
      const drag = historySelectionDragRef.current;
      if (!drag) return;
      historySelectionPointRef.current = {
        clientX: moveEvent.clientX,
        clientY: moveEvent.clientY,
      };
      moveEvent.preventDefault();
      scheduleSelectionFrame();
    };

    const handleMouseUp = (upEvent: globalThis.MouseEvent) => {
      const drag = historySelectionDragRef.current;
      if (!drag) return;
      const wasDragging = drag.isSelecting;
      const box = makeBox(upEvent.clientX, upEvent.clientY);
      if (wasDragging && box) selectHistoryTasksInBox(box);
      finishSelection(wasDragging);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const openHistoryMenu = (event: MouseEvent, taskId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const selectedIds = selectedHistoryTaskIdsRef.current;
    const taskIds = selectedIds.has(taskId) && selectedIds.size > 0 ? [...selectedIds] : [taskId];
    setSelectedHistoryTaskIdsIfChanged(new Set(taskIds));
    setHistoryMenu({ taskIds, x: event.clientX, y: event.clientY });
  };


  const manifestEntries = useMemo(() => {
    const manifestMap = new Map<string, BatchManifestEntry>();

    tasks.forEach((task) => {
      if (manifestMap.has(task.pathKey)) {
        return;
      }

      manifestMap.set(task.pathKey, {
        pathKey: task.pathKey,
        relativePath: task.relativePath,
        outputRelativePath: task.outputRelativePath,
        groupLabel: task.groupLabel,
        rootFolder: task.rootFolder,
      });
    });

    return Array.from(manifestMap.values()).sort((entryA, entryB) =>
      entryA.relativePath.localeCompare(entryB.relativePath, 'zh-CN'),
    );
  }, [tasks]);
  const batchIntegrity = useMemo<BatchIntegrityState>(() => {
    const manifestPathCounts = new Map<string, number>();
    const readyTaskMap = new Map<string, ImageTask[]>();
    const duplicateOutputPaths: string[] = [];
    const usedOutputPathKeys = new Set<string>();

    tasks.forEach((task) => {
      manifestPathCounts.set(
        task.pathKey,
        (manifestPathCounts.get(task.pathKey) ?? 0) + 1,
      );

      if (
        (task.status === 'success' || task.status === 'copied') &&
        task.generatedUrl
      ) {
        const readyTasks = readyTaskMap.get(task.pathKey) ?? [];
        readyTasks.push(task);
        readyTaskMap.set(task.pathKey, readyTasks);
      }
    });

    const duplicateManifestPaths = Array.from(manifestPathCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([pathKey]) => manifestEntries.find((entry) => entry.pathKey === pathKey)?.relativePath ?? pathKey);
    const missingPaths: string[] = [];
    let readyCount = 0;

    manifestEntries.forEach((entry) => {
      const readyTasks = readyTaskMap.get(entry.pathKey) ?? [];

      if (readyTasks.length !== 1) {
        missingPaths.push(entry.relativePath);
        return;
      }

      readyCount += 1;
      const outputPath = normalizeRelativePath(readyTasks[0].outputRelativePath);
      const outputPathKey = outputPath.toLowerCase();

      if (usedOutputPathKeys.has(outputPathKey)) {
        duplicateOutputPaths.push(outputPath);
        return;
      }

      usedOutputPathKeys.add(outputPathKey);
    });

    return {
      isComplete:
        manifestEntries.length > 0 &&
        readyCount === manifestEntries.length &&
        missingPaths.length === 0 &&
        duplicateManifestPaths.length === 0 &&
        duplicateOutputPaths.length === 0,
      readyCount,
      missingPaths,
      duplicateManifestPaths,
      duplicateOutputPaths,
    };
  }, [manifestEntries, tasks]);
  const taskStats = useMemo(() => {
    const stats = {
      pausedCount: 0,
      startableCount: 0,
      activeProcessingCount: 0,
      copiedCount: 0,
      retryingCount: 0,
      failedCount: 0,
      detectingCount: 0,
      extractingCount: 0,
      generatingCount: 0,
      detectedTextCount: 0,
      uploadedFolderCount: 0,
      groupCount: 0,
      totalImageCount: manifestEntries.length,
    };

    tasks.forEach((task) => {
      if (task.status === 'paused') stats.pausedCount += 1;
      if (task.status === 'idle' || task.status === 'error') stats.startableCount += 1;
      if (task.status === 'detecting') stats.detectingCount += 1;
      if (task.status === 'extracting') stats.extractingCount += 1;
      if (task.status === 'generating') stats.generatingCount += 1;
      if (task.status === 'retrying') stats.retryingCount += 1;
      if (task.status === 'copied') stats.copiedCount += 1;
      if (task.status === 'error') stats.failedCount += 1;
      if (task.result?.hasText === true) stats.detectedTextCount += 1;
    });

    stats.activeProcessingCount =
      stats.detectingCount + stats.extractingCount + stats.generatingCount + stats.retryingCount;
    stats.uploadedFolderCount = new Set(
      manifestEntries.map((task) => task.rootFolder).filter(Boolean),
    ).size;
    stats.groupCount = new Set(manifestEntries.map((task) => task.groupLabel)).size;
    return stats;
  }, [manifestEntries, tasks]);

  const {
    pausedCount,
    startableCount,
    activeProcessingCount,
    copiedCount,
    retryingCount,
    failedCount,
    detectingCount,
    extractingCount,
    generatingCount,
    detectedTextCount,
    uploadedFolderCount,
    groupCount,
    totalImageCount,
  } = taskStats;
  const pendingCount = startableCount + pausedCount;
  const primaryRunLabel = pausedCount > 0 && startableCount === 0 ? '继续' : pausedCount > 0 ? '继续/开始' : '开始';
  const outputReadyCount = batchIntegrity.readyCount;
  const hasRequestConfig =
    settings.requestHeadersText.trim() !== '{}' ||
    settings.requestQueryParamsText.trim() !== '{}';
  const effectiveBatchParallel = Math.max(settings.maxParallelTasks, 1);
  const effectiveTextParallel = effectiveBatchParallel;
  const effectiveImageParallel = imageQueueLimit ?? getDefaultImageQueueLimit(settings);
  const batchElapsedLabel = batchStartedAt
    ? formatDuration((batchCompletedAt ?? nowTimestamp) - batchStartedAt)
    : '未开始';
  const batchStateLabel =
    batchRunState === 'running'
      ? `运行中 ${activeProcessingCount}`
      : batchRunState === 'paused'
        ? '已暂停'
        : batchRunState === 'completed'
          ? '已完成'
          : '未开始';
  const groupedTasks = useMemo(
    () =>
      Array.from(
        tasks.reduce((groups, task) => {
          const existing = groups.get(task.groupLabel) ?? [];
          existing.push(task);
          groups.set(task.groupLabel, existing);
          return groups;
        }, new Map<string, ImageTask[]>()),
      )
        .sort(([groupA], [groupB]) => groupA.localeCompare(groupB, 'zh-CN'))
        .map(([groupLabel, groupTasks]) => ({
          groupLabel,
          tasks: [...groupTasks].sort((taskA, taskB) =>
            taskA.relativePath.localeCompare(taskB.relativePath, 'zh-CN'),
          ),
        })),
    [tasks],
  );

  const selectedHistoryTask = useMemo(
    () => historyTasks.find((task) => task.id === selectedHistoryTaskId) ?? null,
    [historyTasks, selectedHistoryTaskId],
  );
  const selectedHistoryDetailReady = Boolean(selectedHistoryTask && historyDetailTaskIds.has(selectedHistoryTask.id));

  const historyDonePercent = selectedHistoryTask?.totalCount
    ? Math.round((selectedHistoryTask.doneCount / selectedHistoryTask.totalCount) * 100)
    : 0;

  const selectedTaskCount = selectedTaskIds.size;
  const selectedPausedTaskIds = useMemo(
    () => tasks
      .filter((task) => selectedTaskIds.has(task.id) && task.status === 'paused')
      .map((task) => task.id),
    [selectedTaskIds, tasks],
  );
  const selectedPausableCount = useMemo(
    () => tasks.filter((task) => selectedTaskIds.has(task.id) && !['success', 'copied', 'paused'].includes(task.status)).length,
    [selectedTaskIds, tasks],
  );
  const selectedActionIsContinue = selectedPausedTaskIds.length > 0 && selectedPausableCount === 0;
  const selectedActionDisabled = selectedTaskCount === 0 || (selectedActionIsContinue ? selectedPausedTaskIds.length === 0 : selectedPausableCount === 0);
  const selectedResultCount = useMemo(
    () => tasks.filter((task) => selectedTaskIds.has(task.id) && task.generatedUrl).length,
    [selectedTaskIds, tasks],
  );
  const selectedAspectRatioOption = getAspectRatioOption(outputAspectRatio);
  const progressPercent = totalImageCount ? Math.round((outputReadyCount / totalImageCount) * 100) : 0;
  const canvasGridClass = totalImageCount <= 1
    ? 'mx-auto grid w-full max-w-[720px] grid-cols-1 place-items-center gap-5'
    : totalImageCount === 2
      ? 'mx-auto grid w-full max-w-[1120px] grid-cols-1 place-items-center gap-5 lg:grid-cols-2'
      : 'grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))]';
  const cardSizeClass = totalImageCount <= 1 ? 'w-full max-w-[620px]' : 'w-full';
  const consoleDockOpen = mobileConsoleOpen || desktopConsoleOpen;

  return (
    <>
      <div className={cn('ui-shell relative min-h-screen overflow-x-hidden bg-[#050505] text-white', totalImageCount > 80 && 'ui-large-batch')}>
        <style jsx global>{`
          :root {
            --xobi-ink: #020303;
            --xobi-void: #070809;
            --xobi-panel: rgba(12, 14, 14, 0.88);
            --xobi-panel-strong: rgba(15, 17, 17, 0.97);
            --xobi-line: rgba(226, 232, 240, 0.12);
            --xobi-lime: #b6f214;
            --xobi-lime-soft: rgba(182, 242, 20, 0.24);
            --xobi-cyan: #5eead4;
            --xobi-warn: #f59e0b;
            --panel-border: var(--xobi-line);
            --panel-fill: var(--xobi-panel);
            --button-glow: rgba(182, 242, 20, 0.26);
          }
          html,
          body { background: var(--xobi-ink); }
          body.ui-is-box-selecting { cursor: crosshair; }
          body.ui-is-box-selecting .ui-task-card {
            transition: none !important;
          }
          body.ui-is-box-selecting .ui-task-card:hover {
            transform: none !important;
          }
          body.ui-is-box-selecting .ui-task-card::after {
            opacity: 0.18 !important;
          }
          body.ui-is-box-selecting .xobi-history-gallery-card {
            transition: none !important;
          }
          body.ui-is-box-selecting .xobi-history-gallery-card:hover {
            transform: none !important;
          }
          body.ui-is-box-selecting .xobi-history-card-selected::before {
            box-shadow: none !important;
          }
          * { scrollbar-width: thin; scrollbar-color: rgba(182, 242, 20, 0.42) transparent; }
          ::-webkit-scrollbar { width: 5px; height: 5px; }
          ::-webkit-scrollbar-thumb { background: rgba(182, 242, 20, 0.46); border-radius: 999px; }
          ::-webkit-scrollbar-track { background: transparent; }
          select { color-scheme: dark; appearance: none; }
          select option { background: #101213; color: #f8fafc; }
          input[type='number']::-webkit-outer-spin-button,
          input[type='number']::-webkit-inner-spin-button { margin: 0; appearance: none; }
          input[type='number'] { appearance: textfield; }
          .ui-shell input,
          .ui-shell select,
          .ui-shell textarea {
            border-color: rgba(226,232,240,0.12) !important;
            background-color: rgba(3,5,6,0.86) !important;
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.045);
          }
          .ui-shell input:focus,
          .ui-shell select:focus,
          .ui-shell textarea:focus {
            border-color: rgba(182,242,20,0.78) !important;
            box-shadow: 0 0 0 3px rgba(182,242,20,0.10), inset 0 1px 0 rgba(255,255,255,0.06);
          }
          .ui-shell select {
            background-image: linear-gradient(45deg, transparent 50%, rgba(182,242,20,0.92) 50%), linear-gradient(135deg, rgba(182,242,20,0.92) 50%, transparent 50%);
            background-position: calc(100% - 14px) 50%, calc(100% - 9px) 50%;
            background-size: 5px 5px, 5px 5px;
            background-repeat: no-repeat;
          }
          .ui-shell::before {
            content: '';
            position: fixed;
            inset: 0;
            z-index: 0;
            pointer-events: none;
            background:
              radial-gradient(circle at 14% 8%, rgba(182, 242, 20, 0.12), transparent 28rem),
              radial-gradient(circle at 84% 0%, rgba(94, 234, 212, 0.10), transparent 24rem),
              linear-gradient(112deg, transparent 0 36%, rgba(182,242,20,0.10) 45%, rgba(94,234,212,0.075) 52%, transparent 64%),
              linear-gradient(rgba(255,255,255,0.018) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px),
              var(--xobi-ink);
            background-size: auto, auto, 180% 180%, 64px 64px, 64px 64px, auto;
            background-position: 0 0, 0 0, -80% 0, 0 0, 0 0, 0 0;
            opacity: 1;
            animation: xobi-flow-field 9s ease-in-out infinite alternate;
          }
          .ui-shell::after {
            content: '';
            position: fixed;
            inset: -18%;
            z-index: 0;
            pointer-events: none;
            background:
              radial-gradient(ellipse at 22% 74%, rgba(182,242,20,0.10), transparent 34%),
              radial-gradient(ellipse at 78% 22%, rgba(94,234,212,0.08), transparent 32%),
              radial-gradient(circle at center, transparent 0, rgba(0,0,0,0.50) 70%);
            filter: blur(8px);
            transform: translate3d(0,0,0);
            animation: xobi-aurora-drift 12s ease-in-out infinite alternate;
          }
          @keyframes xobi-flow-field {
            from { background-position: 0 0, 0 0, -85% 0, 0 0, 0 0, 0 0; }
            to { background-position: 0 0, 0 0, 105% 0, 18px 28px, 28px 18px, 0 0; }
          }
          @keyframes xobi-aurora-drift {
            from { transform: translate3d(-1.5%, -1%, 0) scale(1); opacity: 0.78; }
            to { transform: translate3d(1.5%, 1%, 0) scale(1.04); opacity: 0.96; }
          }
          .ui-shell > * { position: relative; z-index: 1; }
          .ui-topbar {
            background: linear-gradient(180deg, rgba(15,15,17,0.96), rgba(4,4,5,0.92));
            box-shadow: 0 1px 0 rgba(255,255,255,0.06), 0 18px 48px rgba(0,0,0,0.42);
          }
          .ui-panel {
            position: relative;
            overflow: hidden;
            background:
              linear-gradient(145deg, rgba(255,255,255,0.055), rgba(255,255,255,0.012) 46%, rgba(182,242,20,0.026)),
              var(--panel-fill);
            border-color: var(--panel-border) !important;
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 18px 45px rgba(0,0,0,0.28);
          }
          .ui-panel::after,
          .ui-task-card::after,
          .ui-upload-zone::after {
            content: '';
            position: absolute;
            inset: 0;
            pointer-events: none;
            background: linear-gradient(120deg, rgba(255,255,255,0.08), transparent 22%, transparent 74%, rgba(182,242,20,0.045));
            opacity: 0.36;
          }
          .ui-button {
            position: relative;
            overflow: hidden;
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), 0 10px 26px rgba(0,0,0,0.22);
          }
          .ui-button::before {
            content: '';
            position: absolute;
            inset: 0;
            pointer-events: none;
            background: linear-gradient(110deg, rgba(255,255,255,0.12), transparent 34%, rgba(182,242,20,0.09));
            opacity: 0.56;
          }
          .ui-button > *, .ui-button { isolation: isolate; }
          .ui-button-primary {
            background: linear-gradient(135deg, rgba(182, 242, 20, 0.98), rgba(94, 234, 212, 0.92)) !important;
            color: #08070a !important;
            box-shadow: 0 0 0 1px rgba(255,255,255,0.24), 0 0 28px var(--button-glow), inset 0 1px 0 rgba(255,255,255,0.28);
          }
          .ui-upload-zone {
            position: relative;
            overflow: hidden;
            background:
              radial-gradient(circle at 50% 0%, rgba(182,242,20,0.16), transparent 26rem),
              radial-gradient(circle at 18% 78%, rgba(94,234,212,0.09), transparent 22rem),
              linear-gradient(rgba(255,255,255,0.055) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.055) 1px, transparent 1px),
              rgba(182,242,20,0.030) !important;
            background-size: auto, auto, 24px 24px, 24px 24px, auto !important;
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 18px 50px rgba(0,0,0,0.24);
          }
          .ui-upload-icon {
            background: linear-gradient(135deg, rgba(182,242,20,0.24), rgba(94,234,212,0.12)) !important;
            box-shadow: 0 0 42px rgba(182,242,20,0.20), inset 0 1px 0 rgba(255,255,255,0.18);
            animation: upload-orbit 4.8s ease-in-out infinite;
          }
          .ui-canvas-workspace {
            position: relative;
            user-select: none;
            background:
              radial-gradient(circle at 22% 12%, rgba(182,242,20,0.08), transparent 28rem),
              radial-gradient(circle at 82% 0%, rgba(94,234,212,0.07), transparent 30rem),
              linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px),
              rgba(4,4,5,0.72);
            background-size: auto, auto, 42px 42px, 42px 42px, auto;
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.05), inset 0 0 90px rgba(0,0,0,0.32);
          }
          .ui-selection-box {
            position: fixed;
            z-index: 70;
            pointer-events: none;
            border: 1px solid rgba(182,242,20,0.92);
            background: rgba(182,242,20,0.14);
            box-shadow: 0 0 0 1px rgba(63,98,18,0.46), 0 0 34px rgba(182,242,20,0.16);
          }
          .ui-task-card {
            position: relative;
            contain: layout paint style;
            content-visibility: auto;
            contain-intrinsic-size: 340px 320px;
            animation: task-pop 260ms ease both;
            background: linear-gradient(180deg, rgba(22,19,27,0.96), rgba(8,7,10,0.99)) !important;
            border-color: rgba(255,255,255,0.13) !important;
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 18px 48px rgba(0,0,0,0.28);
          }
          .ui-task-card-selected {
            border-color: rgba(182,242,20,0.78) !important;
            box-shadow: 0 0 0 1px rgba(182,242,20,0.40), 0 18px 62px rgba(182,242,20,0.14), inset 0 1px 0 rgba(255,255,255,0.12);
          }
          @keyframes task-pop {
            from { opacity: 0; transform: translateY(10px) scale(0.985); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
          @keyframes upload-orbit {
            0%, 100% { transform: translateY(0); filter: brightness(1); }
            50% { transform: translateY(-4px); filter: brightness(1.18); }
          }
          .ui-large-batch::before,
          .ui-large-batch::after,
          .ui-large-batch .ui-task-card {
            animation: none !important;
          }
          .ui-large-batch .ui-task-card:hover,
          .ui-large-batch .ui-task-card-selected {
            transform: none !important;
          }
          .ui-large-batch .ui-task-card::after {
            opacity: 0.18;
          }
          .ui-large-batch [class*="bg-white/"] {
            backdrop-filter: none;
          }
          .ui-preview-pane {
            background:
              linear-gradient(45deg, rgba(255,255,255,0.045) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.045) 75%),
              linear-gradient(45deg, rgba(255,255,255,0.045) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.045) 75%),
              #09090b !important;
            background-size: 18px 18px, 18px 18px, auto !important;
            background-position: 0 0, 9px 9px, center !important;
          }
          .ui-preview-result {
            box-shadow: inset 0 0 0 1px rgba(16,185,129,0.09), inset 0 0 38px rgba(16,185,129,0.07);
          }
          .ui-modal-backdrop {
            background:
              radial-gradient(circle at 50% 8%, rgba(182,242,20,0.14), transparent 30rem),
              rgba(0,0,0,0.80) !important;
          }
          .ui-modal-panel {
            background: linear-gradient(145deg, rgba(22,22,24,0.98), rgba(10,10,12,0.98)) !important;
            box-shadow: 0 34px 90px rgba(0,0,0,0.82), inset 0 1px 0 rgba(255,255,255,0.07) !important;
          }
          .ui-stat-card {
            background: linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.025));
            border: 1px solid rgba(255,255,255,0.10);
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
          }
          .ui-floating-toast {
            position: fixed;
            right: 16px;
            top: 72px;
            z-index: 82;
            width: min(430px, calc(100vw - 24px));
            pointer-events: none;
          }
          .ui-floating-toast-card {
            border-radius: 20px;
            border: 1px solid rgba(182,242,20,0.20);
            background: rgba(4,20,14,0.92);
            padding: 0.9rem 1rem;
            color: rgba(236,253,245,0.95);
            font-size: 0.875rem;
            line-height: 1.55;
            box-shadow: 0 18px 54px rgba(0,0,0,0.48), inset 0 1px 0 rgba(255,255,255,0.08);
            backdrop-filter: blur(18px);
            animation: toast-in 180ms cubic-bezier(0.2,0.8,0.2,1) both;
          }
          .ui-floating-toast-card[data-tone='error'] {
            border-color: rgba(248,113,113,0.28);
            background: rgba(40,12,14,0.92);
            color: rgb(254,202,202);
          }
          @keyframes toast-in {
            from { opacity: 0; transform: translateX(18px) scale(0.985); }
            to { opacity: 1; transform: translateX(0) scale(1); }
          }
          @media (max-width: 640px) {
            .ui-floating-toast {
              left: 10px;
              right: 10px;
              top: auto;
              bottom: 76px;
              width: auto;
            }
          }

          .ui-side-dock {
            position: fixed;
            left: 0;
            top: 57px;
            bottom: 0;
            z-index: 45;
            width: min(402px, calc(100vw - 20px));
            pointer-events: none;
          }
          .ui-mobile-console-toggle,
          .ui-side-dock-close {
            display: none;
          }
          .ui-side-dock::before {
            display: none;
          }
          .ui-side-dock-hotline {
            display: inline-flex;
            position: absolute;
            left: 0;
            top: 0;
            bottom: 0;
            width: 14px;
            padding: 0;
            align-items: center;
            justify-content: center;
            appearance: none;
            border: 0;
            border-radius: 0;
            background: transparent;
            color: transparent;
            font-size: 0;
            font-weight: 0;
            letter-spacing: 0;
            line-height: 1;
            pointer-events: auto;
            cursor: pointer;
            opacity: 1;
          }
          .ui-side-dock-hotline::before {
            content: '';
            position: absolute;
            left: 0;
            top: 18px;
            bottom: 18px;
            width: 2px;
            border-radius: 999px;
            background: linear-gradient(180deg, rgba(182,242,20,0), rgba(182,242,20,0.56), rgba(94,234,212,0.26), rgba(182,242,20,0));
            box-shadow: 10px 0 28px rgba(182,242,20,0.10);
            opacity: 0.34;
            transition: opacity 160ms ease, width 160ms ease, box-shadow 160ms ease;
          }
          .ui-side-dock-hotline:hover::before,
          .ui-side-dock.ui-side-dock-open .ui-side-dock-hotline::before {
            width: 4px;
            opacity: 0.78;
            box-shadow: 12px 0 34px rgba(182,242,20,0.18);
          }
          .ui-side-dock-hotline:focus-visible {
            outline: 2px solid rgba(182,242,20,0.68);
            outline-offset: 3px;
          }
          .ui-side-dock.ui-side-dock-open .ui-side-dock-hotline {
            pointer-events: auto;
          }
          .ui-side-dock-panel {
            position: absolute;
            z-index: 1;
            top: 0;
            left: 0;
            bottom: 0;
            width: min(390px, calc(100vw - 36px));
            transform: translateX(calc(-100% - 2px));
            opacity: 0;
            visibility: hidden;
            pointer-events: none;
            overscroll-behavior: contain;
            transition: transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 160ms ease, visibility 160ms ease;
            border-radius: 0 22px 22px 0 !important;
          }
          .ui-side-dock.ui-side-dock-open .ui-side-dock-panel {
            transform: translateX(0);
            opacity: 1;
            visibility: visible;
            pointer-events: auto;
          }
          @media (max-width: 1279px) {
            .ui-mobile-console-toggle {
              display: inline-flex;
              position: fixed;
              left: 14px;
              bottom: 14px;
              z-index: 58;
              min-height: 46px;
              align-items: center;
              justify-content: center;
              gap: 0.5rem;
              border-radius: 999px;
              border: 1px solid rgba(182,242,20,0.28);
              background: rgba(10,12,12,0.94);
              padding: 0 1rem;
              color: rgba(236,253,245,0.92);
              font-size: 0.875rem;
              font-weight: 700;
              box-shadow: 0 18px 46px rgba(0,0,0,0.45), 0 0 24px rgba(182,242,20,0.12);
              backdrop-filter: blur(18px);
            }
            .ui-side-dock-close {
              display: inline-flex;
            }
            .ui-side-dock {
              top: auto;
              left: 0;
              right: 0;
              bottom: 0;
              width: 100%;
              height: 0;
              pointer-events: none;
            }
            .ui-side-dock::before { display: none; }
            .ui-side-dock-hotline {
              display: none;
            }
            .ui-side-dock-panel {
              left: 10px;
              right: 10px;
              bottom: 14px;
              top: auto;
              width: auto;
              height: min(72vh, 560px);
              max-height: calc(100dvh - 86px);
              transform: translateY(calc(100% + 18px));
              border-radius: 24px !important;
            }
            .ui-side-dock.ui-side-dock-open {
              height: 100%;
              pointer-events: auto;
            }
            .ui-side-dock.ui-side-dock-open::after {
              content: '';
              position: absolute;
              inset: 0;
              background: rgba(0,0,0,0.32);
            }
            .ui-side-dock.ui-side-dock-open .ui-side-dock-panel {
              transform: translateY(0);
              opacity: 1;
              visibility: visible;
              pointer-events: auto;
            }
          }
          @media (prefers-reduced-motion: reduce) {
            .ui-shell::before,
            .ui-shell::after,
            .ui-task-card,
            .ui-upload-icon,
            .ui-side-dock,
            .ui-side-dock-hotline,
            .ui-side-dock-panel {
              animation: none !important;
              transition: none !important;
            }
          }

          .ui-shell {
            font-family: "Microsoft YaHei UI", "HarmonyOS Sans SC", "Noto Sans CJK SC", sans-serif;
            letter-spacing: 0.01em;
            font-kerning: normal;
            text-rendering: geometricPrecision;
          }
          .ui-shell button,
          .ui-shell label,
          .ui-shell select,
          .ui-shell input,
          .ui-shell textarea,
          .ui-shell h1,
          .ui-shell h2,
          .ui-shell h3,
          .ui-shell p,
          .ui-shell span {
            word-break: keep-all;
            overflow-wrap: normal;
          }
          .ui-shell p { text-wrap: pretty; }
          .ui-shell button,
          .ui-shell .ui-stat-card,
          .ui-shell [role='menu'] { white-space: nowrap; }
          .ui-shell .ui-task-card [title],
          .ui-shell pre,
          .ui-shell textarea { word-break: break-word; overflow-wrap: anywhere; white-space: normal; }
          .ui-topbar {
            border-bottom-color: rgba(226,232,240,0.10) !important;
          }
          .ui-topbar .rounded-lg,
          .ui-topbar .rounded-md,
          .ui-topbar .rounded-full {
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);
          }
          .ui-shell button,
          .ui-shell label[for='image-upload-input'],
          .ui-shell label[for='folder-upload-input'] {
            transition: transform 160ms ease, border-color 160ms ease, background-color 160ms ease, color 160ms ease, box-shadow 160ms ease;
          }
          .ui-shell button:hover,
          .ui-shell label[for='image-upload-input']:hover,
          .ui-shell label[for='folder-upload-input']:hover {
            transform: translateY(-1px);
          }
          .ui-shell button:active,
          .ui-shell label[for='image-upload-input']:active,
          .ui-shell label[for='folder-upload-input']:active {
            transform: translateY(0) scale(0.99);
          }
          .ui-shell button:focus-visible,
          .ui-shell label[for='image-upload-input']:focus-visible,
          .ui-shell label[for='folder-upload-input']:focus-visible {
            outline: 2px solid rgba(182,242,20,0.70);
            outline-offset: 2px;
          }
          .ui-shell [class*="rounded-xl"],
          .ui-shell [class*="rounded-2xl"],
          .ui-shell [class*="rounded-3xl"] {
            border-color: rgba(226,232,240,0.10);
          }
          .ui-modal-panel form,
          .ui-modal-panel input,
          .ui-modal-panel textarea,
          .ui-modal-panel select { font-variant-numeric: tabular-nums; }
          .ui-modal-panel label > span {
            letter-spacing: 0.02em;
            color: rgba(226,232,240,0.68) !important;
          }
          .ui-modal-panel input,
          .ui-modal-panel textarea,
          .ui-modal-panel select {
            min-height: 42px;
            border-radius: 14px !important;
          }
          .ui-modal-panel textarea {
            line-height: 1.65;
          }
          .ui-modal-panel .ui-panel {
            background: linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.018)), rgba(6,7,8,0.82) !important;
          }
          .ui-progress-rail {
            position: relative;
            overflow: hidden;
            background: rgba(255,255,255,0.08);
          }
          .ui-progress-rail::after { display: none; }
          .ui-ratio-preview {
            min-height: 128px;
            background:
              radial-gradient(circle at 50% 24%, rgba(182,242,20,0.12), transparent 46%),
              linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.015));
          }
          .ui-ratio-frame {
            transition: width 180ms ease, height 180ms ease, border-color 180ms ease, box-shadow 180ms ease;
            background:
              linear-gradient(135deg, rgba(182,242,20,0.18), rgba(94,234,212,0.08)),
              rgba(5,7,7,0.82);
          }
          .ui-history-shell {
            background:
              radial-gradient(circle at 18% 0%, rgba(182,242,20,0.09), transparent 30rem),
              radial-gradient(circle at 82% 0%, rgba(94,234,212,0.08), transparent 32rem),
              linear-gradient(180deg, rgba(12,12,14,0.98), rgba(3,3,4,0.98));
            overscroll-behavior: contain;
          }
          .ui-history-modal-backdrop {
            overscroll-behavior: contain;
          }
        `}</style>
        <div ref={selectionOverlayRef} className="ui-selection-box" style={{ display: 'none' }} />
        {globalError && (
          <div className="ui-floating-toast" role="status" aria-live="polite">
            <div className="ui-floating-toast-card" data-tone={getGlobalMessageTone(globalError)}>
              {globalError}
            </div>
          </div>
        )}

        <header className="ui-topbar sticky top-0 z-40 border-b border-white/10 backdrop-blur-xl">
          <div className="flex min-h-14 flex-wrap items-center gap-2 px-3 py-2 md:px-4">
            <button type="button" onDoubleClick={returnToHome} title="双击返回上传主页" className="flex shrink-0 items-center gap-2 rounded-xl border border-transparent py-1 pl-1 pr-2 text-left transition hover:border-white/10 hover:bg-white/[0.04]">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#b6f214] text-black shadow-[0_0_28px_rgba(182,242,20,0.24)]">
                <Sparkles className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-none">xobi</span>
                <span className="mt-1 block text-[10px] uppercase tracking-[0.18em] text-white/28">IMAGE WORKBENCH</span>
              </span>
            </button>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <label
                htmlFor="image-upload-input"
                className={cn('ui-button h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-xs font-medium text-white/70 transition hover:border-white/20 hover:bg-white/[0.10] hover:text-white', tasks.length === 0 ? 'hidden' : 'inline-flex')}
              >
                <UploadCloud className="h-3.5 w-3.5" />
                上传图片
              </label>
              <label
                htmlFor="folder-upload-input"
                className={cn('ui-button ui-button-primary h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-emerald-500 px-3 text-xs font-semibold text-white transition hover:border-emerald-400', tasks.length === 0 ? 'hidden' : 'inline-flex')}
              >
                <UploadCloud className="h-3.5 w-3.5" />
                上传文件夹
              </label>
            </div>

            <label className={cn('min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-lg border border-white/10 bg-white/[0.035] px-2 py-1', tasks.length > 0 ? 'grid' : 'hidden')}>
              <span className="whitespace-nowrap text-[11px] text-white/35">目标语言</span>
              <select
                id="target-language-select"
                name="targetLanguage"
                value={targetLanguage}
                onChange={(event) => setTargetLanguage(event.target.value)}
                disabled={isProcessingBatch}
                className="h-7 min-w-0 rounded-md border border-white/10 bg-[#191919] px-2 pr-7 text-xs text-white outline-none transition hover:border-white/20 focus:border-emerald-400"
              >
                {LANGUAGE_OPTIONS.map((language) => (
                  <option key={language.value} value={language.value}>{language.label}</option>
                ))}
              </select>
            </label>

            <div className={cn(tasks.length > 0 ? 'hidden min-w-[180px] flex-1 items-center gap-2 md:flex' : 'hidden flex-1')}>
              <div className="ui-progress-rail h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-lime-300 transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <span className="w-12 text-right text-[11px] tabular-nums text-white/35">{outputReadyCount}/{totalImageCount || 0}</span>
            </div>

            <div className={tasks.length > 0 ? 'grid grid-cols-2 gap-1.5 sm:grid-cols-4 xl:flex xl:justify-end' : 'hidden'}>
              <span className="inline-flex h-8 min-w-[72px] items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-2.5 text-[11px] tabular-nums text-white/55">总数 {totalImageCount || 0}</span>
              <span className="inline-flex h-8 min-w-[72px] items-center justify-center rounded-full border border-amber-400/25 bg-amber-500/10 px-2.5 text-[11px] tabular-nums text-amber-200">处理中 {detectingCount + extractingCount + generatingCount + retryingCount}</span>
              <span className="inline-flex h-8 min-w-[72px] items-center justify-center rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 text-[11px] tabular-nums text-emerald-300">完成 {outputReadyCount}</span>
              <span className="inline-flex h-8 min-w-[72px] items-center justify-center rounded-full border border-red-400/25 bg-red-400/10 px-2.5 text-[11px] tabular-nums text-red-300">失败 {failedCount}</span>
            </div>

            <button
              type="button"
              onClick={openHistoryPanel}
              className={cn('ui-button h-9 items-center justify-center gap-1.5 rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-3 text-xs font-medium text-emerald-100 transition hover:border-emerald-300/35 hover:bg-emerald-400/15', tasks.length === 0 ? 'hidden' : 'inline-flex')}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              历史 {historyTasks.length}
            </button>

            <button
              type="button"
              ref={settingsButtonRef}
              onClick={openSettings}
              className={cn('ui-button h-9 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-xs font-medium text-white/65 transition hover:border-white/20 hover:bg-white/[0.10] hover:text-white', tasks.length === 0 ? 'hidden' : 'inline-flex')}
            >
              <Settings className="h-3.5 w-3.5" />
              设置
            </button>
          </div>
        </header>

        <main ref={workbenchRef} className={cn('flex min-h-[calc(100vh-57px)] flex-col transition-[padding] duration-300', tasks.length === 0 ? 'justify-center' : 'pb-20 xl:pb-0')}>
          <input id="image-upload-input" name="images" ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFileChange} className="fixed -left-[9999px] top-0 h-px w-px opacity-0" />
          <input id="folder-upload-input" name="folderImages" ref={folderInputRef} type="file" accept="image/*" multiple onChange={handleFolderChange} className="fixed -left-[9999px] top-0 h-px w-px opacity-0" {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} />

          <section className={cn(tasks.length === 0 ? 'flex flex-1 p-0' : 'hidden')}>
            <div className={cn('grid gap-3', tasks.length === 0 ? 'h-full w-full max-w-none' : 'w-full max-w-none')}>
              <div
                role="button"
                tabIndex={0}
                aria-label="上传图片或文件夹"
                onClick={openImagePicker}
                onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openImagePicker();
                  }
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleDrop}
                className={cn('ui-upload-zone w-full cursor-pointer items-center justify-center border border-dashed border-white/14 px-6 py-10 transition hover:border-lime-300/55', tasks.length === 0 ? 'flex min-h-[calc(100vh-57px)] rounded-none border-x-0 border-b-0 border-t' : 'hidden')}
              >
                <div className="text-center">
                  <div className="ui-upload-icon mx-auto mb-7 flex h-24 w-24 items-center justify-center rounded-[22px] border border-lime-300/25 text-lime-100">
                    <UploadCloud className="h-10 w-10" />
                  </div>
                  <h1 className="text-4xl font-semibold tracking-tight text-white/92 md:text-6xl">拖入图片或文件夹</h1>
                  <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-white/45">
                    这里只负责上传。模型、语言、比例、并发都在进入工作台后设置。
                  </p>
                  <div className="mt-10 flex flex-col justify-center gap-4 sm:flex-row">
                    <label htmlFor="image-upload-input" onClick={(event) => event.stopPropagation()} className="ui-button cursor-pointer rounded-2xl border border-white/10 bg-white/[0.06] px-10 py-5 text-lg font-medium text-white/78 transition hover:bg-white/[0.1] hover:text-white">选图片</label>
                    <label htmlFor="folder-upload-input" onClick={(event) => event.stopPropagation()} className="ui-button ui-button-primary cursor-pointer rounded-2xl px-10 py-5 text-lg font-semibold text-white transition">选文件夹</label>
                  </div>
                </div>
              </div>

              <div className="hidden">
                <div className="space-y-2">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-white/25">Batch Control</p>
                  <p className="min-h-10 text-sm leading-5 text-white/68">
                    {tasks.length > 0
                      ? uploadedFolderCount > 0
                        ? `已载入 ${uploadedFolderCount} 个文件夹、${groupCount} 个分组，共 ${totalImageCount} 张图片。`
                        : `已载入 ${totalImageCount} 张图片，当前分为 ${groupCount} 个任务分组。`
                      : '上传后显示数量、进度、并发和耗时。'}
                  </p>
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
                  <div className="ui-stat-card rounded-xl px-3 py-2"><p className="text-[10px] text-white/38">批处理并发</p><p className="mt-0.5 text-lg font-semibold tabular-nums text-white/88">{effectiveBatchParallel}</p></div>
                  <div className="ui-stat-card rounded-xl px-3 py-2"><p className="text-[10px] text-cyan-200/60">文本并发</p><p className="mt-0.5 text-lg font-semibold tabular-nums text-cyan-100">{effectiveTextParallel}</p></div>
                  <div className="ui-stat-card rounded-xl px-3 py-2"><p className="text-[10px] text-emerald-200/60">生图并发</p><p className="mt-0.5 text-lg font-semibold tabular-nums text-emerald-300">{effectiveImageParallel}</p></div>
                  <div className="ui-stat-card rounded-xl px-3 py-2"><p className="text-[10px] text-white/38">待处理</p><p className="mt-0.5 text-lg font-semibold tabular-nums">{pendingCount}</p></div>
                  <div className="ui-stat-card rounded-xl px-3 py-2"><p className="text-[10px] text-emerald-200/60">已输出</p><p className="mt-0.5 text-lg font-semibold tabular-nums text-emerald-300">{outputReadyCount}</p></div>
                  <div className="ui-stat-card rounded-xl px-3 py-2"><p className="text-[10px] text-white/38">耗时</p><p className="mt-0.5 text-base font-semibold text-white/85">{batchElapsedLabel}</p></div>
                </div>

                <p className="mt-3 text-xs leading-5 text-white/35">
                  {detectedTextCount} 张含字，{copiedCount} 张无字跳过；OCR {extractingCount}，重绘 {generatingCount}，重试 {retryingCount}。并发会按这里显示的三类真实队列执行。
                </p>
              </div>
            </div>

            <div className="hidden">
              <div className="min-w-0 flex-1 space-y-2">
                <span className="block text-[11px] uppercase tracking-[0.18em] text-white/28">输出比例</span>
                <div className="flex flex-wrap gap-1.5 rounded-2xl border border-white/10 bg-black/30 p-1.5">
                  {ASPECT_RATIO_OPTIONS.map((option) => (
                    <button key={option.value} type="button" title={option.hint} onClick={() => selectOutputAspectRatio(option.value)} disabled={isProcessingBatch} className={cn('h-8 rounded-xl border px-3 text-xs tabular-nums transition', outputAspectRatio === option.value ? 'border-emerald-300 bg-emerald-500 text-black shadow-[0_0_20px_rgba(16,185,129,0.22)]' : 'border-transparent bg-white/[0.04] text-white/45 hover:bg-white/[0.08] hover:text-white/75')}>{option.label}</button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row lg:ml-auto">
                <button id="batch-start-button" type="button" onClick={handlePrimaryRunAction} disabled={pendingCount === 0 && !isProcessingBatch} className={cn('inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition', pendingCount === 0 && !isProcessingBatch ? 'cursor-not-allowed bg-white/10 text-white/25' : 'bg-emerald-500 text-black hover:bg-emerald-400')}>
                  {isProcessingBatch ? <PauseCircle className="h-4 w-4" /> : pausedCount > 0 && startableCount === 0 ? <PlayCircle className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                  {isProcessingBatch ? '暂停' : `${primaryRunLabel} (${pendingCount})`}
                </button>
                
                <button type="button" onClick={handleDownloadZip} disabled={outputReadyCount === 0} className={cn('inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition', outputReadyCount === 0 ? 'cursor-not-allowed bg-white/10 text-white/25' : 'bg-white text-black hover:bg-emerald-100')}>
                  <Archive className="h-4 w-4" />
                  {batchIntegrity.isComplete ? '打包下载' : '下载已完成'} ({outputReadyCount}/{totalImageCount || 0})
                </button>
              </div>
            </div>

          </section>

          <section ref={canvasRef} onMouseDown={beginCanvasSelection} onClick={(event) => { if (selectionSuppressClickRef.current) { event.preventDefault(); return; } if (isBlankSelectionSurfaceClick(event, '[data-task-card]')) clearTaskSelection(); }} className={cn('ui-canvas-workspace flex-1 overflow-auto px-3 py-3 md:px-4', tasks.length === 0 && 'hidden')}>
            {tasks.length === 0 ? (
              <div className="flex min-h-[38vh] items-center justify-center rounded-2xl border border-white/10 bg-white/[0.025]">
                <div className="text-center">
                  <ImageIcon className="mx-auto h-10 w-10 text-white/15" />
                  <p className="mt-3 text-sm text-white/38">还没有图片。上传后这里会显示原图和翻译结果。</p>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <TaskGroupsView
                  groupedTasks={groupedTasks}
                  selectedTaskIds={selectedTaskIds}
                  isProcessingBatch={isProcessingBatch}
                  canvasGridClass={canvasGridClass}
                  cardSizeClass={cardSizeClass}
                  onToggle={toggleTaskSelection}
                  onOpenMenu={openTaskMenu}
                  onOpenKeyboardMenu={openTaskKeyboardMenu}
                  onRemove={removeTask}
                  onDownload={handleDownloadSingle}
                />
              </div>
            )}
          </section>
        </main>

        {tasks.length > 0 && (
          <button
            type="button"
            className="ui-mobile-console-toggle"
            aria-controls="batch-console-panel"
            aria-expanded={mobileConsoleOpen}
            onClick={() => setMobileConsoleOpen((current) => !current)}
          >
            {mobileConsoleOpen ? <X className="h-4 w-4" /> : <Settings className="h-4 w-4" />}
            {mobileConsoleOpen ? '收起控制台' : '控制台'}
          </button>
        )}

        {tasks.length > 0 && (
          <aside
            className={cn('ui-side-dock', consoleDockOpen && 'ui-side-dock-open')}
            aria-label="批量控制抽屉"
            onMouseEnter={openDesktopConsole}
            onMouseLeave={scheduleDesktopConsoleClose}
            onBlur={(event) => {
              const nextFocus = event.relatedTarget;
              if (!(nextFocus instanceof Node) || !event.currentTarget.contains(nextFocus)) {
                closeDesktopConsole();
              }
            }}
          >
            <button
              type="button"
              className="ui-side-dock-hotline"
              aria-controls="batch-console-panel"
              aria-expanded={desktopConsoleOpen}
              aria-label="打开控制台"
              onClick={openDesktopConsole}
              onFocus={openDesktopConsole}
              onMouseEnter={openDesktopConsole}
              onMouseLeave={scheduleDesktopConsoleClose}
            >
              控制台
            </button>
            <div
              id="batch-console-panel"
              className="ui-side-dock-panel ui-panel flex flex-col overflow-hidden rounded-r-[26px] border border-white/10 bg-[#101112]/95 shadow-[0_28px_80px_rgba(0,0,0,0.62)] backdrop-blur-xl"
              onMouseEnter={openDesktopConsole}
              onMouseLeave={scheduleDesktopConsoleClose}
              onWheelCapture={(event) => event.stopPropagation()}
            >
              <div className="border-b border-white/10 px-5 py-4">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-white/28">Batch Console</p>
                    {isEditingProjectName ? (
                      <div className="mt-2 flex gap-2">
                        <input id="project-name-input" name="projectName" value={draftProjectName} onChange={(event) => setDraftProjectName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void saveProjectName(); if (event.key === 'Escape') { setIsEditingProjectName(false); setDraftProjectName(activeProjectName); } }} className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none focus:border-emerald-300" autoFocus />
                        <button type="button" onClick={() => void saveProjectName()} className="rounded-xl bg-emerald-500 px-3 text-xs font-semibold text-black">保存</button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => { setDraftProjectName(activeProjectName || buildAutoProjectName(tasks, targetLanguage)); setIsEditingProjectName(true); }} className="mt-1 flex max-w-full items-center gap-2 text-left text-base font-semibold text-white/90 hover:text-emerald-200">
                        <span className="truncate">{activeProjectName || buildAutoProjectName(tasks, targetLanguage)}</span>
                        <Pencil className="h-3.5 w-3.5 shrink-0 text-white/35" />
                      </button>
                    )}
                  </div>
                  <button type="button" className="ui-side-dock-close rounded-xl border border-white/10 bg-white/[0.05] p-2 text-white/55 transition hover:bg-white/[0.10] hover:text-white" aria-label="关闭控制台" onClick={() => setMobileConsoleOpen(false)}>
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <p className="mt-2 text-xs leading-5 text-white/42">
                  {uploadedFolderCount > 0
                    ? `${uploadedFolderCount} 个文件夹 / ${groupCount} 组 / ${totalImageCount} 张 / ${batchStateLabel} / 耗时 ${batchElapsedLabel}`
                    : `${totalImageCount} 张 / ${groupCount} 组 / ${batchStateLabel} / 耗时 ${batchElapsedLabel}`}
                </p>
              </div>

              <div className="min-h-0 flex-1 space-y-5 overflow-auto overscroll-contain px-5 py-5">
                <section className="rounded-3xl border border-white/10 bg-black/28 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium text-white/66">输出比例</p>
                      <p className="mt-1 text-[11px] text-white/34">{selectedAspectRatioOption.hint}</p>
                    </div>
                    <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs tabular-nums text-white/70">{outputAspectRatio === 'original' ? '跟随原图' : outputAspectRatio}</span>
                  </div>

                  <div className="ui-ratio-preview mt-3 flex items-center justify-center rounded-2xl border border-white/10 p-4">
                    <div className="flex h-[96px] w-[112px] items-center justify-center">
                      <div className="ui-ratio-frame flex items-center justify-center rounded-xl border border-emerald-300/60 shadow-[0_0_28px_rgba(182,242,20,0.14)]" style={getAspectRatioPreviewStyle(outputAspectRatio)}>
                        <span className="text-[10px] font-semibold tabular-nums text-emerald-100">{selectedAspectRatioOption.label}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-4 gap-1.5 rounded-2xl border border-white/10 bg-black/30 p-1.5">
                    {ASPECT_RATIO_OPTIONS.map((option) => (
                      <button key={option.value} type="button" title={option.hint} onClick={() => selectOutputAspectRatio(option.value)} disabled={isProcessingBatch} className={cn('h-8 rounded-xl border px-2 text-xs tabular-nums transition', outputAspectRatio === option.value ? 'border-emerald-300 bg-emerald-500 text-black' : 'border-transparent bg-white/[0.04] text-white/48 hover:bg-white/[0.08] hover:text-white/80')}>{option.label}</button>
                    ))}
                  </div>
                </section>

                <section className="rounded-3xl border border-white/10 bg-black/24 p-4">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium text-white/62">进度</p>
                      <p className="mt-1 text-3xl font-semibold tabular-nums text-white">{progressPercent}%</p>
                    </div>
                    <div className="text-right text-xs leading-5 text-white/42">
                      <p>{outputReadyCount}/{totalImageCount || 0}</p>
                      <p>{batchElapsedLabel}</p>
                    </div>
                  </div>
                  <div className="ui-progress-rail mt-4 h-4 overflow-hidden rounded-full border border-white/10 bg-white/10">
                    <div className="h-full rounded-full bg-emerald-400 transition-[width] duration-300" style={{ width: `${progressPercent}%` }} />
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2"><p className="text-white/34">总数</p><p className="mt-1 text-lg font-semibold tabular-nums text-white/88">{totalImageCount}</p></div>
                    <div className="rounded-2xl border border-emerald-300/15 bg-emerald-400/10 px-3 py-2"><p className="text-emerald-100/55">完成</p><p className="mt-1 text-lg font-semibold tabular-nums text-emerald-300">{outputReadyCount}</p></div>
                    <div className="rounded-2xl border border-red-300/15 bg-red-400/10 px-3 py-2"><p className="text-red-100/55">失败</p><p className="mt-1 text-lg font-semibold tabular-nums text-red-300">{failedCount}</p></div>
                  </div>
                </section>

              </div>

              <div className="border-t border-white/10 bg-black/32 p-4">
                <button type="button" onClick={() => void archiveCurrentProject()} disabled={isProcessingBatch} className="mb-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.045] text-sm font-medium text-white/68 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-40">
                  <Archive className="h-4 w-4" />
                  归档当前，开启新项目
                </button>
                <div>
                  <button id="batch-start-button" type="button" onClick={handlePrimaryRunAction} disabled={pendingCount === 0 && !isProcessingBatch} className={cn('inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl text-sm font-semibold transition', pendingCount === 0 && !isProcessingBatch ? 'cursor-not-allowed bg-white/10 text-white/25' : 'bg-emerald-500 text-black hover:bg-emerald-400')}>
                    {isProcessingBatch ? <PauseCircle className="h-4 w-4" /> : pausedCount > 0 && startableCount === 0 ? <PlayCircle className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                    {isProcessingBatch ? '暂停' : `${primaryRunLabel} (${pendingCount})`}
                  </button>
                </div>
                <button type="button" onClick={handleDownloadZip} disabled={outputReadyCount === 0} className={cn('mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl border text-sm font-medium transition', outputReadyCount === 0 ? 'cursor-not-allowed border-white/10 bg-white/5 text-white/25' : 'border-white/12 bg-white/[0.06] text-white/78 hover:bg-white/[0.10] hover:text-white')}>
                  <Archive className="h-4 w-4" />
                  {batchIntegrity.isComplete ? '打包下载' : '下载已完成'} ({outputReadyCount}/{totalImageCount || 0})
                </button>
              </div>
            </div>
          </aside>
        )}
      </div>


      {startConfirm && (
        <div className="fixed inset-0 z-[72] flex items-center justify-center bg-black/76 px-4 backdrop-blur-xl" onMouseDown={(event) => { if (event.target === event.currentTarget) setStartConfirm(null); }}>
          <div ref={startConfirmDialogRef} role="dialog" aria-modal="true" aria-labelledby="start-confirm-title" tabIndex={-1} className="ui-modal-panel w-full max-w-2xl overflow-hidden rounded-[26px] border border-white/10 shadow-[0_28px_90px_rgba(0,0,0,0.78)]">
            <div className="border-b border-white/10 px-5 py-4">
              <p className="text-[11px] uppercase tracking-[0.22em] text-emerald-200/55">Start Batch</p>
              <h2 id="start-confirm-title" className="mt-1 text-lg font-semibold text-white">{startConfirm.mode === 'continue' ? '继续处理' : '开始翻译'} {startConfirm.count} 张图片</h2>
              <p className="mt-2 text-sm leading-6 text-white/48">确认前可以直接改语言和输出比例；已完成的图片不会重复处理。</p>
            </div>

            <div className="grid gap-4 p-5 md:grid-cols-[220px_1fr]">
              <label className="space-y-2">
                <span className="text-xs font-medium text-white/65">目标语言</span>
                <select value={startConfirm.language} onChange={(event) => setStartConfirm((current) => current ? { ...current, language: event.target.value } : current)} className="h-11 w-full rounded-xl border border-white/10 bg-[#111] px-3 pr-8 text-sm text-white outline-none">
                  {LANGUAGE_OPTIONS.map((language) => (
                    <option key={language.value} value={language.value}>{language.label}</option>
                  ))}
                </select>
              </label>

              <section className="rounded-2xl border border-white/10 bg-black/24 p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-white/66">输出比例</p>
                    <p className="mt-1 text-[11px] text-white/36">{getAspectRatioOption(startConfirm.ratio).hint}</p>
                  </div>
                  <div className="flex h-20 w-24 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03]">
                    <div className="ui-ratio-frame flex items-center justify-center rounded-lg border border-emerald-300/60" style={getAspectRatioPreviewStyle(startConfirm.ratio)}>
                      <span className="text-[10px] font-semibold tabular-nums text-emerald-100">{getAspectRatioOption(startConfirm.ratio).label}</span>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {ASPECT_RATIO_OPTIONS.map((option) => (
                    <button key={option.value} type="button" title={option.hint} onClick={() => setStartConfirm((current) => current ? { ...current, ratio: option.value } : current)} className={cn('h-8 rounded-xl border px-2 text-xs tabular-nums transition', startConfirm.ratio === option.value ? 'border-emerald-300 bg-emerald-500 text-black' : 'border-transparent bg-white/[0.04] text-white/48 hover:bg-white/[0.08] hover:text-white/80')}>{option.label}</button>
                  ))}
                </div>
              </section>
            </div>

            <div className="flex justify-end gap-2 border-t border-white/10 bg-black/28 px-5 py-4">
              <button type="button" onClick={() => setStartConfirm(null)} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-white/55 transition hover:bg-white/[0.06] hover:text-white">取消</button>
              <button type="button" onClick={startConfirmedBatch} className="ui-button ui-button-primary rounded-xl px-5 py-2 text-sm font-semibold text-black transition">{startConfirm.mode === 'continue' ? '继续处理' : '开始翻译'}</button>
            </div>
          </div>
        </div>
      )}

      {returnHomeConfirm && (
        <div className="fixed inset-0 z-[72] flex items-center justify-center bg-black/76 px-4 backdrop-blur-xl" onMouseDown={(event) => { if (event.target === event.currentTarget) setReturnHomeConfirm(null); }}>
          <div ref={returnHomeDialogRef} role="dialog" aria-modal="true" aria-labelledby="return-home-title" tabIndex={-1} className="ui-modal-panel w-full max-w-md overflow-hidden rounded-[26px] border border-white/10 shadow-[0_28px_90px_rgba(0,0,0,0.78)]">
            <div className="px-5 py-5">
              <p className="text-[11px] uppercase tracking-[0.22em] text-emerald-200/55">Return Home</p>
              <h2 id="return-home-title" className="mt-1 text-lg font-semibold text-white">返回上传主页？</h2>
              <p className="mt-2 text-sm leading-6 text-white/48">{returnHomeConfirm.hasWorkspace ? '当前工作台显示会清空，历史记录仍会保留。' : '会回到上传图片的首页。'}</p>
            </div>
            <div className="flex justify-end gap-2 border-t border-white/10 bg-black/28 px-5 py-4">
              <button type="button" onClick={() => setReturnHomeConfirm(null)} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-white/55 transition hover:bg-white/[0.06] hover:text-white">取消</button>
              <button type="button" onClick={confirmReturnToHome} className="ui-button ui-button-primary rounded-xl px-5 py-2 text-sm font-semibold text-black transition">返回主页</button>
            </div>
          </div>
        </div>
      )}

      {pendingUpload && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/72 px-4 backdrop-blur-xl">
          <div ref={pendingUploadDialogRef} role="dialog" aria-modal="true" aria-labelledby="pending-upload-title" tabIndex={-1} className="w-full max-w-lg overflow-hidden rounded-[26px] border border-white/10 bg-[#111214] shadow-[0_28px_90px_rgba(0,0,0,0.78)]">
            <div className="border-b border-white/10 px-5 py-4">
              <p className="text-[11px] uppercase tracking-[0.22em] text-emerald-200/55">New Upload</p>
              <h2 id="pending-upload-title" className="mt-1 text-lg font-semibold text-white">这批图片要放到哪里？</h2>
              <p className="mt-2 text-sm leading-6 text-white/48">
                当前工作台已有 {tasks.length} 张图片；这次选择了 {pendingUpload.files.length} 个文件。你可以追加到当前项目，也可以先归档当前项目再开启新项目。
              </p>
            </div>
            <div className="grid gap-3 p-5 sm:grid-cols-2">
              <button type="button" onClick={() => handlePendingUpload('append')} className="rounded-2xl border border-white/10 bg-white/[0.045] p-4 text-left transition hover:border-emerald-300/30 hover:bg-emerald-400/10">
                <UploadCloud className="mb-3 h-5 w-5 text-emerald-200" />
                <p className="font-semibold text-white/90">追加当前项目</p>
                <p className="mt-2 text-xs leading-5 text-white/42">适合补传漏掉的图片，继续写入当前历史记录。</p>
              </button>
              <button type="button" onClick={() => handlePendingUpload('new')} className="rounded-2xl border border-emerald-300/25 bg-emerald-500/12 p-4 text-left transition hover:bg-emerald-500/18">
                <Archive className="mb-3 h-5 w-5 text-emerald-200" />
                <p className="font-semibold text-white/90">归档当前并新建</p>
                <p className="mt-2 text-xs leading-5 text-white/42">当前项目完整保存到历史，然后开启一个干净的新项目。</p>
              </button>
            </div>
            <div className="flex justify-end border-t border-white/10 bg-black/28 px-5 py-4">
              <button type="button" onClick={() => setPendingUpload(null)} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-white/55 transition hover:bg-white/[0.06] hover:text-white">取消</button>
            </div>
          </div>
        </div>
      )}

      {taskMenu && (() => {
        const menuTasks = getTasksByIds(taskMenu.taskIds);
        if (menuTasks.length === 0) return null;
        const canRedraw = menuTasks.some((task) => task.result?.translatedText);
        const hasResult = menuTasks.some((task) => task.generatedUrl);
        return (
          <div
            className="fixed z-[60] w-56 overflow-hidden rounded-2xl border border-white/10 bg-[#111113]/95 p-1 text-xs text-white/70 shadow-[0_20px_60px_rgba(0,0,0,0.65)] backdrop-blur-xl animate-in fade-in zoom-in-95"
            style={{ left: Math.min(taskMenu.x, window.innerWidth - 240), top: Math.min(taskMenu.y, window.innerHeight - 280) }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-3 py-2 text-[11px] text-white/42">已选 {menuTasks.length} 张 / 结果 {menuTasks.filter((task) => task.generatedUrl).length} 张</div>
            <button type="button" onClick={() => reprocessTasks(taskMenu.taskIds, 'translate')} disabled={isProcessingBatch} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition hover:bg-emerald-500/12 hover:text-white disabled:opacity-40"><RefreshCw className="h-3.5 w-3.5" />重新翻译</button>
            <button type="button" onClick={() => reprocessTasks(taskMenu.taskIds, 'redraw')} disabled={isProcessingBatch || !canRedraw} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition hover:bg-cyan-500/12 hover:text-white disabled:opacity-40"><Sparkles className="h-3.5 w-3.5" />只重新重绘</button>
            {menuTasks.some((task) => task.status === 'paused') && <button type="button" onClick={() => { const ids = taskMenu.taskIds.filter((id) => tasksRef.current.find((task) => task.id === id)?.status === 'paused'); setTaskMenu(null); void processBatch(ids); }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-emerald-100 transition hover:bg-emerald-500/12"><PlayCircle className="h-3.5 w-3.5" />继续选中</button>}
            <button type="button" onClick={() => pauseTasks(taskMenu.taskIds)} disabled={!menuTasks.some((task) => !['success', 'copied', 'paused'].includes(task.status))} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-amber-100 transition hover:bg-amber-500/12 disabled:opacity-40"><PauseCircle className="h-3.5 w-3.5" />暂停选中</button>
            <button type="button" onClick={() => void downloadSelectedResults(taskMenu.taskIds)} disabled={!hasResult} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition hover:bg-white/[0.06] hover:text-white disabled:opacity-40"><Archive className="h-3.5 w-3.5" />下载结果</button>
            {menuTasks.length === 1 && <button type="button" onClick={() => downloadOriginalTask(menuTasks[0].id)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition hover:bg-white/[0.06] hover:text-white"><Download className="h-3.5 w-3.5" />下载原图</button>}
            <div className="my-1 h-px bg-white/10" />
            <button type="button" onClick={() => softRemoveTasks(taskMenu.taskIds)} disabled={isProcessingBatch} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-red-200 transition hover:bg-red-500/12 disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" />从工作台移除</button>
          </div>
        );
      })()}

      {historyMenu && (() => {
        const menuTasks = historyTasks.filter((task) => historyMenu.taskIds.includes(task.id));
        if (menuTasks.length === 0) return null;
        return (
          <div
            className="fixed z-[80] w-52 overflow-hidden rounded-2xl border border-white/10 bg-[#101211]/95 p-1 text-xs text-white/70 shadow-[0_20px_60px_rgba(0,0,0,0.65)] backdrop-blur-xl animate-in fade-in zoom-in-95"
            style={{ left: Math.min(historyMenu.x, window.innerWidth - 220), top: Math.min(historyMenu.y, window.innerHeight - 180) }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-3 py-2 text-[11px] text-white/42">已选 {menuTasks.length} 个项目</div>
            <button type="button" onClick={() => void downloadHistoryTasks(historyMenu.taskIds)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition hover:bg-emerald-500/12 hover:text-white"><Archive className="h-3.5 w-3.5" />下载项目</button>
            {menuTasks.length === 1 && <button type="button" onClick={() => void selectHistoryTask(menuTasks[0].id)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition hover:bg-white/[0.06] hover:text-white"><FolderOpen className="h-3.5 w-3.5" />查看详情</button>}
            <div className="my-1 h-px bg-white/10" />
            <button type="button" onClick={() => requestDeleteHistoryTasks(historyMenu.taskIds)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-red-200 transition hover:bg-red-500/12"><Trash2 className="h-3.5 w-3.5" />删除项目</button>
          </div>
        );
      })()}

      {historyOpen && (
        <div
          className="ui-history-modal-backdrop fixed inset-0 z-50 bg-black/92 p-1 text-white sm:p-3"
          onWheelCapture={(event) => event.stopPropagation()}
        >
          <div ref={historyDialogRef} role="dialog" aria-modal="true" aria-labelledby="history-title" tabIndex={-1} className="ui-history-shell flex h-full w-full flex-col overflow-hidden rounded-[30px] border border-white/10 shadow-[0_40px_120px_rgba(0,0,0,0.85)]">
            <div className="xobi-archive-hero border-b border-white/10 px-4 py-3 sm:px-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div className="min-w-0">
                  <p className="xobi-kicker text-emerald-200/58">xobi archive</p>
                  <h2 id="history-title" className="mt-1 text-2xl font-semibold tracking-[-0.035em] text-white sm:text-[1.7rem]">历史工作台</h2>
                  <p className="mt-1 max-w-4xl truncate text-xs text-white/42" title={resourceDir}>本地资源：{resourceDir || 'E:\\图片翻译器\\资源'}</p>
                </div>
                <div className="grid grid-cols-3 gap-2 text-left text-xs sm:min-w-[340px]">
                  <div className="xobi-stat-tile"><p>任务</p><strong>{historyTotalCount || historyTasks.length}</strong></div>
                  <div className="xobi-stat-tile xobi-stat-good"><p>完成</p><strong>{historyTasks.reduce((sum, task) => sum + task.doneCount, 0)}</strong></div>
                  <div className="xobi-stat-tile xobi-stat-bad"><p>失败</p><strong>{historyTasks.reduce((sum, task) => sum + task.failCount, 0)}</strong></div>
                </div>
                <div className="flex items-center gap-2 xl:self-start">
                  <button type="button" onClick={refreshHistory} disabled={historyLoading} className="xobi-soft-button h-10 px-3 text-xs"><RefreshCw className={cn('h-3.5 w-3.5', historyLoading && 'animate-spin')} />刷新</button>
                  <button type="button" onClick={() => setHistoryOpen(false)} aria-label="关闭历史" className="xobi-icon-button h-10 w-10"><X className="h-4 w-4" /></button>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
              {!selectedHistoryTaskId ? (
                <section ref={historyGalleryRef} onMouseDown={beginHistorySelection} onClick={(event) => { if (selectionSuppressClickRef.current) { event.preventDefault(); return; } if (selectedHistoryTaskIdsRef.current.size > 0 && isBlankSelectionSurfaceClick(event, '[data-history-task-id],.xobi-history-selection-bar')) setSelectedHistoryTaskIdsIfChanged(new Set()); }} className="xobi-history-gallery-stage relative h-full overflow-auto p-2.5 sm:p-3">
                  <div className="mb-3 flex items-center justify-between gap-3 px-1">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold tracking-wide text-white/62">项目图库</p>
                      <p className="mt-1 text-[11px] text-white/34">点开详情，拖拽框选，右键操作。</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] tabular-nums text-white/46">{historyTotalCount || historyTasks.length} 个项目</span>
                    </div>
                  </div>
                  {selectedHistoryTaskIds.size > 0 && (
                    <div className="xobi-history-selection-bar">
                      <span>已选 {selectedHistoryTaskIds.size}</span>
                      <button type="button" onClick={() => void downloadHistoryTasks([...selectedHistoryTaskIds])}>下载</button>
                      <button type="button" onClick={() => requestDeleteHistoryTasks([...selectedHistoryTaskIds])}>删除</button>
                    </div>
                  )}

                  {historyTasks.length === 0 ? (
                    <div className="xobi-empty-state min-h-[58vh]">暂无历史。上传图片后会自动保存在这里。</div>
                  ) : (
                    <div className="xobi-history-masonry xobi-history-masonry-full">
                      {historyTasks.map((task) => {
                        const percent = task.totalCount ? Math.round((task.doneCount / task.totalCount) * 100) : 0;
                        const previews = getHistoryPreviewImages(task);
                        const cover = previews[0];
                        const thumbs = previews.slice(1, 4);
                        return (
                          <button key={task.id} type="button" data-history-task-id={task.id} aria-pressed={selectedHistoryTaskIds.has(task.id)} onClick={(event) => toggleHistoryTaskSelection(task.id, event)} onContextMenu={(event) => openHistoryMenu(event, task.id)} className={cn('xobi-history-card xobi-history-gallery-card group', selectedHistoryTaskIds.has(task.id) && 'xobi-history-card-active xobi-history-card-selected')}>
                            <div className="xobi-history-cover">
                              {cover?.dataUrl ? <LocalPreviewImage src={cover.dataUrl} alt={cover.name} className="p-2" /> : <div className="xobi-history-cover-empty"><ImageIcon className="h-7 w-7" /><span>暂无预览</span></div>}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              <span className={cn('xobi-cover-kind', cover?.kind === 'result' ? 'xobi-cover-result' : 'xobi-cover-original')}>{cover?.kind === 'result' ? '结果封面' : '原图封面'}</span>
                              <span className={cn('xobi-status-pill xobi-cover-status', task.status === 'done' ? 'xobi-status-done' : task.status === 'failed' ? 'xobi-status-failed' : task.status === 'running' ? 'xobi-status-running' : 'xobi-status-partial')}>{getHistoryStatusText(task.status)}</span>
                            </div>

                            <div className="mt-2.5 grid grid-cols-3 gap-1.5">
                              {thumbs.length > 0 ? thumbs.map((preview) => (
                                <div key={`${task.id}-${preview.id}-${preview.kind}`} className="xobi-history-thumb">
                                  {preview.dataUrl && <LocalPreviewImage src={preview.dataUrl} alt={preview.name} className="p-1" />}
                                </div>
                              )) : Array.from({ length: 3 }).map((_, index) => <div key={`${task.id}-empty-${index}`} className="xobi-history-thumb xobi-history-thumb-empty" />)}
                            </div>

                            <div className="mt-2.5 flex items-start justify-between gap-3">
                              <div className="min-w-0 text-left">
                                <p className="truncate text-[13px] font-semibold text-white/92">{task.name}</p>
                                <p className="mt-1 text-[10px] tabular-nums text-white/34">{new Date(task.updatedAt).toLocaleString('zh-CN')}</p>
                              </div>
                              <span className="text-right text-base font-semibold leading-none tabular-nums text-emerald-200">{percent}%</span>
                            </div>

                            <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-300" style={{ width: `${percent}%` }} /></div>
                            <div className="mt-2.5 grid grid-cols-3 gap-1.5 text-[10px]">
                              <span className="xobi-mini-chip">总 {task.totalCount}</span>
                              <span className="xobi-mini-chip text-emerald-200">成 {task.doneCount}</span>
                              <span className={cn('xobi-mini-chip', task.failCount > 0 ? 'text-red-200' : 'text-white/35')}>败 {task.failCount}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {historyHasMore && (
                    <div className="mt-4 flex justify-center">
                      <button type="button" onClick={() => void loadMoreHistoryTasks()} disabled={historyLoading} className="xobi-soft-button min-h-11 px-5 text-sm">
                        {historyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        加载更多历史
                      </button>
                    </div>
                  )}
                </section>
              ) : (
                <div className="xobi-history-detail-view grid h-full min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]">
                  <section className="min-h-0 overflow-auto bg-[radial-gradient(circle_at_20%_0%,rgba(16,185,129,0.08),transparent_30%),rgba(255,255,255,0.015)] p-4">
                    <button type="button" onClick={() => setSelectedHistoryTaskId(null)} className="xobi-soft-button mb-3 h-10 px-3 text-xs">返回图库</button>
                    {selectedHistoryTask ? (
                      !selectedHistoryDetailReady ? (
                        <div className="xobi-empty-state min-h-full">
                          <RefreshCw className="h-5 w-5 animate-spin text-emerald-200" />
                          <p className="mt-3 text-sm text-white/72">正在读取本地预览...</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="xobi-detail-plate">
                            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                              <div className="min-w-0">
                                <p className="xobi-kicker text-emerald-200/48">detail</p>
                                <h3 className="mt-1 truncate text-2xl font-semibold tracking-[-0.035em] text-white">{selectedHistoryTask.name}</h3>
                                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                                  <span className="xobi-mini-chip">{selectedHistoryTask.language}</span>
                                  <span className="xobi-mini-chip">{selectedHistoryTask.ratio}</span>
                                  <span className="xobi-mini-chip text-emerald-200">{selectedHistoryTask.doneCount}/{selectedHistoryTask.totalCount}</span>
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button type="button" onClick={() => restoreHistoryTask(selectedHistoryTask.id)} disabled={historyLoading} className="xobi-primary-action h-10 px-4 text-sm"><FolderOpen className="h-4 w-4" />恢复/继续</button>
                                <button type="button" onClick={() => requestDeleteHistoryTask(selectedHistoryTask.id)} disabled={historyLoading} className="xobi-danger-action h-10 px-4 text-sm"><Trash2 className="h-4 w-4" />删除</button>
                              </div>
                            </div>
                            <div className="ui-progress-rail mt-4 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-300" style={{ width: `${historyDonePercent}%` }} /></div>
                          </div>

                          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))]">
                            {selectedHistoryTask.images.map((image) => (
                              <div key={image.id} className="xobi-history-image-card">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold text-white/86" title={image.relativePath}>{image.name}</p>
                                    <p className="mt-1 truncate text-[11px] text-white/30" title={image.outputRelativePath}>{image.outputRelativePath}</p>
                                  </div>
                                  <span className="xobi-status-pill xobi-status-partial">{getTaskStatusText(image.status)}</span>
                                </div>

                                <div className="mt-3 grid grid-cols-2 gap-2">
                                  <div className="ui-preview-pane relative aspect-square overflow-hidden rounded-2xl border border-white/10">
                                    <span className="absolute left-2 top-2 z-10 rounded-md bg-black/70 px-1.5 py-0.5 text-[9px] text-white/55">原图</span>
                                    {image.originalDataUrl ? <LocalPreviewImage src={image.originalDataUrl} alt={image.name} className="p-3" /> : <div className="flex h-full items-center justify-center text-[11px] text-red-200">{image.originalPath ? '读取失败' : '原图缺失'}</div>}
                                  </div>
                                  <div className="ui-preview-pane ui-preview-result relative aspect-square overflow-hidden rounded-2xl border border-white/10">
                                    <span className="absolute left-2 top-2 z-10 rounded-md bg-emerald-500/80 px-1.5 py-0.5 text-[9px] text-black">结果</span>
                                    {image.resultDataUrl ? <LocalPreviewImage src={image.resultDataUrl} alt={`${image.name} result`} className="p-3" /> : <div className="flex h-full items-center justify-center text-[11px] text-white/30">未生成</div>}
                                  </div>
                                </div>

                                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                                  <span className={cn('xobi-save-pill', image.originalPath ? 'text-emerald-200' : 'text-red-200')}>原图 {image.originalPath ? '已保存' : '缺失'}</span>
                                  <span className={cn('xobi-save-pill', image.resultPath ? 'text-emerald-200' : 'text-white/35')}>结果 {image.resultPath ? '已保存' : '未生成'}</span>
                                </div>

                                <div className="mt-3 grid grid-cols-2 gap-2">
                                  <button type="button" onClick={() => restoreHistoryImageForReprocess(image, 'translate')} disabled={historyLoading || !image.originalDataUrl} className="xobi-soft-button h-9 justify-center text-xs text-emerald-100"><RefreshCw className="h-3.5 w-3.5" />重翻</button>
                                  <button type="button" onClick={() => restoreHistoryImageForReprocess(image, 'redraw')} disabled={historyLoading || !image.originalDataUrl || !image.translatedText} className="xobi-soft-button h-9 justify-center text-xs text-cyan-100"><Sparkles className="h-3.5 w-3.5" />重绘</button>
                                  <button type="button" onClick={() => downloadHistoryImage(image, 'original')} disabled={!image.originalDataUrl} className="xobi-soft-button h-9 justify-center text-xs"><Download className="h-3.5 w-3.5" />原图</button>
                                  <button type="button" onClick={() => downloadHistoryImage(image, 'result')} disabled={!image.resultDataUrl} className="xobi-soft-button h-9 justify-center text-xs"><Archive className="h-3.5 w-3.5" />结果</button>
                                </div>

                                <button type="button" onClick={() => requestDeleteHistoryImage(image)} disabled={historyLoading} className="xobi-danger-action mt-2 h-8 w-full justify-center text-xs"><Trash2 className="h-3.5 w-3.5" />删除这张</button>
                                {image.error && <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-red-200">{image.error}</p>}
                              </div>
                            ))}
                          </div>
                          {historyDetailHasMore && (
                            <div className="flex justify-center">
                              <button type="button" onClick={() => void loadMoreHistoryTaskImages()} disabled={historyDetailLoadingMore} className="xobi-soft-button min-h-11 px-5 text-sm">
                                {historyDetailLoadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                                继续加载历史图片
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    ) : (
                      <div className="xobi-empty-state min-h-full">这个历史任务不存在，返回图库重新选。</div>
                    )}
                  </section>

                  <aside className="min-h-0 overflow-auto border-t border-white/10 bg-black/28 p-4 lg:border-l lg:border-t-0">
                    <p className="xobi-kicker text-white/28">local log</p>
                    <div className="mt-3 rounded-2xl border border-white/10 bg-black/35 p-3">
                      <div className="grid grid-cols-2 gap-2 text-center text-xs">
                        <div className="rounded-xl bg-white/[0.05] p-3"><p className="text-white/35">本地任务</p><p className="mt-1 text-xl font-semibold tabular-nums">{selectedHistoryTask?.totalCount ?? 0}</p></div>
                        <div className="rounded-xl bg-white/[0.05] p-3"><p className="text-white/35">保存进度</p><p className="mt-1 text-xl font-semibold tabular-nums text-emerald-300">{historyDonePercent}%</p></div>
                      </div>
                      <p className="mt-3 break-all text-[11px] leading-5 text-white/36">{selectedHistoryTask ? `任务 ID：${selectedHistoryTask.id}` : '未选择任务'}</p>
                    </div>
                    <pre className="mt-3 max-h-[48vh] overflow-auto rounded-2xl border border-white/10 bg-black/48 p-3 text-[11px] leading-5 text-white/42">{selectedHistoryLogs || '选择一个历史任务后显示本地写入日志。'}</pre>
                  </aside>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {confirmDialog && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/78 px-4 text-white backdrop-blur-xl" onMouseDown={(event) => { if (event.target === event.currentTarget) closeConfirmDialog(); }}>
          <div ref={confirmDialogRef} role="dialog" aria-modal="true" aria-labelledby="xobi-confirm-title" aria-describedby="xobi-confirm-message" tabIndex={-1} className="ui-modal-panel w-full max-w-md overflow-hidden rounded-[26px] border border-white/10 bg-[#111214] shadow-[0_28px_90px_rgba(0,0,0,0.78)]">
            <div className="px-5 py-5">
              <p className={cn('text-[11px] uppercase tracking-[0.22em]', confirmDialog.tone === 'danger' ? 'text-red-200/70' : 'text-emerald-200/55')}>Confirm</p>
              <h2 id="xobi-confirm-title" className="mt-1 text-lg font-semibold text-white">{confirmDialog.title}</h2>
              <p id="xobi-confirm-message" className="mt-2 text-sm leading-6 text-white/52">{confirmDialog.message}</p>
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-white/10 bg-black/32 px-5 py-4 sm:flex-row sm:justify-end">
              <button type="button" onClick={closeConfirmDialog} disabled={isConfirming} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-white/58 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-45">{confirmDialog.cancelLabel ?? '取消'}</button>
              <button type="button" onClick={() => void runConfirmDialogAction()} disabled={isConfirming} className={cn('inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2 text-sm font-semibold transition disabled:opacity-55', confirmDialog.tone === 'danger' ? 'border border-red-300/20 bg-red-500/88 text-white hover:bg-red-400' : 'ui-button ui-button-primary text-black')}>
                {isConfirming && <Loader2 className="h-4 w-4 animate-spin" />}
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className="ui-modal-backdrop fixed inset-0 z-50 flex items-center justify-center px-3 py-5 backdrop-blur-xl sm:px-4 sm:py-8" onMouseDown={(event) => { if (event.target === event.currentTarget) closeSettings(); }}>
          <form ref={settingsDialogRef} role="dialog" onSubmit={(event) => { event.preventDefault(); handleSaveSettings(); }} aria-modal="true" aria-labelledby="settings-title" tabIndex={-1} className="ui-modal-panel xobi-settings-modal max-h-[92vh] w-full max-w-[min(96vw,1080px)] overflow-hidden rounded-[26px] border border-white/10 shadow-[0_28px_80px_rgba(0,0,0,0.75)]">
            <div className="xobi-settings-head flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
              <div className="min-w-0">
                <p className="xobi-kicker text-emerald-200/52">settings</p>
                <h2 id="settings-title" className="mt-1 text-xl font-semibold tracking-[-0.03em] text-white">模型与连接设置</h2>
                <p className="mt-1 text-xs leading-5 text-white/50">常用只填 Base URL、秘钥和模型名；高级 JSON 不懂就别动。</p>
              </div>
              <button type="button" onClick={closeSettings} aria-label="关闭设置" className="xobi-icon-button h-10 w-10"><X className="h-4 w-4" /></button>
            </div>

            <div className="xobi-settings-scroll max-h-[calc(92vh-148px)] space-y-4 overflow-auto px-5 py-5">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
                <div className="ui-panel xobi-settings-card rounded-3xl border border-white/10 p-4">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div><p className="xobi-kicker text-white/42">Basic</p><p className="mt-1 text-xs text-white/55">这几个填好就能跑。</p></div>
                    <div className="inline-flex h-8 items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-3 text-[11px] text-emerald-200"><span>并发</span><span className="tabular-nums">{draftSettings.maxParallelTasks}</span></div>
                  </div>

                  <div className="grid gap-4">
                    <label className="xobi-field">
                      <span><Globe className="h-3.5 w-3.5 text-white/35" />API Base URL</span>
                      <input id="api-base-url-input" name="apiBaseUrl" value={draftSettings.apiBaseUrl} onChange={(event) => updateDraftSettings('apiBaseUrl', event.target.value)} placeholder="https://yunwu.ai/v1" className="xobi-input" />
                    </label>

                    <label className="xobi-field">
                      <span>API 秘钥</span>
                      <input id="api-key-input" name="apiKey" type="password" value={getBearerApiKeyFromHeaders(draftSettings.requestHeadersText)} onChange={(event) => updateDraftSettings('requestHeadersText', applyBearerApiKeyToHeaders(draftSettings.requestHeadersText, event.target.value))} placeholder="sk-..." autoComplete="off" className="xobi-input" />
                      <p>只保存在这台电脑的当前浏览器里；不会写入历史，也不会跟项目代码一起分享。</p>
                    </label>

                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="xobi-field"><span>文本模型</span><input id="text-model-input" name="textModel" value={draftSettings.textModel} onChange={(event) => updateDraftSettings('textModel', event.target.value)} placeholder="gemini-3.1-flash-lite-preview" className="xobi-input" /></label>
                      <label className="xobi-field"><span>生图模型</span><input id="image-model-input" name="imageModel" value={draftSettings.imageModel} onChange={(event) => updateDraftSettings('imageModel', event.target.value)} placeholder="gemini-3.1-flash-image-preview" className="xobi-input" /></label>
                    </div>
                  </div>
                </div>

                <div className="ui-panel xobi-settings-card rounded-3xl border border-white/10 p-4">
                  <div className="mb-4"><p className="xobi-kicker text-white/42">Runtime</p><p className="mt-1 text-xs text-white/55">速度和稳定性的平衡。</p></div>
                  <div className="grid gap-3">
                    <label className="xobi-number-field"><span>最大并发</span><input id="max-parallel-tasks-input" name="maxParallelTasks" type="number" min={1} max={20} value={draftSettings.maxParallelTasks} onChange={(event) => updateDraftSettings('maxParallelTasks', Number(event.target.value || 1))} className="xobi-input text-right tabular-nums" /></label>
                    <label className="xobi-number-field"><span>生图超时</span><input id="image-timeout-input" name="imageRequestTimeoutMs" type="number" min={1000} step={1000} value={draftSettings.imageRequestTimeoutMs} onChange={(event) => updateDraftSettings('imageRequestTimeoutMs', Number(event.target.value || 1000))} className="xobi-input text-right tabular-nums" /></label>
                    <p className="rounded-2xl border border-amber-300/15 bg-amber-400/10 px-3 py-2 text-[11px] leading-5 text-amber-100/75">如果上游慢，先加超时，不要盲目拉高并发。</p>
                  </div>
                </div>
              </div>

              <div className="ui-panel xobi-settings-card rounded-3xl border border-white/10 p-4">
                <div className="mb-4"><p className="xobi-kicker text-white/42">Raw Request</p><p className="mt-1 text-xs text-white/55">高级区：你填什么，就原样发什么。</p></div>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="xobi-field"><span>请求头 JSON</span><textarea id="request-headers-input" name="requestHeadersText" value={draftSettings.requestHeadersText} onChange={(event) => updateDraftSettings('requestHeadersText', event.target.value)} rows={6} placeholder={'{"Authorization":"Bearer xxx","x-api-key":"value"}'} className="xobi-input min-h-36 font-mono text-xs" /><p>必须是 JSON 对象。</p></label>
                  <label className="xobi-field"><span>URL 参数 JSON</span><textarea id="request-query-input" name="requestQueryParamsText" value={draftSettings.requestQueryParamsText} onChange={(event) => updateDraftSettings('requestQueryParamsText', event.target.value)} rows={6} placeholder={'{"key":"value"}'} className="xobi-input min-h-36 font-mono text-xs" /><p>会拼到请求地址上，必须是 JSON 对象。</p></label>
                </div>
              </div>

              {settingsError && <div className="xobi-message xobi-message-error">{settingsError}</div>}
              {connectionStatus !== 'idle' && (
                <div className={cn('xobi-message', connectionStatus === 'success' && 'xobi-message-success', connectionStatus === 'error' && 'xobi-message-error', connectionStatus === 'testing' && 'xobi-message-success')}>
                  <div className="flex items-start gap-2">{connectionStatus === 'testing' && <Loader2 className="mt-0.5 h-4 w-4 animate-spin" />}{connectionStatus === 'success' && <CheckCircle2 className="mt-0.5 h-4 w-4" />}{connectionStatus === 'error' && <XCircle className="mt-0.5 h-4 w-4" />}<span>{connectionMessage}</span></div>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 border-t border-white/10 bg-black/48 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-2 sm:flex-row">
                <button type="button" onClick={() => testConnection('quick')} disabled={connectionStatus === 'testing'} className={cn('xobi-soft-button h-10 justify-center px-4 text-sm font-semibold', connectionStatus === 'testing' && 'cursor-not-allowed opacity-45')}>{connectionStatus === 'testing' && connectionTestMode === 'quick' ? <><Loader2 className="h-4 w-4 animate-spin" />快速测试中...</> : <><Sparkles className="h-4 w-4" />快速测试</>}</button>
                <button type="button" onClick={() => testConnection('full')} disabled={connectionStatus === 'testing'} className={cn('xobi-soft-button h-10 justify-center px-4 text-sm font-semibold', connectionStatus === 'testing' && 'cursor-not-allowed opacity-45')}>{connectionStatus === 'testing' && connectionTestMode === 'full' ? <><Loader2 className="h-4 w-4 animate-spin" />完整测试中...</> : <><Sparkles className="h-4 w-4" />完整测试</>}</button>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <button type="button" onClick={clearLocalSettings} className="xobi-danger-action h-10 justify-center px-4 text-sm">清除本机设置</button>
                <button type="button" onClick={closeSettings} className="xobi-soft-button h-10 justify-center px-4 text-sm">取消</button>
                <button type="submit" className="xobi-primary-action h-10 justify-center px-5 text-sm">保存设置</button>
              </div>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
