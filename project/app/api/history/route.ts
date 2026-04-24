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
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
]);

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

function safeRelativePath(relativePath: string) {
  return relativePath
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .filter((segment) => segment !== '.' && segment !== '..')
    .map(safeSegment)
    .join('/');
}

function taskDir(taskId: string) {
  return path.join(RESOURCE_DIR, safeSegment(taskId));
}

function taskManifestPath(taskId: string) {
  return path.join(taskDir(taskId), 'manifest.json');
}

function taskLogPath(taskId: string) {
  return path.join(taskDir(taskId), 'logs.ndjson');
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

function normalizeIndexValue(value: unknown): HistoryTaskRecord[] {
  if (Array.isArray(value)) return value.filter(Boolean) as HistoryTaskRecord[];
  if (value && typeof value === 'object' && 'id' in value) return [value as HistoryTaskRecord];
  return [];
}

async function writeJsonFile(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

async function repairImagePaths(taskId: string, image: HistoryImageRecord) {
  const nextImage = { ...image };
  const originalCandidate = safeRelativePath(`${safeSegment(taskId)}/originals/${safeRelativePath(image.relativePath || image.name || image.id)}`);
  const resultCandidate = safeRelativePath(`${safeSegment(taskId)}/results/${safeRelativePath(image.outputRelativePath || image.relativePath || image.name || image.id)}`);

  if (!nextImage.originalPath && await pathExists(path.join(RESOURCE_DIR, originalCandidate))) {
    nextImage.originalPath = originalCandidate;
  }

  if (!nextImage.resultPath && await pathExists(path.join(RESOURCE_DIR, resultCandidate))) {
    nextImage.resultPath = resultCandidate;
  }

  return nextImage;
}

async function repairTaskPaths(task: HistoryTaskRecord) {
  let changed = false;
  const images = await Promise.all(
    task.images.map(async (image) => {
      const repaired = await repairImagePaths(task.id, image);
      if (repaired.originalPath !== image.originalPath || repaired.resultPath !== image.resultPath) changed = true;
      return repaired;
    }),
  );
  return { task: { ...task, images }, changed };
}

async function readIndex() {
  await ensureResourceDir();
  const rawIndex = await readJsonFile<unknown>(INDEX_PATH, []);
  const normalizedIndex = normalizeIndexValue(rawIndex);
  const cleanedTasks: HistoryTaskRecord[] = [];

  for (const indexTask of normalizedIndex) {
    if (!indexTask?.id) continue;
    const manifest = await readTask(indexTask.id);
    if (!manifest) continue;
    const repaired = await repairTaskPaths(manifest);
    if (repaired.changed) await writeJsonFile(taskManifestPath(indexTask.id), repaired.task);
    const hasAnyOriginal = await Promise.all(
      repaired.task.images.map((image) => pathExists(image.originalPath ? path.join(RESOURCE_DIR, image.originalPath) : undefined)),
    );
    if (repaired.task.images.length > 0 && !hasAnyOriginal.some(Boolean)) continue;
    cleanedTasks.push(recalcTask({ ...repaired.task, updatedAt: repaired.task.updatedAt ?? indexTask.updatedAt ?? Date.now() }, repaired.task.updatedAt ?? indexTask.updatedAt ?? Date.now()));
  }

  if (cleanedTasks.length !== normalizedIndex.length || !Array.isArray(rawIndex)) {
    await writeIndex(cleanedTasks);
  }

  return cleanedTasks.sort((a, b) => b.updatedAt - a.updatedAt);
}

async function writeIndex(tasks: HistoryTaskRecord[]) {
  const compactTasks = tasks
    .map((task) => ({
      ...task,
      images: task.images.map((image) => ({
        ...image,
        originalPath: image.originalPath,
        resultPath: image.resultPath,
      })),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  await writeJsonFile(INDEX_PATH, compactTasks);
}

async function readTask(taskId: string) {
  const task = await readJsonFile<HistoryTaskRecord | null>(taskManifestPath(taskId), null);
  if (!task) return null;
  const repaired = await repairTaskPaths(task);
  if (repaired.changed) await writeJsonFile(taskManifestPath(taskId), repaired.task);
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
  await writeJsonFile(taskManifestPath(normalized.id), normalized);
  const index = await readIndex();
  const nextIndex = [normalized, ...index.filter((item) => item.id !== normalized.id)];
  await writeIndex(nextIndex);
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

async function fileToDataUrl(filePath?: string) {
  if (!filePath) return null;
  try {
    const absolutePath = path.join(RESOURCE_DIR, filePath);
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

async function removeStoredFile(filePath?: string) {
  if (!filePath) return;
  const absolutePath = path.resolve(RESOURCE_DIR, filePath);
  const resourceRoot = `${path.resolve(RESOURCE_DIR)}${path.sep}`;
  if (!absolutePath.startsWith(resourceRoot)) return;
  await fs.rm(absolutePath, { force: true });
}

async function appendLog(taskId: string, event: Record<string, unknown>) {
  if (!taskId) return;
  await fs.mkdir(taskDir(taskId), { recursive: true });
  const line = JSON.stringify({ at: Date.now(), ...event });
  await fs.appendFile(taskLogPath(taskId), `${line}\n`, 'utf8');
}

export async function GET(request: NextRequest) {
  const taskId = request.nextUrl.searchParams.get('taskId');
  const includeData = request.nextUrl.searchParams.get('includeData') === '1';

  if (!taskId) {
    return jsonResponse({ resourceDir: RESOURCE_DIR, tasks: await readIndex() });
  }

  const task = await readTask(taskId);
  if (!task) return jsonResponse({ error: { message: '历史任务不存在。' } }, 404);

  let logs = '';
  try {
    logs = await fs.readFile(taskLogPath(taskId), 'utf8');
  } catch {
    logs = '';
  }

  if (!includeData) return jsonResponse({ task, logs });

  const images = await Promise.all(
    task.images.map(async (image) => ({
      ...image,
      originalDataUrl: await fileToDataUrl(image.originalPath),
      resultDataUrl: await fileToDataUrl(image.resultPath),
    })),
  );

  return jsonResponse({ task: { ...task, images }, logs });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const action = String(body.action ?? '');
  await ensureResourceDir();

  if (action === 'upsert-task') {
    const now = Date.now();
    const taskId = String(body.task?.id ?? body.taskId ?? `task_${now}`);
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
      images: Array.from(imageMap.values()),
    };

    const saved = await persistTask(task);
    await appendLog(taskId, { type: 'task-upsert', totalCount: saved.totalCount, language: saved.language, ratio: saved.ratio });
    return jsonResponse({ task: saved, resourceDir: RESOURCE_DIR });
  }

  if (action === 'save-image') {
    const taskId = String(body.taskId ?? '');
    const imageId = String(body.imageId ?? '');
    const kind = body.kind === 'result' ? 'results' : 'originals';
    const dataUrl = String(body.dataUrl ?? '');
    const task = await readTask(taskId);
    if (!task) return jsonResponse({ error: { message: '历史任务不存在。' } }, 404);
    const imageIndex = task.images.findIndex((image) => image.id === imageId);
    if (imageIndex < 0) return jsonResponse({ error: { message: '历史图片不存在。' } }, 404);

    const relativePath = safeRelativePath(String(body.relativePath ?? task.images[imageIndex].outputRelativePath));
    const storedRelativePath = safeRelativePath(`${safeSegment(taskId)}/${kind}/${relativePath}`);
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
    await appendLog(taskId, { type: 'save-image', imageId, kind, path: storedRelativePath });
    return jsonResponse({ task: saved, path: storedRelativePath });
  }

  if (action === 'update-image') {
    const taskId = String(body.taskId ?? '');
    const imageId = String(body.imageId ?? '');
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
    await appendLog(taskId, { type: 'update-image', imageId, patch });
    return jsonResponse({ task: saved });
  }

  if (action === 'delete-image') {
    const taskId = String(body.taskId ?? '');
    const imageId = String(body.imageId ?? '');
    const task = await readTask(taskId);
    if (!task) return jsonResponse({ error: { message: '历史任务不存在。' } }, 404);
    const image = task.images.find((item) => item.id === imageId);
    if (!image) return jsonResponse({ error: { message: '历史图片不存在。' } }, 404);

    await Promise.all([removeStoredFile(image.originalPath), removeStoredFile(image.resultPath)]);
    const nextTask = { ...task, images: task.images.filter((item) => item.id !== imageId) };
    const saved = await persistTask(nextTask);
    await appendLog(taskId, { type: 'delete-image', imageId, originalPath: image.originalPath, resultPath: image.resultPath });
    return jsonResponse({ task: saved });
  }

  if (action === 'append-log') {
    await appendLog(String(body.taskId ?? ''), body.event ?? {});
    return jsonResponse({ ok: true });
  }

  if (action === 'delete-task') {
    const taskId = String(body.taskId ?? '');
    await fs.rm(taskDir(taskId), { recursive: true, force: true });
    const index = await readIndex();
    await writeIndex(index.filter((task) => task.id !== taskId));
    return jsonResponse({ ok: true });
  }

  return jsonResponse({ error: { message: '未知历史操作。' } }, 400);
}
