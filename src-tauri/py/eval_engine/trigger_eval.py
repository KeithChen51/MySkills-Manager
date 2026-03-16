#!/usr/bin/env python3
"""
Run trigger accuracy evaluation with real OpenAI-compatible model evidence.
"""

from __future__ import annotations

import argparse
import json
import re
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

READ_ENCODINGS = ("utf-8", "utf-8-sig", "gb18030")


def read_text_file(path: Path) -> str:
    last_error: UnicodeDecodeError | None = None
    for encoding in READ_ENCODINGS:
        try:
            return path.read_text(encoding=encoding)
        except UnicodeDecodeError as exc:
            last_error = exc
    raise ValueError(f"Failed to decode file '{path}'. Please save it as UTF-8.") from last_error


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


class LLMClient:
    def __init__(self, api_key: str, model: str, base_url: str | None, provider: str | None):
        self.api_key = api_key.strip()
        self.model = model.strip()
        self.base_url = (base_url or "").strip() or "https://api.openai.com/v1"
        self.provider = (provider or "openai-compatible").strip().lower()
        if self.provider != "openai-compatible":
            raise ValueError(f"Unsupported provider for trigger eval: {self.provider}")
        if not self.api_key:
            raise ValueError("API key is required for trigger eval")
        if not self.model:
            raise ValueError("Model is required for trigger eval")

    def chat_json(self, prompt: str) -> dict[str, Any]:
        endpoint = self.base_url.rstrip("/") + "/chat/completions"
        payload = {
            "model": self.model,
            "temperature": 0.0,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are a strict skill router evaluator. "
                        "Return JSON only with keys: selected_skill, confidence, reason."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
        }
        request = urllib.request.Request(
            endpoint,
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
            },
        )
        started = time.perf_counter()
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                raw = response.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as exc:  # pragma: no cover - network path
            details = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"LLM HTTP {exc.code}: {details}") from exc
        except urllib.error.URLError as exc:  # pragma: no cover - network path
            raise RuntimeError(f"LLM request failed: {exc.reason}") from exc
        latency_ms = int((time.perf_counter() - started) * 1000)
        parsed = json.loads(raw)
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


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _error_type(error: Exception) -> str:
    text = str(error).lower()
    if "http" in text or "url" in text or "network" in text:
        return "network"
    if "json" in text or "parse" in text:
        return "parse"
    return "runtime"


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
        llm = client.chat_json(prompt)
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

