export type GatewayAuthMode =
  | 'x-goog-api-key'
  | 'bearer'
  | 'custom'
  | 'query';

export interface GatewaySettings {
  apiBaseUrl: string;
  requestHeadersText: string;
  requestQueryParamsText: string;
  textModel: string;
  imageModel: string;
  maxParallelTasks: number;
  imageRequestTimeoutMs: number;
  apiKey?: string;
  authMode?: GatewayAuthMode;
  customAuthHeader?: string;
  extraHeadersText?: string;
}

export type ImageRequestTransport =
  | 'openai-images'
  | 'openai-chat-completions'
  | 'generate-content';

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

function parseJsonObjectText(value: string, label: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return {} as Record<string, string>;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`${label} must be a valid JSON object.`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }

  return Object.fromEntries(
    Object.entries(parsed).map(([key, itemValue]) => [key, String(itemValue)]),
  );
}

function stringifyJsonObject(value: Record<string, string>) {
  return Object.keys(value).length === 0 ? '{}' : JSON.stringify(value, null, 2);
}

export function parseRequestHeadersText(requestHeadersText: string) {
  return parseJsonObjectText(requestHeadersText, 'Request headers JSON');
}

export function parseRequestQueryParamsText(requestQueryParamsText: string) {
  return parseJsonObjectText(requestQueryParamsText, 'URL params JSON');
}

export function normalizeModelName(model?: string) {
  return typeof model === 'string' ? model.trim().replace(/^models\//, '') : '';
}

export function isGeminiModel(model?: string) {
  return /^gemini-/i.test(normalizeModelName(model));
}

export function isGptImageModel(model?: string) {
  return /^gpt-image-/i.test(normalizeModelName(model));
}

export function isOfficialGeminiBaseUrl(apiBaseUrl: string) {
  try {
    const parsed = new URL(apiBaseUrl.trim());
    return /(^|\.)generativelanguage\.googleapis\.com$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function buildLegacyRequestConfig(settings: Partial<GatewaySettings>) {
  const headers = settings.extraHeadersText
    ? parseJsonObjectText(settings.extraHeadersText, 'Legacy extra headers JSON')
    : {};
  const query = {} as Record<string, string>;
  const apiKey = settings.apiKey?.trim() ?? '';
  const authMode = settings.authMode;
  const customAuthHeader = settings.customAuthHeader?.trim() ?? '';

  if (!apiKey) {
    return {
      requestHeadersText: stringifyJsonObject(headers),
      requestQueryParamsText: stringifyJsonObject(query),
    };
  }

  if (authMode === 'query') {
    query[customAuthHeader || 'key'] = apiKey;
  } else if (authMode === 'custom') {
    headers[customAuthHeader || 'x-api-key'] = apiKey;
  } else if (authMode === 'x-goog-api-key') {
    headers['x-goog-api-key'] = apiKey;
  } else if (authMode === 'bearer') {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return {
    requestHeadersText: stringifyJsonObject(headers),
    requestQueryParamsText: stringifyJsonObject(query),
  };
}

export function getPrimaryImageRequestTransport(
  model: string,
  settings: Pick<GatewaySettings, 'apiBaseUrl'>,
): ImageRequestTransport {
  if (isGptImageModel(model)) {
    return 'openai-images';
  }

  if (isGeminiModel(model)) {
    return 'generate-content';
  }

  return 'openai-chat-completions';
}

export function shouldUseOpenAiChatFallback(
  model: string,
  settings: Pick<GatewaySettings, 'apiBaseUrl'>,
) {
  return getPrimaryImageRequestTransport(model, settings) === 'openai-chat-completions';
}

export function normalizeSettings(
  settings: Partial<GatewaySettings>,
  _options?: { requireApiKey?: boolean },
) {
  const apiBaseUrl = (settings.apiBaseUrl ?? '').trim().replace(/\/+$/, '');
  const textModel = (settings.textModel ?? '').trim().replace(/^models\//, '');
  const imageModel = (settings.imageModel ?? '').trim().replace(/^models\//, '');
  const maxParallelTasks = Number(settings.maxParallelTasks);
  const imageRequestTimeoutMs = Number(settings.imageRequestTimeoutMs);
  const legacyRequestConfig = buildLegacyRequestConfig(settings);
  const rawRequestHeadersText = settings.requestHeadersText;
  const rawRequestQueryParamsText = settings.requestQueryParamsText;
  const hasExplicitRequestHeaders = typeof rawRequestHeadersText === 'string';
  const hasExplicitRequestQueryParams = typeof rawRequestQueryParamsText === 'string';
  const requestHeadersText = hasExplicitRequestHeaders
    ? rawRequestHeadersText.trim() || '{}'
    : legacyRequestConfig.requestHeadersText;
  const requestQueryParamsText = hasExplicitRequestQueryParams
    ? rawRequestQueryParamsText.trim() || '{}'
    : legacyRequestConfig.requestQueryParamsText;

  if (!apiBaseUrl) {
    throw new Error('API Base URL cannot be empty.');
  }

  if (!/^https?:\/\//i.test(apiBaseUrl)) {
    throw new Error('API Base URL must start with http:// or https://.');
  }

  try {
    const parsedBaseUrl = new URL(apiBaseUrl);

    if (/(^|\.)apifox\.cn$/i.test(parsedBaseUrl.hostname)) {
      throw new Error(
        'API Base URL must be the real API host, not the Apifox docs URL. Use https://yunwu.ai/v1 instead of https://yunwu.apifox.cn.',
      );
    }
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('API Base URL must be a valid URL.');
    }

    throw error;
  }

  if (!textModel) {
    throw new Error('Text model cannot be empty.');
  }

  if (!imageModel) {
    throw new Error('Image model cannot be empty.');
  }

  if (!Number.isFinite(maxParallelTasks) || maxParallelTasks < 1) {
    throw new Error('Max parallel tasks must be a number greater than or equal to 1.');
  }

  if (!Number.isFinite(imageRequestTimeoutMs) || imageRequestTimeoutMs < 1000) {
    throw new Error('Image request timeout must be at least 1000 milliseconds.');
  }

  const normalizedRequestHeaders = parseRequestHeadersText(requestHeadersText);
  const normalizedRequestQueryParams = parseRequestQueryParamsText(requestQueryParamsText);

  return {
    apiBaseUrl,
    requestHeadersText: stringifyJsonObject(normalizedRequestHeaders),
    requestQueryParamsText: stringifyJsonObject(normalizedRequestQueryParams),
    textModel,
    imageModel,
    maxParallelTasks: Math.floor(maxParallelTasks),
    imageRequestTimeoutMs: Math.floor(imageRequestTimeoutMs),
  } satisfies GatewaySettings;
}

export function buildGatewayUrl(
  apiBaseUrl: string,
  model: string,
  settings?: Pick<GatewaySettings, 'requestQueryParamsText'>,
) {
  const cleanModel = model.trim().replace(/^models\//, '');

  if (!cleanModel) {
    throw new Error('Model name cannot be empty.');
  }

  const fullEndpoint =
    apiBaseUrl.includes(':generateContent') || apiBaseUrl.includes('{model}');
  const resolvedUrl = fullEndpoint
    ? apiBaseUrl.replace('{model}', encodeURIComponent(cleanModel))
    : /\/models$/i.test(apiBaseUrl)
      ? `${apiBaseUrl}/${encodeURIComponent(cleanModel)}:generateContent`
      : `${apiBaseUrl}/models/${encodeURIComponent(cleanModel)}:generateContent`;
  const url = new URL(resolvedUrl);

  if (settings?.requestQueryParamsText) {
    const queryParams = parseRequestQueryParamsText(settings.requestQueryParamsText);
    Object.entries(queryParams).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }

  return url.toString();
}

export function buildGatewayHeaders(settings: GatewaySettings) {
  return {
    'Content-Type': 'application/json',
    ...parseRequestHeadersText(settings.requestHeadersText),
  } as Record<string, string>;
}
