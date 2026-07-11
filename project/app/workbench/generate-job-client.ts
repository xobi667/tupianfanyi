import type {
  GatewayGenerateRequest,
  GatewayGenerateResponse,
} from '@/lib/gateway';

const JOB_POLL_FAST_INTERVAL_MS = 900;
const JOB_POLL_NORMAL_INTERVAL_MS = 1_500;
const JOB_POLL_SLOW_INTERVAL_MS = 2_500;
const JOB_POLL_FAST_WINDOW_MS = 15_000;
const JOB_POLL_NORMAL_WINDOW_MS = 60_000;
const JOB_STATUS_REQUEST_TIMEOUT_MS = 10_000;
const MAX_POLL_ERROR_WINDOW_MS = 120_000;
const MAX_ACK_ATTEMPTS = 3;
const ACK_REQUEST_TIMEOUT_MS = 5_000;

interface GenerateJobPayload {
  job?: {
    id?: string;
    status?: 'running' | 'completed' | 'failed' | 'interrupted' | 'acknowledged';
    response?: GatewayGenerateResponse;
    error?: string;
    upstreamStatus?: number;
    requestId?: string;
  };
  error?: {
    message?: string;
  };
}

function waitForPoll(delayMs: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
      return;
    }

    const timeout = window.setTimeout(() => {
      signal?.removeEventListener('abort', abortFromSignal);
      resolve();
    }, delayMs);

    function abortFromSignal() {
      window.clearTimeout(timeout);
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    }

    signal?.addEventListener('abort', abortFromSignal, { once: true });
  });
}

function getJobPollIntervalMs(elapsedMs: number, consecutiveErrors: number) {
  const baseInterval = elapsedMs < JOB_POLL_FAST_WINDOW_MS
    ? JOB_POLL_FAST_INTERVAL_MS
    : elapsedMs < JOB_POLL_NORMAL_WINDOW_MS
      ? JOB_POLL_NORMAL_INTERVAL_MS
      : JOB_POLL_SLOW_INTERVAL_MS;

  if (consecutiveErrors === 0) return baseInterval;
  return Math.min(baseInterval * 2 ** Math.min(consecutiveErrors, 2), 8_000);
}

async function fetchJobStatus(jobId: string, signal?: AbortSignal) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  const timeout = window.setTimeout(
    () => controller.abort(),
    JOB_STATUS_REQUEST_TIMEOUT_MS,
  );

  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abortFromParent, { once: true });

  try {
    return await fetch(`/api/generate-job?id=${encodeURIComponent(jobId)}`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (error) {
    if (signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }
    if (controller.signal.aborted) {
      throw new Error('本地生图任务查询超时；服务端任务可能仍在运行。');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromParent);
  }
}

async function readJobPayload(response: Response) {
  return (await response.json().catch(() => ({}))) as GenerateJobPayload;
}

function buildJobResultResponse(payload: GenerateJobPayload) {
  const job = payload.job;
  const headers = new Headers({
    'Content-Type': 'application/json',
  });
  if (job?.requestId) headers.set('X-Debug-Request-Id', job.requestId);
  if (job?.id) headers.set('X-Generate-Job-Id', job.id);

  if (job?.status === 'completed' && job.response) {
    return new Response(JSON.stringify(job.response), {
      status: 200,
      headers,
    });
  }

  const rawStatus = Number(job?.upstreamStatus);
  const status = Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599
    ? rawStatus
    : 502;
  const operationHint = job?.id
    ? ` 本地任务 ID：${job.id}。如需再次付费提交，请先核对上游账单，再右键选择“重新翻译”。`
    : '';
  return new Response(
    JSON.stringify({
      error: {
        message:
          `${job?.error ??
          '服务端生图任务没有返回可恢复的图片。为避免重复扣费，系统不会自动重新提交。'}${operationHint}`,
      },
    }),
    { status, headers },
  );
}

async function pollGenerateJob(jobId: string, signal?: AbortSignal) {
  let consecutiveErrors = 0;
  let firstPollErrorAt: number | null = null;
  const pollStartedAt = Date.now();

  while (true) {
    if (signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }

    try {
      const response = await fetchJobStatus(jobId, signal);
      const payload = await readJobPayload(response);

      if (!response.ok && response.status !== 202) {
        throw new Error(
          payload.error?.message ?? `生图任务查询失败 (${response.status})。`,
        );
      }

      const status = payload.job?.status;
      if (status === 'completed') {
        return fetch(
          `/api/generate-job?id=${encodeURIComponent(jobId)}&result=1`,
          {
            method: 'GET',
            cache: 'no-store',
            signal,
          },
        );
      }
      if (status === 'failed' || status === 'interrupted' || status === 'acknowledged') {
        return buildJobResultResponse(payload);
      }

      if (status !== 'running') {
        return buildJobResultResponse({
          job: {
            ...payload.job,
            status: 'failed',
            error: '服务端返回了未知的生图任务状态；系统不会自动重新提交。',
          },
        });
      }

      consecutiveErrors = 0;
      firstPollErrorAt = null;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      consecutiveErrors += 1;
      firstPollErrorAt ??= Date.now();
      if (Date.now() - firstPollErrorAt >= MAX_POLL_ERROR_WINDOW_MS) {
        throw new Error(
          `本地生图任务 ${jobId} 已连续 2 分钟无法查询。任务可能仍在服务端运行；请保持 xobi 服务开启，恢复后继续同一任务，不要重新生图。`,
        );
      }
    }

    await waitForPoll(
      getJobPollIntervalMs(Date.now() - pollStartedAt, consecutiveErrors),
      signal,
    );
  }
}

export async function fetchGenerateApiResponse(
  payload: GatewayGenerateRequest,
  signal?: AbortSignal,
) {
  if (payload.requestKind !== 'image') {
    return fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
  }

  if (!payload.operationId) {
    throw new Error('生图请求缺少 operationId，已在提交前停止以避免重复扣费。');
  }

  let existingResponse: Response;
  try {
    existingResponse = await fetchJobStatus(payload.operationId, signal);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new Error(
      `无法查询生图任务 ${payload.operationId}。为避免重复扣费，本次没有重新提交。`,
    );
  }

  if (existingResponse.status !== 404) {
    const existing = await readJobPayload(existingResponse);
    if (!existingResponse.ok && existingResponse.status !== 202) {
      throw new Error(
        existing.error?.message ??
          `生图任务查询失败 (${existingResponse.status})；本次没有重新提交。`,
      );
    }
    return pollGenerateJob(existing.job?.id ?? payload.operationId, signal);
  }

  let submitResponse: Response;
  try {
    submitResponse = await fetch('/api/generate-job', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-image-translator-request': 'mutation',
      },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new Error(
      `生图任务 ${payload.operationId} 提交响应中断。为避免重复扣费，系统不会自动再次提交；请稍后继续同一任务。`,
    );
  }

  const submitted = await readJobPayload(submitResponse);
  if (!submitResponse.ok && submitResponse.status !== 202) {
    throw new Error(
      submitted.error?.message ?? `生图任务提交失败 (${submitResponse.status})。`,
    );
  }

  const jobId = submitted.job?.id ?? payload.operationId;
  return pollGenerateJob(jobId, signal);
}

export async function acknowledgeGenerateJobFamily(operationId?: string) {
  if (!operationId) return;

  let lastError = '';
  for (let attempt = 1; attempt <= MAX_ACK_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      ACK_REQUEST_TIMEOUT_MS,
    );
    try {
      const response = await fetch(
        `/api/generate-job?id=${encodeURIComponent(operationId)}`,
        {
          method: 'DELETE',
          headers: { 'x-image-translator-request': 'mutation' },
          signal: controller.signal,
        },
      );
      if (response.ok || response.status === 404) return;
      const payload = await readJobPayload(response);
      lastError =
        payload.error?.message ?? `恢复缓存确认失败 (${response.status})。`;
    } catch (error) {
      lastError =
        error instanceof Error && error.name === 'AbortError'
          ? '恢复缓存确认超时。'
          : error instanceof Error
            ? error.message
            : '恢复缓存确认失败。';
    } finally {
      window.clearTimeout(timeout);
    }

    if (attempt < MAX_ACK_ATTEMPTS) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, attempt * 500);
      });
    }
  }

  // 正式历史已经先于 ACK 落盘；ACK 失败不应把成功图片回滚，但必须留下可查线索。
  console.warn(`生图任务 ${operationId} 的本地恢复缓存暂未确认：${lastError}`);
}
