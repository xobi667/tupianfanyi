'use client';

import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Download, X } from 'lucide-react';

/* eslint-disable @next/next/no-img-element -- Full-size local data URL previews should not go through Next image optimization. */

interface TaskPreviewDialogProps {
  src: string;
  title: string;
  kind: 'original' | 'result';
  onClose: () => void;
  onDownload: () => void;
}

export function TaskPreviewDialog({ src, title, kind, onClose, onDownload }: TaskPreviewDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
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
    <div
      className="ui-task-lightbox fixed inset-0 z-[88] flex items-center justify-center bg-[var(--xobi-overlay)] p-2 text-[var(--xobi-text)] backdrop-blur-xl sm:p-4"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-preview-title"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="relative flex h-[min(72dvh,680px)] min-h-[320px] w-[min(80vw,960px)] flex-col overflow-hidden rounded-[22px] border border-[var(--xobi-border)] bg-[var(--xobi-surface-raised)] shadow-[var(--xobi-shadow-lg)] max-sm:h-[calc(100dvh-1rem)] max-sm:min-h-0 max-sm:w-[calc(100vw-1rem)] max-sm:rounded-[18px]"
      >
        <header className="flex min-h-14 items-center gap-3 border-b border-[var(--xobi-border)] bg-[var(--xobi-surface)] px-3 sm:px-4">
          <span className={kind === 'result' ? 'xobi-filled-contrast rounded-full border border-[var(--xobi-accent)] bg-[var(--xobi-accent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--xobi-accent-contrast)]' : 'rounded-full border border-[var(--xobi-border)] bg-[var(--xobi-surface-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--xobi-muted)]'}>
            {kind === 'result' ? '翻译结果' : '原图'}
          </span>
          <h2 id="task-preview-title" className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--xobi-text)]" title={title}>{title}</h2>
          <button type="button" onClick={onDownload} aria-label="下载当前图片" title="下载" className="ui-icon-action !rounded-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--xobi-accent)]">
            <Download className="h-4 w-4" aria-hidden="true" />
          </button>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="关闭大图预览" className="ui-icon-action !rounded-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--xobi-accent)]">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[var(--xobi-canvas)] p-3 sm:p-6 lg:p-8">
          <div className="flex h-full w-full min-h-0 items-center justify-center overflow-hidden rounded-[18px] border border-[var(--xobi-border)] bg-[var(--xobi-surface)] p-3 sm:p-5">
            <img src={src} alt={`${title} ${kind === 'result' ? '翻译结果大图' : '原图大图'}`} className="block max-h-full max-w-full object-contain" />
          </div>
        </div>
      </div>
    </div>
  );
}
