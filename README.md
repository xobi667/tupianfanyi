# 图片翻译器 / Image Translator

面向电商图、海报图、产品图的本地图片翻译工作台。上传图片后，原图会落盘到本地 `资源/`，翻译结果和历史记录也会持续保存，刷新浏览器后可以从历史恢复继续。

## 当前状态

- 技术栈：Next.js 16 + React 19 + TypeScript。
- 默认地址：`http://localhost:3006`。
- 默认模型：文本 `gemini-3.1-flash-lite-preview`，生图 `gemini-3.1-flash-image-preview`。
- 默认上游：`https://yunwu.ai/v1`。
- 秘钥：只缓存在浏览器设置里，不写入本地历史。
- 当前 UI：空页面是全屏上传入口；进入工作台后才显示语言、历史、设置、进度和右侧悬浮控制栏。

## 快速启动

直接双击根目录：

```text
启动图片翻译器.bat
```

当前 bat 使用开发模式启动：

```bash
cd project
npm run dev -- --port 3006
```

开发模式内存会比较大，这是 Next dev 的正常情况。日常长期使用如果嫌内存大，可以改成生产模式：

```bash
cd project
npm run build
set PORT=3006
npm run start
```

## 使用流程

1. 打开页面后，在全屏上传区选择图片或文件夹。
2. 进入工作台后设置目标语言、比例、并发、模型和秘钥。
3. 点击开始翻译。
4. 每张图完成后会写入 `资源/` 和历史记录。
5. 可以单张下载、下载已完成、或从历史恢复继续。
6. 单图右键/操作菜单只处理当前图，不会误跑全批。

## 本地目录

- `project/`：真实可运行的 Next.js 项目。
- `资源/`：本地历史、原图、结果图、日志，不能随便删。
- `codex/`：开发记录、踩坑和维护说明。
- `.impeccable.md`：UI 设计方向与约束。
- `AGENTS.md`：给 Codex/后续维护者的根目录规则。

## 哪些东西占空间

- `project/node_modules/`：npm 依赖，通常几百 MB；删了要重新 `npm install`。
- `project/.next/`：Next 编译缓存/构建产物；可以删，会重新生成。
- `project/.codex-logs/`：Codex 日志；可以清理。
- `资源/`：你的本地图片历史；不要乱删。

## 维护文档

- 项目详细说明：`project/README.md`
- 当前状态快照：`codex/CURRENT_STATE.md`
- Agent 规则：`AGENTS.md`
- 开发记录：`codex/DEV.md`
- 踩坑记录：`codex/AGENTS.md`
