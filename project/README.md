# project 应用说明

这里是 xobi 图片翻译器的真实 Next.js 应用目录。

## 技术栈

- Next.js 16
- React 19
- TypeScript 6
- Tailwind CSS
- `lucide-react` 图标
- `jszip` 打包下载
- 本地 API route 保存历史和转发模型请求

## 运行

需要 Node.js `20.9.0` 或更高版本。新克隆的仓库无需手动创建 `资源/`，启动器会在仓库根目录自动创建本地资源和日志目录。

日常使用直接双击项目根目录的 `启动图片翻译器.bat`。启动器会使用生产构建、等待健康检查通过后再打开浏览器；如果 xobi 已在运行，只会打开页面，不会重启或强杀正在接收返图的服务。

开发模式：

```bash
npm ci
npm run dev -- --port 3006
```

生产模式：

```bash
npm run build
set PORT=3006
npm run start
```

检查：

```bash
npm run lint
npm run build
npm audit --audit-level=moderate
```

## 重要文件

- `app/page.tsx`：主 UI、画布、多选、暂停继续、历史入口、设置弹窗。
- `app/globals.css`：全局视觉、动画、背景、控件细节。
- `app/api/generate/route.ts`：模型网关，兼容 Gemini/OpenAI 风格上游。
- `app/api/history/route.ts`：本地历史、原图/结果落盘、日志。
- `lib/gateway.ts`：网关设置、请求格式、模型兼容逻辑。
- `scripts/copy-standalone-assets.mjs`：生产构建后复制 standalone 静态资源。

## 默认配置

- 默认端口：`3006`
- API Base URL：`https://yunwu.ai/v1`
- 文本模型：当前源码默认值是 `gemini-3.1-flash-lite-preview` / flash-lite 类。
- 图片模型：当前源码默认值是 `gemini-3.1-flash-image-preview`，避免默认使用高费用 Pro 图片模型。
- 建议低成本运行：文本模型用 `gemini-3.1-flash-lite-preview` / flash-lite 类，图片模型用 `gemini-3.1-flash-image-preview` 或用户指定的便宜模型。
- 默认模式：翻译重绘 / `translate_only`
- 秘钥：浏览器本地保存，源码和历史都不保存

## 费用和模型安全规则

- 批量翻译前必须先确认设置里的图片模型，不要默认使用 `gemini-3-pro-image-preview` 继续跑。
- 图片重绘是主要费用来源；OCR/文字翻译通常不是主要成本。
- 如果用户没有明确同意高价模型，优先使用低成本 flash/flash-lite 图像模型。
- 历史任务可能保存旧模型摘要，恢复历史前也要检查当前浏览器设置和任务设置，避免误用旧的 Pro 配置。
- 任何 API key 只允许留在浏览器本地设置，不写入代码、Markdown、日志、截图或历史 manifest。
- 每张付费生图在提交前都会持久化唯一 `operationId`；暂停、刷新或恢复时先查询同一 Job，只有明确不存在时才首次提交。
- 付费生图的 Images endpoint 不可用时会直接报兼容性错误，不会自动改走另一个生图 endpoint 再提交一次。
- 返图会先写入本地恢复缓存，再原子保存到 `资源/`，成功元数据落盘后才清理恢复副本；网络超时或状态不明时不会自动重发生图。
- 生成通常可能持续数分钟；浏览器可以暂停轮询，但在任务完成前不要结束本地 xobi 服务。重复双击启动器不会结束健康服务。
- 结果图统一支持 JPEG、PNG、WebP、GIF、BMP、AVIF；同名结果会自动分配独立路径，不互相覆盖。
- 启动器和 `npm start` 默认只监听 `127.0.0.1:3006`，避免局域网读取本地 Job/历史接口。

## 当前 UI 结构

### 首页

- 空工作台时只显示全屏上传入口。
- 可选图片或文件夹。
- 不显示复杂设置，避免第一眼像后台系统。

### 工作台

- 上传后显示图片画布。
- 支持点击选中、Ctrl/Shift 多选、鼠标框选、Delete 移除、Ctrl+Z 撤回。
- 图片卡片包含原图、结果、状态、局部操作。
- 单图右键菜单支持重新翻译、重新重绘、暂停、继续、下载、移除。

### 左侧控制面板

- 鼠标贴左边缘时覆盖弹出。
- 不占固定宽度，不挤压画布。
- 显示语言、比例、并发、耗时、进度、操作按钮。

### 弹窗

- 开始翻译使用 xobi 自定义确认弹窗。
- 弹窗里可以直接切换目标语言和输出比例。
- 返回主页使用自定义确认弹窗。
- 不使用浏览器系统 `confirm/alert`。

## 暂停和继续

- 运行中点击主按钮：立即暂停全部可暂停任务。
- 暂停后点击主按钮：直接继续，不弹确认框，不重新翻译成功图片。
- 右键选中图片：可暂停选中，也可继续选中。
- 如果上游请求已经发出，前端会通过 `AbortSignal` 尽量取消；如果上游已经完成，则以最终状态为准。

## 历史保存

历史 API：`app/api/history/route.ts`

默认保存到仓库根目录：

```text
<仓库根目录>\资源
```

内容：

- `history-index.json`：历史索引。
- `task_*/manifest.json`：任务清单。
- `task_*/logs.ndjson`：事件日志。
- `task_*/originals/`：原图。
- `task_*/results/`：结果图。

约束：

- 上传后立刻保存原图。
- 每张图完成后立刻保存结果。
- 刷新浏览器后可从历史恢复。
- 删除历史必须是用户明确操作。

## 清理规则

可以删除：

- `.next/`
- `.codex-logs/`
- `*.tsbuildinfo`
- `*.log`

不要删除：

- `node_modules/`，除非准备重新安装。
- `../资源/`，这是用户数据。
- `public/`，里面是公开静态资源。

## 编码规则

- 中文 UI 和 Markdown 必须保持 UTF-8。
- 不要把中文写成问号、乱码、HTML 实体或拼音。
- Windows 下写中文文件优先用 Python `Path.write_text(..., encoding="utf-8")`。
