'use client';

import { RefreshCw, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface HistoryDialogHeaderProps {
  resourceDir: string;
  totalCount: number;
  doneCount: number;
  failCount: number;
  loading: boolean;
  onRefresh: () => void;
  onClose: () => void;
}

export function HistoryDialogHeader({
  resourceDir,
  totalCount,
  doneCount,
  failCount,
  loading,
  onRefresh,
  onClose,
}: HistoryDialogHeaderProps) {
  return (
    <header className="xobi-archive-hero border-b border-[var(--xobi-border)] bg-[radial-gradient(circle_at_12%_10%,var(--xobi-accent-soft),transparent_34%),linear-gradient(135deg,var(--xobi-surface-raised),var(--xobi-bg))] px-4 py-3 sm:px-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <p className="xobi-kicker text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--xobi-faint)]">xobi archive</p>
          <h2 id="history-title" className="mt-1 text-2xl font-semibold tracking-[-0.035em] text-[var(--xobi-text)] sm:text-[1.7rem]">
            历史工作台
          </h2>
          <p className="mt-1 max-w-4xl truncate text-xs text-[var(--xobi-muted)]" title={resourceDir}>
            本地资源：{resourceDir || '仓库根目录\\资源'}
          </p>
        </div>

        <dl className="grid grid-cols-3 gap-2 text-left text-xs sm:min-w-[340px]">
          <ArchiveStat label="任务" value={totalCount} />
          <ArchiveStat label="完成" value={doneCount} tone="accent" />
          <ArchiveStat label="失败" value={failCount} tone={failCount > 0 ? 'danger' : 'muted'} />
        </dl>

        <div className="flex items-center gap-2 xl:self-start">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            aria-label={loading ? '正在刷新历史' : '刷新历史'}
            aria-busy={loading}
            title="刷新"
            className="xobi-soft-button min-h-11 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} aria-hidden="true" />
            刷新
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭历史"
            className="xobi-icon-button h-11 w-11"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  );
}

function ArchiveStat({
  label,
  value,
  tone = 'muted',
}: {
  label: string;
  value: number;
  tone?: 'muted' | 'accent' | 'danger';
}) {
  return (
    <div
      className={cn(
        'xobi-stat-tile rounded-2xl border border-[var(--xobi-border)] bg-[color-mix(in_srgb,var(--xobi-bg)_70%,transparent)] px-3 py-2.5',
        tone === 'accent' && 'border-[color-mix(in_srgb,var(--xobi-accent)_28%,transparent)] bg-[var(--xobi-accent-soft)]',
        tone === 'danger' && 'border-[color-mix(in_srgb,var(--xobi-danger)_28%,transparent)] bg-[var(--xobi-danger-soft)]',
      )}
    >
      <dt className="text-[11px] text-[var(--xobi-muted)]">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 text-[1.45rem] font-bold leading-none tabular-nums tracking-[-0.04em] text-[var(--xobi-text)]',
          tone === 'accent' && 'text-[var(--xobi-accent)]',
          tone === 'danger' && 'text-[var(--xobi-danger)]',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
