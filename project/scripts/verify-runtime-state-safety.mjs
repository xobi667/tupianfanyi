import {
  ProcessingError,
  applyPausedTaskState,
  createImageQueueThrottle,
  prepareFailedTaskRetries,
} from '../app/workbench/batch-state.ts';
import {
  MAX_GLOBAL_IMAGE_REQUESTS,
  acquireGlobalImageRequestSlot,
} from '../lib/image-request-gate.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function testAdaptiveImageThrottle() {
  let limit = 2;
  const queue = {
    getLimit: () => limit,
    setLimit: (nextLimit) => { limit = nextLimit; },
  };
  const throttle = createImageQueueThrottle(queue, {
    threshold: 2,
    reducedLimit: 1,
    recoverySuccesses: 2,
    recoveryCooldownMs: 0,
  });
  const ambiguousTimeout = new ProcessingError('timeout after submit', {
    kind: 'timeout',
    retryable: false,
  });

  throttle.registerFailure(ambiguousTimeout);
  assert(limit === 2, '一次瞬时失败不应立即降并发。');
  throttle.registerFailure(ambiguousTimeout);
  assert(limit === 1, '不可自动重试的超时也必须触发并发降速。');
  throttle.registerSuccess();
  assert(limit === 1, '恢复成功数不足时不应提前升并发。');
  throttle.registerSuccess();
  assert(limit === 2, '连续成功后应恢复到安全并发上限。');
}

function testPausePreservesOperationIdentity() {
  const original = [{
    id: 'task-1',
    status: 'generating',
    phase: 'direct_image',
    generationOperationId: 'operation-paid-once',
    retryCount: 0,
    attemptCount: 1,
  }];
  const [paused] = applyPausedTaskState(original, ['task-1']);
  assert(paused.status === 'paused', '暂停后任务状态必须立即变为 paused。');
  assert(
    paused.generationOperationId === 'operation-paid-once',
    '暂停不得清除付费任务 operationId。',
  );
}

function testExplicitFailedRetryGetsNewIdentity() {
  const original = [{
    id: 'task-1',
    status: 'error',
    phase: 'direct_image',
    error: 'upstream failed',
    generationOperationId: 'terminal-failed-operation',
    retryCount: 0,
    attemptCount: 1,
    result: { extractedText: 'old' },
  }];
  const [retried] = prepareFailedTaskRetries(original, ['task-1']);
  assert(retried.status === 'idle', '明确重试后失败任务应回到 idle。');
  assert(retried.generationOperationId === undefined, '明确重试必须创建新的 operationId。');
  assert(retried.result === undefined, '重新翻译不得复用旧的中间翻译结果。');
}

async function testGlobalImageRequestGate() {
  let active = 0;
  let peak = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    const controller = new AbortController();
    const release = await acquireGlobalImageRequestSlot(controller.signal);
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 8));
    active -= 1;
    release();
  }));
  assert(peak === MAX_GLOBAL_IMAGE_REQUESTS, `服务端峰值并发应为 ${MAX_GLOBAL_IMAGE_REQUESTS}，实际为 ${peak}。`);

  const first = await acquireGlobalImageRequestSlot(new AbortController().signal);
  const second = await acquireGlobalImageRequestSlot(new AbortController().signal);
  const queuedController = new AbortController();
  const queued = acquireGlobalImageRequestSlot(queuedController.signal);
  queuedController.abort();
  await queued.then(
    () => { throw new Error('排队中的已取消请求不应获得上游名额。'); },
    (error) => assert(error?.name === 'AbortError', '排队取消应返回 AbortError。'),
  );
  first();
  second();
  const releaseAfterAbort = await acquireGlobalImageRequestSlot(new AbortController().signal);
  releaseAfterAbort();
}

testAdaptiveImageThrottle();
testPausePreservesOperationIdentity();
testExplicitFailedRetryGetsNewIdentity();
await testGlobalImageRequestGate();
console.log('运行态安全验证通过：客户端降速/恢复、服务端并发上限、暂停复用 operationId、显式失败重试创建新任务均正常。');
