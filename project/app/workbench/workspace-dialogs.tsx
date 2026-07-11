'use client';

import { type RefObject } from 'react';
import { Archive, UploadCloud } from 'lucide-react';

interface ReturnHomeDialogProps {
  dialogRef: RefObject<HTMLDivElement | null>;
  hasWorkspace: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ReturnHomeDialog({
  dialogRef,
  hasWorkspace,
  onCancel,
  onConfirm,
}: ReturnHomeDialogProps) {
  return (
    <div
      className="ui-modal-backdrop fixed inset-0 z-[72] flex items-center justify-center px-4 text-[var(--xobi-text)] backdrop-blur-xl"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}
    >
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="return-home-title" tabIndex={-1} className="w-full max-w-md overflow-hidden rounded-[26px] border border-[var(--xobi-border)] bg-[var(--xobi-surface-raised)] shadow-[var(--xobi-shadow-lg)]">
        <div className="px-5 py-5">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--xobi-faint)]">Return Home</p>
          <h2 id="return-home-title" className="mt-1 text-lg font-semibold text-[var(--xobi-text)]">返回上传主页？</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--xobi-muted)]">{hasWorkspace ? '当前工作台显示会清空，历史记录仍会保留。' : '会回到上传图片的首页。'}</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--xobi-border)] bg-[var(--xobi-surface)] px-5 py-4">
          <button type="button" onClick={onCancel} className="min-h-11 rounded-xl border border-[var(--xobi-border)] px-4 text-sm text-[var(--xobi-muted)] transition hover:bg-[var(--xobi-surface-soft)] hover:text-[var(--xobi-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--xobi-accent)]">取消</button>
          <button type="button" onClick={onConfirm} className="xobi-filled-contrast min-h-11 rounded-xl bg-[var(--xobi-accent)] px-5 text-sm font-semibold text-[var(--xobi-accent-contrast)] transition hover:bg-[var(--xobi-accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--xobi-accent)]">返回主页</button>
        </div>
      </div>
    </div>
  );
}

interface PendingUploadDialogProps {
  dialogRef: RefObject<HTMLDivElement | null>;
  currentCount: number;
  incomingCount: number;
  onChoose: (mode: 'append' | 'new') => void;
  onCancel: () => void;
}

export function PendingUploadDialog({
  dialogRef,
  currentCount,
  incomingCount,
  onChoose,
  onCancel,
}: PendingUploadDialogProps) {
  return (
    <div className="ui-modal-backdrop fixed inset-0 z-[70] flex items-center justify-center px-4 text-[var(--xobi-text)] backdrop-blur-xl">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="pending-upload-title" tabIndex={-1} className="w-full max-w-lg overflow-hidden rounded-[26px] border border-[var(--xobi-border)] bg-[var(--xobi-surface-raised)] shadow-[var(--xobi-shadow-lg)]">
        <div className="border-b border-[var(--xobi-border)] px-5 py-4">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--xobi-faint)]">New Upload</p>
          <h2 id="pending-upload-title" className="mt-1 text-lg font-semibold text-[var(--xobi-text)]">这批图片要放到哪里？</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--xobi-muted)]">当前工作台已有 {currentCount} 张图片；这次选择了 {incomingCount} 个文件。你可以追加到当前项目，也可以先归档当前项目再开启新项目。</p>
        </div>
        <div className="grid gap-3 p-5 sm:grid-cols-2">
          <button type="button" onClick={() => onChoose('append')} className="min-h-32 rounded-2xl border border-[var(--xobi-border)] bg-[var(--xobi-surface)] p-4 text-left transition hover:border-[var(--xobi-border-strong)] hover:bg-[var(--xobi-surface-raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--xobi-accent)]">
            <UploadCloud className="mb-3 h-5 w-5 text-[var(--xobi-accent)]" aria-hidden="true" />
            <p className="font-semibold text-[var(--xobi-text)]">追加当前项目</p>
            <p className="mt-2 text-xs leading-5 text-[var(--xobi-muted)]">适合补传漏掉的图片，继续写入当前历史记录。</p>
          </button>
          <button type="button" onClick={() => onChoose('new')} className="min-h-32 rounded-2xl border border-[var(--xobi-border)] bg-[var(--xobi-surface)] p-4 text-left transition hover:border-[var(--xobi-border-strong)] hover:bg-[var(--xobi-surface-raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--xobi-accent)]">
            <Archive className="mb-3 h-5 w-5 text-[var(--xobi-muted)]" aria-hidden="true" />
            <p className="font-semibold text-[var(--xobi-text)]">归档当前并新建</p>
            <p className="mt-2 text-xs leading-5 text-[var(--xobi-muted)]">当前项目完整保存到历史，然后开启一个干净的新项目。</p>
          </button>
        </div>
        <div className="flex justify-end border-t border-[var(--xobi-border)] bg-[var(--xobi-surface)] px-5 py-4">
          <button type="button" onClick={onCancel} className="min-h-11 rounded-xl border border-[var(--xobi-border)] px-4 text-sm text-[var(--xobi-muted)] transition hover:bg-[var(--xobi-surface-soft)] hover:text-[var(--xobi-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--xobi-accent)]">取消</button>
        </div>
      </div>
    </div>
  );
}
