# DEV Log

## Purpose

This file records the development flow of the project.
More pitfall-oriented notes live in `AGENTS.md`.

## 2026-06-03

### Low-cost Model Defaults

- Trigger: after the Pro image model cost warning, continuing work required preventing accidental default use of `gemini-3-pro-image-preview`.
- Changed app defaults to low-cost models:
  - text: `gemini-3.1-flash-lite-preview`
  - image: `gemini-3.1-flash-image-preview`
- Changed legacy image-model migration so the old Pro default is downgraded to the low-cost image model instead of upgrading safe settings to Pro.
- Updated settings placeholders and README text to stop nudging users toward Pro.
- Still do not resume translation until the browser/app settings are confirmed safe; no API key should be exposed in logs, docs, screenshots, or history.

## 2026-03-27

### Image Timeout

- Found that the frontend default single image request timeout was `15000ms`.
- Real upstream responses were slower than that.
- Raised the default timeout and migrated old stored defaults.

### Cancellation Forwarding

- The server did not propagate browser cancellation to upstream.
- Added upstream cancellation forwarding so abandoned requests stop earlier.

### Translation Flow Experiments

- Tried direct-edit-first.
- Result: complex posters deformed too easily.
- Switched back to OCR + structured redraw first.

### Yunwu Validation

- Verified Yunwu image generation directly.
- Successfully generated `cat.jpg` during testing.
- This proved the account, key, and image model could produce images.

## 2026-03-28

### Current Translation Strategy

- Translation modes now work like this:
  - text model OCR first
  - image model redraw second
- Direct fallback was removed from translation modes.
- `remove_only` still keeps the pure image path.

### Real Translation Test

- Created `test-translate-input.png`.
- Saved OCR output to `test-translate-ocr.txt`.
- Result:
  - OCR succeeded
  - image redraw failed

### Current Upstream Failure

- Real upstream error:
  - `gemini image generation failed: MALFORMED_FUNCTION_CALL`
- This showed the OCR stage was not the blocker.
- The failure was in the image-edit/redraw channel for image-to-image editing.

### Route Fix

- Fixed `/api/generate` so upstream non-2xx is returned immediately.
- This prevents the route from hiding the real upstream failure behind a later fallback `404`.

### Minimal Prompt Retry

- Reduced translation-image prompts to concise built-in instructions.
- Added image attempt expansion to try `object_parts` and `role_parts`.
- Re-tested against upstream.
- Result stayed the same:
  - `gemini image generation failed: MALFORMED_FUNCTION_CALL`

### Current Working Path

- Verified on the current relay:
  - `gemini-3.1-flash-image-preview` can do text-to-image
  - `gemini-3.1-flash-image-preview` can read image input
  - `gemini-3.1-flash-image-preview` can replace visible text in an input image when called through `/v1/chat/completions`
- Verified failures:
  - watermark removal still fails with `MALFORMED_FUNCTION_CALL`
- Product changes:
  - `/api/generate` now routes bearer image editing through the OpenAI-compatible path first
  - UI default mode is now `translate_only`
  - watermark-removal handling was reduced to an optional hint instead of a big separate workflow

### Workspace Reorganization

- Moved the main runnable project into `project`.
- Root now keeps launcher files and `codex`.
- Restored `codex` after accidental deletion and rebuilt its contents.

## 2026-04-25

### Documentation Refresh

- Updated project documentation to match the current implementation:
  - full-screen upload-only empty page
  - post-upload workbench controls
  - right-side hover drawer
  - local history and resource persistence
  - Next dev memory behavior
  - safe cleanup list
- Added root `AGENTS.md` so future Codex sessions have local project rules in the repository.
- Added `codex/CURRENT_STATE.md` as a quick handoff snapshot.

## 2026-04-25 Night Cleanup And Logic Pass

### Trigger

User asked to clean useless files, update all Markdown docs, add a DEV record, continue global review, use MCP snapshots, and directly fix obviously broken logic.

### Cleanup

- Removed root dev logs: `dev3006.err.log`, `dev3006.out.log`.
- Removed old root MCP screenshot: `mcp-empty-real-full.png`.
- Removed `project/.codex-logs/`.
- Removed `project/tsconfig.tsbuildinfo`.
- Tried cleaning `project/.next/`; if the dev server is still alive it regenerates immediately.
- Kept `资源/`, `node_modules/`, source code, public assets, and launcher files.

### Code Fixes

- Pure paused batches now continue directly without showing the start confirmation modal.
- Right-click menu now exposes `继续选中` when selected tasks are paused.
- Running main button uses a pause icon instead of a spinning loader.
- Paused main button uses a play icon.
- Direct remove/redraw image generation branch now receives `AbortSignal` so pause can cancel it earlier.
- Removed unused `signal` type from `buildImagePartVariants()`.
- Fixed paused-task resume guard so a paused task can actually leave the paused state before later pause checks become active.
- Rewrote root `.gitignore` as UTF-8 and kept local data/cache ignore rules clear.

### Pitfalls

- Pause/continue is not a cosmetic button problem; it must preserve task state and avoid reprocessing successful images.
- Browser native confirmation dialogs are not acceptable for this UI direction.
- `.next/` can come back instantly while Next dev is running.
- Windows terminal output can display mojibake even when files are UTF-8; verify with Python reads, not only PowerShell display.

### Next TODO

- Do a real API-key batch test for pause during in-flight upstream requests.
- Improve history UI details and settings controls.
- Add Playwright regression for upload, selection, pause, continue, history restore.

## 2026-04-25 History And Settings Polish

- Reworked history modal layout into a stronger archive workbench.
- Improved task list cards, history detail header, image cards, action buttons, and log panel hierarchy.
- Reworked settings modal into Basic / Runtime / Raw Request sections.
- Added shared `xobi-*` component classes in `app/globals.css` for fields, buttons, status pills, stat tiles, and messages.
- Goal: reduce admin-form feeling and make history/settings match the industrial xobi workbench direction.
## 2026-04-25 History Gallery Cards

- Added lightweight preview mode to `/api/history?preview=1`.
- Each history task returns up to 4 preview images, result first then original fallback.
- Replaced the text-heavy history task list with gallery cards: cover image, small thumbnails, status, progress, and compact counts.
- Kept full image loading inside selected history detail only.
## 2026-04-25 Pinterest History Wall

- Reworked history cards into a smaller Pinterest-like masonry wall.
- Added preview fallback: result image first, then original image if result read fails.
- Added manifest scanning fallback when `history-index.json` is empty or damaged.
- New task folders use readable project-name-based directory names plus a short id.
- Existing `task_*` folders migrate to readable folder names when history is read.
## 2026-04-25 Upload History Task Missing Fix

- Fixed regression from readable history folder names.
- `save-image` can now resolve `taskId` to the real storage directory through index/manifest scanning.
- MCP upload regression test passed: upload no longer shows “历史任务不存在”。

## 2026-04-25 历史记录全屏图库入口

### 已改

- 历史记录打开后默认显示全屏 Pinterest 风格项目图库，不再默认挤出右侧详情和日志。
- 点击历史卡片后才进入详情页，详情页保留恢复/继续、删除、单图重翻、重绘、下载和日志。
- 详情页新增“返回图库”，删除项目后也回到图库，避免自动跳到别的项目造成误解。
- 历史图库卡片继续保持小尺寸、多列瀑布流，宽屏最多 7 列，移动端自动收成 2 列。

### 待验证

- MCP 打开历史：先看到全屏图库。
- 点击任意卡片：进入详情。
- 点击返回图库：回到全屏图库。

## 2026-04-25 历史图库密度、动画和批量操作

### 已改

- 历史图库从 CSS columns 改成自适应网格，卡片整体缩小，优先铺满右侧空间，避免大面积空白。
- 历史图库和详情切换增加轻量淡入/位移动画，不再像硬切页面。
- 历史项目支持 Ctrl+A 全选、Escape 取消选择/返回图库、Delete/Backspace 删除选中项目、D 下载选中项目。
- 历史项目支持鼠标拖拽框选，能从卡片区域直接拉框，不需要找空白处。
- 历史项目支持右键菜单：下载项目、查看详情、删除项目。
- 多选后顶部显示紧凑操作条，可直接下载或删除选中项目。

### 注意

- Delete 删除历史项目是直接删除本地历史记录和资源目录，符合这轮“像桌面一样操作”的需求；后续如果要防误触，可以再做一个可撤销回收站。

## 2026-05-21 全局 bug 审查第一批：设置鉴权与代码拆分

### 本轮发现

- `normalizeSettings(..., { requireApiKey: true })` 以前没有真正检查鉴权配置，用户没填秘钥也会进入连接测试/批处理，最后只得到上游 401/网络错误，定位成本高。
- 旧版本地设置如果只保存了 `apiKey/authMode/customAuthHeader`，迁移时会被默认的空 `requestHeadersText` 覆盖，导致旧秘钥不再进入新请求头/URL 参数。
- `project/app/page.tsx` 同时承担设置迁移、文件路径、上传读取、下载等工具逻辑，文件过大，不利于继续排查 bug。
- `buildImageGenerationAttempts()` 类型里还残留未使用的 `signal?: AbortSignal`，容易误导后续暂停/取消排查。
- 设置弹层有一处中文文案混入英文 `and`，不符合中文 UI 一致性。

### 已修复

1. 设置鉴权硬拦截：`project/lib/gateway.ts` 现在在 `requireApiKey: true` 时检查 `Authorization`、`x-api-key`、`x-goog-api-key`、`key`、`token` 等常见请求头/URL 参数；空 `Bearer`/`Basic` 不再误判为有效。
2. 旧设置迁移：新增 `project/app/workbench/settings.ts`，集中维护默认模型、默认 Base URL、推荐超时、旧 `apiKey` 迁移和持久化白名单；旧 bearer/custom/query/x-goog-api-key 配置会迁移到新的 JSON 请求配置。
3. 文件工具拆分：新增 `project/app/workbench/files.ts`，把上传大小限制、路径规范化、data URL/Blob/File 转换、下载、并发读取等工具从 `page.tsx` 拆出。
4. UI 文案修正：设置页说明改为“常用只填 Base URL、秘钥和模型名”。
5. 类型清理：移除 `buildImageGenerationAttempts()` 未使用的 `signal?: AbortSignal` 字段，避免以为构造尝试列表会处理取消信号。

### 验证

- `cd project && npm run lint` 通过。
- `cd project && npm run build` 通过。



### 追加修复：上传首页可访问性

6. 上传首页去掉外层伪按钮：`project/app/page.tsx` 以前让整个上传区成为 `role=button`，内部又放“查看历史”按钮，形成嵌套交互控件。现在上传区只作为拖拽区域，首页只保留选图片/选文件夹两个上传入口，MCP 快照已确认不再出现嵌套按钮和历史入口。

### 下一轮继续查

- `project/app/page.tsx` 仍有约 5.6k 行，下一步优先继续拆分任务卡、历史弹层和批处理状态机。
- 需要继续做浏览器/MCP 验证：空秘钥点击完整测试应直接提示先填写秘钥；旧 localStorage 设置迁移需用模拟数据回归。
- 首页历史入口已移除，下一轮继续检查上传后工作台里的历史/设置入口。

## 2026-05-21 第二批：首页规则、主题色和选项拆分

### 本轮发现

- 首页残留“查看历史”按钮，和项目规则“首页只做上传入口，不显示设置、历史、语言、比例、并发等工作台控件”冲突。
- 主题变量 `--xobi-lime`、`--xobi-cyan` 被改成纯白，整体偏黑白，偏离“黑灰工业风 + 翡翠绿/青色/琥珀色”的品牌方向。
- 比例和语言选项仍写在 `page.tsx`，属于稳定配置，继续留在巨型页面里会增加后续改 UI 时的误改概率。

### 已修复

7. 首页历史入口移除：空首页只保留拖拽上传区、选图片、选文件夹，不再显示历史入口；历史仍在上传进入工作台后从顶部按钮打开。
8. 品牌色恢复：内联主题变量恢复翡翠绿/青色/琥珀色方向，主按钮和 xobi 标识使用翡翠绿，避免继续黑白化。
9. 选项拆分：新增 `project/app/workbench/options.ts`，集中维护输出比例、语言选项、比例预览和 prompt 语言名映射。

### 验证

- 已在修改后跑过 `npm run lint` 和 `npm run build`，通过。
- 最终验证已重新跑 lint/build/audit，并用 MCP 确认首页没有历史入口。

## 2026-05-21 第三批：任务卡可访问性、死代码和图库组件拆分

### 本轮发现

- 空首页 JSX 里还保留两块 `className="hidden"` 的旧批处理控制区，虽然不可见，但仍包含 `id="batch-start-button"`，和右侧控制台主按钮形成重复 ID，容易影响自动化测试、查询选择器和可访问性树。
- 任务卡外层使用 `role="button"`，内部又嵌套移除、操作、下载等 `<button>`，属于嵌套交互控件，键盘和读屏体验不稳定。
- 任务卡、预览图和任务分组仍写在 `page.tsx`，页面组件继续过大，后续修 bug 容易误碰主状态机。
- `imageQueueLimit` 和旧首页隐藏统计只为已隐藏 UI 服务，保留会造成无意义 state 更新和理解成本。

### 已修复

10. 删除空首页遗留隐藏批处理控制区：移除重复 `batch-start-button`，首页 DOM 更干净。
11. 任务卡可访问性修复：任务卡外层改回普通 `article`，选择动作交给独立的 `data-task-select` 按钮；移除/操作/下载按钮不再嵌套在另一个按钮角色里。
12. 任务卡拆分：新增 `project/app/workbench/task-gallery.tsx`，承载 `LocalPreviewImage`、`TaskGroupsView` 和任务卡 UI。
13. 清理无用状态：移除 `imageQueueLimit` 与旧隐藏统计用到的衍生变量，降低无意义渲染和状态噪音。

### 验证

- `npm run lint` 通过。
- `npm run build` 通过。
- MCP 已上传 1x1 测试图，确认上传后进入工作台；页面只有 1 个 `batch-start-button`，任务卡外层不再是 `role=button`，存在独立 `data-task-select` 选择按钮，控制台无 error/warn。

## 2026-05-31 全局审查第二批：稳定性、安全和首页重构

### 本轮发现

- `use-image-translator.ts` 是未完成抽取草稿，直接阻断 lint。
- 历史 API 在 strict build 下有 `body.task` 类型阻断，并且 mutation 写入缺少基础同源/token 防护。
- 历史 POST 只信 `Content-Length`，大 body/流式 body 可能绕过预期限制。
- 历史 index 修复写入可能覆盖并发新增任务。
- 生成接口 SSRF 校验和实际 fetch 之间还有 DNS rebinding 窗口；上游响应读取没有统一上限。
- 历史详情和刷新之间存在竞态：列表刷新可能覆盖已加载图片，慢详情请求可能写错日志。
- retry backoff 期间暂停不会立刻中断。
- 恢复历史或单图重做会继承旧工作台 undo/软删除状态。
- 首页仍要求先上传才能访问历史/设置/语言，这和当前目标冲突。
- 翻译路径先尝试直接重绘，容易增加“新建/增删内容”风险。

### 已修复

- 未完成 hook 改为合法 stub，避免构建被草稿文件阻断。
- 历史 API 增加 `isPlainRecord()` 缩窄，修复 `task/patch/event/settingsSummary` 类型问题。
- 历史 mutation 增加同源/Referer 或 `x-image-translator-token` 校验，并改为 stream body 限额。
- 历史 index 修复写入前在锁内重读并合并未知新任务。
- 生成接口增加 fetch 前公网目标重验、短 DNS 安全缓存、IPv6-mapped IPv4 私网识别、上游文本/图片响应限额和直接图片响应归一化。
- 历史刷新保留已加载详情数据；详情请求用 sequence + selected id 避免慢返回污染当前选择。
- retry 等待绑定 AbortSignal，暂停可中断 backoff。
- 恢复历史/单图重做前清理选择、菜单、undo、soft delete。
- 首页改成启动工作台：可直接看最近历史、打开设置、测试 API、选择语言/比例、上传图片/文件夹。
- 翻译流程改为检测/OCR 优先，再按原文/译文结构化重绘；提示词加入 pure translation contract，强调只替换已有文字，不增删非文本内容。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 用浏览器实测首页新入口、设置测试、历史恢复和上传处理。
- 继续拆 `page.tsx` 的历史弹层和批处理状态机。
- 如果要把 SSRF 防护做到更强，需要接入可 pin DNS 结果的 fetch/undici dispatcher。

## 2026-05-31 第三批：首页 HTTP 验证和历史写入闭环

### 本轮发现

- 本机 3006 端口已有 Next dev server 在运行，不能随意杀进程重启。
- 首页 HTTP 渲染可访问，并包含“图片翻译工作台 / 最近历史 / API 连接 / 选择图片 / 选择文件夹”等关键入口。
- `/api/history` 裸 POST 会返回 403，说明未授权写入仍被阻断。
- 只依赖 Origin/Referer 的历史写入在部分隐私环境或非标准 fetch 环境下可能不稳定。
- 公开返回 mutation token 的方案会削弱防护，已放弃。

### 已修复

- 前端历史写入统一带 `x-image-translator-request: mutation` 自定义头。
- 历史 API 在没有显式 token 时，除了同源 Origin/Referer，也接受浏览器 `Sec-Fetch-Site` 为 same-origin/same-site/none 且带内部 mutation 头的请求。
- 保留裸 POST 403，避免把历史写入变成任意脚本可直接调用。
- 新增 `project/app/workbench/history-client.ts`，把历史写入 fetch 工具从 `page.tsx` 拆出，降低主页面继续膨胀。

### 验证

- `Invoke-WebRequest http://localhost:3006` 返回 200。
- 首页 HTML 包含核心入口文案：图片翻译工作台、最近历史、API 连接、选择图片、选择文件夹。
- 带 `x-image-translator-request: mutation` 和 `sec-fetch-site: same-origin` 的历史 POST 返回 `{ ok: true }`。
- 裸历史 POST 仍返回 403。
- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 仍需真正浏览器交互覆盖设置弹层、历史弹层、文件选择/拖拽上传、历史恢复和暂停继续。
- `page.tsx` 仍需继续拆历史弹层和批处理状态机；本轮只拆了低风险历史写入客户端。
- SSRF 若要进一步增强，仍需 socket 级 DNS pinning/custom dispatcher。

## 2026-05-31 第四批：历史类型和纯工具继续外移

### 本轮发现

- `page.tsx` 里仍保留历史记录类型、历史状态文案、预览过滤和详情分页合并工具，虽然不是 UI JSX，但会继续增加主页面历史模块耦合。
- 历史弹层尚未整体拆出，直接大搬 JSX 风险较高，先搬纯类型/纯函数更稳。

### 已修复

- `project/app/workbench/history-client.ts` 扩展为历史客户端模块：导出 `HistoryTaskRecord`、`HistoryImageRecord`、`HistoryPreviewImage`、`getHistoryStatusText()`、`getHistoryPreviewImages()`、`mergeHistoryTaskImages()` 和 `postHistory()`。
- `project/app/page.tsx` 删除本地历史类型和纯工具定义，改为从 history-client 导入。
- 历史写入安全策略仍保持：内部 mutation header + Sec-Fetch-Site/同源校验，裸 POST 继续 403。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。
- 首页 HTTP 探测仍能看到图片翻译工作台、最近历史、API 连接、选择图片、选择文件夹。
- 历史 mutation HTTP 探测：带内部 header 成功，裸 POST 403。

### 继续项

- 继续把历史弹层 JSX/操作区拆成组件，或先拆批处理状态机，避免一次性改动过大。
- 仍需要真正浏览器交互覆盖文件选择、拖拽上传、设置弹层、历史恢复、暂停/继续和 Ctrl+Z 串项目风险。

## 2026-05-31 第五批：首页最近历史组件拆分

### 本轮发现

- 首页最近历史卡片 JSX 仍直接写在 `page.tsx` 里，和启动检查、上传区、画布、历史弹层混在同一个渲染函数中。
- 这块 UI 已经有清晰边界：只依赖最近历史任务、历史 loading 状态、打开历史和恢复历史两个回调，适合先拆成独立组件。

### 已修复

- 新增 `project/app/workbench/home-recent-history.tsx`，承载首页最近历史面板、空状态、缩略图和恢复入口。
- 从 `page.tsx` 删除首页最近历史 JSX 和仅为该区服务的 `formatHistoryTime()`。
- 首页仍保留历史入口和恢复入口，组件通过 props 调用 `openHistoryPanel()` 与 `restoreHistoryTask()`。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。
- 首页 HTTP 探测仍能看到图片翻译工作台、最近历史、API 连接、选择图片、选择文件夹。
- 历史 mutation HTTP 探测：带内部 header 成功，裸 POST 403。

### 继续项

- 首页启动检查卡、上传启动区、历史弹层 JSX 仍可继续拆分。
- 仍需要真正浏览器交互覆盖文件选择、拖拽上传、设置弹层、历史恢复、暂停/继续和 Ctrl+Z 串项目风险。

## 2026-05-31 第六批：首页启动检查组件拆分

### 本轮发现

- 首页启动前检查/API 快速测试卡片仍直接写在 `page.tsx`，和上传启动区、最近历史、画布控制台混在一起。
- 该卡片只依赖 API 配置状态、目标语言、比例、连接测试状态和快速测试回调，适合独立成首页组件。

### 已修复

- 新增 `project/app/workbench/home-startup-check.tsx`，承载启动前检查、API/语言/比例状态、快速测试按钮和连接消息。
- `page.tsx` 改为渲染 `HomeStartupCheck`，业务函数 `testConnection('quick')` 仍保留在主状态机中。
- 组件内不读取秘钥内容，只接收是否已配置和测试状态，避免扩散敏感配置。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。
- 首页 HTTP 探测能看到图片翻译工作台、启动前检查、最近历史、API 连接、选择图片、选择文件夹。
- 历史 mutation HTTP 探测：带内部 header 成功，裸 POST 403。

### 继续项

- 首页上传启动区仍可继续拆分。
- 历史弹层 JSX 和批处理状态机仍是最大剩余耦合点。
- 仍需要真正浏览器交互覆盖文件选择、拖拽上传、设置弹层、历史恢复、暂停/继续和 Ctrl+Z 串项目风险。

## 2026-05-31 第七批：首页上传启动区组件拆分

### 本轮发现

- 首页主视觉、语言/比例选择、上传图片/文件夹、API/历史入口和当前工作流摘要仍直接写在 `page.tsx`。
- 这部分已经是纯首页 UI，依赖稳定 props，可以先拆出，避免继续和画布、历史弹层、批处理状态机混在一起。

### 已修复

- 新增 `project/app/workbench/home-upload-hero.tsx`，承载首页主视觉、纯翻译说明、语言/比例选择、上传入口、API/历史入口和当前工作流摘要。
- `page.tsx` 改为渲染 `HomeUploadHero`，只传入设置摘要、模型名、传输方式、历史数量和回调。
- 清理 `page.tsx` 不再直接使用的 `Languages` 图标导入。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。
- 首页 HTTP 探测能看到图片翻译工作台、启动前检查、最近历史、API 连接、历史记录、选择图片、选择文件夹。
- 历史 mutation HTTP 探测：带内部 header 成功，裸 POST 403。

### 继续项

- 首页主要区域已拆成上传 hero、启动检查、最近历史；下一步优先拆历史弹层 JSX 或批处理状态机。
- 仍需要真正浏览器交互覆盖文件选择、拖拽上传、设置弹层、历史恢复、暂停/继续和 Ctrl+Z 串项目风险。

## 2026-05-31 第八批：历史弹层头部组件拆分

### 本轮发现

- 历史弹层顶部标题、资源路径、任务/完成/失败统计和刷新/关闭按钮仍直接写在 `page.tsx`。
- 这块区域只依赖统计数字、资源路径、刷新状态和两个回调，适合先从历史弹层里低风险拆出。

### 已修复

- 新增 `project/app/workbench/history-dialog-header.tsx`，承载历史弹层头部、统计卡片、刷新和关闭按钮。
- `page.tsx` 增加历史统计衍生值 `historyTotalDisplayCount`、`historyDoneDisplayCount`、`historyFailDisplayCount`，避免 JSX 内联 reduce。
- 历史弹层主 JSX 改为渲染 `HistoryDialogHeader`。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。
- 首页 HTTP 探测仍能看到核心入口。
- 历史 mutation HTTP 探测：带内部 header 成功，裸 POST 403。

### 继续项

- 历史图库卡片区、历史详情头部/图片列表、批处理状态机仍需要继续拆分。
- 仍需要真正浏览器交互覆盖文件选择、拖拽上传、设置弹层、历史恢复、暂停/继续和 Ctrl+Z 串项目风险。

## 2026-05-31 第九批：历史图库组件拆分

### 本轮发现

- 历史弹层图库区、选择条、项目卡片、缩略图和加载更多按钮仍直接写在 `page.tsx`。
- 这部分只依赖历史任务列表、选择集合、分页状态和回调，适合继续从巨型页面里拆出。

### 已修复

- 新增 `project/app/workbench/history-gallery.tsx`，承载历史项目图库、选择条、空状态、项目卡片、缩略图和加载更多按钮。
- `page.tsx` 改为渲染 `HistoryGallery`，保留选择状态机和历史操作函数在主页面。
- 清理 `page.tsx` 不再直接使用的历史预览/状态文案导入。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。
- 首页 HTTP 探测仍能看到核心入口。
- 历史 mutation HTTP 探测：带内部 header 成功，裸 POST 403。

### MCP 状态

- 当前 `claude mcp list` 显示未配置 MCP。
- `@playwright/mcp` 可用，但 `claude mcp add playwright -- npx -y @playwright/mcp@latest` 被权限策略拦截，因为这是持久配置变更和外部代码注册；需要用户明确授权这个包/配置后再安装。

### 继续项

- 历史详情头部/图片列表、历史右键菜单、批处理状态机仍需要继续拆分。
- 仍需要真正浏览器交互覆盖文件选择、拖拽上传、设置弹层、历史恢复、暂停/继续和 Ctrl+Z 串项目风险。

## 2026-05-31 第十批：历史详情组件拆分

### 本轮发现

- 历史详情页的返回按钮、详情头部、图片卡片、重翻/重绘/下载/删除按钮、加载更多和日志侧栏仍直接写在 `page.tsx`。
- 这部分 JSX 大且和历史图库同级，继续保留会让历史弹层与批处理状态机更难分离。

### 已修复

- 新增 `project/app/workbench/history-detail.tsx`，承载历史详情主视图、详情头部、图片卡片、加载更多按钮和本地日志侧栏。
- `page.tsx` 改为渲染 `HistoryDetail`，只传入选中的历史任务、详情加载状态、日志、进度和操作回调。
- 清理 `page.tsx` 不再直接需要的 `LocalPreviewImage` 导入。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。
- 首页 HTTP 探测仍能看到核心入口。
- 历史 mutation HTTP 探测：带内部 header 成功，裸 POST 403。

### 继续项

- 历史右键菜单、批处理控制台和批处理状态机仍需要继续拆分。
- 仍需要真正浏览器交互覆盖文件选择、拖拽上传、设置弹层、历史恢复、暂停/继续和 Ctrl+Z 串项目风险；Playwright MCP 安装仍等待明确授权。

## 2026-05-31 第十一批：历史右键菜单组件拆分

### 本轮发现

- 历史项目右键菜单仍直接写在 `page.tsx`，包含下载项目、查看详情、删除项目等操作按钮。
- 菜单只依赖右键坐标、选中 taskIds、历史任务列表和三个回调，适合独立成小组件。

### 已修复

- 新增 `project/app/workbench/history-context-menu.tsx`，承载历史项目右键菜单。
- `page.tsx` 改为渲染 `HistoryContextMenu`，只传入坐标、任务列表和下载/查看/删除回调。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。
- 首页 HTTP 探测仍能看到核心入口。
- 历史 mutation HTTP 探测：带内部 header 成功，裸 POST 403。

### 继续项

- 工作台图片右键菜单、批处理控制台和批处理状态机仍需要继续拆分。
- 仍需要真正浏览器交互覆盖文件选择、拖拽上传、设置弹层、历史恢复、暂停/继续和 Ctrl+Z 串项目风险；Playwright MCP 安装仍等待明确授权。

## 2026-05-31 第十二批：工作台图片右键菜单组件拆分

### 本轮发现

- 工作台图片右键菜单仍直接写在 `page.tsx`，包含重新翻译、重绘、继续/暂停、下载和移除等批量操作。
- 菜单依赖任务集合、坐标、批处理状态和操作回调，适合独立为组件，避免继续扩大主状态机 JSX。

### 已修复

- 新增 `project/app/workbench/task-context-menu.tsx`，承载工作台图片右键菜单。
- `page.tsx` 改为渲染 `TaskContextMenu`，继续把实际批处理/下载/移除动作留在主状态机。
- 组件内部计算可重绘、可下载、暂停项和是否可暂停，减少主 JSX 判断。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。
- 首页 HTTP 探测仍能看到核心入口。
- 历史 mutation HTTP 探测：带内部 header 成功，裸 POST 403。

### 继续项

- 批处理控制台、确认弹层、设置弹层和批处理状态机仍需要继续拆分。
- 仍需要真正浏览器交互覆盖文件选择、拖拽上传、设置弹层、历史恢复、暂停/继续和 Ctrl+Z 串项目风险；Playwright MCP 安装仍等待明确授权。

## 2026-05-31 第十三批：批处理控制台组件拆分

### 本轮发现

- 右侧批处理控制台仍直接写在 `page.tsx`，包含项目名编辑、比例选择、进度统计、归档、暂停/继续和下载按钮。
- 控制台 UI 与批处理状态机强耦合，先拆出展示组件可以减少主页面 JSX，后续再继续抽状态机。

### 已修复

- 新增 `project/app/workbench/batch-console.tsx`，承载右侧批处理控制台 UI。
- `page.tsx` 改为渲染 `BatchConsole`，把项目名、比例、进度、主操作、归档和下载动作以 props 传入。
- 清理 `page.tsx` 不再直接使用的控制台图标导入。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。
- 本轮最终 HTTP 探测命令被权限策略拦截；上一轮同类探测已确认首页 200、授权历史 mutation 成功、裸 POST 403，后续获得权限后需补跑。

### 继续项

- 批处理状态机、开始确认弹层、设置弹层仍需要继续拆分。
- 仍需要真正浏览器交互覆盖文件选择、拖拽上传、设置弹层、历史恢复、暂停/继续和 Ctrl+Z 串项目风险；Playwright MCP 安装仍等待明确授权。

## 2026-05-31 第十四批：开始确认弹层组件拆分

### 本轮发现

- 开始/继续处理确认弹层仍直接写在 `page.tsx`，包含语言选择、比例预览、比例选项和确认按钮。
- 这部分 UI 与主批处理状态机耦合，但本身可通过一个状态对象和回调完整驱动。

### 已修复

- 新增 `project/app/workbench/start-confirm-dialog.tsx`，承载开始/继续确认弹层。
- `page.tsx` 复用 `StartConfirmDialogState` 类型，并改为渲染 `StartConfirmDialog`。
- 清理 `page.tsx` 不再直接需要的比例列表/比例预览导入。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 设置弹层、返回主页/新上传确认弹层和批处理状态机仍需要继续拆分。
- 仍需要真正浏览器交互覆盖文件选择、拖拽上传、设置弹层、历史恢复、暂停/继续和 Ctrl+Z 串项目风险；Playwright MCP 安装仍等待明确授权。

## 2026-05-31 第十五批：返回主页/新上传确认弹层拆分

### 本轮发现

- 返回上传主页确认弹层和新上传去向确认弹层仍直接写在 `page.tsx`。
- 两个弹层都只依赖少量计数、ref 和回调，适合合并到一个工作区弹层模块。

### 已修复

- 新增 `project/app/workbench/workspace-dialogs.tsx`，承载 `ReturnHomeDialog` 和 `PendingUploadDialog`。
- `page.tsx` 改为渲染这两个组件，只保留确认状态和业务动作。
- 清理 `page.tsx` 不再需要的 `Archive` 图标导入。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 设置弹层和批处理状态机仍需要继续拆分。
- 仍需要真正浏览器交互覆盖文件选择、拖拽上传、设置弹层、历史恢复、暂停/继续和 Ctrl+Z 串项目风险；Playwright MCP 安装仍等待明确授权。

## 2026-05-31 第十六批：设置弹层组件拆分

### 本轮发现

- 设置弹层仍直接写在 `page.tsx`，包含基础 API 配置、秘钥输入、模型名、并发/超时、原始请求 JSON、连接测试状态和底部动作。
- 这部分 UI 很大，但业务逻辑可以继续留在主页面，由组件通过 draft settings 和回调驱动。

### 已修复

- 新增 `project/app/workbench/settings-dialog.tsx`，承载设置弹层 UI。
- `page.tsx` 改为渲染 `SettingsDialog`，只传入草稿设置、错误、连接测试状态和保存/清除/测试/更新回调。
- 秘钥仍只从浏览器本地草稿请求头读取/写入，不进入历史或文档。
- 修正 `settingsError` 可为 `null` 的组件类型。
- 清理 `page.tsx` 不再直接使用的设置弹层图标和 Bearer 写入工具导入。

### 验证

- 第一次 build 暴露 `settingsError` nullability 类型问题，已修复。
- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 批处理状态机仍需要继续拆分；通用确认弹层也可继续抽小组件。
- 仍需要真正浏览器交互覆盖文件选择、拖拽上传、设置弹层、历史恢复、暂停/继续和 Ctrl+Z 串项目风险；Playwright MCP 安装仍等待明确授权。

## 2026-05-31 第十七批：批处理状态机纯工具拆分

### 本轮发现

- `page.tsx` 里的暂停、继续、重翻/重绘和启动确认判断重复散落在多个函数中。
- 这些判断大多只依赖任务列表、任务 id 和状态，可先抽成纯工具，避免直接搬动 `processBatch()` 大异步流程带来行为回归。

### 已修复

- 新增 `project/app/workbench/batch-state.ts`，承载批处理任务状态/阶段类型别名、可处理/可暂停判断、暂停状态应用、暂停 id 收集和重处理任务准备逻辑。
- `page.tsx` 改用 `getProcessableBatchTasks()`、`getPausableTaskIds()`、`getPausedTaskIds()`、`applyPausedTaskState()`、`prepareReprocessTasks()`，减少批处理状态判断重复。
- `ImageTask.reprocessMode` 改复用 `ReprocessMode` 类型，后续继续抽状态机时可共享类型。
- 这批只抽纯工具，不改变 `processBatch()` 内的 OCR、翻译、重绘、暂停和历史持久化顺序。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 下一步继续从 `processBatch()` 内抽 `runStageWithRetries`/单图处理上下文，仍要保持 AbortSignal、暂停 guard、历史持久化和无字复制行为不变。
- 仍需要真正浏览器交互覆盖文件选择、拖拽上传、设置弹层、历史恢复、暂停/继续和 Ctrl+Z 串项目风险；Playwright MCP 安装仍等待明确授权。

## 2026-05-31 第十八批：批处理阶段重试/暂停守卫拆分

### 本轮发现

- `processBatch()` 每张图片内部的 `throwIfPaused()` 和 `runStageWithRetries()` 仍直接塞在主页面函数里。
- 这块逻辑负责 attempt/retry 计数、阶段状态写入、retry backoff、暂停中断和 transient failure 回调，属于批处理状态机核心，但可以先抽成参数化工具。

### 已修复

- `project/app/workbench/batch-state.ts` 新增 `ProcessingError`、`ProcessingErrorOptions`、`BatchTaskErrorKind`、`throwIfBatchTaskPaused()` 和 `runBatchStageWithRetries()`。
- `page.tsx` 删除本地 `ProcessingError` class，改从 `batch-state.ts` 复用同一个错误类型。
- `processBatch()` 内的本地 `runStageWithRetries()` 改为薄封装，调用 `runBatchStageWithRetries()`，继续传入：
  - `AbortController`
  - 当前 attempt/retry getter/setter
  - `applyTaskUpdate()`
  - `toProcessingError()`
  - `waitForDelay()`
  - transient failure/success 回调
- 保留 pause guard 语义：暂停任务首次继续时不会立刻被旧 paused 状态拦回；一旦进入运行态后再暂停会中断。
- 修复抽取过程中的泛型 `Partial<TTask>` 类型不兼容问题，给阶段更新定义专用 `BatchStageTaskUpdate`。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 下一步继续拆 `processBatch()` 的 OCR 检测/提取/结构化重绘分支，优先抽“文本检测请求”和“OCR 翻译请求”的纯调用函数。
- 仍需要真正浏览器交互覆盖文件选择、拖拽上传、设置弹层、历史恢复、暂停/继续和 Ctrl+Z 串项目风险；Playwright MCP 安装仍等待明确授权。

## 2026-05-31 第十九批：OCR 检测与翻译请求拆分

### 本轮发现

- `processBatch()` 里直接内联了含字检测请求、OCR 提取翻译请求、JSON schema、响应文本提取和结构化解析。
- 这块逻辑关系到“只翻译图片里已有文字、不新增/删减内容”和无文字图跳过，应该独立成 OCR 模块，避免后续改生图分支时误碰。

### 已修复

- 新增 `project/app/workbench/ocr.ts`，承载：
  - `OcrTaskResult`
  - `getResponseText()`
  - `parseDetectionResult()`
  - `parseStructuredText()`
  - `buildDetectTextPrompt()`
  - `buildExtractPrompt()`
  - `detectImageText()`
  - `extractAndTranslateImageText()`
- `page.tsx` 删除本地 OCR prompt/parse/getResponseText 代码，改从 `ocr.ts` 导入。
- `TaskResult` 改复用 `OcrTaskResult`，避免 OCR 结果类型在页面和模块间重复定义。
- `processBatch()` 中的检测阶段改调用 `detectImageText()`，OCR 翻译阶段改调用 `extractAndTranslateImageText()`。
- 保留原 JSON schema、错误文案、AbortSignal 传递和 textQueue 调度方式；无字图片仍复制原图并标记 `copied`。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 下一步继续拆结构化图片重绘/直接去水印生图请求，优先把 prompt variants 与生图调用封装成任务级 helper。
- 仍需要真正浏览器交互覆盖文件选择、拖拽上传、设置弹层、历史恢复、暂停/继续和 Ctrl+Z 串项目风险；Playwright MCP 安装仍等待明确授权。

## 2026-06-01 第二十批：图片重绘/生图请求拆分

### 本轮发现

- `page.tsx` 仍内联结构化翻译重绘 prompt、直接去水印 prompt、图片请求多兼容 fallback、超时控制和响应图片解析。
- 这块直接影响“纯翻译，不新增/删减内容”和 API 生图稳定性，需要独立成模块，减少后续修改批处理状态机时误碰 prompt contract。

### 已修复

- 新增 `project/app/workbench/image-generation.ts`，承载：
  - `ImageProcessMode`
  - `generateImageWithFallbacks()`
  - `generateStructuredImageEdit()`
  - `generateDirectImageEdit()`
  - 图片响应解析、prompt variants、图片请求 attempts、多 transport 兼容和生图超时控制。
- `page.tsx` 删除本地图片 prompt/fallback/timeout/响应图片解析代码，改调用 `generateStructuredImageEdit()` 与 `generateDirectImageEdit()`。
- 设置完整连接测试继续调用 `generateImageWithFallbacks()`，但显式传入 `callGenerateApi` 和 `timeoutMs`。
- 保留原 pure translation contract、比例适配规则、direct-edit/主提示词 label、多兼容 attempts、AbortSignal、超时和错误聚合文案。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 下一步继续压缩 `processBatch()`：把“继续暂停任务”“单图重绘”“OCR 后结构化重绘”“remove_only 直接重绘”的重复成功收尾逻辑抽成小 helper。
- 仍需要真正浏览器交互覆盖文件选择、拖拽上传、设置弹层、历史恢复、暂停/继续和 Ctrl+Z 串项目风险；Playwright MCP 安装仍等待明确授权。

## 2026-06-01 第二十一批：批处理成功收尾 helper 拆分

### 本轮发现

- `processBatch()` 的继续重绘、单图重绘、OCR 后结构化重绘和 remove_only 去水印分支都重复写入 `generatedUrl/outputRelativePath/status/phase/completedAt`。
- 无字复制分支也重复处理 `copied/outputRelativePath/completedAt`，后续维护历史持久化时容易改漏。

### 已修复

- 在单图处理上下文里新增 `markTaskImageSuccess()`，统一写入成功图片 URL、输出相对路径、完成状态和完成时间，可选清理 `reprocessMode`。
- 在单图处理上下文里新增 `markTaskCopiedWithoutTranslation()`，统一处理无字复制原图的结果、输出路径、`copied` 状态和完成时间。
- 替换继续重绘、单图重绘、OCR 重绘、remove_only 重绘和无字复制分支的重复收尾代码。
- 保留 `applyTaskUpdate()` 的历史持久化入口不变，因此每次成功/复制仍按原逻辑写入历史 manifest/结果图。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 下一步继续拆 `processBatch()` 的“单图恢复/重绘分支”或把 `applyTaskUpdate()`/历史持久化上下文封装成更清晰的 task runner。
- 仍需要真正浏览器交互覆盖文件选择、拖拽上传、设置弹层、历史恢复、暂停/继续和 Ctrl+Z 串项目风险；Playwright MCP 安装仍等待明确授权。

## 2026-06-01 第二十二批：单图重绘阶段 helper 拆分

### 本轮发现

- 虽然图片请求已移动到 `image-generation.ts`，但 `processBatch()` 内仍重复为继续重绘、单图重绘、OCR 后重绘和 remove_only 重绘配置 `runStageWithRetries()`、imageQueue、debugLabel、AbortSignal 和 transient failure 回调。
- 这些重复参数很容易在某个分支漏传取消信号或漏掉生图失败降并发逻辑。

### 已修复

- 在单图处理上下文中新增 `runStructuredImageStage(label, debugLabel)`，统一结构化翻译重绘阶段的 queue、retry、AbortSignal 和 transient failure/success 回调。
- 在单图处理上下文中新增 `runDirectImageStage(label, debugLabel)`，统一 remove_only 直接去水印重绘阶段的 queue、retry、AbortSignal 和 transient failure/success 回调。
- 继续重绘、单图重新重绘、OCR 回退重绘和去水印重绘分支改用这两个 helper。
- 保留原阶段 label、debugLabel、prompt、AbortSignal、失败降并发和成功恢复并发行为。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 下一步继续把 `processBatch()` 内的文本检测/OCR 阶段也包成局部 helper，减少 runStageWithRetries 配置重复；再考虑把单图 runner 整体移出页面。
- 仍需要真正浏览器交互覆盖文件选择、拖拽上传、设置弹层、历史恢复、暂停/继续和 Ctrl+Z 串项目风险；Playwright MCP 安装仍等待明确授权。

## 2026-06-01 第二十三批：文本检测/OCR 阶段 helper 拆分

### 本轮发现

- OCR 请求已移动到 `ocr.ts`，但 `processBatch()` 内仍重复为含字检测和 OCR 提取翻译配置 `runStageWithRetries()`、textQueue、debugLabel 和 AbortSignal。
- 文本阶段失败策略比较特殊：含字检测失败会保守继续 OCR，而不是直接失败；因此适合先抽局部 helper，保持外层 fallback 语义不变。

### 已修复

- 在单图处理上下文中新增 `runDetectTextStage()`，统一含字检测的 retry、textQueue、debugLabel 和 AbortSignal。
- 在单图处理上下文中新增 `runExtractTextStage()`，统一 OCR 提取翻译的 retry、textQueue、目标语言、debugLabel 和 AbortSignal。
- `processBatch()` 的含字检测和 OCR 提取翻译分支改调用这两个 helper。
- 保留含字检测失败后 `hasText: true` 的保守 OCR fallback；保留 OCR schema、错误分类和纯翻译规则不变。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 下一步可以把单图 task runner 的上下文进一步移到独立模块，或先补更真实的浏览器交互验证。
- Playwright MCP 仍未配置；若继续无法授权，可用本地 HTTP/Next build 作为最低验证，但不能替代真实上传/暂停/历史恢复测试。

## 2026-06-01 第二十四批：单图任务阶段准备工具拆分

### 本轮发现

- `processBatch()` 内继续重绘、单图重绘、翻译检测、remove_only 初始阶段仍直接拼装状态更新对象。
- 这些对象包含状态、阶段、错误清理、结果清理、完成时间清理和重处理标记清理；内联越多，后续整体迁移 task runner 越容易改漏字段。

### 已修复

- `project/app/workbench/batch-state.ts` 新增纯工具：
  - `buildResumeTranslatedTaskUpdate()`
  - `buildRedrawTaskUpdate()`
  - `buildTranslationDetectionTaskUpdate()`
  - `buildRemoveOnlyTaskUpdate()`
- `page.tsx` 的继续重绘、单图重绘、进入翻译检测和 remove_only 分支改用这些纯工具生成更新对象。
- 保留每个分支的状态字段不变，包括：
  - 暂停继续保留已有翻译结果。
  - 单图重绘清空旧生成图并清理 `reprocessMode`。
  - 翻译检测清理旧生成图、重置 copied 标记。
  - remove_only 清空文本结果并进入 `remove_image`。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 下一步可继续抽错误收尾 helper、批处理结束状态 helper，或尝试用浏览器运行/HTTP 探测补验证。
- Playwright MCP 仍未配置，真实上传/暂停/历史恢复交互还没覆盖到自动化。

## 2026-06-01 第二十五批：运行时验证尝试与错误收尾 helper

### 运行时验证尝试

- 读取 diff 范围：当前工作树包含大量未提交改动，主要涉及 `page.tsx` 拆分、workbench 新模块、API/history/gateway 加固和文档更新。
- 检查项目 skill：`.claude/skills` 不存在，没有项目内 verifier/run skill。
- 尝试启动开发服务：`npm --prefix "E:/图片翻译器/project" run dev -- --port 3006`，结果端口 `3006` 已被占用，说明本地已有进程占用该端口。
- 尝试对 `http://127.0.0.1:3006/` 做 HTTP/浏览器级探测时，被当前 auto-mode 权限策略拦截，无法取得 homepage 运行时截图/响应体。
- 因此本批仍不能声称真实上传、设置/历史点击、暂停/继续 UI 已被浏览器覆盖；这仍是验证缺口。

### 已修复

- 在 `processBatch()` 单图处理上下文中新增 `markTaskPaused()`，统一暂停错误收尾状态。
- 新增 `markTaskFailed(processingError)`，统一失败收尾状态、错误类型和错误消息写入。
- catch 分支改用这两个 helper，减少 paused/error 分支内联状态拼装。
- 保留原暂停/失败行为、历史持久化入口和错误消息不变。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。
- 运行时 HTTP/browser 探测因权限策略被拦截，未完成。

### 继续项

- 仍需真实浏览器交互验证：主页入口、设置/历史入口、上传进入工作台、批处理开始/暂停/继续、历史恢复、Ctrl+Z 不串项目。
- 可继续把批处理结束状态 helper 抽出，或在权限允许后立即补 run/verify。

## 2026-06-01 第二十六批：批处理结束状态 helper 拆分

### 本轮发现

- `processBatch()` 的 `finally` 中直接内联批处理结束状态收尾，包含暂停任务判断、运行状态、完成时间、当前时间戳和历史刷新。
- 这部分不依赖单图 OCR/生图细节，继续留在 `finally` 会让主流程噪音增加，也不利于后续整体迁移 task runner。

### 已修复

- 在 `processBatch()` 内抽出 `finishBatchRun()` 局部 helper，统一处理批处理结束后的状态收尾：
  - 有暂停任务时设置 `batchRunState` 为 `paused`。
  - 无暂停任务时设置为 `completed` 并写入 `batchCompletedAt`。
  - 同步 `nowTimestamp`。
  - 调度历史刷新。
- `finally` 分支改为只关闭 processing flag 并调用 `finishBatchRun()`。
- 抽取过程中首次 build 暴露 helper 被放进 `try` 块导致 `finally` 作用域不可见，已移到 `try` 外并重新验证通过。

### 验证

- 第一次 build 发现 `Cannot find name 'finishBatchRun'`，已通过移动 helper 作用域修复。
- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 真实浏览器交互验证仍未完成：主页入口、设置/历史入口、上传进入工作台、批处理开始/暂停/继续、历史恢复、Ctrl+Z 不串项目。
- 下一步可继续把单图 task runner 上下文或历史持久化上下文从 `page.tsx` 拆出；在权限允许时优先补真实 run/verify。

## 2026-06-01 第二十七批：单图历史持久化 helper 拆分

### 本轮发现

- `persistTaskProgress()` 和 `flushCurrentWorkspaceToHistory()` 都内联了结果图 `save-image` 请求。
- 结果图保存需要保持 history task id/image id fallback、输出路径和 data URL 一致；分散拼装会增加历史资源写入回归风险。

### 已修复

- 新增 `persistResultImage(task, fallbackHistoryTaskId?)`，统一保存单图结果图。
- `persistTaskProgress()` 改为只接收 task 和 updates，检测 `updates.generatedUrl` 后调用 `persistResultImage()`。
- `flushCurrentWorkspaceToHistory()` 改为复用 `persistOriginalImage()` + `persistResultImage()`，去掉 result 保存内联 payload。
- 保持历史设置摘要不包含 API key，只记录 Base URL、模型和并发配置。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 真实浏览器交互验证仍未完成：主页入口、设置/历史入口、上传进入工作台、批处理开始/暂停/继续、历史恢复、Ctrl+Z 不串项目。
- 下一步可继续封装 `persistTaskProgress()` 的异步错误处理/刷新调度，或开始把单图 task runner 迁到独立模块。

## 2026-06-01 第二十八批：历史进度更新调度 helper 拆分

### 本轮发现

- `persistTaskProgress()` 中 `update-image` 和 result `save-image` 都重复写 promise 成功刷新历史、失败写全局错误的逻辑。
- 这类 fire-and-forget 历史 mutation 调度应该集中，避免后续增加历史写入点时错误处理不一致。

### 已修复

- 新增 `scheduleHistoryMutation(mutation)`，统一调度历史 mutation、成功后刷新历史、失败后展示错误。
- `persistTaskProgress()` 的 `update-image` 和 `persistResultImage()` 调用都改走该 helper。
- 保持 UI 非阻塞：单图状态先更新，历史写入后台完成；写入失败仍会通过 `globalError` 告知。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 真实浏览器交互验证仍未完成：主页入口、设置/历史入口、上传进入工作台、批处理开始/暂停/继续、历史恢复、Ctrl+Z 不串项目。
- 下一步可继续把历史持久化上下文或单图 task runner 从 `page.tsx` 拆出。

## 2026-06-01 第二十九批：历史图片身份解析 helper 拆分

### 本轮发现

- 历史进度更新和结果图保存路径各自做 `historyTaskId/historyImageId` fallback。
- 这类身份解析后续会被更多历史持久化 helper 复用，应该集中处理；同时 `activeHistoryTaskId` 的 `null` 类型需要明确收窄。

### 已修复

- 新增 `resolveHistoryImageIdentity(task, fallbackHistoryTaskId?)`，统一返回历史任务 ID 和图片 ID。
- `persistOriginalImage()`、`persistResultImage()`、`persistTaskProgress()` 改为使用该 helper。
- 修复抽取过程中暴露的 `activeHistoryTaskId` nullability build 错误，调用处用 `activeHistoryTaskId ?? undefined`。

### 验证

- 第一次 build 发现 `string | null` 不能传给 `string | undefined`，已修复。
- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 真实浏览器交互验证仍未完成：主页入口、设置/历史入口、上传进入工作台、批处理开始/暂停/继续、历史恢复、Ctrl+Z 不串项目。
- 可继续把历史持久化上下文整理成独立模块，或转向单图 task runner 提取。

## 2026-06-01 第三十批：历史保存 payload helper 拆分

### 本轮发现

- 原图/结果图保存 helper 内仍直接拼装 `save-image` payload。
- 这类 payload 需要稳定保持 task id、image id、kind、relativePath 和 dataUrl 字段，适合先做纯函数拆分。

### 已修复

- 新增 `buildSaveOriginalImagePayload(task, identity)` 构造原图保存 payload。
- 新增 `buildSaveResultImagePayload(task, identity)` 构造结果图保存 payload。
- `persistOriginalImage()` 和 `persistResultImage()` 改为复用 payload helper。
- 用 `as const` 固定 `kind` 字面量类型，避免后续模块化时变成宽泛 string。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 真实浏览器交互验证仍未完成：主页入口、设置/历史入口、上传进入工作台、批处理开始/暂停/继续、历史恢复、Ctrl+Z 不串项目。
- 后续可继续将历史持久化 helper 移到独立模块，或开始单图 task runner 提取。

## 2026-06-01 第三十一批：历史任务合并 helper 拆分

### 本轮发现

- `persistHistoryTask()` 同时负责构造 upsert 请求和消费后端返回结果，内部仍有 history list/resourceDir 合并逻辑。
- 合并返回值是历史 mutation 通用收尾，适合先从 upsert 函数中抽出。

### 已修复

- 新增 `applyHistoryMutationResult(parsed)`，统一处理 `parsed.tasks`、`parsed.task` 和 `parsed.resourceDir`。
- `persistHistoryTask()` 改为发起 `upsert-task` 后调用该 helper。
- 保留原有历史列表更新策略：后端返回完整列表时直接采用；否则替换/插入单个 task。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 真实浏览器交互验证仍未完成：主页入口、设置/历史入口、上传进入工作台、批处理开始/暂停/继续、历史恢复、Ctrl+Z 不串项目。
- 可继续把历史上下文迁到独立模块，或转向单图 task runner 提取。

## 2026-06-01 第三十二批：历史持久化纯 helper 迁移

### 本轮发现

- `page.tsx` 还保留历史任务 payload、图片映射、身份解析和 save-image payload 构造等纯函数。
- 这些函数已经不依赖 React 状态，只适合放在 `history-client.ts` 旁边和历史类型一起维护。

### 已修复

- `history-client.ts` 新增 `HistoryPersistTaskLike`、`HistoryTaskPayloadOptions`。
- 将以下纯 helper 移入 `history-client.ts` 并从 `page.tsx` 导入：
  - `buildHistoryTaskPayload()`
  - `toHistoryImage()`
  - `resolveHistoryImageIdentity()`
  - `buildSaveOriginalImagePayload()`
  - `buildSaveResultImagePayload()`
- `page.tsx` 新增轻量 `getHistoryTaskName()` / `getHistoryTaskPayload()`，只负责注入当前项目名、语言、比例、模式和不含秘钥的设置摘要。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 真实浏览器交互验证仍未完成：主页入口、设置/历史入口、上传进入工作台、批处理开始/暂停/继续、历史恢复、Ctrl+Z 不串项目。
- 继续可选方向：历史上下文 hook 化，或拆 `processBatch()` 单图 runner。

## 2026-06-01 第三十三批：单图收尾更新 builder 迁移

### 本轮发现

- 单图成功、无字复制、暂停和失败收尾的状态更新对象仍在 `page.tsx` 内。
- 这些对象属于批处理状态机语义，移动到 `batch-state.ts` 后，页面只需要做路径解析和调用 `applyTaskUpdate()`。

### 已修复

- `batch-state.ts` 新增：
  - `buildImageSuccessTaskUpdate()`
  - `buildCopiedWithoutTranslationTaskUpdate()`
  - `buildPausedTaskUpdate()`
  - `buildFailedTaskUpdate()`
- `page.tsx` 改为导入并使用这些 builder。
- 保留原状态字段：成功为 `success/done`，无字为 `copied/copied` 且 `wasCopiedWithoutTranslation`，暂停清理错误和完成时间，失败写入 `lastErrorKind/error/completedAt`。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 真实浏览器交互验证仍未完成：主页入口、设置/历史入口、上传进入工作台、批处理开始/暂停/继续、历史恢复、Ctrl+Z 不串项目。
- 可继续抽文本/图片阶段运行 helper 或单图 runner 上下文。

## 2026-06-01 第三十四批：批处理运行状态 builder 拆分

### 本轮发现

- `processBatch()` 中批处理开始时间计算仍内联：已有成功/复制任务且仍有可处理任务时复用之前开始时间。
- `finishBatchRun()` 中 paused/completed 判断和完成时间写入规则也仍在页面内。
- 这些属于批处理运行状态纯计算，抽到 `batch-state.ts` 更利于继续拆主流程。

### 已修复

- `batch-state.ts` 新增 `getBatchRunStartedAt()`，统一计算当前批次开始时间。
- `batch-state.ts` 新增 `getBatchRunCompletionState()`，统一计算结束后的 `runState/completedAt/timestamp`。
- `page.tsx` 开始和结束状态更新改为使用这两个 helper。
- 保持原 paused 语义：有暂停任务则 runState 为 `paused` 且不写完成时间；否则为 `completed` 并写完成时间。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 真实浏览器交互验证仍未完成：主页入口、设置/历史入口、上传进入工作台、批处理开始/暂停/继续、历史恢复、Ctrl+Z 不串项目。
- 可继续抽图像失败降并发策略、阶段运行 helper 或单图 runner 上下文。

## 2026-06-01 第三十五批：图像队列降并发策略拆分

### 本轮发现

- 图片生成连续 transient 失败后降并发的策略仍内联在 `processBatch()` 顶层。
- 这段逻辑只依赖 `ProcessingError` 和 imageQueue 的 `getLimit/setLimit`，可以作为批处理状态策略放入 `batch-state.ts`。

### 已修复

- `batch-state.ts` 新增 `AdaptiveImageQueueLike`、`ImageQueueThrottle`。
- 新增 `createImageQueueThrottle()`：默认连续 2 次 retryable 的 `rate_limit/timeout/network/server` 后把图片队列降为 1；成功或非 transient 失败会清零计数。
- `page.tsx` 改为创建 `imageQueueThrottle`，生图阶段把 `registerFailure/registerSuccess` 传入 stage runner。
- 保留原自动降并发行为不变。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 真实浏览器交互验证仍未完成：主页入口、设置/历史入口、上传进入工作台、批处理开始/暂停/继续、历史恢复、Ctrl+Z 不串项目。
- 可继续抽阶段运行 helper 或单图 runner 上下文。

## 2026-06-01 第三十六批：任务图片数据解析 helper 拆分

### 本轮发现

- `processBatch()` 内直接用 `task.preview.split(',')[1]` 取 base64，并直接构造图片读取失败的 `ProcessingError`。
- 这是单图输入数据校验，不应该夹在任务分支主流程中。

### 已修复

- `batch-state.ts` 新增 `getRequiredBatchTaskBase64Data(previewDataUrl)`。
- 该 helper 统一提取 base64；缺失时抛出 `kind: 'client'`、`retryable: false` 的 `ProcessingError`。
- `page.tsx` 删除内联 split 和错误构造，改为调用 helper。
- 保留原错误文案和不可重试分类。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 真实浏览器交互验证仍未完成：主页入口、设置/历史入口、上传进入工作台、批处理开始/暂停/继续、历史恢复、Ctrl+Z 不串项目。
- 可继续抽阶段运行 helper 或单图 runner 主流程。

## 2026-06-01 第三十七批：含字检测 fallback builder 拆分

### 本轮发现

- 含字检测阶段失败后，`processBatch()` 内手动构造 `hasText: true`、空文本和 `detectionError`。
- 这是 OCR 流程的保守 fallback 语义：检测不可靠时不能直接当无字跳过，必须继续 OCR。

### 已修复

- `ocr.ts` 新增 `buildDetectionFallbackResult(detectionError)`。
- `page.tsx` 的检测 catch 分支改为 `buildDetectionFallbackResult(toProcessingError(error).message)`。
- 保留检测失败继续 OCR 的行为，不影响无字复制分支。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 真实浏览器交互验证仍未完成：主页入口、设置/历史入口、上传进入工作台、批处理开始/暂停/继续、历史恢复、Ctrl+Z 不串项目。
- 可继续抽 OCR 结果合并 helper 或单图 runner 主流程。

## 2026-06-01 第三十八批：OCR 结果合并 helper 拆分

### 本轮发现

- OCR 提取完成后，`processBatch()` 内仍手动合并 `extractedResult` 和检测阶段的 `detectionError`。
- 该逻辑是 OCR 结果语义的一部分，适合和 OCR fallback builder 一起放在 `ocr.ts`。

### 已修复

- `ocr.ts` 新增 `mergeOcrResultWithDetectionError(result, detectionError?)`。
- `page.tsx` 使用该 helper 合并 OCR 结果，删除内联 spread 对象拼装。
- 保留检测失败信息进入最终任务 result 的行为。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 真实浏览器交互验证仍未完成：主页入口、设置/历史入口、上传进入工作台、批处理开始/暂停/继续、历史恢复、Ctrl+Z 不串项目。
- 可继续抽检测初始 result builder、阶段运行 helper 或单图 runner 主流程。

## 2026-06-01 第三十九批：检测初始结果 builder 拆分

### 本轮发现

- 含字检测成功后，`processBatch()` 里仍直接构造空 `extractedText/translatedText` 的初始 OCR 结果。
- 这和检测失败 fallback 结构一致，适合在 `ocr.ts` 统一生成。

### 已修复

- `ocr.ts` 新增 `buildDetectionStageResult(hasText)`。
- `buildDetectionFallbackResult()` 改为复用 `buildDetectionStageResult(true)` 再附加错误信息。
- `page.tsx` 检测成功分支改用该 helper。
- 保持 `hasText === false` 时复制原图、不进入生图的行为不变。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 真实浏览器交互验证仍未完成：主页入口、设置/历史入口、上传进入工作台、批处理开始/暂停/继续、历史恢复、Ctrl+Z 不串项目。
- 可继续抽阶段运行 helper，或准备单图 runner 主流程提取。

## 2026-06-01 第四十批：处理模式判断 helper 拆分

### 本轮发现

- 是否走 OCR 翻译流程的判断仍以内联 `translate_and_remove || translate_only` 写在 `processBatch()`。
- 这个判断应归属于图片处理模式语义，不能长期散在任务 runner 分支里。

### 已修复

- `image-generation.ts` 新增 `shouldRunOcrTranslationFlow(mode)`。
- `page.tsx` 翻译/OCR 分支改用该 helper。
- 保留原模式行为：翻译相关模式先检测/OCR；`remove_only` 直接走去水印/重绘图像阶段。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 真实浏览器交互验证仍未完成：主页入口、设置/历史入口、上传进入工作台、批处理开始/暂停/继续、历史恢复、Ctrl+Z 不串项目。
- 可继续抽阶段运行 helper 或单图 runner 主流程。

## 2026-06-01 第四十一批：无字暂停恢复 builder 拆分

### 本轮发现

- paused 且 `hasText=false`、已有 generatedUrl 的任务继续时，页面内直接拼装 `copied` 状态。
- 这是无字图片复制完成后的恢复语义，应该归入 `batch-state.ts`。

### 已修复

- `batch-state.ts` 新增 `buildResumeCopiedTaskUpdate(completedAt?)`。
- `page.tsx` 无字暂停恢复分支改用该 builder。
- 保持行为：不重新 OCR、不重新生图，直接恢复 `copied/copied`；完成时间沿用原值或当前时间。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 真实浏览器交互验证仍未完成：主页入口、设置/历史入口、上传进入工作台、批处理开始/暂停/继续、历史恢复、Ctrl+Z 不串项目。
- 可继续抽单图恢复/重绘分支判断 helper，或推进 task runner 主流程。

## 2026-06-01 第四十二批：单图恢复/重绘分支判断 helper 拆分

### 本轮发现

- paused 无字复制恢复、paused 已翻译继续重绘、redraw 重绘三个分支判断仍直接写在 `processBatch()`。
- 这些条件都属于批处理状态机的恢复/重绘语义。

### 已修复

- `batch-state.ts` 新增：
  - `shouldResumeCopiedTask(task)`
  - `shouldResumeTranslatedTask(task)`
  - `shouldRedrawTranslatedTask(task)`
- `BatchTaskLike.result` 补充 `hasText?: boolean`，支持无字恢复判断。
- `page.tsx` 改用这些 helper，保持分支顺序和行为不变。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 真实浏览器交互验证仍未完成：主页入口、设置/历史入口、上传进入工作台、批处理开始/暂停/继续、历史恢复、Ctrl+Z 不串项目。
- 可继续抽翻译流程阶段组合，或推进 task runner 主流程。

## 2026-06-01 第四十三批：翻译流程阶段组合 helper 拆分

### 本轮发现

- 翻译模式分支仍把检测、fallback、无字复制、OCR、生成前更新和结构化重绘连续写在 `processBatch()` 主分支中。
- 这段是单图 runner 主流程的核心，但可以先收敛成局部 helper，减少外层分支层级。

### 已修复

- 在单图处理上下文中新增 `runTranslationFlow()`。
- 将检测状态准备、含字检测、检测失败 fallback、无字复制、OCR 提取、检测错误合并、OCR result 写入、结构化重绘和成功收尾放入该 helper。
- 外层 `shouldRunOcrTranslationFlow(currentMode)` 分支改为只调用该 helper 并返回。
- 保留原无字跳过和检测失败继续 OCR 行为。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 真实浏览器交互验证仍未完成：主页入口、设置/历史入口、上传进入工作台、批处理开始/暂停/继续、历史恢复、Ctrl+Z 不串项目。
- 可继续抽 remove_only 流程 helper、恢复/重绘流程 helper 或迁移单图 runner。

## 2026-06-01 第四十四批：remove_only 流程 helper 拆分

### 本轮发现

- `remove_only` 分支仍直接在主流程中准备 remove 状态、运行直接图像阶段并标记成功。
- 翻译流程已收敛成局部 helper，直接图像流程也应以同样方式收敛。

### 已修复

- 在单图处理上下文新增 `runRemoveOnlyFlow()`。
- 将 remove_only 的状态准备、`runDirectImageStage('去水印重绘', ...)` 和成功收尾放入该 helper。
- 外层分支改为：翻译模式 `runTranslationFlow()`；否则 `runRemoveOnlyFlow()`。
- 保留原 direct image edit、AbortSignal、降并发和历史持久化行为。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 真实浏览器交互验证仍未完成：主页入口、设置/历史入口、上传进入工作台、批处理开始/暂停/继续、历史恢复、Ctrl+Z 不串项目。
- 可继续抽恢复/重绘流程 helper，或迁移单图 runner 上下文。

## 2026-06-01 第四十五批：恢复/重绘流程 helper 拆分

### 本轮发现

- 单图处理主分支仍内联无字复制恢复、已有翻译文本继续重绘、历史结果重新重绘三条恢复/重绘路径。
- 这些路径都在常规翻译/remove_only 之前短路，适合统一封装。

### 已修复

- 新增局部 `runRecoveryOrRedrawFlow()`。
- 将 `shouldResumeCopiedTask()`、`shouldResumeTranslatedTask()`、`shouldRedrawTranslatedTask()` 三条分支迁入该 helper。
- 主流程改为先 `if (await runRecoveryOrRedrawFlow()) return;`，再进入翻译或 remove_only 流程。
- 保留无字复制恢复不重跑、继续重绘/重新重绘清理 `reprocessMode`、结构化生成、历史进度持久化和暂停/重试语义。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 真实浏览器交互验证仍未完成：主页入口、设置/历史入口、上传进入工作台、批处理开始/暂停/继续、历史恢复、Ctrl+Z 不串项目。
- 可继续抽单图 task runner 上下文，或把 stage runner/mark helper 进一步移出 `page.tsx`。

## 2026-06-01 第四十六批：阶段运行参数 helper 拆分

### 本轮发现

- 文本阶段和图片阶段已有具体 helper，但 stage runner 的 queue、status、phase、降并发回调等样板仍分散重复。
- 这些参数属于阶段运行框架，不应继续混进 OCR/生图请求 payload 里。

### 已修复

- 新增局部 `runImageGenerationStage()`，统一图片阶段 `generating` 状态、phase、imageQueue 和 imageQueueThrottle 成功/失败回调。
- 新增局部 `runTextModelStage()`，统一文本阶段 textQueue 和 stage runner 调用。
- `runStructuredImageStage()` / `runDirectImageStage()` 只保留具体生图请求参数。
- `runDetectTextStage()` / `runExtractTextStage()` 只保留具体文本请求参数。
- 保留原 label、phase、debugLabel、AbortSignal、retry/backoff 和图片 transient failure 降并发语义。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 真实浏览器交互验证仍未完成：主页入口、设置/历史入口、上传进入工作台、批处理开始/暂停/继续、历史恢复、Ctrl+Z 不串项目。
- 可继续迁移 `runStageWithRetries` 上下文或整个单图 task runner。

## 2026-06-01 第四十七批：单图收尾 helper 收敛

### 本轮发现

- 页面里仍保留成功、无字复制、暂停、失败四个薄 mark helper。
- 这些 helper 只是在单图 runner 中把状态 builder 交给 `applyTaskUpdate()`，属于可迁移的收尾上下文样板。

### 已修复

- `batch-state.ts` 新增 `createBatchTaskOutcomeUpdaters()`。
- 该工厂统一生成 `markTaskImageSuccess()`、`markTaskCopiedWithoutTranslation()`、`markTaskPaused()`、`markTaskFailed()`。
- `page.tsx` 只传入 `applyTaskUpdate()` 与输出路径解析函数。
- 清理页面中不再直接使用的单图收尾 builder 导入。
- 保留成功、copied、paused、error 状态字段、完成时间、`reprocessMode` 清理和历史持久化入口不变。

### 验证

- 改动后 `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- 改动后 `npm --prefix "E:/图片翻译器/project" run build` 通过。
- 清理导入后再次 `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- 清理导入后再次 `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 真实浏览器交互验证仍未完成：主页入口、设置/历史入口、上传进入工作台、批处理开始/暂停/继续、历史恢复、Ctrl+Z 不串项目。
- 可继续迁移 stage runner 上下文或整个单图 task runner。

## 2026-06-01 第四十八批：单图阶段 runner 工厂拆分

### 本轮发现

- 页面里的本地 `runStageWithRetries()` 薄封装仍重复传入 task、controller、attempt/retry getter/setter、暂停检查、错误转换和 retry 参数。
- 这些都是单图阶段 runner 固定上下文，继续留在页面会增加迁移成本。

### 已修复

- `batch-state.ts` 新增 `BatchStageRunOptions` 和 `BatchStageRunnerFactoryOptions`。
- 新增 `createBatchStageRunner(options)`，绑定任务、取消控制器、retry/backoff、pause guard、错误转换和状态更新上下文。
- `page.tsx` 改为使用 `createBatchStageRunner({...})`，每个阶段只传 label/status/phase/run/回调。
- 清理不再直接使用的 `runBatchStageWithRetries` 导入。
- 保留原 attempt/retry 计数、AbortSignal、暂停 guard、retry 文案、transient failure 与 onSuccess 行为。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 真实浏览器交互验证仍未完成：主页入口、设置/历史入口、上传进入工作台、批处理开始/暂停/继续、历史恢复、Ctrl+Z 不串项目。
- 可继续把 `applyTaskUpdate()` 上下文和任务处理流程迁移到独立 runner。

## 2026-06-01 第四十九批：单图更新上下文 helper 拆分

### 本轮发现

- 单图 runner 里仍内联 `applyTaskUpdate()`，同时负责 attempt/retry、startedAt、pause guard、UI 更新和历史进度保存。
- 这部分是固定任务上下文，不应继续和 OCR/生图流程混在一起。

### 已修复

- `batch-state.ts` 新增 `BatchTaskProgressUpdate`、`BatchTaskUpdateControllerOptions`。
- 新增 `createBatchTaskUpdateController()`：统一管理 attempt/retry getter/setter、startedAt 注入、pause guard 激活、`updateTask()` 与 `persistTaskProgress()` 调用。
- `page.tsx` 改为创建 `taskUpdateController`，并将其提供给阶段 runner、收尾 updater 和暂停守卫。
- 修复抽取后残留的旧 attempt/retry 变量引用。
- 保留原状态更新、历史持久化、pause guard、attempt/retry 计数和 startedAt 语义。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 真实浏览器交互验证仍未完成：主页入口、设置/历史入口、上传进入工作台、批处理开始/暂停/继续、历史恢复、Ctrl+Z 不串项目。
- 可继续小步抽 `runSingleBatchTask()`，或先做运行时验证。

## 2026-06-01 第五十批：单图暂停守卫 helper 拆分

### 本轮发现

- 页面单图上下文仍手写 `throwIfPaused()`，组合 task、AbortController、pause guard 与任务状态查询。
- 这是暂停守卫固定上下文，不应继续散在页面 runner 中。

### 已修复

- `batch-state.ts` 新增 `BatchPauseGuardOptions`。
- 新增 `createBatchPauseGuard()`，统一生成单图暂停检查函数。
- `page.tsx` 改用该 helper，并清理不再直接使用的 `throwIfBatchTaskPaused` 导入。
- 保留原 pause guard 语义：暂停任务继续时允许先离开旧 paused 状态，后续新的暂停/AbortSignal 仍会中断。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 真实浏览器交互验证仍未完成：主页入口、设置/历史入口、上传进入工作台、批处理开始/暂停/继续、历史恢复、Ctrl+Z 不串项目。
- 可继续迁移 `isTaskPaused` 查询或更大粒度 `runSingleBatchTask()`。

## 2026-06-01 第五十一批：任务暂停查询 helper 拆分

### 本轮发现

- 页面单图 runner 中仍直接通过 `tasksRef.current.find(...).status === 'paused'` 查询暂停状态。
- 该查询是暂停守卫与阶段 runner 的通用输入，可继续从页面内联逻辑中抽出。

### 已修复

- `batch-state.ts` 新增 `createBatchTaskPausedLookup(getTasks)`。
- `page.tsx` 改为使用该 helper 创建 `isTaskPaused`。
- 保留原暂停判断语义：当前任务状态变为 `paused` 时，pause guard/阶段 runner 仍按原路径中断。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 真实浏览器交互验证仍未完成：主页入口、设置/历史入口、上传进入工作台、批处理开始/暂停/继续、历史恢复、Ctrl+Z 不串项目。
- 可继续小步抽 `runSingleBatchTask()`，或先补运行时浏览器验证。


## 2026-06-02 费用和模型使用警戒

### Trigger

用户发现当前翻译操作里使用过 `gemini-3-pro-image-preview`，担心 Pro 图片模型费用过高，并要求更新 Markdown 文档。

### What changed

- `project/README.md` 增加费用和模型安全规则。
- `DEV.md` 增加本次费用事故与继续规则。
- `codex/CURRENT_STATE.md` 增加费用/模型安全优先规则，方便下一次接手时先看到。

### What went wrong

- 批量翻译时没有先向用户确认是否允许使用高价 Pro 图片模型。
- 只关注“完成翻译”，忽略了图片重绘模型才是主要费用来源。
- 历史任务里可能带旧模型摘要，恢复继续前也需要检查，不能只看当前任务是否可运行。

### Final rule

- 未经用户明确同意，不再用 `gemini-3-pro-image-preview` 批量跑图。
- 继续翻译前必须先确认低成本模型，例如文本 `gemini-3.1-flash-lite-preview` / flash-lite 类，图片 `gemini-3.1-flash-image-preview` 或用户指定便宜模型。
- 不做用户拒绝的命名规则，不整理 SKU 命名，只翻译图片中已有文字。
- API key 继续只留浏览器本地，不写入代码、Markdown、日志、截图或历史 manifest。

## 2026-06-01 第五十二批：工作台批处理主入口上移与组件化

### 本轮发现

- 真实浏览器补验后确认：开始、暂停、继续的状态机没有因为近期 `processBatch()`/单图 runner 拆分而回归。
- 但可发现性仍不够：批处理主按钮主要在左侧 hover/slide 控制台里，上传后画布主区域没有立刻可见的批处理 command bar。
- 这会让第一次使用者误以为上传后还需要找隐藏面板才能开始，属于交互入口层面的缺陷。

### 已修复

- 新增 `project/app/workbench/workbench-command-bar.tsx`，承载画布内批处理主命令条。
- `page.tsx` 在任务图库上方渲染 `WorkbenchCommandBar`，保留 `.ui-workbench-command` 标记供空白点击判断排除。
- 命令条展示批处理状态、耗时、完成/处理中/待处理/失败数量和进度条。
- 命令条主按钮复用 `handlePrimaryRunAction()`：
  - 运行中显示 `暂停`；
  - 剩余全是暂停任务时显示 `继续 (n)` 并直接继续；
  - 未开始/有待处理任务时显示 `开始 (n)` 并走开始确认。
- 命令条补上结果下载按钮和 `详细控制台` 按钮；移动端点击它打开底部控制台，桌面端保留左侧 dock 热区/悬停入口，避免画布主命令条重复拥挤。
- 移除旧移动端固定在底部的“控制台”悬浮药丸按钮，避免覆盖窄屏任务卡和底部操作区域。
- 画布空白点击排除 `.ui-workbench-command`，避免用户点命令条时被当成空白画布点击清空选择。
- 保留左侧 `BatchConsole`，作为详细比例、项目名、下载和归档控制入口。
- `eslint.config.mjs` 忽略 `.codex-logs/**`，避免真实浏览器 CDP profile 中的大型扩展脚本影响项目 lint。

### 运行时验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。
- HTTP smoke：本地 3006 首页返回 200，响应包含 `xobi`。
- CDP 真实浏览器上传后，命令条出现 `开始 (1)`、`下载结果 (0)`、`详细控制台`。
- 点击命令条 `开始 (1)` 打开“开始翻译 1 张图片”确认弹层。
- 点击确认后，命令条主按钮变为 `暂停`，状态进入运行中。
- 点击命令条 `暂停` 后，提示“已暂停 1 张图片，点继续可接着处理。”，命令条主按钮变为 `继续 (1)`。
- 点击命令条 `继续 (1)` 后，命令条主按钮回到 `暂停`。
- 截图证据：
  - `project/.codex-logs/verify-cdp-command-exact-uploaded.png`
  - `project/.codex-logs/verify-cdp-command-exact-start-dialog.png`
  - `project/.codex-logs/verify-cdp-command-exact-running.png`
  - `project/.codex-logs/verify-cdp-command-exact-paused.png`
  - `project/.codex-logs/verify-cdp-command-exact-continued.png`

### 继续项

- 可继续做移动端触控优先优化；大批量图片仍可做虚拟列表/懒加载。
- 后续可把更多工作台顶部/画布操作继续拆成小组件，减少 `page.tsx` JSX。
