# DEV Log

## Purpose

This file records the development flow of the project.
More pitfall-oriented notes live in `AGENTS.md`.

## 2026-03-27

### Image Timeout

- Found that the frontend default single image request timeout was `15000ms`.
- Real upstream responses were slower than that.
- Raised the default timeout and migrated old stored defaults.

### Cancellation Forwarding

- The server did not propagate browser cancellation to upstream.
- Added upstream cancellation forwarding so abandoned requests stop earlier.

### Translation Flow Experiments

- Tried direct-edit-first.
- Result: complex posters deformed too easily.
- Switched back to OCR + structured redraw first.

### Yunwu Validation

- Verified Yunwu image generation directly.
- Successfully generated `cat.jpg` during testing.
- This proved the account, key, and image model could produce images.

## 2026-03-28

### Current Translation Strategy

- Translation modes now work like this:
  - text model OCR first
  - image model redraw second
- Direct fallback was removed from translation modes.
- `remove_only` still keeps the pure image path.

### Real Translation Test

- Created `test-translate-input.png`.
- Saved OCR output to `test-translate-ocr.txt`.
- Result:
  - OCR succeeded
  - image redraw failed

### Current Upstream Failure

- Real upstream error:
  - `gemini image generation failed: MALFORMED_FUNCTION_CALL`
- This showed the OCR stage was not the blocker.
- The failure was in the image-edit/redraw channel for image-to-image editing.

### Route Fix

- Fixed `/api/generate` so upstream non-2xx is returned immediately.
- This prevents the route from hiding the real upstream failure behind a later fallback `404`.

### Minimal Prompt Retry

- Reduced translation-image prompts to concise built-in instructions.
- Added image attempt expansion to try `object_parts` and `role_parts`.
- Re-tested against upstream.
- Result stayed the same:
  - `gemini image generation failed: MALFORMED_FUNCTION_CALL`

### Current Working Path

- Verified on the current relay:
  - `gemini-3.1-flash-image-preview` can do text-to-image
  - `gemini-3.1-flash-image-preview` can read image input
  - `gemini-3.1-flash-image-preview` can replace visible text in an input image when called through `/v1/chat/completions`
- Verified failures:
  - watermark removal still fails with `MALFORMED_FUNCTION_CALL`
- Product changes:
  - `/api/generate` now routes bearer image editing through the OpenAI-compatible path first
  - UI default mode is now `translate_only`
  - watermark-removal handling was reduced to an optional hint instead of a big separate workflow

### Workspace Reorganization

- Moved the main runnable project into `project`.
- Root now keeps launcher files and `codex`.
- Restored `codex` after accidental deletion and rebuilt its contents.

## 2026-04-25

### Documentation Refresh

- Updated project documentation to match the current implementation:
  - full-screen upload-only empty page
  - post-upload workbench controls
  - right-side hover drawer
  - local history and resource persistence
  - Next dev memory behavior
  - safe cleanup list
- Added root `AGENTS.md` so future Codex sessions have local project rules in the repository.
- Added `codex/CURRENT_STATE.md` as a quick handoff snapshot.

