'use client';

import { type MouseEvent, type RefObject } from 'react';
import { Image as ImageIcon, Loader2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  getHistoryPreviewImages,
  getHistoryStatusText,
  type HistoryTaskRecord,
} from './history-client';
import { LocalPreviewImage } from './task-gallery';

interface HistoryGalleryProps {
  galleryRef: RefObject<HTMLElement | null>;
  tasks: HistoryTaskRecord[];
  totalCount: number;
  selectedTaskIds: Set<string>;
  hasMore: boolean;
  loading: boolean;
  suppressNextClick: boolean;
  onBeginSelection: (event: MouseEvent<HTMLElement>) => void;
  onBlankClick: () => void;
  onToggleSelectAll: () => void;
  onToggleTask: (taskId: string, event: MouseEvent<HTMLElement>) => void;
  onOpenMenu: (event: MouseEvent, taskId: string) => void;
  onDownloadSelected: (taskIds: string[]) => void;
  onDeleteSelected: (taskIds: string[]) => void;
  onLoadMore: () => void;
}

export function HistoryGallery({
  galleryRef,
  tasks,
  totalCount,
  selectedTaskIds,
  hasMore,
  loading,
  suppressNextClick,
  onBeginSelection,
  onBlankClick,
  onToggleSelectAll,
  onToggleTask,
  onOpenMenu,
  onDownloadSelected,
  onDeleteSelected,
  onLoadMore,
}: HistoryGalleryProps) {
  return (
    <section
      ref={galleryRef}
      onMouseDown={onBeginSelection}
      onClick={(event) => {
        if (suppressNextClick) {
          event.preventDefault();
          return;
        }
        if (selectedTaskIds.size > 0 && isBlankHistoryGalleryClick(event)) onBlankClick();
      }}
      className="xobi-history-gallery-stage relative h-full select-none overflow-auto bg-[color-mix(in_srgb,var(--xobi-surface)_78%,transparent)] p-2.5 text-[var(--xobi-text)] backdrop-blur-2xl sm:p-3"
    >
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold tracking-wide text-[var(--xobi-text)]">项目图库</h3>
          <p className="mt-1 text-[11px] text-[var(--xobi-muted)]">点开详情，拖拽框选，右键操作。</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onToggleSelectAll}
            disabled={tasks.length === 0}
            title="也可以按 Ctrl+A"
            className="inline-flex min-h-10 items-center rounded-full border border-[var(--xobi-control-border)] bg-[var(--xobi-surface-soft)] px-3 text-[11px] font-medium text-[var(--xobi-text)] transition-colors hover:bg-[var(--xobi-surface-raised)] disabled:cursor-not-allowed disabled:text-[var(--xobi-faint)] disabled:opacity-60"
          >
            {tasks.length > 0 && selectedTaskIds.size === tasks.length ? '取消全选' : '全选'}
          </button>
          <span className="rounded-full border border-[var(--xobi-border)] bg-[var(--xobi-surface-soft)] px-3 py-1.5 text-[11px] tabular-nums text-[var(--xobi-muted)]">
            {totalCount} 个项目
          </span>
        </div>
      </div>

      {selectedTaskIds.size > 0 && (
        <div
          data-history-selection-bar
          className="xobi-history-selection-bar sticky top-2 z-20 mb-3 ml-auto flex w-fit min-h-12 items-center gap-1 rounded-full border border-[var(--xobi-border-strong)] bg-[color-mix(in_srgb,var(--xobi-bg)_88%,transparent)] p-1 text-xs text-[var(--xobi-text)] shadow-[var(--xobi-shadow-lg)] backdrop-blur-xl"
          role="group"
          aria-label="已选历史项目操作"
        >
          <span className="px-2 font-medium tabular-nums" aria-live="polite">已选 {selectedTaskIds.size}</span>
          <button
            type="button"
            onClick={() => onDownloadSelected([...selectedTaskIds])}
            className="min-h-11 rounded-full px-3 text-xs font-medium text-[var(--xobi-text)] transition-colors hover:bg-[var(--xobi-surface-soft)]"
          >
            下载
          </button>
          <button
            type="button"
            onClick={() => onDeleteSelected([...selectedTaskIds])}
            className="min-h-11 rounded-full px-3 text-xs font-medium text-[var(--xobi-danger)] transition-colors hover:bg-[var(--xobi-danger-soft)]"
          >
            删除
          </button>
        </div>
      )}

      {tasks.length === 0 ? (
        <div className="xobi-empty-state flex min-h-[58vh] items-center justify-center rounded-3xl border border-dashed border-[var(--xobi-border)] bg-[var(--xobi-surface-soft)] px-6 text-center text-sm text-[var(--xobi-muted)]">
          暂无历史。上传图片后会自动保存在这里。
        </div>
      ) : (
        <div className="ui-history-wall xobi-history-masonry xobi-history-masonry-full grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] items-start gap-2 sm:gap-2.5">
          {tasks.map((task) => (
            <HistoryGalleryCard
              key={task.id}
              task={task}
              selected={selectedTaskIds.has(task.id)}
              onToggleTask={onToggleTask}
              onOpenMenu={onOpenMenu}
            />
          ))}
        </div>
      )}

      {hasMore && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loading}
            className="xobi-soft-button min-h-11 px-5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            加载更多历史
          </button>
        </div>
      )}
    </section>
  );
}

function HistoryGalleryCard({
  task,
  selected,
  onToggleTask,
  onOpenMenu,
}: {
  task: HistoryTaskRecord;
  selected: boolean;
  onToggleTask: (taskId: string, event: MouseEvent<HTMLElement>) => void;
  onOpenMenu: (event: MouseEvent, taskId: string) => void;
}) {
  const percent = task.totalCount ? Math.round((task.doneCount / task.totalCount) * 100) : 0;
  const previews = getHistoryPreviewImages(task);
  const cover = previews[0];
  const thumbs = previews.slice(1, 4);

  return (
    <button
      type="button"
      data-history-task-id={task.id}
      aria-pressed={selected}
      onClick={(event) => onToggleTask(task.id, event)}
      onContextMenu={(event) => onOpenMenu(event, task.id)}
      className={cn(
        'xobi-history-card xobi-history-gallery-card group block w-full min-w-0 rounded-2xl border border-[var(--xobi-border)] bg-[color-mix(in_srgb,var(--xobi-surface)_82%,transparent)] p-1.5 text-left shadow-[var(--xobi-shadow-sm)] backdrop-blur-xl transition-[border-color,background-color,box-shadow] duration-200 hover:border-[var(--xobi-border-strong)] hover:bg-[var(--xobi-surface-raised)] hover:shadow-[var(--xobi-shadow-sm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--xobi-accent)]',
        selected && 'xobi-history-card-active xobi-history-card-selected',
      )}
    >
      <div className="xobi-history-cover relative aspect-square overflow-hidden rounded-[1.15rem] border border-[var(--xobi-border)] bg-[var(--xobi-surface-soft)]">
        {cover?.dataUrl ? (
          <LocalPreviewImage src={cover.dataUrl} alt={cover.name} className="p-2" />
        ) : (
          <div className="xobi-history-cover-empty flex h-full flex-col items-center justify-center gap-2 text-xs text-[var(--xobi-muted)]">
            <ImageIcon className="h-7 w-7" aria-hidden="true" />
            <span>暂无预览</span>
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 px-0.5">
        <span
          className={cn(
            'xobi-cover-kind inline-flex min-h-6 items-center rounded-full px-2 py-1 text-[10px] font-bold tracking-[0.06em]',
            cover?.kind === 'result'
              ? 'xobi-cover-result xobi-filled-contrast bg-[var(--xobi-accent)] text-[var(--xobi-accent-contrast)]'
              : 'xobi-cover-original bg-[var(--xobi-surface-soft)] text-[var(--xobi-muted)]',
          )}
        >
          {cover?.kind === 'result' ? '结果封面' : '原图封面'}
        </span>
        <span
          className={cn(
            'xobi-status-pill xobi-cover-status inline-flex min-h-6 items-center rounded-full bg-[var(--xobi-surface-soft)] px-2 py-1 text-[10px] font-medium',
            getHistoryStatusTone(task.status),
          )}
        >
          {getHistoryStatusText(task.status)}
        </span>
      </div>

      <div className="mt-2.5 grid grid-cols-3 gap-1.5 px-0.5" aria-hidden="true">
        {thumbs.length > 0
          ? thumbs.map((preview) => (
            <div key={`${task.id}-${preview.id}-${preview.kind}`} className="xobi-history-thumb relative aspect-square overflow-hidden rounded-lg border border-[var(--xobi-border)] bg-[var(--xobi-surface-soft)]">
              {preview.dataUrl && <LocalPreviewImage src={preview.dataUrl} alt="" className="p-1" />}
            </div>
          ))
          : Array.from({ length: 3 }).map((_, index) => (
            <div key={`${task.id}-empty-${index}`} className="xobi-history-thumb xobi-history-thumb-empty aspect-square rounded-lg border border-[var(--xobi-border)] bg-[var(--xobi-surface-soft)]" />
          ))}
      </div>

      <div className="mt-2.5 flex items-start justify-between gap-3 px-0.5">
        <div className="min-w-0 text-left">
          <p className="truncate text-[13px] font-semibold text-[var(--xobi-text)]">{task.name}</p>
          <p className="mt-1 truncate text-[10px] tabular-nums text-[var(--xobi-faint)]">{new Date(task.updatedAt).toLocaleString('zh-CN')}</p>
        </div>
        <span className="text-right text-base font-semibold leading-none tabular-nums text-[var(--xobi-text)]">{percent}%</span>
      </div>

      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[var(--xobi-surface-soft)]" role="progressbar" aria-label={`${task.name} 完成进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div className="ui-progress-transform h-full w-full rounded-full bg-[var(--xobi-accent)]" style={{ transform: `scaleX(${percent / 100})` }} />
      </div>

      <div className="mt-2.5 grid grid-cols-3 gap-1.5 px-0.5 text-[10px]">
        <span className="xobi-mini-chip rounded-lg bg-[var(--xobi-surface-soft)] px-1.5 py-1.5 text-center text-[var(--xobi-muted)]">总 {task.totalCount}</span>
        <span className="xobi-mini-chip rounded-lg bg-[var(--xobi-surface-soft)] px-1.5 py-1.5 text-center text-[var(--xobi-text)]">成 {task.doneCount}</span>
        <span className={cn('xobi-mini-chip rounded-lg bg-[var(--xobi-surface-soft)] px-1.5 py-1.5 text-center', task.failCount > 0 ? 'text-[var(--xobi-danger)]' : 'text-[var(--xobi-faint)]')}>败 {task.failCount}</span>
      </div>
    </button>
  );
}

function getHistoryStatusTone(status: HistoryTaskRecord['status']) {
  if (status === 'done') return 'text-[var(--xobi-accent)]';
  if (status === 'failed') return 'text-[var(--xobi-danger)]';
  if (status === 'running') return 'text-[var(--xobi-warning)]';
  return 'text-[var(--xobi-muted)]';
}

function isBlankHistoryGalleryClick(event: MouseEvent<HTMLElement>) {
  const target = event.target as HTMLElement;
  return !target.closest('[data-history-task-id],[data-history-selection-bar]');
}
