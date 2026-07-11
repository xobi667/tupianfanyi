'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

type LanguageOption = {
  value: string;
  label: string;
};

type LanguageSelectProps = {
  id?: string;
  name?: string;
  value: string;
  options: readonly LanguageOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  variant?: 'compact' | 'full';
};

type MenuGeometry = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

export function LanguageSelect({
  id = 'target-language-select',
  name = 'targetLanguage',
  value,
  options,
  onChange,
  disabled = false,
  variant = 'compact',
}: LanguageSelectProps) {
  const reactId = useId().replace(/:/g, '');
  const listboxId = `${id}-${reactId}-listbox`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menuGeometry, setMenuGeometry] = useState<MenuGeometry | null>(null);
  const selectedIndex = useMemo(
    () => Math.max(0, options.findIndex((option) => option.value === value)),
    [options, value],
  );
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const selectedOption = options[selectedIndex] ?? options[0];

  const updateMenuGeometry = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;

    const rect = root.getBoundingClientRect();
    const viewportPadding = 8;
    const desiredWidth = Math.max(172, rect.width);
    const width = Math.min(desiredWidth, window.innerWidth - viewportPadding * 2);
    const desiredHeight = Math.min(options.length * 36 + 12, 336);
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding * 2;
    const spaceAbove = rect.top - viewportPadding * 2;
    const openAbove = spaceBelow < Math.min(desiredHeight, 200) && spaceAbove > spaceBelow;
    const availableHeight = Math.max(132, openAbove ? spaceAbove : spaceBelow);
    const maxHeight = Math.min(desiredHeight, availableHeight);
    const left = Math.min(
      Math.max(viewportPadding, variant === 'compact' ? rect.right - width : rect.left),
      window.innerWidth - width - viewportPadding,
    );
    const top = openAbove
      ? Math.max(viewportPadding, rect.top - maxHeight - 8)
      : Math.min(rect.bottom + 8, window.innerHeight - maxHeight - viewportPadding);

    setMenuGeometry({ top, left, width, maxHeight });
  }, [options.length, variant]);

  const closeMenu = (restoreFocus = false) => {
    setOpen(false);
    setActiveIndex(selectedIndex);
    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  };

  const openMenu = (nextIndex = selectedIndex) => {
    if (disabled || options.length === 0) return;
    setActiveIndex(Math.min(Math.max(nextIndex, 0), options.length - 1));
    setOpen(true);
  };

  const chooseOption = (index: number) => {
    const option = options[index];
    if (!option) return;
    if (option.value !== value) {
      onChange(option.value);
    }
    setOpen(false);
    setActiveIndex(index);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;

    const handleOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        closeMenu();
      }
    };

    document.addEventListener('pointerdown', handleOutsidePointer);
    return () => document.removeEventListener('pointerdown', handleOutsidePointer);
  }, [open, selectedIndex]);

  useEffect(() => {
    if (disabled && open) {
      setOpen(false);
    }
  }, [disabled, open]);

  useLayoutEffect(() => {
    if (!open) {
      setMenuGeometry(null);
      return;
    }

    updateMenuGeometry();
    window.addEventListener('resize', updateMenuGeometry);
    window.addEventListener('scroll', updateMenuGeometry, true);
    return () => {
      window.removeEventListener('resize', updateMenuGeometry);
      window.removeEventListener('scroll', updateMenuGeometry, true);
    };
  }, [open, updateMenuGeometry]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(`${listboxId}-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, listboxId, open]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (open) {
          chooseOption(activeIndex);
        } else {
          openMenu();
        }
        break;
      case 'ArrowDown':
        event.preventDefault();
        if (!open) {
          openMenu(selectedIndex);
        } else {
          setActiveIndex((current) => Math.min(current + 1, options.length - 1));
        }
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!open) {
          openMenu(selectedIndex);
        } else {
          setActiveIndex((current) => Math.max(current - 1, 0));
        }
        break;
      case 'Home':
        if (open) {
          event.preventDefault();
          setActiveIndex(0);
        }
        break;
      case 'End':
        if (open) {
          event.preventDefault();
          setActiveIndex(Math.max(0, options.length - 1));
        }
        break;
      case 'Escape':
        if (open) {
          event.preventDefault();
          closeMenu(true);
        }
        break;
      case 'Tab':
        if (open) closeMenu();
        break;
      default:
        break;
    }
  };

  return (
    <div
      ref={rootRef}
      data-disabled={disabled ? 'true' : 'false'}
      className={cn(
        'relative flex items-center rounded-[10px] border border-[var(--xobi-control-border)] transition-[border-color,background-color] duration-150 focus-within:border-[var(--xobi-violet)] focus-within:bg-[var(--xobi-surface-raised)] data-[disabled=true]:border-[var(--xobi-border)]',
        variant === 'compact'
          ? 'min-h-10 min-w-[138px] bg-[var(--xobi-surface-soft)]'
          : 'min-h-11 w-full bg-[var(--xobi-surface)]',
      )}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) closeMenu();
      }}
    >
      {variant === 'compact' && (
        <span className="pointer-events-none px-2 text-[11px] leading-none text-[var(--xobi-faint)]" aria-hidden="true">
          语言
        </span>
      )}
      <input type="hidden" name={name} value={value} />
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        disabled={disabled}
        aria-label={`目标语言，当前为${selectedOption?.label ?? value}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open ? `${listboxId}-option-${activeIndex}` : undefined}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={handleKeyDown}
        className={cn(
          'flex min-w-0 items-center justify-between gap-2 rounded-[9px] text-left text-sm font-medium text-[var(--xobi-text)] outline-none transition-colors duration-150 hover:bg-[var(--xobi-surface-soft)] focus-visible:bg-[var(--xobi-violet-soft)] focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-[var(--xobi-surface-soft)] disabled:text-[var(--xobi-faint)]',
          variant === 'compact' ? 'min-h-10 flex-1 px-2.5' : 'min-h-11 w-full px-3',
        )}
      >
        <span className="truncate">{selectedOption?.label ?? value}</span>
        <ChevronDown
          className={cn('h-3.5 w-3.5 shrink-0 text-[var(--xobi-faint)] transition-transform duration-150', open && 'rotate-180 text-[var(--xobi-violet)]')}
          aria-hidden="true"
        />
      </button>

      {open && menuGeometry && createPortal(
        <div
          ref={menuRef}
          id={listboxId}
          role="listbox"
          aria-label="选择目标语言"
          className="fixed z-[110] overflow-y-auto rounded-[14px] border border-[var(--xobi-border-strong)] bg-[var(--xobi-surface-raised)] p-1.5 text-[var(--xobi-text)] shadow-[0_14px_36px_rgba(0,0,0,0.2)]"
          style={menuGeometry}
        >
          {options.map((option, index) => {
            const selected = option.value === value;
            const active = index === activeIndex;
            return (
              <div
                key={option.value}
                id={`${listboxId}-option-${index}`}
                role="option"
                aria-selected={selected}
                onPointerMove={() => setActiveIndex(index)}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => chooseOption(index)}
                className={cn(
                  'flex min-h-9 cursor-pointer select-none items-center justify-between gap-3 rounded-[9px] border-l-2 border-l-transparent px-3 text-sm transition-[background-color,border-color,color] duration-100',
                  selected
                    ? 'border-l-[var(--xobi-violet)] bg-[var(--xobi-violet-soft)] text-[var(--xobi-text)]'
                    : active
                      ? 'border-l-[var(--xobi-violet)] bg-[var(--xobi-violet-soft)] text-[var(--xobi-text)]'
                      : 'text-[var(--xobi-muted)]',
                )}
              >
                <span className="font-medium">{option.label}</span>
                <Check className={cn('h-4 w-4 text-[var(--xobi-violet)]', !selected && 'invisible')} aria-hidden="true" />
              </div>
            );
          })}
        </div>
      , document.body)}
    </div>
  );
}
