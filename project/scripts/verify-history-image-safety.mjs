import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.XOBI_BASE_URL || 'http://127.0.0.1:3006';
const resourceDir = process.env.IMAGE_TRANSLATOR_RESOURCE_DIR
  ? path.resolve(process.env.IMAGE_TRANSLATOR_RESOURCE_DIR)
  : path.resolve(process.cwd(), '..', '资源');
const taskId = `verify_history_${Date.now()}`;

async function postHistory(action, payload) {
  const response = await fetch(`${baseUrl}/api/history`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-image-translator-request': 'mutation',
      Origin: baseUrl,
      'sec-fetch-site': 'same-origin',
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error?.message ?? `history ${action} failed: ${response.status}`);
  }
  return body;
}

function testPngBytes(seed) {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    seed, seed + 1, seed + 2, seed + 3,
  ]);
}

try {
  const created = await postHistory('upsert-task', {
    task: {
      id: taskId,
      name: 'xobi history safety verification',
      language: '中文',
      ratio: '原图',
      mode: 'translate_only',
    },
    images: [
      { id: 'first', name: 'foo.jpg', relativePath: 'foo.jpg', outputRelativePath: 'foo.png', groupLabel: '单独上传', status: 'idle', phase: 'idle', sourceKind: 'file', pathKey: 'first' },
      { id: 'second', name: 'foo.webp', relativePath: 'foo.webp', outputRelativePath: 'foo.png', groupLabel: '单独上传', status: 'idle', phase: 'idle', sourceKind: 'file', pathKey: 'second' },
      { id: 'avif', name: 'modern', relativePath: 'modern', outputRelativePath: 'modern', groupLabel: '单独上传', status: 'idle', phase: 'idle', sourceKind: 'file', pathKey: 'avif' },
      { id: 'jpg', name: 'photo', relativePath: 'photo', outputRelativePath: 'photo', groupLabel: '单独上传', status: 'idle', phase: 'idle', sourceKind: 'file', pathKey: 'jpg' },
      { id: 'orphan', name: 'orphan.jpg', relativePath: 'orphan.jpg', outputRelativePath: 'orphan.jpg', groupLabel: '单独上传', status: 'idle', phase: 'idle', sourceKind: 'file', pathKey: 'orphan' },
    ],
  });

  const firstBytes = testPngBytes(1);
  const secondBytes = testPngBytes(21);
  const first = await postHistory('save-image', {
    taskId,
    imageId: 'first',
    kind: 'result',
    relativePath: 'foo.png',
    dataUrl: `data:image/png;base64,${firstBytes.toString('base64')}`,
  });
  const second = await postHistory('save-image', {
    taskId,
    imageId: 'second',
    kind: 'result',
    relativePath: 'foo.png',
    dataUrl: `data:image/png;base64,${secondBytes.toString('base64')}`,
  });
  if (!first.path || !second.path || first.path.toLowerCase() === second.path.toLowerCase()) {
    throw new Error('同名结果没有分配独立存储路径。');
  }
  const storedFirst = await fs.readFile(path.join(resourceDir, first.path));
  const storedSecond = await fs.readFile(path.join(resourceDir, second.path));
  if (!storedFirst.equals(firstBytes) || !storedSecond.equals(secondBytes)) {
    throw new Error('同名结果保存后内容不一致或发生覆盖。');
  }
  const replacementBytes = testPngBytes(41);
  const replaced = await postHistory('save-image', {
    taskId,
    imageId: 'first',
    kind: 'result',
    relativePath: 'foo.png',
    dataUrl: `data:image/png;base64,${replacementBytes.toString('base64')}`,
  });
  const storedReplacement = await fs.readFile(path.join(resourceDir, replaced.path));
  if (replaced.path !== first.path || !storedReplacement.equals(replacementBytes)) {
    throw new Error('同一图片重新保存时没有原子替换原结果。');
  }

  const avifBytes = Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
    0x61, 0x76, 0x69, 0x66, 0x00, 0x00, 0x00, 0x00,
  ]);
  const avif = await postHistory('save-image', {
    taskId,
    imageId: 'avif',
    kind: 'result',
    relativePath: 'modern',
    dataUrl: `data:image/avif;base64,${avifBytes.toString('base64')}`,
  });
  if (!String(avif.path).toLowerCase().endsWith('.avif')) {
    throw new Error('无扩展名 AVIF 结果没有补齐正确扩展名。');
  }

  const readAvif = await fetch(
    `${baseUrl}/api/history?taskId=${encodeURIComponent(taskId)}&imageId=avif&kind=result&includeData=1`,
    { cache: 'no-store' },
  );
  const readAvifBody = await readAvif.json();
  if (!readAvif.ok || !readAvifBody?.image?.resultDataUrl?.startsWith('data:image/avif;base64,')) {
    throw new Error('AVIF 历史结果读取 MIME 不正确。');
  }

  const jpegBytes = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
    0x49, 0x46, 0x00, 0x01, 0xff, 0xd9,
  ]);
  const jpeg = await postHistory('save-image', {
    taskId,
    imageId: 'jpg',
    kind: 'result',
    relativePath: 'photo',
    dataUrl: `data:image/jpg;base64,${jpegBytes.toString('base64')}`,
  });
  if (!String(jpeg.path).toLowerCase().endsWith('.jpg')) {
    throw new Error('image/jpg 别名没有规范化为 JPEG/.jpg。');
  }
  let mismatchedMimeRejected = false;
  try {
    await postHistory('save-image', {
      taskId,
      imageId: 'jpg',
      kind: 'result',
      relativePath: 'wrong.jpg',
      dataUrl: `data:image/jpeg;base64,${firstBytes.toString('base64')}`,
    });
  } catch {
    mismatchedMimeRejected = true;
  }
  if (!mismatchedMimeRejected) {
    throw new Error('声明 MIME 与文件头不一致的图片未被拒绝。');
  }

  const orphanOwner = createHash('sha256').update('orphan').digest('hex').slice(0, 16);
  const orphanRelativePath = `${created.task.storageDirName}/results/orphan.xobi-${orphanOwner}.png`;
  const orphanBytes = testPngBytes(61);
  await fs.mkdir(path.dirname(path.join(resourceDir, orphanRelativePath)), {
    recursive: true,
  });
  await fs.writeFile(path.join(resourceDir, orphanRelativePath), orphanBytes);
  const recoveredOrphan = await fetch(
    `${baseUrl}/api/history?taskId=${encodeURIComponent(taskId)}&imageId=orphan&kind=result&includeData=1`,
    { cache: 'no-store' },
  );
  const recoveredOrphanBody = await recoveredOrphan.json();
  if (
    !recoveredOrphan.ok ||
    recoveredOrphanBody?.image?.resultPath !== orphanRelativePath ||
    !recoveredOrphanBody?.image?.resultDataUrl?.startsWith('data:image/png;base64,')
  ) {
    throw new Error('结果已写入但 manifest 未提交时未能按 imageId 自动恢复。');
  }
} finally {
  await postHistory('delete-task', { taskId }).catch(() => undefined);
}

console.log('history 图片安全验证通过：同名不覆盖、原子内容一致、AVIF 扩展与读取正常。');
