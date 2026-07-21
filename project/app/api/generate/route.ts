import { lookup } from 'node:dns/promises';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { isIP } from 'node:net';
import path from 'node:path';
import { NextResponse } from 'next/server';
import {
  buildGatewayHeaders,
  buildGatewayUrl,
  isGptImageModel,
  isYunwuBaseUrl,
  parseRequestHeadersText,
  parseRequestQueryParamsText,
  normalizeSettings,
  shouldUseOpenAiChatFallback,
  type GatewayGenerateRequest,
  type GatewayGenerateResponse,
  type GatewaySettings,
} from '@/lib/gateway';
import { acquireGlobalImageRequestSlot } from '@/lib/image-request-gate';

export const runtime = 'nodejs';

const MAX_GENERATE_REQUEST_BODY_BYTES = 90 * 1024 * 1024;
const MAX_INLINE_IMAGE_BYTES = 60 * 1024 * 1024;
const MAX_REMOTE_IMAGE_BYTES = 60 * 1024 * 1024;
const MAX_UPSTREAM_IMAGE_RESPONSE_BYTES = 96 * 1024 * 1024;
const MAX_UPSTREAM_TEXT_RESPONSE_BYTES = MAX_UPSTREAM_IMAGE_RESPONSE_BYTES;
const MAX_NODE_REQUEST_RESPONSE_BYTES = MAX_UPSTREAM_IMAGE_RESPONSE_BYTES;
const DEFAULT_NODE_REQUEST_TIMEOUT_MS = 120_000;
const UPSTREAM_IMAGE_REQUEST_TIMEOUT_BUFFER_MS = 60_000;
const MAX_NODE_REQUEST_TIMEOUT_MS = 10 * 60_000;
const REMOTE_IMAGE_DOWNLOAD_TIMEOUT_MS = 120_000;
const MAX_REMOTE_IMAGE_REDIRECTS = 4;
const MAX_REMOTE_IMAGE_DOWNLOAD_ATTEMPTS = 6;
const REMOTE_IMAGE_RETRY_BASE_DELAY_MS = 1_000;
const REMOTE_IMAGE_RETRY_MAX_DELAY_MS = 15_000;
const MAX_ASYNC_IMAGE_POLL_ATTEMPTS = 30;
const ASYNC_IMAGE_POLL_MAX_DELAY_MS = 10_000;
const MAX_GENERATE_LIFECYCLE_LOG_BYTES = 20 * 1024 * 1024;
const UPSTREAM_HOST_SAFETY_CACHE_MS = 2_000;
const upstreamHostSafetyCache = new Map<string, { expiresAt: number; promise: Promise<void> }>();
let generateLifecycleLogQueue: Promise<void> = Promise.resolve();

type NodeRequestFetchInit = RequestInit & {
  upstreamTimeoutMs?: number;
};

interface GenerateLifecycleLogEntry {
  requestId: string;
  stage: string;
  operationId?: string;
  upstreamRequestId?: string;
  model?: string;
  upstreamUrl?: URL;
  status?: number | string;
  durationMs?: number;
  responseBytes?: number;
  contentType?: string;
  error?: unknown;
}

function resolveResourceDir() {
  if (process.env.IMAGE_TRANSLATOR_RESOURCE_DIR) {
    return path.resolve(process.env.IMAGE_TRANSLATOR_RESOURCE_DIR);
  }

  let currentDir = path.resolve(process.cwd());
  while (true) {
    if (path.basename(currentDir).toLowerCase() === 'project') {
      return path.join(path.dirname(currentDir), '资源');
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  return path.resolve(process.cwd(), '..', '资源');
}

const GENERATE_SYSTEM_LOG_DIR = path.join(resolveResourceDir(), '系统日志');
const GENERATE_SYSTEM_LOG_PATH = path.join(GENERATE_SYSTEM_LOG_DIR, 'generate.ndjson');

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

function isYunwuUnavailableMessage(message: string) {
  return /上游负载已饱和|无可用渠道|distributor|负载|渠道/i.test(message);
}

function buildYunwuFriendlyErrorMessage(status: number, message: string) {
  if (status !== 429 && status !== 503) {
    return message;
  }

  if (!isYunwuUnavailableMessage(message)) {
    return message;
  }

  return `${message}。这表示 Yunwu 中转当前没有可用上游或通道拥挤；本地网关已经连接到中转，稍后重试或换一个可用模型即可。`;
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
    headerCount: headerKeys.length,
    queryCount: queryKeys.length,
  };
}

function safeLogText(value: unknown, maxLength = 220) {
  const text = String(value ?? '')
    .replace(/data:[^,\s]+;base64,[A-Za-z0-9+/=\s]+/gi, '[data-uri]')
    .replace(/[A-Za-z0-9+/]{240,}={0,2}/g, '[base64]')
    .replace(/\b(Bearer|Basic)\s+[^\s"',}]+/gi, '$1 [redacted]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{12,})\b/g, '[redacted-key]')
    .replace(/((?:["']?)(?:authorization|x-goog-api-key|x-api-key|api-key|api_key|access[-_]?token|secret|token|key)(?:["']?)\s*[:=]\s*(?:["']?))[^"',\s}]+/gi, '$1[redacted]')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/\s+/g, ' ')
    .trim();

  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function safeUpstreamPath(pathname: string) {
  if (/\/images\/edits\/?$/i.test(pathname)) return '/images/edits';
  if (/\/images\/generations\/?$/i.test(pathname)) return '/images/generations';
  if (/\/chat\/completions\/?$/i.test(pathname)) return '/chat/completions';
  if (/\/models\/[^/]+:generateContent\/?$/i.test(pathname)) {
    return '/models/:model:generateContent';
  }
  return `sha256:${createHash('sha256').update(pathname).digest('hex').slice(0, 16)}`;
}

function normalizeCorrelationId(value: unknown, maxLength = 128) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized.length > 0 &&
    normalized.length <= maxLength &&
    /^[A-Za-z0-9_-]+$/.test(normalized)
    ? normalized
    : '';
}

function getUpstreamRequestId(headers: Headers) {
  for (const headerName of [
    'x-request-id',
    'request-id',
    'openai-request-id',
    'x-goog-request-id',
    'x-cloud-trace-context',
  ]) {
    const value = headers.get(headerName)?.trim();
    if (value) return safeLogText(value, 160);
  }
  return '';
}

function buildGenerateUpstreamHeaders(
  settings: ReturnType<typeof normalizeSettings>,
  body: Partial<GatewayGenerateRequest>,
) {
  const headers = buildGatewayHeaders(settings);
  const operationId = normalizeCorrelationId(body.operationId);
  if (isImageRequest(body) && operationId) {
    Object.keys(headers).forEach((name) => {
      if (name.toLowerCase() === 'idempotency-key') delete headers[name];
    });
    headers['Idempotency-Key'] = operationId;
  }
  return headers;
}

function safeLifecycleErrorText(value: unknown) {
  return safeLogText(value, 600).replace(
    /(https?:\/\/[^\s?"'<>]+)\?[^\s"'<>]*/gi,
    '$1?[redacted-query]',
  );
}

async function appendGenerateLifecycleLog(entry: GenerateLifecycleLogEntry) {
  const upstream = entry.upstreamUrl
    ? {
        host: entry.upstreamUrl.host,
        path: safeUpstreamPath(entry.upstreamUrl.pathname),
      }
    : undefined;
  const record = {
    at: Date.now(),
    requestId: entry.requestId,
    stage: safeLogText(entry.stage, 80),
    ...(entry.operationId
      ? { operationId: safeLogText(entry.operationId, 128) }
      : {}),
    ...(entry.upstreamRequestId
      ? { upstreamRequestId: safeLogText(entry.upstreamRequestId, 160) }
      : {}),
    ...(entry.model ? { model: safeLogText(entry.model, 120) } : {}),
    ...(upstream ? { upstream } : {}),
    ...(entry.status !== undefined ? { status: entry.status } : {}),
    ...(entry.durationMs !== undefined
      ? { durationMs: Math.max(0, Math.round(entry.durationMs)) }
      : {}),
    ...(entry.responseBytes !== undefined
      ? { responseBytes: Math.max(0, Math.round(entry.responseBytes)) }
      : {}),
    ...(entry.contentType
      ? { contentType: safeLogText(entry.contentType, 120) }
      : {}),
    ...(entry.error ? { error: safeLifecycleErrorText(entry.error).slice(0, 300) } : {}),
  };
  const line = `${JSON.stringify(record)}\n`;
  const write = generateLifecycleLogQueue
    .catch(() => undefined)
    .then(async () => {
      await fs.mkdir(GENERATE_SYSTEM_LOG_DIR, { recursive: true });
      const currentSize = await fs.stat(GENERATE_SYSTEM_LOG_PATH)
        .then((stat) => stat.size)
        .catch(() => 0);
      if (currentSize >= MAX_GENERATE_LIFECYCLE_LOG_BYTES) {
        const archivedPath = `${GENERATE_SYSTEM_LOG_PATH}.1`;
        await fs.rm(archivedPath, { force: true }).catch(() => undefined);
        await fs.rename(GENERATE_SYSTEM_LOG_PATH, archivedPath).catch(() => undefined);
      }
      await fs.appendFile(GENERATE_SYSTEM_LOG_PATH, line, 'utf8');
    });
  generateLifecycleLogQueue = write;

  try {
    await write;
  } catch (error) {
    console.error('[generate lifecycle log] write failed');
    console.error(safeLogText(error));
  }
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
  return shouldUseOpenAiChatFallback(body.model ?? '', settings);
}

function normalizeNodeRequestTimeoutMs(timeoutMs: unknown, fallbackMs = DEFAULT_NODE_REQUEST_TIMEOUT_MS) {
  const numericTimeoutMs = Number(timeoutMs);

  if (!Number.isFinite(numericTimeoutMs) || numericTimeoutMs < 1000) {
    return fallbackMs;
  }

  return Math.min(Math.floor(numericTimeoutMs), MAX_NODE_REQUEST_TIMEOUT_MS);
}

function getGatewayUpstreamTimeoutMs(
  body: Partial<GatewayGenerateRequest>,
  settings: Pick<GatewaySettings, 'imageRequestTimeoutMs'>,
) {
  if (!isImageRequest(body)) {
    return DEFAULT_NODE_REQUEST_TIMEOUT_MS;
  }

  return normalizeNodeRequestTimeoutMs(
    settings.imageRequestTimeoutMs + UPSTREAM_IMAGE_REQUEST_TIMEOUT_BUFFER_MS,
  );
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

function getBase64DecodedByteEstimate(base64Data: string) {
  const normalizedBase64 = base64Data.replace(/\s/g, '');
  const padding = normalizedBase64.endsWith('==') ? 2 : normalizedBase64.endsWith('=') ? 1 : 0;
  return Math.floor((normalizedBase64.length * 3) / 4) - padding;
}

function validateInlineImageParts(parts: GatewayGenerateRequest['parts']) {
  for (const part of parts) {
    if (!part || typeof part !== 'object') {
      throw new Error('请求内容格式无效。');
    }

    if (!('inlineData' in part)) continue;

    const inlineData = part.inlineData as { mimeType?: unknown; data?: unknown };
    const mimeType = String(inlineData.mimeType ?? '').toLowerCase();
    const base64Data = String(inlineData.data ?? '');

    if (!mimeType.startsWith('image/')) {
      throw new Error('inlineData 只允许图片内容。');
    }

    if (!base64Data || !/^[A-Za-z0-9+/=\s]+$/.test(base64Data)) {
      throw new Error('图片 base64 数据无效。');
    }

    if (getBase64DecodedByteEstimate(base64Data) > MAX_INLINE_IMAGE_BYTES) {
      throw new Error('图片太大，单张最多 60 MB。');
    }
  }
}

function detectKnownImageMimeTypeFromBase64(base64Data: string) {
  try {
    const bytes = Buffer.from(base64Data.slice(0, 32), 'base64');

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

function buildDataUriFromRawBase64(value: unknown) {
  if (typeof value !== 'string' || value.length < 32) {
    return '';
  }

  const trimmed = value.trim();
  const mimeType = detectKnownImageMimeTypeFromBase64(trimmed);
  return mimeType ? `data:${mimeType};base64,${trimmed}` : '';
}

function extractDataUriFromOpenAiContent(content: unknown): string {
  if (Array.isArray(content)) {
    return content.map((item) => extractDataUriFromOpenAiContent(item)).find(Boolean) ?? '';
  }

  if (content && typeof content === 'object') {
    const record = content as Record<string, unknown>;
    const rawBase64 = [
      record.b64_json,
      record.image_base64,
      record.image_b64,
      record.base64,
      record.base64_data,
      record.data,
      record.result,
    ]
      .map((item) => buildDataUriFromRawBase64(item))
      .find(Boolean);

    if (rawBase64) {
      return rawBase64;
    }

    return [
      record.url,
      record.data,
      record.image,
      record.image_base64,
      record.result,
      record.text,
      record.content,
      record.message,
      record.image_url,
      record.images,
      record.output,
      record.outputs,
      record.results,
      record.artifacts,
      record.response,
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

function buildOpenAiResponseFormat(body: Partial<GatewayGenerateRequest>) {
  const mimeType = body.generationConfig?.responseMimeType;

  if (mimeType === 'application/json') {
    return { type: 'json_object' };
  }

  return undefined;
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
    response_format: buildOpenAiResponseFormat(body),
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
      record.results,
      record.image,
      record.images,
      record.output,
      record.outputs,
      record.artifacts,
      record.response,
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

  const requestedAspectRatio = typeof body.generationConfig?.aspectRatio === 'string'
    ? body.generationConfig.aspectRatio
    : typeof (body.generationConfig?.imageConfig as { aspectRatio?: unknown } | undefined)?.aspectRatio === 'string'
      ? (body.generationConfig?.imageConfig as { aspectRatio: string }).aspectRatio
      : '';
  const size = getOpenAiImageSizeForAspectRatio(requestedAspectRatio);

  if (imageParts.length === 0) {
    return {
      endpoint: 'generations' as const,
      body: JSON.stringify({
        model: body.model?.trim(),
        prompt,
        n: 1,
        size,
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
  formData.append('size', size);

  return {
    endpoint: 'edits' as const,
    body: formData,
  };
}

function isUnsafeIpAddress(address: string) {
  const normalizedAddress = address.trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
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
    const embeddedIpv4 = normalizedAddress.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/);
    if (embeddedIpv4?.[1] && isUnsafeIpAddress(embeddedIpv4[1])) {
      return true;
    }

    if (normalizedAddress.includes(':ffff:') || normalizedAddress.startsWith('::')) {
      const parts = normalizedAddress.split(':');
      const tail = parts.slice(-2);
      const tailHex = tail.every((part) => /^[0-9a-f]{1,4}$/i.test(part))
        ? tail.map((part) => part.padStart(4, '0')).join('')
        : '';
      const parsedHex = tailHex ? Number.parseInt(tailHex, 16) : Number.NaN;
      if (Number.isFinite(parsedHex)) {
        const dottedIpv4 = [
          (parsedHex >>> 24) & 255,
          (parsedHex >>> 16) & 255,
          (parsedHex >>> 8) & 255,
          parsedHex & 255,
        ].join('.');
        if (isUnsafeIpAddress(dottedIpv4)) return true;
      }
    }

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

async function resolvePublicNetworkTargetAddress(url: URL, label: string) {
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error(`${label} 仅支持 http/https。`);
  }

  if (url.username || url.password) {
    throw new Error(`${label} 不能包含账号信息。`);
  }

  if (isUnsafeHostname(url.hostname) || isUnsafeIpAddress(url.hostname)) {
    throw new Error(`${label} 不能指向本机、内网或链路本地地址。`);
  }

  const dnsResults = await lookup(url.hostname, {
    all: true,
    verbatim: true,
  });

  if (dnsResults.length === 0) {
    throw new Error(`${label} 域名解析失败。`);
  }

  const safeResult = dnsResults.find((result) => !isUnsafeIpAddress(result.address));

  if (!safeResult) {
    throw new Error(`${label} 不能解析到本机、内网或链路本地地址。`);
  }

  return safeResult;
}

async function assertPublicNetworkTarget(url: URL, label: string) {
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error(`${label} 仅支持 http/https。`);
  }

  if (url.username || url.password) {
    throw new Error(`${label} 不能包含账号信息。`);
  }

  if (isUnsafeHostname(url.hostname) || isUnsafeIpAddress(url.hostname)) {
    throw new Error(`${label} 不能指向本机、内网或链路本地地址。`);
  }

  const cacheKey = `${url.protocol}//${url.hostname.toLowerCase()}`;
  const cached = upstreamHostSafetyCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    await cached.promise;
    return;
  }

  const promise = resolvePublicNetworkTargetAddress(url, label).then(() => undefined);

  upstreamHostSafetyCache.set(cacheKey, {
    expiresAt: Date.now() + UPSTREAM_HOST_SAFETY_CACHE_MS,
    promise,
  });

  try {
    await promise;
  } catch (error) {
    upstreamHostSafetyCache.delete(cacheKey);
    throw error;
  }
}

async function nodeRequestFetch(input: string, init: NodeRequestFetchInit = {}, label = '上游地址') {
  const url = new URL(input);

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('仅支持 http/https 上游地址。');
  }

  const headers = new Headers(init.headers);
  // node:http does not transparently decompress response bodies like fetch does.
  headers.set('accept-encoding', 'identity');
  let body: string | Buffer | undefined;

  if (init.body instanceof FormData) {
    const formResponse = new Response(init.body);
    body = Buffer.from(await formResponse.arrayBuffer());
    const contentType = formResponse.headers.get('content-type');
    if (contentType && !headers.has('content-type')) headers.set('content-type', contentType);
  } else {
    body = typeof init.body === 'string' || init.body instanceof Buffer
      ? init.body
      : init.body == null
        ? undefined
        : String(init.body);
  }

  if (body !== undefined && !headers.has('content-length')) {
    headers.set('content-length', String(Buffer.byteLength(body)));
  }

  const pinnedAddress = await resolvePublicNetworkTargetAddress(url, label);
  const requestTimeoutMs = normalizeNodeRequestTimeoutMs(init.upstreamTimeoutMs);

  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    let removeAbortListener: () => void = () => {};
    const settleResolve = (response: Response) => {
      if (settled) return;
      settled = true;
      removeAbortListener();
      resolve(response);
    };
    const settleReject = (error: Error) => {
      if (settled) return;
      settled = true;
      removeAbortListener();
      reject(error);
    };
    const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = requestFn(url, {
      method: init.method ?? 'GET',
      hostname: pinnedAddress.address,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      headers: {
        ...Object.fromEntries(headers.entries()),
        Host: url.host,
      },
      servername: url.hostname,
      timeout: requestTimeoutMs,
    }, (res) => {
      if (settled) {
        res.destroy();
        return;
      }

      let responseEnded = false;
      let rejectedForSize = false;
      const failResponse = (error: Error) => {
        settleReject(error);
        if (!res.destroyed) res.destroy(error);
        if (!req.destroyed) req.destroy(error);
      };
      res.on('aborted', () => {
        failResponse(new Error('上游响应在传输完成前中断。'));
      });
      res.on('error', (error) => {
        failResponse(error instanceof Error ? error : new Error(String(error)));
      });
      res.on('close', () => {
        if (!responseEnded) {
          failResponse(new Error('上游响应连接提前关闭。'));
        }
      });

      const contentLength = Number(res.headers['content-length']);
      if (Number.isFinite(contentLength) && contentLength > MAX_NODE_REQUEST_RESPONSE_BYTES) {
        rejectedForSize = true;
        failResponse(new Error(`上游响应太大，最多 ${Math.round(MAX_NODE_REQUEST_RESPONSE_BYTES / 1024 / 1024)} MB。`));
        return;
      }

      const chunks: Buffer[] = [];
      let totalBytes = 0;

      res.on('data', (chunk) => {
        if (settled || rejectedForSize) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buffer.length;

        if (totalBytes > MAX_NODE_REQUEST_RESPONSE_BYTES) {
          rejectedForSize = true;
          failResponse(new Error(`上游响应太大，最多 ${Math.round(MAX_NODE_REQUEST_RESPONSE_BYTES / 1024 / 1024)} MB。`));
          return;
        }

        chunks.push(buffer);
      });
      res.on('end', () => {
        responseEnded = true;
        if (settled || rejectedForSize) return;

        const responseHeaders = new Headers();
        Object.entries(res.headers).forEach(([key, value]) => {
          if (Array.isArray(value)) {
            value.forEach((item) => responseHeaders.append(key, item));
          } else if (value !== undefined) {
            responseHeaders.set(key, String(value));
          }
        });

        settleResolve(new Response(Buffer.concat(chunks), {
          status: res.statusCode ?? 0,
          statusText: res.statusMessage,
          headers: responseHeaders,
        }));
      });
    });

    const abortRequest = () => {
      const error = new DOMException('The operation was aborted.', 'AbortError');
      settleReject(error);
      if (!req.destroyed) req.destroy(error);
    };

    req.on('timeout', () => {
      const error = new Error(`上游连接超时（${Math.round(requestTimeoutMs / 1000)} 秒）。`);
      settleReject(error);
      if (!req.destroyed) req.destroy(error);
    });
    req.on('error', (error) => {
      settleReject(error instanceof Error ? error : new Error(String(error)));
    });

    if (init.signal) {
      if (init.signal.aborted) {
        abortRequest();
        return;
      }
      init.signal.addEventListener('abort', abortRequest, { once: true });
      removeAbortListener = () => {
        init.signal?.removeEventListener('abort', abortRequest);
      };
    }

    if (body !== undefined) req.write(body);
    req.end();
  });
}

function getOpenAiImageSizeForAspectRatio(aspectRatio: string) {
  const [rawWidth, rawHeight] = aspectRatio.split(':').map(Number);
  if (!Number.isFinite(rawWidth) || !Number.isFinite(rawHeight) || rawWidth <= 0 || rawHeight <= 0) {
    return 'auto';
  }

  const ratio = rawWidth / rawHeight;
  if (ratio > 1.12) return '1536x1024';
  if (ratio < 0.9) return '1024x1536';
  return '1024x1024';
}

async function guardedFetch(input: string, init: NodeRequestFetchInit, label: string) {
  return nodeRequestFetch(input, init, label);
}

async function validateApiBaseUrlTarget(apiBaseUrl: string) {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(apiBaseUrl);
  } catch {
    throw new Error('API Base URL 格式无效。');
  }

  if (isUnsafeHostname(parsedUrl.hostname) || isUnsafeIpAddress(parsedUrl.hostname)) {
    throw new Error('API Base URL 不能指向本机、内网或链路本地地址。');
  }

  await assertPublicNetworkTarget(parsedUrl, 'API Base URL');
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

  await assertPublicNetworkTarget(parsedUrl, '远程图片 URL');

  return parsedUrl.toString();
}

function getContentLengthBytes(response: Response) {
  const rawContentLength = response.headers.get('content-length');
  if (!rawContentLength) return null;
  const contentLength = Number(rawContentLength);
  return Number.isFinite(contentLength) && contentLength >= 0 ? contentLength : null;
}

async function readResponseBodyWithLimit(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
  errorLabel = '远程响应',
) {
  const contentLength = getContentLengthBytes(response);
  if (contentLength !== null && contentLength > maxBytes) {
    throw new Error(`${errorLabel}太大，最多 ${Math.round(maxBytes / 1024 / 1024)} MB。`);
  }

  if (!response.body) {
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) {
      throw new Error(`${errorLabel}太大，最多 ${Math.round(maxBytes / 1024 / 1024)} MB。`);
    }
    return Buffer.from(arrayBuffer);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      if (signal?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }

      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`${errorLabel}太大，最多 ${Math.round(maxBytes / 1024 / 1024)} MB。`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, totalBytes);
}

function formatFileSizeForMessage(byteLength: number) {
  if (!Number.isFinite(byteLength) || byteLength < 0) return '未知大小';
  if (byteLength >= 1024 * 1024) return `${(byteLength / 1024 / 1024).toFixed(1)} MB`;
  if (byteLength >= 1024) return `${Math.round(byteLength / 1024)} KB`;
  return `${byteLength} B`;
}

async function readResponseTextWithLimit(
  response: Response,
  maxBytes = MAX_UPSTREAM_TEXT_RESPONSE_BYTES,
  signal?: AbortSignal,
) {
  const buffer = await readResponseBodyWithLimit(response, maxBytes, signal, '上游响应');
  return {
    text: new TextDecoder().decode(buffer),
    byteLength: buffer.byteLength,
  };
}

function shouldReadUpstreamAsImage(response: Response) {
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
  return contentType.startsWith('image/');
}

async function readUpstreamPayloadWithLimit(
  response: Response,
  signal?: AbortSignal,
) {
  if (shouldReadUpstreamAsImage(response)) {
    const buffer = await readResponseBodyWithLimit(
      response,
      MAX_UPSTREAM_IMAGE_RESPONSE_BYTES,
      signal,
      '上游图片响应',
    );
    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png';
    return {
      rawText: JSON.stringify(buildGatewayImageResponse(buffer.toString('base64'), contentType)),
      rawBodyForError: `上游直接返回图片 (${contentType}, ${formatFileSizeForMessage(buffer.byteLength)})`,
      responseBytes: buffer.byteLength,
      contentType,
    };
  }

  const { text: rawText, byteLength } = await readResponseTextWithLimit(
    response,
    MAX_UPSTREAM_TEXT_RESPONSE_BYTES,
    signal,
  );
  return {
    rawText,
    rawBodyForError: rawText,
    responseBytes: byteLength,
    contentType: response.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream',
  };
}

async function requestGenerateUpstream(
  requestId: string,
  model: string,
  input: string,
  init: NodeRequestFetchInit,
  label: string,
) {
  const upstreamUrl = new URL(input);
  const startedAt = Date.now();
  await appendGenerateLifecycleLog({
    requestId,
    stage: 'upstream-submit',
    model,
    upstreamUrl,
    status: 'started',
  });

  try {
    const upstreamResponse = await guardedFetch(input, init, label);
    const upstreamRequestId = getUpstreamRequestId(upstreamResponse.headers);
    const payload = await readUpstreamPayloadWithLimit(upstreamResponse, init.signal ?? undefined);
    await appendGenerateLifecycleLog({
      requestId,
      stage: 'upstream-response',
      model,
      upstreamUrl,
      status: upstreamResponse.status,
      durationMs: Date.now() - startedAt,
      responseBytes: payload.responseBytes,
      contentType: payload.contentType,
      upstreamRequestId,
    });
    return { upstreamResponse, upstreamRequestId, ...payload };
  } catch (error) {
    await appendGenerateLifecycleLog({
      requestId,
      stage: 'upstream-error',
      model,
      upstreamUrl,
      status: 'error',
      durationMs: Date.now() - startedAt,
      error,
    });
    throw error;
  }
}

function createDownloadAbortController(parentSignal?: AbortSignal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REMOTE_IMAGE_DOWNLOAD_TIMEOUT_MS);
  const abortFromParent = () => controller.abort(parentSignal?.reason);

  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  }

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeout);
      parentSignal?.removeEventListener('abort', abortFromParent);
    },
  };
}

function waitForRemoteImageRetry(delayMs: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abortFromSignal);
      resolve();
    }, delayMs);
    function abortFromSignal() {
      clearTimeout(timer);
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    }
    signal?.addEventListener('abort', abortFromSignal, { once: true });
  });
}

class RemoteImageDownloadAttemptError extends Error {
  retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'RemoteImageDownloadAttemptError';
    this.retryable = retryable;
  }
}

class PostGenerationImageFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PostGenerationImageFetchError';
  }
}

class AsyncImageResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AsyncImageResponseError';
  }
}

function isRemoteImageRedirectStatus(status: number) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function fetchRemoteImageWithRedirects(
  imageUrl: string,
  signal: AbortSignal,
) {
  let currentUrl = await validateRemoteImageUrl(imageUrl);
  const visitedUrls = new Set<string>();

  for (let redirectCount = 0; redirectCount <= MAX_REMOTE_IMAGE_REDIRECTS; redirectCount += 1) {
    if (visitedUrls.has(currentUrl)) {
      throw new RemoteImageDownloadAttemptError('远程图片 URL 存在重定向循环。', false);
    }
    visitedUrls.add(currentUrl);

    const response = await guardedFetch(currentUrl, {
      headers: {
        Accept: 'image/*,application/octet-stream;q=0.9',
      },
      redirect: 'manual',
      signal,
    }, '远程图片 URL');

    if (!isRemoteImageRedirectStatus(response.status)) {
      return response;
    }

    if (redirectCount >= MAX_REMOTE_IMAGE_REDIRECTS) {
      throw new RemoteImageDownloadAttemptError(
        `远程图片 URL 重定向超过 ${MAX_REMOTE_IMAGE_REDIRECTS} 次。`,
        false,
      );
    }

    const location = response.headers.get('location');
    if (!location) {
      throw new RemoteImageDownloadAttemptError('远程图片 URL 重定向缺少 Location。', false);
    }

    currentUrl = await validateRemoteImageUrl(new URL(location, currentUrl).toString());
  }

  throw new RemoteImageDownloadAttemptError('远程图片 URL 重定向失败。', false);
}

async function readRequestJsonWithLimit(request: Request, maxBytes: number) {
  const rawContentLength = request.headers.get('content-length');
  const contentLength = rawContentLength ? Number(rawContentLength) : 0;
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error('请求体太大，请压缩图片后再试。');
  }

  if (!request.body) {
    return JSON.parse(await request.text()) as unknown;
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  const textChunks: string[] = [];

  try {
    while (true) {
      if (request.signal.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }

      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error('请求体太大，请压缩图片后再试。');
      }
      textChunks.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    reader.releaseLock();
  }

  textChunks.push(decoder.decode());
  return JSON.parse(textChunks.join('')) as unknown;
}

async function fetchImageUrlAsGatewayResponse(
  imageUrl: string,
  signal?: AbortSignal,
  finishReason = 'STOP',
  error?: { message?: string },
  lifecycle?: { requestId: string; model: string },
) {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_REMOTE_IMAGE_DOWNLOAD_ATTEMPTS; attempt += 1) {
    const downloadAbort = createDownloadAbortController(signal);
    const attemptStartedAt = Date.now();
    let lifecycleUrl: URL | undefined;

    try {
      lifecycleUrl = new URL(imageUrl);
    } catch {
      lifecycleUrl = undefined;
    }

    if (lifecycle) {
      await appendGenerateLifecycleLog({
        requestId: lifecycle.requestId,
        stage: 'image-download-start',
        model: lifecycle.model,
        upstreamUrl: lifecycleUrl,
        status: `attempt-${attempt}`,
      });
    }

    try {
      const imageResponse = await fetchRemoteImageWithRedirects(imageUrl, downloadAbort.signal);

      if (imageResponse.status === 202 || imageResponse.status === 204) {
        throw new RemoteImageDownloadAttemptError(
          `远程图片仍在生成中 (${imageResponse.status})。`,
          true,
        );
      }

      if (!imageResponse.ok) {
        const retryable =
          imageResponse.status === 404 ||
          imageResponse.status === 408 ||
          imageResponse.status === 425 ||
          imageResponse.status === 429 ||
          imageResponse.status >= 500;
        throw new RemoteImageDownloadAttemptError(
          `远程图片 URL 抓取失败 (${imageResponse.status})。`,
          retryable,
        );
      }

      const contentType = imageResponse.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
      if (
        contentType &&
        !contentType.startsWith('image/') &&
        contentType !== 'application/octet-stream' &&
        contentType !== 'binary/octet-stream'
      ) {
        throw new RemoteImageDownloadAttemptError(
          `远程图片 URL 返回的 content-type 不是图片: ${contentType}`,
          true,
        );
      }

      const imageBuffer = await readResponseBodyWithLimit(
        imageResponse,
        MAX_REMOTE_IMAGE_BYTES,
        downloadAbort.signal,
        '远程图片',
      );
      const base64Data = imageBuffer.toString('base64');
      const sniffedMimeType = detectKnownImageMimeTypeFromBase64(base64Data);
      const declaredMimeType = contentType?.startsWith('image/') ? contentType : null;
      const mimeType = sniffedMimeType ?? declaredMimeType;

      if (!mimeType) {
        throw new RemoteImageDownloadAttemptError(
          '远程图片 URL 返回的内容不是有效的图片。',
          false,
        );
      }

      if (lifecycle) {
        await appendGenerateLifecycleLog({
          requestId: lifecycle.requestId,
          stage: 'image-download-response',
          model: lifecycle.model,
          upstreamUrl: lifecycleUrl,
          status: imageResponse.status,
          durationMs: Date.now() - attemptStartedAt,
          responseBytes: imageBuffer.byteLength,
          contentType: contentType || mimeType,
        });
      }

      return buildGatewayImageResponse(base64Data, mimeType, finishReason, error);
    } catch (fetchError) {
      if (signal?.aborted) {
        throw fetchError;
      }

      const normalizedError =
        isAbortLikeError(fetchError) && downloadAbort.signal.aborted
          ? new RemoteImageDownloadAttemptError('远程图片 URL 下载超时。', true)
          : fetchError instanceof RemoteImageDownloadAttemptError
            ? fetchError
            : new RemoteImageDownloadAttemptError(
                fetchError instanceof Error ? fetchError.message : String(fetchError),
                isNetworkLikeError(fetchError),
              );
      lastError = normalizedError;

      if (lifecycle) {
        await appendGenerateLifecycleLog({
          requestId: lifecycle.requestId,
          stage: 'image-download-error',
          model: lifecycle.model,
          upstreamUrl: lifecycleUrl,
          status: `attempt-${attempt}`,
          durationMs: Date.now() - attemptStartedAt,
          error: normalizedError.message,
        });
      }

      if (!normalizedError.retryable || attempt >= MAX_REMOTE_IMAGE_DOWNLOAD_ATTEMPTS) {
        break;
      }
      downloadAbort.dispose();
      await waitForRemoteImageRetry(
        Math.min(
          REMOTE_IMAGE_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
          REMOTE_IMAGE_RETRY_MAX_DELAY_MS,
        ),
        signal,
      );
    } finally {
      downloadAbort.dispose();
    }
  }

  throw new PostGenerationImageFetchError(
    `上游已返回图片 URL，但本地下载失败：${safeLogText(lastError?.message ?? '未知错误')}。为避免重复扣费，不会重新提交生图请求。`,
  );
}

type OpenAiCompatibleResponsePayload = {
  data?: Array<{
    b64_json?: string;
    url?: string;
  }> | unknown;
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: unknown;
      images?: unknown;
    };
    images?: unknown;
  }>;
  error?: {
    message?: string;
  };
};

interface NormalizeOpenAiCompatibleOptions {
  signal?: AbortSignal;
  responseStatus?: number;
  responseHeaders?: Headers;
  expectImage?: boolean;
  requestId?: string;
  model?: string;
}

function extractAsyncImageStatus(content: unknown, depth = 0): string {
  if (depth > 5 || !content) return '';
  if (Array.isArray(content)) {
    return content
      .map((item) => extractAsyncImageStatus(item, depth + 1))
      .find(Boolean) ?? '';
  }
  if (typeof content !== 'object') return '';

  const record = content as Record<string, unknown>;
  const directStatus = [record.status, record.state, record.task_status, record.job_status]
    .find((item) => typeof item === 'string' && item.trim());
  if (typeof directStatus === 'string') return directStatus.trim();

  return [record.data, record.result, record.output, record.task, record.job, record.operation]
    .map((item) => extractAsyncImageStatus(item, depth + 1))
    .find(Boolean) ?? '';
}

function hasAsyncPollingAddress(payload: unknown, headers?: Headers, depth = 0): boolean {
  if (headers?.get('location')) return true;
  if (depth > 5 || !payload) return false;
  if (Array.isArray(payload)) {
    return payload.some((item) => hasAsyncPollingAddress(item, undefined, depth + 1));
  }
  if (typeof payload !== 'object') return false;

  const record = payload as Record<string, unknown>;
  const hasDirectAddress = [
    record.status_url,
    record.statusUrl,
    record.poll_url,
    record.pollUrl,
    record.operation_url,
    record.operationUrl,
  ].some((item) => typeof item === 'string' && item.trim());
  if (hasDirectAddress) return true;

  return [record.data, record.result, record.output, record.task, record.job, record.operation]
    .some((item) => hasAsyncPollingAddress(item, undefined, depth + 1));
}

function extractAsyncPollingAddress(
  payload: unknown,
  headers?: Headers,
  depth = 0,
): string {
  const location = headers?.get('location')?.trim();
  if (location) return location;
  if (depth > 5 || !payload) return '';
  if (Array.isArray(payload)) {
    return payload
      .map((item) => extractAsyncPollingAddress(item, undefined, depth + 1))
      .find(Boolean) ?? '';
  }
  if (typeof payload !== 'object') return '';

  const record = payload as Record<string, unknown>;
  const directAddress = [
    record.status_url,
    record.statusUrl,
    record.poll_url,
    record.pollUrl,
    record.operation_url,
    record.operationUrl,
  ].find((item) => typeof item === 'string' && item.trim());
  if (typeof directAddress === 'string') return directAddress.trim();

  return [record.data, record.result, record.output, record.task, record.job, record.operation]
    .map((item) => extractAsyncPollingAddress(item, undefined, depth + 1))
    .find(Boolean) ?? '';
}

async function normalizeOpenAiCompatibleResponse(
  rawText: string,
  options: NormalizeOpenAiCompatibleOptions = {},
) {
  if (!rawText) {
    if (options.expectImage && options.responseStatus === 202) {
      const hasPollingAddress = Boolean(options.responseHeaders?.get('location'));
      throw new AsyncImageResponseError(
        hasPollingAddress
          ? '上游已受理异步生图任务并返回了 Location，但响应中没有图片或通用任务格式。本地不会猜测轮询协议，也不会重新提交 POST，以避免重复扣费。'
          : '上游已受理异步生图任务，但没有返回图片或可轮询地址。本地不会重新提交 POST，以避免重复扣费。',
      );
    }
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
    if (options.expectImage && options.responseStatus === 202) {
      throw new AsyncImageResponseError(
        '上游已返回 202 Accepted，但任务响应不是可解析 JSON。本地不会重新提交 POST，以避免重复扣费。',
      );
    }
    return null;
  }
  const lifecycle = options.requestId && options.model
    ? { requestId: options.requestId, model: options.model }
    : undefined;

  const dataItems = Array.isArray(parsed.data) ? parsed.data : [];
  const imageObject = dataItems.find(
    (item) =>
      Boolean(item) &&
      typeof item === 'object' &&
      (typeof (item as { b64_json?: unknown }).b64_json === 'string' ||
        typeof (item as { url?: unknown }).url === 'string'),
  );

  if (imageObject && typeof imageObject === 'object' && typeof imageObject.b64_json === 'string') {
    const mimeType = detectImageMimeTypeFromBase64(imageObject.b64_json);
    return buildGatewayImageResponse(imageObject.b64_json, mimeType, 'STOP', parsed.error);
  }

  if (imageObject && typeof imageObject === 'object' && typeof imageObject.url === 'string') {
    return fetchImageUrlAsGatewayResponse(
      imageObject.url,
      options.signal,
      'STOP',
      parsed.error,
      lifecycle,
    );
  }

  const choice = parsed.choices?.[0];
  const content = choice?.message?.content;
  const broadImageContent = [
    content,
    choice?.message?.images,
    choice?.images,
    parsed.data,
    (parsed as Record<string, unknown>).image,
    (parsed as Record<string, unknown>).images,
    (parsed as Record<string, unknown>).result,
    (parsed as Record<string, unknown>).results,
    (parsed as Record<string, unknown>).output,
    (parsed as Record<string, unknown>).outputs,
    (parsed as Record<string, unknown>).artifacts,
    (parsed as Record<string, unknown>).response,
  ];
  const dataUri = extractDataUriFromOpenAiContent(broadImageContent);
  const finishReason = choice?.finish_reason?.toUpperCase() ?? 'STOP';

  if (dataUri) {
    const match = dataUri.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);

    if (match) {
      return buildGatewayImageResponse(match[2], match[1], finishReason, parsed.error);
    }
  }

  const imageUrl = extractImageUrlFromOpenAiContent(broadImageContent);

  if (imageUrl) {
    return fetchImageUrlAsGatewayResponse(
      imageUrl,
      options.signal,
      finishReason,
      parsed.error,
      lifecycle,
    );
  }

  const parsedRecord = parsed as Record<string, unknown>;
  const asyncStatus = extractAsyncImageStatus(parsedRecord);
  const isPendingStatus = /^(accepted|created|queued|pending|processing|running|submitted|in[_ -]?progress)$/i.test(asyncStatus);
  if (
    options.expectImage &&
    (options.responseStatus === 202 || isPendingStatus)
  ) {
    const hasPollingAddress = hasAsyncPollingAddress(parsedRecord, options.responseHeaders);
    throw new AsyncImageResponseError(
      hasPollingAddress
        ? `上游已受理异步生图任务（状态：${safeLogText(asyncStatus || '202 Accepted', 80)}）并提供了状态查询地址，但未声明通用的鉴权和终态格式。本地不会猜测轮询协议，也不会重新提交 POST，以避免重复扣费。`
        : `上游已受理异步生图任务（状态：${safeLogText(asyncStatus || '202 Accepted', 80)}），但没有返回图片或可轮询地址。本地不会重新提交 POST，以避免重复扣费。`,
    );
  }

  const text = extractTextFromOpenAiContent(
    content ?? parsedRecord.output ?? parsedRecord.result ?? parsedRecord.message ?? parsedRecord.content,
  );

  if (text) {
    return buildGatewayTextResponse(text, finishReason, parsed.error);
  }

  return parsed.error ? ({ error: parsed.error } satisfies GatewayGenerateResponse) : null;
}

function getAsyncPollDelayMs(headers: Headers, attempt: number) {
  const retryAfter = headers.get('retry-after')?.trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, ASYNC_IMAGE_POLL_MAX_DELAY_MS);
    }
    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) {
      return Math.min(
        Math.max(0, retryAt - Date.now()),
        ASYNC_IMAGE_POLL_MAX_DELAY_MS,
      );
    }
  }
  return Math.min(1_000 * 1.5 ** Math.max(0, attempt - 1), ASYNC_IMAGE_POLL_MAX_DELAY_MS);
}

async function pollAsyncImageResponse({
  initialRawText,
  initialResponse,
  requestUrl,
  requestHeaders,
  signal,
  requestId,
  model,
  upstreamTimeoutMs,
}: {
  initialRawText: string;
  initialResponse: Response;
  requestUrl: string;
  requestHeaders: HeadersInit;
  signal?: AbortSignal;
  requestId: string;
  model: string;
  upstreamTimeoutMs: number;
}) {
  let parsed: unknown = null;
  try {
    parsed = initialRawText ? JSON.parse(initialRawText) : null;
  } catch {
    parsed = null;
  }
  const initialAddress = extractAsyncPollingAddress(
    parsed,
    initialResponse.headers,
  );
  if (!initialAddress) {
    throw new AsyncImageResponseError(
      '上游已受理异步生图任务，但没有提供可恢复的状态查询地址；不会重新提交 POST，以避免重复扣费。',
    );
  }

  const originalRequestUrl = new URL(requestUrl);
  const resolvePollUrl = (address: string, baseUrl: string) => {
    const candidate = new URL(address, baseUrl);
    if (
      originalRequestUrl.protocol === 'https:' &&
      candidate.protocol !== 'https:'
    ) {
      throw new AsyncImageResponseError(
        '异步生图状态地址尝试从 HTTPS 降级，已停止轮询且不会重新提交 POST。',
      );
    }
    return candidate.toString();
  };
  let pollUrl = resolvePollUrl(initialAddress, requestUrl);
  let previousHeaders = initialResponse.headers;

  for (let attempt = 1; attempt <= MAX_ASYNC_IMAGE_POLL_ATTEMPTS; attempt += 1) {
    await waitForRemoteImageRetry(
      getAsyncPollDelayMs(previousHeaders, attempt),
      signal,
    );
    const currentPollUrl = new URL(pollUrl);
    const headers =
      currentPollUrl.origin === originalRequestUrl.origin
        ? new Headers(requestHeaders)
        : new Headers();
    headers.delete('content-length');
    headers.delete('content-type');
    headers.delete('idempotency-key');
    headers.set('accept', 'application/json,image/*;q=0.9');
    const { upstreamResponse, rawText } = await requestGenerateUpstream(
      requestId,
      model,
      pollUrl,
      {
        method: 'GET',
        headers,
        redirect: 'error',
        signal,
        upstreamTimeoutMs,
      },
      '异步生图状态地址',
    );
    previousHeaders = upstreamResponse.headers;
    let pollPayload: unknown = null;
    try {
      pollPayload = rawText ? JSON.parse(rawText) : null;
    } catch {
      pollPayload = null;
    }
    const directGatewayResponse = tryParseGatewayResponse(rawText);
    if (
      directGatewayResponse &&
      summarizeGatewayResponse(directGatewayResponse).hasImage
    ) {
      return directGatewayResponse;
    }

    try {
      const normalized = await normalizeOpenAiCompatibleResponse(rawText, {
        signal,
        responseStatus: upstreamResponse.status,
        responseHeaders: upstreamResponse.headers,
        expectImage: true,
        requestId,
        model,
      });
      if (normalized && summarizeGatewayResponse(normalized).hasImage) {
        return normalized;
      }
    } catch (error) {
      if (!(error instanceof AsyncImageResponseError)) throw error;
    }

    const asyncStatus = extractAsyncImageStatus(pollPayload);
    if (/^(?:failed|failure|cancelled|canceled|rejected|error|expired)$/i.test(asyncStatus)) {
      throw new AsyncImageResponseError(
        `上游异步生图任务已结束但没有图片（状态：${safeLogText(asyncStatus, 80)}）；不会重新提交 POST。`,
      );
    }
    if (
      !upstreamResponse.ok &&
      upstreamResponse.status !== 404 &&
      upstreamResponse.status !== 408 &&
      upstreamResponse.status !== 425 &&
      upstreamResponse.status !== 429 &&
      upstreamResponse.status < 500
    ) {
      throw new AsyncImageResponseError(
        `异步生图状态查询失败 (${upstreamResponse.status})；不会重新提交 POST。`,
      );
    }

    const nextAddress = extractAsyncPollingAddress(
      pollPayload,
      upstreamResponse.headers,
    );
    if (nextAddress) {
      pollUrl = resolvePollUrl(nextAddress, pollUrl);
    }
  }

  throw new AsyncImageResponseError(
    `上游异步生图任务在 ${MAX_ASYNC_IMAGE_POLL_ATTEMPTS} 次状态查询后仍未返回图片；本地不会重新提交 POST。`,
  );
}

function isExplicitTransportUnsupportedStatus(status: number) {
  return status === 404 || status === 405 || status === 415;
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

function buildUpstreamErrorMessage(status: number, rawText: string, apiBaseUrl?: string) {
  const upstreamMessage = extractUpstreamErrorMessage(rawText);

  if (status === 429) {
    const message = upstreamMessage || '上游返回 429，当前通道限流，请稍后重试。';
    return apiBaseUrl && isYunwuBaseUrl(apiBaseUrl)
      ? buildYunwuFriendlyErrorMessage(status, message)
      : message;
  }

  if (status === 404 || status === 405 || status === 415) {
    return upstreamMessage || `当前兼容路径不可用 (${status})。`;
  }

  if (status >= 500) {
    const message = upstreamMessage || `上游服务暂时不可用 (${status})，请稍后重试。`;
    return apiBaseUrl && isYunwuBaseUrl(apiBaseUrl)
      ? buildYunwuFriendlyErrorMessage(status, message)
      : message;
  }

  return upstreamMessage || `上游请求失败 (${status})。`;
}

function buildUpstreamErrorResponse(
  requestId: string,
  upstreamResponse: Response,
  rawText: string,
  rawBodyForError = rawText,
  apiBaseUrl?: string,
) {
  const message = buildUpstreamErrorMessage(upstreamResponse.status, rawBodyForError, apiBaseUrl);
  const upstreamUnavailable = Boolean(
    apiBaseUrl &&
      isYunwuBaseUrl(apiBaseUrl) &&
      (isYunwuUnavailableMessage(message) || isYunwuUnavailableMessage(rawBodyForError)),
  );
  const status = upstreamUnavailable ? 503 : upstreamResponse.status;

  return NextResponse.json(
    {
      error: {
        message,
      },
    },
    {
      status,
      headers: {
        ...buildDebugHeaders(
          requestId,
          upstreamResponse.headers.get('retry-after'),
        ),
        ...(upstreamUnavailable ? { 'X-Upstream-Availability': 'unavailable' } : {}),
      },
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
      status: 422,
      headers: {
        ...buildDebugHeaders(requestId),
        'X-Image-Retry-Safety': 'do-not-regenerate',
      },
    },
  );
}

function buildPostGenerationFailureResponse(requestId: string, error: Error) {
  return NextResponse.json(
    {
      error: {
        message: safeLogText(error.message, 600),
      },
    },
    {
      status: 422,
      headers: {
        ...buildDebugHeaders(requestId),
        'X-Image-Retry-Safety': 'do-not-regenerate',
      },
    },
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
    /fetch failed|network|socket hang up|connection reset|econnreset|ecanceled|timeout|timed out|etimedout|超时|连接提前关闭|传输完成前中断/i.test(
      error.message,
    )
  );
}

export async function POST(request: Request) {
  const requestId =
    normalizeCorrelationId(request.headers.get('x-xobi-request-id'), 160) ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  let lifecycleModel = '';
  let lifecycleTarget: URL | undefined;
  let lifecycleOperationId = normalizeCorrelationId(
    request.headers.get('x-xobi-operation-id'),
  );
  let releaseImageRequestSlot: (() => void) | undefined;

  try {
    let body: Partial<GatewayGenerateRequest>;

    try {
      body = (await readRequestJsonWithLimit(
        request,
        MAX_GENERATE_REQUEST_BODY_BYTES,
      )) as Partial<GatewayGenerateRequest>;
    } catch (error) {
      if (isAbortLikeError(error)) throw error;
      const message = error instanceof Error ? error.message : '请求体 JSON 格式无效。';
      return errorResponse(
        message.includes('请求体太大') ? message : '请求体 JSON 格式无效。',
        message.includes('请求体太大') ? 413 : 400,
      );
    }

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

    lifecycleOperationId =
      normalizeCorrelationId(body.operationId) || lifecycleOperationId;

    try {
      validateInlineImageParts(body.parts);
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : '请求图片无效。');
    }

    const settings = normalizeSettings(body.settings);
    try {
      await validateApiBaseUrlTarget(settings.apiBaseUrl);
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : 'API Base URL 不安全。');
    }
    const logPrefix = createLogPrefix(requestId);
    const upstreamTimeoutMs = getGatewayUpstreamTimeoutMs(body, settings);
    const targetUrl = buildGatewayUrl(settings.apiBaseUrl, body.model, settings);
    const target = new URL(targetUrl);
    lifecycleModel = body.model.trim();
    lifecycleTarget = target;
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
    const attemptedImageTransports = new Set<string>();
    let tryOpenAiChat = shouldUseOpenAiImagePath(body, settings);

    console.log(`${logPrefix} 开始请求`);
    console.log(
      `${logPrefix} 请求分类: ${safeLogText(toChineseDebugLabel(body.debugLabel), 160)}`,
    );
    console.log(`${logPrefix} 模型名称: ${safeLogText(body.model.trim(), 120)}`);
    console.log(`${logPrefix} 请求地址: ${target.origin}${safeUpstreamPath(target.pathname)}`);
    console.log(`${logPrefix} 自定义请求配置: 请求头 ${requestConfigSummary.headerCount} 项，URL 参数 ${requestConfigSummary.queryCount} 项`);
    console.log(`${logPrefix} 内容格式: ${toChineseContentsMode(body.contentsMode)}`);
    console.log(
      `${logPrefix} 文本片段数: ${partSummary.textParts}，图片片段数: ${partSummary.imageParts}`,
    );
    await appendGenerateLifecycleLog({
      requestId,
      stage: 'request-start',
      operationId: lifecycleOperationId,
      model: lifecycleModel,
      upstreamUrl: target,
      status: isImageRequest(body) ? 'image' : 'text',
    });

    if (isImageRequest(body)) {
      releaseImageRequestSlot = await acquireGlobalImageRequestSlot(request.signal);
    }

    if (shouldUseOpenAiImagesPath(body)) {
      if (attemptedImageTransports.has('openai-images')) {
        throw new Error('检测到重复的 OpenAI Images 传输提交，已停止。');
      }
      attemptedImageTransports.add('openai-images');
      const imagesPayload = buildOpenAiImagesPayload(body);
      const imagesUrl = buildOpenAiImagesUrl(
        settings.apiBaseUrl,
        imagesPayload.endpoint,
        settings,
      );
      const imagesTarget = new URL(imagesUrl);
      const imagesHeaders = buildGenerateUpstreamHeaders(settings, body);

      if (imagesPayload.body instanceof FormData) {
        delete imagesHeaders['Content-Type'];
      }

      console.log(
        `${logPrefix} Trying OpenAI Images compatible endpoint: ${imagesTarget.origin}${safeUpstreamPath(imagesTarget.pathname)}`,
      );

      const { upstreamResponse, rawText, rawBodyForError } = await requestGenerateUpstream(
        requestId,
        lifecycleModel,
        imagesUrl,
        {
          method: 'POST',
          headers: imagesHeaders,
          body: imagesPayload.body,
          redirect: 'error',
          signal: request.signal,
          upstreamTimeoutMs,
        },
        'OpenAI Images 上游地址',
      );
      let normalized: GatewayGenerateResponse | null = null;

      try {
        normalized = await normalizeOpenAiCompatibleResponse(rawText, {
          signal: request.signal,
          responseStatus: upstreamResponse.status,
          responseHeaders: upstreamResponse.headers,
          expectImage: true,
          requestId,
          model: lifecycleModel,
        });
      } catch (error) {
        if (isAbortLikeError(error)) throw error;
        await appendGenerateLifecycleLog({
          requestId,
          stage: 'normalize-error',
          model: lifecycleModel,
          upstreamUrl: imagesTarget,
          status: upstreamResponse.status,
          durationMs: Date.now() - startedAt,
          error,
        });
        if (error instanceof AsyncImageResponseError) {
          try {
            normalized = await pollAsyncImageResponse({
              initialRawText: rawText,
              initialResponse: upstreamResponse,
              requestUrl: imagesUrl,
              requestHeaders: imagesHeaders,
              signal: request.signal,
              requestId,
              model: lifecycleModel,
              upstreamTimeoutMs,
            });
          } catch (pollError) {
            if (isAbortLikeError(pollError)) throw pollError;
            return buildPostGenerationFailureResponse(
              requestId,
              pollError instanceof Error ? pollError : error,
            );
          }
        } else if (error instanceof PostGenerationImageFetchError) {
          return buildPostGenerationFailureResponse(requestId, error);
        } else {
          return buildInvalidUpstreamResponse(
            requestId,
            error instanceof Error ? error.message : '上游返回了无法解析的图片响应。',
            rawText,
          );
        }
      }

      const responseSummary = summarizeGatewayResponse(normalized);
      const durationMs = Date.now() - startedAt;

      console.log(`${logPrefix} OpenAI Images request completed`);
      console.log(`${logPrefix} Upstream status: ${upstreamResponse.status}`);
      console.log(`${logPrefix} Request duration: ${durationMs}ms`);
      console.log(`${logPrefix} Finish reason: ${toChineseFinishReasons(responseSummary.finishReasons)}`);
      console.log(`${logPrefix} Returned image: ${responseSummary.hasImage ? 'yes' : 'no'}`);
      if (responseSummary.errorMessage) {
        console.log(`${logPrefix} Upstream error: ${safeLogText(responseSummary.errorMessage)}`);
      }

      if (normalized && responseSummary.hasImage) {
        await appendGenerateLifecycleLog({
          requestId,
          stage: 'request-complete',
          model: lifecycleModel,
          upstreamUrl: imagesTarget,
          status: upstreamResponse.status,
          durationMs,
        });
        return NextResponse.json(normalized, {
          status: 200,
          headers: {
            'X-Debug-Request-Id': requestId,
          },
        });
      }

      if (upstreamResponse.ok) {
        await appendGenerateLifecycleLog({
          requestId,
          stage: 'request-invalid-response',
          model: lifecycleModel,
          upstreamUrl: imagesTarget,
          status: 422,
          durationMs,
          error: 'OpenAI Images 接口未返回可解析图片。',
        });
        return buildInvalidUpstreamResponse(
          requestId,
          'OpenAI Images 接口返回了无法解析的图片响应。',
          rawText,
        );
      }

      if (!isExplicitTransportUnsupportedStatus(upstreamResponse.status)) {
        await appendGenerateLifecycleLog({
          requestId,
          stage: 'request-upstream-error',
          model: lifecycleModel,
          upstreamUrl: imagesTarget,
          status: upstreamResponse.status,
          durationMs,
          error: `upstream HTTP ${upstreamResponse.status}`,
        });
        return buildUpstreamErrorResponse(requestId, upstreamResponse, rawText, rawBodyForError, settings.apiBaseUrl);
      }

      const unsupportedMessage = `OpenAI Images ${imagesPayload.endpoint === 'edits' ? '编辑' : '生成'}接口不可用 (${upstreamResponse.status})。为避免跨接口重复提交和重复扣费，已停止自动兼容尝试；请确认上游支持 /v1/images/${imagesPayload.endpoint}。`;
      await appendGenerateLifecycleLog({
        requestId,
        stage: 'request-transport-unsupported',
        model: lifecycleModel,
        upstreamUrl: imagesTarget,
        status: upstreamResponse.status,
        durationMs,
        error: unsupportedMessage,
      });
      return NextResponse.json(
        { error: { message: unsupportedMessage } },
        {
          status: upstreamResponse.status,
          headers: buildDebugHeaders(requestId),
        },
      );
    }

    if (tryOpenAiChat) {
      if (isImageRequest(body)) {
        if (attemptedImageTransports.has('openai-chat-completions')) {
          throw new Error('检测到重复的 OpenAI Chat 生图传输提交，已停止。');
        }
        attemptedImageTransports.add('openai-chat-completions');
      }
      const openAiUrl = buildOpenAiChatCompletionsUrl(settings.apiBaseUrl, settings);
      const openAiTarget = new URL(openAiUrl);
      const openAiHeaders = buildGenerateUpstreamHeaders(settings, body);

      console.log(
        `${logPrefix} Trying OpenAI chat/completions compatible endpoint: ${openAiTarget.origin}${safeUpstreamPath(openAiTarget.pathname)}`,
      );

      const { upstreamResponse, rawText, rawBodyForError } = await requestGenerateUpstream(
        requestId,
        lifecycleModel,
        openAiUrl,
        {
          method: 'POST',
          headers: openAiHeaders,
          body: JSON.stringify(buildOpenAiImagePayload(body)),
          redirect: 'error',
          signal: request.signal,
          upstreamTimeoutMs,
        },
        'OpenAI 兼容上游地址',
      );
      let normalized: GatewayGenerateResponse | null = null;

      try {
        normalized = await normalizeOpenAiCompatibleResponse(rawText, {
          signal: request.signal,
          responseStatus: upstreamResponse.status,
          responseHeaders: upstreamResponse.headers,
          expectImage: isImageRequest(body),
          requestId,
          model: lifecycleModel,
        });
      } catch (error) {
        if (isAbortLikeError(error)) throw error;
        await appendGenerateLifecycleLog({
          requestId,
          stage: 'normalize-error',
          model: lifecycleModel,
          upstreamUrl: openAiTarget,
          status: upstreamResponse.status,
          durationMs: Date.now() - startedAt,
          error,
        });
        if (error instanceof AsyncImageResponseError && isImageRequest(body)) {
          try {
            normalized = await pollAsyncImageResponse({
              initialRawText: rawText,
              initialResponse: upstreamResponse,
              requestUrl: openAiUrl,
              requestHeaders: openAiHeaders,
              signal: request.signal,
              requestId,
              model: lifecycleModel,
              upstreamTimeoutMs,
            });
          } catch (pollError) {
            if (isAbortLikeError(pollError)) throw pollError;
            return buildPostGenerationFailureResponse(
              requestId,
              pollError instanceof Error ? pollError : error,
            );
          }
        } else if (
          error instanceof PostGenerationImageFetchError ||
          error instanceof AsyncImageResponseError
        ) {
          return buildPostGenerationFailureResponse(requestId, error);
        } else {
          return buildInvalidUpstreamResponse(
            requestId,
            error instanceof Error ? error.message : '上游返回了无法解析的图片响应。',
            rawText,
          );
        }
      }

      const responseSummary = summarizeGatewayResponse(normalized);
      const durationMs = Date.now() - startedAt;

      console.log(`${logPrefix} OpenAI chat/completions request completed`);
      console.log(`${logPrefix} Upstream status: ${upstreamResponse.status}`);
      console.log(`${logPrefix} Request duration: ${durationMs}ms`);
      console.log(`${logPrefix} Finish reason: ${toChineseFinishReasons(responseSummary.finishReasons)}`);
      console.log(`${logPrefix} Returned image: ${responseSummary.hasImage ? 'yes' : 'no'}`);
      if (responseSummary.errorMessage) {
        console.log(`${logPrefix} Upstream error: ${safeLogText(responseSummary.errorMessage)}`);
      }

      if (
        normalized &&
        ((!isImageRequest(body) && upstreamResponse.ok) ||
          (isImageRequest(body) && responseSummary.hasImage))
      ) {
        await appendGenerateLifecycleLog({
          requestId,
          stage: 'request-complete',
          model: lifecycleModel,
          upstreamUrl: openAiTarget,
          status: upstreamResponse.status,
          durationMs,
        });
        return NextResponse.json(normalized, {
          status: 200,
          headers: {
            'X-Debug-Request-Id': requestId,
          },
        });
      }

      if (upstreamResponse.ok) {
        await appendGenerateLifecycleLog({
          requestId,
          stage: 'request-invalid-response',
          model: lifecycleModel,
          upstreamUrl: openAiTarget,
          status: 422,
          durationMs,
          error: isImageRequest(body)
            ? 'OpenAI 兼容接口未返回可解析图片。'
            : 'OpenAI 兼容接口未返回可解析文本。',
        });
        return buildInvalidUpstreamResponse(
          requestId,
          isImageRequest(body)
            ? 'OpenAI 兼容接口返回了无法解析的图片响应。'
            : 'OpenAI 兼容接口返回了无法解析的文本响应。',
          rawText,
        );
      }

      if (!isExplicitTransportUnsupportedStatus(upstreamResponse.status)) {
        await appendGenerateLifecycleLog({
          requestId,
          stage: 'request-upstream-error',
          model: lifecycleModel,
          upstreamUrl: openAiTarget,
          status: upstreamResponse.status,
          durationMs,
          error: `upstream HTTP ${upstreamResponse.status}`,
        });
        return buildUpstreamErrorResponse(requestId, upstreamResponse, rawText, rawBodyForError, settings.apiBaseUrl);
      }

      if (isImageRequest(body) && body.allowImageTransportFallback === false) {
        const unsupportedMessage = `OpenAI chat/completions 生图接口不可用 (${upstreamResponse.status})。为避免跨接口重复提交和重复扣费，已停止自动切换到 generateContent。`;
        await appendGenerateLifecycleLog({
          requestId,
          stage: 'request-transport-unsupported',
          model: lifecycleModel,
          upstreamUrl: openAiTarget,
          status: upstreamResponse.status,
          durationMs,
          error: unsupportedMessage,
        });
        return NextResponse.json(
          { error: { message: unsupportedMessage } },
          {
            status: upstreamResponse.status,
            headers: buildDebugHeaders(requestId),
          },
        );
      }

      console.log(`${logPrefix} OpenAI chat/completions unavailable, falling back to generateContent`);
    }

    console.log(
      `${logPrefix} 正在尝试 generateContent 地址: ${target.origin}${safeUpstreamPath(target.pathname)}`,
    );

    if (isImageRequest(body)) {
      if (attemptedImageTransports.has('generate-content')) {
        throw new Error('检测到重复的 generateContent 生图传输提交，已停止。');
      }
      attemptedImageTransports.add('generate-content');
    }
    const generateContentHeaders = buildGenerateUpstreamHeaders(settings, body);

    const { upstreamResponse, rawText, rawBodyForError } = await requestGenerateUpstream(
      requestId,
      lifecycleModel,
      targetUrl,
      {
        method: 'POST',
        headers: generateContentHeaders,
        body: JSON.stringify(requestPayload),
        redirect: 'error',
        signal: request.signal,
        upstreamTimeoutMs,
      },
      'generateContent 上游地址',
    );
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
      console.log(`${logPrefix} 上游错误信息: ${safeLogText(responseSummary.errorMessage)}`);
    }

    if (!upstreamResponse.ok) {
      await appendGenerateLifecycleLog({
        requestId,
        stage: 'request-upstream-error',
        model: lifecycleModel,
        upstreamUrl: target,
        status: upstreamResponse.status,
        durationMs,
        error: `upstream HTTP ${upstreamResponse.status}`,
      });
      return buildUpstreamErrorResponse(requestId, upstreamResponse, rawText, rawBodyForError, settings.apiBaseUrl);
    }

    if (!isImageRequest(body)) {
      await appendGenerateLifecycleLog({
        requestId,
        stage: 'request-complete',
        model: lifecycleModel,
        upstreamUrl: target,
        status: upstreamResponse.status,
        durationMs,
      });
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
      await appendGenerateLifecycleLog({
        requestId,
        stage: 'request-complete',
        model: lifecycleModel,
        upstreamUrl: target,
        status: upstreamResponse.status,
        durationMs,
      });
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

    let normalizedGenerateContent: GatewayGenerateResponse | null = null;
    try {
      normalizedGenerateContent = await normalizeOpenAiCompatibleResponse(rawText, {
        signal: request.signal,
        responseStatus: upstreamResponse.status,
        responseHeaders: upstreamResponse.headers,
        expectImage: true,
        requestId,
        model: lifecycleModel,
      });
    } catch (error) {
      if (isAbortLikeError(error)) throw error;
      await appendGenerateLifecycleLog({
        requestId,
        stage: 'normalize-error',
        model: lifecycleModel,
        upstreamUrl: target,
        status: upstreamResponse.status,
        durationMs,
        error,
      });
      if (error instanceof AsyncImageResponseError) {
        try {
          normalizedGenerateContent = await pollAsyncImageResponse({
            initialRawText: rawText,
            initialResponse: upstreamResponse,
            requestUrl: targetUrl,
            requestHeaders: generateContentHeaders,
            signal: request.signal,
            requestId,
            model: lifecycleModel,
            upstreamTimeoutMs,
          });
        } catch (pollError) {
          if (isAbortLikeError(pollError)) throw pollError;
          return buildPostGenerationFailureResponse(
            requestId,
            pollError instanceof Error ? pollError : error,
          );
        }
      } else if (error instanceof PostGenerationImageFetchError) {
        return buildPostGenerationFailureResponse(requestId, error);
      }
    }

    const normalizedGenerateContentSummary = summarizeGatewayResponse(
      normalizedGenerateContent,
    );
    if (
      normalizedGenerateContent &&
      normalizedGenerateContentSummary.hasImage
    ) {
      await appendGenerateLifecycleLog({
        requestId,
        stage: 'request-complete',
        model: lifecycleModel,
        upstreamUrl: target,
        status: upstreamResponse.status,
        durationMs,
      });
      return NextResponse.json(normalizedGenerateContent, {
        status: 200,
        headers: buildDebugHeaders(requestId),
      });
    }

    await appendGenerateLifecycleLog({
      requestId,
      stage: 'request-invalid-response',
      model: lifecycleModel,
      upstreamUrl: target,
      status: 422,
      durationMs,
      error: 'generateContent 未返回可解析图片。',
    });

    return buildInvalidUpstreamResponse(
      requestId,
      parsed?.error?.message ?? '上游返回了无法解析的图片响应。',
      rawText,
    );
  } catch (error) {
    if (error instanceof PostGenerationImageFetchError || error instanceof AsyncImageResponseError) {
      await appendGenerateLifecycleLog({
        requestId,
        stage: 'request-post-generation-error',
        model: lifecycleModel,
        upstreamUrl: lifecycleTarget,
        status: 422,
        durationMs: Date.now() - startedAt,
        error,
      });
      return buildPostGenerationFailureResponse(requestId, error);
    }

    if (isAbortLikeError(error)) {
      console.log(`${createLogPrefix(requestId)} 请求已被前端取消或超时`);
      await appendGenerateLifecycleLog({
        requestId,
        stage: 'request-aborted',
        model: lifecycleModel,
        upstreamUrl: lifecycleTarget,
        status: 499,
        durationMs: Date.now() - startedAt,
        error: '请求已被前端取消或超时。',
      });
      return new Response(null, {
        status: 499,
        headers: buildDebugHeaders(requestId),
      });
    }

    if (isNetworkLikeError(error)) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const publicMessage = /timeout|timed out|etimedout|超时/i.test(errorMessage)
        ? '上游连接超时，请调高生图超时或稍后重试。'
        : '上游连接失败，请稍后重试。';
      console.error(`${createLogPrefix(requestId)} 上游网络异常`);
      console.error(
        `${createLogPrefix(requestId)} ${safeLogText(errorMessage)}`,
      );
      await appendGenerateLifecycleLog({
        requestId,
        stage: 'request-network-error',
        model: lifecycleModel,
        upstreamUrl: lifecycleTarget,
        status: 502,
        durationMs: Date.now() - startedAt,
        error: publicMessage,
      });
      return NextResponse.json(
        {
          error: {
            message: publicMessage,
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
      `${createLogPrefix(requestId)} ${safeLogText(error instanceof Error ? error.message : String(error))}`,
    );
    await appendGenerateLifecycleLog({
      requestId,
      stage: 'request-error',
      model: lifecycleModel,
      upstreamUrl: lifecycleTarget,
      status: 500,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
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
  } finally {
    releaseImageRequestSlot?.();
  }
}
