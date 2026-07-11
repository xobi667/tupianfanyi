import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { NextResponse } from 'next/server';
import {
  buildGatewayHeaders,
  normalizeSettings,
  parseRequestQueryParamsText,
  type GatewaySettings,
} from '@/lib/gateway';

export const runtime = 'nodejs';

const PROBE_TIMEOUT_MS = 20_000;
const MAX_PROBE_RESPONSE_BYTES = 1024 * 1024;

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: { message } }, { status });
}

function isUnsafeIpAddress(address: string): boolean {
  const normalized = address.trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  const family = isIP(normalized);

  if (family === 4) {
    const segments = normalized.split('.').map(Number);
    if (segments.length !== 4 || segments.some((value) => !Number.isInteger(value))) return true;
    const [first, second] = segments;
    return first === 0 || first === 10 || first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 100 && second >= 64 && second <= 127);
  }

  if (family === 6) {
    if (normalized === '::' || normalized === '::1') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:')) return true;
    const embeddedIpv4 = normalized.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    return embeddedIpv4 ? isUnsafeIpAddress(embeddedIpv4) : false;
  }

  return false;
}

async function assertPublicTarget(url: URL) {
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error('Base URL 仅支持 http/https。');
  }
  if (url.username || url.password) {
    throw new Error('Base URL 不能包含账号信息。');
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === 'local' || isUnsafeIpAddress(hostname)) {
    throw new Error('Base URL 不能指向本机、内网或链路本地地址。');
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.every(({ address }) => isUnsafeIpAddress(address))) {
    throw new Error('Base URL 不能解析到本机、内网或链路本地地址。');
  }
}

function buildModelsUrl(settings: GatewaySettings) {
  const url = new URL(settings.apiBaseUrl);
  const versionMatch = url.pathname.match(/^(.*?)(\/v\d+(?:beta)?)(?:\/.*)?$/i);

  if (versionMatch) {
    url.pathname = `${versionMatch[1] ?? ''}${versionMatch[2] ?? '/v1'}/models`.replace(/\/{2,}/g, '/');
  } else if (/\/(?:chat\/completions|images\/(?:generations|edits)|responses|models(?:\/.*)?)$/i.test(url.pathname)) {
    url.pathname = url.pathname.replace(
      /\/(?:chat\/completions|images\/(?:generations|edits)|responses|models(?:\/.*)?)$/i,
      '/v1/models',
    );
  } else {
    const prefix = url.pathname.replace(/\/+$/, '');
    url.pathname = `${prefix || ''}/v1/models`.replace(/\/{2,}/g, '/');
  }

  const query = parseRequestQueryParamsText(settings.requestQueryParamsText);
  Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
}

function collectModelIds(value: unknown) {
  if (!value || typeof value !== 'object') return [] as string[];
  const record = value as Record<string, unknown>;
  const candidates = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models)
      ? record.models
      : [];

  return candidates.flatMap((entry) => {
    if (typeof entry === 'string') return [entry.replace(/^models\//, '')];
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    const id = typeof item.id === 'string' ? item.id : typeof item.name === 'string' ? item.name : '';
    return id ? [id.replace(/^models\//, '')] : [];
  });
}

export async function POST(request: Request) {
  let body: { settings?: Partial<GatewaySettings> };
  try {
    body = await request.json() as { settings?: Partial<GatewaySettings> };
  } catch {
    return jsonError('请求格式无效。');
  }

  let settings: GatewaySettings;
  try {
    settings = normalizeSettings(body.settings ?? {}, { requireApiKey: true });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : '连接设置无效。');
  }

  try {
    const url = buildModelsUrl(settings);
    await assertPublicTarget(url);

    const response = await fetch(url, {
      method: 'GET',
      headers: buildGatewayHeaders(settings),
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: 'no-store',
    });

    if (response.status >= 300 && response.status < 400) {
      throw new Error('模型列表接口返回了重定向；为避免秘钥被转发，连接检查已停止。');
    }

    const responseText = await response.text();
    if (Buffer.byteLength(responseText, 'utf8') > MAX_PROBE_RESPONSE_BYTES) {
      throw new Error('模型列表响应过大，连接检查已停止。');
    }

    if (!response.ok) {
      if ([404, 405, 501].includes(response.status)) {
        return NextResponse.json({
          reachable: true,
          modelListSupported: false,
          imageModelFound: null,
          message: `服务可达，但不支持模型列表检查（HTTP ${response.status}）。本次没有调用生图。`,
        });
      }
      const authHint = response.status === 401 || response.status === 403
        ? 'API Key 无效或没有访问权限。'
        : `上游返回 HTTP ${response.status}。`;
      throw new Error(authHint);
    }

    let parsed: unknown = null;
    try {
      parsed = responseText ? JSON.parse(responseText) : null;
    } catch {
      // Some compatible gateways return an empty/non-JSON success body.
    }
    const modelIds = collectModelIds(parsed);
    const imageModel = settings.imageModel.replace(/^models\//, '');
    const imageModelFound = modelIds.length > 0
      ? modelIds.some((modelId) => modelId.toLowerCase() === imageModel.toLowerCase())
      : null;

    return NextResponse.json({
      reachable: true,
      modelListSupported: modelIds.length > 0,
      imageModelFound,
      message: imageModelFound === true
        ? `连接成功，模型列表中已找到「${imageModel}」。本次没有调用生图。`
        : imageModelFound === false
          ? `连接成功，但模型列表未显示「${imageModel}」。请核对模型名；本次没有调用生图。`
          : '连接成功，但服务没有返回可解析的模型列表。本次没有调用生图。',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '连接检查失败。';
    return jsonError(message, 502);
  }
}
