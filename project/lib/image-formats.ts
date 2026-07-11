const MIME_ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/x-png': 'image/png',
  'image/x-ms-bmp': 'image/bmp',
};

const MIME_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
  'image/avif': '.avif',
};

const EXTENSION_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
};

export const SUPPORTED_IMAGE_MIME_TYPES = new Set(
  Object.keys(MIME_TO_EXTENSION),
);

export const SUPPORTED_IMAGE_EXTENSIONS = new Set(
  Object.keys(EXTENSION_TO_MIME),
);

export function normalizeSupportedImageMimeType(mimeType: string) {
  const normalized = mimeType.trim().toLowerCase();
  const canonical = MIME_ALIASES[normalized] ?? normalized;
  return SUPPORTED_IMAGE_MIME_TYPES.has(canonical) ? canonical : '';
}

export function getImageExtensionForMimeType(mimeType: string) {
  const canonical = normalizeSupportedImageMimeType(mimeType);
  return canonical ? MIME_TO_EXTENSION[canonical] : '';
}

export function getImageMimeTypeForExtension(extension: string) {
  const normalized = extension.trim().toLowerCase();
  const withDot = normalized.startsWith('.') ? normalized : `.${normalized}`;
  return EXTENSION_TO_MIME[withDot] ?? '';
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.subarray(start, end));
}

export function detectSupportedImageMimeType(bytes: Uint8Array) {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    ascii(bytes, 0, 4) === 'RIFF' &&
    ascii(bytes, 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (
    bytes.length >= 6 &&
    (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a')
  ) {
    return 'image/gif';
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return 'image/bmp';
  }
  if (
    bytes.length >= 12 &&
    ascii(bytes, 4, 8) === 'ftyp' &&
    /(?:avif|avis)/i.test(ascii(bytes, 8, Math.min(bytes.length, 64)))
  ) {
    return 'image/avif';
  }
  return '';
}
