# 图片翻译器 / Image Translator

一个面向电商场景的图片翻译与原位重绘工具。  
A Next.js tool for translating in-image text and redrawing it in place for product posters, detail images, and localized creatives.

![应用封面 / App Cover](project/public/showcase/hero-generated.jpg)

## 效果图 / Showcase

![前后效果 / Before After](project/public/showcase/workflow-generated.jpg)

## 中文说明

### 项目定位

这个项目主要解决：

- 商品图中的外文文案识别
- 翻译后的原位替换
- 批量处理与批量下载

当前主流程：

1. 文本模型做 OCR 与翻译
2. 图片模型按原图版式重绘译文

### 当前能力

- 支持上传多张图片批量处理
- 支持主文案 OCR 提取
- 支持翻译后原位重绘
- 支持单张下载和 ZIP 打包下载
- 支持 Gemini 风格接口和部分兼容 relay

### 推荐使用方式

在当前 relay / model 组合下，优先使用：

- `翻译重绘`

这是当前最稳定的模式。

### 启动方式

直接双击根目录的：

- `启动图片翻译器.bat`

默认浏览器地址：

- `http://localhost:3006`

### 仓库结构

- `project/`：真实可运行项目目录
- `codex/`：开发记录、踩坑和规则文档
- `启动图片翻译器.bat`：根目录启动器

---

## English

### What this project is for

This project is built for localized e-commerce image workflows:

- OCR text extraction from product images
- translated in-place text replacement
- batch processing and export

Current pipeline:

1. a text model performs OCR and translation
2. an image model redraws translated text inside the original layout

### Current features

- batch image upload
- OCR extraction for visible customer-facing text
- in-place translated redraw
- single download or ZIP export
- Gemini-style gateway support and relay-friendly workflow

### Recommended mode

For the current relay / model setup, the recommended mode is:

- `Translate and redraw`

This is currently the most stable workflow.

### How to run

Double-click from the repository root:

- `启动图片翻译器.bat`

Default local URL:

- `http://localhost:3006`

### Repository layout

- `project/`: actual runnable app
- `codex/`: dev notes and pitfall logs
- `启动图片翻译器.bat`: root launcher

## More docs

- Full project usage: `project/README.md`
- Agent notes: `codex/AGENTS.md`
- Dev log: `codex/DEV.md`
