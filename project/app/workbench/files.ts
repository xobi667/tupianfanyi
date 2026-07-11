import {
  getImageExtensionForMimeType,
  getImageMimeTypeForExtension,
  normalizeSupportedImageMimeType,
} from '@/lib/image-formats';

const HISTORY_TASK_ID_PREFIX = 'task';

export const MAX_UPLOAD_BATCH_COUNT = 1000;
export const MAX_SINGLE_IMAGE_SIZE_BYTES = 60 * 1024 * 1024;
export const MAX_UPLOAD_TOTAL_SIZE_BYTES = 256 * 1024 * 1024;
export const UPLOAD_READ_CONCURRENCY = 3;

export function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function normalizeRelativePath(relativePath: string) {
  return relativePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

export function sanitizePathSegment(value: string) {
  return value.trim().replace(/[<>:"\/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').slice(0, 80) || 'history_project';
}

export function getPathKey(relativePath: string) {
  return normalizeRelativePath(relativePath).toLowerCase();
}

export function getSourceFileKey(file: File, sourceKind: 'file' | 'folder') {
  const relativePath =
    sourceKind === 'folder' && file.webkitRelativePath
      ? normalizeRelativePath(file.webkitRelativePath)
      : file.name;

  return [
    sourceKind,
    getPathKey(relativePath),
    file.size,
    file.lastModified,
  ].join('|');
}

export function getTaskPathInfo(file: File, sourceKind: 'file' | 'folder') {
  const rawRelativePath =
    sourceKind === 'folder' && file.webkitRelativePath
      ? normalizeRelativePath(file.webkitRelativePath)
      : file.name;
  const segments = rawRelativePath.split('/').filter(Boolean);
  const rootFolder = sourceKind === 'folder' && segments.length > 1 ? segments[0] : undefined;
  const relativeSegments = rootFolder ? segments.slice(1) : segments;
  const relativePath = relativeSegments.join('/') || file.name;
  const outputRelativePath = rootFolder ? `${rootFolder}/${relativePath}` : relativePath;
  const groupSegments = outputRelativePath.split('/').slice(0, -1);

  return {
    relativePath: outputRelativePath,
    outputRelativePath,
    rootFolder,
    groupLabel: groupSegments.join('/') || '单独上传',
  };
}

export function buildAutoProjectName(
  tasks: Array<{ rootFolder?: string; groupLabel: string }>,
  language: string,
) {
  const firstFolder = tasks.find((task) => task.rootFolder)?.rootFolder;
  const firstGroup = tasks.find((task) => task.groupLabel !== '单独上传')?.groupLabel;
  const baseName = firstFolder ?? firstGroup ?? (tasks.length > 1 ? '批量图片' : '单图项目');
  const timestamp = new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date()).replace(/[\/:]/g, '-').replace(/\s+/g, ' ');
  return `${baseName} · ${language} · ${timestamp}`;
}

export function isSupportedImageFile(file: File) {
  return Boolean(getSupportedImageFileMimeType(file));
}

export function getSupportedImageFileMimeType(file: File) {
  if (file.type) return normalizeSupportedImageMimeType(file.type);
  const extension = file.name.includes('.')
    ? file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase()
    : '';
  return getImageMimeTypeForExtension(extension);
}

export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        const mimeType = getSupportedImageFileMimeType(file);
        const commaIndex = reader.result.indexOf(',');
        resolve(
          mimeType && commaIndex >= 0
            ? `data:${mimeType};base64,${reader.result.slice(commaIndex + 1)}`
            : reader.result,
        );
        return;
      }

      reject(new Error(`无法读取图片：${file.name}`));
    };

    reader.onerror = () => {
      reject(reader.error ?? new Error(`无法读取图片：${file.name}`));
    };
    reader.readAsDataURL(file);
  });
}

export function getOutputPathExtension(mimeType: string) {
  return getImageExtensionForMimeType(mimeType);
}

export function resolveOutputRelativePath(relativePath: string, dataUrl?: string) {
  if (!dataUrl) {
    return relativePath;
  }

  const mimeType = dataUrl.match(/^data:(.*?);base64,/i)?.[1];
  const nextExtension = mimeType ? getOutputPathExtension(mimeType) : '';

  if (!nextExtension) {
    return relativePath;
  }

  const normalizedPath = normalizeRelativePath(relativePath);
  const currentExtension = normalizedPath.includes('.')
    ? normalizedPath.slice(normalizedPath.lastIndexOf('.'))
    : '';

  if (!currentExtension) {
    return `${normalizedPath}${nextExtension}`;
  }

  if (currentExtension.toLowerCase() === nextExtension) {
    return normalizedPath;
  }

  return `${normalizedPath.slice(0, -currentExtension.length)}${nextExtension}`;
}

export function getBase64DataFromDataUrl(dataUrl: string) {
  const [, base64Data] = dataUrl.split(',');
  return base64Data;
}

export function dataUrlToBlob(dataUrl: string) {
  const [header, base64Data] = dataUrl.split(',');

  if (!header || !base64Data) {
    throw new Error('图片数据格式无效。');
  }

  const mimeType = header.match(/^data:(.*?);base64$/i)?.[1] ?? 'image/png';
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: mimeType });
}

export function downloadDataUrl(dataUrl: string, fileName: string) {
  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

export function createHistoryTaskId() {
  return `${HISTORY_TASK_ID_PREFIX}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function dataUrlToFile(dataUrl: string, fileName: string) {
  const blob = dataUrlToBlob(dataUrl);
  return new File([blob], fileName, { type: blob.type });
}

export { runWithConcurrencyLimit } from '@/lib/concurrency';
