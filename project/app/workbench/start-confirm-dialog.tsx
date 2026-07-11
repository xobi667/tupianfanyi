'use client';

import { type RefObject } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type ImageModelCostRisk } from './settings';
import { LanguageSelect } from './language-select';
import {
  ASPECT_RATIO_OPTIONS,
  getAspectRatioOption,
  getAspectRatioPreviewStyle,
  LANGUAGE_OPTIONS,
  type OutputAspectRatio,
} from './options';

export interface StartConfirmDialogState {
  taskIds?: string[];
  count: number;
  language: string;
  ratio: OutputAspectRatio;
  imageModel: string;
  mode: 'start' | 'continue';
  processMode?: 'translate_and_remove' | 'translate_only' | 'remove_only';
  acknowledgedHighCostModel?: boolean;
  retryTaskIds?: string[];
}

interface StartConfirmDialogProps {
  dialogRef: RefObject<HTMLDivElement | null>;
  state: StartConfirmDialogState;
  imageModelRisk: ImageModelCostRisk | null;
  onCancel: () => void;
  onChange: (state: StartConfirmDialogState) => void;
  onConfirm: () => void;
}

export function StartConfirmDialog({
  dialogRef,
  state,
  imageModelRisk,
  onCancel,
  onChange,
  onConfirm,
}: StartConfirmDialogProps) {
  const highCostConfirmationRequired = Boolean(imageModelRisk);
  const confirmDisabled = highCostConfirmationRequired && !state.acknowledgedHighCostModel;

  return (
    <div
      className="ui-modal-backdrop fixed inset-0 z-[72] flex items-center justify-center px-4 text-[var(--xobi-text)] backdrop-blur-xl"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}
    >
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="start-confirm-title" tabIndex={-1} className="ui-start-confirm-panel flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden border border-[var(--xobi-border)] bg-[var(--xobi-surface-raised)] shadow-[var(--xobi-shadow-lg)]">
        <header className="border-b border-[var(--xobi-border)] px-5 py-4">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--xobi-faint)]">Start Batch</p>
          <h2 id="start-confirm-title" className="mt-1 text-lg font-semibold text-[var(--xobi-text)]">
            {state.mode === 'continue' ? '继续处理' : '开始翻译'} {state.count} 张图片
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--xobi-muted)]">
            {state.mode === 'continue'
              ? '从未完成图片继续；已完成的图片不会重复处理。'
              : '确认前可以直接改语言和输出比例；已完成的图片不会重复处理。'}
          </p>
          {Boolean(state.retryTaskIds?.length) && (
            <p className="mt-2 text-xs text-[var(--xobi-warning)]">
              其中 {state.retryTaskIds?.length} 张失败图片会创建新的生图任务。
            </p>
          )}
        </header>

        <div className="min-h-0 overflow-y-auto">
          <div className="grid gap-4 p-5 md:grid-cols-[220px_1fr]">
            <div className="space-y-2">
              <span id="start-language-label" className="block text-xs font-medium text-[var(--xobi-muted)]">目标语言</span>
              <LanguageSelect
                id="start-target-language-select"
                value={state.language}
                options={LANGUAGE_OPTIONS}
                onChange={(language) => onChange({ ...state, language })}
                variant="full"
              />
            </div>

            <section aria-labelledby="ratio-title" className="ui-start-ratio-section border border-[var(--xobi-border)] bg-[var(--xobi-canvas)] p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p id="ratio-title" className="text-xs font-medium text-[var(--xobi-text)]">输出比例</p>
                  <p className="mt-1 text-[11px] text-[var(--xobi-muted)]">{getAspectRatioOption(state.ratio).hint}</p>
                </div>
                <div className="ui-start-ratio-preview flex h-20 w-24 shrink-0 items-center justify-center rounded-2xl border border-[var(--xobi-border)] bg-[var(--xobi-surface)]">
                  <div className="ui-ratio-frame flex items-center justify-center rounded-lg border border-[var(--xobi-border-strong)]" style={getAspectRatioPreviewStyle(state.ratio)}>
                    <span className="text-[10px] font-semibold tabular-nums text-[var(--xobi-text)]">{getAspectRatioOption(state.ratio).label}</span>
                  </div>
                </div>
              </div>
              <div className="ui-start-ratio-options grid grid-cols-4 gap-1.5" role="group" aria-label="输出比例选项">
                {ASPECT_RATIO_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    title={option.hint}
                    aria-label={`${option.label}，${option.hint}`}
                    aria-pressed={state.ratio === option.value}
                    data-selected={state.ratio === option.value ? 'true' : 'false'}
                    onClick={() => onChange({ ...state, ratio: option.value })}
                    className={cn(
                      'ui-start-ratio-choice min-h-11 rounded-xl border px-2 text-xs tabular-nums transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--xobi-accent)]',
                      state.ratio === option.value
                        ? 'xobi-filled-contrast border-[var(--xobi-accent)] bg-[var(--xobi-accent)] font-semibold text-[var(--xobi-accent-contrast)]'
                        : 'border-transparent bg-[var(--xobi-surface-soft)] text-[var(--xobi-muted)] hover:bg-[var(--xobi-surface-raised)] hover:text-[var(--xobi-text)]',
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </section>
          </div>

          {imageModelRisk && (
            <div className="px-5 pb-5">
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-[var(--xobi-danger)] bg-[var(--xobi-danger-soft)] px-3 py-2.5 text-xs leading-5 text-[var(--xobi-danger)]">
                <input
                  type="checkbox"
                  checked={Boolean(state.acknowledgedHighCostModel)}
                  onChange={(event) => onChange({ ...state, acknowledgedHighCostModel: event.target.checked })}
                  className="peer sr-only"
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--xobi-danger)] peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[var(--xobi-surface-raised)]',
                    state.acknowledgedHighCostModel
                      ? 'border-[var(--xobi-danger)] bg-[var(--xobi-danger)] text-[var(--xobi-danger-contrast)]'
                      : 'border-[color-mix(in_srgb,var(--xobi-danger)_55%,transparent)] bg-[var(--xobi-surface)] text-transparent',
                  )}
                >
                  <Check className="h-3.5 w-3.5" />
                </span>
                <span>当前模型可能产生较高费用，我确认继续。</span>
              </label>
            </div>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-[var(--xobi-border)] bg-[var(--xobi-surface)] px-5 py-4">
          <button type="button" onClick={onCancel} className="min-h-11 rounded-xl border border-[var(--xobi-border)] px-4 text-sm text-[var(--xobi-muted)] transition hover:bg-[var(--xobi-surface-soft)] hover:text-[var(--xobi-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--xobi-accent)]">取消</button>
          <button id="start-confirm-primary-button" type="button" onClick={onConfirm} disabled={confirmDisabled} data-state={confirmDisabled ? 'disabled' : 'ready'} className={cn('min-h-11 rounded-xl border px-5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--xobi-accent)]', confirmDisabled && 'cursor-not-allowed')}>{state.mode === 'continue' ? '继续处理' : '开始翻译'}</button>
        </footer>
      </div>
    </div>
  );
}
