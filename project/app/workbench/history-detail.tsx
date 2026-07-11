'use client';

import { type ReactNode } from 'react';
import { Archive, Download, FolderOpen, Loader2, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type HistoryImageRecord, type HistoryTaskRecord } from './history-client';
import { LocalPreviewImage } from './task-gallery';

interface HistoryDetailProps {
  task: HistoryTaskRecord | null;
  detailReady: boolean;
  donePercent: number;
  logs: string;
  loading: boolean;
  workspaceBusy: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  getStatusText: (status: HistoryImageRecord['status']) => string;
  onBack: () => void;
  onRestoreTask: (taskId: string) => void;
  onDeleteTask: (taskId: string) => void;
  onReprocessImage: (image: HistoryImageRecord, mode: 'translate' | 'redraw') => void;
  onDownloadImage: (image: HistoryImageRecord, kind: 'original' | 'result') => void;
  onDeleteImage: (image: HistoryImageRecord) => void;
  onLoadMoreImages: () => void;
}

export function HistoryDetail({
  task,
  detailReady,
  donePercent,
  logs,
  loading,
  workspaceBusy,
  hasMore,
  loadingMore,
  getStatusText,
  onBack,
  onRestoreTask,
  onDeleteTask,
  onReprocessImage,
  onDownloadImage,
  onDeleteImage,
  onLoadMoreImages,
}: HistoryDetailProps) {
  return (
    <div className="xobi-history-detail-view grid h-full min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="min-h-0 overflow-auto bg-[var(--xobi-surface-soft)] p-4">
        <button
          type="button"
          data-history-detail-back
          onClick={onBack}
          className="xobi-soft-button mb-3 min-h-11 px-3 text-xs"
        >
          返回图库
        </button>
        {task ? (
          !detailReady ? (
            <div className="xobi-empty-state flex min-h-[52vh] flex-col items-center justify-center rounded-3xl border border-dashed border-[var(--xobi-border)] bg-[var(--xobi-surface)] text-[var(--xobi-muted)]" role="status" aria-live="polite">
              <RefreshCw className="h-5 w-5 animate-spin" aria-hidden="true" />
              <p className="mt-3 text-sm">正在读取本地预览…</p>
            </div>
          ) : (
            <div className="space-y-4">
              <HistoryDetailHeader
                task={task}
                donePercent={donePercent}
                loading={loading}
                workspaceBusy={workspaceBusy}
                onRestoreTask={onRestoreTask}
                onDeleteTask={onDeleteTask}
              />

              <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))]">
                {task.images.map((image) => (
                  <HistoryDetailImageCard
                    key={image.id}
                    image={image}
                    loading={loading}
                    workspaceBusy={workspaceBusy}
                    statusText={getStatusText(image.status)}
                    onReprocessImage={onReprocessImage}
                    onDownloadImage={onDownloadImage}
                    onDeleteImage={onDeleteImage}
                  />
                ))}
              </div>

              {hasMore && (
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={onLoadMoreImages}
                    disabled={loadingMore}
                    className="xobi-soft-button min-h-11 px-5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
                    继续加载历史图片
                  </button>
                </div>
              )}
            </div>
          )
        ) : (
          <div className="xobi-empty-state flex min-h-[52vh] items-center justify-center rounded-3xl border border-dashed border-[var(--xobi-border)] bg-[var(--xobi-surface)] px-6 text-center text-sm text-[var(--xobi-muted)]">
            这个历史任务不存在，请返回图库重新选择。
          </div>
        )}
      </section>

      <aside className="min-h-0 overflow-auto border-t border-[var(--xobi-border)] bg-[color-mix(in_srgb,var(--xobi-bg)_76%,transparent)] p-4 lg:border-l lg:border-t-0">
        <p className="xobi-kicker text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--xobi-faint)]">local log</p>
        <div className="mt-3 rounded-2xl border border-[var(--xobi-border)] bg-[var(--xobi-surface-soft)] p-3">
          <div className="grid grid-cols-2 gap-2 text-center text-xs">
            <div className="rounded-xl bg-[var(--xobi-surface-soft)] p-3">
              <p className="text-[var(--xobi-muted)]">本地任务</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--xobi-text)]">{task?.totalCount ?? 0}</p>
            </div>
            <div className="rounded-xl bg-[var(--xobi-surface-soft)] p-3">
              <p className="text-[var(--xobi-muted)]">保存进度</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--xobi-accent)]">{donePercent}%</p>
            </div>
          </div>
          <p className="mt-3 break-all text-[11px] leading-5 text-[var(--xobi-muted)]">{task ? `任务 ID：${task.id}` : '未选择任务'}</p>
        </div>
        <pre className="ui-history-log mt-3 max-h-[48vh] overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-[var(--xobi-border)] bg-[color-mix(in_srgb,var(--xobi-bg)_88%,transparent)] p-3 text-[11px] leading-5 text-[var(--xobi-muted)]">
          {logs || '选择一个历史任务后显示本地写入日志。'}
        </pre>
      </aside>
    </div>
  );
}

function HistoryDetailHeader({
  task,
  donePercent,
  loading,
  workspaceBusy,
  onRestoreTask,
  onDeleteTask,
}: {
  task: HistoryTaskRecord;
  donePercent: number;
  loading: boolean;
  workspaceBusy: boolean;
  onRestoreTask: (taskId: string) => void;
  onDeleteTask: (taskId: string) => void;
}) {
  return (
    <div className="xobi-detail-plate rounded-3xl border border-[var(--xobi-border)] bg-[color-mix(in_srgb,var(--xobi-surface)_82%,transparent)] p-4 shadow-[var(--xobi-shadow-sm)] backdrop-blur-xl sm:p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <p className="xobi-kicker text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--xobi-faint)]">detail</p>
          <h3 className="mt-1 truncate text-2xl font-semibold tracking-[-0.035em] text-[var(--xobi-text)]">{task.name}</h3>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="xobi-mini-chip rounded-full bg-[var(--xobi-surface-soft)] px-2.5 py-1.5 text-[var(--xobi-muted)]">{task.language}</span>
            <span className="xobi-mini-chip rounded-full bg-[var(--xobi-surface-soft)] px-2.5 py-1.5 text-[var(--xobi-muted)]">{task.ratio}</span>
            <span className="xobi-mini-chip rounded-full bg-[var(--xobi-surface-soft)] px-2.5 py-1.5 text-[var(--xobi-text)]">{task.doneCount}/{task.totalCount}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onRestoreTask(task.id)}
            disabled={loading || workspaceBusy}
            className="xobi-primary-action min-h-11 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FolderOpen className="h-4 w-4" aria-hidden="true" />
            恢复/继续
          </button>
          <button
            type="button"
            onClick={() => onDeleteTask(task.id)}
            disabled={loading || workspaceBusy}
            className="xobi-danger-action min-h-11 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            删除
          </button>
        </div>
      </div>
      <div className="ui-progress-rail mt-4 h-2 overflow-hidden rounded-full bg-[var(--xobi-surface-soft)]" role="progressbar" aria-label="历史任务保存进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={donePercent}>
        <div className="ui-progress-transform h-full w-full rounded-full bg-[var(--xobi-accent)]" style={{ transform: `scaleX(${donePercent / 100})` }} />
      </div>
    </div>
  );
}

function HistoryDetailImageCard({
  image,
  loading,
  workspaceBusy,
  statusText,
  onReprocessImage,
  onDownloadImage,
  onDeleteImage,
}: {
  image: HistoryImageRecord;
  loading: boolean;
  workspaceBusy: boolean;
  statusText: string;
  onReprocessImage: (image: HistoryImageRecord, mode: 'translate' | 'redraw') => void;
  onDownloadImage: (image: HistoryImageRecord, kind: 'original' | 'result') => void;
  onDeleteImage: (image: HistoryImageRecord) => void;
}) {
  return (
    <article className="xobi-history-image-card overflow-hidden rounded-3xl border border-[var(--xobi-border)] bg-[color-mix(in_srgb,var(--xobi-surface)_84%,transparent)] p-3 shadow-[var(--xobi-shadow-sm)] backdrop-blur-xl sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--xobi-text)]" title={image.relativePath}>{image.name}</p>
          <p className="mt-1 truncate text-xs text-[var(--xobi-muted)]" title={image.outputRelativePath}>{image.outputRelativePath}</p>
        </div>
        <span className={cn('xobi-status-pill xobi-status-partial shrink-0 rounded-full bg-[var(--xobi-surface-soft)] px-2 py-1 text-[10px] font-medium', getImageStatusTone(image.status))}>{statusText}</span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="ui-preview-pane relative aspect-square overflow-hidden rounded-2xl border border-[var(--xobi-border)] bg-[var(--xobi-surface-soft)]">
          <span className="absolute left-2 top-2 z-10 rounded-md bg-[color-mix(in_srgb,var(--xobi-bg)_78%,transparent)] px-1.5 py-0.5 text-[9px] text-[var(--xobi-muted)] backdrop-blur-md">原图</span>
          {image.originalDataUrl ? <LocalPreviewImage src={image.originalDataUrl} alt={image.name} className="p-3" /> : <div className="flex h-full items-center justify-center text-xs text-[var(--xobi-danger)]">{image.originalPath ? '读取失败' : '原图缺失'}</div>}
        </div>
        <div className="ui-preview-pane ui-preview-result relative aspect-square overflow-hidden rounded-2xl border border-[var(--xobi-border)] bg-[var(--xobi-surface-soft)]">
          <span className="xobi-filled-contrast absolute left-2 top-2 z-10 rounded-md bg-[var(--xobi-accent)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--xobi-accent-contrast)]">结果</span>
          {image.resultDataUrl ? <LocalPreviewImage src={image.resultDataUrl} alt={`${image.name} result`} className="p-3" /> : <div className="flex h-full items-center justify-center text-xs text-[var(--xobi-muted)]">未生成</div>}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        <span className={cn('xobi-save-pill rounded-xl bg-[var(--xobi-surface-soft)] px-2 py-2 text-center', image.originalPath ? 'text-[var(--xobi-text)]' : 'text-[var(--xobi-danger)]')}>原图 {image.originalPath ? '已保存' : '缺失'}</span>
        <span className={cn('xobi-save-pill rounded-xl bg-[var(--xobi-surface-soft)] px-2 py-2 text-center', image.resultPath ? 'text-[var(--xobi-text)]' : 'text-[var(--xobi-muted)]')}>结果 {image.resultPath ? '已保存' : '未生成'}</span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <HistoryImageButton onClick={() => onReprocessImage(image, 'translate')} disabled={loading || workspaceBusy || !image.originalDataUrl} icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />} label="重翻" />
        <HistoryImageButton onClick={() => onReprocessImage(image, 'redraw')} disabled={loading || workspaceBusy || !image.originalDataUrl || !image.translatedText} icon={<Sparkles className="h-3.5 w-3.5" aria-hidden="true" />} label="重绘" />
        <HistoryImageButton onClick={() => onDownloadImage(image, 'original')} disabled={!image.originalDataUrl} icon={<Download className="h-3.5 w-3.5" aria-hidden="true" />} label="原图" />
        <HistoryImageButton onClick={() => onDownloadImage(image, 'result')} disabled={!image.resultDataUrl} icon={<Archive className="h-3.5 w-3.5" aria-hidden="true" />} label="结果" />
      </div>

      <button type="button" onClick={() => onDeleteImage(image)} disabled={loading || workspaceBusy} className="xobi-danger-action mt-2 min-h-11 w-full justify-center text-xs disabled:cursor-not-allowed disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" />删除这张</button>
      {image.error && <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--xobi-danger)]">{image.error}</p>}
    </article>
  );
}

function HistoryImageButton({
  onClick,
  disabled,
  icon,
  label,
}: {
  onClick: () => void;
  disabled: boolean;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="xobi-soft-button min-h-11 justify-center text-xs disabled:cursor-not-allowed disabled:opacity-50"
    >
      {icon}
      {label}
    </button>
  );
}

function getImageStatusTone(status: HistoryImageRecord['status']) {
  if (status === 'success' || status === 'copied') return 'text-[var(--xobi-accent)]';
  if (status === 'error') return 'text-[var(--xobi-danger)]';
  if (['detecting', 'extracting', 'generating', 'retrying'].includes(status)) return 'text-[var(--xobi-warning)]';
  return 'text-[var(--xobi-muted)]';
}
