# 图片翻译器项目说明

这是 `E:\图片翻译器` 下的真实 Next.js 应用目录。

## 技术栈

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS 4
- `lucide-react` 图标
- `jszip` 打包下载

## 运行命令

开发模式：

```bash
npm install
npm run dev -- --port 3006
```

生产模式：

```bash
npm run build
set PORT=3006
npm run start
```

检查命令：

```bash
npm run lint
npx tsc --noEmit
```

乱码扫描：

```text
检查 app/lib/scripts 中是否出现：连续问号占位符、U+FFFD replacement character、常见中文 mojibake 片段。
不要把这些坏字符字面量写进项目文档，否则会造成扫描误报。
```
## 当前默认配置

- API Base URL：`https://yunwu.ai/v1`
- 文本模型：`gemini-3.1-flash-lite-preview`
- 图片模型：`gemini-3.1-flash-image-preview`
- 默认端口：`3006`
- 默认处理模式：翻译重绘 / `translate_only`

设置面板里可以填：

- API 秘钥
- 请求头 JSON
- URL 参数 JSON
- 最大并发任务数
- 生图超时
- 文本模型和生图模型

注意：秘钥只缓存在浏览器，不写入 `资源/` 历史。

## 当前 UI 约定

- 空页面只显示全屏上传入口，不显示设置、历史、语言、并发、比例。
- 上传后进入工作台，顶部显示语言、历史、设置、进度状态。
- 图片墙应尽量吃满可用宽度，不应在右侧留大块空白。
- 原图和结果预览必须使用方形容器，图片完整显示，不裁切关键内容。
- 右侧控制栏是悬浮抽屉：默认收起，只在鼠标碰到最右侧时覆盖弹出。
- 控制栏不能长期占位，也不能挤压图片墙布局。

## 历史与本地保存

历史 API 在 `app/api/history/route.ts`。

保存位置：

```text
E:\图片翻译器\资源
```

保存内容：

- `history-index.json`：历史索引。
- `task_*/manifest.json`：任务清单。
- `task_*/logs.ndjson`：本地日志。
- `task_*/originals/`：上传原图。
- `task_*/results/`：输出结果。

关键行为：

- 上传后立刻保存原图。
- 每张完成后保存结果。
- 刷新浏览器后可以从历史恢复。
- 删除历史任务后应自动显示下一个任务详情。
- 单图重翻/重绘只处理当前图，不处理全批。

## 内存说明

开发模式 `next dev` 可能占用 500MB-900MB，这是开发编译、热更新和缓存导致的。浏览器页面本身也可能占几百 MB，尤其页面里有大量 base64 图片预览。

如果只日常使用、不开发 UI，优先考虑生产模式启动。

## 重要文件

- `app/page.tsx`：主工作台 UI 和前端流程。
- `app/api/generate/route.ts`：模型网关请求。
- `app/api/history/route.ts`：本地历史、图片落盘和日志。
- `lib/gateway.ts`：请求格式和网关设置。
- `scripts/copy-standalone-assets.mjs`：构建后复制 standalone 静态资源。
