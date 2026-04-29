# DEV Log

## Purpose

This file records the development flow of the project.
More pitfall-oriented notes live in `AGENTS.md`.

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
