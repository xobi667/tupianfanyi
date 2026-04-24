# Current State / 当前状态

更新时间：2026-04-25

## 运行状态

- 应用目录：`E:\图片翻译器\project`
- 默认 URL：`http://localhost:3006`
- 当前 bat：使用 `npm run dev -- --port 3006` 启动开发服务器。
- 开发模式内存可能很大，Next dev 和浏览器都可能各占几百 MB。

## 当前 UI

- 空页面：全屏上传区，只保留 `选图片` 和 `选文件夹`。
- 工作台：上传后显示顶部语言、历史、设置、进度状态。
- 图片墙：卡片自动铺满可用宽度。
- 图片预览：原图/结果为方形，使用完整显示。
- 控制栏：右侧悬浮抽屉，默认收起，鼠标碰到最右侧才覆盖弹出。

## 当前数据逻辑

- 上传后立即保存原图到 `资源/`。
- 每张结果生成后保存到 `资源/`。
- 历史任务保存在 `资源/history-index.json` 和 `资源/task_*/manifest.json`。
- 删除历史任务后会选择下一个任务详情。
- 重新上传会弹窗选择：追加当前项目、归档当前并新建、取消。

## 当前模型/接口

- API Base URL：`https://yunwu.ai/v1`
- 文本模型：`gemini-3.1-flash-lite-preview`
- 图片模型：`gemini-3.1-flash-image-preview`
- 秘钥由设置面板填写，只存在浏览器本地设置，不写入历史。

## 可清理内容

可以清理：

- `project/.next/`
- `project/.codex-logs/`
- 根目录 `mcp-*.png`
- `dev3006.out.log` / `dev3006.err.log`

不要随便清理：

- `资源/`
- `project/node_modules/`，除非准备重新 `npm install`
- `project/app/`、`project/lib/`、`project/scripts/` 等源码

## 必跑检查

```bash
cd project
npm run lint
npx tsc --noEmit
```

乱码扫描：

```text
检查 app/lib/scripts 中是否出现：连续问号占位符、U+FFFD replacement character、常见中文 mojibake 片段。
不要把这些坏字符字面量写进项目文档，否则会造成扫描误报。
```
