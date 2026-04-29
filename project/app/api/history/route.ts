import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

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
const MAX_STORED_IMAGE_BYTES = 60 * 1024 * 1024;
const MAX_PREVIEW_IMAGE_BYTES = 3 * 1024 * 1024;
const DEFAULT_HISTORY_LIST_LIMIT = 80;
const MAX_HISTORY_LIST_LIMIT = 120;
const DEFAULT_HISTORY_IMAGE_LIMIT = 24;
const MAX_HISTORY_IMAGE_LIMIT = 60;
const PREVIEW_READ_CONCURRENCY = 4;
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
]);
const taskWriteQueues = new Map<string, Promise<unknown>>();
let indexWriteQueue: Promise<unknown> = Promise.resolve();

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

function enqueueByKey<T>(
  queues: Map<string, Promise<unknown>>,
  key: string,
  operation: () => Promise<T>,
) {
  const previous = queues.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(operation);
  let cleanup: Promise<unknown>;
  cleanup = run.finally(() => {
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
  indexWriteQueue = run.finally(() => undefined);
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

async function writeJsonFile(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
  );

  try {
    await fs.writeFile(tempPath, JSON.stringify(value, null, 2), 'utf8');
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function scanTaskManifests() {
  await ensureResourceDir();
  const entries = await fs.readdir(RESOURCE_DIR, { withFileTypes: true }).catch(() => []);
  const tasks: HistoryTaskRecord[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
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

async function repairImagePaths(taskId: string, storageDirName: string | undefined, image: HistoryImageRecord) {
  const nextImage = { ...image };
  const baseDirs = [safeSegment(storageDirName || taskId), safeSegment(taskId)];
  const originalRelativePath = safeRelativePath(image.relativePath || image.name || image.id);
  const resultRelativePath = safeRelativePath(image.outputRelativePath || image.relativePath || image.name || image.id);

  for (const baseDir of baseDirs) {
    const originalCandidate = safeRelativePath(`${baseDir}/originals/${originalRelativePath}`);
    if (!nextImage.originalPath && await pathExists(path.join(RESOURCE_DIR, originalCandidate))) {
      nextImage.originalPath = originalCandidate;
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
  const images = await Promise.all(
    task.images.map(async (image) => {
      const repaired = await repairImagePaths(task.id, task.storageDirName, image);
      if (repaired.originalPath !== image.originalPath || repaired.resultPath !== image.resultPath) changed = true;
      return repaired;
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
    const manifest = await readTask(indexTask.id, indexTask.storageDirName);
    if (!manifest) continue;
    const migrated = await migrateTaskStorageDir(manifest);
    const repaired = await repairTaskPaths(migrated.task);
    if (migrated.changed || repaired.changed) await writeJsonFile(taskManifestPath(indexTask.id, repaired.task.storageDirName), repaired.task);
    const hasAnyOriginal = await Promise.all(
      repaired.task.images.map((image) => pathExists(image.originalPath ? path.join(RESOURCE_DIR, image.originalPath) : undefined)),
    );
    if (repaired.task.images.length > 0 && !hasAnyOriginal.some(Boolean)) continue;
    cleanedTasks.push(recalcTask({ ...repaired.task, updatedAt: repaired.task.updatedAt ?? indexTask.updatedAt ?? Date.now() }, repaired.task.updatedAt ?? indexTask.updatedAt ?? Date.now()));
  }

  if (cleanedTasks.length !== normalizedIndexValue.length || !Array.isArray(rawIndex)) {
    await writeIndex(cleanedTasks);
  }

  return cleanedTasks.sort((a, b) => b.updatedAt - a.updatedAt);
}

function compactIndexTasks(tasks: HistoryTaskRecord[]) {
  return tasks
    .map((task) => ({
      ...task,
      images: task.images.map((image) => ({
        ...image,
        originalPath: image.originalPath,
        resultPath: image.resultPath,
      })),
      storageDirName: task.storageDirName,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

async function writeIndexFile(tasks: HistoryTaskRecord[]) {
  await writeJsonFile(INDEX_PATH, compactIndexTasks(tasks));
}

async function writeIndex(tasks: HistoryTaskRecord[]) {
  await withIndexWriteLock(() => writeIndexFile(tasks));
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
  const absolutePath = path.resolve(taskDir(taskId, storageDirName));
  const resourceRoot = `${path.resolve(RESOURCE_DIR)}${path.sep}`;
  if (!absolutePath.startsWith(resourceRoot)) return;
  await fs.rm(absolutePath, { recursive: true, force: true });
}

async function readTask(taskId: string, storageDirName?: string) {
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
  if (repaired.changed || taskWithStorage !== task) await writeJsonFile(taskManifestPath(taskId, repaired.task.storageDirName), repaired.task);
  return repaired.task;
}

function recalcTask(task: HistoryTaskRecord, updatedAt = Date.now()): HistoryTaskRecord {
  const doneCount = task.images.filter((image) => image.status === 'success' || image.status === 'copied').length;
  const failCount = task.images.filter((image) => image.status === 'error').length;
  const copiedCount = task.images.filter((image) => image.status === 'copied').length;
  const hasRunning = task.images.some((image) => ['detecting', 'extracting', 'generating', 'retrying'].includes(image.status));
  const hasPending = task.images.some((image) => image.status === 'idle');
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
  const normalized = recalcTask(task, Date.now());
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

  const mimeType = mimeMatch[1].toLowerCase();
  if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new Error('只允许保存 jpg、png、webp、gif、bmp 图片。');
  }

  if (!/^[A-Za-z0-9+/=\s]+$/.test(base64Data)) {
    throw new Error('图片 base64 数据无效。');
  }

  const normalizedBase64 = base64Data.replace(/\s/g, '');
  const estimatedBytes = Math.floor((normalizedBase64.length * 3) / 4);
  if (estimatedBytes > MAX_STORED_IMAGE_BYTES) {
    throw new Error('图片太大，单张最多保存 60 MB。');
  }

  const buffer = Buffer.from(normalizedBase64, 'base64');
  if (buffer.length === 0 || buffer.length > MAX_STORED_IMAGE_BYTES) {
    throw new Error('图片太大或数据为空。');
  }

  return buffer;
}

async function fileToDataUrl(filePath?: string, maxBytes?: number) {
  if (!filePath) return null;
  try {
    const absolutePath = resolveSafeResourcePath(filePath);
    if (!absolutePath) return null;
    if (typeof maxBytes === 'number') {
      const stat = await fs.stat(absolutePath);
      if (stat.size > maxBytes) return null;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = ext === '.jpg' || ext === '.jpeg'
      ? 'image/jpeg'
      : ext === '.webp'
        ? 'image/webp'
        : ext === '.gif'
          ? 'image/gif'
          : ext === '.bmp'
            ? 'image/bmp'
            : 'image/png';
    const data = await fs.readFile(absolutePath);
    return `data:${mimeType};base64,${data.toString('base64')}`;
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
    const resultDataUrl = await fileToDataUrl(image.resultPath, MAX_PREVIEW_IMAGE_BYTES);
    if (resultDataUrl) {
      picked.push({ id: image.id, name: image.name, dataUrl: resultDataUrl, kind: 'result' });
      continue;
    }

    const originalDataUrl = await fileToDataUrl(image.originalPath, MAX_PREVIEW_IMAGE_BYTES);
    if (originalDataUrl) {
      picked.push({ id: image.id, name: image.name, dataUrl: originalDataUrl, kind: 'original' });
    }
  }

  return picked;
}

async function withImageData(image: HistoryImageRecord, kind = 'both') {
  return {
    ...image,
    originalDataUrl: kind === 'result' ? undefined : await fileToDataUrl(image.originalPath),
    resultDataUrl: kind === 'original' ? undefined : await fileToDataUrl(image.resultPath),
  };
}

async function removeStoredFile(filePath?: string) {
  if (!filePath) return;
  const absolutePath = resolveSafeResourcePath(filePath);
  if (!absolutePath) return;
  await fs.rm(absolutePath, { force: true });
}

async function appendLog(taskId: string, event: Record<string, unknown>, storageDirName?: string) {
  if (!taskId) return;
  const task = storageDirName ? null : await readTask(taskId);
  const targetStorageDirName = storageDirName ?? task?.storageDirName;
  await fs.mkdir(taskDir(taskId, targetStorageDirName), { recursive: true });
  const line = JSON.stringify({ at: Date.now(), ...event });
  await fs.appendFile(taskLogPath(taskId, targetStorageDirName), `${line}\n`, 'utf8');
}

export async function GET(request: NextRequest) {
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
        tasks: pagedTasks,
        totalCount: tasks.length,
        nextCursor: hasMore ? nextCursor : null,
        hasMore,
      });
    }

    const tasksWithPreview = await runWithConcurrencyLimit(
      pagedTasks.map((task) => async () => ({
        ...task,
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

  const task = await withTaskWriteLock(taskId, () => readTask(taskId));
  if (!task) return jsonResponse({ error: { message: '历史任务不存在。' } }, 404);

  let logs = '';
  try {
    logs = await fs.readFile(taskLogPath(taskId, task.storageDirName), 'utf8');
  } catch {
    logs = '';
  }

  if (!includeData) return jsonResponse({ task, logs });

  const imageId = request.nextUrl.searchParams.get('imageId');
  const kind = request.nextUrl.searchParams.get('kind') ?? 'both';
  if (imageId) {
    const image = task.images.find((item) => item.id === imageId);
    if (!image) return jsonResponse({ error: { message: '历史图片不存在。' } }, 404);
    return jsonResponse({
      task: { ...task, images: [] },
      image: await withImageData(image, kind),
      logs,
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
    imagesWithoutData.map((image) => () => withImageData(image)),
    PREVIEW_READ_CONCURRENCY,
  );
  const nextImageOffset = imageOffset + images.length;
  const hasMoreImages = nextImageOffset < task.images.length;

  return jsonResponse({
    task: {
      ...task,
      images,
      imageOffset,
      imageLimit,
      totalImages: task.images.length,
      hasMoreImages,
    },
    logs,
    imageOffset,
    imageLimit,
    nextImageOffset: hasMoreImages ? nextImageOffset : null,
    hasMoreImages,
    totalImages: task.images.length,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const action = String(body.action ?? '');
  await ensureResourceDir();

  if (action === 'upsert-task') {
    const now = Date.now();
    const taskId = String(body.task?.id ?? body.taskId ?? `task_${now}`);
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
        updatedAt: now,
      });
    });

    const task: HistoryTaskRecord = {
      id: taskId,
      name: String(body.task?.name ?? current?.name ?? `翻译任务 ${new Date(now).toLocaleString('zh-CN')}`),
      createdAt: Number(body.task?.createdAt ?? current?.createdAt ?? now),
      updatedAt: now,
      language: String(body.task?.language ?? current?.language ?? '中文'),
      ratio: String(body.task?.ratio ?? current?.ratio ?? '原图'),
      mode: String(body.task?.mode ?? current?.mode ?? 'translate_only'),
      totalCount: 0,
      doneCount: 0,
      failCount: 0,
      copiedCount: 0,
      status: 'idle',
      settingsSummary: body.task?.settingsSummary ?? current?.settingsSummary,
      storageDirName: current?.storageDirName ?? buildTaskStorageDirName(String(body.task?.name ?? current?.name ?? `翻译任务 ${new Date(now).toLocaleString('zh-CN')}`), taskId, imageMap.size),
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

    const relativePath = safeRelativePath(String(body.relativePath ?? task.images[imageIndex].outputRelativePath));
    const storedRelativePath = safeRelativePath(`${safeSegment(task.storageDirName || taskId)}/${kind}/${relativePath}`);
    const absolutePath = path.join(RESOURCE_DIR, storedRelativePath);
    let imageBuffer: Buffer;
    try {
      imageBuffer = dataUrlToBuffer(dataUrl);
    } catch (error) {
      return jsonResponse({ error: { message: error instanceof Error ? error.message : '图片数据格式无效。' } }, 400);
    }
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, imageBuffer);

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

    const allowed = ['status', 'phase', 'outputRelativePath', 'error', 'hasText', 'extractedText', 'translatedText', 'retryCount', 'attemptCount', 'startedAt', 'completedAt'] as const;
    const patch = body.patch ?? {};
    const nextImage = { ...task.images[imageIndex], updatedAt: Date.now() } as Record<string, unknown>;
    allowed.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(patch, key)) nextImage[key] = patch[key];
    });
    task.images[imageIndex] = nextImage as unknown as HistoryImageRecord;
    const saved = await persistTask(task);
    await appendLog(taskId, { type: 'update-image', imageId, patch }, saved.storageDirName);
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

    await Promise.all([removeStoredFile(image.originalPath), removeStoredFile(image.resultPath)]);
    const nextTask = { ...task, images: task.images.filter((item) => item.id !== imageId) };
    const saved = await persistTask(nextTask);
    await appendLog(taskId, { type: 'delete-image', imageId, originalPath: image.originalPath, resultPath: image.resultPath }, saved.storageDirName);
    return jsonResponse({ task: saved });
    });
  }

  if (action === 'append-log') {
    const taskId = String(body.taskId ?? '');
    return withTaskWriteLock(taskId, async () => {
      await appendLog(taskId, body.event ?? {});
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
