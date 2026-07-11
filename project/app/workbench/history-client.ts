import { type BatchTaskStatus, type BatchTaskPhase } from './batch-state';

export type HistoryImageStatus = BatchTaskStatus;

export type HistoryImagePhase = BatchTaskPhase;

export type HistoryImageTransport =
  | 'openai-images'
  | 'openai-chat-completions'
  | 'generate-content';

export interface HistorySettingsSummary {
  apiBaseUrl: string;
  textModel: string;
  imageModel: string;
  maxParallelTasks: number;
  imageRequestTimeoutMs?: number;
  skipOcr?: boolean;
  transport?: HistoryImageTransport;
}

export interface HistoryPreviewImage {
  id: string;
  name: string;
  dataUrl: string | null;
  kind: 'result' | 'original';
}

export interface HistoryImageRecord {
  id: string;
  name: string;
  relativePath: string;
  outputRelativePath: string;
  groupLabel: string;
  status: HistoryImageStatus;
  phase?: HistoryImagePhase;
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
  generationOperationId?: string;
  originalPath?: string;
  resultPath?: string;
  originalDataUrl?: string | null;
  resultDataUrl?: string | null;
}

export interface HistoryTaskRecord {
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
  settingsSummary?: Partial<HistorySettingsSummary>;
  storageDirName?: string;
  previewImages?: HistoryPreviewImage[];
  hasMoreImages?: boolean;
  imageOffset?: number;
  imageLimit?: number;
  totalImages?: number;
  images: HistoryImageRecord[];
}

export interface HistoryPersistTaskLike {
  id: string;
  file: { name: string };
  relativePath: string;
  outputRelativePath: string;
  groupLabel: string;
  status: HistoryImageStatus;
  phase?: HistoryImagePhase;
  sourceKind?: 'file' | 'folder';
  pathKey: string;
  error?: string;
  result?: {
    hasText?: boolean;
    extractedText?: string;
    translatedText?: string;
  };
  retryCount: number;
  attemptCount: number;
  startedAt?: number;
  completedAt?: number;
  generationOperationId?: string;
  historyTaskId?: string;
  historyImageId?: string;
  preview: string;
  generatedUrl?: string;
}

export interface HistoryTaskPayloadOptions {
  historyTaskId: string;
  tasks: HistoryPersistTaskLike[];
  name: string;
  language: string;
  ratio: string;
  mode: string;
  settingsSummary: HistorySettingsSummary;
}

export function getHistoryStatusText(status: HistoryTaskRecord['status']) {
  if (status === 'done') return '全部完成';
  if (status === 'running') return '进行中';
  if (status === 'partial') return '部分完成';
  if (status === 'failed') return '全部失败';
  return '待翻译';
}

export function getHistoryPreviewImages(task: HistoryTaskRecord) {
  return task.previewImages?.filter((image) => image.dataUrl) ?? [];
}

function normalizeTerminalHistoryImage(image: HistoryImageRecord) {
  if (image.status !== 'success' && image.status !== 'copied') return image;
  const normalized = { ...image };
  delete normalized.error;
  return normalized;
}

function normalizeHistoryTaskImages(task: HistoryTaskRecord) {
  return {
    ...task,
    images: task.images.map(normalizeTerminalHistoryImage),
  };
}

export function mergeHistoryTaskImages(
  currentTask: HistoryTaskRecord | undefined,
  incomingTask: HistoryTaskRecord,
  appendImages: boolean,
) {
  if (!currentTask) return normalizeHistoryTaskImages(incomingTask);

  const currentImagesById = new Map(currentTask.images.map((image) => [image.id, image]));
  const mergeImage = (image: HistoryImageRecord) => {
    const existing = currentImagesById.get(image.id);
    const merged = existing
      ? {
        ...image,
        originalDataUrl: image.originalDataUrl ?? existing.originalDataUrl,
        resultDataUrl: image.resultDataUrl ?? existing.resultDataUrl,
      }
      : image;
    return normalizeTerminalHistoryImage(merged);
  };

  if (!appendImages) {
    return {
      ...incomingTask,
      previewImages: incomingTask.previewImages?.length ? incomingTask.previewImages : currentTask.previewImages,
      images: incomingTask.images.map(mergeImage),
      hasMoreImages: incomingTask.hasMoreImages ?? currentTask.hasMoreImages,
      imageOffset: incomingTask.imageOffset ?? currentTask.imageOffset,
      imageLimit: incomingTask.imageLimit ?? currentTask.imageLimit,
      totalImages: incomingTask.totalImages ?? currentTask.totalImages,
    };
  }

  const imageMap = new Map(currentTask.images.map((image) => [image.id, image]));
  incomingTask.images.forEach((image) => {
    const existing = imageMap.get(image.id);
    const merged = existing
      ? {
        ...existing,
        ...image,
        originalDataUrl: image.originalDataUrl ?? existing.originalDataUrl,
        resultDataUrl: image.resultDataUrl ?? existing.resultDataUrl,
      }
      : image;
    imageMap.set(image.id, normalizeTerminalHistoryImage(merged));
  });

  return {
    ...incomingTask,
    previewImages: incomingTask.previewImages?.length ? incomingTask.previewImages : currentTask.previewImages,
    images: Array.from(imageMap.values()),
  };
}

export function buildHistoryTaskPayload({
  historyTaskId,
  tasks,
  name,
  language,
  ratio,
  mode,
  settingsSummary,
}: HistoryTaskPayloadOptions) {
  return {
    id: historyTaskId,
    name,
    language,
    ratio,
    mode,
    settingsSummary,
    images: tasks.map(toHistoryImage),
  };
}

export function toHistoryImage(task: HistoryPersistTaskLike) {
  return normalizeTerminalHistoryImage({
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
    generationOperationId: task.generationOperationId,
  });
}

export function resolveHistoryImageIdentity(task: HistoryPersistTaskLike, fallbackHistoryTaskId?: string) {
  const historyTaskId = task.historyTaskId ?? fallbackHistoryTaskId;
  const historyImageId = task.historyImageId ?? task.id;
  return historyTaskId ? { historyTaskId, historyImageId } : null;
}

export function buildSaveOriginalImagePayload(
  task: HistoryPersistTaskLike,
  identity: NonNullable<ReturnType<typeof resolveHistoryImageIdentity>>,
) {
  return {
    taskId: identity.historyTaskId,
    imageId: identity.historyImageId,
    kind: 'original' as const,
    relativePath: task.relativePath,
    dataUrl: task.preview,
  };
}

export function buildSaveResultImagePayload(
  task: HistoryPersistTaskLike,
  identity: NonNullable<ReturnType<typeof resolveHistoryImageIdentity>>,
) {
  return {
    taskId: identity.historyTaskId,
    imageId: identity.historyImageId,
    kind: 'result' as const,
    relativePath: task.outputRelativePath,
    dataUrl: task.generatedUrl,
  };
}

const HISTORY_WRITE_TIMEOUT_MS = 120_000;

export async function postHistory(action: string, payload: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    HISTORY_WRITE_TIMEOUT_MS,
  );
  let response: Response;
  try {
    response = await fetch('/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-image-translator-request': 'mutation' },
      body: JSON.stringify({ action, ...payload }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(
        '本地历史写入等待超时，保存状态未知。为避免丢图，生图恢复缓存不会清理；稍后继续同一任务即可。',
      );
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }

  const parsed = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = parsed?.error?.message ?? `历史记录写入失败 (${response.status})`;
    throw new Error(message);
  }
  return parsed;
}
