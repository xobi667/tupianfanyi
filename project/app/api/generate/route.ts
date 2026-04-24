import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { NextResponse } from 'next/server';
import {
  buildGatewayHeaders,
  buildGatewayUrl,
  isGptImageModel,
  parseRequestHeadersText,
  parseRequestQueryParamsText,
  normalizeSettings,
  shouldUseOpenAiChatFallback,
  type GatewayGenerateRequest,
  type GatewayGenerateResponse,
  type GatewaySettings,
} from '@/lib/gateway';

export const runtime = 'nodejs';

function errorResponse(message: string, status = 400) {
  return NextResponse.json(
    {
      error: {
        message,
      },
    },
    { status },
  );
}

function createLogPrefix(requestId: string) {
  return `[网关请求 ${requestId}]`;
}

function toChineseDebugLabel(label?: string) {
  if (!label) return '未命名请求';
  if (label === 'test-text-quick') return '快速测试 / 文本模型';
  if (label === 'test-text-full') return '完整测试 / 文本模型';
  if (label === 'test-image-full') return '完整测试 / 生图模型';
  if (label === 'ocr-translate_and_remove') return '批量处理 / OCR 识别翻译 / 重绘翻译+去水印';
  if (label === 'ocr-translate_only') return '批量处理 / OCR 识别翻译 / 翻译重绘';
  if (label === 'image-translate_and_remove') return '批量处理 / 生图重绘 / 重绘翻译+去水印';
  if (label === 'image-translate_only') return '批量处理 / 生图重绘 / 翻译重绘';
  if (label === 'image-remove_only') return '批量处理 / 生图处理 / 仅去水印';
  return label;
}

function summarizeRequestConfig(settings: Pick<GatewaySettings, 'requestHeadersText' | 'requestQueryParamsText'>) {
  const headerKeys = Object.keys(parseRequestHeadersText(settings.requestHeadersText));
  const queryKeys = Object.keys(parseRequestQueryParamsText(settings.requestQueryParamsText));

  return {
    headerKeys,
    queryKeys,
  };
}

function toChineseContentsMode(contentsMode?: GatewayGenerateRequest['contentsMode']) {
  return contentsMode === 'object_parts'
    ? '对象格式 contents[].parts'
    : '角色格式 contents[].role + parts';
}

function toChineseFinishReasons(finishReasons: string[]) {
  if (finishReasons.length === 0) {
    return '无';
  }

  return finishReasons
    .map((reason) => {
      if (reason === 'STOP') return '正常结束';
      if (reason === 'MAX_TOKENS') return '达到最大输出长度';
      if (reason === 'SAFETY') return '触发安全限制';
      if (reason === 'MALFORMED_FUNCTION_CALL') return '函数调用格式错误';
      return reason;
    })
    .join('、');
}

function summarizeParts(parts: GatewayGenerateRequest['parts']) {
  let textParts = 0;
  let imageParts = 0;

  for (const part of parts) {
    if ('text' in part) {
      textParts += 1;
    } else if ('inlineData' in part) {
      imageParts += 1;
    }
  }

  return { textParts, imageParts };
}

function isImageRequest(body: Partial<GatewayGenerateRequest>) {
  return body.requestKind === 'image';
}

function shouldUseOpenAiImagesPath(body: Partial<GatewayGenerateRequest>) {
  return isImageRequest(body) && isGptImageModel(body.model);
}

function shouldUseOpenAiImagePath(
  body: Partial<GatewayGenerateRequest>,
  settings: ReturnType<typeof normalizeSettings>,
) {
  return isImageRequest(body) && shouldUseOpenAiChatFallback(body.model ?? '', settings);
}

function applyQueryAuth(
  url: URL,
  settings?: Pick<GatewaySettings, 'requestQueryParamsText'>,
) {
  if (!settings?.requestQueryParamsText) {
    return;
  }

  const queryParams = parseRequestQueryParamsText(settings.requestQueryParamsText);
  Object.entries(queryParams).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
}

function buildOpenAiCompatibleUrl(
  apiBaseUrl: string,
  endpointPath: string,
  settings?: Pick<GatewaySettings, 'requestQueryParamsText'>,
) {
  const baseUrl = apiBaseUrl.trim().replace(/\/+$/, '');
  const url = new URL(baseUrl);
  const cleanEndpointPath = endpointPath.replace(/^\/+/, '');
  const versionMatch = url.pathname.match(/^(.*?)(\/v\d+(?:beta)?)(?:\/.*)?$/i);

  if (versionMatch) {
    const prefix = versionMatch[1] ?? '';
    const version = versionMatch[2] ?? '/v1';
    url.pathname = `${prefix}${version}/${cleanEndpointPath}`.replace(/\/{2,}/g, '/');
  } else if (
    /\/(?:chat\/completions|images\/generations|images\/edits|responses|models(?:\/.*)?)$/i.test(
      url.pathname,
    )
  ) {
    url.pathname = url.pathname.replace(
      /\/(?:chat\/completions|images\/generations|images\/edits|responses|models(?:\/.*)?)$/i,
      `/v1/${cleanEndpointPath}`,
    );
  } else {
    const prefix = url.pathname.replace(/\/+$/, '');
    url.pathname = `${prefix || ''}/v1/${cleanEndpointPath}`.replace(/\/{2,}/g, '/');
  }

  applyQueryAuth(url, settings);
  return url.toString();
}

function buildOpenAiChatCompletionsUrl(
  apiBaseUrl: string,
  settings?: Pick<GatewaySettings, 'requestQueryParamsText'>,
) {
  return buildOpenAiCompatibleUrl(apiBaseUrl, 'chat/completions', settings);
}

function buildOpenAiImagesUrl(
  apiBaseUrl: string,
  endpoint: 'generations' | 'edits',
  settings?: Pick<GatewaySettings, 'requestQueryParamsText'>,
) {
  return buildOpenAiCompatibleUrl(apiBaseUrl, `images/${endpoint}`, settings);
}

function getTextPromptFromParts(parts: GatewayGenerateRequest['parts'] = []) {
  return parts
    .flatMap((part) => ('text' in part ? [part.text.trim()] : []))
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function getImageParts(parts: GatewayGenerateRequest['parts'] = []) {
  return parts.flatMap((part) => ('inlineData' in part ? [part.inlineData] : []));
}

function detectKnownImageMimeTypeFromBase64(base64Data: string) {
  try {
    const bytes = Buffer.from(base64Data, 'base64');

    if (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    ) {
      return 'image/png';
    }

    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'image/jpeg';
    }

    if (
      bytes.length >= 12 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      return 'image/webp';
    }

    if (
      bytes.length >= 6 &&
      bytes[0] === 0x47 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x38
    ) {
      return 'image/gif';
    }
  } catch {
    return null;
  }

  return null;
}

function detectImageMimeTypeFromBase64(base64Data: string) {
  return detectKnownImageMimeTypeFromBase64(base64Data) ?? 'image/png';
}

function getExtensionForMimeType(mimeType: string) {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/gif') return 'gif';
  return 'png';
}

function buildGatewayImageResponse(
  data: string,
  mimeType: string,
  finishReason = 'STOP',
  error?: { message?: string },
) {
  return {
    candidates: [
      {
        finishReason,
        content: {
          parts: [
            {
              inlineData: {
                mimeType,
                data,
              },
            },
          ],
        },
      },
    ],
    error,
  } satisfies GatewayGenerateResponse;
}

function buildGatewayTextResponse(
  text: string,
  finishReason = 'STOP',
  error?: { message?: string },
) {
  return {
    candidates: [
      {
        finishReason,
        content: {
          parts: [
            {
              text,
            },
          ],
        },
      },
    ],
    error,
  } satisfies GatewayGenerateResponse;
}

function extractTextFromOpenAiContent(content: unknown): string {
  if (typeof content === 'string') {
    const trimmed = content.trim();

    if (!trimmed || trimmed.startsWith('data:image/') || /^https?:\/\//i.test(trimmed)) {
      return '';
    }

    return trimmed;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => extractTextFromOpenAiContent(item))
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  if (!content || typeof content !== 'object') {
    return '';
  }

  const record = content as Record<string, unknown>;
  const directText = record.text;

  if (typeof directText === 'string' && directText.trim()) {
    return directText.trim();
  }

  return [record.content, record.output_text, record.message]
    .map((item) => extractTextFromOpenAiContent(item))
    .find(Boolean) ?? '';
}

function extractDataUriFromOpenAiContent(content: unknown): string {
  if (Array.isArray(content)) {
    return content.map((item) => extractDataUriFromOpenAiContent(item)).find(Boolean) ?? '';
  }

  if (content && typeof content === 'object') {
    const record = content as Record<string, unknown>;

    if (typeof record.b64_json === 'string' && record.b64_json.trim()) {
      const mimeType = detectImageMimeTypeFromBase64(record.b64_json);
      return `data:${mimeType};base64,${record.b64_json}`;
    }

    return [
      record.url,
      record.data,
      record.image,
      record.image_base64,
      record.result,
      record.content,
      record.message,
      record.image_url,
    ]
      .map((item) => extractDataUriFromOpenAiContent(item))
      .find(Boolean) ?? '';
  }

  if (typeof content !== 'string' || !content.trim()) {
    return '';
  }

  const trimmed = content.trim();
  const markdownMatch = trimmed.match(/!\[[\s\S]*?\]\((data:image\/[^)]+)\)/i);

  if (markdownMatch?.[1]) {
    return markdownMatch[1];
  }

  if (trimmed.startsWith('data:image/')) {
    return trimmed;
  }

  const embeddedDataUriMatch = trimmed.match(/(data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=\s]+)/i);

  if (embeddedDataUriMatch?.[1]) {
    return embeddedDataUriMatch[1].trim();
  }

  const cleaned = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '');

  try {
    return extractDataUriFromOpenAiContent(JSON.parse(cleaned));
  } catch {
    return '';
  }
}

function buildOpenAiImagePayload(body: Partial<GatewayGenerateRequest>) {
  const content = (body.parts ?? []).map((part) => {
    if ('text' in part) {
      return {
        type: 'text',
        text: part.text,
      };
    }

    return {
      type: 'image_url',
      image_url: {
        url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
      },
    };
  });

  return {
    model: body.model?.trim(),
    max_tokens: 4096,
    temperature: 0.2,
    messages: [
      {
        role: 'user',
        content,
      },
    ],
  };
}

function extractImageUrlFromOpenAiContent(content: unknown): string {
  if (Array.isArray(content)) {
    return content.map((item) => extractImageUrlFromOpenAiContent(item)).find(Boolean) ?? '';
  }

  if (content && typeof content === 'object') {
    const record = content as Record<string, unknown>;

    return [
      record.url,
      record.image_url,
      record.data,
      record.result,
      record.content,
      record.message,
    ]
      .map((item) => extractImageUrlFromOpenAiContent(item))
      .find(Boolean) ?? '';
  }

  if (typeof content !== 'string' || !content.trim()) {
    return '';
  }

  const trimmed = content.trim();
  const markdownMatch = trimmed.match(/!\[[\s\S]*?\]\((https?:\/\/[^)]+)\)/i);
  if (markdownMatch?.[1]) {
    return markdownMatch[1];
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  const cleaned = trimmed
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '');

  try {
    return extractImageUrlFromOpenAiContent(JSON.parse(cleaned));
  } catch {
    return '';
  }
}

function buildOpenAiImagesPayload(body: Partial<GatewayGenerateRequest>) {
  const prompt = getTextPromptFromParts(body.parts);
  const imageParts = getImageParts(body.parts);

  if (!prompt) {
    throw new Error('Image requests require a text prompt.');
  }

  if (imageParts.length === 0) {
    return {
      endpoint: 'generations' as const,
      body: JSON.stringify({
        model: body.model?.trim(),
        prompt,
        n: 1,
        size: 'auto',
      }),
    };
  }

  const formData = new FormData();

  imageParts.forEach((part, index) => {
    const bytes = Buffer.from(part.data, 'base64');
    const fileName = `image-${index + 1}.${getExtensionForMimeType(part.mimeType)}`;
    formData.append('image', new Blob([bytes], { type: part.mimeType }), fileName);
  });
  formData.append('model', body.model?.trim() ?? '');
  formData.append('prompt', prompt);
  formData.append('n', '1');
  formData.append('size', 'auto');

  return {
    endpoint: 'edits' as const,
    body: formData,
  };
}

function isUnsafeIpAddress(address: string) {
  const normalizedAddress = address.trim().toLowerCase().split('%')[0];
  const family = isIP(normalizedAddress);

  if (family === 4) {
    const segments = normalizedAddress.split('.').map((segment) => Number(segment));

    if (segments.length !== 4 || segments.some((segment) => !Number.isInteger(segment))) {
      return true;
    }

    const [first, second] = segments;
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 100 && second >= 64 && second <= 127)
    );
  }

  if (family === 6) {
    return (
      normalizedAddress === '::' ||
      normalizedAddress === '::1' ||
      normalizedAddress.startsWith('fc') ||
      normalizedAddress.startsWith('fd') ||
      normalizedAddress.startsWith('fe80:')
    );
  }

  return false;
}

function isUnsafeHostname(hostname: string) {
  const normalizedHostname = hostname.trim().toLowerCase();

  return (
    normalizedHostname === 'localhost' ||
    normalizedHostname.endsWith('.localhost') ||
    normalizedHostname === 'local'
  );
}

async function validateRemoteImageUrl(imageUrl: string) {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(imageUrl);
  } catch {
    throw new Error('远程图片 URL 格式无效。');
  }

  if (parsedUrl.protocol !== 'https:') {
    throw new Error('远程图片 URL 仅支持 https。');
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new Error('远程图片 URL 不能包含账号信息。');
  }

  if (isUnsafeHostname(parsedUrl.hostname) || isUnsafeIpAddress(parsedUrl.hostname)) {
    throw new Error('远程图片 URL 不能指向本地或私网地址。');
  }

  const dnsResults = await lookup(parsedUrl.hostname, {
    all: true,
    verbatim: true,
  });

  if (dnsResults.length === 0) {
    throw new Error('远程图片 URL 域名解析失败。');
  }

  if (dnsResults.some((result) => isUnsafeIpAddress(result.address))) {
    throw new Error('远程图片 URL 不能解析到本地或私网地址。');
  }

  return parsedUrl.toString();
}

async function fetchImageUrlAsGatewayResponse(
  imageUrl: string,
  signal?: AbortSignal,
  finishReason = 'STOP',
  error?: { message?: string },
) {
  const safeImageUrl = await validateRemoteImageUrl(imageUrl);
  const imageResponse = await fetch(safeImageUrl, {
    headers: {
      Accept: 'image/*',
    },
    redirect: 'error',
    signal,
  });

  if (!imageResponse.ok) {
    throw new Error(`远程图片 URL 抓取失败 (${imageResponse.status}).`);
  }

  const arrayBuffer = await imageResponse.arrayBuffer();
  const base64Data = Buffer.from(arrayBuffer).toString('base64');
  const contentType = imageResponse.headers.get('content-type')?.split(';')[0]?.trim();
  const sniffedMimeType = detectKnownImageMimeTypeFromBase64(base64Data);

  if (contentType && !contentType.startsWith('image/')) {
    throw new Error(`远程图片 URL 返回的 content-type 不是图片: ${contentType}`);
  }

  const mimeType = contentType && contentType.startsWith('image/')
    ? contentType
    : sniffedMimeType;

  if (!mimeType) {
    throw new Error('远程图片 URL 返回的内容不是有效的图片。');
  }

  return buildGatewayImageResponse(base64Data, mimeType, finishReason, error);
}

type OpenAiCompatibleResponsePayload = {
  data?: Array<{
    b64_json?: string;
    url?: string;
  }>;
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: unknown;
    };
  }>;
  error?: {
    message?: string;
  };
};

async function normalizeOpenAiCompatibleResponse(rawText: string, signal?: AbortSignal) {
  if (!rawText) {
    return null;
  }

  const trimmed = rawText.trim();

  if (trimmed.startsWith('data:image/')) {
    const match = trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);

    if (match) {
      return buildGatewayImageResponse(match[2], match[1]);
    }
  }

  let parsed: OpenAiCompatibleResponsePayload;

  try {
    parsed = JSON.parse(rawText) as OpenAiCompatibleResponsePayload;
  } catch {
    return null;
  }

  const imageObject = parsed.data?.find(
    (item) =>
      typeof item?.b64_json === 'string' ||
      typeof item?.url === 'string',
  );

  if (imageObject?.b64_json) {
    const mimeType = detectImageMimeTypeFromBase64(imageObject.b64_json);
    return buildGatewayImageResponse(imageObject.b64_json, mimeType, 'STOP', parsed.error);
  }

  if (imageObject?.url) {
    return fetchImageUrlAsGatewayResponse(imageObject.url, signal, 'STOP', parsed.error);
  }

  const choice = parsed.choices?.[0];
  const content = choice?.message?.content;
  const dataUri = extractDataUriFromOpenAiContent(content);
  const finishReason = choice?.finish_reason?.toUpperCase() ?? 'STOP';

  if (dataUri) {
    const match = dataUri.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);

    if (match) {
      return buildGatewayImageResponse(match[2], match[1], finishReason, parsed.error);
    }
  }

  const imageUrl = extractImageUrlFromOpenAiContent(content);

  if (imageUrl) {
    return fetchImageUrlAsGatewayResponse(imageUrl, signal, finishReason, parsed.error);
  }

  const text = extractTextFromOpenAiContent(content);

  if (text) {
    return buildGatewayTextResponse(text, finishReason, parsed.error);
  }

  return parsed.error ? ({ error: parsed.error } satisfies GatewayGenerateResponse) : null;
}

function shouldFallbackFromOpenAiImagePath(status: number, rawText: string) {
  return status === 404 || /Invalid URL/i.test(rawText);
}

function shouldFallbackFromOpenAiImagesPath(status: number, rawText: string) {
  return (
    status === 404 ||
    status === 405 ||
    status === 415 ||
    /Invalid URL|Not Found|unsupported media type/i.test(rawText)
  );
}

function buildUrlCandidates(targetUrl: URL) {
  // Third-party Gemini-compatible gateways such as yunwu.ai expect
  // /v1/models/{model}:generateContent. Do not try /v1/{model}:generateContent.
  return [targetUrl.toString()];
}

function tryParseGatewayResponse(rawText: string) {
  if (!rawText) {
    return null;
  }

  try {
    return JSON.parse(rawText) as GatewayGenerateResponse;
  } catch {
    return null;
  }
}

function summarizeGatewayResponse(parsed: GatewayGenerateResponse | null) {
  if (!parsed) {
    return {
      finishReasons: [] as string[],
      hasImage: false,
      errorMessage: '',
    };
  }

  const finishReasons =
    parsed.candidates
      ?.map((candidate) => candidate.finishReason || candidate.finishMessage || '')
      .filter(Boolean) ?? [];
  const hasImage = Boolean(
    parsed.candidates
      ?.flatMap((candidate) => candidate.content?.parts ?? [])
      .some((part) => part.inlineData?.data || part.inline_data?.data),
  );

  return {
    finishReasons,
    hasImage,
    errorMessage: parsed.error?.message ?? '',
  };
}

function extractUpstreamErrorMessage(rawText: string) {
  if (!rawText.trim()) {
    return '';
  }

  try {
    const parsed = JSON.parse(rawText) as Record<string, unknown>;
    const error = parsed.error;

    if (typeof error === 'string' && error.trim()) {
      return error.trim();
    }

    if (error && typeof error === 'object') {
      const errorRecord = error as Record<string, unknown>;
      const errorMessage = errorRecord.message ?? errorRecord.detail ?? errorRecord.msg;

      if (typeof errorMessage === 'string' && errorMessage.trim()) {
        return errorMessage.trim();
      }
    }

    const directMessage = parsed.message ?? parsed.detail ?? parsed.msg;

    if (typeof directMessage === 'string' && directMessage.trim()) {
      return directMessage.trim();
    }
  } catch {
    return rawText.trim();
  }

  return rawText.trim();
}

function buildDebugHeaders(requestId: string, retryAfter?: string | null) {
  const headers: Record<string, string> = {
    'X-Debug-Request-Id': requestId,
  };

  if (retryAfter) {
    headers['Retry-After'] = retryAfter;
  }

  return headers;
}

function buildUpstreamErrorMessage(status: number, rawText: string) {
  const upstreamMessage = extractUpstreamErrorMessage(rawText);

  if (status === 429) {
    return upstreamMessage || '上游返回 429，当前通道限流，请稍后重试。';
  }

  if (status === 404 || status === 405 || status === 415) {
    return upstreamMessage || `当前兼容路径不可用 (${status})。`;
  }

  if (status >= 500) {
    return upstreamMessage || `上游服务暂时不可用 (${status})，请稍后重试。`;
  }

  return upstreamMessage || `上游请求失败 (${status})。`;
}

function buildUpstreamErrorResponse(
  requestId: string,
  upstreamResponse: Response,
  rawText: string,
) {
  return NextResponse.json(
    {
      error: {
        message: buildUpstreamErrorMessage(upstreamResponse.status, rawText),
      },
    },
    {
      status: upstreamResponse.status,
      headers: buildDebugHeaders(
        requestId,
        upstreamResponse.headers.get('retry-after'),
      ),
    },
  );
}

function buildInvalidUpstreamResponse(
  requestId: string,
  message: string,
  rawText = '',
) {
  const upstreamMessage = extractUpstreamErrorMessage(rawText);
  const finalMessage =
    upstreamMessage && upstreamMessage !== rawText.trim()
      ? upstreamMessage
      : message;

  return NextResponse.json(
    {
      error: {
        message: finalMessage,
      },
    },
    {
      status: 502,
      headers: buildDebugHeaders(requestId),
    },
  );
}

function shouldFallbackFromGenerateContentPath(status: number, rawText: string) {
  return (
    status === 404 ||
    status === 405 ||
    status === 415 ||
    /Invalid URL|Not Found|unsupported media type/i.test(rawText)
  );
}

function isAbortLikeError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === 'AbortError' ||
    error.name === 'ResponseAborted' ||
    error.message.includes('ResponseAborted')
  );
}

function isNetworkLikeError(error: unknown) {
  return (
    error instanceof Error &&
    /fetch failed|network|socket hang up|connection reset|econnreset|ecanceled/i.test(
      error.message,
    )
  );
}

export async function POST(request: Request) {
  const requestId = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  try {
    const body = (await request.json()) as Partial<GatewayGenerateRequest>;

    if (!body || typeof body !== 'object') {
      return errorResponse('请求体不能为空。');
    }

    if (!body.settings) {
      return errorResponse('缺少 settings 配置。');
    }

    if (typeof body.model !== 'string' || !body.model.trim()) {
      return errorResponse('缺少模型名称。');
    }

    if (!Array.isArray(body.parts) || body.parts.length === 0) {
      return errorResponse('缺少请求内容。');
    }

    const settings = normalizeSettings(body.settings);
    const logPrefix = createLogPrefix(requestId);
    const startedAt = Date.now();
    const targetUrl = buildGatewayUrl(settings.apiBaseUrl, body.model, settings);
    const target = new URL(targetUrl);
    const requestConfigSummary = summarizeRequestConfig(settings);
    const requestPayload = {
      contents:
        body.contentsMode === 'object_parts'
          ? [
              {
                parts: body.parts,
              },
            ]
          : [
              {
                role: 'user',
                parts: body.parts,
              },
            ],
      generationConfig: body.generationConfig,
    };
    const partSummary = summarizeParts(body.parts);

    console.log(`${logPrefix} 开始请求`);
    console.log(`${logPrefix} 请求分类: ${toChineseDebugLabel(body.debugLabel)}`);
    console.log(`${logPrefix} 模型名称: ${body.model.trim()}`);
    console.log(`${logPrefix} 请求地址: ${target.origin}${target.pathname}`);
    console.log(
      `${logPrefix} 请求头键: ${requestConfigSummary.headerKeys.join(', ') || '无'}；URL 参数键: ${requestConfigSummary.queryKeys.join(', ') || '无'}`,
    );
    console.log(`${logPrefix} 内容格式: ${toChineseContentsMode(body.contentsMode)}`);
    console.log(
      `${logPrefix} 文本片段数: ${partSummary.textParts}，图片片段数: ${partSummary.imageParts}`,
    );

    if (shouldUseOpenAiImagesPath(body)) {
      const imagesPayload = buildOpenAiImagesPayload(body);
      const imagesUrl = buildOpenAiImagesUrl(
        settings.apiBaseUrl,
        imagesPayload.endpoint,
        settings,
      );
      const imagesTarget = new URL(imagesUrl);
      const imagesHeaders = buildGatewayHeaders(settings);

      if (imagesPayload.body instanceof FormData) {
        delete imagesHeaders['Content-Type'];
      }

      console.log(
        `${logPrefix} Trying OpenAI Images compatible endpoint: ${imagesTarget.origin}${imagesTarget.pathname}`,
      );

      const upstreamResponse = await fetch(imagesUrl, {
        method: 'POST',
        headers: imagesHeaders,
        body: imagesPayload.body,
        signal: request.signal,
      });

      const rawText = await upstreamResponse.text();
      let normalized: GatewayGenerateResponse | null = null;

      try {
        normalized = await normalizeOpenAiCompatibleResponse(rawText, request.signal);
      } catch (error) {
        return buildInvalidUpstreamResponse(
          requestId,
          error instanceof Error ? error.message : '上游返回了无法解析的图片响应。',
          rawText,
        );
      }

      const responseSummary = summarizeGatewayResponse(normalized);
      const durationMs = Date.now() - startedAt;

      console.log(`${logPrefix} OpenAI Images request completed`);
      console.log(`${logPrefix} Upstream status: ${upstreamResponse.status}`);
      console.log(`${logPrefix} Request duration: ${durationMs}ms`);
      console.log(`${logPrefix} Finish reason: ${toChineseFinishReasons(responseSummary.finishReasons)}`);
      console.log(`${logPrefix} Returned image: ${responseSummary.hasImage ? 'yes' : 'no'}`);
      if (responseSummary.errorMessage) {
        console.log(`${logPrefix} Upstream error: ${responseSummary.errorMessage}`);
      }

      if (upstreamResponse.ok && normalized && responseSummary.hasImage) {
        return NextResponse.json(normalized, {
          status: 200,
          headers: {
            'X-Debug-Request-Id': requestId,
          },
        });
      }

      if (upstreamResponse.ok) {
        return buildInvalidUpstreamResponse(
          requestId,
          'OpenAI Images 接口返回了无法解析的图片响应。',
          rawText,
        );
      }

      if (!shouldFallbackFromOpenAiImagesPath(upstreamResponse.status, rawText)) {
        return buildUpstreamErrorResponse(requestId, upstreamResponse, rawText);
      }

      console.log(`${logPrefix} OpenAI Images endpoint unavailable, falling back to chat/completions`);
    }

    if (shouldUseOpenAiImagePath(body, settings)) {
      const openAiUrl = buildOpenAiChatCompletionsUrl(settings.apiBaseUrl, settings);
      const openAiTarget = new URL(openAiUrl);

      console.log(
        `${logPrefix} Trying OpenAI chat/completions image endpoint: ${openAiTarget.origin}${openAiTarget.pathname}`,
      );

      const upstreamResponse = await fetch(openAiUrl, {
        method: 'POST',
        headers: buildGatewayHeaders(settings),
        body: JSON.stringify(buildOpenAiImagePayload(body)),
        signal: request.signal,
      });

      const rawText = await upstreamResponse.text();
      let normalized: GatewayGenerateResponse | null = null;

      try {
        normalized = await normalizeOpenAiCompatibleResponse(rawText, request.signal);
      } catch (error) {
        return buildInvalidUpstreamResponse(
          requestId,
          error instanceof Error ? error.message : '上游返回了无法解析的图片响应。',
          rawText,
        );
      }

      const responseSummary = summarizeGatewayResponse(normalized);
      const durationMs = Date.now() - startedAt;

      console.log(`${logPrefix} OpenAI chat/completions request completed`);
      console.log(`${logPrefix} Upstream status: ${upstreamResponse.status}`);
      console.log(`${logPrefix} Request duration: ${durationMs}ms`);
      console.log(`${logPrefix} Finish reason: ${toChineseFinishReasons(responseSummary.finishReasons)}`);
      console.log(`${logPrefix} Returned image: ${responseSummary.hasImage ? 'yes' : 'no'}`);
      if (responseSummary.errorMessage) {
        console.log(`${logPrefix} Upstream error: ${responseSummary.errorMessage}`);
      }

      if (upstreamResponse.ok && normalized && responseSummary.hasImage) {
        return NextResponse.json(normalized, {
          status: 200,
          headers: {
            'X-Debug-Request-Id': requestId,
          },
        });
      }

      if (upstreamResponse.ok) {
        return buildInvalidUpstreamResponse(
          requestId,
          'OpenAI 兼容接口返回了无法解析的图片响应。',
          rawText,
        );
      }

      if (!shouldFallbackFromOpenAiImagePath(upstreamResponse.status, rawText)) {
        return buildUpstreamErrorResponse(requestId, upstreamResponse, rawText);
      }

      console.log(`${logPrefix} OpenAI chat/completions unavailable, falling back to generateContent`);
    }

    const urlCandidates = buildUrlCandidates(target);
    let lastRawText = '';
    let lastInvalidMessage = '';

    for (const [index, candidateUrl] of urlCandidates.entries()) {
      const currentUrl = new URL(candidateUrl);

      console.log(
        `${logPrefix} 正在尝试 generateContent 地址 ${index + 1}/${urlCandidates.length}: ${currentUrl.origin}${currentUrl.pathname}`,
      );

      const upstreamResponse = await fetch(candidateUrl, {
        method: 'POST',
        headers: buildGatewayHeaders(settings),
        body: JSON.stringify(requestPayload),
        signal: request.signal,
      });

      const rawText = await upstreamResponse.text();
      const contentType =
        upstreamResponse.headers.get('content-type') ?? 'application/json';
      const parsed = tryParseGatewayResponse(rawText);
      const responseSummary = summarizeGatewayResponse(parsed);
      const durationMs = Date.now() - startedAt;

      console.log(`${logPrefix} generateContent 请求完成`);
      console.log(`${logPrefix} 上游状态码: ${upstreamResponse.status}`);
      console.log(`${logPrefix} 请求耗时: ${durationMs}ms`);
      console.log(`${logPrefix} 结束原因: ${toChineseFinishReasons(responseSummary.finishReasons)}`);
      console.log(`${logPrefix} 是否返回图片: ${responseSummary.hasImage ? '是' : '否'}`);
      if (responseSummary.errorMessage) {
        console.log(`${logPrefix} 上游错误信息: ${responseSummary.errorMessage}`);
      }

      if (!upstreamResponse.ok) {
        if (
          index < urlCandidates.length - 1 &&
          shouldFallbackFromGenerateContentPath(upstreamResponse.status, rawText)
        ) {
          lastRawText = rawText;
          console.log(`${logPrefix} generateContent 地址不兼容，继续尝试下一个候选地址`);
          continue;
        }

        return buildUpstreamErrorResponse(requestId, upstreamResponse, rawText);
      }

      if (!isImageRequest(body)) {
        return new Response(rawText, {
          status: upstreamResponse.status,
          headers: {
            'Content-Type': contentType,
            ...buildDebugHeaders(
              requestId,
              upstreamResponse.headers.get('retry-after'),
            ),
          },
        });
      }

      if (responseSummary.hasImage) {
        return new Response(rawText, {
          status: upstreamResponse.status,
          headers: {
            'Content-Type': contentType,
            ...buildDebugHeaders(
              requestId,
              upstreamResponse.headers.get('retry-after'),
            ),
          },
        });
      }

      lastRawText = rawText;
      lastInvalidMessage = parsed?.error?.message ?? '上游返回了无法解析的图片响应。';
    }

    return buildInvalidUpstreamResponse(
      requestId,
      lastInvalidMessage || '上游返回了无法解析的图片响应。',
      lastRawText,
    );
  } catch (error) {
    if (isAbortLikeError(error)) {
      console.log(`${createLogPrefix(requestId)} 请求已被前端取消或超时`);
      return new Response(null, {
        status: 499,
        headers: buildDebugHeaders(requestId),
      });
    }

    if (isNetworkLikeError(error)) {
      console.error(`${createLogPrefix(requestId)} 上游网络异常`);
      console.error(
        `${createLogPrefix(requestId)} ${error instanceof Error ? error.message : String(error)}`,
      );
      return NextResponse.json(
        {
          error: {
            message: '上游连接失败，请稍后重试。',
          },
        },
        {
          status: 502,
          headers: buildDebugHeaders(requestId),
        },
      );
    }

    console.error(`${createLogPrefix(requestId)} 请求异常`);
    console.error(
      `${createLogPrefix(requestId)} ${error instanceof Error ? error.message : String(error)}`,
    );
    return NextResponse.json(
      {
        error: {
          message: error instanceof Error ? error.message : '服务端请求失败。',
        },
      },
      {
        status: 500,
        headers: buildDebugHeaders(requestId),
      },
    );
  }
}
