export type BatchTaskStatus =
  | 'idle'
  | 'detecting'
  | 'extracting'
  | 'generating'
  | 'retrying'
  | 'paused'
  | 'copied'
  | 'success'
  | 'error';

export type BatchTaskPhase =
  | 'idle'
  | 'detecting'
  | 'image_queue'
  | 'saving'
  | 'direct_image'
  | 'ocr_extract'
  | 'ocr_generate'
  | 'remove_image'
  | 'copied'
  | 'done'
  | 'error';

export type ReprocessMode = 'translate' | 'redraw';

export type BatchTaskErrorKind =
  | 'rate_limit'
  | 'timeout'
  | 'network'
  | 'server'
  | 'compatibility'
  | 'invalid_response'
  | 'client'
  | 'paused'
  | 'unknown';

export interface ProcessingErrorOptions {
  kind: BatchTaskErrorKind;
  retryable: boolean;
  status?: number;
  requestId?: string;
  details?: string[];
}

export class ProcessingError extends Error {
  kind: BatchTaskErrorKind;
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

interface BatchStageTaskUpdate {
  status: BatchTaskStatus;
  phase?: BatchTaskPhase;
  error?: string;
  lastErrorKind?: BatchTaskErrorKind;
  lastAttemptAt?: number;
  retryCount?: number;
}

export interface AdaptiveImageQueueLike {
  getLimit: () => number;
  setLimit: (nextLimit: number) => void;
}

export interface ImageQueueThrottle {
  registerSuccess: () => void;
  registerFailure: (error: ProcessingError) => void;
}

export interface BatchStageRunOptions<TResult> {
  status: BatchTaskStatus;
  phase: BatchTaskPhase;
  label: string;
  run: () => Promise<TResult>;
  onTransientFailure?: (error: ProcessingError) => void;
  onSuccess?: () => void;
  acceptResultAfterPause?: boolean;
  maxAttempts?: number;
}

export interface BatchStageRunnerOptions<TTask extends BatchTaskLike, TResult> extends BatchStageRunOptions<TResult> {
  task: TTask;
  taskController: AbortController;
  maxAttempts: number;
  getRetryDelayMs: (retryIndex: number, error?: ProcessingError) => number;
  waitForDelay: (ms: number, signal?: AbortSignal) => Promise<void>;
  toProcessingError: (error: unknown) => ProcessingError;
  isTaskPaused: (taskId: string) => boolean;
  applyTaskUpdate: (updates: BatchStageTaskUpdate) => void;
  getAttemptCount: () => number;
  setAttemptCount: (count: number) => void;
  getRetryCount: () => number;
  setRetryCount: (count: number) => void;
}

export interface BatchStageRunnerFactoryOptions<TTask extends BatchTaskLike> {
  task: TTask;
  taskController: AbortController;
  maxAttempts: number;
  getRetryDelayMs: (retryIndex: number, error?: ProcessingError) => number;
  waitForDelay: (ms: number, signal?: AbortSignal) => Promise<void>;
  toProcessingError: (error: unknown) => ProcessingError;
  isTaskPaused: (taskId: string) => boolean;
  applyTaskUpdate: (updates: BatchStageTaskUpdate) => void;
  getAttemptCount: () => number;
  setAttemptCount: (count: number) => void;
  getRetryCount: () => number;
  setRetryCount: (count: number) => void;
}

interface BatchTaskLike {
  id: string;
  status: BatchTaskStatus;
  phase: BatchTaskPhase;
  error?: string;
  attemptCount?: number;
  lastErrorKind?: BatchTaskErrorKind;
  lastAttemptAt?: number;
  retryCount?: number;
  startedAt?: number;
  generatedUrl?: string;
  generationOperationId?: string;
  completedAt?: number;
  wasCopiedWithoutTranslation?: boolean;
  reprocessMode?: ReprocessMode;
  result?: {
    hasText?: boolean;
    translatedText?: string;
  };
}

export type BatchTaskProgressUpdate<TTask extends BatchTaskLike> = Partial<TTask> & {
  attemptCount: number;
  retryCount: number;
  startedAt: number;
};

export interface BatchTaskUpdateControllerOptions<TTask extends BatchTaskLike> {
  task: TTask;
  startedAt: number;
  updateTask: (taskId: string, updates: Partial<TTask>) => void;
  persistTaskProgress: (task: TTask, updates: BatchTaskProgressUpdate<TTask>) => void;
}

export function createBatchTaskUpdateController<TTask extends BatchTaskLike>({
  task,
  startedAt,
  updateTask,
  persistTaskProgress,
}: BatchTaskUpdateControllerOptions<TTask>) {
  let attemptCount = task.attemptCount ?? 0;
  let retryCount = task.retryCount ?? 0;
  let pauseGuardActive = task.status !== 'paused';

  const applyTaskUpdate = (updates: Partial<TTask>) => {
    if (updates.status && updates.status !== 'paused') {
      pauseGuardActive = true;
    }

    const nextUpdates = {
      attemptCount,
      retryCount,
      startedAt,
      ...updates,
    } as BatchTaskProgressUpdate<TTask>;

    updateTask(task.id, nextUpdates);
    persistTaskProgress(task, nextUpdates);
  };

  return {
    applyTaskUpdate,
    getAttemptCount: () => attemptCount,
    setAttemptCount: (count: number) => {
      attemptCount = count;
    },
    getRetryCount: () => retryCount,
    setRetryCount: (count: number) => {
      retryCount = count;
    },
    isPauseGuardActive: () => pauseGuardActive,
  };
}

export function throwIfBatchTaskPaused<TTask extends { id: string }>(
  task: TTask,
  taskController: AbortController,
  pauseGuardActive: boolean,
  isTaskPaused: (taskId: string) => boolean,
) {
  const taskPausedAfterResume = pauseGuardActive && isTaskPaused(task.id);

  if (taskController.signal.aborted || taskPausedAfterResume) {
    throw new ProcessingError('已暂停。', {
      kind: 'paused',
      retryable: false,
    });
  }
}

export interface BatchPauseGuardOptions<TTask extends { id: string }> {
  task: TTask;
  taskController: AbortController;
  isTaskPaused: (taskId: string) => boolean;
  isPauseGuardActive: () => boolean;
}

export function createBatchPauseGuard<TTask extends { id: string }>({
  task,
  taskController,
  isTaskPaused,
  isPauseGuardActive,
}: BatchPauseGuardOptions<TTask>) {
  return () => throwIfBatchTaskPaused(
    task,
    taskController,
    isPauseGuardActive(),
    isTaskPaused,
  );
}

export function createBatchTaskPausedLookup<TTask extends BatchTaskLike>(getTasks: () => TTask[]) {
  return (taskId: string) => getTasks().find((task) => task.id === taskId)?.status === 'paused';
}

export function createBatchStageRunner<TTask extends BatchTaskLike>(options: BatchStageRunnerFactoryOptions<TTask>) {
  return <TResult>(stageOptions: BatchStageRunOptions<TResult>) => runBatchStageWithRetries({
    ...options,
    ...stageOptions,
    maxAttempts: stageOptions.maxAttempts ?? options.maxAttempts,
  });
}

export async function runBatchStageWithRetries<TTask extends BatchTaskLike, TResult>({
  task,
  taskController,
  status,
  phase,
  label,
  maxAttempts,
  getRetryDelayMs,
  waitForDelay,
  toProcessingError,
  isTaskPaused,
  applyTaskUpdate,
  getAttemptCount,
  setAttemptCount,
  getRetryCount,
  setRetryCount,
  run,
  onTransientFailure,
  onSuccess,
  acceptResultAfterPause,
}: BatchStageRunnerOptions<TTask, TResult>) {
  for (let stageAttempt = 1; stageAttempt <= maxAttempts; stageAttempt += 1) {
    throwIfBatchTaskPaused(task, taskController, true, isTaskPaused);
    setAttemptCount(getAttemptCount() + 1);
    applyTaskUpdate({
      status,
      phase,
      error: undefined,
      lastErrorKind: undefined,
      lastAttemptAt: Date.now(),
    });

    try {
      const result = await run();
      if (!acceptResultAfterPause) {
        throwIfBatchTaskPaused(task, taskController, true, isTaskPaused);
      }
      onSuccess?.();
      return result;
    } catch (error) {
      const processingError = toProcessingError(error);
      if (processingError.kind === 'paused') throw processingError;
      if (isTaskPaused(task.id)) {
        throw new ProcessingError('已暂停；已经提交的生图任务未成功返回，不会自动重新提交。', {
          kind: 'paused',
          retryable: false,
        });
      }
      onTransientFailure?.(processingError);

      if (!processingError.retryable || stageAttempt === maxAttempts) {
        throw processingError;
      }

      const nextRetryCount = getRetryCount() + 1;
      setRetryCount(nextRetryCount);
      const delayMs = getRetryDelayMs(stageAttempt, processingError);
      applyTaskUpdate({
        status: 'retrying',
        phase,
        retryCount: nextRetryCount,
        lastErrorKind: processingError.kind,
        error: `${label}失败：${processingError.message}，${Math.ceil(
          delayMs / 1000,
        )} 秒后自动重试...`,
      });
      await waitForDelay(delayMs, taskController.signal);
      throwIfBatchTaskPaused(task, taskController, true, isTaskPaused);
    }
  }

  throw new ProcessingError(`${label}失败。`, {
    kind: 'unknown',
    retryable: false,
  });
}

export function buildResumeTranslatedTaskUpdate<TResult>(result: TResult) {
  return {
    result,
    status: 'generating' as const,
    phase: 'ocr_generate' as const,
    error: undefined,
    completedAt: undefined,
  };
}

export function buildRedrawTaskUpdate<TResult>(result: TResult) {
  return {
    result,
    status: 'generating' as const,
    phase: 'ocr_generate' as const,
    error: undefined,
    completedAt: undefined,
    reprocessMode: undefined,
  };
}

export function buildTranslationDetectionTaskUpdate<TResult>(result?: TResult) {
  return {
    status: 'detecting' as const,
    phase: 'detecting' as const,
    error: undefined,
    result,
    wasCopiedWithoutTranslation: false,
    completedAt: undefined,
    reprocessMode: undefined,
  };
}

export function buildRemoveOnlyTaskUpdate() {
  return {
    status: 'generating' as const,
    phase: 'remove_image' as const,
    error: undefined,
    result: undefined,
    completedAt: undefined,
  };
}

export function buildImageSuccessTaskUpdate(generatedUrl: string, outputRelativePath: string, options?: { clearReprocessMode?: boolean }) {
  return {
    generatedUrl,
    outputRelativePath,
    status: 'success' as const,
    phase: 'done' as const,
    completedAt: Date.now(),
    ...(options?.clearReprocessMode ? { reprocessMode: undefined } : {}),
  };
}

export function buildCopiedWithoutTranslationTaskUpdate<TResult>(
  result: TResult,
  generatedUrl: string,
  outputRelativePath: string,
  completedAt = Date.now(),
) {
  return {
    result,
    generatedUrl,
    status: 'copied' as const,
    phase: 'copied' as const,
    wasCopiedWithoutTranslation: true,
    outputRelativePath,
    completedAt,
  };
}

export function buildResumeCopiedTaskUpdate(completedAt = Date.now()) {
  return {
    status: 'copied' as const,
    phase: 'copied' as const,
    completedAt,
  };
}

export function shouldResumeCopiedTask<TTask extends BatchTaskLike>(task: TTask) {
  return task.status === 'paused' && task.result?.hasText === false && Boolean(task.generatedUrl);
}

export function shouldResumeTranslatedTask<TTask extends BatchTaskLike>(task: TTask) {
  return task.status === 'paused' && Boolean(task.result?.translatedText);
}

export function shouldRedrawTranslatedTask<TTask extends BatchTaskLike>(task: TTask) {
  return task.reprocessMode === 'redraw' && Boolean(task.result?.translatedText);
}

export function buildPausedTaskUpdate() {
  return {
    status: 'paused' as const,
    completedAt: undefined,
    lastErrorKind: 'paused' as const,
    error: undefined,
  };
}

export function buildFailedTaskUpdate(processingError: ProcessingError) {
  return {
    status: 'error' as const,
    phase: 'error' as const,
    completedAt: Date.now(),
    lastErrorKind: processingError.kind,
    error: processingError.message,
  };
}

export interface BatchTaskOutcomeUpdate<TResult> {
  result?: TResult | undefined;
  generatedUrl?: string | undefined;
  outputRelativePath?: string | undefined;
  status?: BatchTaskStatus | undefined;
  phase?: BatchTaskPhase | undefined;
  completedAt?: number | undefined;
  wasCopiedWithoutTranslation?: boolean | undefined;
  reprocessMode?: ReprocessMode | undefined;
  lastErrorKind?: BatchTaskErrorKind | undefined;
  error?: string | undefined;
}

export interface BatchTaskOutcomeUpdaterOptions<TResult> {
  applyTaskUpdate: (updates: BatchTaskOutcomeUpdate<TResult>) => void;
  getOutputRelativePath: (generatedUrl: string) => string;
  persistGeneratedImage: (
    generatedUrl: string,
    outputRelativePath: string,
    outcomeUpdate: BatchTaskOutcomeUpdate<TResult>,
  ) => Promise<void>;
}

export function createBatchTaskOutcomeUpdaters<TResult>({
  applyTaskUpdate,
  getOutputRelativePath,
  persistGeneratedImage,
}: BatchTaskOutcomeUpdaterOptions<TResult>) {
  return {
    async markTaskImageSuccess(generatedUrl: string, options?: { clearReprocessMode?: boolean }) {
      const outputRelativePath = getOutputRelativePath(generatedUrl);
      const outcomeUpdate = buildImageSuccessTaskUpdate(
        generatedUrl,
        outputRelativePath,
        options,
      );
      applyTaskUpdate({
        generatedUrl,
        outputRelativePath,
        status: 'generating',
        phase: 'saving',
        error: '返图已收到，正在保存到本地…',
      });
      await persistGeneratedImage(generatedUrl, outputRelativePath, outcomeUpdate);
      applyTaskUpdate(outcomeUpdate);
    },
    async markTaskCopiedWithoutTranslation(result: TResult, generatedUrl: string, completedAt = Date.now()) {
      const outputRelativePath = getOutputRelativePath(generatedUrl);
      const outcomeUpdate = buildCopiedWithoutTranslationTaskUpdate(
        result,
        generatedUrl,
        outputRelativePath,
        completedAt,
      );
      applyTaskUpdate({
        result,
        generatedUrl,
        outputRelativePath,
        status: 'generating',
        phase: 'saving',
        error: '图片已准备好，正在保存到本地…',
      });
      await persistGeneratedImage(generatedUrl, outputRelativePath, outcomeUpdate);
      applyTaskUpdate(outcomeUpdate);
    },
    markTaskPaused() {
      applyTaskUpdate(buildPausedTaskUpdate());
    },
    markTaskFailed(processingError: ProcessingError) {
      applyTaskUpdate(buildFailedTaskUpdate(processingError));
    },
  };
}

export function getBatchRunStartedAt<TTask extends BatchTaskLike>(
  tasks: TTask[],
  currentBatchStartedAt: number | null,
  fallbackStartedAt = Date.now(),
) {
  const hasFinishedTasks = tasks.some((task) => isFinishedBatchTask(task.status));
  const hasRemainingProcessableTasks = getProcessableBatchTasks(tasks).length > 0;
  return currentBatchStartedAt && hasFinishedTasks && hasRemainingProcessableTasks
    ? currentBatchStartedAt
    : fallbackStartedAt;
}

export function getBatchRunCompletionState<TTask extends BatchTaskLike>(
  tasks: TTask[],
  finishedAt = Date.now(),
) {
  const hasPausedTasks = tasks.some((task) => task.status === 'paused');
  return {
    runState: hasPausedTasks ? 'paused' as const : 'completed' as const,
    completedAt: hasPausedTasks ? null : finishedAt,
    timestamp: finishedAt,
  };
}

function isTransientImageFailure(error: ProcessingError) {
  return (
    error.kind === 'rate_limit' ||
    error.kind === 'timeout' ||
    error.kind === 'network' ||
    error.kind === 'server'
  );
}

export function createImageQueueThrottle(
  imageQueue: AdaptiveImageQueueLike,
  options?: {
    threshold?: number;
    reducedLimit?: number;
    recoverySuccesses?: number;
    recoveryCooldownMs?: number;
  },
): ImageQueueThrottle {
  const threshold = options?.threshold ?? 2;
  const reducedLimit = options?.reducedLimit ?? 1;
  const recoverySuccesses = options?.recoverySuccesses ?? 4;
  const recoveryCooldownMs = options?.recoveryCooldownMs ?? 15_000;
  const maximumLimit = imageQueue.getLimit();
  let consecutiveTransientFailures = 0;
  let consecutiveSuccesses = 0;
  let reducedAt = 0;

  return {
    registerSuccess() {
      consecutiveTransientFailures = 0;
      if (imageQueue.getLimit() >= maximumLimit) {
        consecutiveSuccesses = 0;
        return;
      }

      consecutiveSuccesses += 1;
      if (
        consecutiveSuccesses >= recoverySuccesses &&
        Date.now() - reducedAt >= recoveryCooldownMs
      ) {
        imageQueue.setLimit(Math.min(maximumLimit, imageQueue.getLimit() + 1));
        consecutiveSuccesses = 0;
      }
    },
    registerFailure(error: ProcessingError) {
      if (!isTransientImageFailure(error)) {
        consecutiveTransientFailures = 0;
        consecutiveSuccesses = 0;
        return;
      }

      consecutiveTransientFailures += 1;
      consecutiveSuccesses = 0;

      if (consecutiveTransientFailures >= threshold && imageQueue.getLimit() > reducedLimit) {
        imageQueue.setLimit(reducedLimit);
        reducedAt = Date.now();
      }
    },
  };
}

export function getRequiredBatchTaskBase64Data(previewDataUrl: string) {
  const base64Data = previewDataUrl.split(',')[1];

  if (!base64Data) {
    throw new ProcessingError('图片读取失败，请重新上传后再试。', {
      kind: 'client',
      retryable: false,
    });
  }

  return base64Data;
}

export function isFinishedBatchTask(status: BatchTaskStatus) {
  return status === 'success' || status === 'copied';
}

export function isProcessableBatchTask(status: BatchTaskStatus) {
  return status === 'idle' || status === 'error' || status === 'paused';
}

export function isPausableBatchTask(status: BatchTaskStatus) {
  return !isFinishedBatchTask(status) && status !== 'paused';
}

export function getProcessableBatchTasks<TTask extends BatchTaskLike>(
  tasks: TTask[],
  onlyTaskIds?: string[],
) {
  const onlyTaskIdSet = onlyTaskIds ? new Set(onlyTaskIds) : null;
  return tasks.filter(
    (task) =>
      isProcessableBatchTask(task.status) &&
      (!onlyTaskIdSet || onlyTaskIdSet.has(task.id)),
  );
}

export function getPausableTaskIds<TTask extends BatchTaskLike>(
  tasks: TTask[],
  taskIds: string[],
) {
  const idSet = new Set(taskIds);
  return tasks
    .filter((task) => idSet.has(task.id) && isPausableBatchTask(task.status))
    .map((task) => task.id);
}

export function getPausedTaskIds<TTask extends BatchTaskLike>(
  tasks: TTask[],
  taskIds: string[],
) {
  const idSet = new Set(taskIds);
  return tasks
    .filter((task) => idSet.has(task.id) && task.status === 'paused')
    .map((task) => task.id);
}

export function applyPausedTaskState<TTask extends BatchTaskLike>(
  tasks: TTask[],
  pausedIds: string[],
) {
  const pausedIdSet = new Set(pausedIds);
  return tasks.map((task) =>
    pausedIdSet.has(task.id)
      ? {
          ...task,
          status: 'paused' as const,
          error: undefined,
          completedAt: undefined,
        }
      : task,
  );
}

export function prepareReprocessTasks<TTask extends BatchTaskLike>(
  tasks: TTask[],
  taskIds: string[],
  mode: ReprocessMode,
) {
  const targetIds = new Set(taskIds);
  const runnableIds: string[] = [];
  const nextTasks = tasks.map((task) => {
    if (!targetIds.has(task.id)) return task;
    if (mode === 'redraw' && !task.result?.translatedText) return task;
    runnableIds.push(task.id);
    return {
      ...task,
      status: 'idle' as const,
      phase: 'idle' as const,
      error: undefined,
      completedAt: undefined,
      wasCopiedWithoutTranslation: false,
      reprocessMode: mode,
      generationOperationId: undefined,
      result: mode === 'translate' ? undefined : task.result,
    };
  });

  return { nextTasks, runnableIds };
}

export function prepareFailedTaskRetries<TTask extends BatchTaskLike>(
  tasks: TTask[],
  taskIds: string[],
) {
  const retryIds = new Set(taskIds);
  return tasks.map((task) => {
    if (!retryIds.has(task.id) || task.status !== 'error') return task;
    return {
      ...task,
      status: 'idle' as const,
      phase: 'idle' as const,
      error: undefined,
      completedAt: undefined,
      wasCopiedWithoutTranslation: false,
      reprocessMode: undefined,
      generationOperationId: undefined,
      result: undefined,
    };
  });
}
