'use client';

import { type FormEvent, type RefObject, useState } from 'react';
import { CheckCircle2, Loader2, PlugZap, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type GatewaySettings } from '@/lib/gateway';
import {
  applyBearerApiKeyToHeaders,
  hasSensitiveRequestConfigValue,
} from './settings';

export type SettingsConnectionStatus = 'idle' | 'testing' | 'success' | 'error';
export type SettingsConnectionTestMode = 'quick' | 'full';

interface SettingsDialogProps {
  dialogRef: RefObject<HTMLFormElement | null>;
  draftSettings: GatewaySettings;
  settingsError: string | null;
  connectionStatus: SettingsConnectionStatus;
  connectionTestMode: SettingsConnectionTestMode;
  connectionMessage: string;
  onClose: () => void;
  onSave: () => void;
  onClear: () => void;
  onTestConnection: (mode: SettingsConnectionTestMode) => void;
  onUpdateDraftSettings: <K extends keyof GatewaySettings>(key: K, value: GatewaySettings[K]) => void;
}

export function SettingsDialog({
  dialogRef,
  draftSettings,
  settingsError,
  connectionStatus,
  connectionTestMode,
  connectionMessage,
  onClose,
  onSave,
  onClear,
  onTestConnection,
  onUpdateDraftSettings,
}: SettingsDialogProps) {
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const hasSavedApiKey =
    hasSensitiveRequestConfigValue(draftSettings.requestHeadersText) ||
    hasSensitiveRequestConfigValue(draftSettings.requestQueryParamsText);
  const directTranslationEnabled = draftSettings.skipOcr ?? true;
  const isTesting = connectionStatus === 'testing';

  const replaceApiKey = (nextValue: string) => {
    const trimmedValue = nextValue.trim();

    if (!trimmedValue) return false;

    onUpdateDraftSettings(
      'requestHeadersText',
      applyBearerApiKeyToHeaders(draftSettings.requestHeadersText, trimmedValue),
    );
    setApiKeyDraft('');
    return true;
  };

  const runAfterApiKeyCommit = (action: () => void) => {
    if (!replaceApiKey(apiKeyDraft)) {
      action();
      return;
    }

    // The settings owner keeps the full draft. Let React commit the key update
    // before save/test reads that draft so a still-focused password field is not lost.
    window.setTimeout(action, 0);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    runAfterApiKeyCommit(onSave);
  };

  const handleConnectionTest = () => {
    runAfterApiKeyCommit(() => onTestConnection('quick'));
  };

  const handleClear = () => {
    setApiKeyDraft('');
    onClear();
  };

  return (
    <div
      className="ui-modal-backdrop fixed inset-0 z-[80] flex items-center justify-center px-3 py-5 backdrop-blur-xl sm:px-4 sm:py-8"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        ref={dialogRef}
        role="dialog"
        onSubmit={handleSubmit}
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
        className="xobi-settings-modal flex max-h-[92vh] w-full max-w-[min(96vw,1080px)] flex-col overflow-hidden rounded-[26px]"
      >
        <div className="xobi-settings-head flex items-start justify-between gap-4 px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--xobi-faint)]">settings</p>
            <h2 id="settings-title" className="mt-1 text-xl font-semibold tracking-[-0.03em] text-[var(--xobi-text)]">
              模型与连接设置
            </h2>
            <p className="mt-1 text-xs leading-5 text-[var(--xobi-muted)]">常用只填 Base URL、秘钥和模型名；其余保持默认即可。</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭设置"
            className="xobi-icon-button h-11 w-11 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--xobi-accent)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="xobi-settings-scroll max-h-[calc(92vh-148px)] space-y-4 overflow-auto px-5 py-5">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
            <section className="ui-panel rounded-3xl border border-[var(--xobi-border)] p-4" aria-labelledby="settings-basic-title">
              <div className="mb-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--xobi-faint)]">Basic</p>
                <p id="settings-basic-title" className="mt-1 text-xs text-[var(--xobi-muted)]">这几个填好就能跑。</p>
              </div>
              <div className="grid gap-4">
                <label className="xobi-field">
                  <span>Base URL</span>
                  <input
                    id="api-base-url-input"
                    name="apiBaseUrl"
                    type="url"
                    inputMode="url"
                    value={draftSettings.apiBaseUrl}
                    onChange={(event) => onUpdateDraftSettings('apiBaseUrl', event.target.value)}
                    placeholder="https://yunwu.ai/v1"
                    autoComplete="url"
                    className="xobi-input !rounded-[15px]"
                  />
                </label>

                <label className="xobi-field">
                  <span>API Key</span>
                  <input
                    id="api-key-input"
                    name="apiKey"
                    type="password"
                    value={apiKeyDraft}
                    onBlur={() => replaceApiKey(apiKeyDraft)}
                    onChange={(event) => setApiKeyDraft(event.target.value)}
                    placeholder={hasSavedApiKey ? '已保存 · 输入新秘钥可替换' : 'sk-...'}
                    autoComplete="off"
                    spellCheck={false}
                    className="xobi-input !rounded-[15px]"
                  />
                  <p>{hasSavedApiKey ? '秘钥已保存在本机。' : '仅保存在当前浏览器。'}</p>
                </label>

                <div className={cn('grid gap-4', !directTranslationEnabled && 'md:grid-cols-2')}>
                  {!directTranslationEnabled && (
                    <label className="xobi-field">
                      <span>文本模型</span>
                      <input
                        id="text-model-input"
                        name="textModel"
                        value={draftSettings.textModel}
                        onChange={(event) => onUpdateDraftSettings('textModel', event.target.value)}
                        placeholder="gemini-3.1-flash-lite-preview"
                        autoComplete="off"
                        spellCheck={false}
                        className="xobi-input !rounded-[15px]"
                      />
                    </label>
                  )}
                  <label className="xobi-field">
                    <span>图片模型</span>
                    <input
                      id="image-model-input"
                      name="imageModel"
                      value={draftSettings.imageModel}
                      onChange={(event) => onUpdateDraftSettings('imageModel', event.target.value)}
                      placeholder="gemini-3.1-flash-image-preview"
                      autoComplete="off"
                      spellCheck={false}
                      className="xobi-input !rounded-[15px]"
                    />
                  </label>
                </div>
              </div>
            </section>

            <section className="ui-panel rounded-3xl border border-[var(--xobi-border)] p-4" aria-labelledby="settings-runtime-title">
              <div className="mb-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--xobi-faint)]">Runtime</p>
                <p id="settings-runtime-title" className="mt-1 text-xs text-[var(--xobi-muted)]">读取与翻译方式。</p>
              </div>
              <div className="xobi-settings-toggle-row flex items-center justify-between gap-4 rounded-2xl px-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--xobi-text)]">直接翻译</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--xobi-muted)]">跳过 OCR，由图片模型直接读取并翻译文字。</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-label="直接翻译"
                  aria-checked={directTranslationEnabled}
                  onClick={() => onUpdateDraftSettings('skipOcr', !directTranslationEnabled)}
                  className={cn(
                    'xobi-settings-switch relative inline-flex h-11 w-14 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--xobi-accent)]',
                    directTranslationEnabled && 'is-active',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'inline-block h-5 w-5 rounded-full transition-transform',
                      directTranslationEnabled ? 'translate-x-7' : 'translate-x-1.5',
                    )}
                  />
                </button>
              </div>
            </section>
          </div>

          {settingsError && (
            <div className="xobi-message xobi-message-error" role="alert">
              {settingsError}
            </div>
          )}

          {connectionStatus !== 'idle' && (
            <div
              role={connectionStatus === 'error' ? 'alert' : 'status'}
              aria-live="polite"
              className={cn(
                'xobi-message',
                connectionStatus === 'success' && 'xobi-message-success',
                connectionStatus === 'error' && 'xobi-message-error',
                connectionStatus === 'testing' && 'xobi-message-success',
              )}
            >
              <div className="flex items-start gap-2">
                {connectionStatus === 'testing' && <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />}
                {connectionStatus === 'success' && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
                {connectionStatus === 'error' && <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
                <span>{connectionMessage}</span>
              </div>
            </div>
          )}
        </div>

        <div className="xobi-settings-actions flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={handleConnectionTest}
            disabled={isTesting}
            className={cn(
              'xobi-soft-button h-11 justify-center px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--xobi-accent)]',
              isTesting && 'cursor-not-allowed opacity-45',
            )}
          >
            {isTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
            {isTesting
              ? connectionTestMode === 'full'
                ? '检查中...'
                : '测试中...'
              : '测试连接'}
          </button>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={handleClear} className="xobi-danger-action h-11 justify-center px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--xobi-danger)]">
              清除本机设置
            </button>
            <button type="button" onClick={onClose} className="xobi-soft-button h-11 justify-center px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--xobi-accent)]">
              取消
            </button>
            <button type="submit" className="xobi-primary-action h-11 justify-center px-5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--xobi-accent)]">
              保存设置
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
