from __future__ import annotations

import argparse
import base64
import json
import os
import shutil
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
REPORT_FILE_NAME = "翻译用时报告.txt"


def normalize_model_name(model: str) -> str:
    return model.strip().removeprefix("models/")


def is_gemini_model(model: str) -> bool:
    return normalize_model_name(model).lower().startswith("gemini-")


def is_gpt_image_model(model: str) -> bool:
    return normalize_model_name(model).lower().startswith("gpt-image-")


def is_official_gemini_base_url(api_base_url: str) -> bool:
    normalized = api_base_url.strip().lower()
    return "generativelanguage.googleapis.com" in normalized


def parse_json_object_text(raw_text: str, label: str) -> dict[str, str]:
    trimmed = raw_text.strip()
    if not trimmed:
        return {}

    try:
        parsed = json.loads(trimmed)
    except json.JSONDecodeError as error:
        raise ValueError(f"{label} must be a valid JSON object.") from error

    if not isinstance(parsed, dict):
        raise ValueError(f"{label} must be a JSON object.")

    return {str(key): str(value) for key, value in parsed.items()}


def stringify_json_object(data: dict[str, str]) -> str:
    return "{}" if not data else json.dumps(data, ensure_ascii=False, indent=2)


def build_legacy_request_config(
    api_key: str,
    auth_mode: str,
    custom_auth_header: str,
    extra_headers_text: str,
) -> tuple[dict[str, str], dict[str, str]]:
    headers = parse_json_object_text(extra_headers_text or "{}", "Legacy extra headers JSON")
    query_params: dict[str, str] = {}

    if not api_key:
        return headers, query_params

    if auth_mode == "query":
        query_params[custom_auth_header or "key"] = api_key
    elif auth_mode == "custom":
        headers[custom_auth_header or "x-api-key"] = api_key
    elif auth_mode == "x-goog-api-key":
        headers["x-goog-api-key"] = api_key
    elif auth_mode == "bearer":
        headers["Authorization"] = f"Bearer {api_key}"

    return headers, query_params


def get_recommended_auth_mode(api_base_url: str) -> str:
    return "x-goog-api-key" if is_official_gemini_base_url(api_base_url) else "bearer"


def get_default_custom_auth_header(auth_mode: str) -> str:
    if auth_mode == "bearer":
        return "Authorization"
    if auth_mode == "x-goog-api-key":
        return "x-goog-api-key"
    if auth_mode == "query":
        return "key"
    return "x-api-key"


def get_primary_image_transport(model: str, api_base_url: str) -> str:
    if is_gpt_image_model(model):
        return "openai-images"
    if is_gemini_model(model):
        return "generate-content"
    return "openai-chat-completions"


def get_prompt_language_name(target_language: str) -> str:
    normalized = target_language.strip()
    language_names = {
        "中文": "Simplified Chinese",
        "English": "English",
        "日本語": "Japanese",
        "한국어": "Korean",
        "Français": "French",
        "Español": "Spanish",
        "Русский": "Russian",
        "ไทย": "Thai",
        "Bahasa Indonesia": "Indonesian",
    }
    return language_names.get(normalized, normalized or "English")


def build_extract_prompt(target_language: str) -> str:
    prompt_language = get_prompt_language_name(target_language)
    return f"""You are an expert OCR, layout understanding, and translation system.
Your task is to understand the whole image first, then extract only the core customer-facing text that should actually be translated.

Core rules:
1. Understand the overall image context before reading text.
2. Extract only the main intended content text.
3. Ignore irrelevant background text, watermarks, logos without meaningful text, rulers, tiny measurement labels, and decorative marks.
4. Use semantic correction instead of broken OCR fragments.
5. Preserve logical hierarchy with sensible line breaks.
6. Translate the final extracted core text into {prompt_language}.
7. If there is no meaningful customer-facing text that needs translation, return hasText as false and both text fields as empty strings.

Return JSON only with:
- hasText
- extractedText
- translatedText"""


def build_direct_image_prompt(
    target_language: str,
    extracted_text: str,
    translated_text: str,
) -> str:
    prompt_language = get_prompt_language_name(target_language)
    text_replacement_block = ""
    if extracted_text.strip() and translated_text.strip():
        text_replacement_block = (
            f"\nOriginal text to replace:\n{extracted_text}\n\n"
            f"Translated text:\n{translated_text}"
        )

    return (
        "Edit this image only.\n"
        f"Translate the main visible customer-facing text into {prompt_language} and replace it in place.\n"
        "Keep the same canvas size, same layout, same background, same product, same decorations, and same non-text elements.\n"
        "Edit only text regions.\n"
        "If the image does not contain meaningful customer-facing text, return it unchanged.\n"
        f"Return only the edited image.{text_replacement_block}"
    )


def build_structured_image_prompt(
    target_language: str,
    extracted_text: str,
    translated_text: str,
) -> str:
    prompt_language = get_prompt_language_name(target_language)
    return f"""Edit this image only.
Translate the main visible text into {prompt_language} and replace it in place.
Keep the same canvas size, same layout, same background, same decorations, and same non-text elements.
Edit only text regions.

Original text:
{extracted_text}

Translated text:
{translated_text}

Return only the edited image."""


def parse_json_text(raw_text: str) -> dict[str, Any]:
    cleaned = (
        raw_text.strip()
        .removeprefix("```json")
        .removeprefix("```")
        .removesuffix("```")
        .strip()
    )
    return json.loads(cleaned)


def choose_output_path(base_output_path: Path, mime_type: str | None) -> Path:
    if not mime_type:
        return base_output_path

    suffix_map = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/bmp": ".bmp",
    }
    target_suffix = suffix_map.get(mime_type.lower())
    if not target_suffix:
        return base_output_path

    if base_output_path.suffix.lower() == target_suffix:
        return base_output_path

    return base_output_path.with_suffix(target_suffix)


@dataclass
class GatewaySettings:
    api_base_url: str
    request_headers_text: str
    request_query_params_text: str
    text_model: str
    image_model: str
    max_parallel_tasks: int
    image_request_timeout_ms: int

    def to_payload(self) -> dict[str, Any]:
        return {
            "apiBaseUrl": self.api_base_url,
            "requestHeadersText": self.request_headers_text,
            "requestQueryParamsText": self.request_query_params_text,
            "textModel": self.text_model,
            "imageModel": self.image_model,
            "maxParallelTasks": self.max_parallel_tasks,
            "imageRequestTimeoutMs": self.image_request_timeout_ms,
        }


@dataclass
class DetectionResult:
    source_path: Path
    relative_path: Path
    has_text: bool
    extracted_text: str = ""
    translated_text: str = ""
    detection_duration_sec: float = 0.0
    detection_error: str = ""


@dataclass
class ProcessingResult:
    source_path: Path
    relative_path: Path
    output_path: Path
    status: str
    detection_duration_sec: float = 0.0
    processing_duration_sec: float = 0.0
    retries: int = 0
    detail: str = ""
    extracted_preview: str = ""


class GatewayClient:
    def __init__(self, gateway_url: str, settings: GatewaySettings):
        self.gateway_url = gateway_url
        self.settings = settings

    def request(self, payload: dict[str, Any], timeout_sec: float) -> dict[str, Any]:
        request = Request(
            self.gateway_url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=timeout_sec) as response:
                return json.loads(response.read().decode("utf-8", errors="replace"))
        except HTTPError as error:
            raw_text = error.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(raw_text)
                message = parsed.get("error", {}).get("message") or raw_text
            except json.JSONDecodeError:
                message = raw_text or f"HTTP {error.code}"
            raise RuntimeError(message) from error
        except URLError as error:
            raise RuntimeError(str(error)) from error

    @staticmethod
    def extract_text(response: dict[str, Any]) -> str:
        parts: list[str] = []
        for candidate in response.get("candidates") or []:
            for part in (candidate.get("content") or {}).get("parts") or []:
                text = part.get("text")
                if isinstance(text, str) and text.strip():
                    parts.append(text.strip())
        return "\n".join(parts).strip()

    @staticmethod
    def extract_image(response: dict[str, Any]) -> tuple[str | None, str | None]:
        for candidate in response.get("candidates") or []:
            for part in (candidate.get("content") or {}).get("parts") or []:
                inline_data = part.get("inlineData") or part.get("inline_data") or {}
                data = inline_data.get("data")
                mime_type = inline_data.get("mimeType") or inline_data.get("mime_type")
                if isinstance(data, str) and data.strip():
                    return data, mime_type
        return None, None


class BatchTranslator:
    def __init__(
        self,
        source_root: Path,
        output_root: Path,
        gateway_client: GatewayClient,
        target_language: str,
        detect_workers: int,
        translate_workers: int,
        max_retries: int,
    ):
        self.source_root = source_root
        self.output_root = output_root
        self.gateway_client = gateway_client
        self.target_language = target_language
        self.detect_workers = detect_workers
        self.translate_workers = translate_workers
        self.max_retries = max_retries
        self.log_lock = threading.Lock()

    def log(self, message: str) -> None:
        with self.log_lock:
            print(message, flush=True)

    def scan_images(self) -> list[Path]:
        return sorted(
            path
            for path in self.source_root.rglob("*")
            if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES
        )

    def read_image_part(self, image_path: Path) -> dict[str, Any]:
        suffix_to_mime = {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".webp": "image/webp",
            ".bmp": "image/bmp",
        }
        mime_type = suffix_to_mime.get(image_path.suffix.lower(), "image/jpeg")
        data = base64.b64encode(image_path.read_bytes()).decode("ascii")
        return {
            "inlineData": {
                "data": data,
                "mimeType": mime_type,
            }
        }

    def detect_text(self, image_path: Path) -> DetectionResult:
        relative_path = image_path.relative_to(self.source_root)
        started = time.time()
        image_part = self.read_image_part(image_path)
        payload = {
            "settings": self.gateway_client.settings.to_payload(),
            "model": self.gateway_client.settings.text_model,
            "requestKind": "text",
            "debugLabel": "batch-detect-id",
            "parts": [
                image_part,
                {"text": build_extract_prompt(self.target_language)},
            ],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": {
                    "type": "OBJECT",
                    "properties": {
                        "hasText": {"type": "BOOLEAN"},
                        "extractedText": {"type": "STRING"},
                        "translatedText": {"type": "STRING"},
                    },
                    "required": ["hasText", "extractedText", "translatedText"],
                },
            },
        }

        try:
            response = self.gateway_client.request(payload, timeout_sec=180)
            raw_text = self.gateway_client.extract_text(response)
            parsed = parse_json_text(raw_text)
            has_text = bool(parsed.get("hasText"))
            extracted_text = str(parsed.get("extractedText") or "").strip()
            translated_text = str(parsed.get("translatedText") or "").strip()
            if extracted_text and translated_text:
                has_text = True

            return DetectionResult(
                source_path=image_path,
                relative_path=relative_path,
                has_text=has_text,
                extracted_text=extracted_text,
                translated_text=translated_text,
                detection_duration_sec=time.time() - started,
            )
        except Exception as error:  # noqa: BLE001
            return DetectionResult(
                source_path=image_path,
                relative_path=relative_path,
                has_text=True,
                detection_duration_sec=time.time() - started,
                detection_error=str(error),
            )

    def copy_original(self, source_path: Path, relative_path: Path) -> Path:
        output_path = self.output_root / relative_path
        output_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, output_path)
        return output_path

    def translate_with_prompt(
        self,
        image_path: Path,
        relative_path: Path,
        prompt: str,
        debug_label: str,
        timeout_sec: float,
    ) -> tuple[Path, str]:
        parts = [
            self.read_image_part(image_path),
            {"text": prompt},
        ]
        primary_transport = get_primary_image_transport(
            self.gateway_client.settings.image_model,
            self.gateway_client.settings.api_base_url,
        )
        contents_modes = (
            ["object_parts", "role_parts"]
            if primary_transport == "generate-content"
            else ["role_parts"]
        )
        failures: list[str] = []

        for contents_mode in contents_modes:
            payload = {
                "settings": self.gateway_client.settings.to_payload(),
                "model": self.gateway_client.settings.image_model,
                "requestKind": "image",
                "debugLabel": debug_label,
                "contentsMode": contents_mode,
                "parts": parts,
                "generationConfig": {
                    "responseModalities": ["IMAGE"],
                },
            }
            try:
                response = self.gateway_client.request(payload, timeout_sec=timeout_sec)
                image_data, mime_type = self.gateway_client.extract_image(response)
                if not image_data:
                    error_message = response.get("error", {}).get("message") or "No image returned."
                    raise RuntimeError(error_message)

                output_path = choose_output_path(self.output_root / relative_path, mime_type)
                output_path.parent.mkdir(parents=True, exist_ok=True)
                output_path.write_bytes(base64.b64decode(image_data))
                return output_path, mime_type or ""
            except Exception as error:  # noqa: BLE001
                failures.append(f"{contents_mode}: {error}")

        raise RuntimeError(" ; ".join(failures))

    def process_detected_text_image(self, detection: DetectionResult) -> ProcessingResult:
        started = time.time()
        image_timeout_sec = max(
            self.gateway_client.settings.image_request_timeout_ms / 1000,
            360,
        )
        retries = 0
        last_error = detection.detection_error
        extracted_preview = detection.extracted_text[:160].replace("\n", " ")

        direct_prompt = build_direct_image_prompt(
            self.target_language,
            detection.extracted_text,
            detection.translated_text,
        )
        structured_prompt = build_structured_image_prompt(
            self.target_language,
            detection.extracted_text,
            detection.translated_text,
        )

        for attempt in range(self.max_retries + 1):
            retries = attempt
            try:
                output_path, _ = self.translate_with_prompt(
                    detection.source_path,
                    detection.relative_path,
                    direct_prompt,
                    "batch-image-direct-id",
                    timeout_sec=image_timeout_sec,
                )
                return ProcessingResult(
                    source_path=detection.source_path,
                    relative_path=detection.relative_path,
                    output_path=output_path,
                    status="translated_id",
                    detection_duration_sec=detection.detection_duration_sec,
                    processing_duration_sec=time.time() - started,
                    retries=retries,
                    detail="direct multimodal translate",
                    extracted_preview=extracted_preview,
                )
            except Exception as error:  # noqa: BLE001
                last_error = str(error)
                try:
                    output_path, _ = self.translate_with_prompt(
                        detection.source_path,
                        detection.relative_path,
                        structured_prompt,
                        "batch-image-structured-id",
                        timeout_sec=image_timeout_sec,
                    )
                    return ProcessingResult(
                        source_path=detection.source_path,
                        relative_path=detection.relative_path,
                        output_path=output_path,
                        status="translated_id",
                        detection_duration_sec=detection.detection_duration_sec,
                        processing_duration_sec=time.time() - started,
                        retries=retries,
                        detail=f"direct failed, structured fallback succeeded: {last_error}",
                        extracted_preview=extracted_preview,
                    )
                except Exception as structured_error:  # noqa: BLE001
                    last_error = f"direct={last_error}; structured={structured_error}"
                    if attempt < self.max_retries:
                        time.sleep(2 ** attempt)

        output_path = self.copy_original(detection.source_path, detection.relative_path)
        return ProcessingResult(
            source_path=detection.source_path,
            relative_path=detection.relative_path,
            output_path=output_path,
            status="failed_copied_original",
            detection_duration_sec=detection.detection_duration_sec,
            processing_duration_sec=time.time() - started,
            retries=retries,
            detail=last_error,
            extracted_preview=extracted_preview,
        )

    def run(self) -> list[ProcessingResult]:
        started = time.time()
        images = self.scan_images()
        if not images:
            self.log("No images found.")
            return []

        self.output_root.mkdir(parents=True, exist_ok=True)
        self.log(f"Found {len(images)} image files under {self.source_root}")
        self.log(f"Output directory: {self.output_root}")
        self.log(
            "Pipeline: detect text -> copy no-text -> direct multimodal translate "
            "-> OCR-informed fallback -> copy original on final failure"
        )

        detections: list[DetectionResult] = []
        results: list[ProcessingResult] = []
        detected_with_text: list[DetectionResult] = []

        with ThreadPoolExecutor(max_workers=self.detect_workers) as executor:
            future_to_path = {
                executor.submit(self.detect_text, image_path): image_path for image_path in images
            }
            completed = 0
            for future in as_completed(future_to_path):
                detection = future.result()
                detections.append(detection)
                completed += 1
                if detection.has_text:
                    detected_with_text.append(detection)
                    self.log(
                        f"[detect {completed}/{len(images)}] text -> {detection.relative_path} "
                        f"({detection.detection_duration_sec:.1f}s)"
                    )
                else:
                    output_path = self.copy_original(detection.source_path, detection.relative_path)
                    result = ProcessingResult(
                        source_path=detection.source_path,
                        relative_path=detection.relative_path,
                        output_path=output_path,
                        status="copied_no_text",
                        detection_duration_sec=detection.detection_duration_sec,
                        processing_duration_sec=0.0,
                        retries=0,
                        detail="copied without translation",
                    )
                    results.append(result)
                    self.log(
                        f"[detect {completed}/{len(images)}] copied no-text -> {detection.relative_path} "
                        f"({detection.detection_duration_sec:.1f}s)"
                    )

        with ThreadPoolExecutor(max_workers=self.translate_workers) as executor:
            future_to_detection = {
                executor.submit(self.process_detected_text_image, detection): detection
                for detection in detected_with_text
            }
            completed = 0
            total = len(detected_with_text)
            for future in as_completed(future_to_detection):
                result = future.result()
                results.append(result)
                completed += 1
                self.log(
                    f"[translate {completed}/{total}] {result.status} -> {result.relative_path} "
                    f"({result.processing_duration_sec:.1f}s)"
                )

        results.sort(key=lambda item: str(item.relative_path))
        self.write_report(results, total_duration_sec=time.time() - started)
        return results

    def write_report(self, results: list[ProcessingResult], total_duration_sec: float) -> None:
        summary = {
            "translated_id": 0,
            "copied_no_text": 0,
            "failed_copied_original": 0,
        }
        for result in results:
            summary[result.status] = summary.get(result.status, 0) + 1

        report_path = self.output_root / REPORT_FILE_NAME
        lines = [
            "Batch Translation Report",
            "========================",
            f"Source: {self.source_root}",
            f"Output: {self.output_root}",
            f"Target language: {self.target_language}",
            f"Request headers keys: {', '.join(parse_json_object_text(self.gateway_client.settings.request_headers_text, 'Request headers JSON').keys()) or 'none'}",
            f"Request query keys: {', '.join(parse_json_object_text(self.gateway_client.settings.request_query_params_text, 'URL params JSON').keys()) or 'none'}",
            f"Text model: {self.gateway_client.settings.text_model}",
            f"Image model: {self.gateway_client.settings.image_model}",
            f"Detect workers: {self.detect_workers}",
            f"Translate workers: {self.translate_workers}",
            f"Max retries: {self.max_retries}",
            f"Total images: {len(results)}",
            f"Translated: {summary.get('translated_id', 0)}",
            f"Copied (no text): {summary.get('copied_no_text', 0)}",
            f"Failed then copied original: {summary.get('failed_copied_original', 0)}",
            f"Total duration (sec): {total_duration_sec:.1f}",
            "",
            "Per-file details",
            "----------------",
        ]

        for result in results:
            lines.extend(
                [
                    f"File: {result.relative_path}",
                    f"  Status: {result.status}",
                    f"  Output: {result.output_path}",
                    f"  Detect duration: {result.detection_duration_sec:.1f}s",
                    f"  Process duration: {result.processing_duration_sec:.1f}s",
                    f"  Retries: {result.retries}",
                    f"  Extracted preview: {result.extracted_preview}",
                    f"  Detail: {result.detail}",
                    "",
                ]
            )

        report_path.write_text("\n".join(lines), encoding="utf-8")
        self.log(f"Report written to {report_path}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Batch translate product images while preserving folder structure.",
    )
    parser.add_argument(
        "--source",
        required=True,
        help="Source folder containing product images.",
    )
    parser.add_argument(
        "--output",
        required=False,
        help="Output folder. Defaults to a sibling folder with '-印尼语' suffix.",
    )
    parser.add_argument(
        "--gateway-url",
        default="http://localhost:3006/api/generate",
        help="Local gateway endpoint.",
    )
    parser.add_argument(
        "--api-key",
        default="",
        help="API key. If omitted, uses IMAGE_TRANSLATOR_API_KEY environment variable.",
    )
    parser.add_argument(
        "--api-base-url",
        default="https://yunwu.ai/v1",
        help="Upstream API base URL.",
    )
    parser.add_argument(
        "--headers-json",
        default="{}",
        help="Raw request headers as a JSON object. These headers are sent exactly as provided.",
    )
    parser.add_argument(
        "--query-params-json",
        default="{}",
        help="Raw URL params as a JSON object. These params are appended exactly as provided.",
    )
    parser.add_argument(
        "--auth-mode",
        choices=["x-goog-api-key", "bearer", "custom", "query"],
        default="",
        help="Legacy compatibility option. Prefer --headers-json and --query-params-json.",
    )
    parser.add_argument(
        "--custom-auth-header",
        default="",
        help="Legacy compatibility option used with --auth-mode.",
    )
    parser.add_argument(
        "--extra-headers-json",
        default="{}",
        help="Legacy compatibility option merged into --headers-json.",
    )
    parser.add_argument(
        "--text-model",
        default="gemini-3.1-flash-lite-preview",
        help="Text model used for OCR and translation detection.",
    )
    parser.add_argument(
        "--image-model",
        default="gemini-3.1-flash-image-preview",
        help="Image model used for redraw.",
    )
    parser.add_argument(
        "--target-language",
        default="Indonesian",
        help="Target language for translated text.",
    )
    parser.add_argument(
        "--detect-workers",
        type=int,
        default=4,
        help="Concurrency for text detection.",
    )
    parser.add_argument(
        "--translate-workers",
        type=int,
        default=2,
        help="Concurrency for image translation/redraw.",
    )
    parser.add_argument(
        "--max-retries",
        type=int,
        default=2,
        help="Retry count for images that fail redraw.",
    )
    parser.add_argument(
        "--image-timeout-ms",
        type=int,
        default=360000,
        help="Image request timeout in milliseconds.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source_root = Path(args.source).resolve()
    if not source_root.exists() or not source_root.is_dir():
        print(f"Source folder does not exist: {source_root}", file=sys.stderr)
        return 1

    output_root = (
        Path(args.output).resolve()
        if args.output
        else source_root.parent / f"{source_root.name}-印尼语"
    )
    try:
        request_headers = parse_json_object_text(
            args.headers_json or "{}",
            "Request headers JSON",
        )
        request_query_params = parse_json_object_text(
            args.query_params_json or "{}",
            "URL params JSON",
        )
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 1

    api_key = args.api_key.strip()
    if not api_key:
        key_file = Path.home() / ".image_translator_api_key"
        if key_file.exists():
            api_key = key_file.read_text(encoding="utf-8").strip()
    if not api_key:
        api_key = os.environ.get("IMAGE_TRANSLATOR_API_KEY", "").strip()

    if api_key or args.auth_mode or args.custom_auth_header or args.extra_headers_json.strip() != "{}":
        auth_mode = args.auth_mode.strip() or get_recommended_auth_mode(args.api_base_url)
        custom_auth_header = (
            args.custom_auth_header.strip() or get_default_custom_auth_header(auth_mode)
        )

        try:
            legacy_headers, legacy_query_params = build_legacy_request_config(
                api_key=api_key,
                auth_mode=auth_mode,
                custom_auth_header=custom_auth_header,
                extra_headers_text=args.extra_headers_json.strip() or "{}",
            )
        except ValueError as error:
            print(str(error), file=sys.stderr)
            return 1

        for key, value in legacy_headers.items():
            request_headers.setdefault(key, value)

        for key, value in legacy_query_params.items():
            request_query_params.setdefault(key, value)

    settings = GatewaySettings(
        api_base_url=args.api_base_url,
        request_headers_text=stringify_json_object(request_headers),
        request_query_params_text=stringify_json_object(request_query_params),
        text_model=args.text_model,
        image_model=args.image_model,
        max_parallel_tasks=max(args.translate_workers, 1),
        image_request_timeout_ms=args.image_timeout_ms,
    )
    gateway_client = GatewayClient(args.gateway_url, settings)
    translator = BatchTranslator(
        source_root=source_root,
        output_root=output_root,
        gateway_client=gateway_client,
        target_language=args.target_language,
        detect_workers=max(args.detect_workers, 1),
        translate_workers=max(args.translate_workers, 1),
        max_retries=max(args.max_retries, 0),
    )

    started = time.time()
    results = translator.run()
    translated = sum(1 for item in results if item.status == "translated_id")
    copied = sum(1 for item in results if item.status == "copied_no_text")
    failed = sum(1 for item in results if item.status == "failed_copied_original")
    print(
        f"Completed {len(results)} files in {time.time() - started:.1f}s "
        f"(translated={translated}, copied={copied}, failed_copied_original={failed})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
