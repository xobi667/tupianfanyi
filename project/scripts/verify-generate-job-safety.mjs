import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.XOBI_BASE_URL || 'http://127.0.0.1:3006';
const resourceDir = process.env.IMAGE_TRANSLATOR_RESOURCE_DIR
  ? path.resolve(process.env.IMAGE_TRANSLATOR_RESOURCE_DIR)
  : path.resolve(process.cwd(), '..', '资源');
const jobDir = path.join(resourceDir, '系统日志', 'generate-jobs');
const pngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2S8AAAAASUVORK5CYII=';

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function artifactPaths(operationId) {
  const fileId = digest(operationId);
  return [
    path.join(jobDir, `${fileId}.json`),
    path.join(jobDir, `${fileId}.result.json`),
    path.join(jobDir, `${fileId}.claim`),
  ];
}

async function cleanup(operationId) {
  await Promise.all(
    artifactPaths(operationId).map((filePath) =>
      fs.rm(filePath, { force: true }).catch(() => undefined),
    ),
  );
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

async function testConcurrentIdempotency() {
  const operationId = `verify_idempotency_${Date.now()}`;
  const payload = {
    operationId,
    requestKind: 'image',
    model: 'gpt-image-1',
    parts: [{ text: 'local idempotency test; never contact a paid API' }],
    contentsMode: 'role_parts',
    settings: {
      apiBaseUrl: 'http://127.0.0.1:9/v1',
      requestHeadersText: '{}',
      requestQueryParamsText: '{}',
      textModel: 'test-text',
      imageModel: 'gpt-image-1',
      maxParallelTasks: 1,
      imageRequestTimeoutMs: 1000,
    },
  };
  const submit = () =>
    fetch(`${baseUrl}/api/generate-job`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-image-translator-request': 'mutation',
      },
      body: JSON.stringify(payload),
    });

  try {
    const responses = await Promise.all(Array.from({ length: 10 }, submit));
    const bodies = await Promise.all(responses.map(readJson));
    if (responses.some((response) => !response.ok && response.status !== 202)) {
      throw new Error(`并发提交出现异常状态：${responses.map((item) => item.status).join(',')}`);
    }
    const createdAtValues = new Set(
      bodies.map((body) => body?.job?.createdAt).filter(Number.isFinite),
    );
    if (createdAtValues.size !== 1) {
      throw new Error('同一 operationId 被创建成了多个任务。');
    }

    let terminal;
    for (let index = 0; index < 40; index += 1) {
      const response = await fetch(
        `${baseUrl}/api/generate-job?id=${encodeURIComponent(operationId)}`,
        { cache: 'no-store' },
      );
      terminal = await readJson(response);
      if (terminal?.job?.status !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (terminal?.job?.status !== 'failed') {
      throw new Error(`无付费测试任务没有按预期安全失败：${terminal?.job?.status}`);
    }

    const mismatch = await fetch(`${baseUrl}/api/generate-job`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-image-translator-request': 'mutation',
      },
      body: JSON.stringify({ ...payload, model: 'different-model' }),
    });
    if (mismatch.status !== 409) {
      throw new Error(`不同请求复用 operationId 未被拒绝：${mismatch.status}`);
    }

    const acknowledge = await fetch(
      `${baseUrl}/api/generate-job?id=${encodeURIComponent(operationId)}`,
      {
        method: 'DELETE',
        headers: { 'x-image-translator-request': 'mutation' },
      },
    );
    if (!acknowledge.ok) {
      throw new Error(`任务确认失败：${acknowledge.status}`);
    }

    const repeated = await submit();
    const repeatedBody = await readJson(repeated);
    if (repeatedBody?.job?.status !== 'acknowledged') {
      throw new Error('已确认的 operationId 被再次执行。');
    }
  } finally {
    await cleanup(operationId);
  }
}

async function writePreparedFixture(
  operationId,
  { corruptHash = false, mimeType = 'image/png' } = {},
) {
  await fs.mkdir(jobDir, { recursive: true });
  const [metadataPath, resultPath] = artifactPaths(operationId);
  const response = {
    candidates: [
      {
        finishReason: 'STOP',
        content: {
          parts: [{ inlineData: { mimeType, data: pngBase64 } }],
        },
      },
    ],
  };
  const resultText = JSON.stringify(response);
  const staleAt = Date.now() - 120_000;
  const resultSha256 = digest(resultText);
  const metadata = {
    id: operationId,
    status: 'running',
    createdAt: staleAt,
    updatedAt: staleAt,
    heartbeatAt: staleAt,
    requestHash: digest(`request:${operationId}`),
    hasResponse: false,
    resultState: 'prepared',
    resultBytes: Buffer.byteLength(resultText, 'utf8'),
    resultSha256: corruptHash ? '0'.repeat(64) : resultSha256,
  };
  await fs.writeFile(resultPath, resultText, 'utf8');
  await fs.writeFile(metadataPath, JSON.stringify(metadata), 'utf8');
  return { resultText };
}

async function testPreparedResultRecovery() {
  const operationId = `verify_recovery_${Date.now()}`;
  try {
    const { resultText } = await writePreparedFixture(operationId);
    const statusResponse = await fetch(
      `${baseUrl}/api/generate-job?id=${encodeURIComponent(operationId)}`,
      { cache: 'no-store' },
    );
    const statusBody = await readJson(statusResponse);
    if (statusBody?.job?.status !== 'completed') {
      throw new Error(`完整的 prepared 结果未恢复：${statusBody?.job?.status}`);
    }
    const resultResponse = await fetch(
      `${baseUrl}/api/generate-job?id=${encodeURIComponent(operationId)}&result=1`,
      { cache: 'no-store' },
    );
    const recoveredText = await resultResponse.text();
    if (!resultResponse.ok || digest(recoveredText) !== digest(resultText)) {
      throw new Error('恢复结果与原始结果不一致。');
    }
  } finally {
    await cleanup(operationId);
  }
}

async function testCorruptPreparedResultFailsClosed() {
  const operationId = `verify_corrupt_${Date.now()}`;
  try {
    await writePreparedFixture(operationId, { corruptHash: true });
    const response = await fetch(
      `${baseUrl}/api/generate-job?id=${encodeURIComponent(operationId)}`,
      { cache: 'no-store' },
    );
    const body = await readJson(response);
    if (body?.job?.status !== 'interrupted') {
      throw new Error(`摘要不匹配的结果未安全阻断：${body?.job?.status}`);
    }
  } finally {
    await cleanup(operationId);
  }
}

async function testMismatchedMimeFailsClosed() {
  const operationId = `verify_mime_${Date.now()}`;
  try {
    await writePreparedFixture(operationId, { mimeType: 'image/jpeg' });
    const response = await fetch(
      `${baseUrl}/api/generate-job?id=${encodeURIComponent(operationId)}`,
      { cache: 'no-store' },
    );
    const body = await readJson(response);
    if (body?.job?.status !== 'interrupted') {
      throw new Error(`MIME 与文件头不一致的结果未安全阻断：${body?.job?.status}`);
    }
  } finally {
    await cleanup(operationId);
  }
}

await testConcurrentIdempotency();
await testPreparedResultRecovery();
await testCorruptPreparedResultFailsClosed();
await testMismatchedMimeFailsClosed();
console.log('generate-job 安全验证通过：并发幂等、prepared 恢复、损坏结果阻断均正常。');
