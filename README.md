# 鍥剧墖缈昏瘧鍣?/ Image Translator

涓€涓潰鍚戠數鍟嗗満鏅殑鍥剧墖缈昏瘧涓庡師浣嶉噸缁樺伐鍏枫€? 
A Next.js tool for translating in-image text and redrawing it in place for product posters, detail images, and localized creatives.

![搴旂敤灏侀潰 / App Cover](project/public/showcase/hero-generated.jpg)

## 鏁堟灉鍥?/ Showcase

![鍓嶅悗鏁堟灉 / Before After](project/public/showcase/workflow-generated.jpg)

## 涓枃璇存槑

### 椤圭洰瀹氫綅

杩欎釜椤圭洰涓昏瑙ｅ喅锛?
- 鍟嗗搧鍥句腑鐨勫鏂囨枃妗堣瘑鍒?- 缈昏瘧鍚庣殑鍘熶綅鏇挎崲
- 鎵归噺澶勭悊涓庢壒閲忎笅杞?
褰撳墠涓绘祦绋嬶細

1. 鏂囨湰妯″瀷鍋?OCR 涓庣炕璇?2. 鍥剧墖妯″瀷鎸夊師鍥剧増寮忛噸缁樿瘧鏂?
### 褰撳墠鑳藉姏

- 鏀寔涓婁紶澶氬紶鍥剧墖鎵归噺澶勭悊
- 鏀寔涓绘枃妗?OCR 鎻愬彇
- 鏀寔缈昏瘧鍚庡師浣嶉噸缁?- 鏀寔鍗曞紶涓嬭浇鍜?ZIP 鎵撳寘涓嬭浇
- 鏀寔 Gemini 椋庢牸鎺ュ彛鍜岄儴鍒嗗吋瀹?relay

### 鎺ㄨ崘浣跨敤鏂瑰紡

鍦ㄥ綋鍓?relay / model 缁勫悎涓嬶紝浼樺厛浣跨敤锛?
- `缈昏瘧閲嶇粯`

杩欐槸褰撳墠鏈€绋冲畾鐨勬ā寮忋€?
### 鍚姩鏂瑰紡

鐩存帴鍙屽嚮鏍圭洰褰曠殑锛?
- `鍚姩鍥剧墖缈昏瘧鍣?bat`

榛樿娴忚鍣ㄥ湴鍧€锛?
- `http://localhost:3006`

### 浠撳簱缁撴瀯

- `project/`锛氱湡瀹炲彲杩愯椤圭洰鐩綍
- `codex/`锛氬紑鍙戣褰曘€佽俯鍧戝拰瑙勫垯鏂囨。
- `鍚姩鍥剧墖缈昏瘧鍣?bat`锛氭牴鐩綍鍚姩鍣?
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

- `鍚姩鍥剧墖缈昏瘧鍣?bat`

Default local URL:

- `http://localhost:3006`

### Repository layout

- `project/`: actual runnable app
- `codex/`: dev notes and pitfall logs
- `鍚姩鍥剧墖缈昏瘧鍣?bat`: root launcher

## More docs

- Full project usage: `project/README.md`
- Agent notes: `codex/AGENTS.md`
- Dev log: `codex/DEV.md`

