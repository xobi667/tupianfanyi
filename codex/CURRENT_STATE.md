# Current State Snapshot

更新时间：2026-04-25

## 项目定位

xobi 是本地图片翻译工作台。用户主要自己使用，关心：上传快、批量稳、历史不丢、暂停继续直觉、UI 不像模板后台。

## 运行信息

- 根目录：`E:\图片翻译器`
- 应用目录：`project/`
- 默认 URL：`http://localhost:3006`
- 启动 bat：`启动图片翻译器.bat`
- 开发命令：`npm run dev -- --port 3006`
- 生产命令：`npm run build` 后 `npm run start`

## 当前 UI

- 首页：全屏上传入口。
- 工作台：桌面画布感图片墙。
- 控制面板：右侧贴边悬浮抽屉。
- 颜色：黑灰工业风，翡翠绿主色，青色/琥珀辅助。
- 品牌：`xobi`。
- 比例：支持原图、1:1、3:2、2:3、4:3、3:4、4:5、16:9、9:16、21:9、5:4、2:1、1:2、3:1、1:3、5:7，并有形状预览。

## 当前交互

- 点击选中。
- Ctrl/Shift 多选。
- 鼠标矩形框选。
- Delete 软移除。
- Ctrl+Z 撤回软移除。
- 右键菜单：重新翻译、重新重绘、暂停选中、继续选中、下载、移除。
- 点击 `xobi` 返回主页前会弹自定义确认。
- 开始翻译前会弹自定义确认，并可改语言和比例。

## 暂停/继续

- 运行中主按钮是“暂停”，点击立即暂停。
- 全部剩余任务暂停后主按钮是“继续”，点击直接继续。
- 继续不会重新处理 `success` 或 `copied`。
- 已有 OCR/翻译文本时，继续优先从后续阶段跑，尽量不重做前面步骤。
- 已发给上游的请求通过 AbortSignal 尽量取消；如果上游已经完成，以最终返回为准。

## 当前数据逻辑

- 上传后原图保存到 `资源/`。
- 每张结果完成后保存到 `资源/`。
- 历史索引：`资源/history-index.json`。
- 任务清单：`资源/task_*/manifest.json`。
- 日志：`资源/task_*/logs.ndjson`。
- 秘钥只在浏览器本地设置，不进历史。

## 已知待优化

- 历史 UI 可以继续更强：搜索、筛选、空状态、批量操作。
- 设置页控件仍可统一：数字输入、下拉、测试按钮、错误信息。
- 大批量图片可做懒加载或虚拟列表降低内存。
- 手机端画布交互还需要专门设计。
- 需要 Playwright/E2E 固化暂停继续、框选、历史恢复。

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
