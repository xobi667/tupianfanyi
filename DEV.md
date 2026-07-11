# DEV 总账

这个文件记录 xobi 的当前版本、清理范围、重要修复、验证结果、待办和踩坑。它是给明天继续开发时快速接上的总入口。

## 2026-06-02 费用事故与继续规则

### 触发

用户发现当前翻译操作里有任务使用了 `gemini-3-pro-image-preview`，担心 Pro 图片模型费用过高，要求更新 Markdown 文档。

### 已记录

- 项目 README 已补充费用和模型安全规则：批量翻译前必须确认图片模型，不要默认继续使用 `gemini-3-pro-image-preview`。
- 源码默认模型已改成低成本配置：文本模型 `gemini-3.1-flash-lite-preview`，图片模型 `gemini-3.1-flash-image-preview`。
- 设置迁移规则已改为把旧 Pro 图片默认值降级到低成本图片模型，不再把安全图片模型升级成 Pro。
- 明确图片重绘才是主要费用来源，OCR/文字翻译通常不是主要成本。

### 当前操作规则

- 不再继续启动新的翻译任务，除非先确认模型已经改为低成本模型或用户明确同意使用当前模型。
- 恢复历史任务前也要检查模型摘要和浏览器当前设置，避免旧历史配置把任务带回 Pro 图片模型。
- 不做用户拒绝的文件命名规则，不整理 SKU 命名；只翻译图片里已有文字。
- 继续保持纯翻译：不新增内容、不删除内容、无字图复制原图。
- API key 继续只留浏览器本地，不写进代码、Markdown、日志、截图或历史 manifest。

## 2026-04-25 本轮目标

用户要求：

- 清理文件夹里无用文件。
- 更新全部 Markdown 文档。
- 新增 DEV 文档记录更新过程、修复、待办、踩坑。
- 继续全局审查，发现逻辑不通直接改。
- 使用 MCP 浏览器快照测试，尽量多轮迭代。

## 已清理

已删除这些可再生成/无长期价值的文件：

- 根目录 `dev3006.err.log`
- 根目录 `dev3006.out.log`
- 根目录 `mcp-empty-real-full.png`
- `project/.codex-logs/`
- `project/tsconfig.tsbuildinfo`

注意：`project/.next/` 是 Next.js 缓存，尝试清理后如果开发服务器还在运行会马上重新生成；这是正常现象，已经加入忽略规则。

## 保留原因

这些内容没有删除：

- `资源/`：保存用户原图、结果图、历史记录和日志，不能当垃圾删。
- `project/node_modules/`：依赖目录，体积大但当前还要用；删除会导致无法直接运行。
- `project/public/showcase/` 和 `project/public/ui-assets/`：属于公开静态资源，未确认完全无引用，不盲删。
- 源码、配置、启动 bat 全部保留。

## 本轮代码修复

### 1. 暂停/继续逻辑再修正

问题：暂停后继续必须是“继续”，不能再弹确认框让人误以为重新翻译。

处理：

- 主按钮运行中显示“暂停”，点击立即暂停。
- 只有全部待处理都是暂停状态时，主按钮显示“继续”，点击直接调用继续处理。
- `confirmAndProcessBatch()` 对“纯暂停继续”的范围也直接继续，不再弹开始确认框。
- 继续只处理 `idle/error/paused`，不会重复跑 `success/copied`。

### 2. 右键菜单补上继续选中

问题：右键可以暂停选中，但暂停后缺少直接继续选中的入口。

处理：

- 选中项里有暂停任务时，右键菜单显示“继续选中”。
- 点击后只继续这些暂停任务，不影响其他图片。

### 3. 生图请求补齐取消信号

问题：去水印/直接重绘分支里有一处请求没有传 `AbortSignal`，暂停时可能不能尽快中断上游请求。

处理：

- `remove_only` 的 `generateImageFromPromptVariants()` 调用补上 `signal: taskController.signal`。
- 清掉 `buildImagePartVariants()` 不需要的 `signal` 类型字段，减少误导。

### 4. 暂停按钮图标修正

问题：运行中按钮显示暂停，但图标还是旋转 loading，视觉上像还在等待而不是可暂停动作。

处理：

- 运行中主按钮改为 `PauseCircle`。
- 暂停后继续状态使用 `PlayCircle`。


### 6. 暂停守卫修复

MCP 测试发现：任务处于 `paused` 时点击继续，流程进入后会被 `throwIfPaused()` 立刻拦回暂停，导致继续无效。已增加 `pauseGuardActive`：初始暂停任务允许进入处理；一旦任务被切到检测/生成等运行态，再响应新的暂停请求。

### 5. 忽略规则修正

问题：根目录 `.gitignore` 里 `资源/` 曾出现乱码显示风险。

处理：

- 用 UTF-8 重写 `.gitignore`。
- 明确忽略 `资源/`、日志、MCP 截图、`.next`、`.codex-logs`、`tsbuildinfo`、秘钥环境文件。

## 当前核心行为

- 首页：只负责上传，视觉更像入口，不放一堆设置。
- 工作台：上传后出现画布、顶部状态、右侧悬浮控制面板。
- 多选：点击、Ctrl/Shift、多选框、Delete、Ctrl+Z、右键菜单。
- 暂停：当前批次立即停止可停止的任务；已发出的上游请求通过 AbortSignal 尽量中断。
- 继续：继续未完成/暂停/失败任务，不重新处理成功图片。
- 历史：本地保存，支持恢复、继续、单图重做、结果下载。

## 待办

优先级从高到低：

1. 用真实 API key 做一次完整的暂停中断测试：上传 2 张图，运行中暂停，再继续，确认不重复成功图片。
2. 历史记录 UI 继续细化：空状态、搜索/筛选、任务详情里的单图状态可以更像“归档工作台”。
3. 设置页继续统一控件：数字输入、下拉框、模型输入、错误提示应完全同一视觉语言。
4. 移动端工作台可再优化：画布类交互在手机上需要触控方案，不能只靠鼠标框选。
5. 增加自动化 E2E：上传、框选、右键、暂停、继续、历史恢复最好用 Playwright 固化。
6. 大批量图片性能：未来可做缩略图懒加载、虚拟列表、限制 base64 常驻内存。

## 踩坑

- Windows PowerShell 默认编码容易把中文写坏；写中文文件优先用 Python UTF-8。
- 不要盲删 `资源/`，它不是缓存，是用户数据。
- 暂停不是重新开始；按钮文案、图标、逻辑必须一致。
- 浏览器原生 `confirm/alert` 体验差，xobi 应使用自定义弹窗。
- Next dev 会自动生成 `.next/`，清了又出现不是失败。
- MCP 浏览器视口和用户真实浏览器缩放可能不同，UI 要靠响应式而不是写死比例。

## 验证记录

本轮应在结束前跑：

```bash
cd project
npm run lint
npm run build
npm audit --audit-level=moderate
```

MCP 应检查：

- 页面能打开。
- 首页上传入口存在。
- 上传后进入工作台。
- 右侧贴边悬停面板能出现。
- 暂停按钮显示为暂停图标。
- 暂停后按钮变继续，继续不弹确认框。
- 历史、设置弹层能打开，没有控制台错误。

本轮已保存 MCP 截图：

- `codex/mcp-snapshot-2026-04-25-home.png`
- `codex/mcp-snapshot-2026-04-25-workbench.png`

## 2026-04-25 第二轮：历史和设置页精修

### 目标

继续把最丑、最像后台表单的地方往 xobi 工作台视觉靠拢，重点是历史记录和设置页。

### 已改

- 历史弹层重排：顶部变成归档工作台头部，任务/完成/失败统计更清楚。
- 历史左侧任务卡重做：进度条、状态、总数/完成/失败更紧凑，不再像普通列表。
- 历史详情重做：详情头、恢复/删除操作、单图卡片、原图/结果状态、重翻/重绘/下载/删除统一成工作台按钮。
- 历史日志区保留，但视觉降噪，不抢主要操作。
- 设置页重排：基础配置、运行参数、高级 JSON 分区。
- 设置页输入框、数字输入、文本域、提示、测试按钮、保存按钮统一成 xobi 控件。
- 数字输入外层加专门布局，避免默认上下箭头显得突兀。
- 新增一批 `xobi-*` 组件样式，减少到处复制 Tailwind 长串 class。

### 仍可继续

- 历史记录可以再加搜索/筛选。
- 设置页可以加“恢复默认模型”“显示/隐藏秘钥”小按钮。
- 可以把 `xobi-*` 样式继续抽成更系统的设计 token。


### 第二轮 MCP 快照

- `codex/mcp-snapshot-2026-04-25-history-polish.png`
- `codex/mcp-snapshot-2026-04-25-settings-polish.png`
## 2026-04-25 第三轮：历史图库封面墙

### 目标

用户明确不喜欢历史记录纯列表：没有预览图、没有点击欲望。改成图库式历史项目卡。

### 已改

- 历史接口支持 `GET /api/history?preview=1`。
- 每个历史任务最多返回 4 张轻量预览图。
- 预览规则：结果图优先，没有结果就用原图。
- 历史左侧列表改成图库项目卡：大封面 + 3 张小缩略图 + 状态 + 进度。
- 没有预览图时显示专门的空态，不再是一坨文字。
- 新增 `xobi-history-cover`、`xobi-history-thumb` 等样式。

### 注意

历史列表只加载少量预览，详情页仍然按需加载完整图片，避免历史很多时卡死。


### 第三轮 MCP 快照

- `codex/mcp-snapshot-2026-04-25-history-gallery.png`
## 2026-04-25 第四轮：Pinterest 历史墙和资源目录命名

### 目标

历史记录不要再像任务列表，要像 Pinterest 一样靠图片吸引点击；资源目录也不要再默认全是 `task_...`。

### 已改

- 历史左侧改成双列瀑布流项目墙，卡片更小更密，不再是巨大列表卡。
- 卡片封面高度做错落变化，更接近 Pinterest 的视觉节奏。
- 预览读取兜底修复：结果图读不到时会自动回退原图，不会轻易空白。
- 历史索引为空时会扫描 `资源/` 里的 manifest 自动恢复，避免索引损坏后历史归零。
- 新任务资源文件夹默认使用“项目名 + 短 ID”，不再只用 `task_...`。
- 旧 `task_...` 文件夹在读取历史时会自动迁移成可读项目名文件夹。

### MCP 快照

- `codex/mcp-snapshot-2026-04-25-history-pinterest-v2.png`
## 2026-04-25 紧急修复：上传后提示历史任务不存在

### 原因

历史目录从 `task_xxx` 改成可读项目名后，`upsert-task` 写入 manifest 到新目录，但紧接着 `save-image` 只用 taskId 去旧目录找 manifest，导致提示“历史任务不存在”。

### 修复

- `readTask()` 增加 taskId 到真实 `storageDirName` 的查找。
- 查找顺序：显式目录、历史索引、扫描资源目录 manifest、旧 `task_xxx` 目录。
- MCP 重新上传测试图，确认不会再出现“历史任务不存在”。

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

- `processBatch()` 的 `finally` 中直接写批处理结束状态：计算是否有暂停任务、设置 `batchRunState`、完成时间、当前时间戳和历史刷新。
- 这块和单图处理细节无关，适合独立成局部 helper，减少主流程噪音。

### 已修复

- 新增 `finishBatchRun()` 局部 helper，统一处理批处理结束后的状态：
  - 有暂停任务时进入 `paused`。
  - 没有暂停任务时进入 `completed` 并写入 `batchCompletedAt`。
  - 更新 `nowTimestamp`。
  - 延迟刷新历史。
- `finally` 分支改为 `setIsProcessingBatch(false); finishBatchRun();`。
- 抽取时第一次 build 暴露 helper 作用域放在 `try` 内导致 `finally` 不可见，已把 helper 移到 `try` 外并重新验证通过。

### 验证

- 第一次 build 发现 `finishBatchRun` 作用域错误，已修复。
- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 运行时浏览器验证仍受权限/MCP 限制未完成。
- 代码侧可继续将单图 runner 提取到独立 hook/module，但需要谨慎避免一次迁移过大。

## 2026-06-01 第二十七批：单图历史持久化 helper 拆分

### 本轮发现

- `flushCurrentWorkspaceToHistory()` 和单图进度持久化都直接拼装 `save-image` 的 result payload。
- 结果图保存逻辑依赖 history task id/image id fallback、输出相对路径和 data URL，分散后后续改历史资源写入容易漏字段。

### 已修复

- 新增 `persistResultImage(task, fallbackHistoryTaskId?)`，统一保存结果图到本地历史资源目录。
- `persistTaskProgress()` 不再接收单独的 result data URL 参数，而是在 `updates.generatedUrl` 出现时调用 `persistResultImage()`。
- `flushCurrentWorkspaceToHistory()` 改用 `persistResultImage()`，不再内联 `postHistory('save-image', kind: 'result')`。
- 保留 API key 本地化规则：历史 payload 仍只写模型/base URL/并发摘要，不写秘钥。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 仍需真实浏览器交互验证。
- 可继续把 `persistTaskProgress()` 的 update-image/save-image 异步调度进一步封装，或开始更大粒度提取单图 task runner。

## 2026-06-01 第二十八批：历史进度更新调度 helper 拆分

### 本轮发现

- `persistTaskProgress()` 里 `update-image` 和结果图 `save-image` 都重复使用 fire-and-forget promise、成功刷新历史、失败写全局错误。
- 重复调度代码让历史持久化路径继续显得嘈杂，也不利于后续迁移到独立 task runner。

### 已修复

- 新增 `scheduleHistoryMutation(mutation)`，统一处理历史 mutation 成功后的延迟刷新和失败错误展示。
- `persistTaskProgress()` 的 `update-image` 和结果图保存都改用该 helper。
- 保持原有异步非阻塞行为：任务 UI 不等待历史写入完成，失败仍通过全局错误提示暴露。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 可继续将 `persistTaskProgress()` 自身移动到历史上下文 helper，或开始拆单图 task runner。
- 真实浏览器上传/暂停/历史恢复验证仍未完成。

## 2026-06-01 第二十九批：历史图片身份解析 helper 拆分

### 本轮发现

- 历史进度更新、结果图保存等路径各自计算 `historyTaskId/historyImageId` fallback。
- `activeHistoryTaskId` 可能是 `null`，而 helper 期望 `undefined` fallback，类型边界需要显式处理。

### 已修复

- 新增 `resolveHistoryImageIdentity(task, fallbackHistoryTaskId?)`，统一解析历史任务 ID 和图片 ID。
- `persistResultImage()`、`persistOriginalImage()`、`persistTaskProgress()` 改为复用该 helper。
- 修复抽取时暴露的 `string | null` 到 `string | undefined` 类型不兼容，调用处使用 `activeHistoryTaskId ?? undefined`。

### 验证

- 第一次 build 发现 `activeHistoryTaskId` nullability 类型问题，已修复。
- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 继续拆时应优先把历史上下文整体抽出，但要避免改变原图保存必须有 `historyImageId` 的保护语义。
- 真实浏览器验证仍未完成。

## 2026-06-01 第三十批：历史保存 payload helper 拆分

### 本轮发现

- 原图和结果图保存虽然已经各自有持久化 helper，但 `save-image` payload 仍在请求处直接拼装。
- 后续把历史持久化移出 `page.tsx` 前，先把 payload 构造变成纯 helper 更安全。

### 已修复

- 新增 `buildSaveOriginalImagePayload(task, identity)`。
- 新增 `buildSaveResultImagePayload(task, identity)`。
- `persistOriginalImage()` / `persistResultImage()` 改为调用 payload helper 后再 `postHistory('save-image', ...)`。
- 使用 `kind: 'original' as const` / `kind: 'result' as const` 保持 action payload 字面量类型稳定。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 可继续把这些历史 helper 移到独立模块或 hook；迁移前需要确认所有闭包依赖（active project、settings 摘要、history refresh、globalError）。
- 真实浏览器验证仍未完成。

## 2026-06-01 第三十一批：历史任务合并 helper 拆分

### 本轮发现

- `persistHistoryTask()` 内直接处理 upsert 返回值：合并 `historyTasks`、更新 `resourceDir`。
- 这部分属于“历史 mutation 返回值落地”逻辑，和构造 upsert payload 不同，适合独立成 helper。

### 已修复

- 新增 `applyHistoryMutationResult(parsed)`，统一处理 `postHistory()` 返回的 `tasks/task/resourceDir`。
- `persistHistoryTask()` 改为只负责发起 `upsert-task`，成功后调用合并 helper。
- 保持原合并语义：优先使用后端返回的完整 tasks；否则用单个 task 替换当前列表中的同 id 项。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 可继续把历史 upsert payload 构造、mutation 调度、图片保存 helper 迁到独立模块。
- 真实浏览器验证仍未完成。

## 2026-06-01 第三十二批：历史持久化纯 helper 迁移

### 本轮发现

- `page.tsx` 仍保留大量历史持久化纯函数：历史任务 payload、图片记录映射、图片身份解析和 save-image payload。
- 这些函数只依赖传入参数，适合移动到已有 `history-client.ts`，让主页面只保留 React 状态闭包相关逻辑。

### 已修复

- `history-client.ts` 新增 `HistoryPersistTaskLike` 与 `HistoryTaskPayloadOptions`。
- 移入并导出：
  - `buildHistoryTaskPayload()`
  - `toHistoryImage()`
  - `resolveHistoryImageIdentity()`
  - `buildSaveOriginalImagePayload()`
  - `buildSaveResultImagePayload()`
- `page.tsx` 改为导入这些 helper，只保留：
  - 任务名 fallback（项目名/自动名）
  - 设置摘要
  - React 状态更新、错误展示和历史刷新调度
- 保持历史设置摘要不包含 API key。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 可继续将剩余历史上下文整理为 hook，或回到 `processBatch()` 单图 runner 提取。
- 真实浏览器验证仍未完成，不能宣称全局完成。

## 2026-06-01 第三十三批：单图收尾更新 builder 迁移

### 本轮发现

- `processBatch()` 内的 `markTaskImageSuccess()`、`markTaskCopiedWithoutTranslation()`、`markTaskPaused()`、`markTaskFailed()` 已经是薄封装，但状态更新对象仍写在页面里。
- 这些更新对象属于批处理状态语义，适合移动到 `batch-state.ts`，为单图 runner 继续外移铺路。

### 已修复

- `batch-state.ts` 新增：
  - `buildImageSuccessTaskUpdate()`
  - `buildCopiedWithoutTranslationTaskUpdate()`
  - `buildPausedTaskUpdate()`
  - `buildFailedTaskUpdate()`
- `page.tsx` 的 mark helper 改为只计算输出相对路径并调用这些 builder，再交给 `applyTaskUpdate()`。
- 保留成功、无字复制、暂停、失败的状态字段和历史持久化入口不变。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 下一步可继续迁移文本/图片阶段运行 helper，或更大步抽单图 runner 上下文。
- 真实浏览器验证仍未完成。

## 2026-06-01 第三十四批：批处理运行状态 builder 拆分

### 本轮发现

- `processBatch()` 顶层仍内联批处理开始时间复用规则：已有完成图且仍有可处理任务时复用原 `batchStartedAt`。
- `finishBatchRun()` 内仍直接判断 paused/completed 并写完成时间。
- 这些判断是纯状态计算，适合移入 `batch-state.ts`，让页面只负责 `setState`。

### 已修复

- `batch-state.ts` 新增 `getBatchRunStartedAt(tasks, currentBatchStartedAt, fallbackStartedAt?)`。
- `batch-state.ts` 新增 `getBatchRunCompletionState(tasks, finishedAt?)`。
- `page.tsx` 改为调用这两个 helper：
  - 开始时获取批处理开始时间。
  - 结束时获取 `paused/completed`、完成时间和时间戳。
- 保留原语义：有暂停任务时不写 `batchCompletedAt`，无暂停任务时写完成时间。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 可继续抽图像失败降并发策略、文本/图片阶段运行 helper 或单图 task runner。
- 真实浏览器验证仍未完成，不能宣称全局完成。

## 2026-06-01 第三十五批：图像队列降并发策略拆分

### 本轮发现

- `processBatch()` 顶层还保留连续 transient 图片失败计数和 imageQueue 降并发策略。
- 这块策略只关心 `ProcessingError` 类型和队列 limit，不应该继续散在页面主流程里。

### 已修复

- `batch-state.ts` 新增 `AdaptiveImageQueueLike` 与 `ImageQueueThrottle` 类型。
- 新增 `createImageQueueThrottle(imageQueue, options?)`：
  - 成功时清零连续 transient 失败计数。
  - 遇到 retryable 的 rate_limit/timeout/network/server 失败时累加。
  - 连续达到阈值后把图片队列降到指定 limit，默认 2 次后降到 1。
  - 非 transient 失败会清零计数。
- `page.tsx` 删除内联 `consecutiveTransientImageFailures/registerImageFailure/registerImageSuccess`，改用 `imageQueueThrottle.registerFailure/registerSuccess`。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 可继续抽文本/图片阶段运行 helper，或者开始把单图 runner 上下文移到独立模块。
- 真实浏览器验证仍未完成。

## 2026-06-01 第三十六批：任务图片数据解析 helper 拆分

### 本轮发现

- `processBatch()` 内直接从 `task.preview.split(',')[1]` 读取 base64，并在失败时构造 `ProcessingError`。
- 这属于单图输入校验逻辑，继续内联会让 runner 主流程夹杂低层 data URL 细节。

### 已修复

- `batch-state.ts` 新增 `getRequiredBatchTaskBase64Data(previewDataUrl)`。
- helper 内统一提取 base64；缺失时抛出 `ProcessingError`，`kind: 'client'`、`retryable: false`，文案保持“图片读取失败，请重新上传后再试。”。
- `page.tsx` 改为调用该 helper，删除内联 split 和错误构造。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 可继续抽文本/图片阶段运行 helper，或开始把单图 runner 主流程移入独立模块。
- 真实浏览器验证仍未完成。

## 2026-06-01 第三十七批：含字检测 fallback builder 拆分

### 本轮发现

- 含字检测失败后的保守 fallback 结果仍在 `processBatch()` 内手动拼装。
- 这段逻辑关系到“检测失败不等于无字，继续 OCR 更保守”的核心语义，应该和 OCR helper 放在一起。

### 已修复

- `ocr.ts` 新增 `buildDetectionFallbackResult(detectionError)`。
- `page.tsx` 在检测阶段 catch 中改为调用该 helper。
- 保持原语义：检测失败时设 `hasText: true`，清空 extracted/translated，并保留 detectionError，后续继续进入 OCR。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 可继续抽 OCR 结果合并 helper，或推进单图 runner 主流程提取。
- 真实浏览器验证仍未完成。

## 2026-06-01 第三十八批：OCR 结果合并 helper 拆分

### 本轮发现

- OCR 提取结果返回后，`processBatch()` 内手动把前面含字检测失败留下的 `detectionError` 合并回最终 result。
- 这属于 OCR 结果语义，继续内联会让任务主流程夹杂对象拼装细节。

### 已修复

- `ocr.ts` 新增 `mergeOcrResultWithDetectionError(result, detectionError?)`。
- `page.tsx` 改为调用该 helper 合并 OCR 提取结果和检测错误。
- 保持原语义：检测失败信息继续写入最终任务 result，便于历史/日志排查；不影响 OCR 的 extracted/translated 文本。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 可继续抽检测初始 result builder 或阶段运行 helper。
- 真实浏览器验证仍未完成。

## 2026-06-01 第三十九批：检测初始结果 builder 拆分

### 本轮发现

- 含字检测成功后，`processBatch()` 仍手动拼装 `{ hasText, extractedText: '', translatedText: '' }`。
- 这个初始 OCR 结果结构和检测失败 fallback 属于同一语义，应该放在 `ocr.ts` 统一维护。

### 已修复

- `ocr.ts` 新增 `buildDetectionStageResult(hasText)`。
- `buildDetectionFallbackResult()` 改为复用该 helper 再附加 `detectionError`。
- `page.tsx` 检测成功分支改为调用 `buildDetectionStageResult(hasText)`。
- 保持无字复制判断和后续 OCR 流程不变。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 可继续抽阶段运行 helper，或准备更大粒度单图 runner 提取。
- 真实浏览器验证仍未完成。

## 2026-06-01 第四十批：处理模式判断 helper 拆分

### 本轮发现

- `processBatch()` 内直接判断 `translate_and_remove || translate_only` 来决定是否走 OCR 翻译流程。
- 该判断属于图片处理模式语义，后续若新增模式，散落条件容易改漏。

### 已修复

- `image-generation.ts` 新增 `shouldRunOcrTranslationFlow(mode)`。
- `page.tsx` 翻译分支改为调用该 helper。
- 保留原流程：`translate_and_remove` 和 `translate_only` 走检测/OCR/结构化重绘；`remove_only` 走直接图像处理。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 可继续抽单图 runner 的阶段运行 helper，或更大粒度迁移主流程。
- 真实浏览器验证仍未完成。

## 2026-06-01 第四十一批：无字暂停恢复 builder 拆分

### 本轮发现

- `processBatch()` 中 paused + `hasText=false` + 已有 generatedUrl 的分支直接拼装 `copied/copied` 状态。
- 这是“无字图片已经复制，暂停后继续不要重新 OCR/生图”的关键恢复语义，应放入批处理状态 helper。

### 已修复

- `batch-state.ts` 新增 `buildResumeCopiedTaskUpdate(completedAt?)`。
- `page.tsx` 无字暂停恢复分支改为调用该 builder。
- 保持原语义：优先沿用任务原 `completedAt`，没有时再用当前时间；状态回到 `copied`。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 可继续抽单图恢复/重绘分支判断 helper，或推进 task runner 主流程提取。
- 真实浏览器验证仍未完成。

## 2026-06-01 第四十二批：单图恢复/重绘分支判断 helper 拆分

### 本轮发现

- `processBatch()` 中 paused 无字复制恢复、paused 已翻译继续重绘、单图 redraw 重绘三个分支都直接写条件。
- 这些判断属于批处理状态机分支语义，抽出后更容易迁移单图 runner。

### 已修复

- `batch-state.ts` 新增：
  - `shouldResumeCopiedTask(task)`
  - `shouldResumeTranslatedTask(task)`
  - `shouldRedrawTranslatedTask(task)`
- `BatchTaskLike.result` 补充 `hasText?: boolean`，让无字恢复判断有类型约束。
- `page.tsx` 三个恢复/重绘分支改为调用 helper，分支内部执行顺序不变。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 可继续抽翻译流程分支中的检测/OCR/生成阶段组合，或推进单图 runner 主流程模块化。
- 真实浏览器验证仍未完成。

## 2026-06-01 第四十三批：翻译流程阶段组合 helper 拆分

### 本轮发现

- `processBatch()` 翻译分支里直接串联检测、检测失败 fallback、无字复制、OCR 提取、生成前 result 更新和结构化重绘。
- 这一段层级较深，适合作为局部 `runTranslationFlow()` 先收敛，后续再考虑移出页面。

### 已修复

- 在单图处理上下文中新增局部 `runTranslationFlow()`。
- 将以下逻辑移入该 helper：
  - 进入检测阶段的状态更新。
  - 含字检测与检测失败 fallback。
  - 无字图片复制原图并返回。
  - OCR 提取与检测错误合并。
  - 生成前写入 OCR result。
  - 结构化重绘与成功收尾。
- 外层翻译分支缩减为 `await runTranslationFlow(); return;`。
- 保留无字复制、检测失败保守 OCR、结构化 pure translation 重绘语义不变。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 可继续抽 remove_only 流程 helper、恢复/重绘流程 helper，或开始把单图 runner 移出页面。
- 真实浏览器验证仍未完成。

## 2026-06-01 第四十四批：remove_only 流程 helper 拆分

### 本轮发现

- `remove_only` 分支仍在 `processBatch()` 外层直接写状态准备、直接图像阶段执行和成功收尾。
- 翻译流程已经收敛为局部 helper 后，直接图像处理也应保持同一结构。

### 已修复

- 在单图处理上下文新增局部 `runRemoveOnlyFlow()`。
- 将 `buildRemoveOnlyTaskUpdate()`、`runDirectImageStage('去水印重绘', ...)`、`markTaskImageSuccess()` 收敛到该 helper。
- 外层非翻译分支改为 `await runRemoveOnlyFlow()`。
- 保留 remove_only 原有 direct image edit、AbortSignal、降并发和成功写历史行为。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 可继续抽恢复/重绘流程 helper，或评估把单图 runner 上下文迁移到独立模块。
- 真实浏览器验证仍未完成。

## 2026-06-01 第四十五批：恢复/重绘流程 helper 拆分

### 本轮发现

- 单图处理主分支里仍直接串联三段恢复/重绘判断：无字复制恢复、已有翻译文本继续重绘、历史结果重新重绘。
- 这些路径都属于“进入常规翻译/remove_only 前的恢复短路”，适合收敛到同一个局部 helper。

### 已修复

- 新增局部 `runRecoveryOrRedrawFlow()`。
- 将 `shouldResumeCopiedTask()`、`shouldResumeTranslatedTask()`、`shouldRedrawTranslatedTask()` 三条分支迁入该 helper。
- helper 返回布尔值表示是否已经完成恢复/重绘路径，主流程只保留 `if (await runRecoveryOrRedrawFlow()) return;`。
- 保留原有行为：无字复制恢复不重跑上游；继续重绘/重新重绘保留结构化生图、清理 `reprocessMode`、历史进度持久化和暂停/重试控制。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 可继续抽单图 task runner 上下文，或把 stage runner/mark helper 进一步移出 `page.tsx`。
- 真实浏览器验证仍未完成。

## 2026-06-01 第四十六批：阶段运行参数 helper 拆分

### 本轮发现

- 文本阶段和图片阶段虽然已有具体 helper，但仍分别重复配置 queue、status、phase、transient 回调等 stage runner 参数。
- 这些样板不属于具体 OCR 或生图业务，继续内联会让后续迁移单图 runner 更难。

### 已修复

- 新增局部 `runImageGenerationStage()`，统一图片阶段的 `generating` 状态、phase、imageQueue 和降并发成功/失败回调。
- 新增局部 `runTextModelStage()`，统一文本模型阶段的 textQueue 与 stage runner 调用。
- `runStructuredImageStage()`、`runDirectImageStage()` 改为只关心各自请求 payload。
- `runDetectTextStage()`、`runExtractTextStage()` 改为只关心 OCR/text 请求 payload。
- 保留原 label、phase、debugLabel、AbortSignal、retry/backoff 和 image transient failure 降并发行为。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 可继续把 `runStageWithRetries` 的上下文或整个单图 task runner 迁出 `page.tsx`。
- 真实浏览器验证仍未完成。

## 2026-06-01 第四十七批：单图收尾 helper 收敛

### 本轮发现

- `page.tsx` 仍保留四个很薄的 mark helper：成功、无字复制、暂停、失败。
- 这些 helper 只负责调用 `applyTaskUpdate()` 和批处理状态 builder，属于单图 runner 收尾上下文样板。

### 已修复

- `batch-state.ts` 新增 `createBatchTaskOutcomeUpdaters()`。
- 将 `markTaskImageSuccess()`、`markTaskCopiedWithoutTranslation()`、`markTaskPaused()`、`markTaskFailed()` 的生成逻辑统一收敛到该工厂函数。
- 页面只传入 `applyTaskUpdate()` 和输出路径解析函数。
- 清理 `page.tsx` 中不再直接使用的单图收尾 builder 导入。
- 保留成功/复制/暂停/失败所有状态字段、完成时间、`reprocessMode` 清理和历史持久化入口不变。

### 验证

- 第一次改动后 `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- 第一次改动后 `npm --prefix "E:/图片翻译器/project" run build` 通过。
- 清理导入后再次 `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- 清理导入后再次 `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 可继续迁移 stage runner 上下文或整个单图 task runner。
- 真实浏览器验证仍未完成。

## 2026-06-01 第四十八批：单图阶段 runner 工厂拆分

### 本轮发现

- `page.tsx` 单图上下文中本地 `runStageWithRetries()` 仍重复传入 task、AbortController、attempt/retry getter/setter、暂停检查、错误转换和 retry 参数。
- 这些参数是单图阶段 runner 的固定上下文，适合用工厂函数收敛，为后续迁移整个 task runner 铺路。

### 已修复

- `batch-state.ts` 新增 `BatchStageRunOptions` 与 `BatchStageRunnerFactoryOptions`。
- 新增 `createBatchStageRunner(options)`，统一绑定 task、controller、retry/backoff、pause guard、错误转换和状态更新上下文。
- `page.tsx` 删除本地手写 `runBatchStageWithRetries({...})` 薄封装，改为 `createBatchStageRunner({...})`。
- 清理页面不再直接使用的 `runBatchStageWithRetries` 导入。
- 保留原 attempt/retry 计数、暂停 guard、AbortSignal、retry 文案、transient failure 回调和成功回调语义。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 可继续把 `applyTaskUpdate()` 上下文和任务处理流程迁移到独立 runner。
- 真实浏览器验证仍未完成。

## 2026-06-01 第四十九批：单图更新上下文 helper 拆分

### 本轮发现

- 单图处理上下文里仍内联 `applyTaskUpdate()`，同时管理 `attemptCount/retryCount/startedAt` 注入、pause guard 激活、`updateTask()` 和历史进度持久化。
- 这部分是 task runner 固定上下文，继续留在页面会阻碍后续整体迁移。

### 已修复

- `batch-state.ts` 新增 `BatchTaskProgressUpdate` 与 `BatchTaskUpdateControllerOptions`。
- 新增 `createBatchTaskUpdateController()`，统一管理：
  - attempt/retry 初始值与 getter/setter。
  - `startedAt` 注入。
  - 非 paused 状态更新时激活 pause guard。
  - 调用页面传入的 `updateTask()` 与 `persistTaskProgress()`。
  - 暴露 `isPauseGuardActive()` 给暂停守卫使用。
- `page.tsx` 改为创建 `taskUpdateController`，删除本地 attempt/retry/pauseGuard 变量和内联 `applyTaskUpdate()`。
- 修复抽取后残留的 attempt/retry 旧变量引用。
- 保留原 UI 更新、历史进度保存、pause guard、attempt/retry 计数和 startedAt 语义。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 可继续把任务流程本体迁移为独立 `runSingleBatchTask()`，但应小步推进。
- 真实浏览器验证仍未完成。

## 2026-06-01 第五十批：单图暂停守卫 helper 拆分

### 本轮发现

- `page.tsx` 单图上下文仍手写 `throwIfPaused()`，把 task、AbortController、pause guard 状态和 `isTaskPaused()` 组合起来。
- 这层逻辑属于批处理暂停守卫固定上下文，可以继续从页面收敛。

### 已修复

- `batch-state.ts` 新增 `BatchPauseGuardOptions`。
- 新增 `createBatchPauseGuard()`，统一创建单图暂停检查函数。
- `page.tsx` 改为使用 `createBatchPauseGuard()`，删除直接导入/调用 `throwIfBatchTaskPaused()` 的页面薄封装。
- 保留原语义：暂停任务首次继续不被旧 paused 状态立刻拦回；进入运行态后新的暂停会通过 guard 或 AbortSignal 中断。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 可继续迁移 `isTaskPaused` 查询或更大粒度 `runSingleBatchTask()`。
- 真实浏览器验证仍未完成。

## 2026-06-01 第五十一批：任务暂停查询 helper 拆分

### 本轮发现

- 单图 runner 中仍直接通过 `tasksRef.current.find(...).status === 'paused'` 判断任务是否暂停。
- 该查询是暂停守卫/阶段 runner 的通用输入，适合放到批处理状态 helper 中统一。

### 已修复

- `batch-state.ts` 新增 `createBatchTaskPausedLookup(getTasks)`。
- `page.tsx` 改为通过该 helper 创建 `isTaskPaused`，不再内联 `tasksRef` 查询逻辑。
- 保持暂停判断语义不变：只要当前任务状态是 `paused`，阶段 runner/pause guard 就会按原路径中断。

### 验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。

### 继续项

- 可继续小步抽 `runSingleBatchTask()`，或先补运行时浏览器验证。
- 真实浏览器验证仍未完成。

## 2026-06-01 第五十二批：工作台批处理主入口上移与组件化

### 本轮发现

- 真实浏览器验证时，批处理开始/暂停/继续功能本身可用，但主入口主要藏在左侧贴边控制台里。
- 新用户上传图片后不容易立刻发现“开始/暂停/继续”，尤其是在桌面控制台需要悬停/打开、移动端还要切换控制台的情况下。

### 已修复

- 新增 `project/app/workbench/workbench-command-bar.tsx`，承载工作台画布主命令条 UI。
- `project/app/page.tsx` 在任务图库上方渲染 `WorkbenchCommandBar`，替代内联 `.ui-workbench-command` JSX。
- 命令条直接展示批处理状态、耗时、完成/处理中/待处理/失败数量和进度条。
- 命令条提供主操作按钮：未开始时“开始”、运行中“暂停”、全部剩余暂停时“继续”。逻辑复用 `handlePrimaryRunAction()`，不改变原暂停/继续状态机。
- 命令条提供结果下载按钮和“详细控制台”按钮；详细控制台在移动端打开底部控制台，桌面端继续依靠左侧 dock 热区/悬停打开，减少主命令条重复入口。
- 移除旧的移动端悬浮“控制台”药丸按钮，避免它覆盖手机底部画布和任务卡；移动端改由命令条内“详细控制台”作为唯一明确入口。
- 画布空白点击判断排除 `.ui-workbench-command`，避免点击命令条时误触清空选中。
- 左侧批处理控制台继续保留，作为详细设置和状态入口。
- `eslint.config.mjs` 增加 `.codex-logs/**` ignore，避免 CDP 浏览器 profile 里的扩展脚本被 `eslint .` 当源码扫描。

### 运行时验证

- `npm --prefix "E:/图片翻译器/project" run lint` 通过。
- `npm --prefix "E:/图片翻译器/project" run build` 通过。
- HTTP smoke：`http://127.0.0.1:3006/` 返回 200，页面包含 `xobi`。
- Chrome DevTools Protocol 驱动真实浏览器上传测试图后，命令条显示 `开始 (1)`、`下载结果 (0)`、`详细控制台`。
- 点击命令条 `开始 (1)` 打开“开始翻译 1 张图片”确认弹层。
- 确认后命令条主按钮变为 `暂停`，状态进入运行中。
- 点击命令条 `暂停` 后全局提示“已暂停 1 张图片，点继续可接着处理。”，命令条主按钮变为 `继续 (1)`。
- 点击命令条 `继续 (1)` 后命令条主按钮回到 `暂停`，证明上移入口没有绕开原批处理状态机。
- 证据截图保存在 `project/.codex-logs/verify-cdp-command-exact-uploaded.png`、`verify-cdp-command-exact-start-dialog.png`、`verify-cdp-command-exact-running.png`、`verify-cdp-command-exact-paused.png`、`verify-cdp-command-exact-continued.png`。

### 继续项

- 继续完善移动端工作台触控交互和大批量图片性能。
- 可继续把 `processBatch()` 单图 runner 上下文迁出 `page.tsx`，但每一步都要维持无字复制、纯翻译、暂停/继续和历史持久化语义。
