# 图片翻译器 / Image Translator

一个基于 Next.js 的图片翻译与重绘工具。  
A Next.js app for OCR, translation, and in-place redraw of text inside images.

![App Cover](public/showcase/hero-generated.jpg)

## Showcase

![Before After](public/showcase/workflow-generated.jpg)

## 中文说明

### 主要流程

1. 文本模型进行 OCR 识别与翻译
2. 图片模型在原图版式中替换文字

### 功能特点

- 批量上传图片
- OCR 识别主文案
- 翻译后原位重绘
- 单张下载 / ZIP 打包下载
- 支持兼容 Gemini 的 relay 接口

### 当前推荐配置

- 文本模型：`gemini-3.1-flash-lite-preview`
- 图片模型：`gemini-3.1-flash-image-preview`
- 认证方式：`Bearer Token`

### 当前建议模式

优先使用：

- `翻译重绘`

### 启动

```bash
npm install
npm run dev -- --port 3006
```

打开：

```text
http://localhost:3006
```

### 配置项

右上角设置面板支持配置：

- API Key
- API Base URL
- API 认证方式
- 文本模型
- 图片模型
- 最大并发数
- 单次图片请求超时
- 额外请求头 JSON

### 安全说明

项目代码中没有硬编码你的真实 API Key。

但前端支持从以下环境变量读取默认值：

- `NEXT_PUBLIC_GEMINI_API_KEY`
- `NEXT_PUBLIC_GEMINI_API_BASE_URL`
- `NEXT_PUBLIC_GEMINI_TEXT_MODEL`
- `NEXT_PUBLIC_GEMINI_IMAGE_MODEL`

如果你要公开发给别人使用，建议不要在部署环境里填真实 `NEXT_PUBLIC_GEMINI_API_KEY`。

---

## English

### Core flow

1. a text model performs OCR and translation
2. an image model redraws translated text inside the original layout

### Features

- batch image upload
- OCR extraction for visible text
- translated in-place redraw
- single image download / ZIP export
- relay-friendly Gemini-compatible setup

### Recommended setup

- Text model: `gemini-3.1-flash-lite-preview`
- Image model: `gemini-3.1-flash-image-preview`
- Auth mode: `Bearer Token`

### Recommended mode

Use:

- `Translate and redraw`

### Run locally

```bash
npm install
npm run dev -- --port 3006
```

Open:

```text
http://localhost:3006
```

### Security note

The repository does not hardcode your real API key.
However, the frontend can read default values from `NEXT_PUBLIC_*` variables, so do not ship a real public API key in those values when sharing the app.

