# Bug Audit Log

## 2026-05-21 第一批审查记录

| 编号 | 严重度 | 类型 | 位置 | 问题 | 修复 | 验证 |
|---|---|---|---|---|---|---|
| BUG-2026-05-21-01 | P1 | 设置/鉴权 | `project/lib/gateway.ts` | `requireApiKey` 参数未生效，空鉴权也能开始测试或批处理。 | 增加鉴权配置检测，要求常见请求头或 URL 参数存在且值可用。 | `npm run lint`、`npm run build` |
| BUG-2026-05-21-02 | P1 | 设置迁移 | `project/app/workbench/settings.ts` | 旧版 `apiKey/authMode` 迁移到新版 JSON 设置时可能丢失。 | 集中迁移旧 bearer/custom/query/x-goog-api-key 配置，并保留旧默认超时升级。 | `npm run lint`、`npm run build` |
| BUG-2026-05-21-03 | P2 | 可维护性 | `project/app/page.tsx` | 上传/文件/设置工具混在巨型页面里，后续改动容易引入回归。 | 抽出 `workbench/settings.ts` 和 `workbench/files.ts`。 | `npm run lint`、`npm run build` |
| BUG-2026-05-21-04 | P3 | 类型清理 | `project/app/page.tsx` | `buildImageGenerationAttempts()` 残留未使用 `signal` 类型字段。 | 删除无效字段，取消信号只在实际请求处传递。 | `npm run lint`、`npm run build` |
| BUG-2026-05-21-05 | P3 | UX 文案 | `project/app/page.tsx` | 设置说明混入英文 `and`。 | 改成完整中文“秘钥和模型名”。 | `npm run lint`、`npm run build` |
| BUG-2026-05-21-06 | P2 | 可访问性/首页 | `project/app/page.tsx` | 上传区 `role=button` 内嵌“查看历史”按钮，形成嵌套交互控件。 | 上传区改为纯拖拽区域，并移除首页历史入口，只保留上传按钮。 | MCP 快照、无控制台错误、`npm run lint`、`npm run build` |

| BUG-2026-05-21-07 | P1 | 项目规则/UI | `project/app/page.tsx` | 首页显示“查看历史”入口，违反“首页只做上传入口”。 | 移除首页历史按钮，历史入口只在上传后的工作台显示。 | `npm run lint`、`npm run build`、MCP 首页快照 |
| BUG-2026-05-21-08 | P2 | 主题/品牌 | `project/app/page.tsx`、`project/app/globals.css` | 主题变量被黑白化，偏离翡翠绿/青色/琥珀色方向。 | 恢复翡翠绿主色、青色状态色、琥珀警告色，并让主按钮/品牌标识使用翡翠绿。 | `npm run lint`、`npm run build` |
| BUG-2026-05-21-09 | P2 | 可维护性 | `project/app/workbench/options.ts` | 输出比例和语言选项混在巨型页面中。 | 抽出 options 模块管理比例、语言、预览和 prompt 映射。 | `npm run lint`、`npm run build` |

| BUG-2026-05-21-10 | P2 | DOM/自动化稳定性 | `project/app/page.tsx` | 空首页残留隐藏旧控制区，包含重复 `batch-start-button` ID。 | 删除隐藏死代码和重复 ID。 | `npm run lint`、`npm run build`、MCP 上传回归 |
| BUG-2026-05-21-11 | P1 | 可访问性 | `project/app/workbench/task-gallery.tsx` | 任务卡外层 `role=button` 内嵌多个按钮，形成嵌套交互控件。 | 外层改普通 `article`，选择动作独立为 `data-task-select` 按钮。 | `npm run lint`、`npm run build`、MCP 工作台快照 |
| BUG-2026-05-21-12 | P2 | 可维护性 | `project/app/workbench/task-gallery.tsx` | 任务卡/预览图/分组 UI 混在主页面。 | 抽出 `TaskGroupsView`、任务卡和本地预览图组件。 | `npm run lint`、`npm run build` |
| BUG-2026-05-21-13 | P3 | 性能/状态噪音 | `project/app/page.tsx` | `imageQueueLimit` 与旧隐藏统计只服务已删除 UI，仍会造成无意义 state 更新。 | 移除无用 state、setter 和衍生变量。 | `npm run lint`、`npm run build` |

## 2026-05-31 第二轮全局审查记录

| 编号 | 严重度 | 类型 | 位置 | 问题 | 修复 | 验证 |
|---|---|---|---|---|---|---|
| BUG-2026-05-31-01 | P0 | 构建阻断 | `project/app/workbench/use-image-translator.ts` | 未完成 hook extraction 文件缺少闭合语法，ESLint parse fail。 | 临时改成有效 stub，生产工作台仍使用 `app/page.tsx`。 | `npm run lint`、`npm run build` |
| BUG-2026-05-31-02 | P0 | 类型阻断 | `project/app/api/history/route.ts` | `body.task?.id` 在 strict TS 下被推断为 `{}`，生产 build 失败。 | 增加 `isPlainRecord()` 并安全缩窄 `task/patch/event/settingsSummary`。 | `npm run lint`、`npm run build` |
| BUG-2026-05-31-03 | P1 | 安全/历史写入 | `project/app/api/history/route.ts` | 历史 mutation API 缺少基本授权，且 JSON body 只信 Content-Length。 | 增加同源/Referer 或 token 校验，改为 stream 读取并限制 100MB。 | `npm run lint`、`npm run build` |
| BUG-2026-05-31-04 | P1 | 并发/数据完整性 | `project/app/api/history/route.ts` | `readIndex()` 修复索引时可能用旧快照覆盖并发新增任务。 | 写入前在 index lock 内重读并 merge 未知新任务。 | `npm run lint`、`npm run build` |
| BUG-2026-05-31-05 | P1 | 安全/网关 | `project/app/api/generate/route.ts` | API base/远程图片 SSRF 校验与实际 fetch 之间存在 DNS rebinding 窗口。 | 每次 fetch 前 `guardedFetch()` 重新校验公网目标，DNS 安全缓存降到 2s，并补 IPv6-mapped IPv4 私网识别。 | `npm run lint`、`npm run build` |
| BUG-2026-05-31-06 | P1 | 稳定性/内存 | `project/app/api/generate/route.ts` | 上游 `response.text()` 无上限，直接图片响应也不能统一解析。 | 增加文本/图片上游响应限额；直接 `image/*` 响应归一成 Gateway image JSON。 | `npm run lint`、`npm run build` |
| BUG-2026-05-31-07 | P1 | 历史状态 | `project/app/page.tsx` | 历史列表刷新会覆盖已加载详情图片，详情请求慢返回会污染当前选中日志。 | 刷新时保留详情页数据；给详情请求加 seq 和 selected id guard。 | `npm run lint`、`npm run build` |
| BUG-2026-05-31-08 | P1 | 暂停/继续 | `project/app/page.tsx` | 重试 backoff 期间点击暂停不会立即中断等待。 | `waitForDelay()` 支持 AbortSignal，retry sleep 绑定任务 controller。 | `npm run lint`、`npm run build` |
| BUG-2026-05-31-09 | P2 | 状态污染 | `project/app/page.tsx` | 恢复历史/单图重做时旧 undo 和软删除状态会带入新项目。 | 增加 `clearWorkspaceTransientState()` 并在恢复前清理选择、菜单、undo、soft delete。 | `npm run lint`、`npm run build` |
| BUG-2026-05-31-10 | P1 | 首页/UX | `project/app/page.tsx` | 首页必须先上传才能进入历史/设置/语言配置，和当前产品目标冲突。 | 首页改为启动面板，直接展示最近历史、API 状态、语言/比例、上传入口、设置/历史入口。 | `npm run lint`、`npm run build` |
| BUG-2026-05-31-11 | P1 | 翻译语义 | `project/app/page.tsx` | 直接多模态重绘容易在 OCR 前改图，增加“新建/增删内容”风险。 | 翻译流程改为先检测/OCR，再用结构化原文/译文重绘；提示词加入 pure translation contract。 | `npm run lint`、`npm run build` |
| BUG-2026-05-31-12 | P1 | 历史写入/兼容性 | `project/app/api/history/route.ts`、`project/app/workbench/history-client.ts` | 仅靠 Origin/Referer 的历史 POST 在隐私环境或非标准 fetch 下可能被 403；公开 token 端点会削弱防护。 | 放弃公开 token；前端写入带内部 mutation header，后端结合 Sec-Fetch-Site 接受浏览器同源写入，裸 POST 仍 403。 | HTTP probe、`npm run lint`、`npm run build` |
| BUG-2026-05-31-13 | P2 | 可维护性 | `project/app/page.tsx` | 历史写入 fetch 工具仍在巨型页面内，后续修改历史写入安全策略容易误碰 UI/状态机。 | 新增 `project/app/workbench/history-client.ts` 承载 `postHistory()`。 | `npm run lint`、`npm run build` |
| BUG-2026-05-31-14 | P2 | 可维护性 | `project/app/page.tsx`、`project/app/workbench/history-client.ts` | 历史记录类型、状态文案、预览过滤和详情合并纯工具仍留在巨型页面里。 | 将历史类型和纯工具继续移入 `history-client.ts`，主页面只导入使用。 | HTTP probe、`npm run lint`、`npm run build` |
| BUG-2026-05-31-15 | P2 | UI 可维护性 | `project/app/page.tsx`、`project/app/workbench/home-recent-history.tsx` | 首页最近历史卡片 JSX 仍混在主页面，继续放大首页/历史/画布耦合。 | 新增 `HomeRecentHistory` 组件承载首页最近历史、空状态、缩略图和恢复入口。 | HTTP probe、`npm run lint`、`npm run build` |
| BUG-2026-05-31-16 | P2 | UI 可维护性/API 入口 | `project/app/page.tsx`、`project/app/workbench/home-startup-check.tsx` | 首页启动检查/API 快速测试卡片仍混在主页面，增加首页和设置测试逻辑耦合。 | 新增 `HomeStartupCheck` 组件承载启动检查状态、快速测试按钮和连接消息。 | HTTP probe、`npm run lint`、`npm run build` |
| BUG-2026-05-31-17 | P2 | UI 可维护性/首页 | `project/app/page.tsx`、`project/app/workbench/home-upload-hero.tsx` | 首页主视觉、语言/比例选择、上传入口、API/历史入口仍混在主页面。 | 新增 `HomeUploadHero` 组件承载首页上传启动区和工作流摘要。 | HTTP probe、`npm run lint`、`npm run build` |
| BUG-2026-05-31-18 | P2 | UI 可维护性/历史 | `project/app/page.tsx`、`project/app/workbench/history-dialog-header.tsx` | 历史弹层头部、资源路径、统计和刷新/关闭按钮仍混在巨型页面 JSX。 | 新增 `HistoryDialogHeader` 组件，并把历史统计衍生值移出 JSX 内联计算。 | HTTP probe、`npm run lint`、`npm run build` |
| BUG-2026-05-31-19 | P2 | UI 可维护性/历史 | `project/app/page.tsx`、`project/app/workbench/history-gallery.tsx` | 历史弹层图库、选择条、项目卡片、缩略图和加载更多按钮仍混在巨型页面 JSX。 | 新增 `HistoryGallery` 组件承载图库区域，主页面只保留选择状态机和操作回调。 | HTTP probe、`npm run lint`、`npm run build` |
| BUG-2026-05-31-20 | P2 | UI 可维护性/历史 | `project/app/page.tsx`、`project/app/workbench/history-detail.tsx` | 历史详情头部、图片卡片、加载更多和日志侧栏仍混在巨型页面 JSX。 | 新增 `HistoryDetail` 组件承载详情区域，主页面只传状态和操作回调。 | HTTP probe、`npm run lint`、`npm run build` |
| BUG-2026-05-31-21 | P2 | UI 可维护性/历史 | `project/app/page.tsx`、`project/app/workbench/history-context-menu.tsx` | 历史项目右键菜单仍混在主页面 JSX。 | 新增 `HistoryContextMenu` 组件承载下载、查看详情和删除入口。 | HTTP probe、`npm run lint`、`npm run build` |
| BUG-2026-05-31-22 | P2 | UI 可维护性/工作台 | `project/app/page.tsx`、`project/app/workbench/task-context-menu.tsx` | 工作台图片右键菜单仍混在主页面 JSX。 | 新增 `TaskContextMenu` 组件承载重翻/重绘、继续/暂停、下载和移除入口。 | HTTP probe、`npm run lint`、`npm run build` |
| BUG-2026-05-31-23 | P2 | UI 可维护性/批处理 | `project/app/page.tsx`、`project/app/workbench/batch-console.tsx` | 批处理控制台 UI 仍混在主页面 JSX。 | 新增 `BatchConsole` 组件承载项目名编辑、比例选择、进度统计、归档、暂停/继续和下载入口。 | `npm run lint`、`npm run build` |
| BUG-2026-05-31-24 | P2 | UI 可维护性/批处理 | `project/app/page.tsx`、`project/app/workbench/start-confirm-dialog.tsx` | 开始/继续处理确认弹层仍混在主页面 JSX。 | 新增 `StartConfirmDialog` 组件承载语言选择、比例预览、比例选项和确认按钮。 | `npm run lint`、`npm run build` |
| BUG-2026-05-31-25 | P2 | UI 可维护性/工作区 | `project/app/page.tsx`、`project/app/workbench/workspace-dialogs.tsx` | 返回主页确认和新上传去向确认弹层仍混在主页面 JSX。 | 新增 `ReturnHomeDialog` 和 `PendingUploadDialog` 组件，主页面只保留状态和业务动作。 | `npm run lint`、`npm run build` |
| BUG-2026-05-31-26 | P2 | UI 可维护性/设置 | `project/app/page.tsx`、`project/app/workbench/settings-dialog.tsx` | 设置弹层 UI、API 配置、连接测试状态和底部动作仍混在主页面 JSX。 | 新增 `SettingsDialog` 组件承载设置弹层 UI，主页面只传设置草稿、状态和业务回调；修正 `settingsError` nullability。 | `npm run lint`、`npm run build` |
| BUG-2026-05-31-27 | P2 | 状态机可维护性/批处理 | `project/app/page.tsx`、`project/app/workbench/batch-state.ts` | 暂停、继续、启动确认和重翻/重绘的任务状态判断重复散落在主页面，后续拆 `processBatch()` 容易改漏。 | 新增 `batch-state.ts` 抽出可处理/可暂停判断、暂停状态应用、暂停 id 收集和重处理任务准备纯工具，主页面复用这些工具。 | `npm run lint`、`npm run build` |
| BUG-2026-05-31-28 | P2 | 状态机可维护性/批处理 | `project/app/page.tsx`、`project/app/workbench/batch-state.ts` | 单图处理内的阶段重试、retry backoff、暂停守卫和 attempt/retry 计数仍嵌在 `processBatch()`，继续扩大主函数复杂度。 | 将 `ProcessingError`、暂停守卫和 `runBatchStageWithRetries()` 移入 `batch-state.ts`，主页面保留薄封装并传入状态更新、错误分类和取消信号。 | `npm run lint`、`npm run build` |
| BUG-2026-05-31-29 | P2 | 翻译语义/可维护性 | `project/app/page.tsx`、`project/app/workbench/ocr.ts` | 含字检测、OCR 提取翻译、JSON schema 和解析逻辑内联在 `processBatch()`，后续改生图流程时容易误碰纯翻译/无字跳过规则。 | 新增 `ocr.ts` 承载检测/提取 prompt、结构化解析、响应文本提取和请求 helper；主页面仅调 `detectImageText()` 与 `extractAndTranslateImageText()`。 | `npm run lint`、`npm run build` |
| BUG-2026-06-01-30 | P2 | 翻译语义/生图稳定性 | `project/app/page.tsx`、`project/app/workbench/image-generation.ts` | 结构化重绘、直接去水印重绘、多 transport fallback、超时和图片响应解析内联在主页面，容易误改 pure translation prompt contract 或生图兼容行为。 | 新增 `image-generation.ts` 承载图片 prompt、fallback attempts、超时控制和生图 helper；主页面改调用 `generateStructuredImageEdit()` / `generateDirectImageEdit()`。 | `npm run lint`、`npm run build` |
| BUG-2026-06-01-31 | P3 | 状态机可维护性/批处理 | `project/app/page.tsx` | 多个生图成功分支重复写入 generatedUrl、outputRelativePath、success/done 和 completedAt；无字复制分支也重复写入 copied 状态。 | 在单图处理上下文中新增 `markTaskImageSuccess()` 和 `markTaskCopiedWithoutTranslation()`，统一成功/复制收尾并保持历史持久化入口不变。 | `npm run lint`、`npm run build` |
| BUG-2026-06-01-32 | P3 | 状态机可维护性/批处理 | `project/app/page.tsx` | 继续重绘、单图重绘、OCR 后重绘和 remove_only 重绘重复配置 queue、retry、AbortSignal 和 transient failure 回调。 | 新增 `runStructuredImageStage()` 和 `runDirectImageStage()` 局部 helper，统一生图阶段运行参数并保持原 label/debugLabel/失败降并发行为。 | `npm run lint`、`npm run build` |
| BUG-2026-06-01-33 | P3 | 状态机可维护性/OCR | `project/app/page.tsx` | 含字检测和 OCR 提取翻译仍重复配置 runStageWithRetries、textQueue、debugLabel 和 AbortSignal。 | 新增 `runDetectTextStage()` 和 `runExtractTextStage()` 局部 helper，保留含字检测失败后保守进入 OCR 的 fallback 语义。 | `npm run lint`、`npm run build` |
| BUG-2026-06-01-34 | P3 | 状态机可维护性/批处理 | `project/app/page.tsx`、`project/app/workbench/batch-state.ts` | 继续重绘、单图重绘、翻译检测和 remove_only 初始阶段更新对象仍内联拼装，后续迁移 task runner 易漏字段。 | 新增 `buildResumeTranslatedTaskUpdate()`、`buildRedrawTaskUpdate()`、`buildTranslationDetectionTaskUpdate()`、`buildRemoveOnlyTaskUpdate()` 纯工具生成阶段准备更新。 | `npm run lint`、`npm run build` |
| BUG-2026-06-01-35 | P3 | 状态机可维护性/批处理 | `project/app/page.tsx` | 单图 catch 分支内联暂停/失败收尾状态，错误字段和完成时间写入分散。 | 新增 `markTaskPaused()` 和 `markTaskFailed()` 局部 helper，统一 paused/error 收尾并保持历史持久化入口不变。 | `npm run lint`、`npm run build` |
| BUG-2026-06-01-36 | P3 | 状态机可维护性/批处理 | `project/app/page.tsx` | `processBatch()` 的 finally 直接内联批处理结束状态判断、完成时间和历史刷新调度。 | 新增 `finishBatchRun()` 局部 helper，统一 paused/completed 收尾、时间戳和历史刷新；修复抽取时 helper 作用域问题。 | `npm run lint`、`npm run build` |
| BUG-2026-06-01-37 | P3 | 历史持久化/可维护性 | `project/app/page.tsx` | 单图进度持久化和工作区 flush 重复拼装结果图 `save-image` payload。 | 新增 `persistResultImage()`，统一 result 图保存；`persistTaskProgress()` 和 `flushCurrentWorkspaceToHistory()` 改为复用该 helper。 | `npm run lint`、`npm run build` |
| BUG-2026-06-01-38 | P3 | 历史持久化/可维护性 | `project/app/page.tsx` | `persistTaskProgress()` 重复写历史 mutation 的 then/catch/刷新调度。 | 新增 `scheduleHistoryMutation()`，统一后台历史写入的成功刷新和失败错误提示。 | `npm run lint`、`npm run build` |
| BUG-2026-06-01-39 | P3 | 历史持久化/类型边界 | `project/app/page.tsx` | 多处历史图片保存各自解析 `historyTaskId/historyImageId` fallback，且 `activeHistoryTaskId` nullability 容易误传。 | 新增 `resolveHistoryImageIdentity()` 统一身份解析，并在调用处显式收窄 `activeHistoryTaskId ?? undefined`。 | `npm run lint`、`npm run build` |
| BUG-2026-06-01-40 | P3 | 历史持久化/可维护性 | `project/app/page.tsx` | 原图/结果图保存 helper 仍直接拼装 `save-image` payload，后续迁移模块易改宽 `kind` 或漏字段。 | 新增 `buildSaveOriginalImagePayload()` 和 `buildSaveResultImagePayload()`，集中构造保存 payload 并固定 kind 字面量类型。 | `npm run lint`、`npm run build` |
| BUG-2026-06-01-41 | P3 | 历史持久化/可维护性 | `project/app/page.tsx` | `persistHistoryTask()` 同时发起 upsert 并内联消费返回的 history list/resourceDir。 | 新增 `applyHistoryMutationResult()`，统一处理 mutation 返回后的历史列表和资源目录更新。 | `npm run lint`、`npm run build` |
| BUG-2026-06-01-42 | P2 | 历史持久化/可维护性 | `project/app/page.tsx`、`project/app/workbench/history-client.ts` | 历史任务 payload、图片记录映射、身份解析和 save-image payload 纯函数仍留在巨型页面。 | 将 `buildHistoryTaskPayload()`、`toHistoryImage()`、`resolveHistoryImageIdentity()` 和 save-image payload helper 移入 `history-client.ts`。 | `npm run lint`、`npm run build` |
| BUG-2026-06-01-43 | P3 | 状态机可维护性/批处理 | `project/app/page.tsx`、`project/app/workbench/batch-state.ts` | 单图成功/复制/暂停/失败收尾状态对象仍在页面内构造，后续迁移 runner 易漏字段。 | 新增 `buildImageSuccessTaskUpdate()`、`buildCopiedWithoutTranslationTaskUpdate()`、`buildPausedTaskUpdate()`、`buildFailedTaskUpdate()` 并在页面复用。 | `npm run lint`、`npm run build` |
| BUG-2026-06-01-44 | P3 | 状态机可维护性/批处理 | `project/app/page.tsx`、`project/app/workbench/batch-state.ts` | 批处理开始时间复用和结束 paused/completed 判断仍内联在 `processBatch()`。 | 新增 `getBatchRunStartedAt()` 和 `getBatchRunCompletionState()`，页面只负责套用 setState。 | `npm run lint`、`npm run build` |
| BUG-2026-06-01-45 | P3 | 状态机可维护性/生图稳定性 | `project/app/page.tsx`、`project/app/workbench/batch-state.ts` | 图片生成连续 transient 失败降并发策略内联在 `processBatch()` 顶层。 | 新增 `createImageQueueThrottle()`，统一 rate_limit/timeout/network/server 连续失败后的 imageQueue 降级策略。 | `npm run lint`、`npm run build` |
| BUG-2026-06-01-46 | P3 | 状态机可维护性/输入校验 | `project/app/page.tsx`、`project/app/workbench/batch-state.ts` | 单图处理内直接 split data URL 并构造图片读取失败错误。 | 新增 `getRequiredBatchTaskBase64Data()`，统一提取 base64 并抛出不可重试 client `ProcessingError`。 | `npm run lint`、`npm run build` |
| BUG-2026-06-01-47 | P3 | OCR 语义/可维护性 | `project/app/page.tsx`、`project/app/workbench/ocr.ts` | 含字检测失败后的保守 OCR fallback 结果在页面内手动拼装。 | 新增 `buildDetectionFallbackResult()`，统一检测失败时 `hasText: true` 且继续 OCR 的语义。 | `npm run lint`、`npm run build` |
| BUG-2026-06-01-48 | P3 | OCR 语义/可维护性 | `project/app/page.tsx`、`project/app/workbench/ocr.ts` | OCR 提取结果与检测错误的合并在页面内手动 spread。 | 新增 `mergeOcrResultWithDetectionError()`，统一保留检测失败信息并合并 OCR 结果。 | `npm run lint`、`npm run build` |
| BUG-2026-06-01-49 | P3 | OCR 语义/可维护性 | `project/app/page.tsx`、`project/app/workbench/ocr.ts` | 含字检测成功后的初始 OCR result 在页面内手动拼装。 | 新增 `buildDetectionStageResult()`，并让 fallback builder 复用它。 | `npm run lint`、`npm run build` |
| BUG-2026-06-01-50 | P3 | 状态机可维护性/处理模式 | `project/app/page.tsx`、`project/app/workbench/image-generation.ts` | 是否走 OCR 翻译流程的模式判断以内联 `translate_and_remove || translate_only` 写在 runner 里。 | 新增 `shouldRunOcrTranslationFlow()`，集中处理模式语义。 | `npm run lint`、`npm run build` |
| BUG-2026-06-01-51 | P3 | 状态机可维护性/暂停恢复 | `project/app/page.tsx`、`project/app/workbench/batch-state.ts` | 无字图片暂停后继续的 copied 恢复状态对象仍在页面内拼装。 | 新增 `buildResumeCopiedTaskUpdate()`，统一恢复 copied 状态且不重新 OCR/生图。 | `npm run lint`、`npm run build` |
| BUG-2026-06-01-52 | P3 | 状态机可维护性/恢复分支 | `project/app/page.tsx`、`project/app/workbench/batch-state.ts` | paused 无字恢复、paused 已翻译继续、redraw 重绘三个分支判断内联在单图 runner。 | 新增 `shouldResumeCopiedTask()`、`shouldResumeTranslatedTask()`、`shouldRedrawTranslatedTask()`，集中恢复/重绘分支语义。 | `npm run lint`、`npm run build` |
| BUG-2026-06-01-53 | P3 | 状态机可维护性/翻译流程 | `project/app/page.tsx` | 翻译模式分支直接串联检测、fallback、无字复制、OCR、生成前更新和结构化重绘，层级较深。 | 新增局部 `runTranslationFlow()`，收敛翻译流程阶段组合并保留无字复制/检测失败继续 OCR 语义。 | `npm run lint`、`npm run build` |
| BUG-2026-06-01-54 | P3 | 状态机可维护性/remove_only | `project/app/page.tsx` | remove_only 分支直接在主流程中准备状态、运行直接图像阶段并标记成功。 | 新增局部 `runRemoveOnlyFlow()`，收敛 remove_only 阶段组合。 | `npm run lint`、`npm run build` |
| BUG-2026-06-01-55 | P3 | 状态机可维护性/恢复重绘 | `project/app/page.tsx` | 无字复制恢复、已有翻译继续重绘、历史结果重新重绘三条短路分支仍内联在主流程。 | 新增局部 `runRecoveryOrRedrawFlow()`，统一恢复/重绘短路判断。 | `npm run lint`、`npm run build` |
| BUG-2026-06-01-56 | P3 | 状态机可维护性/阶段运行 | `project/app/page.tsx` | 文本/图片阶段 helper 仍重复配置 queue、status、phase 和降并发回调。 | 新增局部 `runImageGenerationStage()` 与 `runTextModelStage()`，统一阶段运行参数。 | `npm run lint`、`npm run build` |
| BUG-2026-06-01-57 | P3 | 状态机可维护性/收尾上下文 | `project/app/page.tsx`、`project/app/workbench/batch-state.ts` | 成功、无字复制、暂停、失败四个 mark helper 仍作为薄封装散在页面单图 runner 内。 | 新增 `createBatchTaskOutcomeUpdaters()`，统一生成单图收尾 updater。 | `npm run lint`、`npm run build` |
| BUG-2026-06-01-58 | P3 | 状态机可维护性/阶段 runner | `project/app/page.tsx`、`project/app/workbench/batch-state.ts` | 页面本地阶段 runner 薄封装仍重复绑定 task/controller/retry/pause/error 上下文。 | 新增 `createBatchStageRunner()` 工厂统一绑定单图阶段 runner 上下文。 | `npm run lint`、`npm run build` |
| BUG-2026-06-01-59 | P3 | 状态机可维护性/更新上下文 | `project/app/page.tsx`、`project/app/workbench/batch-state.ts` | 单图 runner 内联 `applyTaskUpdate()` 同时管理 attempt/retry、startedAt、pause guard、UI 更新和历史进度保存。 | 新增 `createBatchTaskUpdateController()`，统一单图更新上下文。 | `npm run lint`、`npm run build` |
| BUG-2026-06-01-60 | P3 | 状态机可维护性/暂停守卫 | `project/app/page.tsx`、`project/app/workbench/batch-state.ts` | 页面单图 runner 仍手写暂停守卫闭包，组合 task、controller、pause guard 与任务状态查询。 | 新增 `createBatchPauseGuard()`，统一单图暂停检查函数。 | `npm run lint`、`npm run build` |
| BUG-2026-06-01-61 | P3 | 状态机可维护性/暂停查询 | `project/app/page.tsx`、`project/app/workbench/batch-state.ts` | 页面单图 runner 仍内联从 `tasksRef` 按 id 查询 paused 状态。 | 新增 `createBatchTaskPausedLookup()`，统一任务暂停状态查询。 | `npm run lint`、`npm run build` |
| BUG-2026-06-01-62 | P2 | 批处理主入口可发现性 | `project/app/page.tsx`、`project/app/workbench/workbench-command-bar.tsx` | 上传进入工作台后，开始/暂停/继续主要藏在左侧 hover 控制台里，真实浏览器验证时需要先打开控制台才能操作；移动端另有底部悬浮控制台按钮会覆盖内容。 | 新增 `WorkbenchCommandBar` 画布命令条，直接展示状态/进度/计数并提供开始、暂停、继续、下载和移动端详细控制台入口；移除旧移动端悬浮控制台药丸；`.codex-logs/**` 被加入 ESLint ignore，避免浏览器验证 profile 干扰 lint。 | `npm run lint`、`npm run build`、HTTP 200、CDP 上传/开始/暂停/继续截图 |

### 当前残留风险

- SSRF 防护已做 fetch 前重验和短缓存，但没有 socket 级 DNS pinning；Node fetch/undici dispatcher 未接入前仍只能算风险降低。
- `page.tsx` 仍偏大，批处理状态机还没有拆完；目前已拆出历史客户端、历史类型、历史纯工具、首页上传 hero、首页最近历史、启动检查、历史弹层头部、历史图库、历史详情、历史右键菜单、工作台图片右键菜单、批处理控制台、开始确认弹层、工作区确认弹层、设置弹层组件、批处理状态纯工具、阶段重试/暂停守卫工具、阶段 runner 工厂、单图更新上下文 controller、单图暂停守卫 helper、任务暂停查询 helper、阶段运行参数局部 helper、OCR 请求模块、OCR fallback/检测结果/结果合并 helper、图片重绘请求模块、处理模式判断 helper、阶段准备工具、单图收尾/恢复更新 builder、单图收尾 updater 工厂、单图恢复/重绘分支 helper、翻译流程局部 helper、remove_only 流程局部 helper、恢复/重绘流程局部 helper、批处理运行状态 builder、图像队列降并发策略、任务图片数据解析 helper、结果图持久化 helper、历史 mutation 调度 helper 和历史 mutation 返回合并 helper。
- 已做多轮 HTTP 级首页和历史写入探测；最新一次 HTTP 探测命令被权限策略拦截，真正浏览器交互仍需覆盖设置快速测试、上传后暂停 retry、历史恢复 Ctrl+Z 不串项目。Playwright MCP 尚未配置，安装命令因持久配置权限被拦截。
