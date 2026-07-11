import type { GatewayAuthMode, GatewaySettings } from '@/lib/gateway';

export const SETTINGS_STORAGE_KEY = 'image-translator-settings-v2';
export const SETTINGS_SCHEMA_STORAGE_KEY = 'image-translator-settings-schema';
export const CURRENT_SETTINGS_SCHEMA_VERSION = '3';
export const DEFAULT_IMAGE_REQUEST_TIMEOUT_MS = 300000;
export const MAX_PARALLEL_IMAGE_REQUESTS = 2;
export const DEFAULT_GEMINI_TEXT_MODEL = 'gemini-3.1-flash-lite-preview';
export const DEFAULT_GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-image-preview';
export const DEFAULT_API_BASE_URL = 'https://yunwu.ai/v1';

const GPT_IMAGE_MIN_TIMEOUT_MS = 360000;
const LEGACY_DEFAULT_IMAGE_REQUEST_TIMEOUT_VALUES = new Set([15000, 60000, 120000, 180000]);
const LEGACY_DEFAULT_GEMINI_TEXT_MODELS = new Set(['gemini-3-flash-preview']);
const LEGACY_DEFAULT_GEMINI_IMAGE_MODELS = new Set(['gemini-3-pro-image-preview']);
const HIGH_COST_IMAGE_MODEL_TOKENS = new Set(['pro', 'ultra', 'max', 'premium', 'expensive']);

export interface ImageModelCostRisk {
  model: string;
  title: string;
  badge: string;
  message: string;
}

function normalizeImageModelName(model?: string) {
  return (model ?? '').trim().toLowerCase().replace(/^models\//, '');
}

export function isHighCostImageModel(model?: string) {
  const normalizedModel = normalizeImageModelName(model);

  if (!normalizedModel) {
    return false;
  }

  if (normalizedModel === 'gemini-3-pro-image-preview') {
    return true;
  }

  return normalizedModel
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .some((token) => HIGH_COST_IMAGE_MODEL_TOKENS.has(token));
}

export function getImageModelCostRisk(model?: string): ImageModelCostRisk | null {
  const trimmedModel = (model ?? '').trim();

  if (!isHighCostImageModel(trimmedModel)) {
    return null;
  }

  return {
    model: trimmedModel,
    title: '高费用图片模型',
    badge: '高费用风险',
    message: '当前生图模型可能是 Pro/高价模型；完整测试、继续处理或批量翻译前必须再次确认。',
  };
}

export const DEFAULT_SETTINGS: GatewaySettings = {
  apiBaseUrl: DEFAULT_API_BASE_URL,
  requestHeadersText: '{}',
  requestQueryParamsText: '{}',
  textModel: DEFAULT_GEMINI_TEXT_MODEL,
  imageModel: DEFAULT_GEMINI_IMAGE_MODEL,
  maxParallelTasks: 3,
  imageRequestTimeoutMs: DEFAULT_IMAGE_REQUEST_TIMEOUT_MS,
  skipOcr: true,
};

function stringifyJsonObject(value: Record<string, string>) {
  return Object.keys(value).length === 0 ? '{}' : JSON.stringify(value, null, 2);
}

const SENSITIVE_REQUEST_CONFIG_KEY_PATTERN = /^(authorization|x-goog-api-key|x-api-key|api-key|api_key|key|token|access_token|access-token)$/i;
const SENSITIVE_REQUEST_CONFIG_VALUE_MASK = '••••••••••••••••';

function isSensitiveRequestConfigKey(key: string) {
  return SENSITIVE_REQUEST_CONFIG_KEY_PATTERN.test(key.trim());
}

function redactKnownSecretPatterns(value: string) {
  return value
    .replace(/(Bearer\s+)[^\s"',}]+/gi, `$1${SENSITIVE_REQUEST_CONFIG_VALUE_MASK}`)
    .replace(/((?:authorization|x-goog-api-key|x-api-key|api-key|api_key|key|token|access_token|access-token)\s*[:=]\s*)([^,\n\r;]+)/gi, `$1${SENSITIVE_REQUEST_CONFIG_VALUE_MASK}`);
}

function maskSensitiveRequestConfigValue(key: string, value: unknown) {
  const textValue = String(value);

  if (!isSensitiveRequestConfigKey(key) || !textValue.trim()) {
    return textValue;
  }

  const authPrefix = textValue.match(/^(Bearer|Basic)\s+/i)?.[0] ?? '';
  return authPrefix ? `${authPrefix}${SENSITIVE_REQUEST_CONFIG_VALUE_MASK}` : SENSITIVE_REQUEST_CONFIG_VALUE_MASK;
}

function parseRequestConfigObject(requestConfigText?: string) {
  const trimmed = requestConfigText?.trim();

  if (!trimmed) {
    return {} as Record<string, unknown>;
  }

  const parsed = JSON.parse(trimmed) as unknown;

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  return parsed as Record<string, unknown>;
}

export function hasSensitiveRequestConfigValue(requestConfigText?: string) {
  try {
    const parsed = parseRequestConfigObject(requestConfigText);

    if (!parsed) {
      return Boolean(requestConfigText?.trim());
    }

    return Object.entries(parsed).some(
      ([key, value]) => isSensitiveRequestConfigKey(key) && String(value).trim(),
    );
  } catch {
    return Boolean(requestConfigText?.trim());
  }
}

export function maskSensitiveRequestConfigText(requestConfigText?: string) {
  const trimmed = requestConfigText?.trim();

  if (!trimmed) {
    return '{}';
  }

  try {
    const parsed = parseRequestConfigObject(trimmed);

    if (!parsed) {
      return redactKnownSecretPatterns(trimmed);
    }

    const masked = Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [
        key,
        maskSensitiveRequestConfigValue(key, value),
      ]),
    );

    return stringifyJsonObject(masked);
  } catch {
    return redactKnownSecretPatterns(trimmed);
  }
}

export function stripApiBaseUrlForDisplay(apiBaseUrl?: string) {
  const trimmed = apiBaseUrl?.trim() ?? '';

  if (!trimmed) {
    return '';
  }

  try {
    const url = new URL(trimmed);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return trimmed
      .replace(/\/\/[^/@\s]+@/, '//')
      .split(/[?#]/)[0]
      .trim();
  }
}

function buildLegacyRequestConfig(settings: Partial<GatewaySettings>) {
  const headers: Record<string, string> = {};
  const query: Record<string, string> = {};
  const apiKey = settings.apiKey?.trim() ?? '';
  const authMode = settings.authMode as GatewayAuthMode | undefined;
  const customAuthHeader = settings.customAuthHeader?.trim() ?? '';

  if (!apiKey) {
    return {
      requestHeadersText: '{}',
      requestQueryParamsText: '{}',
    };
  }

  if (authMode === 'query') {
    query[customAuthHeader || 'key'] = apiKey;
  } else if (authMode === 'custom') {
    headers[customAuthHeader || 'x-api-key'] = apiKey;
  } else if (authMode === 'x-goog-api-key') {
    headers['x-goog-api-key'] = apiKey;
  } else {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return {
    requestHeadersText: stringifyJsonObject(headers),
    requestQueryParamsText: stringifyJsonObject(query),
  };
}

export function applyModelRecommendedSettings<T extends Partial<GatewaySettings>>(settings: T) {
  const normalizedTextModel = (settings.textModel ?? '').trim().toLowerCase();
  const normalizedImageModel = normalizeImageModelName(settings.imageModel);
  const nextSettings: Partial<GatewaySettings> = { ...settings };

  if (LEGACY_DEFAULT_GEMINI_TEXT_MODELS.has(normalizedTextModel)) {
    nextSettings.textModel = DEFAULT_GEMINI_TEXT_MODEL;
  }

  if (
    (nextSettings.imageModel ?? '').trim().toLowerCase().includes('flash-lite') &&
    !(nextSettings.imageModel ?? '').trim().toLowerCase().includes('image')
  ) {
    nextSettings.imageModel = DEFAULT_GEMINI_IMAGE_MODEL;
  }

  if ((nextSettings.imageModel ?? '').trim().toLowerCase().startsWith('gpt-image-')) {
    nextSettings.imageRequestTimeoutMs = Math.max(
      settings.imageRequestTimeoutMs ?? DEFAULT_IMAGE_REQUEST_TIMEOUT_MS,
      GPT_IMAGE_MIN_TIMEOUT_MS,
    );
  }

  return nextSettings as T;
}

export function getPersistableSettings(settings: GatewaySettings): GatewaySettings {
  return {
    apiBaseUrl: settings.apiBaseUrl,
    requestHeadersText: settings.requestHeadersText,
    requestQueryParamsText: settings.requestQueryParamsText,
    textModel: settings.textModel,
    imageModel: settings.imageModel,
    maxParallelTasks: settings.maxParallelTasks,
    imageRequestTimeoutMs: settings.imageRequestTimeoutMs,
    skipOcr: settings.skipOcr ?? true,
  };
}

export function migrateStoredSettings(stored: Partial<GatewaySettings>) {
  const legacyRequestConfig = buildLegacyRequestConfig(stored);
  const storedMaxParallelTasks = Number(stored.maxParallelTasks);
  const storedImageRequestTimeoutMs = Number(stored.imageRequestTimeoutMs);
  const migratedTimeout =
    LEGACY_DEFAULT_IMAGE_REQUEST_TIMEOUT_VALUES.has(
      storedImageRequestTimeoutMs,
    )
      ? DEFAULT_IMAGE_REQUEST_TIMEOUT_MS
      : Number.isFinite(storedImageRequestTimeoutMs)
        ? storedImageRequestTimeoutMs
        : DEFAULT_IMAGE_REQUEST_TIMEOUT_MS;

  return {
    apiBaseUrl: typeof stored.apiBaseUrl === 'string' && stored.apiBaseUrl.trim()
      ? stored.apiBaseUrl
      : DEFAULT_API_BASE_URL,
    textModel: typeof stored.textModel === 'string' && stored.textModel.trim()
      ? LEGACY_DEFAULT_GEMINI_TEXT_MODELS.has(stored.textModel.trim().toLowerCase())
        ? DEFAULT_GEMINI_TEXT_MODEL
        : stored.textModel
      : DEFAULT_GEMINI_TEXT_MODEL,
    imageModel: typeof stored.imageModel === 'string' && stored.imageModel.trim()
      ? LEGACY_DEFAULT_GEMINI_IMAGE_MODELS.has(stored.imageModel.trim().toLowerCase())
        ? DEFAULT_GEMINI_IMAGE_MODEL
        : stored.imageModel
      : DEFAULT_GEMINI_IMAGE_MODEL,
    maxParallelTasks: Number.isFinite(storedMaxParallelTasks)
      ? Math.min(4, Math.max(1, Math.floor(storedMaxParallelTasks)))
      : DEFAULT_SETTINGS.maxParallelTasks,
    imageRequestTimeoutMs: migratedTimeout,
    requestHeadersText:
      typeof stored.requestHeadersText === 'string'
        ? stored.requestHeadersText
        : legacyRequestConfig.requestHeadersText,
    requestQueryParamsText:
      typeof stored.requestQueryParamsText === 'string'
        ? stored.requestQueryParamsText
        : legacyRequestConfig.requestQueryParamsText,
    skipOcr: stored.skipOcr ?? true,
  } satisfies GatewaySettings;
}

export function getBearerApiKeyFromHeaders(requestHeadersText?: string) {
  if (!requestHeadersText) {
    return '';
  }

  try {
    const headers = JSON.parse(requestHeadersText) as Record<string, unknown>;
    const authorization = Object.entries(headers).find(
      ([key]) => key.toLowerCase() === 'authorization',
    )?.[1];

    if (typeof authorization !== 'string') {
      return '';
    }

    return authorization.replace(/^Bearer\s+/i, '').trim();
  } catch {
    return '';
  }
}

export function applyBearerApiKeyToHeaders(requestHeadersText: string, apiKey: string) {
  let headers: Record<string, string> = {};

  try {
    const parsed = JSON.parse(requestHeadersText || '{}') as Record<string, unknown>;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      headers = Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [key, String(value)]),
      );
    }
  } catch {
    headers = {};
  }

  const trimmedApiKey = apiKey.trim();
  Object.keys(headers).forEach((key) => {
    if (key.toLowerCase() === 'authorization') delete headers[key];
  });

  if (trimmedApiKey) {
    headers.Authorization = `Bearer ${trimmedApiKey}`;
  }

  return Object.keys(headers).length === 0 ? '{}' : JSON.stringify(headers, null, 2);
}
