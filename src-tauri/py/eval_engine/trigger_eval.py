#!/usr/bin/env python3
"""
Run trigger accuracy evaluation with real OpenAI-compatible model evidence.
"""

from __future__ import annotations

import argparse
import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

try:
    from .llm_client import LLMClient, read_text_file, extract_json_object, write_json, classify_error
except ImportError:
    from llm_client import LLMClient, read_text_file, extract_json_object, write_json, classify_error  # type: ignore


# read_text_file imported from llm_client


def validate_trigger_eval_set(payload: object) -> list[dict[str, Any]]:
    if not isinstance(payload, list):
        raise ValueError("Invalid trigger eval set: expected top-level JSON array.")

    validated: list[dict[str, Any]] = []
    for index, item in enumerate(payload, start=1):
        if not isinstance(item, dict):
            raise ValueError(
                f"Invalid trigger eval set: item #{index} must be an object with required keys: query, should_trigger."
            )
        query = item.get("query")
        should_trigger = item.get("should_trigger")
        if not isinstance(query, str) or not query.strip():
            raise ValueError(
                f"Invalid trigger eval set: item #{index} field 'query' must be a non-empty string."
            )
        if not isinstance(should_trigger, bool):
            raise ValueError(
                f"Invalid trigger eval set: item #{index} field 'should_trigger' must be boolean."
            )
        validated.append({"query": query.strip(), "should_trigger": should_trigger})
    return validated


# extract_json_object imported from llm_client
_extract_json_object = extract_json_object


def _frontmatter_value(raw: str, key: str) -> str | None:
    normalized = raw.replace("\r\n", "\n").lstrip("\ufeff")
    if not normalized.startswith("---\n"):
        return None
    body = normalized[4:]
    end = body.find("\n---\n")
    if end < 0:
        return None
    header = body[:end]
    pattern = rf"(?m)^{re.escape(key)}\s*:\s*(.+)$"
    match = re.search(pattern, header)
    if not match:
        return None
    value = match.group(1).strip().strip('"').strip("'")
    return value if value else None


def _load_skill_meta(skill_name: str, skill_path: Path | None) -> dict[str, str]:
    if not skill_path:
        return {"name": skill_name, "description": f"Skill named {skill_name}"}
    try:
        raw = read_text_file(skill_path)
    except Exception:
        return {"name": skill_name, "description": f"Skill named {skill_name}"}
    parsed_name = _frontmatter_value(raw, "name") or skill_name
    description = _frontmatter_value(raw, "description") or f"Skill named {parsed_name}"
    return {"name": parsed_name.strip(), "description": description.strip()}


def _collect_available_skills(
    target_skill_name: str,
    target_skill_path: Path | None,
    installed_skills_dir: Path | None,
    env_type: str,
) -> list[dict[str, str]]:
    by_name: dict[str, dict[str, str]] = {}
    target_meta = _load_skill_meta(target_skill_name, target_skill_path)
    by_name[target_meta["name"]] = target_meta

    if env_type == "complex" and installed_skills_dir and installed_skills_dir.exists():
        for skill_file in installed_skills_dir.glob("*/SKILL.md"):
            try:
                meta = _load_skill_meta(skill_file.parent.name, skill_file)
            except Exception:
                continue
            if meta["name"] not in by_name:
                by_name[meta["name"]] = meta

    ordered = [target_meta]
    for name in sorted(by_name):
        if name == target_meta["name"]:
            continue
        ordered.append(by_name[name])
    return ordered


# LLMClient imported from llm_client — wrap convenience method for backward compat


def _trigger_chat_json(client: LLMClient, prompt: str) -> dict[str, Any]:
    """Convenience wrapper preserving the old trigger LLMClient.chat_json signature."""
    return client.chat_json(
        system_prompt=(
            "You are a strict skill router evaluator. "
            "Return JSON only with keys: selected_skill, confidence, reason."
        ),
        user_prompt=prompt,
        temperature=0.0,
    )


def _build_routing_prompt(query: str, candidates: list[dict[str, str]], target_skill_name: str) -> str:
    candidate_lines = []
    for item in candidates:
        desc = item["description"].replace("\n", " ").strip()
        candidate_lines.append(f"- {item['name']}: {desc}")

    return f"""
Given the user request, choose exactly one skill from candidates or "none".

User request:
{query}

Candidate skills:
{chr(10).join(candidate_lines)}

Target skill to evaluate:
{target_skill_name}

Return strict JSON only:
{{
  "selected_skill": "<candidate name or none>",
  "confidence": 0.0,
  "reason": "short reason"
}}
""".strip()


# write_json imported from llm_client
_write_json = write_json


# classify_error imported from llm_client
_error_type = classify_error


def check_trigger(
    selected_skill: str,
    target_skill_name: str,
    should_trigger: bool,
    env_type: str,
) -> tuple[bool, str | None, bool]:
    normalized_selected = selected_skill.strip()
    triggered = bool(normalized_selected)
    triggered_skill_name = normalized_selected or None
    if env_type == "clean":
        passed = (triggered and should_trigger and normalized_selected == target_skill_name) or (
            (not triggered) and (not should_trigger)
        )
    else:
        # complex mode allows more candidate skills, but pass still requires selecting target when should_trigger=true
        passed = (triggered and should_trigger and normalized_selected == target_skill_name) or (
            (not triggered) and (not should_trigger)
        )
    return triggered, triggered_skill_name, bool(passed)


def run_single_query(
    case_index: int,
    query: str,
    should_trigger: bool,
    target_skill_name: str,
    candidates: list[dict[str, str]],
    client: LLMClient,
    env_type: str,
    evidence_dir: Path | None,
) -> dict[str, Any]:
    case_dir = evidence_dir / f"trigger-case-{case_index + 1:03d}" if evidence_dir else None
    prompt = _build_routing_prompt(query, candidates, target_skill_name)
    request_payload = {
        "query": query,
        "should_trigger": should_trigger,
        "target_skill_name": target_skill_name,
        "candidates": candidates,
    }
    if case_dir:
        _write_json(case_dir / "request.json", request_payload)

    try:
        llm = _trigger_chat_json(client, prompt)
        response_payload = llm["raw"]
        if case_dir:
            _write_json(case_dir / "response.json", response_payload)
            _write_json(case_dir / "parsed_meta.json", {
                "latency_ms": llm["latency_ms"],
                "input_tokens": llm["input_tokens"],
                "output_tokens": llm["output_tokens"],
                "trace_id": llm["trace_id"],
            })
        parsed = _extract_json_object(str(llm["content"]))
        selected_skill = str(parsed.get("selected_skill") or "").strip()
        confidence = parsed.get("confidence")
        confidence_value = float(confidence) if isinstance(confidence, (int, float)) else None
        candidate_names = {item["name"] for item in candidates}
        if selected_skill.lower() == "none" or selected_skill not in candidate_names:
            selected_skill = ""
        triggered, triggered_skill_name, passed = check_trigger(
            selected_skill=selected_skill,
            target_skill_name=target_skill_name,
            should_trigger=should_trigger,
            env_type=env_type,
        )
        return {
            "query": query,
            "should_trigger": should_trigger,
            "triggered": triggered,
            "triggered_skill_name": triggered_skill_name,
            "pass": bool(passed),
            "raw_response_path": str((case_dir / "response.json").resolve()) if case_dir else None,
            "latency_ms": llm["latency_ms"],
            "input_tokens": llm["input_tokens"],
            "output_tokens": llm["output_tokens"],
            "judge_trace_id": llm["trace_id"] or None,
            "confidence": confidence_value,
        }
    except Exception as exc:
        if case_dir:
            _write_json(case_dir / "error.json", {"error": str(exc), "error_type": _error_type(exc)})
        return {
            "query": query,
            "should_trigger": should_trigger,
            "triggered": False,
            "triggered_skill_name": None,
            "pass": False,
            "error": str(exc),
            "error_type": _error_type(exc),
            "raw_response_path": str((case_dir / "error.json").resolve()) if case_dir else None,
            "latency_ms": None,
            "input_tokens": None,
            "output_tokens": None,
            "judge_trace_id": None,
            "confidence": None,
        }


def run(args: argparse.Namespace) -> dict[str, Any]:
    try:
        eval_set = validate_trigger_eval_set(json.loads(read_text_file(args.eval_set_path)))
    except (json.JSONDecodeError, FileNotFoundError, OSError, ValueError) as exc:
        return {"status": "error", "message": f"Failed to read or parse eval set file: {exc}"}

    try:
        client = LLMClient(
            api_key=str(args.api_key),
            model=str(args.model),
            base_url=getattr(args, "base_url", None),
            provider=getattr(args, "provider", None),
        )
    except Exception as exc:
        return {"status": "error", "message": str(exc)}

    target_skill_name = str(args.skill_name).strip()
    skill_path = getattr(args, "skill_path", None)
    installed_skills_dir = getattr(args, "installed_skills_dir", None)
    env_type = str(getattr(args, "env_type", "clean"))
    candidates = _collect_available_skills(target_skill_name, skill_path, installed_skills_dir, env_type)
    target_meta = candidates[0] if candidates else {"name": target_skill_name, "description": ""}
    target_skill_name = target_meta["name"]

    evidence_dir = getattr(args, "evidence_dir", None)
    max_workers_raw = int(getattr(args, "max_workers", 10) or 10)
    max_workers = max(1, min(64, max_workers_raw))
    if isinstance(evidence_dir, Path):
        evidence_dir.mkdir(parents=True, exist_ok=True)
        _write_json(
            evidence_dir / "meta.json",
            {
                "skill_name": target_skill_name,
                "env_type": env_type,
                "cases": len(eval_set),
                "candidate_count": len(candidates),
                "max_workers": max_workers,
            },
        )

    results: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_case = {
            executor.submit(
                run_single_query,
                index,
                item["query"],
                bool(item["should_trigger"]),
                target_skill_name,
                candidates,
                client,
                env_type,
                evidence_dir,
            ): item
            for index, item in enumerate(eval_set)
        }
        for future in as_completed(future_to_case):
            results.append(future.result())

    results.sort(key=lambda item: item.get("query", ""))
    total = len(results)
    passed = sum(1 for item in results if bool(item.get("pass")))
    summary = {
        "total": total,
        "passed": passed,
        "failed": total - passed,
        "pass_rate": (passed / total) if total > 0 else 0.0,
    }
    return {
        "status": "success",
        "skill_name": target_skill_name,
        "summary": summary,
        "results": results,
        "run_meta": {
            "env_type": env_type,
            "max_workers": max_workers,
            "case_count": len(eval_set),
        },
    }

