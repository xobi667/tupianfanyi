import { NextResponse } from 'next/server';
import {
  buildGatewayHeaders,
  buildGatewayUrl,
  normalizeSettings,
  type GatewayGenerateRequest,
  type GatewayGenerateResponse,
} from '@/lib/gateway';

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

function toChineseAuthMode(authMode: string) {
  if (authMode === 'x-goog-api-key') return '官方请求头 x-goog-api-key';
  if (authMode === 'bearer') return 'Authorization: Bearer';
  if (authMode === 'custom') return '自定义请求头';
  if (authMode === 'query') return 'URL 参数';
  return authMode;
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

function shouldUseOpenAiImagePath(
  body: Partial<GatewayGenerateRequest>,
  settings: ReturnType<typeof normalizeSettings>,
) {
  return isImageRequest(body) && settings.authMode === 'bearer';
}

function buildOpenAiChatCompletionsUrl(apiBaseUrl: string) {
  const baseUrl = apiBaseUrl.trim().replace(/\/+$/, '');

  if (/\/chat\/completions$/i.test(baseUrl)) {
    return baseUrl;
  }

  const url = new URL(baseUrl);

  if (/\/v\d+(beta)?$/i.test(url.pathname)) {
    url.pathname = `${url.pathname}/chat/completions`;
    return url.toString();
  }

  if (/\/v\d+(beta)?\/models(?:\/.*)?$/i.test(url.pathname)) {
    url.pathname = url.pathname.replace(/\/models(?:\/.*)?$/i, '/chat/completions');
    return url.toString();
  }

  url.pathname = `${url.pathname.replace(/\/+$/, '')}/chat/completions`;
  return url.toString();
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

function extractDataUriFromOpenAiContent(content: unknown) {
  if (typeof content !== 'string' || !content.trim()) {
    return '';
  }

  const markdownMatch = content.match(/!\[[\s\S]*?\]\((data:image\/[^)]+)\)/i);
  if (markdownMatch?.[1]) {
    return markdownMatch[1];
  }

  if (content.startsWith('data:image/')) {
    return content;
  }

  const cleaned = content
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '');

  try {
    const parsed = JSON.parse(cleaned) as {
      image_base64?: unknown;
      image?: unknown;
      data?: unknown;
      result?: {
        image_base64?: unknown;
        image?: unknown;
        data?: unknown;
      };
    };

    const possibleValues = [
      parsed.image_base64,
      parsed.image,
      parsed.data,
      parsed.result?.image_base64,
      parsed.result?.image,
      parsed.result?.data,
    ];

    const match = possibleValues.find(
      (value): value is string =>
        typeof value === 'string' && value.startsWith('data:image/'),
    );

    return match ?? '';
  } catch {
    return '';
  }
}

function normalizeOpenAiChatResponse(rawText: string) {
  if (!rawText) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawText) as {
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

    const choice = parsed.choices?.[0];
    const content = choice?.message?.content;
    const dataUri = extractDataUriFromOpenAiContent(content);

    if (dataUri) {
      const match = dataUri.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);

      if (match) {
        return {
          candidates: [
            {
              finishReason: choice?.finish_reason?.toUpperCase() ?? 'STOP',
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: match[1],
                      data: match[2],
                    },
                  },
                ],
              },
            },
          ],
        } satisfies GatewayGenerateResponse;
      }
    }

    if (typeof content === 'string') {
      return {
        candidates: [
          {
            finishReason: choice?.finish_reason?.toUpperCase() ?? 'STOP',
            content: {
              parts: [
                {
                  text: content,
                },
              ],
            },
          },
        ],
        error: parsed.error,
      } satisfies GatewayGenerateResponse;
    }

    return parsed.error ? ({ error: parsed.error } satisfies GatewayGenerateResponse) : null;
  } catch {
    return null;
  }
}

function shouldFallbackFromOpenAiImagePath(status: number, rawText: string) {
  return status === 404 || /Invalid URL/i.test(rawText);
}

function buildUrlCandidates(targetUrl: URL) {
  const urls = [targetUrl.toString()];

  if (targetUrl.pathname.includes('/models/')) {
    const fallbackUrl = new URL(targetUrl.toString());
    fallbackUrl.pathname = fallbackUrl.pathname.replace('/models/', '/');

    if (fallbackUrl.toString() !== targetUrl.toString()) {
      urls.push(fallbackUrl.toString());
    }
  }

  return urls;
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

export async function POST(request: Request) {
  const requestId = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  try {
    const body = (await request.json()) as Partial<GatewayGenerateRequest>;

    if (!body || typeof body !== 'object') {
      return errorResponse('Request body is required.');
    }

    if (!body.settings) {
      return errorResponse('Missing settings.');
    }

    if (typeof body.model !== 'string' || !body.model.trim()) {
      return errorResponse('Missing model name.');
    }

    if (!Array.isArray(body.parts) || body.parts.length === 0) {
      return errorResponse('Missing request parts.');
    }

    const settings = normalizeSettings(body.settings, {
      requireApiKey: true,
    });
    const logPrefix = createLogPrefix(requestId);
    const startedAt = Date.now();
    const targetUrl = buildGatewayUrl(settings.apiBaseUrl, body.model, settings);
    const target = new URL(targetUrl);
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
    console.log(`${logPrefix} Key 传递方式: ${toChineseAuthMode(settings.authMode)}`);
    console.log(`${logPrefix} 内容格式: ${toChineseContentsMode(body.contentsMode)}`);
    console.log(
      `${logPrefix} 文本片段数: ${partSummary.textParts}，图片片段数: ${partSummary.imageParts}`,
    );

    if (shouldUseOpenAiImagePath(body, settings)) {
      const openAiUrl = buildOpenAiChatCompletionsUrl(settings.apiBaseUrl);
      const openAiTarget = new URL(openAiUrl);

      console.log(
        `${logPrefix} 正在尝试 OpenAI 兼容图片编辑地址: ${openAiTarget.origin}${openAiTarget.pathname}`,
      );

      const upstreamResponse = await fetch(openAiUrl, {
        method: 'POST',
        headers: buildGatewayHeaders(settings),
        body: JSON.stringify(buildOpenAiImagePayload(body)),
        signal: request.signal,
      });

      const rawText = await upstreamResponse.text();
      const normalized = normalizeOpenAiChatResponse(rawText);
      const responseSummary = summarizeGatewayResponse(normalized);
      const durationMs = Date.now() - startedAt;

      console.log(`${logPrefix} OpenAI 兼容图片编辑请求完成`);
      console.log(`${logPrefix} 上游状态码: ${upstreamResponse.status}`);
      console.log(`${logPrefix} 请求耗时: ${durationMs}ms`);
      console.log(`${logPrefix} 结束原因: ${toChineseFinishReasons(responseSummary.finishReasons)}`);
      console.log(`${logPrefix} 是否返回图片: ${responseSummary.hasImage ? '是' : '否'}`);
      if (responseSummary.errorMessage) {
        console.log(`${logPrefix} 上游错误信息: ${responseSummary.errorMessage}`);
      }

      if (upstreamResponse.ok && normalized) {
        return NextResponse.json(normalized, {
          status: 200,
          headers: {
            'X-Debug-Request-Id': requestId,
          },
        });
      }

      if (!shouldFallbackFromOpenAiImagePath(upstreamResponse.status, rawText)) {
        return new Response(rawText, {
          status: upstreamResponse.status,
          headers: {
            'Content-Type': upstreamResponse.headers.get('content-type') ?? 'application/json',
            'X-Debug-Request-Id': requestId,
          },
        });
      }

      console.log(`${logPrefix} OpenAI 兼容地址不可用，回退到 generateContent`);
    }

    const urlCandidates = buildUrlCandidates(target);
    let lastResponse: Response | null = null;
    let lastRawText = '';

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
        return new Response(rawText, {
          status: upstreamResponse.status,
          headers: {
            'Content-Type': contentType,
            'X-Debug-Request-Id': requestId,
          },
        });
      }

      if (!isImageRequest(body)) {
        return new Response(rawText, {
          status: upstreamResponse.status,
          headers: {
            'Content-Type': contentType,
            'X-Debug-Request-Id': requestId,
          },
        });
      }

      if (responseSummary.hasImage) {
        return new Response(rawText, {
          status: upstreamResponse.status,
          headers: {
            'Content-Type': contentType,
            'X-Debug-Request-Id': requestId,
          },
        });
      }

      lastResponse = upstreamResponse;
      lastRawText = rawText;
    }

    return new Response(lastRawText, {
      status: lastResponse?.status ?? 500,
      headers: {
        'Content-Type': lastResponse?.headers.get('content-type') ?? 'application/json',
        'X-Debug-Request-Id': requestId,
      },
    });
  } catch (error) {
    if (isAbortLikeError(error)) {
      console.log(`${createLogPrefix(requestId)} 请求已被前端取消或超时`);
      return new Response(null, {
        status: 499,
        headers: {
          'X-Debug-Request-Id': requestId,
        },
      });
    }

    console.error(`${createLogPrefix(requestId)} 请求异常`);
    console.error(
      `${createLogPrefix(requestId)} ${error instanceof Error ? error.message : String(error)}`,
    );
    return errorResponse(
      error instanceof Error ? error.message : 'Server request failed.',
      500,
    );
  }
}
