import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { promises as fs, type Dirent } from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { runWithConcurrencyLimit } from '@/lib/concurrency';
import {
  detectSupportedImageMimeType,
  getImageExtensionForMimeType,
  getImageMimeTypeForExtension,
  normalizeSupportedImageMimeType,
  SUPPORTED_IMAGE_EXTENSIONS,
} from '@/lib/image-formats';

export const runtime = 'nodejs';

interface HistoryImageRecord {
  id: string;
  name: string;
  relativePath: string;
  outputRelativePath: string;
  groupLabel: string;
  status: string;
  phase?: string;
  sourceKind?: string;
  pathKey: string;
  originalPath?: string;
  resultPath?: string;
  error?: string;
  hasText?: boolean;
  extractedText?: string;
  translatedText?: string;
  retryCount?: number;
  attemptCount?: number;
  startedAt?: number;
  completedAt?: number;
  generationOperationId?: string;
  updatedAt: number;
}

interface HistoryPreviewImage {
  id: string;
  name: string;
  dataUrl: string | null;
  kind: 'result' | 'original';
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
  settingsSummary?: Record<string, unknown>;
  storageDirName?: string;
  images: HistoryImageRecord[];
}

function resolveResourceDir() {
  if (process.env.IMAGE_TRANSLATOR_RESOURCE_DIR) {
    return path.resolve(process.env.IMAGE_TRANSLATOR_RESOURCE_DIR);
  }

  let currentDir = path.resolve(process.cwd());
  while (true) {
    if (path.basename(currentDir).toLowerCase() === 'project') {
      return path.join(path.dirname(currentDir), '资源');
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  return path.resolve(process.cwd(), '..', '资源');
}

const RESOURCE_DIR = resolveResourceDir();
const INDEX_PATH = path.join(RESOURCE_DIR, 'history-index.json');
const MAX_STORED_IMAGE_BYTES = 96 * 1024 * 1024;
const MAX_PREVIEW_IMAGE_BYTES = 3 * 1024 * 1024;
const DEFAULT_HISTORY_LIST_LIMIT = 80;
const MAX_HISTORY_LIST_LIMIT = 120;
const DEFAULT_HISTORY_IMAGE_LIMIT = 24;
const MAX_HISTORY_IMAGE_LIMIT = 60;
const PREVIEW_READ_CONCURRENCY = 4;
const STALE_RUNNING_TASK_THRESHOLD_MS = 30 * 60 * 1000;
const INTERRUPTED_HISTORY_MESSAGE = '上次运行已中断，恢复项目后可继续处理。';
const ACTIVE_HISTORY_IMAGE_STATUSES = new Set(['detecting', 'extracting', 'generating', 'retrying']);
const TERMINAL_SUCCESS_IMAGE_STATUSES = new Set(['success', 'copied']);
const RESERVED_RESOURCE_DIRECTORIES = new Set(['系统日志']);
const ALLOWED_IMAGE_TRANSPORTS = new Set([
  'openai-images',
  'openai-chat-completions',
  'generate-content',
]);
const SENSITIVE_KEY_PATTERN = /authorization|api[_-]?key|x-api-key|x-goog-api-key|key|token|secret|password|access[_-]?token/i;
const REGEXP_SPECIAL_CHARS = /[.*+?^${}()|[\]\\]/g;
const SECRET_VALUE_MASK = '••••••••••••••••';
const taskWriteQueues = new Map<string, Promise<unknown>>();
let indexWriteQueue: Promise<unknown> = Promise.resolve();
const HISTORY_MUTATION_TOKEN = process.env.IMAGE_TRANSLATOR_HISTORY_TOKEN || randomBytes(24).toString('hex');
const HISTORY_MUTATION_TOKEN_HEADER = 'x-image-translator-token';
const HISTORY_MUTATION_REQUEST_HEADER = 'x-image-translator-request';
const HISTORY_MUTATION_REQUEST_VALUE = 'mutation';

function isSafeMutationRequest(request: NextRequest) {
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const host = request.headers.get('host');
  const secFetchSite = request.headers.get('sec-fetch-site')?.toLowerCase() ?? '';
  const mutationRequest = request.headers.get(HISTORY_MUTATION_REQUEST_HEADER) ?? '';
  const requestToken = request.headers.get(HISTORY_MUTATION_TOKEN_HEADER) ?? '';
  const hasToken = Boolean(requestToken);

  if (hasToken) {
    const expected = Buffer.from(HISTORY_MUTATION_TOKEN);
    const actual = Buffer.from(requestToken);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  const sameHost = (value: string | null) => {
    if (!value || !host) return false;
    try {
      return new URL(value).host === host;
    } catch {
      return false;
    }
  };

  if (origin && sameHost(origin)) return true;
  if (!origin && sameHost(referer)) return true;

  return mutationRequest === HISTORY_MUTATION_REQUEST_VALUE && (
    secFetchSite === 'same-origin' ||
    secFetchSite === 'same-site' ||
    secFetchSite === 'none'
  );
}

function jsonResponse(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function safeSegment(segment: string) {
  const cleaned = segment
    .replace(/[<>:"\\|?*\u0000-\u001f]/g, '_')
    .replace(/\.+$/g, '')
    .trim();
  return cleaned || '_';
}

function escapeRegExp(value: string) {
  return value.replace(REGEXP_SPECIAL_CHARS, '\\$&');
}

function enqueueByKey<T>(
  queues: Map<string, Promise<unknown>>,
  key: string,
  operation: () => Promise<T>,
) {
  const previous = queues.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(operation);
  let cleanup: Promise<unknown>;
  cleanup = run
    .then(
      () => undefined,
      () => undefined,
    )
    .finally(() => {
      if (queues.get(key) === cleanup) queues.delete(key);
    });
  queues.set(key, cleanup);
  return run;
}

function withTaskWriteLock<T>(taskId: string, operation: () => Promise<T>) {
  return enqueueByKey(taskWriteQueues, safeSegment(taskId || 'unknown'), operation);
}

function withIndexWriteLock<T>(operation: () => Promise<T>) {
  const previous = indexWriteQueue;
  const run = previous.catch(() => undefined).then(operation);
  indexWriteQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function safeRelativePath(relativePath: string) {
  return relativePath
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .filter((segment) => segment !== '.' && segment !== '..')
    .map(safeSegment)
    .join('/');
}

function ensureStoredImageExtension(relativePath: string, mimeType: string) {
  const normalizedPath = safeRelativePath(relativePath);
  const currentExtension = path.posix.extname(normalizedPath);
  if (
    currentExtension &&
    getImageMimeTypeForExtension(currentExtension) === mimeType
  ) {
    return normalizedPath;
  }
  const extension = getImageExtensionForMimeType(mimeType);
  if (!extension) return normalizedPath;
  return currentExtension
    ? `${normalizedPath.slice(0, -currentExtension.length)}${extension}`
    : `${normalizedPath}${extension}`;
}

function addStoredPathCounter(relativePath: string, counter: number) {
  const parsed = path.posix.parse(relativePath);
  const fileName = `${parsed.name} (${counter})${parsed.ext}`;
  return parsed.dir ? `${parsed.dir}/${fileName}` : fileName;
}

function addStoredPathOwnerSuffix(relativePath: string, imageId: string) {
  const parsed = path.posix.parse(relativePath);
  const ownerSuffix = createHash('sha256')
    .update(imageId)
    .digest('hex')
    .slice(0, 16);
  const fileName = `${parsed.name}.xobi-${ownerSuffix}${parsed.ext}`;
  return parsed.dir ? `${parsed.dir}/${fileName}` : fileName;
}

async function findOwnedStoredImagePath(
  baseDir: string,
  kind: 'originals' | 'results',
  relativePath: string,
  imageId: string,
  directoryEntriesCache?: Map<string, Promise<Dirent[]>>,
) {
  const ownedPath = addStoredPathOwnerSuffix(
    safeRelativePath(relativePath),
    imageId,
  );
  const parsed = path.posix.parse(ownedPath);
  const directoryRelativePath = safeRelativePath(
    `${baseDir}/${kind}/${parsed.dir}`,
  );
  if (parsed.ext && SUPPORTED_IMAGE_EXTENSIONS.has(parsed.ext.toLowerCase())) {
    const exactStoredPath = safeRelativePath(
      `${directoryRelativePath}/${parsed.base}`,
    );
    if (await pathExists(path.join(RESOURCE_DIR, exactStoredPath))) {
      return exactStoredPath;
    }
  }
  const directoryPath = path.join(RESOURCE_DIR, directoryRelativePath);
  let entriesPromise = directoryEntriesCache?.get(directoryPath);
  if (!entriesPromise) {
    entriesPromise = fs
      .readdir(directoryPath, { withFileTypes: true })
      .catch(() => []);
    directoryEntriesCache?.set(directoryPath, entriesPromise);
  }
  const entries = await entriesPromise;
  const candidates = await Promise.all(
    entries
      .filter((entry) => {
        if (!entry.isFile()) return false;
        const entryPath = path.posix.parse(entry.name);
        return (
          entryPath.name === parsed.name &&
          SUPPORTED_IMAGE_EXTENSIONS.has(entryPath.ext.toLowerCase())
        );
      })
      .map(async (entry) => {
        const storedPath = safeRelativePath(
          `${directoryRelativePath}/${entry.name}`,
        );
        const mtimeMs = await fs
          .stat(path.join(RESOURCE_DIR, storedPath))
          .then((stat) => stat.mtimeMs)
          .catch(() => 0);
        return { storedPath, mtimeMs };
      }),
  );
  return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.storedPath;
}

async function resolveUniqueStoredImagePath(
  task: HistoryTaskRecord,
  imageIndex: number,
  kind: 'originals' | 'results',
  relativePath: string,
) {
  const storageRoot = `${safeSegment(task.storageDirName || task.id)}/${kind}`;
  const currentPath =
    kind === 'results'
      ? task.images[imageIndex].resultPath
      : task.images[imageIndex].originalPath;
  const occupiedPaths = new Set(
    task.images
      .filter((_, index) => index !== imageIndex)
      .flatMap((image) => {
        const storedPath = kind === 'results' ? image.resultPath : image.originalPath;
        return storedPath ? [storedPath.toLowerCase()] : [];
      }),
  );
  const ownedRelativePath = addStoredPathOwnerSuffix(
    safeRelativePath(relativePath),
    task.images[imageIndex].id,
  );
  const ownedStoredPath = safeRelativePath(`${storageRoot}/${ownedRelativePath}`);
  const currentMimeType = currentPath
    ? getImageMimeTypeForExtension(path.posix.extname(currentPath))
    : '';
  const requestedMimeType = getImageMimeTypeForExtension(
    path.posix.extname(relativePath),
  );
  let candidateRelativePath =
    currentPath &&
    currentPath.toLowerCase().startsWith(`${storageRoot.toLowerCase()}/`) &&
    currentMimeType === requestedMimeType
      ? currentPath.slice(storageRoot.length + 1)
      : ownedRelativePath;

  for (let counter = 1; counter <= 10_000; counter += 1) {
    const candidateStoredPath = safeRelativePath(
      `${storageRoot}/${candidateRelativePath}`,
    );
    const isCurrentPath =
      currentPath?.toLowerCase() === candidateStoredPath.toLowerCase();
    const isOwnedPath =
      ownedStoredPath.toLowerCase() === candidateStoredPath.toLowerCase();
    const fileExists = await fs
      .stat(path.join(RESOURCE_DIR, candidateStoredPath))
      .then((stat) => stat.isFile())
      .catch(() => false);
    if (
      !occupiedPaths.has(candidateStoredPath.toLowerCase()) &&
      (!fileExists || isCurrentPath || isOwnedPath)
    ) {
      return candidateStoredPath;
    }
    candidateRelativePath = addStoredPathCounter(ownedRelativePath, counter + 1);
  }

  throw new Error('结果文件名冲突过多，无法安全保存。');
}

function looksLikeMojibake(text: string) {
  return /[\uFFFD\u00C3\u00C2]|[\u93B5\u6D93\u934F\u9347]/.test(text);
}

function buildTaskStorageDirName(taskName: string, taskId: string, imageCount = 0) {
  const fallbackName = imageCount > 1 ? `批量图片_${imageCount}张` : '单图项目';
  const name = looksLikeMojibake(taskName) ? fallbackName : taskName;
  const readableName = safeSegment(name).slice(0, 48).replace(/\s+/g, '_');
  const shortId = safeSegment(taskId).slice(-6);
  return `${readableName}_${shortId}`;
}

function taskDir(taskId: string, storageDirName?: string) {
  return path.join(RESOURCE_DIR, safeSegment(storageDirName || taskId));
}

function taskManifestPath(taskId: string, storageDirName?: string) {
  return path.join(taskDir(taskId, storageDirName), 'manifest.json');
}

function taskLogPath(taskId: string, storageDirName?: string) {
  return path.join(taskDir(taskId, storageDirName), 'logs.ndjson');
}

async function ensureResourceDir() {
  await fs.mkdir(RESOURCE_DIR, { recursive: true });
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

async function pathExists(filePath?: string) {
  if (!filePath) return false;
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isTerminalSuccessImageStatus(status: unknown) {
  return typeof status === 'string' && TERMINAL_SUCCESS_IMAGE_STATUSES.has(status);
}

function sanitizeGenerationOperationId(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : undefined;
}

function normalizeTerminalHistoryImage(image: HistoryImageRecord) {
  const normalized = { ...image };
  if (isTerminalSuccessImageStatus(normalized.status)) {
    delete normalized.error;
  }
  return normalized;
}

function recoverStaleTaskExecution(task: HistoryTaskRecord, now = Date.now()) {
  const taskUpdatedAt = Number(task.updatedAt);
  if (
    !Number.isFinite(taskUpdatedAt) ||
    taskUpdatedAt <= 0 ||
    now - taskUpdatedAt <= STALE_RUNNING_TASK_THRESHOLD_MS
  ) {
    return { task, changed: false };
  }

  let changed = false;
  const images = task.images.map((image) => {
    if (!ACTIVE_HISTORY_IMAGE_STATUSES.has(image.status)) return image;
    changed = true;
    return {
      ...image,
      status: 'paused',
      error: INTERRUPTED_HISTORY_MESSAGE,
    };
  });

  return {
    task: changed ? { ...task, images } : task,
    changed,
  };
}

function parseBoundedNumber(
  value: string | null,
  fallback: number,
  max: number,
) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function resolveSafeResourcePath(filePath?: string) {
  if (!filePath) return null;
  const absolutePath = path.resolve(RESOURCE_DIR, filePath);
  const resourceRoot = `${path.resolve(RESOURCE_DIR)}${path.sep}`;
  return absolutePath.startsWith(resourceRoot) ? absolutePath : null;
}

function normalizeIndexValue(value: unknown): HistoryTaskRecord[] {
  if (Array.isArray(value)) return value.filter(Boolean) as HistoryTaskRecord[];
  if (value && typeof value === 'object' && 'id' in value) return [value as HistoryTaskRecord];
  return [];
}

async function writeFileAtomically(filePath: string, content: string | Buffer) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;

  try {
    handle = await fs.open(tempPath, 'wx');
    if (typeof content === 'string') {
      await handle.writeFile(content, 'utf8');
    } else {
      await handle.writeFile(content);
    }
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(tempPath, filePath);
    const expectedBytes =
      typeof content === 'string'
        ? Buffer.byteLength(content, 'utf8')
        : content.byteLength;
    const storedStat = await fs.stat(filePath);
    if (!storedStat.isFile() || storedStat.size !== expectedBytes) {
      throw new Error('本地文件写入后校验失败。');
    }
    const directoryHandle = await fs.open(path.dirname(filePath), 'r').catch(() => null);
    if (directoryHandle) {
      await directoryHandle.sync().catch(() => undefined);
      await directoryHandle.close().catch(() => undefined);
    }
  } finally {
    await handle?.close().catch(() => undefined);
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

async function writeJsonFile(filePath: string, value: unknown) {
  await writeFileAtomically(filePath, JSON.stringify(value, null, 2));
}

async function scanTaskManifests() {
  await ensureResourceDir();
  const entries = await fs.readdir(RESOURCE_DIR, { withFileTypes: true }).catch(() => []);
  const tasks: HistoryTaskRecord[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || RESERVED_RESOURCE_DIRECTORIES.has(entry.name)) continue;
    const manifestPath = path.join(RESOURCE_DIR, entry.name, 'manifest.json');
    const task = await readJsonFile<HistoryTaskRecord | null>(manifestPath, null);
    if (!task?.id) continue;
    tasks.push({ ...task, storageDirName: entry.name.startsWith('task_') ? task.storageDirName : (task.storageDirName ?? entry.name) });
  }

  return tasks;
}

async function findTaskStorageDirName(taskId: string) {
  const rawIndex = await readJsonFile<unknown>(INDEX_PATH, []);
  const indexedTask = normalizeIndexValue(rawIndex).find((task) => task.id === taskId);
  if (indexedTask?.storageDirName) return indexedTask.storageDirName;

  const scannedTask = (await scanTaskManifests()).find((task) => task.id === taskId);
  return scannedTask?.storageDirName;
}

async function repairImagePaths(
  taskId: string,
  storageDirName: string | undefined,
  image: HistoryImageRecord,
  directoryEntriesCache: Map<string, Promise<Dirent[]>>,
) {
  const nextImage = { ...image };
  const baseDirs = [safeSegment(storageDirName || taskId), safeSegment(taskId)];
  const originalRelativePath = safeRelativePath(image.relativePath || image.name || image.id);
  const resultRelativePath = safeRelativePath(image.outputRelativePath || image.relativePath || image.name || image.id);

  for (const baseDir of baseDirs) {
    if (!nextImage.originalPath) {
      const ownedOriginalCandidate = await findOwnedStoredImagePath(
        baseDir,
        'originals',
        originalRelativePath,
        image.id,
        directoryEntriesCache,
      );
      if (ownedOriginalCandidate) {
        nextImage.originalPath = ownedOriginalCandidate;
      }
    }
    const originalCandidate = safeRelativePath(`${baseDir}/originals/${originalRelativePath}`);
    if (!nextImage.originalPath && await pathExists(path.join(RESOURCE_DIR, originalCandidate))) {
      nextImage.originalPath = originalCandidate;
    }

    if (!nextImage.resultPath) {
      const ownedResultCandidate = await findOwnedStoredImagePath(
        baseDir,
        'results',
        resultRelativePath,
        image.id,
        directoryEntriesCache,
      );
      if (ownedResultCandidate) {
        nextImage.resultPath = ownedResultCandidate;
      }
    }
    const resultCandidate = safeRelativePath(`${baseDir}/results/${resultRelativePath}`);
    if (!nextImage.resultPath && await pathExists(path.join(RESOURCE_DIR, resultCandidate))) {
      nextImage.resultPath = resultCandidate;
    }
  }

  return nextImage;
}

async function repairTaskPaths(task: HistoryTaskRecord) {
  let changed = false;
  const directoryEntriesCache = new Map<string, Promise<Dirent[]>>();
  const images = await Promise.all(
    task.images.map(async (image) => {
      const repaired = await repairImagePaths(
        task.id,
        task.storageDirName,
        image,
        directoryEntriesCache,
      );
      const normalized = sanitizeHistoryImageRecord(repaired);
      if (
        normalized.originalPath !== image.originalPath ||
        normalized.resultPath !== image.resultPath ||
        normalized.error !== image.error ||
        normalized.generationOperationId !== image.generationOperationId
      ) {
        changed = true;
      }
      return normalized;
    }),
  );
  return { task: { ...task, images }, changed };
}

async function migrateTaskStorageDir(task: HistoryTaskRecord) {
  const currentDirName = task.storageDirName || task.id;
  const desiredDirName = buildTaskStorageDirName(task.name, task.id, task.images.length);
  if (currentDirName === desiredDirName) return { task, changed: false };
  if (task.storageDirName && !task.storageDirName.startsWith('task_')) return { task, changed: false };

  const oldDir = taskDir(task.id, task.storageDirName);
  const newDir = taskDir(task.id, desiredDirName);
  const canMove = await pathExists(oldDir) && !await pathExists(newDir);

  if (!canMove) return { task, changed: false };

  await fs.rename(oldDir, newDir);
  const oldPrefix = `${safeSegment(task.id)}/`;
  const newPrefix = `${safeSegment(desiredDirName)}/`;
  const images = task.images.map((image) => ({
    ...image,
    originalPath: image.originalPath?.startsWith(oldPrefix)
      ? `${newPrefix}${image.originalPath.slice(oldPrefix.length)}`
      : image.originalPath,
    resultPath: image.resultPath?.startsWith(oldPrefix)
      ? `${newPrefix}${image.resultPath.slice(oldPrefix.length)}`
      : image.resultPath,
  }));

  return {
    task: {
      ...task,
      storageDirName: desiredDirName,
      images,
    },
    changed: true,
  };
}

async function readIndex() {
  await ensureResourceDir();
  const rawIndex = await readJsonFile<unknown>(INDEX_PATH, []);
  const normalizedIndexValue = normalizeIndexValue(rawIndex);
  const scannedTasks = await scanTaskManifests();
  const knownTaskIds = new Set(normalizedIndexValue.map((task) => task.id));
  const normalizedIndex = [
    ...normalizedIndexValue,
    ...scannedTasks.filter((task) => !knownTaskIds.has(task.id)),
  ];
  const cleanedTasks: HistoryTaskRecord[] = [];

  for (const indexTask of normalizedIndex) {
    if (!indexTask?.id) continue;
    const cleanedTask = await withTaskWriteLock(indexTask.id, async () => {
      const manifest = await readTask(indexTask.id, indexTask.storageDirName, {
        recoverStaleExecution: true,
      });
      if (!manifest) return null;
      const migrated = await migrateTaskStorageDir(manifest);
      const repaired = await repairTaskPaths(migrated.task);
      if (migrated.changed || repaired.changed) {
        await writeJsonFile(
          taskManifestPath(indexTask.id, repaired.task.storageDirName),
          sanitizeTaskRecord(repaired.task),
        );
      }
      const hasAnyOriginal = await Promise.all(
        repaired.task.images.map((image) =>
          pathExists(
            image.originalPath
              ? path.join(RESOURCE_DIR, image.originalPath)
              : undefined,
          ),
        ),
      );
      if (repaired.task.images.length > 0 && !hasAnyOriginal.some(Boolean)) {
        return null;
      }
      const updatedAt =
        repaired.task.updatedAt ?? indexTask.updatedAt ?? Date.now();
      return recalcTask(
        { ...repaired.task, updatedAt },
        updatedAt,
      );
    });
    if (cleanedTask) cleanedTasks.push(cleanedTask);
  }

  const indexChanged = !Array.isArray(rawIndex) || cleanedTasks.length !== normalizedIndexValue.length || cleanedTasks.some((task, index) => {
    const indexedTask = normalizedIndexValue[index];
    return !indexedTask ||
      indexedTask.id !== task.id ||
      indexedTask.storageDirName !== task.storageDirName ||
      indexedTask.updatedAt !== task.updatedAt ||
      indexedTask.status !== task.status ||
      indexedTask.doneCount !== task.doneCount ||
      indexedTask.failCount !== task.failCount ||
      !Array.isArray(indexedTask.images) ||
      indexedTask.images.length !== task.images.length ||
      task.images.some((image, imageIndex) => {
        const indexedImage = indexedTask.images[imageIndex];
        return !indexedImage ||
          indexedImage.id !== image.id ||
          indexedImage.status !== image.status ||
          indexedImage.phase !== image.phase ||
          indexedImage.error !== image.error ||
          indexedImage.generationOperationId !== image.generationOperationId;
      });
  });

  if (indexChanged) {
    await withIndexWriteLock(async () => {
      await writeIndexFile(cleanedTasks);
    });
  }

  return cleanedTasks.sort((a, b) => b.updatedAt - a.updatedAt);
}

function compactIndexTasks(tasks: HistoryTaskRecord[]) {
  return tasks
    .map((task) => ({
      ...sanitizeTaskRecord(task),
      images: task.images.map((image) => ({
        ...sanitizeHistoryImageRecord(image),
        originalPath: image.originalPath,
        resultPath: image.resultPath,
      })),
      storageDirName: task.storageDirName,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function redactSensitiveText(value: string) {
  return value
    .replace(/(Authorization\s*[:=]\s*(?:Bearer|Basic)\s+)[^\s"',}]+/gi, `$1${SECRET_VALUE_MASK}`)
    .replace(/(Bearer\s+)[^\s"',}]+/gi, `$1${SECRET_VALUE_MASK}`)
    .replace(/((?:api[_-]?key|x-api-key|x-goog-api-key|key|token|secret|password|access[_-]?token)\s*[:=]\s*)[^,\n\r;&"'}]+/gi, `$1${SECRET_VALUE_MASK}`)
    .replace(/([?&](?:api[_-]?key|key|token|access[_-]?token|secret|password)=)[^&#\s]+/gi, `$1${SECRET_VALUE_MASK}`);
}

function sanitizeSettingsSummary(value: unknown) {
  if (!isPlainRecord(value)) return undefined;

  const imageRequestTimeoutMs = Number(value.imageRequestTimeoutMs);
  const transport = typeof value.transport === 'string' && ALLOWED_IMAGE_TRANSPORTS.has(value.transport)
    ? value.transport
    : undefined;

  return {
    apiBaseUrl: typeof value.apiBaseUrl === 'string' ? redactSensitiveText(value.apiBaseUrl).split(/[?#]/)[0] : undefined,
    textModel: typeof value.textModel === 'string' ? value.textModel : undefined,
    imageModel: typeof value.imageModel === 'string' ? value.imageModel : undefined,
    maxParallelTasks: typeof value.maxParallelTasks === 'number' ? value.maxParallelTasks : undefined,
    imageRequestTimeoutMs: Number.isFinite(imageRequestTimeoutMs) && imageRequestTimeoutMs >= 1000
      ? Math.floor(imageRequestTimeoutMs)
      : undefined,
    skipOcr: typeof value.skipOcr === 'boolean' ? value.skipOcr : undefined,
    transport,
  };
}

function sanitizeHistoryImageRecord(image: HistoryImageRecord, options: { redactContent?: boolean } = {}): HistoryImageRecord {
  const sanitized = normalizeTerminalHistoryImage({
    ...image,
    error: typeof image.error === 'string' ? redactSensitiveText(image.error) : image.error,
    extractedText: options.redactContent && typeof image.extractedText === 'string' ? redactSensitiveText(image.extractedText) : image.extractedText,
    translatedText: options.redactContent && typeof image.translatedText === 'string' ? redactSensitiveText(image.translatedText) : image.translatedText,
  });
  const generationOperationId = sanitizeGenerationOperationId(image.generationOperationId);
  if (generationOperationId) sanitized.generationOperationId = generationOperationId;
  else delete sanitized.generationOperationId;
  return sanitized;
}

function sanitizeTaskRecord(task: HistoryTaskRecord, options: { redactContent?: boolean } = {}): HistoryTaskRecord {
  return {
    ...task,
    settingsSummary: sanitizeSettingsSummary(task.settingsSummary),
    images: task.images.map((image) => sanitizeHistoryImageRecord(image, options)),
  };
}

function sanitizeLogEvent(event: Record<string, unknown>) {
  const type = String(event.type ?? 'event');
  return {
    type,
    imageId: typeof event.imageId === 'string' ? event.imageId : undefined,
    kind: typeof event.kind === 'string' ? event.kind : undefined,
    status: typeof event.status === 'string' ? event.status : undefined,
    phase: typeof event.phase === 'string' ? event.phase : undefined,
    totalCount: typeof event.totalCount === 'number' ? event.totalCount : undefined,
    language: typeof event.language === 'string' ? event.language : undefined,
    ratio: typeof event.ratio === 'string' ? event.ratio : undefined,
    changedKeys: Array.isArray(event.changedKeys) ? event.changedKeys.map(String) : undefined,
    message: typeof event.message === 'string' ? redactSensitiveText(event.message) : undefined,
  };
}

function isAllowedStoredImagePath(task: HistoryTaskRecord, filePath: string | undefined, kind?: 'original' | 'result') {
  if (!filePath) return false;
  const normalizedPath = safeRelativePath(filePath);
  if (normalizedPath !== filePath.replace(/\\/g, '/')) return false;
  const storageDirName = safeSegment(task.storageDirName || task.id);
  const folder = kind === 'result' ? 'results' : kind === 'original' ? 'originals' : '(?:originals|results)';
  const pattern = new RegExp(`^${escapeRegExp(storageDirName)}/${folder}/.+`, 'i');
  const extension = path.extname(normalizedPath).toLowerCase();
  return pattern.test(normalizedPath) && (!extension || SUPPORTED_IMAGE_EXTENSIONS.has(extension));
}

function getImageMimeType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  return getImageMimeTypeForExtension(ext) || 'image/png';
}

async function writeIndexFile(tasks: HistoryTaskRecord[]) {
  await writeJsonFile(INDEX_PATH, compactIndexTasks(tasks));
}

async function writeIndex(tasks: HistoryTaskRecord[]) {
  await withIndexWriteLock(() => writeIndexFile(tasks));
}


async function upsertIndexTask(task: HistoryTaskRecord) {
  await withIndexWriteLock(async () => {
    const rawIndex = await readJsonFile<unknown>(INDEX_PATH, []);
    const index = normalizeIndexValue(rawIndex);
    await writeIndexFile([task, ...index.filter((item) => item.id !== task.id)]);
  });
}

async function removeIndexTask(taskId: string) {
  await withIndexWriteLock(async () => {
    const rawIndex = await readJsonFile<unknown>(INDEX_PATH, []);
    const index = normalizeIndexValue(rawIndex);
    await writeIndexFile(index.filter((task) => task.id !== taskId));
  });
}

async function removeTaskDirectory(taskId: string, storageDirName?: string) {
  const directoryName = safeSegment(storageDirName || taskId);
  if (directoryName.includes('/') || directoryName.includes('\\')) return;
  const absolutePath = path.resolve(taskDir(taskId, directoryName));
  const resourceRoot = `${path.resolve(RESOURCE_DIR)}${path.sep}`;
  if (!absolutePath.startsWith(resourceRoot)) return;
  const manifest = await readJsonFile<HistoryTaskRecord | null>(path.join(absolutePath, 'manifest.json'), null);
  if (manifest?.id !== taskId) return;
  await fs.rm(absolutePath, { recursive: true, force: true });
}

async function readTask(
  taskId: string,
  storageDirName?: string,
  options: { recoverStaleExecution?: boolean; now?: number } = {},
) {
  const resolvedStorageDirName = storageDirName ?? await findTaskStorageDirName(taskId);
  let task = await readJsonFile<HistoryTaskRecord | null>(taskManifestPath(taskId, resolvedStorageDirName), null);
  if (!task && resolvedStorageDirName) {
    task = await readJsonFile<HistoryTaskRecord | null>(taskManifestPath(taskId), null);
  }
  if (!task) return null;
  const taskWithStorage = resolvedStorageDirName && !task.storageDirName
    ? { ...task, storageDirName: resolvedStorageDirName }
    : task;
  const repaired = await repairTaskPaths(taskWithStorage);
  const recovered = options.recoverStaleExecution
    ? recoverStaleTaskExecution(repaired.task, options.now)
    : { task: repaired.task, changed: false };
  const normalizedTask = recovered.changed
    ? recalcTask(recovered.task, recovered.task.updatedAt)
    : recovered.task;
  if (repaired.changed || recovered.changed || taskWithStorage !== task) {
    await writeJsonFile(
      taskManifestPath(taskId, normalizedTask.storageDirName),
      sanitizeTaskRecord(normalizedTask),
    );
  }
  return sanitizeTaskRecord(normalizedTask);
}

function recalcTask(task: HistoryTaskRecord, updatedAt = Date.now()): HistoryTaskRecord {
  const doneCount = task.images.filter((image) => image.status === 'success' || image.status === 'copied').length;
  const failCount = task.images.filter((image) => image.status === 'error').length;
  const copiedCount = task.images.filter((image) => image.status === 'copied').length;
  const hasRunning = task.images.some((image) => ['detecting', 'extracting', 'generating', 'retrying'].includes(image.status));
  const hasPending = task.images.some((image) => image.status === 'idle' || image.status === 'paused');
  let status: HistoryTaskRecord['status'] = 'idle';

  if (task.images.length > 0 && doneCount === task.images.length) status = 'done';
  else if (hasRunning) status = 'running';
  else if (failCount > 0) status = doneCount > 0 ? 'partial' : 'failed';
  else if (doneCount > 0 || hasPending) status = doneCount > 0 ? 'partial' : 'idle';

  return {
    ...task,
    updatedAt,
    totalCount: task.images.length,
    doneCount,
    failCount,
    copiedCount,
    status,
  };
}

async function persistTask(task: HistoryTaskRecord) {
  const normalized = sanitizeTaskRecord(recalcTask(task, Date.now()));
  await writeJsonFile(taskManifestPath(normalized.id, normalized.storageDirName), normalized);
  await upsertIndexTask(normalized);
  return normalized;
}

function dataUrlToBuffer(dataUrl: string) {
  const commaIndex = dataUrl.indexOf(',');
  const header = commaIndex >= 0 ? dataUrl.slice(0, commaIndex) : '';
  const base64Data = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : '';
  const mimeMatch = /^data:([^;,]+);base64$/i.exec(header);

  if (!mimeMatch || !base64Data) {
    throw new Error('图片数据格式无效。');
  }

  const mimeType = normalizeSupportedImageMimeType(mimeMatch[1]);
  if (!mimeType) {
    throw new Error('只允许保存 jpg、png、webp、gif、bmp、avif 图片。');
  }

  if (!/^[A-Za-z0-9+/=\s]+$/.test(base64Data)) {
    throw new Error('图片 base64 数据无效。');
  }

  const normalizedBase64 = base64Data.replace(/\s/g, '');
  const estimatedBytes = Math.floor((normalizedBase64.length * 3) / 4);
  if (estimatedBytes > MAX_STORED_IMAGE_BYTES) {
    throw new Error('图片太大，单张最多保存 96 MB。');
  }

  const buffer = Buffer.from(normalizedBase64, 'base64');
  if (buffer.length === 0 || buffer.length > MAX_STORED_IMAGE_BYTES) {
    throw new Error('图片太大或数据为空。');
  }
  const detectedMimeType = detectSupportedImageMimeType(
    buffer.subarray(0, Math.min(buffer.length, 64)),
  );
  if (detectedMimeType !== mimeType) {
    throw new Error('图片声明格式与实际文件内容不一致。');
  }

  return { buffer, mimeType };
}

async function fileToDataUrl(task: HistoryTaskRecord, filePath?: string, kind?: 'original' | 'result', maxBytes?: number) {
  if (!filePath || !isAllowedStoredImagePath(task, filePath, kind)) return null;
  try {
    const absolutePath = resolveSafeResourcePath(filePath);
    if (!absolutePath) return null;
    if (typeof maxBytes === 'number') {
      const stat = await fs.stat(absolutePath);
      if (stat.size > maxBytes) return null;
    }
    const data = await fs.readFile(absolutePath);
    return `data:${getImageMimeType(filePath)};base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
}

async function buildTaskPreviewImages(task: HistoryTaskRecord, limit = 4): Promise<HistoryPreviewImage[]> {
  const picked: HistoryPreviewImage[] = [];
  const orderedImages = [
    ...task.images.filter((image) => image.resultPath),
    ...task.images.filter((image) => !image.resultPath && image.originalPath),
  ];

  for (const image of orderedImages) {
    if (picked.length >= limit || picked.some((item) => item.id === image.id)) continue;
    const isResult = !!image.resultPath;
    const targetPath = image.resultPath || image.originalPath;
    if (targetPath) {
      picked.push({
        id: image.id,
        name: image.name,
        dataUrl: `/api/history?file=1&taskId=${encodeURIComponent(task.id)}&imageId=${encodeURIComponent(image.id)}&kind=${isResult ? 'result' : 'original'}`,
        kind: isResult ? 'result' : 'original',
      });
    }
  }

  return picked;
}

async function withImageData(task: HistoryTaskRecord, image: HistoryImageRecord, kind = 'both') {
  return {
    ...sanitizeHistoryImageRecord(image),
    originalDataUrl: kind === 'result' ? undefined : await fileToDataUrl(task, image.originalPath, 'original', MAX_STORED_IMAGE_BYTES),
    resultDataUrl: kind === 'original' ? undefined : await fileToDataUrl(task, image.resultPath, 'result', MAX_STORED_IMAGE_BYTES),
  };
}

async function removeStoredFile(task: HistoryTaskRecord, filePath: string | undefined, kind: 'original' | 'result') {
  if (!filePath || !isAllowedStoredImagePath(task, filePath, kind)) return;
  const absolutePath = resolveSafeResourcePath(filePath);
  if (!absolutePath) return;
  await fs.rm(absolutePath, { force: true });
}

async function appendLog(taskId: string, event: Record<string, unknown>, storageDirName?: string) {
  if (!taskId) return;
  const task = storageDirName ? null : await readTask(taskId);
  const targetStorageDirName = storageDirName ?? task?.storageDirName;
  await fs.mkdir(taskDir(taskId, targetStorageDirName), { recursive: true });
  const line = JSON.stringify({ at: Date.now(), ...sanitizeLogEvent(event) });
  await fs.appendFile(taskLogPath(taskId, targetStorageDirName), `${line}\n`, 'utf8');
}

export async function GET(request: NextRequest) {
  const wantsFile = request.nextUrl.searchParams.get('file') === '1';
  if (wantsFile) {
    const taskIdForFile = request.nextUrl.searchParams.get('taskId') ?? '';
    const imageIdForFile = request.nextUrl.searchParams.get('imageId') ?? '';
    const kindForFile = request.nextUrl.searchParams.get('kind') === 'result' ? 'result' : 'original';
    const taskForFile = await withTaskWriteLock(taskIdForFile, () => readTask(taskIdForFile));
    const imageForFile = taskForFile?.images.find((item) => item.id === imageIdForFile);
    const relativePath = kindForFile === 'result' ? imageForFile?.resultPath : imageForFile?.originalPath;

    if (!taskForFile || !imageForFile || !relativePath || !isAllowedStoredImagePath(taskForFile, relativePath, kindForFile)) {
      return jsonResponse({ error: { message: '历史图片不存在。' } }, 404);
    }

    const absolutePath = resolveSafeResourcePath(relativePath);
    if (!absolutePath) {
      return jsonResponse({ error: { message: '非法的文件路径。' } }, 403);
    }

    try {
      const data = await fs.readFile(absolutePath);
      return new NextResponse(data, {
        headers: {
          'Content-Type': getImageMimeType(relativePath),
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    } catch {
      return jsonResponse({ error: { message: '文件未找到。' } }, 404);
    }
  }

  if (request.nextUrl.searchParams.has('path')) {
    return jsonResponse({ error: { message: '历史文件路径访问已禁用。' } }, 403);
  }

  const taskId = request.nextUrl.searchParams.get('taskId');
  const includeData = request.nextUrl.searchParams.get('includeData') === '1';
  const includePreview = request.nextUrl.searchParams.get('preview') === '1';
  const cursor = parseBoundedNumber(request.nextUrl.searchParams.get('cursor'), 0, Number.MAX_SAFE_INTEGER);
  const listLimit = parseBoundedNumber(
    request.nextUrl.searchParams.get('limit'),
    DEFAULT_HISTORY_LIST_LIMIT,
    MAX_HISTORY_LIST_LIMIT,
  );

  if (!taskId) {
    const tasks = await readIndex();
    const pagedTasks = tasks.slice(cursor, cursor + listLimit);
    const nextCursor = cursor + pagedTasks.length;
    const hasMore = nextCursor < tasks.length;
    if (!includePreview) {
      return jsonResponse({
        resourceDir: RESOURCE_DIR,
        tasks: pagedTasks.map((task) => sanitizeTaskRecord(task)),
        totalCount: tasks.length,
        nextCursor: hasMore ? nextCursor : null,
        hasMore,
      });
    }

    const tasksWithPreview = await runWithConcurrencyLimit(
      pagedTasks.map((task) => async () => ({
        ...sanitizeTaskRecord(task),
        previewImages: await buildTaskPreviewImages(task),
      })),
      PREVIEW_READ_CONCURRENCY,
    );
    return jsonResponse({
      resourceDir: RESOURCE_DIR,
      tasks: tasksWithPreview,
      totalCount: tasks.length,
      nextCursor: hasMore ? nextCursor : null,
      hasMore,
    });
  }

  const task = await withTaskWriteLock(taskId, () => readTask(taskId, undefined, {
    recoverStaleExecution: true,
  }));
  if (!task) return jsonResponse({ error: { message: '历史任务不存在。' } }, 404);

  let logs = '';
  try {
    logs = await fs.readFile(taskLogPath(taskId, task.storageDirName), 'utf8');
  } catch {
    logs = '';
  }

  if (!includeData) return jsonResponse({ task: sanitizeTaskRecord(task), logs: redactSensitiveText(logs) });

  const imageId = request.nextUrl.searchParams.get('imageId');
  const kind = request.nextUrl.searchParams.get('kind') ?? 'both';
  if (imageId) {
    const image = task.images.find((item) => item.id === imageId);
    if (!image) return jsonResponse({ error: { message: '历史图片不存在。' } }, 404);
    return jsonResponse({
      task: { ...sanitizeTaskRecord(task), images: [] },
      image: await withImageData(task, image, kind),
      logs: redactSensitiveText(logs),
    });
  }

  const imageOffset = parseBoundedNumber(request.nextUrl.searchParams.get('imageOffset'), 0, Number.MAX_SAFE_INTEGER);
  const imageLimit = parseBoundedNumber(
    request.nextUrl.searchParams.get('imageLimit'),
    DEFAULT_HISTORY_IMAGE_LIMIT,
    MAX_HISTORY_IMAGE_LIMIT,
  );
  const imagesWithoutData = task.images.slice(imageOffset, imageOffset + imageLimit);
  const images = await runWithConcurrencyLimit(
    imagesWithoutData.map((image) => () => withImageData(task, image)),
    PREVIEW_READ_CONCURRENCY,
  );
  const nextImageOffset = imageOffset + images.length;
  const hasMoreImages = nextImageOffset < task.images.length;

  return jsonResponse({
    task: {
      ...sanitizeTaskRecord(task),
      images,
      imageOffset,
      imageLimit,
      totalImages: task.images.length,
      hasMoreImages,
    },
    logs: redactSensitiveText(logs),
    imageOffset,
    imageLimit,
    nextImageOffset: hasMoreImages ? nextImageOffset : null,
    hasMoreImages,
    totalImages: task.images.length,
  });
}

const MAX_HISTORY_POST_BODY_BYTES = 140 * 1024 * 1024;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

async function readPostBody(request: NextRequest) {
  const rawContentLength = request.headers.get('content-length');
  if (rawContentLength) {
    const contentLength = Number(rawContentLength);
    if (Number.isFinite(contentLength) && contentLength > MAX_HISTORY_POST_BODY_BYTES) {
      throw new Error('请求体太大。');
    }
  }

  if (!request.body) {
    try {
      return JSON.parse(await request.text()) as unknown;
    } catch {
      throw new Error('请求体 JSON 格式无效。');
    }
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  const textChunks: string[] = [];

  try {
    while (true) {
      if (request.signal.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }

      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_HISTORY_POST_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('请求体太大。');
      }
      textChunks.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    reader.releaseLock();
  }

  textChunks.push(decoder.decode());

  try {
    return JSON.parse(textChunks.join('')) as unknown;
  } catch {
    throw new Error('请求体 JSON 格式无效。');
  }
}

export async function POST(request: NextRequest) {
  if (!isSafeMutationRequest(request)) {
    return jsonResponse({ error: { message: '历史写入请求未授权。' } }, 403);
  }

  let body: Record<string, unknown>;
  try {
    const rawBody = await readPostBody(request);
    if (!isPlainRecord(rawBody)) {
      return jsonResponse({ error: { message: '请求体不能为空。' } }, 400);
    }
    body = rawBody;
  } catch (error) {
    return jsonResponse(
      { error: { message: error instanceof Error ? error.message : '请求体无效。' } },
      error instanceof Error && error.message.includes('太大') ? 413 : 400,
    );
  }
  const action = String(body.action ?? '');
  await ensureResourceDir();

  if (action === 'upsert-task') {
    const now = Date.now();
    const incomingTask = isPlainRecord(body.task) ? body.task : {};
    const taskId = String(incomingTask.id ?? body.taskId ?? `task_${now}`);
    return withTaskWriteLock(taskId, async () => {
    const current = await readTask(taskId);
    const incomingImages = Array.isArray(body.images) ? body.images : [];
    const imageMap = new Map<string, HistoryImageRecord>();

    current?.images.forEach((image) => imageMap.set(image.id, image));
    incomingImages.forEach((image: Partial<HistoryImageRecord>) => {
      const id = String(image.id ?? '');
      if (!id) return;
      const currentImage = imageMap.get(id);
      imageMap.set(id, {
        ...currentImage,
        id,
        name: String(image.name ?? currentImage?.name ?? id),
        relativePath: String(image.relativePath ?? currentImage?.relativePath ?? image.name ?? id),
        outputRelativePath: String(image.outputRelativePath ?? currentImage?.outputRelativePath ?? image.relativePath ?? image.name ?? id),
        groupLabel: String(image.groupLabel ?? currentImage?.groupLabel ?? '单独上传'),
        status: String(image.status ?? currentImage?.status ?? 'idle'),
        phase: String(image.phase ?? currentImage?.phase ?? 'idle'),
        sourceKind: String(image.sourceKind ?? currentImage?.sourceKind ?? 'file'),
        pathKey: String(image.pathKey ?? currentImage?.pathKey ?? id),
        ...(Object.prototype.hasOwnProperty.call(image, 'generationOperationId')
          ? { generationOperationId: sanitizeGenerationOperationId(image.generationOperationId) }
          : {}),
        updatedAt: now,
      });
    });

    const taskName = String(incomingTask.name ?? current?.name ?? `翻译任务 ${new Date(now).toLocaleString('zh-CN')}`);
    const settingsSummary = sanitizeSettingsSummary(isPlainRecord(incomingTask.settingsSummary)
      ? incomingTask.settingsSummary
      : current?.settingsSummary);
    const task: HistoryTaskRecord = {
      id: taskId,
      name: taskName,
      createdAt: Number(incomingTask.createdAt ?? current?.createdAt ?? now),
      updatedAt: now,
      language: String(incomingTask.language ?? current?.language ?? '中文'),
      ratio: String(incomingTask.ratio ?? current?.ratio ?? '原图'),
      mode: String(incomingTask.mode ?? current?.mode ?? 'translate_only'),
      totalCount: 0,
      doneCount: 0,
      failCount: 0,
      copiedCount: 0,
      status: 'idle',
      settingsSummary,
      storageDirName: current?.storageDirName ?? buildTaskStorageDirName(taskName, taskId, imageMap.size),
      images: Array.from(imageMap.values()),
    };

    const saved = await persistTask(task);
    await appendLog(taskId, { type: 'task-upsert', totalCount: saved.totalCount, language: saved.language, ratio: saved.ratio }, saved.storageDirName);
    return jsonResponse({ task: saved, resourceDir: RESOURCE_DIR });
    });
  }

  if (action === 'save-image') {
    const taskId = String(body.taskId ?? '');
    const imageId = String(body.imageId ?? '');
    return withTaskWriteLock(taskId, async () => {
    const kind = body.kind === 'result' ? 'results' : 'originals';
    const dataUrl = String(body.dataUrl ?? '');
    const task = await readTask(taskId);
    if (!task) return jsonResponse({ error: { message: '历史任务不存在。' } }, 404);
    const imageIndex = task.images.findIndex((image) => image.id === imageId);
    if (imageIndex < 0) return jsonResponse({ error: { message: '历史图片不存在。' } }, 404);

    const requestedRelativePath = safeRelativePath(
      String(body.relativePath ?? task.images[imageIndex].outputRelativePath),
    );
    let imageBuffer: Buffer;
    let imageMimeType: string;
    try {
      const decodedImage = dataUrlToBuffer(dataUrl);
      imageBuffer = decodedImage.buffer;
      imageMimeType = decodedImage.mimeType;
    } catch (error) {
      return jsonResponse({ error: { message: error instanceof Error ? error.message : '图片数据格式无效。' } }, 400);
    }
    const relativePath = ensureStoredImageExtension(
      requestedRelativePath,
      imageMimeType,
    );
    const storedRelativePath = await resolveUniqueStoredImagePath(
      task,
      imageIndex,
      kind,
      relativePath,
    );
    const absolutePath = path.join(RESOURCE_DIR, storedRelativePath);
    await writeFileAtomically(absolutePath, imageBuffer);

    task.images[imageIndex] = {
      ...task.images[imageIndex],
      ...(kind === 'results' ? { resultPath: storedRelativePath } : { originalPath: storedRelativePath }),
      updatedAt: Date.now(),
    };
    const saved = await persistTask(task);
    await appendLog(taskId, { type: 'save-image', imageId, kind, path: storedRelativePath }, saved.storageDirName);
    return jsonResponse({ task: saved, path: storedRelativePath });
    });
  }

  if (action === 'update-image') {
    const taskId = String(body.taskId ?? '');
    const imageId = String(body.imageId ?? '');
    return withTaskWriteLock(taskId, async () => {
    const task = await readTask(taskId);
    if (!task) return jsonResponse({ error: { message: '历史任务不存在。' } }, 404);
    const imageIndex = task.images.findIndex((image) => image.id === imageId);
    if (imageIndex < 0) return jsonResponse({ error: { message: '历史图片不存在。' } }, 404);

    const allowed = ['status', 'phase', 'outputRelativePath', 'error', 'hasText', 'extractedText', 'translatedText', 'retryCount', 'attemptCount', 'startedAt', 'completedAt', 'generationOperationId'] as const;
    const patch = isPlainRecord(body.patch) ? body.patch : {};
    const nextImage = { ...task.images[imageIndex], updatedAt: Date.now() } as Record<string, unknown>;
    allowed.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(patch, key)) nextImage[key] = patch[key];
    });
    if (isTerminalSuccessImageStatus(nextImage.status)) {
      delete nextImage.error;
    }
    task.images[imageIndex] = sanitizeHistoryImageRecord(nextImage as unknown as HistoryImageRecord);
    const saved = await persistTask(task);
    await appendLog(taskId, {
      type: 'update-image',
      imageId,
      status: typeof nextImage.status === 'string' ? nextImage.status : undefined,
      phase: typeof nextImage.phase === 'string' ? nextImage.phase : undefined,
      changedKeys: allowed.filter((key) => Object.prototype.hasOwnProperty.call(patch, key)),
    }, saved.storageDirName);
    return jsonResponse({ task: saved });
    });
  }

  if (action === 'delete-image') {
    const taskId = String(body.taskId ?? '');
    const imageId = String(body.imageId ?? '');
    return withTaskWriteLock(taskId, async () => {
    const task = await readTask(taskId);
    if (!task) return jsonResponse({ error: { message: '历史任务不存在。' } }, 404);
    const image = task.images.find((item) => item.id === imageId);
    if (!image) return jsonResponse({ error: { message: '历史图片不存在。' } }, 404);

    await Promise.all([
      removeStoredFile(task, image.originalPath, 'original'),
      removeStoredFile(task, image.resultPath, 'result'),
    ]);
    const nextTask = { ...task, images: task.images.filter((item) => item.id !== imageId) };
    const saved = await persistTask(nextTask);
    await appendLog(taskId, { type: 'delete-image', imageId }, saved.storageDirName);
    return jsonResponse({ task: saved });
    });
  }

  if (action === 'append-log') {
    const taskId = String(body.taskId ?? '');
    return withTaskWriteLock(taskId, async () => {
      await appendLog(taskId, isPlainRecord(body.event) ? body.event : {});
      return jsonResponse({ ok: true });
    });
  }

  if (action === 'delete-task') {
    const taskId = String(body.taskId ?? '');
    return withTaskWriteLock(taskId, async () => {
    const task = await readTask(taskId);
    await removeTaskDirectory(taskId, task?.storageDirName);
    await removeIndexTask(taskId);
    return jsonResponse({ ok: true });
    });
  }

  return jsonResponse({ error: { message: '未知历史操作。' } }, 400);
}
