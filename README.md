# xobi 图片翻译器

xobi 是一个本地图片翻译工作台，面向电商图、海报图、产品图和批量图片处理。它会把原图、结果图、历史记录都保存到本机 `资源/`，方便刷新浏览器后继续，不依赖云端项目管理。

## 当前状态

- 真实应用目录：`project/`
- 默认端口：`http://localhost:3006`
- 技术栈：Next.js 16、React 19、TypeScript、Tailwind CSS、JSZip、lucide-react
- 默认上游：`https://yunwu.ai/v1`
- 默认文本模型：`gemini-3.1-flash-lite-preview`
- 默认生图模型：`gemini-3.1-flash-image-preview`
- 秘钥保存：只保存在浏览器本地设置里，不写入源码、Markdown、历史记录或图片结果

## 快速启动

直接双击根目录：

```text
启动图片翻译器.bat
```

手动启动开发模式：

```bash
cd project
npm install
npm run dev -- --port 3006
```

生产模式更适合长期使用：

```bash
cd project
npm run build
set PORT=3006
npm run start
```

## 怎么用

1. 打开页面后，在全屏上传页选择图片或文件夹。
2. 进入工作台后，右侧贴边悬停打开控制面板。
3. 设置目标语言、输出比例、并发、模型和秘钥。
4. 点击“开始”前会出现 xobi 自定义确认框，可直接改语言和比例。
5. 运行中点击“暂停”会立刻暂停；暂停后点击“继续”会继续处理，不会重新翻译已完成图片。
6. 图片墙支持点击选中、Ctrl/Shift 多选、鼠标框选、右键菜单、Delete 移除、Ctrl+Z 撤回。
7. 完成后可单张下载、批量打包下载，也可以从历史恢复继续。

## 现在的 UI 方向

- 黑灰工业风，主色翡翠绿，少量青色和琥珀色。
- 不使用粉紫色 AI 模板感配色。
- 首页是大上传入口，上传前不展示复杂设置。
- 上传后是桌面画布感图片墙，右侧是悬浮控制抽屉。
- 进度条稳定显示，不做烦人的闪烁。
- 输出比例有形状预览，选 `1:1`、`9:16` 等能直观看到比例。
- 历史记录是工作台式归档界面，不是普通表格列表。

## 本地目录

- `project/`：真实 Next.js 应用。
- `资源/`：本地历史、原图、结果图、日志。不要随便删除。
- `codex/`：开发记录、当前状态、踩坑记录。
- `DEV.md`：根目录开发总账，记录本轮清理、修复、待办和验证。
- `AGENTS.md`：给后续 Codex/维护者看的硬规则。
- `.impeccable.md`：UI 设计方向和约束。

## 可清理和不可清理

可以清理，都会自动再生成：

- `project/.next/`
- `project/.codex-logs/`
- `project/*.tsbuildinfo`
- 根目录 `dev*.log`
- 根目录 `mcp-*.png`

不要随便清理：

- `资源/`：你的本地图片和历史。
- `project/node_modules/`：依赖目录，删了要重新 `npm install`。
- `project/app/`、`project/lib/`、`project/scripts/`：源码。

## 常用检查

```bash
cd project
npm run lint
npm run build
npm audit --audit-level=moderate
```

如果改了中文 UI，必须确认没有乱码、问号占位或替换字符。

## 维护文档

- 根开发总账：`DEV.md`
- 当前状态快照：`codex/CURRENT_STATE.md`
- 详细开发流水：`codex/DEV.md`
- 踩坑/Agent 记录：`codex/AGENTS.md`
- 应用目录说明：`project/README.md`
