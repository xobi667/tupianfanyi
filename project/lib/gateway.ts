export type GatewayAuthMode =
  | 'x-goog-api-key'
  | 'bearer'
  | 'custom'
  | 'query';

export interface GatewaySettings {
  apiKey: string;
  apiBaseUrl: string;
  authMode: GatewayAuthMode;
  customAuthHeader: string;
  extraHeadersText: string;
  textModel: string;
  imageModel: string;
  maxParallelTasks: number;
  imageRequestTimeoutMs: number;
}

export type GatewayPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

export type GatewayContentsMode = 'role_parts' | 'object_parts';

export interface GatewayGenerateRequest {
  settings: GatewaySettings;
  model: string;
  parts: GatewayPart[];
  generationConfig?: Record<string, unknown>;
  contentsMode?: GatewayContentsMode;
  requestKind?: 'text' | 'image';
  debugLabel?: string;
  attemptLabel?: string;
}

export interface GatewayGenerateResponse {
  candidates?: Array<{
    finishReason?: string;
    finishMessage?: string;
    content?: {
      parts?: Array<{
        text?: string;
        inlineData?: {
          mimeType?: string;
          data?: string;
        };
        inline_data?: {
          mime_type?: string;
          data?: string;
        };
      }>;
    };
  }>;
  error?: {
    message?: string;
  };
}

export function parseExtraHeaders(extraHeadersText: string) {
  const trimmed = extraHeadersText.trim();

  if (!trimmed) {
    return {};
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error('额外请求头必须是合法的 JSON 对象。');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('额外请求头必须是 JSON 对象。');
  }

  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [key, String(value)]),
  );
}

export function normalizeSettings(
  settings: GatewaySettings,
  options?: { requireApiKey?: boolean },
) {
  const apiKey = settings.apiKey.trim();
  const apiBaseUrl = settings.apiBaseUrl.trim().replace(/\/+$/, '');
  const customAuthHeader = settings.customAuthHeader.trim();
  const textModel = settings.textModel.trim().replace(/^models\//, '');
  const imageModel = settings.imageModel.trim().replace(/^models\//, '');
  const extraHeadersText = settings.extraHeadersText.trim() || '{}';
  const maxParallelTasks = Number(settings.maxParallelTasks);
  const imageRequestTimeoutMs = Number(settings.imageRequestTimeoutMs);

  if (options?.requireApiKey && !apiKey) {
    throw new Error('请先在右上角设置里填写 API Key。');
  }

  if (!apiBaseUrl) {
    throw new Error('API Base URL 不能为空。');
  }

  if (!/^https?:\/\//i.test(apiBaseUrl)) {
    throw new Error('API Base URL 必须以 http:// 或 https:// 开头。');
  }

  if (!textModel) {
    throw new Error('文本模型不能为空。');
  }

  if (!imageModel) {
    throw new Error('生图模型不能为空。');
  }

  if (!Number.isFinite(maxParallelTasks) || maxParallelTasks < 1) {
    throw new Error('并发任务数必须是大于等于 1 的数字。');
  }

  if (!Number.isFinite(imageRequestTimeoutMs) || imageRequestTimeoutMs < 1000) {
    throw new Error('生图超时时间必须至少为 1000 毫秒。');
  }

  if (
    (settings.authMode === 'custom' || settings.authMode === 'query') &&
    !customAuthHeader
  ) {
    throw new Error('选择自定义 Header 或 Query 参数时，必须填写字段名称。');
  }

  parseExtraHeaders(extraHeadersText);

  return {
    apiKey,
    apiBaseUrl,
    authMode: settings.authMode,
    customAuthHeader,
    extraHeadersText,
    textModel,
    imageModel,
    maxParallelTasks: Math.floor(maxParallelTasks),
    imageRequestTimeoutMs: Math.floor(imageRequestTimeoutMs),
  } satisfies GatewaySettings;
}

export function buildGatewayUrl(
  apiBaseUrl: string,
  model: string,
  settings?: Pick<GatewaySettings, 'authMode' | 'customAuthHeader' | 'apiKey'>,
) {
  const cleanModel = model.trim().replace(/^models\//, '');

  if (!cleanModel) {
    throw new Error('模型名称不能为空。');
  }

  const fullEndpoint =
    apiBaseUrl.includes(':generateContent') || apiBaseUrl.includes('{model}');
  const resolvedUrl = fullEndpoint
    ? apiBaseUrl.replace('{model}', encodeURIComponent(cleanModel))
    : /\/models$/i.test(apiBaseUrl)
      ? `${apiBaseUrl}/${encodeURIComponent(cleanModel)}:generateContent`
      : `${apiBaseUrl}/models/${encodeURIComponent(cleanModel)}:generateContent`;
  const url = new URL(resolvedUrl);

  if (settings?.authMode === 'query') {
    url.searchParams.set(settings.customAuthHeader, settings.apiKey);
  }

  return url.toString();
}

export function buildGatewayHeaders(settings: GatewaySettings) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...parseExtraHeaders(settings.extraHeadersText),
  };

  if (settings.authMode === 'bearer') {
    headers.Authorization = `Bearer ${settings.apiKey}`;
    return headers;
  }

  if (settings.authMode === 'custom') {
    headers[settings.customAuthHeader] = settings.apiKey;
    return headers;
  }

  if (settings.authMode === 'query') {
    return headers;
  }

  headers['x-goog-api-key'] = settings.apiKey;
  return headers;
}
