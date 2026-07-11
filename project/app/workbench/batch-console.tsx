'use client';

import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Archive, Download, PauseCircle, Pencil, PlayCircle, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ASPECT_RATIO_OPTIONS,
  getAspectRatioPreviewStyle,
  type OutputAspectRatio,
} from './options';

interface BatchConsoleProps {
  open: boolean;
  expanded: boolean;
  modal: boolean;
  focusRequested: boolean;
  isEditingProjectName: boolean;
  draftProjectName: string;
  activeProjectName: string;
  autoProjectName: string;
  uploadedFolderCount: number;
  groupCount: number;
  totalImageCount: number;
  batchStateLabel: string;
  batchElapsedLabel: string;
  selectedAspectRatioLabel: string;
  selectedAspectRatioHint: string;
  outputAspectRatio: OutputAspectRatio;
  isProcessingBatch: boolean;
  progressPercent: number;
  outputReadyCount: number;
  failedCount: number;
  pendingCount: number;
  pausedCount: number;
  startableCount: number;
  primaryRunLabel: string;
  batchComplete: boolean;
  onOpen: () => void;
  onScheduleClose: () => void;
  onClose: () => void;
  onStartEditingProjectName: () => void;
  onDraftProjectNameChange: (name: string) => void;
  onCancelEditingProjectName: () => void;
  onSaveProjectName: () => void;
  onSelectOutputAspectRatio: (ratio: OutputAspectRatio) => void;
  onArchiveCurrentProject: () => void;
  onPrimaryRunAction: () => void;
  onDownloadZip: () => void;
}

export function BatchConsole({
  open,
  expanded,
  modal,
  focusRequested,
  isEditingProjectName,
  draftProjectName,
  activeProjectName,
  autoProjectName,
  uploadedFolderCount,
  groupCount,
  totalImageCount,
  batchStateLabel,
  batchElapsedLabel,
  selectedAspectRatioLabel,
  selectedAspectRatioHint,
  outputAspectRatio,
  isProcessingBatch,
  progressPercent,
  outputReadyCount,
  failedCount,
  pendingCount,
  pausedCount,
  startableCount,
  primaryRunLabel,
  batchComplete,
  onOpen,
  onScheduleClose,
  onClose,
  onStartEditingProjectName,
  onDraftProjectNameChange,
  onCancelEditingProjectName,
  onSaveProjectName,
  onSelectOutputAspectRatio,
  onArchiveCurrentProject,
  onPrimaryRunAction,
  onDownloadZip,
}: BatchConsoleProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open || (!modal && !focusRequested)) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      if (modal) closeButtonRef.current?.focus();
      else panelRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      previousFocusRef.current?.focus();
    };
  }, [focusRequested, modal, open]);

  const handlePanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (!modal || event.key !== 'Tab') return;
    const focusable = [...(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? [])];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <aside
      className={cn('ui-side-dock', open && 'ui-side-dock-open')}
      aria-label="批量控制抽屉"
      onMouseEnter={onOpen}
      onMouseLeave={onScheduleClose}
      onBlur={(event) => {
        const nextFocus = event.relatedTarget;
        if (!(nextFocus instanceof Node) || !event.currentTarget.contains(nextFocus)) {
          onClose();
        }
      }}
    >
      <button
        type="button"
        className="ui-side-dock-hotline min-h-11 min-w-11 cursor-pointer border border-[var(--xobi-border)] bg-[var(--xobi-surface-raised)] text-[var(--xobi-muted)] transition-colors duration-200 hover:text-[var(--xobi-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--xobi-accent)]"
        aria-controls="batch-console-panel"
        aria-expanded={open || expanded}
        aria-label="打开左侧控制台"
        onClick={onOpen}
        onFocus={onOpen}
        onMouseEnter={onOpen}
        onMouseLeave={onScheduleClose}
      >
        控制
      </button>
      <div
        ref={panelRef}
        id="batch-console-panel"
        className="ui-side-dock-panel ui-batch-console ui-panel flex flex-col overflow-hidden rounded-l-3xl border border-[var(--xobi-border)] bg-[var(--xobi-surface)] backdrop-blur-xl"
        role={modal ? 'dialog' : 'region'}
        aria-modal={modal || undefined}
        aria-label={modal ? '批量控制台弹窗' : '批量控制台'}
        tabIndex={-1}
        onMouseEnter={onOpen}
        onMouseLeave={onScheduleClose}
        onWheelCapture={(event) => event.stopPropagation()}
        onKeyDown={handlePanelKeyDown}
      >
        <div className="ui-batch-console-head border-b border-[var(--xobi-border)] px-4 py-3.5 sm:px-5">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--xobi-faint)]">xobi · 批次</p>
              {isEditingProjectName ? (
                <div className="mt-2 flex gap-2">
                  <input
                    id="project-name-input"
                    name="projectName"
                    aria-label="项目名称"
                    value={draftProjectName}
                    onChange={(event) => onDraftProjectNameChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') onSaveProjectName();
                      if (event.key === 'Escape') onCancelEditingProjectName();
                    }}
                    className="min-h-11 min-w-0 flex-1 rounded-[10px] border border-[var(--xobi-border)] bg-[var(--xobi-canvas)] px-3 py-2 text-sm text-[var(--xobi-text)] outline-none transition-colors focus:border-[var(--xobi-accent)] focus:ring-2 focus:ring-[var(--xobi-accent-soft)]"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={onSaveProjectName}
                    className="xobi-filled-contrast min-h-11 cursor-pointer rounded-[10px] border border-[var(--xobi-accent)] bg-[var(--xobi-accent)] px-4 text-xs font-semibold text-[var(--xobi-accent-contrast)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--xobi-accent)]"
                  >
                    保存
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={onStartEditingProjectName}
                  aria-label={`编辑项目名称：${activeProjectName || autoProjectName}`}
                  className="mt-1 flex min-h-11 max-w-full cursor-pointer items-center gap-2 rounded-[10px] pr-2 text-left text-base font-semibold text-[var(--xobi-text)] transition-colors hover:text-[var(--xobi-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--xobi-accent)]"
                >
                  <span className="truncate">{activeProjectName || autoProjectName}</span>
                  <Pencil className="h-3.5 w-3.5 shrink-0 text-[var(--xobi-muted)]" aria-hidden="true" />
                </button>
              )}
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              className="ui-side-dock-close min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-[10px] border border-[var(--xobi-border)] bg-[var(--xobi-surface-raised)] text-[var(--xobi-muted)] transition-colors duration-200 hover:border-[var(--xobi-border-strong)] hover:text-[var(--xobi-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--xobi-accent)]"
              aria-label="关闭控制台"
              onClick={onClose}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-5 text-[var(--xobi-muted)]">
            <span>
              {uploadedFolderCount > 0
                ? `${uploadedFolderCount} 个文件夹 · ${groupCount} 组 · ${totalImageCount} 张`
                : `${totalImageCount} 张 · ${groupCount} 组`}
            </span>
            <span className="h-1 w-1 rounded-full bg-[var(--xobi-border-strong)]" aria-hidden="true" />
            <span className="ui-batch-console-status inline-flex items-center gap-1.5 font-medium text-[var(--xobi-text)]" data-processing={isProcessingBatch ? 'true' : 'false'}>
              <span className={cn('ui-batch-console-status-dot h-1.5 w-1.5 rounded-full', isProcessingBatch ? 'bg-[var(--xobi-warning)]' : 'bg-[var(--xobi-accent)]')} aria-hidden="true" />
              {batchStateLabel} · {batchElapsedLabel}
            </span>
          </div>
        </div>

        <div className="ui-batch-console-body min-h-0 flex-1 overflow-auto overscroll-contain px-4 sm:px-5">
          <section className="ui-batch-panel-section py-4" aria-labelledby="output-ratio-title">
            <div className="flex items-end justify-between gap-4">
              <div className="min-w-0">
                <p id="output-ratio-title" className="text-sm font-semibold text-[var(--xobi-text)]">输出比例</p>
                <p className="mt-1 truncate text-xs text-[var(--xobi-muted)]">{selectedAspectRatioHint}</p>
              </div>
              <span className="shrink-0 text-xl font-semibold tracking-[-0.03em] tabular-nums text-[var(--xobi-text)]">{selectedAspectRatioLabel}</span>
            </div>

            <div
              className="ui-ratio-stage relative mt-3 flex min-h-[176px] items-center justify-center overflow-hidden rounded-[22px] border border-[var(--xobi-border)] bg-[var(--xobi-surface-soft)] p-5"
              role="img"
              aria-label={`当前输出比例：${selectedAspectRatioLabel}，${selectedAspectRatioHint}`}
            >
              <div
                className="ui-ratio-stage-frame ui-ratio-frame flex items-center justify-center rounded-xl border border-[var(--xobi-border-strong)]"
                style={getAspectRatioPreviewStyle(outputAspectRatio, 190, 134)}
              >
                <span key={`scan-${outputAspectRatio}`} className="ui-ratio-frame-scan" aria-hidden="true" />
                <span key={`corners-${outputAspectRatio}`} className="ui-ratio-frame-corners" aria-hidden="true" />
                <span key={`label-${outputAspectRatio}`} className="ui-ratio-frame-label text-xs font-semibold tabular-nums text-[var(--xobi-text)]">{selectedAspectRatioLabel}</span>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-4 gap-1.5" role="group" aria-label="选择输出比例">
              {ASPECT_RATIO_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  title={option.hint}
                  aria-label={`${option.label}，${option.hint}`}
                  aria-pressed={outputAspectRatio === option.value}
                  data-selected={outputAspectRatio === option.value ? 'true' : 'false'}
                  onClick={() => onSelectOutputAspectRatio(option.value)}
                  disabled={isProcessingBatch}
                  className={cn(
                    'ui-ratio-choice min-h-11 cursor-pointer rounded-[10px] border px-2 text-xs tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--xobi-accent)] disabled:cursor-not-allowed disabled:opacity-50',
                    outputAspectRatio === option.value
                      ? 'xobi-filled-contrast border-[var(--xobi-accent)] bg-[var(--xobi-accent)] text-[var(--xobi-accent-contrast)]'
                      : 'border-transparent bg-[var(--xobi-surface-soft)] text-[var(--xobi-muted)] hover:bg-[var(--xobi-surface-raised)] hover:text-[var(--xobi-text)]',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </section>

          <section className="ui-batch-panel-section py-4" aria-label="批次进度">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold tracking-[-0.04em] tabular-nums text-[var(--xobi-text)]">{progressPercent}%</span>
                <span className="text-xs text-[var(--xobi-muted)]">处理进度</span>
              </div>
              <span className="text-xs tabular-nums text-[var(--xobi-muted)]">{outputReadyCount}/{totalImageCount || 0} 完成</span>
            </div>
            <div
              className="ui-progress-rail ui-progress-with-endpoint relative mt-3 h-1.5 overflow-visible rounded-full bg-[var(--xobi-surface-raised)]"
              role="progressbar"
              aria-label="批次处理进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPercent}
            >
              <div className="ui-progress-value ui-progress-fill ui-progress-transform h-full w-full overflow-hidden rounded-full bg-[var(--xobi-accent)]" style={{ transform: `scaleX(${progressPercent / 100})` }} />
              <span className="ui-progress-endpoint" style={{ left: `${progressPercent}%` }} aria-hidden="true" />
            </div>
            <dl className="ui-batch-stat-grid mt-3 grid grid-cols-4 text-center">
              <div className="px-1.5 py-1">
                <dt className="text-[10px] text-[var(--xobi-faint)]">待处理</dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--xobi-text)]">{pendingCount}</dd>
              </div>
              <div className="px-1.5 py-1">
                <dt className="text-[10px] text-[var(--xobi-faint)]">暂停</dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--xobi-warning)]">{pausedCount}</dd>
              </div>
              <div className="px-1.5 py-1">
                <dt className="text-[10px] text-[var(--xobi-faint)]">完成</dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--xobi-accent)]">{outputReadyCount}</dd>
              </div>
              <div className="px-1.5 py-1">
                <dt className="text-[10px] text-[var(--xobi-faint)]">失败</dt>
                <dd className={cn('mt-0.5 text-sm font-semibold tabular-nums', failedCount > 0 ? 'text-[var(--xobi-danger)]' : 'text-[var(--xobi-muted)]')}>{failedCount}</dd>
              </div>
            </dl>
          </section>
        </div>

        <div className="ui-batch-console-actions border-t border-[var(--xobi-border)] bg-[var(--xobi-surface-raised)] p-3.5">
          <button
            id="batch-start-button"
            type="button"
            onClick={onPrimaryRunAction}
            disabled={pendingCount === 0 && !isProcessingBatch}
            data-state={pendingCount === 0 && !isProcessingBatch ? 'disabled' : isProcessingBatch ? 'pause' : 'start'}
            aria-label={isProcessingBatch ? '暂停当前批次' : `${primaryRunLabel}，待处理 ${pendingCount} 张`}
            className={cn(
              'inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-[10px] border text-sm font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--xobi-accent)] disabled:cursor-not-allowed',
              pendingCount === 0 && !isProcessingBatch
                ? 'border-[var(--xobi-border)] bg-[var(--xobi-surface)] text-[var(--xobi-faint)]'
                : isProcessingBatch
                  ? 'border-[var(--xobi-warning)] bg-[var(--xobi-surface)] text-[var(--xobi-warning)] hover:bg-[var(--xobi-canvas)]'
                  : 'xobi-filled-contrast border-[var(--xobi-accent)] bg-[var(--xobi-accent)] text-[var(--xobi-accent-contrast)] hover:opacity-90',
            )}
          >
            {isProcessingBatch ? <PauseCircle className="h-4 w-4" aria-hidden="true" /> : pausedCount > 0 && startableCount === 0 ? <PlayCircle className="h-4 w-4" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
            {isProcessingBatch ? '暂停' : `${primaryRunLabel} (${pendingCount})`}
          </button>
          <div className="ui-batch-console-secondary-actions mt-1.5 grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={onArchiveCurrentProject}
              disabled={isProcessingBatch}
              title="归档当前项目并开启新项目"
              className="ui-batch-console-secondary-action inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-transparent bg-transparent px-2 text-xs font-medium text-[var(--xobi-muted)] transition-colors duration-200 hover:bg-[var(--xobi-surface-soft)] hover:text-[var(--xobi-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--xobi-accent)] disabled:cursor-not-allowed disabled:opacity-40"
              data-action="archive"
            >
              <Archive className="h-3.5 w-3.5" aria-hidden="true" />
              归档并新建
            </button>
            <button
              type="button"
              onClick={onDownloadZip}
              disabled={outputReadyCount === 0}
              title={`${batchComplete ? '打包下载' : '下载已完成'} ${outputReadyCount}/${totalImageCount || 0}`}
              className={cn(
                'ui-batch-console-secondary-action inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-transparent bg-transparent px-2 text-xs font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--xobi-accent)] disabled:cursor-not-allowed',
                outputReadyCount === 0
                  ? 'text-[var(--xobi-faint)]'
                  : 'text-[var(--xobi-muted)] hover:bg-[var(--xobi-surface-soft)] hover:text-[var(--xobi-accent)]',
              )}
              data-action="download"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              {batchComplete ? '打包下载' : '下载已完成'} ({outputReadyCount})
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
