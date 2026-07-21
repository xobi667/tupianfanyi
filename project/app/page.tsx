'use client';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type MouseEvent,
} from 'react';
import JSZip from 'jszip';
import {
  Download,
  FolderUp,
  Image as ImageIcon,
  Loader2,
  Moon,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Settings,
  Sparkles,
  Sun,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import {
  getPrimaryImageRequestTransport,
  normalizeSettings,
  type GatewayGenerateRequest,
  type GatewayGenerateResponse,
  type GatewaySettings,
} from '@/lib/gateway';
import { cn } from '@/lib/utils';
import {
  buildAutoProjectName,
  createHistoryTaskId,
  dataUrlToBlob,
  dataUrlToFile,
  downloadDataUrl,
  formatFileSize,
  getPathKey,
  getSupportedImageFileMimeType,
  getSourceFileKey,
  getTaskPathInfo,
  isSupportedImageFile,
  MAX_SINGLE_IMAGE_SIZE_BYTES,
  MAX_UPLOAD_BATCH_COUNT,
  MAX_UPLOAD_TOTAL_SIZE_BYTES,
  normalizeRelativePath,
  readFileAsDataUrl,
  resolveOutputRelativePath,
  runWithConcurrencyLimit,
  sanitizePathSegment,
  UPLOAD_READ_CONCURRENCY,
} from './workbench/files';
import {
  applyModelRecommendedSettings,
  CURRENT_SETTINGS_SCHEMA_VERSION,
  DEFAULT_API_BASE_URL,
  DEFAULT_GEMINI_IMAGE_MODEL,
  DEFAULT_GEMINI_TEXT_MODEL,
  DEFAULT_SETTINGS,
  getImageModelCostRisk,
  getPersistableSettings,
  MAX_PARALLEL_IMAGE_REQUESTS,
  migrateStoredSettings,
  SETTINGS_STORAGE_KEY,
  SETTINGS_SCHEMA_STORAGE_KEY,
  stripApiBaseUrlForDisplay,
} from './workbench/settings';
import {
  getAspectRatioOption,
  LANGUAGE_OPTIONS,
  type OutputAspectRatio,
} from './workbench/options';
import { BatchConsole } from './workbench/batch-console';
import {
  applyPausedTaskState,
  buildRedrawTaskUpdate,
  buildRemoveOnlyTaskUpdate,
  createBatchStageRunner,
  createBatchTaskOutcomeUpdaters,
  createBatchTaskPausedLookup,
  buildResumeTranslatedTaskUpdate,
  buildTranslationDetectionTaskUpdate,
  createBatchPauseGuard,
  createBatchTaskUpdateController,
  createImageQueueThrottle,
  getBatchRunCompletionState,
  getBatchRunStartedAt,
  getPausableTaskIds,
  getRequiredBatchTaskBase64Data,
  getPausedTaskIds,
  getProcessableBatchTasks,
  isPausableBatchTask,
  prepareFailedTaskRetries,
  prepareReprocessTasks,
  ProcessingError,
  shouldRedrawTranslatedTask,
  shouldResumeCopiedTask,
  shouldResumeTranslatedTask,
  type BatchTaskErrorKind,
  type ProcessingErrorOptions,
  type BatchTaskPhase,
  type BatchTaskStatus,
  type ReprocessMode,
} from './workbench/batch-state';
import { HomeUploadHero } from './workbench/home-upload-hero';
import { LanguageSelect } from './workbench/language-select';
import {
  acknowledgeGenerateJobFamily,
  fetchGenerateApiResponse,
} from './workbench/generate-job-client';
import {
  generateDirectImageEdit,
  generateStructuredImageEdit,
  shouldRunOcrTranslationFlow,
} from './workbench/image-generation';
import {
  buildDetectionFallbackResult,
  buildDetectionStageResult,
  detectImageText,
  extractAndTranslateImageText,
  getResponseText,
  mergeOcrResultWithDetectionError,
  type OcrTaskResult,
} from './workbench/ocr';
import { HistoryContextMenu } from './workbench/history-context-menu';
import { HistoryDetail } from './workbench/history-detail';
import { HistoryDialogHeader } from './workbench/history-dialog-header';
import { HistoryGallery } from './workbench/history-gallery';
import {
  buildHistoryTaskPayload,
  buildSaveOriginalImagePayload,
  buildSaveResultImagePayload,
  mergeHistoryTaskImages,
  postHistory,
  resolveHistoryImageIdentity,
  toHistoryImage,
  type HistoryImageRecord,
  type HistoryTaskRecord,
} from './workbench/history-client';
import { SettingsDialog } from './workbench/settings-dialog';
import { ImageStudio } from './workbench/image-studio';
import { StartConfirmDialog, type StartConfirmDialogState } from './workbench/start-confirm-dialog';
import { TaskContextMenu } from './workbench/task-context-menu';
import { TaskPreviewDialog } from './workbench/task-preview-dialog';
import { PendingUploadDialog, ReturnHomeDialog } from './workbench/workspace-dialogs';
import {
  TaskGroupsView,
  type TaskSelectEvent,
} from './workbench/task-gallery';

type TaskStatus = BatchTaskStatus;
type ProcessMode = 'translate_and_remove' | 'translate_only' | 'remove_only';
type BatchRunState = 'idle' | 'running' | 'paused' | 'completed';
type ConnectionStatus = 'idle' | 'testing' | 'success' | 'error';
type ConnectionTestMode = 'quick' | 'full';
type TaskPhase = BatchTaskPhase;
type UploadMode = 'append' | 'new';

interface PendingUpload {
  files: File[];
  sourceKind: 'file' | 'folder';
}

type TaskErrorKind = BatchTaskErrorKind;

type TaskResult = OcrTaskResult;

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
  generationOperationId?: string;
  reprocessMode?: ReprocessMode;
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

type StartConfirmState = StartConfirmDialogState;

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


const MAX_STAGE_ATTEMPTS = 1;
const RETRY_DELAYS_MS = [2000];
const RATE_LIMIT_RETRY_DELAYS_MS = [2000];
const HISTORY_LIST_PAGE_SIZE = 60;
const HISTORY_DETAIL_PAGE_SIZE = 24;
const TRANSIENT_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
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

function getRetryDelayMs(retryIndex: number, error?: ProcessingError) {
  const delays = error?.kind === 'rate_limit' || error?.kind === 'server'
    ? RATE_LIMIT_RETRY_DELAYS_MS
    : RETRY_DELAYS_MS;
  return delays[Math.min(retryIndex - 1, delays.length - 1)];
}

function waitForDelay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
      return;
    }

    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', abortFromSignal);
      resolve();
    }, ms);

    function abortFromSignal() {
      window.clearTimeout(timer);
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    }

    signal?.addEventListener('abort', abortFromSignal, { once: true });
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

function getPreferredScrollBehavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

function createGenerationOperationId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function getErrorClassification(
  message: string,
  status?: number,
): Pick<ProcessingErrorOptions, 'kind' | 'retryable'> {
  const lowered = message.toLowerCase();
  const isUpstreamCapacityOrChannelError = /上游负载已饱和|无可用渠道|distributor|渠道|中转当前没有可用上游|通道拥挤/i.test(message);

  if (isUpstreamCapacityOrChannelError) {
    return {
      kind: status === 429 ? 'rate_limit' : 'server',
      retryable: false,
    };
  }

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
  return Math.min(Math.max(settings.maxParallelTasks, 1), MAX_PARALLEL_IMAGE_REQUESTS);
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

async function callGenerateApi(
  payload: GatewayGenerateRequest,
  signal?: AbortSignal,
) {
  let response: Response;

  try {
    response = await fetchGenerateApiResponse(payload, signal);
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
    const classification = response.headers.get('X-Upstream-Availability') === 'unavailable'
      ? { kind: 'server' as const, retryable: false }
      : getErrorClassification(finalMessage, response.status);

    throw new ProcessingError(finalMessage, {
      ...classification,
      status: response.status,
      requestId: response.headers.get('X-Debug-Request-Id') ?? undefined,
    });
  }

  return parsed as GatewayGenerateResponse;
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

export default function ImageTranslator() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [tasks, setTasks] = useState<ImageTask[]>([]);
  const [targetLanguage, setTargetLanguage] = useState('中文');
  const [outputAspectRatio, setOutputAspectRatio] =
    useState<OutputAspectRatio>('original');
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [batchRunState, setBatchRunState] = useState<BatchRunState>('idle');
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [processMode, setProcessMode] = useState<ProcessMode>('translate_only');
  const [settings, setSettings] = useState<GatewaySettings>(DEFAULT_SETTINGS);
  const [draftSettings, setDraftSettings] =
    useState<GatewaySettings>(DEFAULT_SETTINGS);
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [imageStudioOpen, setImageStudioOpen] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('idle');
  const [connectionMessage, setConnectionMessage] = useState('');
  const [connectionTestMode, setConnectionTestMode] =
    useState<ConnectionTestMode>('quick');
  const [skippedDuplicateCount, setSkippedDuplicateCount] = useState(0);
  const [batchStartedAt, setBatchStartedAt] = useState<number | null>(null);
  const [batchCompletedAt, setBatchCompletedAt] = useState<number | null>(null);
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
  const [consoleFocusRequested, setConsoleFocusRequested] = useState(false);
  const [taskMenu, setTaskMenu] = useState<TaskMenuState | null>(null);
  const [taskPreview, setTaskPreview] = useState<{ taskId: string; kind: 'original' | 'result' } | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(() => new Set());
  const [undoStack, setUndoStack] = useState<RemovedTaskRecord[][]>([]);
  const [softDeletedTasks, setSoftDeletedTasks] = useState<RemovedTaskRecord[]>([]);

  useEffect(() => {
    const storedTheme = document.documentElement.dataset.theme;
    if (storedTheme === 'light' || storedTheme === 'dark') {
      setTheme(storedTheme);
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      document.documentElement.style.colorScheme = next;
      window.localStorage.setItem('xobi-theme', next);
      return next;
    });
  }, []);

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
  const historyReturnFocusTaskIdRef = useRef<string | null>(null);
  const selectionOverlayRef = useRef<HTMLDivElement>(null);
  const tasksRef = useRef<ImageTask[]>([]);
  const draftSettingsRef = useRef<GatewaySettings>(DEFAULT_SETTINGS);
  const taskRenderFrameRef = useRef<number | null>(null);
  const selectedTaskIdsRef = useRef<Set<string>>(new Set());
  const selectedHistoryTaskIdRef = useRef<string | null>(null);
  const selectedHistoryTaskIdsRef = useRef<Set<string>>(new Set());
  const softDeletedTasksRef = useRef<RemovedTaskRecord[]>([]);
  const activeTaskControllersRef = useRef<Map<string, AbortController>>(new Map());
  const activeImageRequestTaskIdsRef = useRef<Set<string>>(new Set());
  const processingBatchRef = useRef(false);
  const uploadInProgressRef = useRef(false);
  const confirmedBatchImageModelRef = useRef<string | null>(null);
  const historyMutationQueuesRef = useRef<Map<string, Promise<void>>>(new Map());
  const historyRefreshTimerRef = useRef<number | null>(null);
  const historyRefreshPromiseRef = useRef<Promise<HistoryTaskRecord[]> | null>(null);
  const historyRefreshAgainRef = useRef(false);
  const historyDetailRequestSeqRef = useRef(0);
  const autoRestoreAttemptedRef = useRef(false);
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
  const cancelHistorySelectionRef = useRef<(() => void) | null>(null);
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

  const openBatchConsole = useCallback(() => {
    setConsoleFocusRequested(true);
    if (window.matchMedia('(max-width: 1279px)').matches) {
      setMobileConsoleOpen(true);
      return;
    }

    openDesktopConsole();
  }, [openDesktopConsole]);

  const closeDesktopConsole = useCallback(() => {
    clearConsoleCloseTimer();
    setDesktopConsoleOpen(false);
    setConsoleFocusRequested(false);
  }, [clearConsoleCloseTimer]);

  const scheduleDesktopConsoleClose = useCallback(() => {
    clearConsoleCloseTimer();
    consoleCloseTimerRef.current = window.setTimeout(() => {
      setDesktopConsoleOpen(false);
      setConsoleFocusRequested(false);
      consoleCloseTimerRef.current = null;
    }, 220);
  }, [clearConsoleCloseTimer]);

  useEffect(() => () => clearConsoleCloseTimer(), [clearConsoleCloseTimer]);

  useEffect(() => () => {
    if (taskRenderFrameRef.current !== null) {
      window.cancelAnimationFrame(taskRenderFrameRef.current);
      taskRenderFrameRef.current = null;
    }
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 1279px)');
    const handleBreakpointChange = ({ matches }: { matches: boolean }) => {
      if (matches) {
        setDesktopConsoleOpen(false);
        setConsoleFocusRequested(false);
      } else {
        setMobileConsoleOpen(false);
        setConsoleFocusRequested(false);
      }
    };

    handleBreakpointChange(mediaQuery);
    const listener = (event: MediaQueryListEvent) => handleBreakpointChange(event);
    mediaQuery.addEventListener('change', listener);
    return () => mediaQuery.removeEventListener('change', listener);
  }, []);

  useEffect(() => {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    const storedSchemaVersion = window.localStorage.getItem(SETTINGS_SCHEMA_STORAGE_KEY);

    if (!raw) {
      window.localStorage.setItem(SETTINGS_SCHEMA_STORAGE_KEY, CURRENT_SETTINGS_SCHEMA_VERSION);
      setSettingsHydrated(true);
      return;
    }

    try {
      const parsedStored = JSON.parse(raw) as Partial<GatewaySettings>;
      const stored = storedSchemaVersion === CURRENT_SETTINGS_SCHEMA_VERSION
        ? parsedStored
        : { ...parsedStored, skipOcr: true };
      const migratedSettings = migrateStoredSettings(stored);
      const mergedSettings = normalizeSettings(
        applyModelRecommendedSettings(migratedSettings),
        {
          requireApiKey: false,
        },
      );

      setSettings(mergedSettings);
      setDraftSettings(mergedSettings);
      draftSettingsRef.current = mergedSettings;
      window.localStorage.setItem(SETTINGS_SCHEMA_STORAGE_KEY, CURRENT_SETTINGS_SCHEMA_VERSION);
    } catch {
      window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
      window.localStorage.setItem(SETTINGS_SCHEMA_STORAGE_KEY, CURRENT_SETTINGS_SCHEMA_VERSION);
    } finally {
      setSettingsHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!settingsHydrated) return;
    try {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(getPersistableSettings(settings)));
    } catch {
      setGlobalError('本机浏览器设置保存失败，可能是存储空间已满或隐私模式限制。');
    }
  }, [settings, settingsHydrated]);

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
    const duration = tone === 'error' ? 12000 : /Ctrl\+Z|撤销/.test(globalError) ? 8000 : 3600;
    const timer = window.setTimeout(() => {
      setGlobalError((current) => current === globalError ? null : current);
    }, duration);

    return () => window.clearTimeout(timer);
  }, [globalError]);

  useEffect(() => {
    if (tasks.length > 0) {
      return;
    }

    setBatchStartedAt(null);
    setBatchCompletedAt(null);
    setBatchRunState('idle');
    setProcessMode('translate_only');
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
    selectedHistoryTaskIdRef.current = selectedHistoryTaskId;
  }, [selectedHistoryTaskId]);

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
    if (taskPreview && !tasks.some((task) => task.id === taskPreview.taskId)) {
      setTaskPreview(null);
    }
  }, [taskPreview, tasks]);

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
    const frame = window.requestAnimationFrame(() => {
      if (selectedHistoryTaskId) {
        historyDialogRef.current?.querySelector<HTMLElement>('[data-history-detail-back]')?.focus();
        return;
      }

      const taskId = historyReturnFocusTaskIdRef.current;
      if (!taskId) return;
      historyDialogRef.current
        ?.querySelector<HTMLElement>(`[data-history-task-id="${CSS.escape(taskId)}"]`)
        ?.focus();
      historyReturnFocusTaskIdRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [historyOpen, selectedHistoryTaskId]);

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
    if (!settingsOpen && !confirmDialog && !startConfirm && !returnHomeConfirm && !pendingUpload && !taskPreview) return;
    setDesktopConsoleOpen(false);
    setMobileConsoleOpen(false);
    setConsoleFocusRequested(false);
  }, [confirmDialog, pendingUpload, returnHomeConfirm, settingsOpen, startConfirm, taskPreview]);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      const element = target instanceof HTMLElement ? target : null;
      return Boolean(element?.closest('input, textarea, select, [contenteditable="true"]'));
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (settingsOpen || confirmDialog || startConfirm || returnHomeConfirm || pendingUpload || taskPreview || isEditableTarget(event.target)) return;

      if (event.key === 'Escape' && desktopConsoleOpen && !historyOpen) {
        event.preventDefault();
        closeDesktopConsole();
        return;
      }

      if (historyOpen) {
        if (event.key === 'Escape') {
          event.preventDefault();
          const wasSelecting = historySelectionDragRef.current !== null;
          cancelHistorySelectionRef.current?.();
          hideSelectionOverlay();
          if (historyMenu) setHistoryMenu(null);
          if (selectedHistoryTaskId) {
            setSelectedHistoryTaskId(null);
          }
          else if (wasSelecting || selectedHistoryTaskIdsRef.current.size > 0) {
            selectedHistoryTaskIdsRef.current = new Set();
            setSelectedHistoryTaskIds(selectedHistoryTaskIdsRef.current);
          }
          else if (!historyMenu) setHistoryOpen(false);
          return;
        }
        if (!selectedHistoryTaskId && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
          event.preventDefault();
          cancelHistorySelectionRef.current?.();
          hideSelectionOverlay();
          setHistoryMenu(null);
          selectedHistoryTaskIdsRef.current = new Set(historyTasks.map((task) => task.id));
          setSelectedHistoryTaskIds(selectedHistoryTaskIdsRef.current);
          return;
        }
        if (!selectedHistoryTaskId && (event.key === 'Delete' || event.key === 'Backspace')) {
          const selectedIds = [...selectedHistoryTaskIdsRef.current];
          if (selectedIds.length > 0) {
            event.preventDefault();
            setHistoryMenu(null);
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
  }, [closeDesktopConsole, confirmDialog, desktopConsoleOpen, historyMenu, historyOpen, historyTasks, isProcessingBatch, pendingUpload, returnHomeConfirm, selectedHistoryTaskId, settingsOpen, startConfirm, taskPreview]);

  const refreshHistory = async () => {
    if (historyRefreshPromiseRef.current) {
      historyRefreshAgainRef.current = true;
      return historyRefreshPromiseRef.current;
    }

    const refreshPromise = (async () => {
    try {
      const response = await fetch(`/api/history?scope=translation&preview=1&limit=${HISTORY_LIST_PAGE_SIZE}`);
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
            images: historyDetailTaskIds.has(task.id)
              ? existing.images
              : task.images.map((image) => {
                const existingImage = existing.images.find((item) => item.id === image.id);
                return existingImage?.originalDataUrl !== undefined || existingImage?.resultDataUrl !== undefined
                  ? { ...image, originalDataUrl: existingImage.originalDataUrl, resultDataUrl: existingImage.resultDataUrl }
                  : image;
              }),
            hasMoreImages: historyDetailTaskIds.has(task.id)
              ? existing.hasMoreImages
              : task.hasMoreImages,
            imageOffset: historyDetailTaskIds.has(task.id)
              ? existing.imageOffset
              : task.imageOffset,
            imageLimit: historyDetailTaskIds.has(task.id)
              ? existing.imageLimit
              : task.imageLimit,
            totalImages: historyDetailTaskIds.has(task.id)
              ? existing.totalImages
              : task.totalImages,
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
      const response = await fetch(`/api/history?scope=translation&preview=1&limit=${HISTORY_LIST_PAGE_SIZE}&cursor=${historyListCursor}`);
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
    let cancelled = false;
    void refreshHistory().then((historyRecords) => {
      if (cancelled || autoRestoreAttemptedRef.current || tasksRef.current.length > 0) return;
      const interruptedWorkspace = historyRecords.find((task) => task.status === 'running');
      if (!interruptedWorkspace) return;
      autoRestoreAttemptedRef.current = true;
      void restoreHistoryTask(interruptedWorkspace.id, { automatic: true });
    });
    return () => {
      cancelled = true;
      if (historyRefreshTimerRef.current !== null) {
        window.clearTimeout(historyRefreshTimerRef.current);
      }
    };
  }, []);

  const getHistoryTaskName = (tasksForName: ImageTask[], nameOverride?: string) =>
    nameOverride?.trim() || activeProjectName.trim() || buildAutoProjectName(tasksForName, targetLanguage);

  const getHistoryTaskProcessMode = (historyTask: HistoryTaskRecord): ProcessMode => (
    historyTask.mode === 'translate_and_remove' || historyTask.mode === 'remove_only' || historyTask.mode === 'translate_only'
      ? historyTask.mode
      : processMode
  );

  const getHistoryTaskOutputAspectRatio = (historyTask: HistoryTaskRecord): OutputAspectRatio => (
    (historyTask.ratio === '原图' ? 'original' : historyTask.ratio) as OutputAspectRatio
  );

  const getHistoryTaskPayload = (
    historyTaskId: string,
    allTasks: ImageTask[],
    nameOverride?: string,
    metadataOverride?: {
      language?: string;
      ratio?: OutputAspectRatio;
      mode?: ProcessMode;
    },
  ) =>
    buildHistoryTaskPayload({
      historyTaskId,
      tasks: allTasks,
      name: getHistoryTaskName(allTasks, nameOverride),
      language: metadataOverride?.language ?? targetLanguage,
      ratio: (metadataOverride?.ratio ?? outputAspectRatio) === 'original'
        ? '原图'
        : (metadataOverride?.ratio ?? outputAspectRatio),
      mode: metadataOverride?.mode ?? processMode,
      settingsSummary: {
        apiBaseUrl: stripApiBaseUrlForDisplay(settings.apiBaseUrl),
        textModel: settings.textModel,
        imageModel: settings.imageModel,
        maxParallelTasks: settings.maxParallelTasks,
        imageRequestTimeoutMs: settings.imageRequestTimeoutMs,
        skipOcr: settings.skipOcr,
        transport: getPrimaryImageRequestTransport(settings.imageModel, settings),
      },
    });

  const applyHistoryMutationResult = (parsed: Awaited<ReturnType<typeof postHistory>>) => {
    setHistoryTasks((current) => {
      if (parsed.tasks) {
        const currentById = new Map(current.map((task) => [task.id, task]));
        return (parsed.tasks as HistoryTaskRecord[]).map((task) => mergeHistoryTaskImages(currentById.get(task.id), task, false));
      }

      if (!parsed.task) return current;
      const incomingTask = parsed.task as HistoryTaskRecord;
      const existing = current.find((task) => task.id === incomingTask.id);
      const mergedTask = mergeHistoryTaskImages(existing, incomingTask, false);
      return [mergedTask, ...current.filter((task) => task.id !== incomingTask.id)];
    });
    if (parsed.resourceDir) setResourceDir(parsed.resourceDir);
  };

  const persistHistoryTask = async (
    historyTaskId: string,
    allTasks: ImageTask[],
    nameOverride?: string,
    metadataOverride?: {
      language?: string;
      ratio?: OutputAspectRatio;
      mode?: ProcessMode;
    },
  ) => {
    const taskPayload = getHistoryTaskPayload(historyTaskId, allTasks, nameOverride, metadataOverride);
    const parsed = await postHistory('upsert-task', {
      task: taskPayload,
      images: taskPayload.images,
    });
    applyHistoryMutationResult(parsed);
  };

  const persistOriginalImage = async (task: ImageTask) => {
    const identity = resolveHistoryImageIdentity(task);
    if (!identity || !task.historyImageId) return;
    await postHistory('save-image', buildSaveOriginalImagePayload(task, identity));
  };

  const persistResultImage = async (task: ImageTask, fallbackHistoryTaskId?: string) => {
    const identity = resolveHistoryImageIdentity(task, fallbackHistoryTaskId);
    if (!task.generatedUrl) return;
    if (!identity) {
      throw new Error('结果图已返回，但缺少历史任务标识，无法安全保存。');
    }

    await postHistory('save-image', buildSaveResultImagePayload(task, identity));
  };

  const scheduleHistoryMutation = (
    queueKey: string,
    mutation: () => Promise<unknown>,
  ) => {
    const previous = historyMutationQueuesRef.current.get(queueKey) ?? Promise.resolve();
    let queuedMutation: Promise<void>;
    queuedMutation = previous
      .catch(() => undefined)
      .then(async () => {
        await mutation();
        scheduleHistoryRefresh();
      })
      .catch((error) => {
        setGlobalError(getErrorMessage(error));
        throw error;
      })
      .finally(() => {
        if (historyMutationQueuesRef.current.get(queueKey) === queuedMutation) {
          historyMutationQueuesRef.current.delete(queueKey);
        }
      });
    historyMutationQueuesRef.current.set(queueKey, queuedMutation);
    return queuedMutation;
  };

  const flushScheduledHistoryMutations = async () => {
    while (historyMutationQueuesRef.current.size > 0) {
      await Promise.allSettled(Array.from(historyMutationQueuesRef.current.values()));
    }
  };

  const persistTaskProgress = (task: ImageTask, updates: Partial<ImageTask>) => {
    const latestTask = tasksRef.current.find((item) => item.id === task.id) ?? task;
    const identity = resolveHistoryImageIdentity(latestTask, activeHistoryTaskId ?? undefined);
    if (!identity) return;

    const merged = {
      ...latestTask,
      ...updates,
      historyTaskId: identity.historyTaskId,
      historyImageId: identity.historyImageId,
    };
    const queueKey = `${identity.historyTaskId}:${identity.historyImageId}`;
    void scheduleHistoryMutation(queueKey, () => postHistory('update-image', {
      taskId: identity.historyTaskId,
      imageId: identity.historyImageId,
      patch: toHistoryImage(merged),
    })).catch(() => undefined);
  };

  const flushCurrentWorkspaceToHistory = async () => {
    await flushScheduledHistoryMutations();
    const currentTasks = tasksRef.current;
    const historyTaskId = activeHistoryTaskId;
    if (!historyTaskId || currentTasks.length === 0) return;
    await persistHistoryTask(historyTaskId, currentTasks);
    await Promise.all(
      currentTasks.map(async (task) => {
        await persistOriginalImage(task);
        await persistResultImage(task, historyTaskId);
      }),
    );
    await postHistory('append-log', {
      taskId: historyTaskId,
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
    const requestSeq = historyDetailRequestSeqRef.current + 1;
    historyDetailRequestSeqRef.current = requestSeq;
    const response = await fetch(
      `/api/history?taskId=${encodeURIComponent(historyTaskId)}&includeData=1&imageOffset=${offset}&imageLimit=${limit}`,
    );
    const parsed = await response.json();
    if (!response.ok) throw new Error(parsed?.error?.message ?? '历史任务读取失败。');
    const detailTask = parsed.task as HistoryTaskRecord;
    const isStillSelected = selectedHistoryTaskIdRef.current === historyTaskId && historyDetailRequestSeqRef.current === requestSeq;
    if (isStillSelected) {
      setSelectedHistoryLogs(parsed.logs ?? '');
      setHistoryDetailHasMore(Boolean(parsed.hasMoreImages ?? detailTask.hasMoreImages));
    }
    setHistoryDetailTaskIds((current) => new Set(current).add(detailTask.id));
    setHistoryTasks((current) => {
      const existing = current.find((task) => task.id === detailTask.id);
      const mergedTask = mergeHistoryTaskImages(existing, detailTask, Boolean(options.append));
      return [mergedTask, ...current.filter((task) => task.id !== detailTask.id)].sort((a, b) => b.updatedAt - a.updatedAt);
    });
    return detailTask;
  };

  const selectHistoryTask = async (historyTaskId: string) => {
    historyReturnFocusTaskIdRef.current = historyTaskId;
    selectedHistoryTaskIdsRef.current = new Set();
    setSelectedHistoryTaskIds(selectedHistoryTaskIdsRef.current);
    setHistoryMenu(null);
    selectedHistoryTaskIdRef.current = historyTaskId;
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
    if (activeHistoryTaskId === historyTaskId && tasksRef.current.length > 0) {
      setGlobalError('这个历史项目正在当前工作台中使用，已取消删除。');
      return;
    }
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

      if (selectedHistoryTaskId === historyTaskId) {
        if (nextSelectedTask) {
          selectedHistoryTaskIdRef.current = nextSelectedTask.id;
          setSelectedHistoryTaskId(nextSelectedTask.id);
          await loadHistoryTaskDetail(nextSelectedTask.id);
        } else {
          selectedHistoryTaskIdRef.current = null;
          setSelectedHistoryTaskId(null);
          setSelectedHistoryLogs('');
          setHistoryDetailTaskIds(new Set());
        }
      }
      setGlobalError('已删除 1 个历史项目。');
    } catch (error) {
      setGlobalError(getErrorMessage(error));
    } finally {
      setHistoryLoading(false);
    }
  };

  const requestDeleteHistoryTask = (historyTaskId: string) => {
    if (processingBatchRef.current || isProcessingBatch) {
      setGlobalError('请先暂停当前批次并等待保存完成，再删除历史项目。');
      return;
    }
    if (activeHistoryTaskId === historyTaskId && tasksRef.current.length > 0) {
      setGlobalError('这个历史项目正在当前工作台中使用。请先返回主页或切换到其他项目，再删除它。');
      return;
    }
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
    if (activeHistoryTaskId && uniqueIds.includes(activeHistoryTaskId) && tasksRef.current.length > 0) {
      setGlobalError('选中项包含当前工作台正在使用的项目，已取消删除。');
      return;
    }
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
        selectedHistoryTaskIdRef.current = null;
        setSelectedHistoryTaskId(null);
        setSelectedHistoryLogs('');
        if (nextSelectedTask) {
          selectedHistoryTaskIdRef.current = nextSelectedTask.id;
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
    if (processingBatchRef.current || isProcessingBatch) {
      setGlobalError('请先暂停当前批次并等待保存完成，再删除历史项目。');
      return;
    }
    const uniqueIds = [...new Set(historyTaskIds)].filter(Boolean);
    if (uniqueIds.length === 0 || historyLoading) return;
    if (activeHistoryTaskId && uniqueIds.includes(activeHistoryTaskId) && tasksRef.current.length > 0) {
      setGlobalError('选中的历史项目包含当前工作台正在使用的项目。请先返回主页或切换项目，再删除。');
      return;
    }
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
      const usedProjectRoots = new Set<string>();
      for (const taskId of uniqueIds) {
        const { task, logs } = await fetchFullHistoryTaskWithData(taskId);
        const baseRoot = sanitizePathSegment(task.name || task.id);
        let safeRoot = baseRoot;
        let rootSuffix = 2;
        while (usedProjectRoots.has(safeRoot.toLowerCase())) {
          safeRoot = `${baseRoot} (${rootSuffix})`;
          rootSuffix += 1;
        }
        usedProjectRoots.add(safeRoot.toLowerCase());
        task.images.forEach((image) => {
          if (image.originalDataUrl) {
            const originalRelativePath = normalizeRelativePath(image.relativePath) || image.name;
            zip.file(buildUniqueRelativePath(`${safeRoot}/originals/${originalRelativePath}`, usedPaths), dataUrlToBlob(image.originalDataUrl));
          }
          if (image.resultDataUrl) {
            const resultRelativePath = normalizeRelativePath(image.outputRelativePath) || image.name;
            zip.file(buildUniqueRelativePath(`${safeRoot}/results/${resultRelativePath}`, usedPaths), dataUrlToBlob(image.resultDataUrl));
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
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setGlobalError(`已打包 ${uniqueIds.length} 个历史项目。`);
    } catch (error) {
      setGlobalError(getErrorMessage(error));
    } finally {
      setHistoryLoading(false);
    }
  };

  const restoreHistoryTask = async (
    historyTaskId: string,
    options?: { automatic?: boolean },
  ) => {
    if (uploadInProgressRef.current) {
      setGlobalError('图片仍在读取和保存，请完成上传后再恢复其他历史任务。');
      return;
    }
    if (processingBatchRef.current || isProcessingBatch) {
      setGlobalError('请先暂停当前批次并等待已提交请求保存完成，再恢复其他历史任务。');
      return;
    }
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
            status: image.status === 'success' || image.status === 'copied' || image.status === 'paused'
              ? image.status
              : image.status === 'detecting' || image.status === 'extracting' || image.status === 'generating' || image.status === 'retrying'
                ? 'paused'
                : 'idle',
            phase: image.phase ?? 'idle',
            pathKey: image.pathKey,
            relativePath: image.relativePath,
            outputRelativePath: image.outputRelativePath,
            groupLabel: image.groupLabel,
            sourceKind: image.sourceKind ?? 'file',
            sourceFileKey: image.pathKey,
            historyTaskId,
            historyImageId: image.id,
            generationOperationId: image.generationOperationId,
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
      clearWorkspaceTransientState();
      confirmedBatchImageModelRef.current =
        historyTask.settingsSummary?.imageModel?.trim().replace(/^models\//, '') ||
        null;
      setTasks(restoredTasks);
      tasksRef.current = restoredTasks;
      setTargetLanguage(historyTask.language);
      setOutputAspectRatio(getHistoryTaskOutputAspectRatio(historyTask));
      setProcessMode(getHistoryTaskProcessMode(historyTask));
      setActiveHistoryTaskId(historyTask.id);
      setActiveProjectName(historyTask.name);
      setDraftProjectName(historyTask.name);
      setSelectedHistoryTaskId(historyTask.id);
      setHistoryLogs(logs);
      setSelectedHistoryLogs(logs);
      setHistoryOpen(false);
      setGlobalError(options?.automatic ? '已恢复上次未完成的工作台，点击“继续”即可接回原任务。' : null);
      window.setTimeout(() => workbenchRef.current?.scrollIntoView({ behavior: getPreferredScrollBehavior(), block: 'start' }), 0);
    } catch (error) {
      setGlobalError(getErrorMessage(error));
    } finally {
      setHistoryLoading(false);
    }
  };

  const openSettings = () => {
    setDraftSettings(settings);
    draftSettingsRef.current = settings;
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
    const nextDraftSettings = {
      ...draftSettingsRef.current,
      [key]: value,
    };
    draftSettingsRef.current = nextDraftSettings;
    setDraftSettings(nextDraftSettings);
    setSettingsError(null);
    setConnectionStatus('idle');
    setConnectionMessage('');
  };

  const performAddFiles = async (
    files: FileList | File[],
    sourceKind: 'file' | 'folder' = 'file',
    uploadMode: UploadMode = 'append',
  ) => {
    const supportedFiles = Array.from(files).filter((file) => isSupportedImageFile(file));
    const oversizedFiles = supportedFiles.filter((file) => file.size > MAX_SINGLE_IMAGE_SIZE_BYTES);
    const countLimitedFiles = supportedFiles
      .filter((file) => file.size <= MAX_SINGLE_IMAGE_SIZE_BYTES)
      .slice(0, MAX_UPLOAD_BATCH_COUNT);
    const incomingFiles: File[] = [];
    let acceptedBytes = 0;
    let totalSizeLimitedCount = 0;
    countLimitedFiles.forEach((file) => {
      if (acceptedBytes + file.size > MAX_UPLOAD_TOTAL_SIZE_BYTES) {
        totalSizeLimitedCount += 1;
        return;
      }
      acceptedBytes += file.size;
      incomingFiles.push(file);
    });
    const limitedCount = Math.max(supportedFiles.length - oversizedFiles.length - countLimitedFiles.length, 0);

    if (incomingFiles.length === 0) {
      setGlobalError(
        oversizedFiles.length > 0
          ? `图片太大，单张最多 ${formatFileSize(MAX_SINGLE_IMAGE_SIZE_BYTES)}。`
          : '没有检测到支持的图片；请使用 JPG、PNG、WebP、GIF、BMP 或 AVIF。',
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

      const existingFolderPathKeys = new Set(
        existingTasks
          .filter((task) => task.sourceKind === 'folder')
          .map((task) => task.pathKey),
      );
      const existingSourceFileKeys = new Set(
        existingTasks.flatMap((task) => [task.sourceFileKey, task.pathKey].filter(Boolean)),
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
        if (shouldCreateNewProject) {
          confirmedBatchImageModelRef.current = null;
          setProcessMode('translate_only');
          setBatchStartedAt(null);
          setBatchCompletedAt(null);
          setBatchRunState('idle');
          setSkippedDuplicateCount(0);
          setHistoryLogs('');
          setActiveHistoryTaskId(historyTaskId);
          setSelectedHistoryTaskId(historyTaskId);
        }
        tasksRef.current = nextTasks;
        setTasks(nextTasks);
        if (shouldCreateNewProject) {
          setActiveProjectName(nextProjectName);
          setDraftProjectName(nextProjectName);
          setIsEditingProjectName(false);
        }
        await persistHistoryTask(
          historyTaskId,
          nextTasks,
          nextProjectName,
          shouldCreateNewProject ? { mode: 'translate_only' } : undefined,
        );
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
        totalSizeLimitedCount > 0
          ? `单次图片总大小最多 ${formatFileSize(MAX_UPLOAD_TOTAL_SIZE_BYTES)}，剩余 ${totalSizeLimitedCount} 张已跳过。`
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

  const addFiles = async (
    files: FileList | File[],
    sourceKind: 'file' | 'folder' = 'file',
    uploadMode: UploadMode = 'append',
  ) => {
    if (processingBatchRef.current || isProcessingBatch) {
      setGlobalError('请先暂停当前批次，再添加图片或新建项目。');
      return;
    }
    if (uploadInProgressRef.current) {
      setGlobalError('上一批图片仍在读取和保存，请完成后再添加。');
      return;
    }

    uploadInProgressRef.current = true;
    setIsUploading(true);
    try {
      await performAddFiles(files, sourceKind, uploadMode);
    } finally {
      uploadInProgressRef.current = false;
      setIsUploading(false);
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
    if (processingBatchRef.current || isProcessingBatch) {
      setGlobalError('请先暂停当前批次，再添加图片或新建项目。');
      return;
    }
    if (uploadInProgressRef.current) {
      setGlobalError('上一批图片仍在读取和保存，请稍候。');
      return;
    }
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
    if (processingBatchRef.current || uploadInProgressRef.current) {
      setGlobalError(processingBatchRef.current ? '请先暂停当前批次，再添加图片。' : '上一批图片仍在读取和保存，请稍候。');
      return;
    }
    fileInputRef.current?.click();
  };

  const openFolderPicker = () => {
    if (processingBatchRef.current || uploadInProgressRef.current) {
      setGlobalError(processingBatchRef.current ? '请先暂停当前批次，再添加文件夹。' : '上一批图片仍在读取和保存，请稍候。');
      return;
    }
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

  const clearWorkspaceTransientState = useCallback(() => {
    setUndoStack([]);
    setSoftDeletedTasks([]);
    softDeletedTasksRef.current = [];
    setSelectedTaskIdsIfChanged(new Set());
    setTaskMenu(null);
    confirmedBatchImageModelRef.current = null;
    const overlay = selectionOverlayRef.current;
    if (overlay) {
      overlay.style.display = 'none';
      overlay.style.width = '0px';
      overlay.style.height = '0px';
    }
  }, [setSelectedTaskIdsIfChanged]);

  const getTasksByIds = (taskIds: string[]) => {
    const idSet = new Set(taskIds);
    return tasksRef.current.filter((task) => idSet.has(task.id));
  };

  const softRemoveTasks = useCallback((taskIds: string[]) => {
    if (isProcessingBatch || uploadInProgressRef.current) return;
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
    const pausableIds = getPausableTaskIds(tasksRef.current, taskIds);

    if (pausableIds.length === 0) return;

    const nextTasks = applyPausedTaskState(tasksRef.current, pausableIds);
    tasksRef.current = nextTasks;
    scheduleTasksRender();
    setBatchRunState('paused');
    setBatchCompletedAt(null);
    pausableIds.forEach((taskId) => {
      activeTaskControllersRef.current.get(taskId)?.abort();
    });
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
    setGlobalError(`已暂停 ${pausableIds.length} 张；继续时会恢复原任务，不会重复提交。`);
  };

  const runOrPauseSelectedTasks = () => {
    const taskIds = [...selectedTaskIdsRef.current];
    if (taskIds.length === 0) return;
    const selectedIdSet = new Set(taskIds);
    const activeIds = tasksRef.current
      .filter((task) => selectedIdSet.has(task.id) && ['detecting', 'extracting', 'generating', 'retrying'].includes(task.status))
      .map((task) => task.id);

    if (activeIds.length > 0) {
      pauseTasks(activeIds);
      return;
    }

    const processableIds = tasksRef.current
      .filter((task) => selectedIdSet.has(task.id) && ['idle', 'error', 'paused'].includes(task.status))
      .map((task) => task.id);
    if (processableIds.length > 0) {
      confirmAndProcessBatch(processableIds);
      return;
    }
  };

  const pauseAllTasks = () => {
    const taskIds = tasksRef.current
      .filter((task) => isPausableBatchTask(task.status))
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

  const reprocessTasks = (taskIds: string[], mode: ReprocessMode) => {
    setTaskMenu(null);
    const { nextTasks, runnableIds } = prepareReprocessTasks(tasksRef.current, taskIds, mode);

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
    window.setTimeout(() => {
      if (mode === 'translate') {
        void processBatch(runnableIds, { processMode: 'translate_only' });
        return;
      }
      confirmAndProcessBatch(runnableIds);
    }, 80);
  };

  const reprocessTask = (taskId: string, mode: ReprocessMode) => {
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
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
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
    if (
      selectedHistoryTask.id === activeHistoryTaskId &&
      tasksRef.current.some((task) => (task.historyImageId ?? task.id) === image.id)
    ) {
      setGlobalError('这张图片正在当前工作台中使用，已取消删除。');
      return;
    }
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
    if (processingBatchRef.current || isProcessingBatch) {
      setGlobalError('请先暂停当前批次并等待保存完成，再删除历史图片。');
      return;
    }
    if (
      selectedHistoryTask.id === activeHistoryTaskId &&
      tasksRef.current.some((task) => (task.historyImageId ?? task.id) === image.id)
    ) {
      setGlobalError('这张图片正在当前工作台中使用。请先从工作台移除或切换项目，再删除历史原图和结果图。');
      return;
    }
    openConfirmDialog({
      title: '删除这张历史图片？',
      message: `将从「${selectedHistoryTask.name}」里彻底删除「${image.name}」的原图和结果图。这个操作不能撤销。`,
      confirmLabel: '删除这张',
      tone: 'danger',
      onConfirm: () => performDeleteHistoryImage(image),
    });
  };

  const restoreHistoryImageForReprocess = async (image: HistoryImageRecord, mode: ReprocessMode) => {
    if (!selectedHistoryTask || !image.originalDataUrl) return;
    if (processingBatchRef.current || isProcessingBatch) {
      setGlobalError('请先暂停当前批次并等待已提交请求保存完成，再重新处理历史图片。');
      return;
    }
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
        sourceFileKey: image.pathKey,
        historyTaskId: selectedHistoryTask.id,
        historyImageId: image.id,
        generationOperationId: undefined,
        reprocessMode: mode,
        generatedUrl: image.resultDataUrl ?? undefined,
        result: mode === 'redraw' && image.translatedText
          ? { hasText: image.hasText, extractedText: image.extractedText ?? '', translatedText: image.translatedText }
          : undefined,
        attemptCount: image.attemptCount ?? 0,
        retryCount: image.retryCount ?? 0,
      } satisfies ImageTask;
      clearWorkspaceTransientState();
      setTasks([restoredTask]);
      tasksRef.current = [restoredTask];
      const historyOutputAspectRatio = getHistoryTaskOutputAspectRatio(selectedHistoryTask);
      const historyProcessMode = getHistoryTaskProcessMode(selectedHistoryTask);
      setTargetLanguage(selectedHistoryTask.language);
      setOutputAspectRatio(historyOutputAspectRatio);
      setProcessMode(mode === 'translate' ? 'translate_only' : historyProcessMode);
      setActiveProjectName(selectedHistoryTask.name);
      setDraftProjectName(selectedHistoryTask.name);
      setActiveHistoryTaskId(selectedHistoryTask.id);
      setSelectedHistoryTaskId(selectedHistoryTask.id);
      setHistoryOpen(false);
      window.setTimeout(() => {
        workbenchRef.current?.scrollIntoView({ behavior: getPreferredScrollBehavior(), block: 'start' });
        void processBatch([restoredTask.id], {
          targetLanguage: selectedHistoryTask.language,
          outputAspectRatio: historyOutputAspectRatio,
          processMode: mode === 'translate' ? 'translate_only' : historyProcessMode,
        });
      }, 80);
    } catch (error) {
      setGlobalError(getErrorMessage(error));
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleSaveSettings = () => {
    try {
      const latestDraftSettings = draftSettingsRef.current;
      const nextSettings = normalizeSettings(
        applyModelRecommendedSettings({
          ...latestDraftSettings,
          apiBaseUrl: latestDraftSettings.apiBaseUrl.trim() || DEFAULT_API_BASE_URL,
          textModel: latestDraftSettings.textModel.trim() || DEFAULT_GEMINI_TEXT_MODEL,
          imageModel: latestDraftSettings.imageModel.trim() || DEFAULT_GEMINI_IMAGE_MODEL,
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
    draftSettingsRef.current = DEFAULT_SETTINGS;
    setSettingsError(null);
    setConnectionStatus('idle');
    setConnectionMessage('');
    setGlobalError('已清除这台电脑当前浏览器里的接口设置和秘钥。');
  };

  const testConnection = async (mode: ConnectionTestMode) => {
    try {
      const runtimeSettings = normalizeSettings(
        applyModelRecommendedSettings(draftSettingsRef.current),
        {
          requireApiKey: true,
        },
      );
      setConnectionTestMode(mode);
      setConnectionStatus('testing');
      setConnectionMessage('正在检查鉴权与图片模型；不会调用生图，也不会产生生图费用...');
      const response = await fetch('/api/connection-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: runtimeSettings }),
      });
      const parsed = await response.json() as { message?: string; error?: { message?: string } };
      if (!response.ok) {
        throw new Error(parsed.error?.message || '连接检查失败。');
      }
      setConnectionStatus('success');
      setConnectionMessage(parsed.message || '连接成功。本次没有调用生图。');
    } catch (error) {
      setConnectionStatus('error');
      setConnectionMessage(getErrorMessage(error));
    }
  };

  const processBatch = async (onlyTaskIds?: string[], overrides?: { targetLanguage?: string; outputAspectRatio?: OutputAspectRatio; processMode?: ProcessMode; highCostConfirmed?: boolean }) => {
    if (processingBatchRef.current) {
      return;
    }
    if (uploadInProgressRef.current) {
      setGlobalError('图片仍在读取和保存，请完成上传后再开始处理。');
      return;
    }

    const pendingTasks = getProcessableBatchTasks(tasksRef.current, onlyTaskIds);

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
      const runtimeImageModelRisk = getImageModelCostRisk(runtimeSettings.imageModel);

      if (runtimeImageModelRisk && !overrides?.highCostConfirmed) {
        setGlobalError(`已拦截高费用图片模型「${runtimeImageModelRisk.model}」。请在开始确认弹窗里勾选费用确认后再继续。`);
        setStartConfirm({
          taskIds: onlyTaskIds,
          count: pendingTasks.length,
          language: overrides?.targetLanguage ?? targetLanguage,
          ratio: overrides?.outputAspectRatio ?? outputAspectRatio,
          imageModel: runtimeSettings.imageModel,
          mode: pendingTasks.every((task) => task.status === 'paused') ? 'continue' : 'start',
          processMode: overrides?.processMode,
        });
        return;
      }
    } catch (error) {
      setGlobalError(getErrorMessage(error));
      openSettings();
      return;
    }

    const currentMode: ProcessMode = overrides?.processMode ?? processMode;
    const currentTargetLanguage = overrides?.targetLanguage ?? targetLanguage;
    const currentWatermarkText = '';
    const currentOutputAspectRatio = overrides?.outputAspectRatio ?? outputAspectRatio;

    if (activeHistoryTaskId && tasksRef.current.length > 0) {
      try {
        await persistHistoryTask(
          activeHistoryTaskId,
          tasksRef.current,
          undefined,
          {
            language: currentTargetLanguage,
            ratio: currentOutputAspectRatio,
            mode: currentMode,
          },
        );
      } catch (error) {
        setGlobalError(`开始前保存任务设置失败：${getErrorMessage(error)}`);
        return;
      }
    }

    processingBatchRef.current = true;
    setIsProcessingBatch(true);
    setBatchRunState('running');
    setGlobalError(null);
    const batchRunStartedAt = getBatchRunStartedAt(tasksRef.current, batchStartedAt);
    setBatchStartedAt(batchRunStartedAt);
    setBatchCompletedAt(null);
    setNowTimestamp(batchRunStartedAt);

    const textQueue = createAdaptiveLimiter(Math.max(runtimeSettings.maxParallelTasks, 1));
    const imageQueue = createAdaptiveLimiter(
      getDefaultImageQueueLimit(runtimeSettings),
    );
    const imageQueueThrottle = createImageQueueThrottle(imageQueue);

    const finishBatchRun = () => {
      const completionState = getBatchRunCompletionState(tasksRef.current);
      setBatchRunState(completionState.runState);
      if (completionState.completedAt) {
        setBatchCompletedAt(completionState.completedAt);
      }
      setNowTimestamp(completionState.timestamp);
      scheduleHistoryRefresh(120);
    };

    try {
      await runWithConcurrencyLimit(
        pendingTasks.map((task) => async () => {
          const taskStartedAt = Date.now();
          const taskController = new AbortController();
          let generationOperationId = task.generationOperationId;
          let generationOperationIdPersisted = false;
          activeTaskControllersRef.current.set(task.id, taskController);
          const taskUpdateController = createBatchTaskUpdateController({
            task,
            startedAt: taskStartedAt,
            updateTask,
            persistTaskProgress,
          });
          const {
            applyTaskUpdate,
            getAttemptCount,
            setAttemptCount,
            getRetryCount,
            setRetryCount,
            isPauseGuardActive,
          } = taskUpdateController;

          const getOrCreateGenerationOperationId = async () => {
            if (!generationOperationId) {
              generationOperationId = createGenerationOperationId();
            }

            if (!generationOperationIdPersisted) {
              applyTaskUpdate({ generationOperationId });
              const latestTask = tasksRef.current.find((item) => item.id === task.id) ?? task;
              const identity = resolveHistoryImageIdentity(latestTask, activeHistoryTaskId ?? undefined);
              const queueKey = identity
                ? `${identity.historyTaskId}:${identity.historyImageId}`
                : '';
              const pendingPersistence = queueKey
                ? historyMutationQueuesRef.current.get(queueKey)
                : undefined;
              if (!pendingPersistence) {
                throw new ProcessingError('无法在生图前保存任务 ID，已停止提交以避免无法恢复或重复扣费。', {
                  kind: 'client',
                  retryable: false,
                });
              }
              await pendingPersistence;
              generationOperationIdPersisted = true;
            }

            return generationOperationId;
          };

          const isTaskPaused = createBatchTaskPausedLookup(() => tasksRef.current);

          const throwIfPaused = createBatchPauseGuard({
            task,
            taskController,
            isTaskPaused,
            isPauseGuardActive,
          });

          const runStageWithRetries = createBatchStageRunner({
            task,
            taskController,
            maxAttempts: MAX_STAGE_ATTEMPTS,
            getRetryDelayMs,
            waitForDelay,
            toProcessingError,
            isTaskPaused,
            applyTaskUpdate,
            getAttemptCount,
            setAttemptCount,
            getRetryCount,
            setRetryCount,
          });

          const {
            markTaskImageSuccess,
            markTaskCopiedWithoutTranslation,
            markTaskPaused,
            markTaskFailed,
          } = createBatchTaskOutcomeUpdaters<TaskResult>({
            applyTaskUpdate,
            getOutputRelativePath: (generatedUrl) => resolveOutputRelativePath(task.relativePath, generatedUrl),
            persistGeneratedImage: async (generatedUrl, outputRelativePath, outcomeUpdate) => {
              const latestTask = tasksRef.current.find((item) => item.id === task.id) ?? task;
              const identity = resolveHistoryImageIdentity(latestTask, activeHistoryTaskId ?? undefined);
              if (!identity) {
                throw new ProcessingError('结果图已经返回，但缺少历史任务标识，无法安全保存。', {
                  kind: 'client',
                  retryable: false,
                });
              }
              const resultTask = {
                ...latestTask,
                generatedUrl,
                outputRelativePath,
                historyTaskId: identity.historyTaskId,
                historyImageId: identity.historyImageId,
              };
              const queueKey = `${identity.historyTaskId}:${identity.historyImageId}`;
              try {
                await scheduleHistoryMutation(queueKey, () => persistResultImage(
                  resultTask,
                  identity.historyTaskId,
                ));
                const completedTask = {
                  ...resultTask,
                  ...outcomeUpdate,
                };
                await scheduleHistoryMutation(queueKey, () => postHistory('update-image', {
                  taskId: identity.historyTaskId,
                  imageId: identity.historyImageId,
                  patch: toHistoryImage(completedTask),
                }));
                void acknowledgeGenerateJobFamily(
                  latestTask.generationOperationId ?? generationOperationId,
                );
              } catch (error) {
                const reason = getErrorMessage(error);
                throw new ProcessingError(
                  `返图已经收到并保留在当前工作台，但本地历史保存失败：${reason}。请先下载结果，或修复磁盘问题后继续同一任务再次保存。`,
                  {
                    kind: 'client',
                    retryable: false,
                    details: [reason],
                  },
                );
              }
            },
          });

          try {
            throwIfPaused();
            const base64Data = getRequiredBatchTaskBase64Data(task.preview);

            let taskResult: TaskResult | undefined;

            const runImageGenerationStage = <T,>({
              label,
              phase,
              run,
            }: {
              label: string;
              phase: Extract<TaskPhase, 'ocr_generate' | 'remove_image'>;
              run: (operationId: string) => Promise<T>;
            }) =>
              runStageWithRetries({
                label,
                status: 'generating',
                phase: 'image_queue',
                maxAttempts: 1,
                run: () => imageQueue.run(async () => {
                  throwIfPaused();
                  applyTaskUpdate({
                    status: 'generating',
                    phase,
                    error: undefined,
                  });
                  const operationId = await getOrCreateGenerationOperationId();
                  throwIfPaused();
                  activeImageRequestTaskIdsRef.current.add(task.id);
                  try {
                    return await run(operationId);
                  } finally {
                    activeImageRequestTaskIdsRef.current.delete(task.id);
                  }
                }),
                onTransientFailure: imageQueueThrottle.registerFailure,
                onSuccess: imageQueueThrottle.registerSuccess,
                acceptResultAfterPause: true,
              });

            const runTextModelStage = <T,>({
              label,
              status,
              phase,
              run,
            }: {
              label: string;
              status: Extract<TaskStatus, 'detecting' | 'extracting'>;
              phase: Extract<TaskPhase, 'detecting' | 'ocr_extract'>;
              run: () => Promise<T>;
            }) =>
              runStageWithRetries({
                label,
                status,
                phase,
                maxAttempts: 1,
                run: () =>
                  textQueue.run(async () => {
                    throwIfPaused();
                    return run();
                  }),
                acceptResultAfterPause: true,
              });

            const runStructuredImageStage = (label: string, debugLabel: string) =>
              runImageGenerationStage({
                label,
                phase: 'ocr_generate',
                run: (operationId) =>
                  generateStructuredImageEdit({
                    callGenerateApi,
                    settings: runtimeSettings,
                    model: runtimeSettings.imageModel,
                    base64Data,
                    mimeType: getSupportedImageFileMimeType(task.file),
                    mode: currentMode,
                    targetLanguage: currentTargetLanguage,
                    watermarkText: currentWatermarkText,
                    extractedText: taskResult?.extractedText,
                    translatedText: taskResult?.translatedText,
                    outputAspectRatio: currentOutputAspectRatio,
                    debugLabel,
                    signal: taskController.signal,
                    operationId,
                  }),
              });

            const runDirectImageStage = (label: string, debugLabel: string) =>
              runImageGenerationStage({
                label,
                phase: 'remove_image',
                run: (operationId) =>
                  generateDirectImageEdit({
                    callGenerateApi,
                    settings: runtimeSettings,
                    model: runtimeSettings.imageModel,
                    base64Data,
                    mimeType: getSupportedImageFileMimeType(task.file),
                    mode: currentMode,
                    targetLanguage: currentTargetLanguage,
                    watermarkText: currentWatermarkText,
                    outputAspectRatio: currentOutputAspectRatio,
                    debugLabel,
                    signal: taskController.signal,
                    operationId,
                  }),
              });

            const runDetectTextStage = () =>
              runTextModelStage({
                label: '含字识别',
                status: 'detecting',
                phase: 'detecting',
                run: () =>
                  detectImageText({
                    callGenerateApi,
                    settings: runtimeSettings,
                    model: runtimeSettings.textModel,
                    base64Data,
                    mimeType: getSupportedImageFileMimeType(task.file),
                    debugLabel: `detect-${currentMode}`,
                    signal: taskController.signal,
                  }),
              });

            const runExtractTextStage = () =>
              runTextModelStage({
                label: 'OCR 提取与翻译',
                status: 'extracting',
                phase: 'ocr_extract',
                run: () =>
                  extractAndTranslateImageText({
                    callGenerateApi,
                    settings: runtimeSettings,
                    model: runtimeSettings.textModel,
                    base64Data,
                    mimeType: getSupportedImageFileMimeType(task.file),
                    targetLanguage: currentTargetLanguage,
                    debugLabel: `ocr-${currentMode}`,
                    signal: taskController.signal,
                  }),
              });

            const runTranslationFlow = async () => {
              const savedDetectionResult =
                task.status === 'paused' &&
                task.result?.hasText === true &&
                !task.result.translatedText
                  ? task.result
                  : undefined;
              applyTaskUpdate(
                buildTranslationDetectionTaskUpdate(
                  task.status === 'paused' ? task.result : undefined,
                ),
              );

              if (savedDetectionResult) {
                taskResult = savedDetectionResult;
              } else {
                try {
                  const hasText = await runDetectTextStage();

                  taskResult = buildDetectionStageResult(hasText);
                } catch (error) {
                  const processingError = toProcessingError(error);

                  if (!shouldUseOcrFallback(processingError)) {
                    throw processingError;
                  }

                  taskResult = buildDetectionFallbackResult(processingError.message);
                }
                applyTaskUpdate({ result: taskResult });
              }

              if (taskResult.hasText === false) {
                await markTaskCopiedWithoutTranslation(taskResult, task.preview);
                return;
              }

              throwIfPaused();

              const extractedResult = await runExtractTextStage();

              taskResult = mergeOcrResultWithDetectionError(extractedResult, taskResult.detectionError);
              applyTaskUpdate({ result: taskResult });

              if (
                taskResult.hasText === false ||
                !taskResult.extractedText.trim() ||
                !taskResult.translatedText?.trim()
              ) {
                await markTaskCopiedWithoutTranslation(taskResult, task.preview);
                return;
              }

              throwIfPaused();

              applyTaskUpdate({
                result: taskResult,
                status: 'generating',
                phase: 'ocr_generate',
              });

              const structuredGeneratedUrl = await runStructuredImageStage('OCR 回退重绘', `image-${currentMode}`);

              await markTaskImageSuccess(structuredGeneratedUrl);
            };

            const runRemoveOnlyFlow = async () => {
              applyTaskUpdate(buildRemoveOnlyTaskUpdate());

              const generatedUrl = await runDirectImageStage('去水印重绘', `image-${currentMode}`);

              await markTaskImageSuccess(generatedUrl);
            };

            const runRecoveryOrRedrawFlow = async () => {
              if (shouldResumeCopiedTask(task)) {
                await markTaskCopiedWithoutTranslation(
                  task.result!,
                  task.generatedUrl!,
                  task.completedAt ?? Date.now(),
                );
                return true;
              }

              if (shouldResumeTranslatedTask(task)) {
                taskResult = task.result;
                applyTaskUpdate(buildResumeTranslatedTaskUpdate(taskResult));

                const continuedUrl = await runStructuredImageStage('继续重绘', `continue-${currentMode}`);

                await markTaskImageSuccess(continuedUrl, { clearReprocessMode: true });
                return true;
              }

              if (shouldRedrawTranslatedTask(task)) {
                taskResult = task.result;
                applyTaskUpdate(buildRedrawTaskUpdate(taskResult));

                const regeneratedUrl = await runStructuredImageStage('单图重新重绘', `redraw-${currentMode}`);

                await markTaskImageSuccess(regeneratedUrl, { clearReprocessMode: true });
                return true;
              }

              return false;
            };

            if (task.reprocessMode === 'translate') {
              if (runtimeSettings.skipOcr) {
                applyTaskUpdate({
                  status: 'generating' as const,
                  phase: 'direct_image' as const,
                  error: undefined,
                  result: undefined,
                  completedAt: undefined,
                  reprocessMode: undefined,
                });
                const generatedUrl = await runDirectImageStage('跳过识别直接重绘', `image-${currentMode}`);
                await markTaskImageSuccess(generatedUrl, { clearReprocessMode: true });
                return;
              }
              await runTranslationFlow();
              return;
            }

            if (await runRecoveryOrRedrawFlow()) {
              return;
            }

            if (shouldRunOcrTranslationFlow(currentMode)) {
              if (runtimeSettings.skipOcr) {
                applyTaskUpdate({
                  status: 'generating' as const,
                  phase: 'direct_image' as const,
                  error: undefined,
                  result: undefined,
                  completedAt: undefined,
                });
                const generatedUrl = await runDirectImageStage('跳过识别直接重绘', `image-${currentMode}`);
                await markTaskImageSuccess(generatedUrl);
                return;
              }
              await runTranslationFlow();
              return;
            }

            await runRemoveOnlyFlow();
          } catch (error) {
            const processingError = toProcessingError(error);
            if (processingError.kind === 'paused') {
              markTaskPaused();
            } else {
              markTaskFailed(processingError);
            }
          } finally {
            activeTaskControllersRef.current.delete(task.id);
          }
        }),
        Math.min(Math.max(runtimeSettings.maxParallelTasks, 1), pendingTasks.length),
      );
    } finally {
      await flushScheduledHistoryMutations();
      processingBatchRef.current = false;
      setIsProcessingBatch(false);
      finishBatchRun();
    }
  };

  const confirmAndProcessBatch = (onlyTaskIds?: string[]) => {
    if (processingBatchRef.current || isProcessingBatch) return;
    const scopeTasks = onlyTaskIds ? getTasksByIds(onlyTaskIds) : tasksRef.current;
    const count = getProcessableBatchTasks(scopeTasks).length;
    if (count === 0) return;
    const pausedInScope = getPausedTaskIds(scopeTasks, scopeTasks.map((task) => task.id)).length;
    const startableInScope = getProcessableBatchTasks(scopeTasks).filter((task) => task.status !== 'paused').length;

    if (pausedInScope > 0 && startableInScope === 0) {
      void processBatch(onlyTaskIds, { highCostConfirmed: true });
      return;
    }

    const retryTaskIds = scopeTasks
      .filter((task) => (
        task.status === 'error' &&
        Boolean(task.generationOperationId) &&
        !task.generatedUrl
      ))
      .map((task) => task.id);

    setStartConfirm({
      taskIds: onlyTaskIds,
      count,
      language: targetLanguage,
      ratio: outputAspectRatio,
      imageModel: settings.imageModel,
      mode: pausedInScope > 0 && startableInScope === 0 ? 'continue' : 'start',
      retryTaskIds,
    });
  };

  const startConfirmedBatch = () => {
    if (!startConfirm || processingBatchRef.current) return;
    const taskIds = startConfirm.taskIds;
    const language = startConfirm.language;
    const ratio = startConfirm.ratio;
    const confirmedProcessMode = startConfirm.processMode ?? processMode;
    const highCostConfirmed = Boolean(startConfirm.acknowledgedHighCostModel);
    if (startConfirm.retryTaskIds?.length) {
      const nextTasks = prepareFailedTaskRetries(
        tasksRef.current,
        startConfirm.retryTaskIds,
      );
      tasksRef.current = nextTasks;
      scheduleTasksRender();
    }
    setTargetLanguage(language);
    setOutputAspectRatio(ratio);
    setProcessMode(confirmedProcessMode);
    confirmedBatchImageModelRef.current = startConfirm.imageModel
      .trim()
      .replace(/^models\//, '');
    setStartConfirm(null);
    void (async () => {
      try {
        await processBatch(taskIds, {
          targetLanguage: language,
          outputAspectRatio: ratio,
          processMode: confirmedProcessMode,
          highCostConfirmed,
        });
      } catch (error) {
        setGlobalError(`开始前保存任务设置失败：${getErrorMessage(error)}`);
      }
    })();
  };

  const handlePrimaryRunAction = () => {
    if (processingBatchRef.current || isProcessingBatch) {
      pauseAllTasks();
      return;
    }

    if (pausedCount > 0 && startableCount === 0) {
      confirmAndProcessBatch();
      return;
    }

    confirmAndProcessBatch();
  };

  const returnToHome = () => {
    if (uploadInProgressRef.current) {
      setGlobalError('图片仍在读取和保存，请完成上传后再返回主页。');
      return;
    }
    setReturnHomeConfirm({ hasWorkspace: tasksRef.current.length > 0 });
  };

  const confirmReturnToHome = () => {
    if (uploadInProgressRef.current) {
      setReturnHomeConfirm(null);
      setGlobalError('图片仍在读取和保存，请完成上传后再返回主页。');
      return;
    }
    if (isProcessingBatch) {
      pauseAllTasks();
      setReturnHomeConfirm(null);
      setGlobalError('已暂停当前处理。请等待任务进入暂停状态后再返回主页，避免丢失进度。');
      return;
    }

    tasksRef.current = [];
    setTasks([]);
    setSelectedTaskIdsIfChanged(new Set());
    setTaskMenu(null);
    setPendingUpload(null);
    setStartConfirm(null);
    setReturnHomeConfirm(null);
    hideSelectionOverlay();
    clearWorkspaceTransientState();
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
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
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
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }, []);

  const handleDownloadTaskById = useCallback((taskId: string) => {
    const task = tasksRef.current.find((item) => item.id === taskId);
    if (task) handleDownloadSingle(task);
  }, [handleDownloadSingle]);

  const selectOutputAspectRatio = useCallback((ratio: OutputAspectRatio) => {
    setOutputAspectRatio((current) => current === ratio ? current : ratio);
  }, []);

  const toggleTaskSelection = useCallback((taskId: string, event: TaskSelectEvent) => {
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
    element
      .querySelector<HTMLElement>('[data-task-select]')
      ?.setAttribute('aria-pressed', selected ? 'true' : 'false');
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
    event.preventDefault();

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
      if (!wasDragging && finalIds) {
        const restoredIds = selectedHistoryTaskIdsRef.current;
        finalIds.forEach((id) => {
          if (!restoredIds.has(id)) toggleHistorySelectionPreviewClass(id, false);
        });
        restoredIds.forEach((id) => {
          if (!finalIds.has(id)) toggleHistorySelectionPreviewClass(id, true);
        });
      }
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
      cancelHistorySelectionRef.current = null;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleWindowBlur);
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

      const box = makeBox(point.clientX, point.clientY);
      if (box) {
        updateSelectionOverlay(box.left, box.top, box.right, box.bottom);
        selectHistoryTasksInBox(box);
      }
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
      const wasDragging = drag.isSelecting || Math.hypot(upEvent.clientX - drag.startX, upEvent.clientY - drag.startY) >= 5;
      const box = makeBox(upEvent.clientX, upEvent.clientY);
      if (wasDragging && box) selectHistoryTasksInBox(box);
      finishSelection(wasDragging);
    };

    const handleWindowBlur = () => {
      finishSelection(false);
    };

    cancelHistorySelectionRef.current = () => finishSelection(false);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleWindowBlur);
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
      retryingCount: 0,
      failedCount: 0,
      detectingCount: 0,
      extractingCount: 0,
      generatingCount: 0,
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
      if (task.status === 'error') stats.failedCount += 1;
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
    retryingCount,
    failedCount,
    detectingCount,
    extractingCount,
    generatingCount,
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
  const batchElapsedLabel = batchStartedAt
    ? formatDuration((batchCompletedAt ?? nowTimestamp) - batchStartedAt)
    : '未开始';
  const batchStateLabel =
    batchRunState === 'running'
      ? `运行中 ${activeProcessingCount}`
      : batchRunState === 'paused'
        ? '已暂停'
        : batchRunState === 'completed'
          ? batchIntegrity.isComplete
            ? '已全部完成'
            : failedCount > 0
              ? '有失败待重试'
              : pendingCount > 0
                ? '本轮已结束，仍有待处理'
                : '本轮已结束'
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
  const selectedActionStats = useMemo(
    () => tasks.reduce(
      (stats, task) => {
        if (!selectedTaskIds.has(task.id)) return stats;
        if (['detecting', 'extracting', 'generating', 'retrying'].includes(task.status)) stats.active += 1;
        if (task.status === 'paused') stats.paused += 1;
        if (task.status === 'idle') stats.idle += 1;
        if (task.status === 'error') stats.error += 1;
        return stats;
      },
      { active: 0, paused: 0, idle: 0, error: 0 },
    ),
    [selectedTaskIds, tasks],
  );
  const selectedActionMode = selectedActionStats.active > 0
    ? 'pause'
    : selectedActionStats.paused > 0 && selectedActionStats.idle + selectedActionStats.error === 0
      ? 'continue'
      : selectedActionStats.paused + selectedActionStats.idle + selectedActionStats.error > 0
        ? 'process'
        : 'none';
  const selectedActionLabel = selectedActionMode === 'pause'
    ? '暂停所选'
    : selectedActionMode === 'continue'
      ? '继续所选'
      : selectedActionStats.error > 0 && selectedActionStats.idle + selectedActionStats.paused === 0
        ? '重试所选'
        : selectedActionStats.paused > 0
          ? '继续并处理'
          : '处理所选';
  const selectedActionDisabled = selectedActionMode === 'none';
  const selectedResultCount = useMemo(
    () => tasks.filter((task) => selectedTaskIds.has(task.id) && task.generatedUrl).length,
    [selectedTaskIds, tasks],
  );
  const previewTask = useMemo(
    () => taskPreview ? tasks.find((task) => task.id === taskPreview.taskId) ?? null : null,
    [taskPreview, tasks],
  );
  const previewSource = previewTask && taskPreview
    ? taskPreview.kind === 'result' ? previewTask.generatedUrl : previewTask.preview
    : undefined;
  const selectedAspectRatioOption = getAspectRatioOption(outputAspectRatio);
  const progressPercent = totalImageCount ? Math.round((outputReadyCount / totalImageCount) * 100) : 0;
  const historyTotalDisplayCount = historyTotalCount || historyTasks.length;
  const historyDoneDisplayCount = useMemo(
    () => historyTasks.reduce((sum, task) => sum + task.doneCount, 0),
    [historyTasks],
  );
  const historyFailDisplayCount = useMemo(
    () => historyTasks.reduce((sum, task) => sum + task.failCount, 0),
    [historyTasks],
  );
  const imageModelRisk = getImageModelCostRisk(settings.imageModel);
  const canvasGridClass = totalImageCount <= 1
    ? 'mx-auto grid w-full max-w-[1180px] grid-cols-1 place-items-center gap-5'
    : totalImageCount === 2
      ? 'mx-auto grid w-full max-w-[1480px] grid-cols-1 place-items-center gap-5 lg:grid-cols-2'
      : 'grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))]';
  const cardSizeClass = 'w-full';
  const consoleDockOpen = mobileConsoleOpen || desktopConsoleOpen;

  return (
    <>
      <div ref={selectionOverlayRef} className="ui-selection-box" style={{ display: 'none' }} />
      <div className={cn('ui-shell relative', tasks.length > 0 ? 'flex h-[100dvh] flex-col overflow-hidden' : 'ui-shell-home min-h-[100dvh] overflow-x-hidden', totalImageCount > 80 && 'ui-large-batch')}>
        {globalError && (
          <div className="ui-floating-toast" role={getGlobalMessageTone(globalError) === 'error' ? 'alert' : 'status'} aria-live={getGlobalMessageTone(globalError) === 'error' ? 'assertive' : 'polite'}>
            <div className="ui-floating-toast-card flex items-start gap-3" data-tone={getGlobalMessageTone(globalError)}>
              <span className="min-w-0 flex-1">{globalError}</span>
              <button type="button" onClick={() => setGlobalError(null)} aria-label="关闭提示" className="ui-icon-action shrink-0 opacity-70 hover:opacity-100">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        <header className={cn('ui-topbar sticky top-0 z-40 shrink-0 backdrop-blur-xl', tasks.length > 0 ? 'min-h-14' : 'h-16')}>
          {tasks.length > 0 ? (
            <div className="flex min-h-14 flex-wrap items-center gap-2 px-3 py-2 md:px-4">
              <button
                type="button"
                onClick={returnToHome}
                title="返回上传主页"
                aria-label="返回上传主页"
                className="ui-brand-button flex shrink-0 items-center gap-2 rounded-xl border border-transparent py-1 pl-1 pr-2 text-left transition"
              >
                <span className="xobi-filled-contrast flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--xobi-border)] bg-[var(--xobi-accent)] text-[var(--xobi-accent-contrast)] shadow-[0_0_28px_var(--xobi-accent-soft)]">
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="text-sm font-semibold leading-none text-[var(--xobi-text)]">xobi</span>
              </button>

              <div className="hidden min-w-0 items-center gap-2 border-l border-[var(--xobi-border)] pl-3 sm:flex">
                <p className="max-w-[260px] truncate text-sm font-medium text-[var(--xobi-text)]" title={activeProjectName || buildAutoProjectName(tasks, targetLanguage)}>
                  {activeProjectName || buildAutoProjectName(tasks, targetLanguage)}
                </p>
                <span className="shrink-0 text-xs tabular-nums text-[var(--xobi-faint)]">{outputReadyCount}/{totalImageCount}</span>
              </div>

              <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2">
                <button type="button" onClick={openImagePicker} disabled={isProcessingBatch || isUploading} aria-label="添加图片" title="添加图片" className="ui-icon-action disabled:opacity-40">
                  <UploadCloud className="h-4 w-4" aria-hidden="true" />
                </button>
                <button type="button" onClick={openFolderPicker} disabled={isProcessingBatch || isUploading} aria-label="添加文件夹" title="添加文件夹" className="ui-icon-action disabled:opacity-40">
                  <FolderUp className="h-4 w-4" aria-hidden="true" />
                </button>
                <button type="button" onClick={() => setImageStudioOpen(true)} aria-label="打开生图工作台" title="生图工作台" className="ui-button px-3 text-xs font-medium">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  生图
                </button>
                <LanguageSelect
                  value={targetLanguage}
                  options={LANGUAGE_OPTIONS}
                  onChange={setTargetLanguage}
                  disabled={isProcessingBatch}
                />
                <button
                  type="button"
                  onClick={openBatchConsole}
                  aria-controls="batch-console-panel"
                  aria-expanded={consoleDockOpen}
                  className="ui-button px-3 text-xs font-medium xl:hidden"
                >
                  批次控制
                </button>
                <button type="button" onClick={() => void openHistoryPanel()} aria-label={`打开翻译历史，共 ${historyTotalDisplayCount} 个任务`} aria-busy={historyLoading} title="翻译历史" className="ui-icon-action ui-history-orbit-button" data-has-history={historyTotalDisplayCount > 0}>
                  <svg className="ui-history-orbit-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path className="ui-history-orbit-ring" d="M6.6 6.5A7.5 7.5 0 1 1 4.5 12" />
                    <path className="ui-history-orbit-arrow" d="m3.7 7.6 3.4-.8-.8-3.4" />
                    <path className="ui-history-orbit-photo" d="M8.4 10.1h7.2v5.6H8.4zM9.6 14l1.45-1.35 1.2 1 1.05-.9 1.5 1.25" />
                  </svg>
                  {historyTotalDisplayCount > 0 && <span className="ui-history-orbit-dot" aria-hidden="true" />}
                </button>
                <button type="button" onClick={toggleTheme} aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'} title={theme === 'dark' ? '浅色模式' : '深色模式'} className="ui-icon-action">
                  {theme === 'dark' ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
                </button>
                <button type="button" ref={settingsButtonRef} onClick={openSettings} aria-label="打开设置" title="设置" className="ui-icon-action">
                  <Settings className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : (
            <div className="mx-auto flex h-full w-full items-center gap-2 px-3 sm:gap-3 sm:px-4">
              <div className="flex min-h-11 shrink-0 items-center gap-2 px-1.5" aria-label="xobi 图片翻译工作台">
                <span className="ui-brand-mark"><Sparkles className="h-4 w-4" aria-hidden="true" /></span>
                <span className="text-sm font-semibold leading-none text-[var(--xobi-text)]">xobi</span>
              </div>
              <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
                <button type="button" onClick={() => setImageStudioOpen(true)} aria-label="打开生图工作台" title="生图工作台" className="ui-button px-3 text-xs font-medium">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  生图
                </button>
                <button type="button" onClick={() => void openHistoryPanel()} aria-label={`打开翻译历史，共 ${historyTotalDisplayCount} 个任务`} aria-busy={historyLoading} title="翻译历史" className="ui-icon-action ui-history-orbit-button" data-has-history={historyTotalDisplayCount > 0}>
                  <svg className="ui-history-orbit-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path className="ui-history-orbit-ring" d="M6.6 6.5A7.5 7.5 0 1 1 4.5 12" />
                    <path className="ui-history-orbit-arrow" d="m3.7 7.6 3.4-.8-.8-3.4" />
                    <path className="ui-history-orbit-photo" d="M8.4 10.1h7.2v5.6H8.4zM9.6 14l1.45-1.35 1.2 1 1.05-.9 1.5 1.25" />
                  </svg>
                  {historyTotalDisplayCount > 0 && <span className="ui-history-orbit-dot" aria-hidden="true" />}
                </button>
                <button type="button" onClick={toggleTheme} aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'} title={theme === 'dark' ? '浅色模式' : '深色模式'} className="ui-icon-action">
                  {theme === 'dark' ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
                </button>
              </div>
            </div>
          )}
        </header>

        <main ref={workbenchRef} className={cn('flex flex-col', tasks.length > 0 ? 'min-h-0 flex-1' : 'min-h-[calc(100dvh-64px)]')}>
          <input id="image-upload-input" name="images" ref={fileInputRef} type="file" tabIndex={-1} disabled={isProcessingBatch || isUploading} accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,image/avif,.jpg,.jpeg,.png,.webp,.gif,.bmp,.avif" multiple onChange={handleFileChange} className="fixed -left-[9999px] top-0 h-px w-px opacity-0" />
          <input id="folder-upload-input" name="folderImages" ref={folderInputRef} type="file" tabIndex={-1} disabled={isProcessingBatch || isUploading} accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,image/avif,.jpg,.jpeg,.png,.webp,.gif,.bmp,.avif" multiple onChange={handleFolderChange} className="fixed -left-[9999px] top-0 h-px w-px opacity-0" {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} />

          <section className={cn(tasks.length === 0 ? 'flex flex-1' : 'hidden')}>
            <div className="flex w-full">
              <HomeUploadHero
                onSelectImages={openImagePicker}
                onSelectFolder={openFolderPicker}
                onDrop={handleDrop}
                disabled={isUploading}
              />
            </div>
          </section>

          <section ref={canvasRef} onMouseDown={beginCanvasSelection} onClick={(event) => { if (selectionSuppressClickRef.current) { event.preventDefault(); return; } if (isBlankSelectionSurfaceClick(event, '[data-task-card], .ui-workbench-command, .ui-selection-toolbar')) clearTaskSelection(); }} className={cn('ui-canvas-workspace min-h-0 flex-1 overflow-auto px-3 py-3 md:px-4 md:py-4', tasks.length === 0 && 'hidden', selectedTaskCount > 0 && 'pb-44 sm:pb-28')}>
            {tasks.length === 0 ? (
              <div className="flex min-h-[38vh] items-center justify-center rounded-2xl border border-[var(--xobi-border)] bg-[var(--xobi-surface)]">
                <div className="text-center">
                  <ImageIcon className="mx-auto h-10 w-10 text-[var(--xobi-faint)]" />
                  <p className="mt-3 text-sm text-[var(--xobi-muted)]">还没有图片。上传后这里会显示原图和翻译结果。</p>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                {selectedTaskCount > 0 && (
                  <div className="ui-selection-toolbar fixed bottom-4 left-1/2 z-30 flex w-[calc(100%_-_24px)] max-w-[980px] -translate-x-1/2 flex-col gap-3 rounded-2xl px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4" role="toolbar" aria-label="已选图片操作">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="inline-flex min-h-9 shrink-0 items-center rounded-full bg-[var(--xobi-accent-soft)] px-3 text-sm font-semibold text-[var(--xobi-accent)]">已选 {selectedTaskCount}</span>
                      <p className="truncate text-sm text-[var(--xobi-muted)]">右键作用于当前选择范围</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                      <button type="button" onClick={runOrPauseSelectedTasks} disabled={selectedActionDisabled} className="ui-button px-4 text-sm font-medium disabled:opacity-35">
                        {selectedActionMode === 'pause' ? <PauseCircle className="h-4 w-4" aria-hidden="true" /> : selectedActionMode === 'continue' ? <PlayCircle className="h-4 w-4" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
                        {selectedActionLabel}
                      </button>
                      <button type="button" onClick={() => void downloadSelectedResults([...selectedTaskIds])} disabled={selectedResultCount === 0} className="ui-button px-4 text-sm font-medium disabled:opacity-35">
                        <Download className="h-4 w-4" aria-hidden="true" />下载结果 ({selectedResultCount})
                      </button>
                      <button type="button" onClick={removeSelectedTasks} disabled={isProcessingBatch || isUploading} className="xobi-danger-action px-4 text-sm disabled:opacity-35">
                        <Trash2 className="h-4 w-4" aria-hidden="true" />移除所选
                      </button>
                      <button type="button" onClick={clearTaskSelection} aria-label="清除图片选择" className="ui-icon-action">
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                )}
                <TaskGroupsView
                  groupedTasks={groupedTasks}
                  selectedTaskIds={selectedTaskIds}
                  isProcessingBatch={isProcessingBatch || isUploading}
                  canvasGridClass={canvasGridClass}
                  cardSizeClass={cardSizeClass}
                  onToggle={toggleTaskSelection}
                  onOpenMenu={openTaskMenu}
                  onOpenKeyboardMenu={openTaskKeyboardMenu}
                  onRemove={removeTask}
                  onDownload={handleDownloadTaskById}
                  onPreview={(taskId, kind) => setTaskPreview({ taskId, kind })}
                />
              </div>
            )}
          </section>
        </main>

        {tasks.length > 0 && (
          <BatchConsole
            open={consoleDockOpen}
            expanded={desktopConsoleOpen}
            modal={mobileConsoleOpen}
            focusRequested={consoleFocusRequested}
            isEditingProjectName={isEditingProjectName}
            draftProjectName={draftProjectName}
            activeProjectName={activeProjectName}
            autoProjectName={buildAutoProjectName(tasks, targetLanguage)}
            uploadedFolderCount={uploadedFolderCount}
            groupCount={groupCount}
            totalImageCount={totalImageCount}
            batchStateLabel={batchStateLabel}
            batchElapsedLabel={batchElapsedLabel}
            selectedAspectRatioLabel={selectedAspectRatioOption.label}
            selectedAspectRatioHint={selectedAspectRatioOption.hint}
            outputAspectRatio={outputAspectRatio}
            isProcessingBatch={isProcessingBatch}
            progressPercent={progressPercent}
            outputReadyCount={outputReadyCount}
            failedCount={failedCount}
            pendingCount={pendingCount}
            pausedCount={pausedCount}
            startableCount={startableCount}
            primaryRunLabel={primaryRunLabel}
            batchComplete={batchIntegrity.isComplete}
            onOpen={openDesktopConsole}
            onScheduleClose={scheduleDesktopConsoleClose}
            onClose={() => {
              setMobileConsoleOpen(false);
              closeDesktopConsole();
            }}
            onStartEditingProjectName={() => {
              setDraftProjectName(activeProjectName || buildAutoProjectName(tasks, targetLanguage));
              setIsEditingProjectName(true);
            }}
            onDraftProjectNameChange={setDraftProjectName}
            onCancelEditingProjectName={() => {
              setIsEditingProjectName(false);
              setDraftProjectName(activeProjectName);
            }}
            onSaveProjectName={() => void saveProjectName()}
            onSelectOutputAspectRatio={selectOutputAspectRatio}
            onArchiveCurrentProject={() => void archiveCurrentProject()}
            onPrimaryRunAction={handlePrimaryRunAction}
            onDownloadZip={handleDownloadZip}
          />
        )}
      </div>

      {taskPreview && previewTask && previewSource && (
        <TaskPreviewDialog
          src={previewSource}
          title={previewTask.relativePath || previewTask.file.name}
          kind={taskPreview.kind}
          onClose={() => setTaskPreview(null)}
          onDownload={() => {
            if (taskPreview.kind === 'result') handleDownloadTaskById(previewTask.id);
            else downloadOriginalTask(previewTask.id);
          }}
        />
      )}

      {startConfirm && (
        <StartConfirmDialog
          dialogRef={startConfirmDialogRef}
          state={startConfirm}
          imageModelRisk={imageModelRisk}
          onCancel={() => setStartConfirm(null)}
          onChange={setStartConfirm}
          onConfirm={startConfirmedBatch}
        />
      )}

      {returnHomeConfirm && (
        <ReturnHomeDialog
          dialogRef={returnHomeDialogRef}
          hasWorkspace={returnHomeConfirm.hasWorkspace}
          onCancel={() => setReturnHomeConfirm(null)}
          onConfirm={confirmReturnToHome}
        />
      )}

      {pendingUpload && (
        <PendingUploadDialog
          dialogRef={pendingUploadDialogRef}
          currentCount={tasks.length}
          incomingCount={pendingUpload.files.length}
          onChoose={handlePendingUpload}
          onCancel={() => setPendingUpload(null)}
        />
      )}

      {taskMenu && (
        <TaskContextMenu
          taskIds={taskMenu.taskIds}
          x={taskMenu.x}
          y={taskMenu.y}
          tasks={getTasksByIds(taskMenu.taskIds)}
          isProcessingBatch={isProcessingBatch || isUploading}
          onReprocess={reprocessTasks}
          onContinuePaused={(taskIds) => {
            setTaskMenu(null);
            confirmAndProcessBatch(taskIds);
          }}
          onPause={pauseTasks}
          onDownloadResults={(taskIds) => void downloadSelectedResults(taskIds)}
          onDownloadOriginal={downloadOriginalTask}
          onRemove={softRemoveTasks}
          onClose={() => setTaskMenu(null)}
        />
      )}

      {historyMenu && (
        <HistoryContextMenu
          taskIds={historyMenu.taskIds}
          x={historyMenu.x}
          y={historyMenu.y}
          tasks={historyTasks}
          onDownload={(taskIds) => void downloadHistoryTasks(taskIds)}
          onSelect={(taskId) => void selectHistoryTask(taskId)}
          onDelete={requestDeleteHistoryTasks}
          onClose={() => setHistoryMenu(null)}
        />
      )}

      {historyOpen && (
        <div
          className="ui-history-modal-backdrop fixed inset-0 z-50 p-1 text-[var(--xobi-text)] sm:p-3"
          onWheelCapture={(event) => event.stopPropagation()}
        >
          <div ref={historyDialogRef} role="dialog" aria-modal="true" aria-labelledby="history-title" tabIndex={-1} className="ui-history-shell flex h-full w-full flex-col overflow-hidden !rounded-[30px] !border !border-[var(--xobi-border)] !shadow-[0_40px_120px_rgba(0,0,0,0.72)]">
            <HistoryDialogHeader
              resourceDir={resourceDir}
              totalCount={historyTotalDisplayCount}
              doneCount={historyDoneDisplayCount}
              failCount={historyFailDisplayCount}
              loading={historyLoading}
              onRefresh={() => void refreshHistory()}
              onClose={() => setHistoryOpen(false)}
            />

            <div className="min-h-0 flex-1 overflow-hidden">
              {!selectedHistoryTaskId ? (
                <HistoryGallery
                  galleryRef={historyGalleryRef}
                  tasks={historyTasks}
                  totalCount={historyTotalDisplayCount}
                  selectedTaskIds={selectedHistoryTaskIds}
                  hasMore={historyHasMore}
                  loading={historyLoading}
                  suppressNextClick={selectionSuppressClickRef.current}
                  onBeginSelection={beginHistorySelection}
                  onBlankClick={() => setSelectedHistoryTaskIdsIfChanged(new Set())}
                  onToggleSelectAll={() => {
                    const allLoadedSelected = historyTasks.length > 0
                      && historyTasks.every((task) => selectedHistoryTaskIdsRef.current.has(task.id));
                    setHistoryMenu(null);
                    setSelectedHistoryTaskIdsIfChanged(
                      allLoadedSelected ? new Set() : new Set(historyTasks.map((task) => task.id)),
                    );
                  }}
                  onToggleTask={toggleHistoryTaskSelection}
                  onOpenMenu={openHistoryMenu}
                  onDownloadSelected={(taskIds) => void downloadHistoryTasks(taskIds)}
                  onDeleteSelected={requestDeleteHistoryTasks}
                  onLoadMore={() => void loadMoreHistoryTasks()}
                />
              ) : (
                <HistoryDetail
                  task={selectedHistoryTask}
                  detailReady={selectedHistoryDetailReady}
                  donePercent={historyDonePercent}
                  logs={selectedHistoryLogs}
                  loading={historyLoading}
                  workspaceBusy={isProcessingBatch}
                  hasMore={historyDetailHasMore}
                  loadingMore={historyDetailLoadingMore}
                  getStatusText={getTaskStatusText}
                  onBack={() => setSelectedHistoryTaskId(null)}
                  onRestoreTask={restoreHistoryTask}
                  onDeleteTask={requestDeleteHistoryTask}
                  onReprocessImage={restoreHistoryImageForReprocess}
                  onDownloadImage={downloadHistoryImage}
                  onDeleteImage={requestDeleteHistoryImage}
                  onLoadMoreImages={() => void loadMoreHistoryTaskImages()}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {confirmDialog && (
        <div className="ui-modal-backdrop fixed inset-0 z-[90] flex items-center justify-center px-4 backdrop-blur-xl" onMouseDown={(event) => { if (event.target === event.currentTarget) closeConfirmDialog(); }}>
          <div ref={confirmDialogRef} role="dialog" aria-modal="true" aria-labelledby="xobi-confirm-title" aria-describedby="xobi-confirm-message" tabIndex={-1} className="ui-modal-panel w-full max-w-md overflow-hidden border">
            <div className="px-5 py-5">
              <p className={cn('text-xs font-semibold uppercase tracking-[0.16em]', confirmDialog.tone === 'danger' ? 'text-[var(--xobi-danger)]' : 'text-[var(--xobi-accent)]')}>操作确认</p>
              <h2 id="xobi-confirm-title" className="mt-1 text-lg font-semibold text-[var(--xobi-text)]">{confirmDialog.title}</h2>
              <p id="xobi-confirm-message" className="mt-2 text-sm leading-6 text-[var(--xobi-muted)]">{confirmDialog.message}</p>
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-[var(--xobi-border)] bg-[var(--xobi-surface-soft)] px-5 py-4 sm:flex-row sm:justify-end">
              <button type="button" onClick={closeConfirmDialog} disabled={isConfirming} className="ui-button px-4 text-sm disabled:opacity-45">{confirmDialog.cancelLabel ?? '取消'}</button>
              <button type="button" onClick={() => void runConfirmDialogAction()} disabled={isConfirming} className={cn('inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] px-5 text-sm font-semibold transition disabled:opacity-55', confirmDialog.tone === 'danger' ? 'xobi-danger-action' : 'ui-button ui-button-primary')}>
                {isConfirming && <Loader2 className="h-4 w-4 animate-spin" />}
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <SettingsDialog
          dialogRef={settingsDialogRef}
          draftSettings={draftSettings}
          settingsError={settingsError}
          connectionStatus={connectionStatus}
          connectionTestMode={connectionTestMode}
          connectionMessage={connectionMessage}
          onClose={closeSettings}
          onSave={handleSaveSettings}
          onClear={clearLocalSettings}
          onTestConnection={testConnection}
          onUpdateDraftSettings={updateDraftSettings}
        />
      )}

      {imageStudioOpen && (
        <ImageStudio
          settings={settings}
          suspended={settingsOpen}
          onClose={() => setImageStudioOpen(false)}
          onOpenSettings={openSettings}
        />
      )}
    </>
  );
}
