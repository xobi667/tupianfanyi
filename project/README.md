# 图片翻译器

一个基于 Next.js 的图片翻译与重绘工具。

当前主流程是：

1. 用文本模型做 OCR 和翻译
2. 用图片模型在原图上原位替换文字

## 当前能力

- 支持上传多张图片批量处理
- 支持 OCR 识别主文案
- 支持把原图中的文字翻译后原位替换
- 支持下载单张结果或打包下载
- 支持官方 Gemini 风格接口和部分兼容中转

## 当前建议用法

在你现在这组 relay / model 组合下，优先使用：

- `翻译重绘`

这是目前最稳定的模式。

`重绘翻译 + 去水印` 和 `仅去水印` 仍然保留，但是否稳定取决于你使用的图片模型和中转站兼容性。

## 模型配置建议

当前实测较合适的组合是：

- 文本模型：`gemini-3.1-flash-lite-preview`
- 图片模型：`gemini-3.1-flash-image-preview`
- 认证方式：`Bearer Token`

说明：

- 文本 OCR 请求仍走 Gemini 风格 `generateContent`
- Bearer 图片编辑请求会优先走 OpenAI 兼容的 `/v1/chat/completions` 图片编辑路径

## 启动方式

### 推荐

从仓库根目录双击：

- `启动图片翻译器.bat`

### 手动启动

在当前目录执行：

```bash
npm install
npm run dev -- --port 3006
```

然后打开：

```text
http://localhost:3006
```

## 设置项说明

页面右上角可以配置：

- API Key
- API Base URL
- API Key 传递方式
- 文本模型
- 图片模型
- 最大并发数
- 单次图片请求超时
- 额外请求头 JSON

## 安全说明

项目里没有写死你的真实 API Key。

但前端代码支持从这些环境变量读取默认值：

- `NEXT_PUBLIC_GEMINI_API_KEY`
- `NEXT_PUBLIC_GEMINI_API_BASE_URL`
- `NEXT_PUBLIC_GEMINI_TEXT_MODEL`
- `NEXT_PUBLIC_GEMINI_IMAGE_MODEL`

如果你要把项目发给别人使用，建议：

- 不要在部署环境里设置 `NEXT_PUBLIC_GEMINI_API_KEY`
- 让用户自己在页面设置里填写自己的 key

## 调试说明

开发模式下，服务端终端会输出详细日志，包括：

- 请求分类
- 模型名称
- 请求地址
- 认证方式
- 文本片段数 / 图片片段数
- 上游状态码
- 请求耗时
- 是否返回图片
- 上游错误信息

## 目录结构

- `app/`
  页面和 API 路由
- `lib/`
  网关配置和工具函数
- `node_modules/`
  依赖

## 已知情况

- 纯文本生图可用
- OCR 文本识别可用
- 原位翻译重绘可用
- 去水印是否稳定，取决于当前中转站和图片模型组合
