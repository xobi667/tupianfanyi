import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const appRoot = path.join(projectRoot, 'app');

function read(relativePath) {
  return readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function collectFiles(directory, extension) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(resolved, extension);
    return entry.isFile() && resolved.endsWith(extension) ? [resolved] : [];
  });
}

const failures = [];

function requireMatch(label, content, pattern) {
  if (!pattern.test(content)) failures.push(`${label}：缺少 ${pattern}`);
}

function forbidMatch(label, content, pattern) {
  if (pattern.test(content)) failures.push(`${label}：仍命中 ${pattern}`);
}

function luminance(hex) {
  const channels = [1, 3, 5]
    .map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((channel) => channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(first, second) {
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05);
}

function themeToken(themeBlock, token) {
  return themeBlock.match(new RegExp(`--xobi-${token}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1];
}

const page = read('app/page.tsx');
const layout = read('app/layout.tsx');
const globals = read('app/globals.css');
const workspaceStyles = read('app/workbench/page-styles.css');
const settingsDialog = read('app/workbench/settings-dialog.tsx');
const settings = read('app/workbench/settings.ts');
const gateway = read('lib/gateway.ts');
const imageGeneration = read('app/workbench/image-generation.ts');
const batchState = read('app/workbench/batch-state.ts');
const generateRoute = read('app/api/generate/route.ts');
const imageRequestGate = read('lib/image-request-gate.ts');
const homeUpload = read('app/workbench/home-upload-hero.tsx');
const taskGallery = read('app/workbench/task-gallery.tsx');

requireMatch('主题初始化', layout, /localStorage\.getItem\('xobi-theme'\)/);
requireMatch('主题切换', page, /const toggleTheme/);
requireMatch('浅色主题', globals, /html\[data-theme='light'\]/);
requireMatch('深色主题', globals, /html\[data-theme='dark'\]/);
requireMatch('主题持久化', page, /localStorage\.setItem\('xobi-theme'/);

for (const [themeName, blockPattern] of [
  ['深色', /html\[data-theme='dark'\]\s*\{([\s\S]*?)\n\}/],
  ['浅色', /html\[data-theme='light'\]\s*\{([\s\S]*?)\n\}/],
]) {
  const themeBlock = globals.match(blockPattern)?.[1] ?? '';
  const surface = themeToken(themeBlock, 'surface');
  for (const token of ['text', 'muted', 'faint', 'accent', 'danger', 'warning', 'info']) {
    const color = themeToken(themeBlock, token);
    if (!surface || !color || contrastRatio(surface, color) < 4.5) {
      failures.push(`${themeName}主题 ${token} 与 surface 的对比度低于 4.5:1。`);
    }
  }
  const accent = themeToken(themeBlock, 'accent');
  const accentContrast = themeToken(themeBlock, 'accent-contrast');
  if (!accent || !accentContrast || contrastRatio(accent, accentContrast) < 4.5) {
    failures.push(`${themeName}主题主按钮文字对比度低于 4.5:1。`);
  }
}

requireMatch('首页上传入口', homeUpload, /onSelectImages/);
requireMatch('首页文件夹入口', homeUpload, /onSelectFolder/);
forbidMatch('首页保持极简', homeUpload, /Settings|History|LANGUAGE_OPTIONS|ASPECT_RATIO_OPTIONS/);

for (const [label, id] of [
  ['Base URL', 'api-base-url-input'],
  ['API Key', 'api-key-input'],
  ['图片模型', 'image-model-input'],
]) {
  requireMatch(`设置 ${label}`, settingsDialog, new RegExp(`id="${id}"`));
}
requireMatch('默认直译开关', settingsDialog, /role="switch"/);
requireMatch('连接测试', settingsDialog, /测试连接/);
forbidMatch('设置无高级杂项', settingsDialog, /Raw|并发|请求超时|价格|低成本|默认模型/);

requireMatch('默认跳过 OCR', settings, /skipOcr:\s*true/);
requireMatch('网关默认跳过 OCR', gateway, /skipOcr:\s*settings\.skipOcr\s*\?\?\s*true/);
requireMatch('旧设置迁移', page, /CURRENT_SETTINGS_SCHEMA_VERSION/);
requireMatch('直译读取整图文字', imageGeneration, /read every legible visible text region/);
requireMatch('直译修改边界', imageGeneration, /Change only the pixels needed to replace visible text/);

requireMatch('客户端图片并发恢复', batchState, /recoverySuccesses/);
forbidMatch('并发降速不依赖自动重试', batchState, /function isTransientImageFailure[^}]*error\.retryable/s);
requireMatch('服务端全局图片并发', imageRequestGate, /MAX_GLOBAL_IMAGE_REQUESTS\s*=\s*2/);
requireMatch('服务端并发释放', generateRoute, /releaseImageRequestSlot\?\.\(\)/);
requireMatch('刷新后恢复运行工作台', page, /restoreHistoryTask\(interruptedWorkspace\.id, \{ automatic: true \}\)/);
requireMatch('失败任务显式创建新任务', page, /retryTaskIds/);
requireMatch('失败任务清除旧 operationId', batchState, /prepareFailedTaskRetries[\s\S]*generationOperationId:\s*undefined/);

const pausedContinueBranch = page.match(
  /if \(pausedInScope > 0 && startableInScope === 0\) \{([\s\S]*?)\n\s*\}\n\s*\n\s*const retryTaskIds/,
)?.[1] ?? '';
requireMatch('纯暂停任务直接继续', pausedContinueBranch, /processBatch/);
forbidMatch('纯暂停任务不弹开始确认', pausedContinueBranch, /setStartConfirm/);

requireMatch('右侧控制覆盖定位', workspaceStyles, /\.ui-side-dock\s*\{[^}]*position:\s*fixed/s);
requireMatch('右侧面板覆盖动画', workspaceStyles, /transform:\s*translateX/);
requireMatch('图片完整预览', taskGallery, /object-contain/);
requireMatch('框选 DOM 契约', taskGallery, /data-task-card/);
requireMatch('任务 ID DOM 契约', taskGallery, /data-task-id/);

const tsxFiles = collectFiles(appRoot, '.tsx');
const legacyVisualPattern = /text-white|bg-black|bg-white|border-white|text-\[#|bg-\[#|border-\[#/;
const verboseCopyPattern = /低成本|默认模型|未命中高费用|TranslationIntegrityNotice|纯翻译/;

for (const file of tsxFiles) {
  const relative = path.relative(projectRoot, file);
  const content = readFileSync(file, 'utf8');
  forbidMatch(`${relative} 无固定暗色工具类`, content, legacyVisualPattern);
  forbidMatch(`${relative} 无冗余模型说明`, content, verboseCopyPattern);
}

for (const legacyFile of [
  'app/workbench/home-startup-check.tsx',
  'app/workbench/home-recent-history.tsx',
]) {
  if (tsxFiles.some((file) => path.relative(projectRoot, file) === legacyFile)) {
    failures.push(`遗留首页组件仍存在：${legacyFile}`);
  }
}

if (failures.length > 0) {
  console.error(`UI 目标契约验证失败（${failures.length} 项）：`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`UI 目标契约验证通过：${tsxFiles.length} 个可见 TSX 文件，双主题、极简设置、默认直译、并发与交互 DOM 契约均满足。`);
