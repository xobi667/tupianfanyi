'use client';

import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Archive, FolderOpen, Trash2 } from 'lucide-react';
import { type HistoryTaskRecord } from './history-client';

interface HistoryContextMenuProps {
  taskIds: string[];
  x: number;
  y: number;
  tasks: HistoryTaskRecord[];
  onDownload: (taskIds: string[]) => void;
  onSelect: (taskId: string) => void;
  onDelete: (taskIds: string[]) => void;
  onClose: () => void;
}

export function HistoryContextMenu({
  taskIds,
  x,
  y,
  tasks,
  onDownload,
  onSelect,
  onDelete,
  onClose,
}: HistoryContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const menuTasks = tasks.filter((task) => taskIds.includes(task.id));

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return () => previousFocusRef.current?.focus();
  }, []);

  if (menuTasks.length === 0) return null;

  const viewportWidth = typeof window === 'undefined' ? x + 216 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? y + 230 : window.innerHeight;

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
      aria-label="历史任务操作"
      className="ui-context-menu fixed z-[80] w-52 overflow-y-auto rounded-2xl border border-[var(--xobi-border)] bg-[var(--xobi-surface-raised)] p-1 text-xs text-[var(--xobi-muted)] shadow-[var(--xobi-shadow-lg)] backdrop-blur-xl"
      style={{ left: Math.max(8, Math.min(x, viewportWidth - 216)), top: Math.max(8, Math.min(y, viewportHeight - 230)), maxHeight: 'calc(100dvh - 16px)' }}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={handleMenuKeyDown}
    >
      <div className="px-3 py-2 text-[11px] text-[var(--xobi-faint)]">已选 {menuTasks.length} 个项目</div>
      <button role="menuitem" type="button" onClick={() => onDownload(taskIds)} className={menuItemClassName}><Archive className="h-3.5 w-3.5" aria-hidden="true" />下载项目</button>
      {menuTasks.length === 1 && <button role="menuitem" type="button" onClick={() => onSelect(menuTasks[0].id)} className={menuItemClassName}><FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />查看详情</button>}
      <div className="my-1 h-px bg-[var(--xobi-border)]" />
      <button role="menuitem" type="button" onClick={() => onDelete(taskIds)} className={`${menuItemClassName} text-[var(--xobi-danger)] hover:bg-[var(--xobi-danger-soft)] focus-visible:ring-[var(--xobi-danger)]`}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" />删除项目</button>
    </div>
  );
}

const menuItemClassName = 'flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left transition hover:bg-[var(--xobi-surface)] hover:text-[var(--xobi-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--xobi-accent)]';
