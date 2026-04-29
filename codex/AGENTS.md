# AGENTS Log

## Purpose

Record every agent intervention in this project:

- pitfalls
- wrong assumptions
- small code changes
- temporary debug steps
- final fixes

Every small change should append a new entry instead of overwriting history.

## Rules

1. Append by date.
2. Each entry must include:
   - trigger
   - what changed
   - what went wrong
   - final fix
3. Temporary debug code, temp folders, and temp scripts must also be recorded.
4. Do not delete this folder again unless the user explicitly asks to delete the documents themselves.

## 2026-03-27

### Entry 1

- Trigger: the user reported that the relay looked healthy, but the page still showed image generation failure.
- What changed: inspected frontend timeout logic, server forwarding, and upstream logs.
- Pitfall:
  - default image timeout was only `15000ms`
  - frontend timeout did not propagate cancellation to upstream
- Final fix:
  - raised the default timeout
  - forwarded the browser cancellation signal to upstream

### Entry 2

- Trigger: the user expected behavior closer to Gemini web image editing instead of a heavy multi-step fallback flow.
- What changed: initially switched translation mode to try direct edit first, then OCR + redraw as fallback.
- Pitfall:
  - direct whole-image editing deformed complex posters
- Final fix:
  - changed the priority back to OCR + structured redraw first

### Entry 3

- Trigger: needed to read the browser's real runtime settings.
- What changed: temporarily added a `dumpSettings` debug output to the page.
- Pitfall:
  - using `useSearchParams()` directly caused `next build` to fail because of the missing suspense boundary requirement
- Final fix:
  - changed the debug switch to read `window.location.search`
  - removed the debug output afterward

### Entry 4

- Trigger: needed to verify whether Yunwu image generation actually worked with a real key.
- What changed: directly called the Yunwu API and generated a cat image.
- Pitfall:
  - a temporary script failed when writing to a Chinese absolute path
  - repeated invalid key tests triggered Yunwu cooldown/rate protection
- Final fix:
  - switched the output file to a relative project-root path
  - successfully generated `cat.jpg` with a valid user key

## 2026-03-28

### Entry 5

- Trigger: the user explicitly required translation mode to use the text model OCR path and not silently bypass OCR.
- What changed: removed direct fallback from translation modes.
- Pitfall:
  - OCR was connected, but translation modes could still fall back to direct whole-image edit
- Final fix:
  - `translate_and_remove` and `translate_only` now force OCR first and do not use direct fallback
  - `remove_only` still uses the pure image path

### Entry 6

- Trigger: needed to run a real translation test instead of a pure text-to-image generation test.
- What changed:
  - created a local poster test image `test-translate-input.png`
  - ran the full `OCR -> image redraw` chain
- Pitfall:
  - OCR succeeded and returned usable text
  - image redraw failed with upstream error `gemini image generation failed: MALFORMED_FUNCTION_CALL`
  - the route layer kept trying a fallback URL after upstream non-2xx and could mask the real error as `404 Invalid URL`
- Final fix:
  - `/api/generate` now returns upstream non-2xx immediately
  - the UI will now see the real upstream failure instead of a misleading fallback error

### Entry 7

- Trigger: the user required translation-image prompts to be simplified to the smallest possible built-in prompt.
- What changed:
  - simplified translation redraw prompts to short imperative prompts
  - added image request attempt expansion so image generation now tries `object_parts` before `role_parts`
- Pitfall:
  - even with minimal prompts and `object_parts`, upstream still returned `gemini image generation failed: MALFORMED_FUNCTION_CALL`
- Final fix:
  - kept the simpler prompt strategy in code
  - confirmed the current blocker was still upstream image-edit channel compatibility, not OCR complexity

### Entry 8

- Trigger: needed to verify whether the current model could translate image text at all.
- What changed:
  - tested `gemini-3.1-flash-image-preview` directly on the relay with image input
  - confirmed image description worked
  - confirmed text replacement in images worked through `Bearer + /v1/chat/completions`
- Pitfall:
  - `generateContent` was the wrong path for this relay/model combination for image editing
  - watermark removal still fails with `MALFORMED_FUNCTION_CALL`, even when text replacement succeeds
- Final fix:
  - server image requests with bearer auth now try the OpenAI-compatible image editing path first
  - app default mode changed to `translate_only`
  - watermark-removal modes now show a warning on the current relay/model combination

### Entry 9

- Trigger: the user did not want watermark removal treated as a separate special feature.
- What changed:
  - translation prompts now treat watermark removal as an optional simple hint
  - the watermark hint field remains available without extra warning banners
- Pitfall:
  - the UI had started over-explaining watermark limitations and made the flow feel heavier than needed
- Final fix:
  - simplified the behavior back to: translate first, optionally mention watermark text if the user provides it

### Entry 10

- Trigger: the user wanted the project root cleaned up and `codex` preserved.
- What changed:
  - removed temporary test files and debug leftovers
  - moved the main project files under `project`
  - restored `codex` back to the repository root
- Pitfall:
  - accidentally overwrote the `codex` documents with incomplete placeholders
- Final fix:
  - rebuilt `AGENTS.md` and `DEV.md` with the full record again

### Entry 11

- Trigger: Chinese text, README content, and logs were repeatedly broken by encoding mistakes and half-fixed rewrites.
- Rule added:
  - do not guess whether a file is fixed based on terminal rendering alone
  - verify file content through unicode-safe inspection before claiming the fix is complete
  - do not leave question marks, mojibake, or partial rewrites in user-facing docs or logs
  - when in doubt, rewrite the affected file deterministically instead of patching blindly

## 2026-04-25

### Entry 12

- Trigger: the user asked to update all project Markdown after the UI/history/memory changes.
- What changed:
  - refreshed root README and project README
  - added root `AGENTS.md`
  - added `codex/CURRENT_STATE.md`
  - updated `.impeccable.md` design context
- Pitfall:
  - `node_modules` contains many third-party Markdown files and must not be treated as project docs
- Final fix:
  - only project-owned Markdown files were updated
  - documented current UI, history persistence, memory notes, safe cleanup targets, and encoding rules

## 2026-04-25 Entry: Cleanup, Docs, Continue Fix

- Trigger: user requested full cleanup, Markdown refresh, DEV log, and direct fixes for broken logic.
- What changed:
  - cleaned logs/screenshots/cache artifacts
  - refreshed root/project/Codex docs
  - fixed continue flow so pure paused tasks continue directly
  - added right-click `继续选中`
  - sent AbortSignal into the direct remove/redraw branch
- What went wrong:
  - previous pause/continue UX could still feel like a new start in some scoped flows
  - one image branch still missed cancellation signal
  - root ignore file had Chinese display risk
- Final fix:
  - direct continue path for paused-only scope
  - explicit context-menu continue
  - UTF-8 docs and ignore rules
