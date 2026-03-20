"""
Generate evaluation datasets via OpenAI-compatible chat completion API.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

try:
    from .llm_client import LLMClient, extract_json_object
except ImportError:
    from llm_client import LLMClient, extract_json_object  # type: ignore

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


_extract_json_object = extract_json_object


def _request_openai_compatible(
    api_key: str,
    model: str,
    base_url: str | None,
    prompt: str,
    request_timeout_secs: int,
) -> str:
    """Backward-compatible wrapper using unified LLMClient."""
    client = LLMClient(
        api_key=api_key, model=model, base_url=base_url,
        timeout_secs=max(30, int(request_timeout_secs)),
    )
    messages = [
        {"role": "system", "content": "You generate strict JSON test data. Output JSON only."},
        {"role": "user", "content": prompt},
    ]
    response = client.chat_completion(messages, temperature=0.4)
    return str(response["content"])


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


def _build_trigger_prompt(
    skill_name: str,
    skill_content: str,
    trigger_count: int,
    attempt: int,
) -> str:
    extra = ""
    if attempt > 0:
        extra = (
            "\nImportant: previous output was invalid. Ensure strict schema compliance, "
            "balanced positive/negative trigger labels, and enough cases per bucket."
        )

    return f"""
Generate TRIGGER evaluation dataset for skill `{skill_name}`.

Skill content:
---
{skill_content}
---

Output JSON object with exactly ONE top-level key:
- trigger: array of objects with fields query (string), should_trigger (boolean), test_bucket (string)

Requirements:
- trigger length >= {trigger_count}
- trigger must include explicit buckets: {", ".join(TRIGGER_BUCKETS)}
- each trigger bucket must have at least {TRIGGER_BUCKET_MIN} cases
- Do not include explanations, markdown, or extra keys.
{extra}
""".strip()


def _build_functional_prompt(
    skill_name: str,
    skill_content: str,
    functional_count: int,
    attempt: int,
) -> str:
    extra = ""
    if attempt > 0:
        extra = (
            "\nImportant: previous output was invalid. Ensure strict schema compliance "
            "and enough valid cases."
        )

    return f"""
Generate FUNCTIONAL evaluation dataset for skill `{skill_name}`.

Skill content:
---
{skill_content}
---

Output JSON object with exactly ONE top-level key:
- functional: array of objects with fields id (string), prompt (string), assertions (string array)

Requirements:
- functional length >= {functional_count}, each assertion list non-empty
- IDs must be readable and mostly unique
- Do not include explanations, markdown, or extra keys.
{extra}
""".strip()


def _generate_trigger(
    args: argparse.Namespace,
    skill_excerpt: str,
    trigger_count: int,
    request_timeout_secs: int,
) -> list[dict[str, Any]]:
    """Generate trigger cases with 2-attempt retry."""
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            prompt = _build_trigger_prompt(
                skill_name=args.skill_name,
                skill_content=skill_excerpt,
                trigger_count=trigger_count,
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
            return _validate_trigger_cases(payload.get("trigger"), trigger_count)
        except Exception as exc:
            last_error = exc
            continue
    raise last_error or ValueError("trigger generation failed")


def _generate_functional(
    args: argparse.Namespace,
    skill_excerpt: str,
    functional_count: int,
    request_timeout_secs: int,
) -> list[dict[str, Any]]:
    """Generate functional cases with 2-attempt retry."""
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            prompt = _build_functional_prompt(
                skill_name=args.skill_name,
                skill_content=skill_excerpt,
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
            return _validate_functional_cases(payload.get("functional"), functional_count)
        except Exception as exc:
            last_error = exc
            continue
    raise last_error or ValueError("functional generation failed")


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

    try:
        # Phase 1: generate trigger cases (separate API call)
        trigger = _generate_trigger(args, skill_excerpt, trigger_count, request_timeout_secs)

        # Phase 2: generate functional cases (separate API call)
        functional = _generate_functional(args, skill_excerpt, functional_count, request_timeout_secs)

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
    except Exception as exc:
        return {
            "status": "error",
            "message": f"Failed to generate valid sample datasets: {exc}",
        }
