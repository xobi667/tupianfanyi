import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import type {
  GatewayGenerateRequest,
  GatewayGenerateResponse,
} from '@/lib/gateway';
import {
  detectSupportedImageMimeType,
  normalizeSupportedImageMimeType,
} from '@/lib/image-formats';
import { POST as generatePost } from '../generate/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
const JOB_DIR = path.join(RESOURCE_DIR, '系统日志', 'generate-jobs');
const MAX_OPERATION_ID_LENGTH = 128;
const MAX_JOB_REQUEST_BODY_BYTES = 90 * 1024 * 1024;
const MAX_JOB_METADATA_BYTES = 1024 * 1024;
const MAX_JOB_RESULT_BYTES = 140 * 1024 * 1024;
const MAX_RECOVERED_IMAGE_BYTES = 96 * 1024 * 1024;
const JOB_HEARTBEAT_INTERVAL_MS = 10_000;
const RUNNING_JOB_STALE_MS = 90_000;
const JOB_CLAIM_STALE_MS = 60_000;
const JOB_TEMP_FILE_STALE_MS = 24 * 60 * 60_000;
const MIN_FREE_BYTES_BEFORE_PAID_JOB = 512 * 1024 * 1024;

type GenerateJobStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'acknowledged';

type GenerateJobResultState = 'prepared' | 'committed';

interface GenerateJobRecord {
  id: string;
  status: GenerateJobStatus;
  createdAt: number;
  updatedAt: number;
  response?: GatewayGenerateResponse;
  error?: string;
  upstreamStatus?: number;
  requestId?: string;
  requestHash?: string;
  ownerId?: string;
  heartbeatAt?: number;
  hasResponse?: boolean;
  resultState?: GenerateJobResultState;
  resultBytes?: number;
  resultSha256?: string;
}

interface GenerateJobRuntime extends GenerateJobRecord {
  promise?: Promise<void>;
  responseText?: string;
}

declare global {
  var __xobiGenerateJobs: Map<string, GenerateJobRuntime> | undefined;
  var __xobiGenerateJobLocks: Map<string, Promise<void>> | undefined;
  var __xobiGenerateJobOwnerId: string | undefined;
  var __xobiGenerateJobMaintenance: Promise<void> | undefined;
}

const runtimeJobs =
  globalThis.__xobiGenerateJobs ??
  (globalThis.__xobiGenerateJobs = new Map<string, GenerateJobRuntime>());
const jobLocks =
  globalThis.__xobiGenerateJobLocks ??
  (globalThis.__xobiGenerateJobLocks = new Map<string, Promise<void>>());
const jobOwnerId =
  globalThis.__xobiGenerateJobOwnerId ??
  (globalThis.__xobiGenerateJobOwnerId = randomUUID());

function redactSensitiveText(value: unknown) {
  return String(value ?? '')
    .replace(/data:[^,\s]+;base64,[A-Za-z0-9+/=\s]+/gi, '[data-uri]')
    .replace(/[A-Za-z0-9+/]{240,}={0,2}/g, '[base64]')
    .replace(/\b(Bearer|Basic)\s+[^\s"',}]+/gi, '$1 [REDACTED]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{12,})\b/g, '[REDACTED-KEY]')
    .replace(
      /((?:["']?)(?:authorization|x-goog-api-key|x-api-key|api-key|api_key|key|token|access_token|access-token)(?:["']?)\s*[:=]\s*(?:["']?))([^,"'\s}\n\r;]+)/gi,
      '$1[REDACTED]',
    )
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .slice(0, 1000);
}

function isValidOperationId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_OPERATION_ID_LENGTH &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function jobFilePath(jobId: string) {
  const digest = createHash('sha256').update(jobId).digest('hex');
  return path.join(JOB_DIR, `${digest}.json`);
}

function jobClaimFilePath(jobId: string) {
  const digest = createHash('sha256').update(jobId).digest('hex');
  return path.join(JOB_DIR, `${digest}.claim`);
}

function jobResultFilePath(jobId: string) {
  const digest = createHash('sha256').update(jobId).digest('hex');
  return path.join(JOB_DIR, `${digest}.result.json`);
}

function buildRequestHash(
  payload: GatewayGenerateRequest & { operationId?: string },
) {
  // The complete request participates in idempotency, including auth routing.
  // Only this one-way digest is persisted; the request and credentials are not.
  return createHash('sha256')
    .update(JSON.stringify({
      ...payload,
      operationId: undefined,
    }))
    .digest('hex');
}

async function withJobLock<T>(jobId: string, operation: () => Promise<T>) {
  const previous = jobLocks.get(jobId) ?? Promise.resolve();
  let releaseCurrent: (() => void) | undefined;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  jobLocks.set(jobId, tail);
  await previous.catch(() => undefined);

  try {
    return await operation();
  } finally {
    releaseCurrent?.();
    if (jobLocks.get(jobId) === tail) jobLocks.delete(jobId);
  }
}

function toStoredJob(job: GenerateJobRuntime): GenerateJobRecord {
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    error: job.error,
    upstreamStatus: job.upstreamStatus,
    requestId: job.requestId,
    requestHash: job.requestHash,
    ownerId: job.ownerId,
    heartbeatAt: job.heartbeatAt,
    hasResponse: job.hasResponse ?? Boolean(job.response),
    resultState: job.resultState,
    resultBytes: job.resultBytes,
    resultSha256: job.resultSha256,
  };
}

async function cleanupStaleJobTemporaryFiles() {
  await fs.mkdir(JOB_DIR, { recursive: true });
  const now = Date.now();
  const entries = await fs.readdir(JOB_DIR, { withFileTypes: true });
  await Promise.allSettled(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.tmp'))
      .map(async (entry) => {
        const temporaryPath = path.join(JOB_DIR, entry.name);
        const stat = await fs.stat(temporaryPath);
        if (now - stat.mtimeMs > JOB_TEMP_FILE_STALE_MS) {
          await fs.rm(temporaryPath, { force: true });
        }
      }),
  );
}

function ensureJobStorageMaintenance() {
  if (!globalThis.__xobiGenerateJobMaintenance) {
    globalThis.__xobiGenerateJobMaintenance = cleanupStaleJobTemporaryFiles().catch(
      (error) => {
        console.error(
          `[generate-job] 临时缓存清理失败：${redactSensitiveText(error)}`,
        );
      },
    );
  }
  return globalThis.__xobiGenerateJobMaintenance;
}

async function assertPaidJobStorageCapacity() {
  await fs.mkdir(JOB_DIR, { recursive: true });
  try {
    const stats = await fs.statfs(JOB_DIR);
    const availableBytes = Number(stats.bavail) * Number(stats.bsize);
    if (
      Number.isFinite(availableBytes) &&
      availableBytes < MIN_FREE_BYTES_BEFORE_PAID_JOB
    ) {
      throw new Error(
        '本地磁盘可用空间不足 512 MB，已在调用付费生图前停止。请先清理磁盘空间。',
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('可用空间不足')) {
      throw error;
    }
    // statfs 在极少数文件系统不可用；实际结果写入仍有原子校验和 Job 缓存保护。
  }
}

async function claimJob(job: GenerateJobRuntime, allowStaleRecovery = true): Promise<boolean> {
  await fs.mkdir(JOB_DIR, { recursive: true });
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  let ownsClaim = false;
  try {
    handle = await fs.open(jobClaimFilePath(job.id), 'wx');
    ownsClaim = true;
    await handle.writeFile(
      JSON.stringify({ id: job.id, createdAt: job.createdAt }),
      'utf8',
    );
    await persistJob(job);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'EEXIST') {
      if (!allowStaleRecovery) return false;
      const jobExists = await fs.stat(jobFilePath(job.id)).then(() => true).catch(() => false);
      if (jobExists) return false;
      const claimAge = await fs.stat(jobClaimFilePath(job.id))
        .then((stat) => Date.now() - stat.mtimeMs)
        .catch(() => 0);
      if (claimAge <= JOB_CLAIM_STALE_MS) return false;
      await fs.rm(jobClaimFilePath(job.id), { force: true }).catch(() => undefined);
      return claimJob(job, false);
    }
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
    if (ownsClaim) {
      await fs.rm(jobClaimFilePath(job.id), { force: true }).catch(() => undefined);
    }
  }
}

async function persistJob(job: GenerateJobRuntime) {
  await fs.mkdir(JOB_DIR, { recursive: true });
  if (job.response) {
    const resultJson = job.responseText ?? JSON.stringify(job.response);
    const resultBytes = Buffer.byteLength(resultJson, 'utf8');
    if (resultBytes > MAX_JOB_RESULT_BYTES) {
      throw new Error('生图任务结果过大，无法写入本地恢复缓存。');
    }
    if (!hasRecoverableImageResponse(job.response)) {
      throw new Error('生图任务结果没有可恢复的图片，已拒绝写入成功缓存。');
    }
    const resultSha256 = createHash('sha256').update(resultJson).digest('hex');
    await persistJobMetadata({
      ...job,
      status: 'running',
      updatedAt: Date.now(),
      heartbeatAt: Date.now(),
      response: undefined,
      error: undefined,
      hasResponse: false,
      resultState: 'prepared',
      resultBytes,
      resultSha256,
    });
    await writeAtomicFile(jobResultFilePath(job.id), resultJson);
    job.hasResponse = true;
    job.resultState = 'committed';
    job.resultBytes = resultBytes;
    job.resultSha256 = resultSha256;
  }

  await persistJobMetadata(job);
}

async function persistJobMetadata(job: GenerateJobRuntime) {
  const targetPath = jobFilePath(job.id);
  const serialized = JSON.stringify(toStoredJob(job));

  if (Buffer.byteLength(serialized, 'utf8') > MAX_JOB_METADATA_BYTES) {
    throw new Error('生图任务元数据过大，无法写入本地恢复缓存。');
  }

  await writeAtomicFile(targetPath, serialized);
}

async function writeAtomicFile(targetPath: string, content: string) {
  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(temporaryPath, 'wx');
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(temporaryPath, targetPath);
  } finally {
    await handle?.close().catch(() => undefined);
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function startJobHeartbeat(job: GenerateJobRuntime) {
  let stopped = false;
  let pendingWrite = Promise.resolve();
  const timer = setInterval(() => {
    if (stopped) return;
    pendingWrite = pendingWrite
      .catch(() => undefined)
      .then(async () => {
        if (stopped || job.status !== 'running') return;
        const now = Date.now();
        job.heartbeatAt = now;
        job.updatedAt = now;
        await persistJob(job);
      });
  }, JOB_HEARTBEAT_INTERVAL_MS);
  timer.unref?.();

  return async () => {
    stopped = true;
    clearInterval(timer);
    await pendingWrite.catch(() => undefined);
  };
}

function isGenerateJobStatus(value: unknown): value is GenerateJobStatus {
  return (
    value === 'running' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'interrupted' ||
    value === 'acknowledged'
  );
}

function buildUnreadableStoredJob(
  jobId: string,
  updatedAt: number,
  reason: string,
): GenerateJobRecord {
  return {
    id: jobId,
    status: 'interrupted',
    createdAt: updatedAt,
    updatedAt,
    error: `本地生图恢复记录${reason}。为避免重复扣费，系统不会自动重新提交；请保留该 operationId 并核对上游任务或账单。`,
  };
}

function isStoredJobRecord(value: unknown, jobId: string): value is GenerateJobRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.id === jobId &&
    isGenerateJobStatus(record.status) &&
    typeof record.createdAt === 'number' &&
    Number.isFinite(record.createdAt) &&
    typeof record.updatedAt === 'number' &&
    Number.isFinite(record.updatedAt) &&
    (record.requestHash === undefined ||
      (typeof record.requestHash === 'string' && /^[a-f0-9]{64}$/.test(record.requestHash))) &&
    (record.hasResponse === undefined || typeof record.hasResponse === 'boolean') &&
    (record.resultState === undefined ||
      record.resultState === 'prepared' ||
      record.resultState === 'committed') &&
    (record.resultBytes === undefined ||
      (typeof record.resultBytes === 'number' &&
        Number.isSafeInteger(record.resultBytes) &&
        record.resultBytes >= 0 &&
        record.resultBytes <= MAX_JOB_RESULT_BYTES)) &&
    (record.resultSha256 === undefined ||
      (typeof record.resultSha256 === 'string' &&
        /^[a-f0-9]{64}$/.test(record.resultSha256)))
  );
}

async function readStoredJob(jobId: string) {
  try {
    const filePath = jobFilePath(jobId);
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > MAX_JOB_METADATA_BYTES) {
      return buildUnreadableStoredJob(jobId, stat.mtimeMs, '格式异常或体积超限');
    }
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
    if (!isStoredJobRecord(parsed, jobId)) {
      return buildUnreadableStoredJob(jobId, stat.mtimeMs, '字段校验失败');
    }
    return parsed;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT') return null;
    const updatedAt = await fs
      .stat(jobFilePath(jobId))
      .then((stat) => stat.mtimeMs)
      .catch(() => Date.now());
    return buildUnreadableStoredJob(jobId, updatedAt, '已损坏或无法读取');
  }
}

async function readRequestJsonWithLimit(request: Request) {
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_JOB_REQUEST_BODY_BYTES) {
    throw new Error('生图任务请求体太大，请压缩图片后再试。');
  }
  if (!request.body) return JSON.parse(await request.text()) as unknown;

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  const textChunks: string[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_JOB_REQUEST_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('生图任务请求体太大，请压缩图片后再试。');
      }
      textChunks.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    reader.releaseLock();
  }
  textChunks.push(decoder.decode());
  return JSON.parse(textChunks.join('')) as unknown;
}

function getPublicJobPayload(job: GenerateJobRecord) {
  return {
    job: {
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      requestId: job.requestId,
      upstreamStatus: job.upstreamStatus,
      error: job.error,
    },
  };
}

async function readJobResult(job: GenerateJobRecord) {
  if ('responseText' in job && typeof job.responseText === 'string') {
    return job.responseText;
  }
  if (job.response) return JSON.stringify(job.response);
  if (!job.hasResponse) return null;
  const validated = await readValidatedJobResult(job);
  return validated?.rawText ?? null;
}

function hasRecoverableImageResponse(value: unknown): value is GatewayGenerateResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const response = value as GatewayGenerateResponse;
  const firstImagePart = response.candidates
    ?.flatMap((candidate) => candidate.content?.parts ?? [])
    .find((part) => part.inlineData?.data || part.inline_data?.data);
  const imageData =
    firstImagePart?.inlineData?.data ?? firstImagePart?.inline_data?.data;
  const mimeType =
    firstImagePart?.inlineData?.mimeType ??
    firstImagePart?.inline_data?.mime_type;
  const normalizedMimeType = normalizeSupportedImageMimeType(mimeType ?? '');
  const normalizedImageData = imageData?.replace(/\s/g, '') ?? '';
  if (
    typeof imageData !== 'string' ||
    normalizedImageData.length < 32 ||
    !normalizedMimeType ||
    /[^A-Za-z0-9+/=]/.test(normalizedImageData) ||
    normalizedImageData.length % 4 === 1
  ) {
    return false;
  }

  const firstPadding = normalizedImageData.indexOf('=');
  if (
    firstPadding >= 0 &&
    (firstPadding < normalizedImageData.length - 2 ||
      !/^={1,2}$/.test(normalizedImageData.slice(firstPadding)))
  ) {
    return false;
  }

  const padding = normalizedImageData.endsWith('==')
    ? 2
    : normalizedImageData.endsWith('=')
      ? 1
      : 0;
  const decodedBytes =
    Math.floor((normalizedImageData.length * 3) / 4) - padding;
  if (decodedBytes <= 0 || decodedBytes > MAX_RECOVERED_IMAGE_BYTES) {
    return false;
  }

  const prefix = Buffer.from(normalizedImageData.slice(0, 48), 'base64');
  return detectSupportedImageMimeType(prefix) === normalizedMimeType;
}

async function readValidatedJobResult(
  job: GenerateJobRecord,
  options?: { allowUnmarked?: boolean },
) {
  if (!options?.allowUnmarked && !job.hasResponse) return null;
  try {
    const resultPath = jobResultFilePath(job.id);
    const stat = await fs.stat(resultPath);
    if (
      !stat.isFile() ||
      stat.size <= 0 ||
      stat.size > MAX_JOB_RESULT_BYTES ||
      (job.resultBytes !== undefined && stat.size !== job.resultBytes)
    ) {
      return null;
    }
    const rawText = await fs.readFile(resultPath, 'utf8');
    const resultSha256 = createHash('sha256').update(rawText).digest('hex');
    if (job.resultSha256 && resultSha256 !== job.resultSha256) return null;
    const parsed = JSON.parse(rawText) as unknown;
    if (!hasRecoverableImageResponse(parsed)) return null;
    return {
      rawText,
      response: parsed,
      resultBytes: stat.size,
      resultSha256,
    };
  } catch {
    return null;
  }
}

async function getJob(jobId: string) {
  const runtimeJob = runtimeJobs.get(jobId);
  if (runtimeJob) return runtimeJob;

  const storedJob = await readStoredJob(jobId);
  if (!storedJob) return null;

  if (storedJob.status === 'running') {
    const lastHeartbeatAt = storedJob.heartbeatAt ?? storedJob.updatedAt;
    if (Date.now() - lastHeartbeatAt <= RUNNING_JOB_STALE_MS) {
      // A different route worker may own this job. The atomic disk record is
      // the shared source of truth, so do not mark a fresh running job failed.
      return storedJob;
    }
    const canRecoverPreparedResult =
      storedJob.resultState === 'prepared' &&
      typeof storedJob.requestHash === 'string' &&
      typeof storedJob.resultBytes === 'number' &&
      typeof storedJob.resultSha256 === 'string';
    const recoveredResult = canRecoverPreparedResult
      ? await readValidatedJobResult(storedJob, { allowUnmarked: true })
      : null;
    if (recoveredResult) {
      const recoveredJob: GenerateJobRuntime = {
        ...storedJob,
        status: 'completed',
        updatedAt: Date.now(),
        error: undefined,
        hasResponse: true,
        resultState: 'committed',
        resultBytes: recoveredResult.resultBytes,
        resultSha256: recoveredResult.resultSha256,
      };
      await persistJobMetadata(recoveredJob);
      return recoveredJob;
    }
    const interruptedJob: GenerateJobRuntime = {
      ...storedJob,
      status: 'interrupted',
      updatedAt: Date.now(),
      error:
        '本地服务曾在生图请求进行中退出。为避免重复扣费，系统不会自动重新提交；请先到上游账单或任务记录核对。',
    };
    await persistJob(interruptedJob);
    return interruptedJob;
  }

  // Terminal responses can contain tens of megabytes of base64. Keep them on
  // disk and return them for this request only instead of retaining them in RAM.
  return storedJob;
}

async function executeJob(
  job: GenerateJobRuntime,
  payload: GatewayGenerateRequest & { operationId?: string },
) {
  const stopHeartbeat = startJobHeartbeat(job);
  try {
    job.requestId = job.requestId ?? randomUUID();
    const internalRequest = new Request('http://xobi.local/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-xobi-request-id': job.requestId,
        'x-xobi-operation-id': job.id,
      },
      body: JSON.stringify(payload),
    });
    const response = await generatePost(internalRequest);
    const requestId = response.headers.get('X-Debug-Request-Id') ?? undefined;
    const rawText = await response.text();
    let parsed: GatewayGenerateResponse | null = null;

    try {
      parsed = rawText ? (JSON.parse(rawText) as GatewayGenerateResponse) : null;
    } catch {
      parsed = null;
    }

    job.updatedAt = Date.now();
    job.requestId = requestId ?? job.requestId;
    job.upstreamStatus = response.status;

    if (response.ok && parsed) {
      job.status = 'completed';
      job.response = parsed;
      job.responseText = rawText;
      job.error = undefined;
    } else {
      job.status = 'failed';
      job.response = undefined;
      job.responseText = undefined;
      job.error = redactSensitiveText(
        parsed?.error?.message || rawText || `生图请求失败 (${response.status})。`,
      );
    }
  } catch (error) {
    job.status = 'failed';
    job.updatedAt = Date.now();
    job.response = undefined;
    job.responseText = undefined;
    job.upstreamStatus = 500;
    job.error = redactSensitiveText(
      error instanceof Error ? error.message : '本地生图任务执行失败。',
    );
  }

  const settledJob: GenerateJobRuntime = { ...job, promise: undefined };
  job.status = 'running';
  job.response = undefined;
  job.error = undefined;
  await stopHeartbeat();
  let persisted = false;
  try {
    await persistJob(settledJob);
    Object.assign(job, settledJob);
    persisted = true;
  } catch (persistError) {
    Object.assign(job, settledJob, { updatedAt: Date.now() });
    const persistMessage = `本地恢复缓存写入失败：${redactSensitiveText(
      persistError instanceof Error ? persistError.message : persistError,
    )}`;
    if (
      settledJob.status === 'completed' &&
      settledJob.response &&
      hasRecoverableImageResponse(settledJob.response)
    ) {
      // Keep the completed response in memory so the current browser can still
      // save it to the normal history folder even when the recovery cache fails.
      job.error = persistMessage;
    } else {
      job.status = 'failed';
      job.response = undefined;
      job.responseText = undefined;
      job.upstreamStatus =
        settledJob.status === 'completed' ? 422 : 507;
      job.error = persistMessage;
    }
  }

  if (persisted && runtimeJobs.get(job.id) === job) {
    runtimeJobs.delete(job.id);
  }
}

export async function POST(request: Request) {
  if (request.headers.get('x-image-translator-request') !== 'mutation') {
    return NextResponse.json(
      { error: { message: '生图任务提交未授权。' } },
      { status: 403 },
    );
  }

  await ensureJobStorageMaintenance();

  let payload: GatewayGenerateRequest & { operationId?: string };
  try {
    payload = (await readRequestJsonWithLimit(request)) as GatewayGenerateRequest & {
      operationId?: string;
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '生图任务请求体无效。';
    return NextResponse.json(
      { error: { message } },
      { status: message.includes('太大') ? 413 : 400 },
    );
  }

  if (payload.requestKind !== 'image') {
    return NextResponse.json(
      { error: { message: '服务端 Job 仅用于生图请求。' } },
      { status: 400 },
    );
  }

  const requestedOperationId = payload.operationId;
  if (requestedOperationId !== undefined && !isValidOperationId(requestedOperationId)) {
    return NextResponse.json(
      { error: { message: 'operationId 格式无效。' } },
      { status: 400 },
    );
  }

  const jobId = requestedOperationId ?? randomUUID();
  const requestHash = buildRequestHash(payload);

  return withJobLock(jobId, async () => {
    const existingJob = await getJob(jobId);
    if (existingJob) {
      if (!existingJob.requestHash || existingJob.requestHash !== requestHash) {
        return NextResponse.json(
          {
            error: {
              message: '相同 operationId 对应了不同的生图内容，已拒绝提交以避免结果串单。',
            },
          },
          { status: 409 },
        );
      }
      const status = existingJob.status === 'running' ? 202 : 200;
      return NextResponse.json(getPublicJobPayload(existingJob), { status });
    }

    try {
      await assertPaidJobStorageCapacity();
    } catch (error) {
      return NextResponse.json(
        {
          error: {
            message:
              error instanceof Error
                ? error.message
                : '本地磁盘空间不足，已停止付费生图。',
          },
        },
        { status: 507 },
      );
    }

    const now = Date.now();
    const job: GenerateJobRuntime = {
      id: jobId,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      requestHash,
      requestId: randomUUID(),
      ownerId: jobOwnerId,
      heartbeatAt: now,
    };
    runtimeJobs.set(jobId, job);

    let claimed = false;
    try {
      claimed = await claimJob(job);
    } catch (error) {
      if (runtimeJobs.get(jobId) === job) runtimeJobs.delete(jobId);
      throw error;
    }
    if (!claimed) {
      if (runtimeJobs.get(jobId) === job) runtimeJobs.delete(jobId);
      const claimedJob = await getJob(jobId);
      if (!claimedJob) {
        return NextResponse.json(
          { error: { message: '生图任务占位冲突，请稍后查询同一 operationId。' } },
          { status: 409 },
        );
      }
      if (!claimedJob.requestHash || claimedJob.requestHash !== requestHash) {
        return NextResponse.json(
          { error: { message: 'operationId 已被另一项不同的生图任务占用。' } },
          { status: 409 },
        );
      }
      return NextResponse.json(getPublicJobPayload(claimedJob), {
        status: claimedJob.status === 'running' ? 202 : 200,
      });
    }

    job.promise = executeJob(job, { ...payload, operationId: jobId });
    void job.promise.finally(() => {
      job.promise = undefined;
    });

    return NextResponse.json(getPublicJobPayload(job), { status: 202 });
  });
}

export async function GET(request: Request) {
  await ensureJobStorageMaintenance();
  const url = new URL(request.url);
  const jobId = url.searchParams.get('id');
  if (!isValidOperationId(jobId)) {
    return NextResponse.json(
      { error: { message: '缺少有效的生图任务 ID。' } },
      { status: 400 },
    );
  }

  const job = await getJob(jobId);
  if (!job) {
    return NextResponse.json(
      { error: { message: '生图任务不存在。' } },
      { status: 404 },
    );
  }

  if (url.searchParams.get('result') === '1') {
    if (job.status !== 'completed') {
      return NextResponse.json(
        { error: { message: job.error ?? '生图任务尚未完成。' } },
        { status: job.status === 'running' ? 202 : 409 },
      );
    }
    const resultJson = await readJobResult(job);
    if (!resultJson) {
      return NextResponse.json(
        { error: { message: '生图任务已完成，但本地恢复结果不存在。' } },
        { status: 410 },
      );
    }
    return new Response(resultJson, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...(job.requestId ? { 'X-Debug-Request-Id': job.requestId } : {}),
        'X-Generate-Job-Id': job.id,
      },
    });
  }

  return NextResponse.json(getPublicJobPayload(job), {
    status: job.status === 'running' ? 202 : 200,
    headers: {
      'Cache-Control': 'no-store',
      ...(job.requestId ? { 'X-Debug-Request-Id': job.requestId } : {}),
    },
  });
}

export async function DELETE(request: Request) {
  if (request.headers.get('x-image-translator-request') !== 'mutation') {
    return NextResponse.json(
      { error: { message: '生图任务确认未授权。' } },
      { status: 403 },
    );
  }

  await ensureJobStorageMaintenance();

  const url = new URL(request.url);
  const jobId = url.searchParams.get('id');
  if (!isValidOperationId(jobId)) {
    return NextResponse.json(
      { error: { message: '缺少有效的生图任务 ID。' } },
      { status: 400 },
    );
  }

  return withJobLock(jobId, async () => {
    const job = await getJob(jobId);
    if (job?.status === 'running') {
      return NextResponse.json(
        { error: { message: '生图任务仍在运行，不能清理恢复缓存。' } },
        { status: 409 },
      );
    }

    runtimeJobs.delete(jobId);
    if (job) {
      await fs.rm(jobResultFilePath(jobId), { force: true }).catch(() => undefined);
      await persistJob({
        ...job,
        status: 'acknowledged',
        response: undefined,
        hasResponse: false,
        resultState: undefined,
        resultBytes: undefined,
        resultSha256: undefined,
        error: '该 operationId 的结果已经保存到正式历史，不会再次向上游提交。',
        updatedAt: Date.now(),
      });
    }
    return new Response(null, { status: 204 });
  });
}
