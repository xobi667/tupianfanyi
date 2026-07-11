'use client';

import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Archive, Download, PauseCircle, PlayCircle, RefreshCw, Sparkles, Trash2 } from 'lucide-react';

export interface TaskContextMenuTask {
  id: string;
  generatedUrl?: string;
  status: string;
  result?: {
    translatedText?: string;
  };
}

interface TaskContextMenuProps<TTask extends TaskContextMenuTask> {
  taskIds: string[];
  x: number;
  y: number;
  tasks: TTask[];
  isProcessingBatch: boolean;
  onReprocess: (taskIds: string[], mode: 'translate' | 'redraw') => void;
  onContinuePaused: (taskIds: string[]) => void;
  onPause: (taskIds: string[]) => void;
  onDownloadResults: (taskIds: string[]) => void;
  onDownloadOriginal: (taskId: string) => void;
  onRemove: (taskIds: string[]) => void;
  onClose: () => void;
}

export function TaskContextMenu<TTask extends TaskContextMenuTask>({
  taskIds,
  x,
  y,
  tasks,
  isProcessingBatch,
  onReprocess,
  onContinuePaused,
  onPause,
  onDownloadResults,
  onDownloadOriginal,
  onRemove,
  onClose,
}: TaskContextMenuProps<TTask>) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const firstItem = menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)');
    firstItem?.focus();
    return () => previousFocusRef.current?.focus();
  }, []);

  if (tasks.length === 0) return null;

  const canRedraw = tasks.some((task) => task.result?.translatedText);
  const hasResult = tasks.some((task) => task.generatedUrl);
  const processableTaskIds = taskIds.filter((id) => tasks.some((task) => task.id === id && ['idle', 'error', 'paused'].includes(task.status)));
  const activeTaskIds = taskIds.filter((id) => tasks.some((task) => task.id === id && ['detecting', 'extracting', 'generating', 'retrying'].includes(task.status)));
  const viewportWidth = typeof window === 'undefined' ? x + 232 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? y + 380 : window.innerHeight;

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    if (items.length === 0) return;
    event.preventDefault();
    const activeIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : event.key === 'ArrowDown'
          ? (activeIndex + 1 + items.length) % items.length
          : (activeIndex - 1 + items.length) % items.length;
    items[nextIndex]?.focus();
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="图片操作"
      className="ui-context-menu fixed z-[60] w-56 overflow-y-auto rounded-2xl border border-[var(--xobi-border)] bg-[var(--xobi-surface-raised)] p-1 text-xs text-[var(--xobi-muted)] shadow-[var(--xobi-shadow-lg)] backdrop-blur-xl"
      style={{ left: Math.max(8, Math.min(x, viewportWidth - 232)), top: Math.max(8, Math.min(y, viewportHeight - 380)), maxHeight: 'calc(100dvh - 16px)' }}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={handleMenuKeyDown}
    >
      <div className="px-3 py-2 text-[11px] text-[var(--xobi-faint)]">已选 {tasks.length} 张 / 结果 {tasks.filter((task) => task.generatedUrl).length} 张</div>
      <button role="menuitem" type="button" onClick={() => onReprocess(taskIds, 'translate')} disabled={isProcessingBatch} className={menuItemClassName}><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />重新翻译</button>
      <button role="menuitem" type="button" onClick={() => onReprocess(taskIds, 'redraw')} disabled={isProcessingBatch || !canRedraw} className={menuItemClassName}><Sparkles className="h-3.5 w-3.5" aria-hidden="true" />仅重绘</button>
      {processableTaskIds.length > 0 && <button role="menuitem" type="button" onClick={() => onContinuePaused(processableTaskIds)} className={`${menuItemClassName} text-[var(--xobi-text)]`}><PlayCircle className="h-3.5 w-3.5" aria-hidden="true" />处理 / 继续</button>}
      {activeTaskIds.length > 0 && <button role="menuitem" type="button" onClick={() => onPause(activeTaskIds)} className={`${menuItemClassName} text-[var(--xobi-warning)] hover:bg-[var(--xobi-warning-soft)]`}><PauseCircle className="h-3.5 w-3.5" aria-hidden="true" />暂停选中</button>}
      <button role="menuitem" type="button" onClick={() => onDownloadResults(taskIds)} disabled={!hasResult} className={menuItemClassName}><Archive className="h-3.5 w-3.5" aria-hidden="true" />下载结果</button>
      {tasks.length === 1 && <button role="menuitem" type="button" onClick={() => onDownloadOriginal(tasks[0].id)} className={menuItemClassName}><Download className="h-3.5 w-3.5" aria-hidden="true" />下载原图</button>}
      <div className="my-1 h-px bg-[var(--xobi-border)]" />
      <button role="menuitem" type="button" onClick={() => onRemove(taskIds)} disabled={isProcessingBatch} className={`${menuItemClassName} text-[var(--xobi-danger)] hover:bg-[var(--xobi-danger-soft)] focus-visible:ring-[var(--xobi-danger)]`}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" />从工作台移除</button>
    </div>
  );
}

const menuItemClassName = 'flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left transition hover:bg-[var(--xobi-surface)] hover:text-[var(--xobi-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--xobi-accent)] disabled:cursor-not-allowed disabled:opacity-40';
