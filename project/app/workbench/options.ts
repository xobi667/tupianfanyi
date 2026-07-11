export type OutputAspectRatio =
  | 'original'
  | '1:1'
  | '3:2'
  | '2:3'
  | '4:3'
  | '3:4'
  | '4:5'
  | '16:9'
  | '9:16'
  | '21:9'
  | '5:4'
  | '2:1'
  | '1:2'
  | '3:1'
  | '1:3'
  | '5:7';

export const ASPECT_RATIO_OPTIONS: Array<{
  value: OutputAspectRatio;
  label: string;
  hint: string;
}> = [
  { value: 'original', label: '原图', hint: '保持原始画布比例' },
  { value: '1:1', label: '1:1', hint: '方图封面' },
  { value: '3:2', label: '3:2', hint: '横版摄影' },
  { value: '2:3', label: '2:3', hint: '竖版海报' },
  { value: '4:3', label: '4:3', hint: '标准横图' },
  { value: '3:4', label: '3:4', hint: '标准竖图' },
  { value: '4:5', label: '4:5', hint: '电商主图' },
  { value: '16:9', label: '16:9', hint: '宽屏横版' },
  { value: '9:16', label: '9:16', hint: '短视频竖版' },
  { value: '21:9', label: '21:9', hint: '超宽横版' },
  { value: '5:4', label: '5:4', hint: '打印/产品图' },
  { value: '2:1', label: '2:1', hint: '横幅海报' },
  { value: '1:2', label: '1:2', hint: '长竖海报' },
  { value: '3:1', label: '3:1', hint: '超横幅' },
  { value: '1:3', label: '1:3', hint: '长竖幅' },
  { value: '5:7', label: '5:7', hint: '竖版卡片' },
];

export function getAspectRatioOption(value: OutputAspectRatio) {
  return ASPECT_RATIO_OPTIONS.find((option) => option.value === value) ?? ASPECT_RATIO_OPTIONS[0];
}

export function getAspectRatioPreviewStyle(
  value: OutputAspectRatio,
  maxWidth = 86,
  maxHeight = 86,
) {
  if (value === 'original') {
    const scale = Math.min(1, maxWidth / 78, maxHeight / 50);
    return {
      width: `${Math.round(78 * scale)}px`,
      height: `${Math.round(50 * scale)}px`,
    };
  }

  const [rawWidth, rawHeight] = value.split(':').map(Number);
  const width = Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : 1;
  const height = Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : 1;
  const scale = Math.min(maxWidth / width, maxHeight / height);

  return {
    width: `${Math.max(1, Math.round(width * scale))}px`,
    height: `${Math.max(1, Math.round(height * scale))}px`,
  };
}

export const LANGUAGE_OPTIONS = [
  { value: '中文', label: '中文', promptName: 'Simplified Chinese' },
  { value: '英语', label: '英语', promptName: 'English' },
  { value: '日语', label: '日语', promptName: 'Japanese' },
  { value: '韩语', label: '韩语', promptName: 'Korean' },
  { value: '法语', label: '法语', promptName: 'French' },
  { value: '西班牙语', label: '西班牙语', promptName: 'Spanish' },
  { value: '俄语', label: '俄语', promptName: 'Russian' },
  { value: '泰语', label: '泰语', promptName: 'Thai' },
  { value: '印尼语', label: '印尼语', promptName: 'Indonesian' },
] as const;

export function getPromptLanguageName(targetLanguage: string) {
  const normalized = targetLanguage.trim();
  const matched = LANGUAGE_OPTIONS.find(
    (language) => language.value === normalized || language.label === normalized,
  );

  return matched?.promptName ?? (normalized || 'English');
}
