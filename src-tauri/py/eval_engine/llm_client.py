"""
Unified LLM client for the Skillar Skill Evaluator engine.

Extracts common API call, retry, JSON parsing, and I/O logic used across
trigger_eval, functional_eval, sample_gen, and analyzer modules.
"""

from __future__ import annotations

import json
import re
import socket
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Shared I/O helpers
# ---------------------------------------------------------------------------

READ_ENCODINGS = ("utf-8", "utf-8-sig", "gb18030")


def read_text_file(path: Path) -> str:
    """Read a text file, trying multiple encodings."""
    last_error: UnicodeDecodeError | None = None
    for encoding in READ_ENCODINGS:
        try:
            return path.read_text(encoding=encoding)
        except UnicodeDecodeError as exc:
            last_error = exc
    raise ValueError(f"Failed to decode file '{path}'. Please save it as UTF-8.") from last_error


def write_json(path: Path, payload: Any) -> None:
    """Write a JSON payload to *path*, creating parent dirs if needed."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# JSON extraction
# ---------------------------------------------------------------------------


def extract_json_object(raw: str) -> dict[str, Any]:
    """Multi-level tolerant JSON extraction: strict → fenced-block strip → brace search."""
    text = raw.strip()

    # Try strict parse first
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except (json.JSONDecodeError, ValueError):
        pass

    # Strip fenced code block wrapper
    if text.startswith("```"):
        lines = text.splitlines()
        if len(lines) >= 2:
            text = "\n".join(lines[1:-1]).strip()

    # Brace-search fallback
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end < start:
        raise ValueError("Model output does not contain a JSON object")
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        pass

    # Regex fallback: try to find first valid JSON block
    for match in re.finditer(r"\{[^{}]*\}", text):
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            continue

    raise ValueError("Model output does not contain a parseable JSON object")


# ---------------------------------------------------------------------------
# Error classification
# ---------------------------------------------------------------------------


def classify_error(error: Exception) -> str:
    """Classify an exception into a broad error type string."""
    text = str(error).lower()
    if "http" in text or "url" in text or "network" in text:
        return "network"
    if "timeout" in text:
        return "timeout"
    if "json" in text or "parse" in text:
        return "parse"
    return "runtime"


# ---------------------------------------------------------------------------
# Unified LLM Client
# ---------------------------------------------------------------------------


class LLMClient:
    """Unified OpenAI-compatible chat completion client.

    Consolidates the duplicate clients from trigger_eval and functional_eval.
    Supports configurable timeout, temperature, retry, and token tracking.
    """

    def __init__(
        self,
        api_key: str,
        model: str,
        base_url: str | None = None,
        provider: str | None = None,
        timeout_secs: int = 90,
    ):
        self.api_key = api_key.strip()
        self.model = model.strip()
        self.base_url = (base_url or "").strip() or "https://api.openai.com/v1"
        self.provider = (provider or "openai-compatible").strip().lower()
        self.timeout_secs = max(10, timeout_secs)

        if self.provider != "openai-compatible":
            raise ValueError(f"Unsupported provider: {self.provider}")
        if not self.api_key:
            raise ValueError("API key is required")
        if not self.model:
            raise ValueError("Model is required")

    # -- core request -------------------------------------------------------

    def chat_completion(
        self,
        messages: list[dict[str, str]],
        temperature: float = 0.0,
        timeout_override: int | None = None,
    ) -> dict[str, Any]:
        """Send a chat completion request and return parsed response with metadata.

        Returns dict with keys:
            content, raw, trace_id, latency_ms, input_tokens, output_tokens
        """
        endpoint = self.base_url.rstrip("/") + "/chat/completions"
        payload = {
            "model": self.model,
            "temperature": temperature,
            "messages": messages,
        }
        body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            endpoint,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
            },
        )
        effective_timeout = timeout_override or self.timeout_secs
        started = time.perf_counter()
        try:
            with urllib.request.urlopen(request, timeout=effective_timeout) as response:
                raw_text = response.read().decode("utf-8", errors="replace")
        except TimeoutError as exc:
            raise RuntimeError(f"LLM request timed out after {effective_timeout}s: {exc}") from exc
        except socket.timeout as exc:
            raise RuntimeError(f"LLM request timed out after {effective_timeout}s: {exc}") from exc
        except urllib.error.HTTPError as exc:
            details = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"LLM HTTP {exc.code}: {details}") from exc
        except urllib.error.URLError as exc:
            if isinstance(exc.reason, (TimeoutError, socket.timeout)):
                raise RuntimeError(
                    f"LLM request timed out after {effective_timeout}s: {exc.reason}"
                ) from exc
            raise RuntimeError(f"LLM request failed: {exc.reason}") from exc

        latency_ms = int((time.perf_counter() - started) * 1000)
        parsed = json.loads(raw_text)
        choices = parsed.get("choices")
        if not isinstance(choices, list) or not choices:
            raise RuntimeError("LLM response missing choices")
        message = choices[0].get("message", {})
        content = message.get("content")
        if not isinstance(content, str) or not content.strip():
            raise RuntimeError("LLM response content is empty")
        usage = parsed.get("usage") if isinstance(parsed.get("usage"), dict) else {}
        return {
            "content": content,
            "raw": parsed,
            "trace_id": str(parsed.get("id") or ""),
            "latency_ms": latency_ms,
            "input_tokens": int(usage.get("prompt_tokens") or 0),
            "output_tokens": int(usage.get("completion_tokens") or 0),
        }

    # -- convenience wrappers -----------------------------------------------

    def chat_json(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.0,
        timeout_override: int | None = None,
    ) -> dict[str, Any]:
        """Send a chat request expecting JSON content. Returns same dict as chat_completion."""
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
        return self.chat_completion(messages, temperature=temperature, timeout_override=timeout_override)

    def chat_completion_with_retry(
        self,
        messages: list[dict[str, str]],
        temperature: float = 0.0,
        max_retries: int = 3,
        timeout_override: int | None = None,
    ) -> dict[str, Any]:
        """Send a chat completion request with automatic retry on failure."""
        last_error: Exception | None = None
        for attempt in range(max_retries):
            try:
                return self.chat_completion(
                    messages, temperature=temperature, timeout_override=timeout_override
                )
            except Exception as exc:
                last_error = exc
                if attempt < max_retries - 1:
                    time.sleep(min(2 ** attempt, 8))
        raise RuntimeError(f"LLM request failed after {max_retries} attempts: {last_error}") from last_error
