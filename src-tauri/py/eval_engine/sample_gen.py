"""
Generate evaluation datasets via OpenAI-compatible chat completion API.
"""

from __future__ import annotations

import argparse
import json
import socket
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

TRIGGER_BUCKETS = (
    "positive_trigger",
    "negative_trigger",
    "boundary_ambiguous",
    "adjacent_skill_confusion",
)
TRIGGER_BUCKET_MIN = 12
FUNCTIONAL_MIN = 24


def _normalize_trigger_bucket(value: Any, should_trigger: bool) -> str:
    raw = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    if raw in {"positive_trigger", "positive"}:
        return "positive_trigger"
    if raw in {"negative_trigger", "negative"}:
        return "negative_trigger"
    if raw in {"boundary_ambiguous", "boundary", "ambiguous"}:
        return "boundary_ambiguous"
    if raw in {"adjacent_skill_confusion", "adjacent", "confusion"}:
        return "adjacent_skill_confusion"
    return "positive_trigger" if should_trigger else "negative_trigger"


def _extract_json_object(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if len(lines) >= 2:
            text = "\n".join(lines[1:-1]).strip()

    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end < start:
        raise ValueError("Model output does not contain a JSON object")
    return json.loads(text[start : end + 1])


def _request_openai_compatible(
    api_key: str,
    model: str,
    base_url: str | None,
    prompt: str,
    request_timeout_secs: int,
) -> str:
    endpoint = (base_url or "https://api.openai.com/v1").rstrip("/") + "/chat/completions"
    timeout_secs = max(30, int(request_timeout_secs))
    payload = {
        "model": model,
        "temperature": 0.4,
        "messages": [
            {
                "role": "system",
                "content": "You generate strict JSON test data. Output JSON only.",
            },
            {"role": "user", "content": prompt},
        ],
    }
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout_secs) as response:
            raw = response.read().decode("utf-8", errors="replace")
    except TimeoutError as exc:  # pragma: no cover - network path
        raise RuntimeError(f"LLM request timed out after {timeout_secs}s: {exc}") from exc
    except socket.timeout as exc:  # pragma: no cover - network path
        raise RuntimeError(f"LLM request timed out after {timeout_secs}s: {exc}") from exc
    except urllib.error.HTTPError as exc:  # pragma: no cover - network path
        details = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"LLM HTTP {exc.code}: {details}") from exc
    except urllib.error.URLError as exc:  # pragma: no cover - network path
        if isinstance(exc.reason, TimeoutError) or isinstance(exc.reason, socket.timeout):
            raise RuntimeError(f"LLM request timed out after {timeout_secs}s: {exc.reason}") from exc
        raise RuntimeError(f"LLM request failed: {exc.reason}") from exc

    parsed = json.loads(raw)
    choices = parsed.get("choices")
    if not isinstance(choices, list) or not choices:
        raise RuntimeError("LLM response missing choices")
    message = choices[0].get("message", {})
    content = message.get("content")
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("LLM response content is empty")
    return content


def _validate_trigger_cases(cases: Any, total_count: int) -> list[dict[str, Any]]:
    if not isinstance(cases, list):
        raise ValueError("trigger must be an array")

    by_bucket: dict[str, list[dict[str, Any]]] = {bucket: [] for bucket in TRIGGER_BUCKETS}
    for case in cases:
        if not isinstance(case, dict):
            continue
        query = case.get("query")
        should_trigger = case.get("should_trigger")
        if not isinstance(query, str) or not query.strip() or not isinstance(should_trigger, bool):
            continue
        bucket = _normalize_trigger_bucket(case.get("test_bucket"), should_trigger)
        if bucket == "positive_trigger" and not should_trigger:
            continue
        if bucket == "negative_trigger" and should_trigger:
            continue
        cleaned = {
            "query": query.strip(),
            "should_trigger": should_trigger,
            "test_bucket": bucket,
        }
        by_bucket[bucket].append(cleaned)

    failed = [bucket for bucket in TRIGGER_BUCKETS if len(by_bucket[bucket]) < TRIGGER_BUCKET_MIN]
    if failed:
        raise ValueError(
            f"trigger cases do not satisfy bucket minimum ({TRIGGER_BUCKET_MIN}) for: {', '.join(failed)}"
        )

    ordered: list[dict[str, Any]] = []
    for bucket in TRIGGER_BUCKETS:
        ordered.extend(by_bucket[bucket][:TRIGGER_BUCKET_MIN])
    extras = []
    for bucket in TRIGGER_BUCKETS:
        extras.extend(by_bucket[bucket][TRIGGER_BUCKET_MIN:])
    ordered.extend(extras)
    if len(ordered) < total_count:
        raise ValueError("trigger cases are fewer than requested after bucket enforcement")
    return ordered[:total_count]


def _validate_functional_cases(cases: Any, total_count: int) -> list[dict[str, Any]]:
    if not isinstance(cases, list):
        raise ValueError("functional must be an array")

    out: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for raw_case in cases:
        if not isinstance(raw_case, dict):
            continue
        case_id = raw_case.get("id")
        prompt = raw_case.get("prompt")
        assertions = raw_case.get("assertions")
        if (
            not isinstance(case_id, str)
            or not case_id.strip()
            or not isinstance(prompt, str)
            or not prompt.strip()
            or not isinstance(assertions, list)
        ):
            continue
        cleaned_assertions = [item.strip() for item in assertions if isinstance(item, str) and item.strip()]
        if not cleaned_assertions:
            continue

        next_id = case_id.strip()
        if next_id in seen_ids:
            suffix = 2
            while f"{next_id}-{suffix}" in seen_ids:
                suffix += 1
            next_id = f"{next_id}-{suffix}"
        seen_ids.add(next_id)
        out.append(
            {
                "id": next_id,
                "prompt": prompt.strip(),
                "assertions": cleaned_assertions,
            }
        )

    if len(out) < total_count:
        raise ValueError("functional cases are fewer than requested")
    return out[:total_count]


def _build_prompt(
    skill_name: str,
    skill_content: str,
    trigger_count: int,
    functional_count: int,
    attempt: int,
) -> str:
    extra = ""
    if attempt > 0:
        extra = (
            "\nImportant: previous output was invalid. Ensure strict schema compliance, "
            "balanced positive/negative trigger labels, and enough cases."
        )

    return f"""
Generate evaluation datasets for skill `{skill_name}`.

Skill content:
---
{skill_content}
---

Output JSON object with exactly these top-level keys:
- trigger: array of objects with fields query (string), should_trigger (boolean), test_bucket (string)
- functional: array of objects with fields id (string), prompt (string), assertions (string array)

Requirements:
- trigger length >= {trigger_count}
- trigger must include explicit buckets: {", ".join(TRIGGER_BUCKETS)}
- each trigger bucket must have at least {TRIGGER_BUCKET_MIN} cases
- functional length >= {functional_count}, each assertion list non-empty
- IDs must be readable and mostly unique
- Do not include explanations, markdown, or extra keys.
{extra}
""".strip()


def run(args: argparse.Namespace) -> dict[str, Any]:
    provider = (args.provider or "openai-compatible").strip()
    if provider != "openai-compatible":
        return {"status": "error", "message": f"Unsupported provider: {provider}"}
    if not args.api_key.strip():
        return {"status": "error", "message": "API key is required"}

    try:
        skill_content = args.skill_path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return {"status": "error", "message": f"Skill file not found at {args.skill_path}"}
    except OSError as exc:
        return {"status": "error", "message": f"Read skill file failed: {exc}"}

    trigger_count = max(TRIGGER_BUCKET_MIN * len(TRIGGER_BUCKETS), int(args.trigger_count))
    functional_count = max(FUNCTIONAL_MIN, int(args.functional_count))
    request_timeout_secs = max(30, int(getattr(args, "request_timeout_secs", 180)))
    skill_excerpt = skill_content[:12000]

    last_error: Exception | None = None
    for attempt in range(2):
        try:
            prompt = _build_prompt(
                skill_name=args.skill_name,
                skill_content=skill_excerpt,
                trigger_count=trigger_count,
                functional_count=functional_count,
                attempt=attempt,
            )
            response_text = _request_openai_compatible(
                api_key=args.api_key.strip(),
                model=args.model.strip(),
                base_url=(args.base_url or "").strip() or None,
                prompt=prompt,
                request_timeout_secs=request_timeout_secs,
            )
            payload = _extract_json_object(response_text)
            trigger = _validate_trigger_cases(payload.get("trigger"), trigger_count)
            functional = _validate_functional_cases(payload.get("functional"), functional_count)

            args.output_dir.mkdir(parents=True, exist_ok=True)
            trigger_path = args.output_dir / "trigger.json"
            functional_path = args.output_dir / "functional.json"
            trigger_path.write_text(json.dumps(trigger, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            functional_path.write_text(
                json.dumps(functional, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            return {
                "status": "success",
                "trigger_count": len(trigger),
                "functional_count": len(functional),
                "trigger_path": str(trigger_path),
                "functional_path": str(functional_path),
            }
        except Exception as exc:  # pragma: no cover - retry wrapper
            last_error = exc
            continue

    return {
        "status": "error",
        "message": f"Failed to generate valid sample datasets: {last_error}",
    }
