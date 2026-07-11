# Current State Snapshot

更新时间：2026-06-03

## 费用/模型安全优先规则

- 当前会话暴露出费用风险：部分翻译任务使用了 `gemini-3-pro-image-preview`，用户明确反感未确认就使用 Pro 图片模型。
- 继续跑批量翻译前，必须先确认图片模型已经切到低成本模型，或用户明确同意当前模型费用。
- 建议低成本配置：文本模型 `gemini-3.1-flash-lite-preview` / flash-lite 类；图片模型 `gemini-3.1-flash-image-preview` 或用户指定便宜模型。
- 图片重绘是主要费用来源；不要把“只是 OCR/文字翻译”误当成低成本，因为最终结果图生成会调用图片模型。
- 历史任务可能保存旧模型摘要，恢复历史前也要检查当前浏览器设置和任务摘要，避免旧 Pro 配置继续烧钱。
- 用户拒绝文件命名规则：不要按“产品编号_图片类型_序号_语言地区_属性”重命名，不整理 SKU 命名。
- 仍遵守纯翻译要求：图片有什么字就翻译什么字，不新增内容、不删除内容、无字图复制原图。
- API key 只允许存在浏览器本地设置；不得写入代码、Markdown、日志、截图或历史 manifest。

## 项目定位

xobi 是本地图片翻译工作台。用户主要自己使用，关心：上传快、批量稳、历史不丢、暂停继续直觉、UI 不像模板后台。

## 运行信息

- 根目录：仓库克隆后的根目录
- 应用目录：`project/`
- 默认 URL：`http://localhost:3006`
- 启动 bat：`启动图片翻译器.bat`
- 开发命令：`npm run dev -- --port 3006`
- 生产命令：`npm run build` 后 `npm run start`

## 当前 UI

- 首页：启动面板 + 上传区 + 最近历史 + API 状态 + 语言/比例入口；不再强制先上传才能看历史或设置。
- 工作台：桌面画布感图片墙，任务图库上方有可见批处理命令条。
- 控制面板：侧边贴边悬浮抽屉保留为详细控制台；批处理开始/暂停/继续、下载和进度已上移到画布命令条，上传后无需先找隐藏面板。
- 颜色：纯黑 `#000000` 底层，黑白功能层；薰衣草紫只用于比例、选中、焦点与少量点缀，琥珀仅用于警告；不使用绿色。
- 品牌：`xobi`。
- 比例：支持原图、1:1、3:2、2:3、4:3、3:4、4:5、16:9、9:16、21:9、5:4、2:1、1:2、3:1、1:3、5:7，并有形状预览。

## 当前交互

- 点击选中。
- Ctrl/Shift 多选。
- 鼠标矩形框选。
- Delete 软移除。
- Ctrl+Z 撤回软移除。
- 右键菜单：重新翻译、重新重绘、暂停选中、继续选中、下载、移除。
- 首页顶部和首页主体都可直接打开历史、设置、上传图片/文件夹、切换目标语言。
- 点击 `xobi` 返回主页前会弹自定义确认。
- 开始翻译前会弹自定义确认，并可改语言和比例。
- 上传后可直接在画布命令条点击开始、暂停、继续、下载结果或打开详细控制台；移动端不再额外显示会覆盖底部内容的悬浮控制台药丸按钮。

## 暂停/继续

- 运行中主按钮是“暂停”，点击立即暂停；该主按钮现在在任务图库上方命令条直接可见。
- 全部剩余任务暂停后主按钮是“继续”，点击直接继续；不需要先打开侧边控制台。
- 继续不会重新处理 `success` 或 `copied`。
- 已有 OCR/翻译文本时，继续优先从后续阶段跑，尽量不重做前面步骤。
- 已发给上游的请求通过 AbortSignal 尽量取消；如果上游已经完成，以最终返回为准。

## 当前数据逻辑

- 上传后原图保存到 `资源/`。
- `/api/history` 写入有请求体大小限制，并要求同源/Referer、`x-image-translator-token` mutation token，或浏览器同源 `Sec-Fetch-Site` + 内部 mutation header。
- 每张结果完成后保存到 `资源/`。
- 历史索引：`资源/history-index.json`。
- 任务清单：`资源/task_*/manifest.json`。
- 日志：`资源/task_*/logs.ndjson`。
- 秘钥只在浏览器本地设置，不进历史。


## 2026-05-21 当前拆分

- `project/app/workbench/settings.ts`：设置默认值、旧设置迁移、秘钥写入请求头、持久化白名单。
- `project/app/workbench/files.ts`：上传大小限制、图片文件识别、路径规范化、data URL/Blob/File 转换、下载、并发读取。
- `project/app/workbench/options.ts`：输出比例、比例预览、语言选项和 prompt 语言名映射。
- `project/app/workbench/task-gallery.tsx`：工作台图片卡、分组渲染、本地预览图。
- `project/app/workbench/history-client.ts`：前端历史写入 fetch 客户端、历史记录类型、历史状态文案、预览过滤、详情图片合并、历史任务/图片持久化 payload 构造和历史图片身份解析工具。
- `project/app/workbench/home-recent-history.tsx`：首页最近历史面板、空状态、缩略图和历史恢复入口。
- `project/app/workbench/home-startup-check.tsx`：首页启动前检查、API/语言/比例状态、快速测试按钮和连接消息。
- `project/app/workbench/home-upload-hero.tsx`：首页主视觉、语言/比例选择、上传入口、API/历史入口和当前工作流摘要。
- `project/app/workbench/history-dialog-header.tsx`：历史弹层头部、资源路径、统计卡片、刷新和关闭按钮。
- `project/app/workbench/history-gallery.tsx`：历史弹层项目图库、选择条、项目卡片、缩略图、空状态和加载更多按钮。
- `project/app/workbench/history-detail.tsx`：历史弹层详情视图、详情头部、图片卡片、加载更多和本地日志侧栏。
- `project/app/workbench/history-context-menu.tsx`：历史项目右键菜单、下载项目、查看详情和删除入口。
- `project/app/workbench/task-context-menu.tsx`：工作台图片右键菜单、重翻/重绘、继续/暂停、下载和移除入口。
- `project/app/workbench/batch-console.tsx`：侧边批处理详细控制台、项目名编辑、比例选择、进度、归档、暂停/继续和下载入口。
- `project/app/workbench/workbench-command-bar.tsx`：工作台画布主命令条，直接展示批处理状态、进度、计数、开始/暂停/继续、下载和详细控制台入口。
- `project/app/workbench/start-confirm-dialog.tsx`：开始/继续处理确认弹层、语言选择、比例预览和比例选项。
- `project/app/workbench/workspace-dialogs.tsx`：返回主页确认弹层和新上传去向确认弹层。
- `project/app/workbench/settings-dialog.tsx`：设置弹层 UI、API 基础配置、秘钥输入、模型名、运行参数、原始请求 JSON、连接测试状态和底部动作。
- `project/app/workbench/batch-state.ts`：批处理任务状态/阶段类型、可处理/可暂停判断、暂停状态应用、暂停 id 收集、重翻/重绘任务准备、阶段重试、暂停守卫、单图阶段准备更新工具、单图成功/复制/暂停/失败收尾与无字恢复更新 builder、单图恢复/重绘分支判断、批处理运行状态 builder、图像队列降并发策略和任务图片数据解析 helper。
- `project/app/workbench/ocr.ts`：含字检测、OCR 提取翻译 prompt、结构化 JSON 解析、文本响应提取、OCR 请求 helper、检测初始结果 builder、检测失败保守 fallback builder 和 OCR 结果合并 helper。
- `project/app/workbench/image-generation.ts`：结构化翻译重绘、直接去水印重绘、pure translation prompt contract、处理模式判断、图片请求 fallback、超时控制和响应图片解析。
- `project/lib/gateway.ts`：网关设置规范化、鉴权配置检查、请求头/URL 参数解析。
- `project/app/api/generate/route.ts`：网关代理、请求体/图片/上游响应限额、远程图片抓取、基础 SSRF 防护和直接图片响应归一化。
- `project/app/api/history/route.ts`：本地历史读写、同源/token 写保护、stream body 限额、任务写锁和索引修复。
- `project/app/page.tsx`：仍是主工作台 UI 和批处理状态机；暂停/重处理判断、阶段重试/暂停守卫、阶段 runner 工厂、单图更新上下文 controller、单图暂停守卫 helper、任务暂停查询 helper、阶段运行参数、OCR 请求、OCR 初始/fallback/结果合并、图片重绘请求、处理模式判断、阶段准备、单图收尾/恢复更新 builder、单图收尾 updater 工厂、单图恢复/重绘分支判断、翻译流程、remove_only 流程与恢复/重绘流程局部 helper、批处理运行状态 builder、图像队列降并发策略和任务图片数据解析 helper 已迁入/收敛；页面渲染 `WorkbenchCommandBar` 直接暴露开始/暂停/继续、下载和详细控制台入口；页面仍保留结果图持久化、历史 mutation 调度和历史 mutation 返回合并 helper；历史纯 payload helper 已迁入 `history-client.ts`；后续需要继续拆 `processBatch()` 的 task runner 上下文和历史持久化流程。

## 已知待优化

- 历史 UI 可以继续更强：搜索、筛选、空状态、批量操作。
- 设置页控件仍可统一：数字输入、下拉、测试按钮、错误信息。
- 大批量图片可做懒加载或虚拟列表降低内存。
- 手机端画布交互还需要专门设计。
- 需要 Playwright/E2E 固化暂停继续、框选、历史恢复。
- 最近一次手工 CDP 运行时验证已覆盖画布命令条上传后开始、确认、暂停、继续：截图在 `project/.codex-logs/verify-cdp-command-exact-*.png`。

## 可清理

- 根目录 `dev*.log`
- 根目录 `mcp-*.png`
- `project/.next/`
- `project/.codex-logs/`
- `project/*.tsbuildinfo`

## 不要清理

- `资源/`
- `project/node_modules/`，除非准备重新安装。
- `project/public/`，除非确认具体资源完全没引用。

## MCP 快照

- 首页：`codex/mcp-snapshot-2026-04-25-home.png`
- 工作台：`codex/mcp-snapshot-2026-04-25-workbench.png`

第二轮精修快照：

- 历史记录：`codex/mcp-snapshot-2026-04-25-history-polish.png`
- 设置页：`codex/mcp-snapshot-2026-04-25-settings-polish.png`

图库历史快照：`codex/mcp-snapshot-2026-04-25-history-gallery.png`

Pinterest 历史墙快照：`codex/mcp-snapshot-2026-04-25-history-pinterest-v2.png`
