import { memo, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Check, Download, Image as ImageIcon, Loader2, Maximize2, MoreHorizontal, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BatchTaskPhase } from './batch-state';

/* eslint-disable @next/next/no-img-element -- Local data URL previews and history thumbnails should not go through Next image optimization. */

export type TaskCardStatus =
  | 'idle'
  | 'detecting'
  | 'extracting'
  | 'generating'
  | 'retrying'
  | 'paused'
  | 'copied'
  | 'success'
  | 'error';

export type TaskSelectEvent = MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>;

export interface TaskCardTask {
  id: string;
  file: {
    name: string;
  };
  relativePath: string;
  preview: string;
  generatedUrl?: string;
  status: TaskCardStatus;
  phase?: BatchTaskPhase;
  error?: string;
  retryCount: number;
  result?: {
    extractedText?: string;
  };
}

export interface TaskDisplayGroup<TTask extends TaskCardTask> {
  groupLabel: string;
  tasks: TTask[];
}

interface LocalPreviewImageProps {
  src: string;
  alt: string;
  className?: string;
  onError?: () => void;
}

export const LocalPreviewImage = memo(function LocalPreviewImage({
  src,
  alt,
  className,
  onError,
}: LocalPreviewImageProps) {
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={onError}
      className={cn('absolute inset-0 h-full w-full object-contain', className)}
    />
  );
});

interface TaskCardProps<TTask extends TaskCardTask> {
  task: TTask;
  selected: boolean;
  isProcessingBatch: boolean;
  cardSizeClass: string;
  onToggle: (taskId: string, event: TaskSelectEvent) => void;
  onOpenMenu: (event: MouseEvent, taskId: string) => void;
  onOpenKeyboardMenu: (taskId: string, element: HTMLElement) => void;
  onRemove: (taskId: string) => void;
  onDownload: (taskId: string) => void;
  onPreview: (taskId: string, kind: 'original' | 'result') => void;
}

function TaskCardInner<TTask extends TaskCardTask>({
  task,
  selected,
  isProcessingBatch,
  cardSizeClass,
  onToggle,
  onOpenMenu,
  onOpenKeyboardMenu,
  onRemove,
  onDownload,
  onPreview,
}: TaskCardProps<TTask>) {
  const [failedResultSource, setFailedResultSource] = useState<string | null>(null);
  const resultImageLoadFailed = Boolean(task.generatedUrl && failedResultSource === task.generatedUrl);
  const isTaskProcessing = task.status === 'detecting'
    || task.status === 'extracting'
    || task.status === 'generating'
    || task.status === 'retrying';
  const resultReady = Boolean(task.generatedUrl && !resultImageLoadFailed);
  const statusTone = task.status === 'error'
    ? 'ui-task-status-error text-[var(--xobi-danger)]'
    : task.status === 'retrying' || task.status === 'paused'
      ? 'ui-task-status-warning text-[var(--xobi-warning)]'
      : task.status === 'success' || task.status === 'copied'
        ? 'ui-task-status-success text-[var(--xobi-accent)]'
        : task.status === 'idle'
          ? 'ui-task-status-idle text-[var(--xobi-muted)]'
          : 'ui-task-status-running text-[var(--xobi-accent)]';
  const statusLabel = task.status === 'idle'
    ? '等待处理'
    : task.status === 'detecting'
      ? '识别文字'
      : task.status === 'retrying'
        ? '等待重试'
        : task.status === 'paused'
          ? '已暂停'
          : task.status === 'extracting'
            ? '翻译文字'
            : task.status === 'generating' && task.phase === 'image_queue'
              ? '等待生图'
              : task.status === 'generating' && task.phase === 'saving'
                ? '保存结果'
                : task.status === 'generating'
                  ? '等待返图'
                  : task.status === 'copied'
                    ? '已复制原图'
                    : task.status === 'success'
                      ? '翻译完成'
                      : `处理失败${task.retryCount > 0 ? ` · 已重试 ${task.retryCount} 次` : ''}`;

  return (
    <article
      data-task-id={task.id}
      data-task-card
      data-task-status={task.status}
      data-selected={selected}
      data-processing={isTaskProcessing}
      data-result-ready={resultReady}
      role="listitem"
      onClick={(event) => onToggle(task.id, event)}
      onContextMenu={(event) => onOpenMenu(event, task.id)}
      className={cn(
        'ui-task-card overflow-hidden rounded-2xl border border-[var(--xobi-border)] bg-[var(--xobi-surface)] transition-[border-color,background-color] duration-200 hover:border-[var(--xobi-border-strong)]',
        cardSizeClass,
        selected && 'ui-task-card-selected border-[var(--xobi-accent)] bg-[var(--xobi-accent-soft)]',
      )}
    >
      <div className="ui-task-card-head flex min-h-12 items-center gap-1 border-b border-[var(--xobi-border)] px-2">
        <button
          type="button"
          data-task-select
          aria-pressed={selected}
          aria-label={`${selected ? '取消选择' : '选择'} ${task.file.name}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(task.id, event);
          }}
          onKeyDown={(event) => {
            if (event.key === 'F10' && event.shiftKey) {
              event.preventDefault();
              onOpenKeyboardMenu(task.id, event.currentTarget);
            }
          }}
          className="ui-task-select-control flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-[10px] transition-colors duration-200 hover:bg-[var(--xobi-surface-raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--xobi-accent)]"
        >
          <span className={cn(
            'ui-task-check flex h-5 w-5 items-center justify-center rounded-md border transition-colors duration-200',
            selected
              ? 'xobi-filled-contrast border-[var(--xobi-accent)] bg-[var(--xobi-accent)] text-[var(--xobi-accent-contrast)]'
              : 'border-[var(--xobi-border-strong)] bg-[var(--xobi-surface)] text-transparent',
          )} data-selected={selected} aria-hidden="true">
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        </button>
        <div className="min-w-0 flex-1 truncate px-1 text-xs font-medium text-[var(--xobi-muted)]" title={task.relativePath}>
          {task.file.name}
        </div>
        <button
          type="button"
          aria-label={`打开 ${task.file.name} 的操作菜单`}
          title="更多操作"
          onClick={(event) => {
            event.stopPropagation();
            onOpenMenu(event, task.id);
          }}
          className="ui-task-inline-action flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-[10px] text-[var(--xobi-muted)] transition-colors duration-200 hover:bg-[var(--xobi-surface-raised)] hover:text-[var(--xobi-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--xobi-accent)]"
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={`从工作台移除 ${task.file.name}`}
          title="从工作台移除"
          onClick={(event) => {
            event.stopPropagation();
            onRemove(task.id);
          }}
          disabled={isProcessingBatch}
          className="ui-task-inline-action flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-[10px] text-[var(--xobi-muted)] transition-colors duration-200 hover:bg-[var(--xobi-surface-raised)] hover:text-[var(--xobi-danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--xobi-danger)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="ui-task-preview-grid grid grid-cols-2 gap-px bg-[var(--xobi-border)]">
        <div className="ui-preview-pane ui-preview-original relative flex aspect-square min-h-0 items-center justify-center overflow-hidden bg-[var(--xobi-canvas)]" data-preview-kind="original">
          <span className="ui-preview-hover-glow" aria-hidden="true" />
          <span className="ui-preview-label absolute left-2 top-2 z-10 rounded-md border border-[var(--xobi-border)] bg-[var(--xobi-surface-raised)] px-2 py-1 text-[10px] font-medium text-[var(--xobi-muted)]">原图</span>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onPreview(task.id, 'original');
            }}
            aria-label={`查看 ${task.file.name} 原图大图`}
            title="查看原图大图"
            className="ui-preview-action absolute right-1.5 top-1.5 z-10 flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-[10px] border border-[var(--xobi-border)] bg-[var(--xobi-surface-raised)] text-[var(--xobi-muted)] transition-colors duration-200 hover:border-[var(--xobi-border-strong)] hover:text-[var(--xobi-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--xobi-accent)]"
          >
            <Maximize2 className="h-4 w-4" aria-hidden="true" />
          </button>
          <LocalPreviewImage src={task.preview} alt={`${task.file.name} 原图`} className="ui-preview-media p-3" />
        </div>
        <div
          className="ui-preview-pane ui-preview-result relative flex aspect-square min-h-0 items-center justify-center overflow-hidden bg-[var(--xobi-canvas)]"
          data-preview-kind="result"
          data-result-ready={resultReady}
          data-result-failed={resultImageLoadFailed}
        >
          <span className="ui-preview-hover-glow" aria-hidden="true" />
          <span className="ui-preview-label ui-preview-label-result xobi-filled-contrast absolute left-2 top-2 z-10 rounded-md border border-[var(--xobi-accent)] bg-[var(--xobi-accent)] px-2 py-1 text-[10px] font-semibold text-[var(--xobi-accent-contrast)]">结果</span>
          {task.generatedUrl && !resultImageLoadFailed && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onPreview(task.id, 'result');
              }}
              aria-label={`查看 ${task.file.name} 翻译结果大图`}
              title="查看结果大图"
              className="ui-preview-action absolute right-1.5 top-1.5 z-10 flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-[10px] border border-[var(--xobi-border)] bg-[var(--xobi-surface-raised)] text-[var(--xobi-accent)] transition-colors duration-200 hover:border-[var(--xobi-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--xobi-accent)]"
            >
              <Maximize2 className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          {task.generatedUrl && !resultImageLoadFailed ? (
            <LocalPreviewImage
              src={task.generatedUrl}
              alt={`${task.file.name} 的翻译结果`}
              className="ui-preview-media ui-preview-result-media p-3"
              onError={() => setFailedResultSource(task.generatedUrl ?? null)}
            />
          ) : resultImageLoadFailed ? (
            <div
              role="alert"
              title="这张结果图无法解码，请重新处理当前图片。"
              className="max-w-[11rem] px-3 text-center text-xs leading-5 text-[var(--xobi-danger)]"
            >
              结果无法预览
            </div>
          ) : task.status === 'generating' || task.status === 'extracting' || task.status === 'detecting' ? (
            <div className="ui-task-processing-indicator flex items-center gap-2 text-[var(--xobi-accent)]" role="status" aria-label="处理中">
              <span className="ui-task-processing-dot h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            </div>
          ) : (
            <ImageIcon className="ui-task-empty-result h-6 w-6 text-[var(--xobi-faint)]" aria-hidden="true" />
          )}
          {resultReady && <span className="ui-result-arrival-mark" aria-hidden="true" />}
        </div>
      </div>

      <div className="ui-task-card-footer flex min-h-12 items-center gap-2 px-3 py-2">
        <div
          className={cn('ui-task-status flex min-w-0 flex-1 items-center gap-2 text-xs font-medium', statusTone)}
          data-status={task.status}
          data-processing={isTaskProcessing}
          title={task.error || (task.status === 'generating' ? '任务已提交，等待服务返回图片。' : statusLabel)}
          aria-label={task.error ? `${statusLabel}：${task.error}` : statusLabel}
        >
          <span className="ui-task-status-dot h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
          <span className="truncate">{statusLabel}</span>
        </div>
        {task.generatedUrl && !resultImageLoadFailed && (
          <button
            type="button"
            aria-label={`下载 ${task.file.name} 的结果图`}
            onClick={(event) => {
              event.stopPropagation();
              onDownload(task.id);
            }}
            className="ui-task-result-action flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-[10px] text-[var(--xobi-accent)] transition-colors duration-200 hover:bg-[var(--xobi-accent-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--xobi-accent)]"
            title="下载当前图片"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </article>
  );
}

const TaskCard = memo(TaskCardInner) as typeof TaskCardInner;

interface TaskGroupsViewProps<TTask extends TaskCardTask> {
  groupedTasks: Array<TaskDisplayGroup<TTask>>;
  selectedTaskIds: Set<string>;
  isProcessingBatch: boolean;
  canvasGridClass: string;
  cardSizeClass: string;
  onToggle: (taskId: string, event: TaskSelectEvent) => void;
  onOpenMenu: (event: MouseEvent, taskId: string) => void;
  onOpenKeyboardMenu: (taskId: string, element: HTMLElement) => void;
  onRemove: (taskId: string) => void;
  onDownload: (taskId: string) => void;
  onPreview: (taskId: string, kind: 'original' | 'result') => void;
}

function TaskGroupsViewInner<TTask extends TaskCardTask>({
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
  onPreview,
}: TaskGroupsViewProps<TTask>) {
  return (
    <>
      {groupedTasks.map((group) => (
        <div key={group.groupLabel} className="space-y-3">
          {groupedTasks.length > 1 && <div className="flex items-center justify-between gap-3 px-1">
            <h2 className="ui-task-group-label rounded-full border border-[var(--xobi-border)] bg-[var(--xobi-surface)] px-3 py-1 text-xs font-medium text-[var(--xobi-muted)]">
              {group.groupLabel} · {group.tasks.length}
            </h2>
          </div>}

          <div className={canvasGridClass} role="list" aria-label={`${group.groupLabel} 图片`}>
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
                onPreview={onPreview}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

export const TaskGroupsView = memo(TaskGroupsViewInner) as typeof TaskGroupsViewInner;
