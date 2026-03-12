"""
Run functional correctness evaluations with real OpenAI-compatible execution traces.
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
from statistics import mean
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


def _extract_json_object(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if len(lines) >= 2:
            text = "\n".join(lines[1:-1]).strip()

    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end < start:
        raise ValueError("Judge output does not contain a JSON object")
    return json.loads(text[start : end + 1])


def _request_openai_compatible_chat(
    api_key: str,
    model: str,
    base_url: str | None,
    messages: list[dict[str, str]],
    temperature: float = 0.0,
) -> dict[str, Any]:
    endpoint = (base_url or "https://api.openai.com/v1").rstrip("/") + "/chat/completions"
    payload = {
        "model": model,
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
            "Authorization": f"Bearer {api_key}",
        },
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            raw_text = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:  # pragma: no cover - network path
        details = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"LLM HTTP {exc.code}: {details}") from exc
    except urllib.error.URLError as exc:  # pragma: no cover - network path
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


def _slug(value: str, fallback: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9_-]+", "-", value.strip()).strip("-_").lower()
    return normalized or fallback


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _tokenize(text: str) -> set[str]:
    lowered = text.lower()
    latin_tokens = re.findall(r"[a-z0-9_]{3,}", lowered)
    cjk_chars = re.findall(r"[\u4e00-\u9fff]", text)
    cjk_bigrams = [f"{cjk_chars[i]}{cjk_chars[i + 1]}" for i in range(len(cjk_chars) - 1)]
    return set(latin_tokens + cjk_bigrams)


def _extract_code_blocks(text: str) -> list[str]:
    return re.findall(r"```(?:[a-zA-Z0-9_+-]+)?\n(.*?)```", text, flags=re.DOTALL)


def _has_valid_json(text: str) -> bool:
    try:
        json.loads(text)
        return True
    except Exception:
        pass
    for block in _extract_code_blocks(text):
        try:
            json.loads(block)
            return True
        except Exception:
            continue
    return False


def _line_count(text: str) -> int:
    stripped = [line for line in text.splitlines() if line.strip()]
    return len(stripped)


def _layer1_checks(prompt: str, output_text: str, assertions: list[str]) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    checks.append(
        {
            "name": "non_empty_output",
            "passed": bool(output_text.strip()),
            "evidence": "Output is non-empty." if output_text.strip() else "Output is empty.",
        }
    )

    combined_text = " ".join(assertions).lower()
    if "json" in combined_text:
        json_ok = _has_valid_json(output_text)
        checks.append(
            {
                "name": "json_valid",
                "passed": json_ok,
                "evidence": "Detected valid JSON content." if json_ok else "JSON parse check failed.",
            }
        )

    if "代码块" in combined_text or "code block" in combined_text:
        has_code_block = "```" in output_text
        checks.append(
            {
                "name": "code_block_present",
                "passed": has_code_block,
                "evidence": "Found fenced code block." if has_code_block else "No fenced code block found.",
            }
        )

    if ("4行" in combined_text) or ("四行" in combined_text) or ("4 lines" in combined_text):
        count = _line_count(output_text)
        checks.append(
            {
                "name": "four_line_output",
                "passed": count == 4,
                "evidence": f"Detected {count} non-empty line(s).",
            }
        )

    prompt_tokens = _tokenize(prompt)
    output_tokens = _tokenize(output_text)
    overlap = len(prompt_tokens & output_tokens)
    checks.append(
        {
            "name": "semantic_overlap",
            "passed": overlap > 0,
            "evidence": f"Prompt/output semantic token overlap: {overlap}.",
        }
    )

    return {
        "passed": all(bool(item.get("passed")) for item in checks),
        "checks": checks,
    }


def _grade_assertions(output_text: str, assertions: list[str]) -> list[dict[str, Any]]:
    lowered_output = output_text.lower()
    output_tokens = _tokenize(output_text)
    graded: list[dict[str, Any]] = []
    for assertion in assertions:
        token_overlap = len(_tokenize(assertion) & output_tokens)
        direct_hit = assertion.strip().lower() in lowered_output if assertion.strip() else False
        passed = direct_hit or token_overlap > 0
        evidence = (
            f"direct_hit={direct_hit}, token_overlap={token_overlap}"
            if passed
            else f"No direct or semantic match for assertion: {assertion}"
        )
        graded.append({"assertion": assertion, "passed": passed, "evidence": evidence})
    return graded


def _normalize_dimension_scores(payload: dict[str, Any]) -> dict[str, float]:
    keys = ("relevance", "instruction_following", "completeness")
    normalized: dict[str, float] = {}
    for key in keys:
        value = payload.get(key, 0.0)
        try:
            score = float(value)
        except (TypeError, ValueError):
            score = 0.0
        normalized[key] = round(max(0.0, min(1.0, score)), 4)
    return normalized


def _judge_quality_heuristic(
    prompt: str,
    output_text: str,
    assertion_results: list[dict[str, Any]],
    model: str,
) -> dict[str, Any]:
    prompt_tokens = _tokenize(prompt)
    output_tokens = _tokenize(output_text)
    overlap = len(prompt_tokens & output_tokens)
    relevance = overlap / max(1, len(prompt_tokens))
    instruction_following = (
        sum(1 for item in assertion_results if item.get("passed")) / max(1, len(assertion_results))
    )
    completeness = min(1.0, _line_count(output_text) / 4.0)

    dimensions = {
        "relevance": round(max(0.0, min(1.0, relevance)), 4),
        "instruction_following": round(max(0.0, min(1.0, instruction_following)), 4),
        "completeness": round(max(0.0, min(1.0, completeness)), 4),
    }
    overall = round(mean(dimensions.values()), 4)
    suggestions: list[str] = []
    if dimensions["relevance"] < 0.7:
        suggestions.append("Increase direct alignment with the user prompt and keep domain terminology consistent.")
    if dimensions["instruction_following"] < 0.8:
        suggestions.append("Address every assertion explicitly and avoid skipping required constraints.")
    if dimensions["completeness"] < 0.8:
        suggestions.append("Provide a fuller answer structure and avoid overly short outputs.")
    if not suggestions:
        suggestions.append("Quality is stable; keep response structure deterministic across reruns.")
    rationale = (
        f"model={model}; overlap={overlap}; "
        f"instruction_following={dimensions['instruction_following']}; "
        f"completeness={dimensions['completeness']}"
    )
    return {
        "model": model,
        "dimension_scores": dimensions,
        "overall_score": overall,
        "rationale": rationale,
        "improvement_suggestions": suggestions,
        "source": "heuristic",
        "judge_trace_id": None,
    }


def _judge_quality_llm(
    prompt: str,
    output_text: str,
    assertion_results: list[dict[str, Any]],
    model: str,
    api_key: str,
    base_url: str | None,
    evidence_dir: Path | None,
) -> dict[str, Any]:
    judge_prompt = (
        "Evaluate the candidate output against the prompt and assertions.\n"
        "Return JSON only.\n\n"
        f"Prompt:\n{prompt}\n\n"
        f"Output:\n{output_text}\n\n"
        f"Assertions (with local pass signals):\n{json.dumps(assertion_results, ensure_ascii=False)}\n\n"
        "Required JSON keys:\n"
        "- dimension_scores: {relevance, instruction_following, completeness} each in [0,1]\n"
        "- rationale: concise reason\n"
        "- improvement_suggestions: array of short actionable suggestions\n"
    )
    messages = [
        {
            "role": "system",
            "content": (
                "You are a strict evaluator. Return JSON only with keys: "
                "dimension_scores, rationale, improvement_suggestions."
            ),
        },
        {"role": "user", "content": judge_prompt},
    ]
    response = _request_openai_compatible_chat(
        api_key=api_key,
        model=model,
        base_url=base_url,
        messages=messages,
        temperature=0.0,
    )
    if evidence_dir:
        _write_json(evidence_dir / f"judge-{_slug(model, 'judge')}-response.json", response["raw"])
    payload = _extract_json_object(str(response["content"]))
    raw_scores = payload.get("dimension_scores")
    if not isinstance(raw_scores, dict):
        raw_scores = payload
    dimensions = _normalize_dimension_scores(raw_scores)
    overall = round(mean(dimensions.values()), 4)

    rationale = str(payload.get("rationale", "")).strip()
    raw_suggestions = payload.get("improvement_suggestions", [])
    suggestions = (
        [str(item).strip() for item in raw_suggestions if str(item).strip()]
        if isinstance(raw_suggestions, list)
        else []
    )
    if not suggestions:
        suggestions = ["Judge did not provide concrete suggestions; re-check failed assertions manually."]

    return {
        "model": model,
        "dimension_scores": dimensions,
        "overall_score": overall,
        "rationale": rationale or "LLM judge returned no rationale.",
        "improvement_suggestions": suggestions[:5],
        "source": "llm",
        "judge_trace_id": response["trace_id"] or None,
    }


class LLMClient:
    def __init__(self, api_key: str, model: str, provider: str | None, base_url: str | None):
        self.api_key = api_key.strip()
        self.model = model.strip()
        self.provider = (provider or "openai-compatible").strip().lower()
        self.base_url = base_url.strip() if isinstance(base_url, str) and base_url.strip() else None
        if self.provider != "openai-compatible":
            raise ValueError(f"Unsupported provider for functional eval: {self.provider}")
        if not self.api_key:
            raise ValueError("API key is required for functional eval")
        if not self.model:
            raise ValueError("Model is required for functional eval")

    def run_skill(
        self,
        prompt: str,
        skill_content: str,
        case_evidence_dir: Path | None,
        run_label: str,
    ) -> dict[str, Any]:
        if skill_content.strip():
            system_prompt = (
                "You are an execution assistant. A skill guide is provided below. "
                "Follow it when producing the final answer.\n\n"
                f"SKILL GUIDE:\n---\n{skill_content[:12000]}\n---"
            )
        else:
            system_prompt = "You are an execution assistant. Complete the task directly."
        messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": prompt}]
        response = _request_openai_compatible_chat(
            api_key=self.api_key,
            model=self.model,
            base_url=self.base_url,
            messages=messages,
            temperature=0.0,
        )
        output_text = str(response["content"])

        raw_response_path: str | None = None
        if case_evidence_dir:
            run_dir = case_evidence_dir / run_label
            _write_json(run_dir / "request.json", {"messages": messages, "model": self.model})
            _write_json(run_dir / "response.json", response["raw"])
            raw_response_path = str((run_dir / "response.json").resolve())

        return {
            "output_text": output_text,
            "artifacts": {"output.txt": output_text},
            "latency_ms": int(response["latency_ms"]),
            "input_tokens": int(response["input_tokens"]),
            "output_tokens": int(response["output_tokens"]),
            "judge_trace_id": response["trace_id"] or None,
            "raw_response_path": raw_response_path,
        }


class JudgeClient:
    def __init__(self, api_key: str, provider: str | None, base_url: str | None):
        self.api_key = api_key.strip()
        self.provider = (provider or "openai-compatible").strip().lower()
        self.base_url = base_url.strip() if isinstance(base_url, str) and base_url.strip() else None

    def grade(
        self,
        prompt: str,
        output_text: str,
        assertion_results: list[dict[str, Any]],
        model: str,
        evidence_dir: Path | None,
    ) -> dict[str, Any]:
        if self.provider == "openai-compatible" and self.api_key:
            try:
                return _judge_quality_llm(
                    prompt=prompt,
                    output_text=output_text,
                    assertion_results=assertion_results,
                    model=model,
                    api_key=self.api_key,
                    base_url=self.base_url,
                    evidence_dir=evidence_dir,
                )
            except Exception as exc:
                fallback = _judge_quality_heuristic(prompt, output_text, assertion_results, model)
                fallback["rationale"] = (
                    f"{fallback.get('rationale', '')}; llm_fallback_reason={str(exc)}"
                )[:1000]
                return fallback
        return _judge_quality_heuristic(prompt, output_text, assertion_results, model)


def _aggregate_quality(per_model: list[dict[str, Any]]) -> dict[str, Any]:
    if not per_model:
        return {
            "dimension_scores": {},
            "overall_score": 0.0,
            "rationale": "No judge model results.",
            "improvement_suggestions": [],
            "source": "heuristic",
            "judge_trace_id": None,
            "per_model": [],
        }

    keys = set()
    for item in per_model:
        keys.update(item.get("dimension_scores", {}).keys())

    dimension_scores: dict[str, float] = {}
    for key in sorted(keys):
        vals = [float(item["dimension_scores"].get(key, 0.0)) for item in per_model]
        dimension_scores[key] = round(mean(vals), 4)

    overall = round(mean(float(item.get("overall_score", 0.0)) for item in per_model), 4)
    rationales = [
        f"{item.get('model', 'judge')}: {str(item.get('rationale', '')).strip()}"
        for item in per_model
        if str(item.get("rationale", "")).strip()
    ]
    merged_suggestions: list[str] = []
    seen = set()
    for item in per_model:
        for suggestion in item.get("improvement_suggestions", []) or []:
            text = str(suggestion).strip()
            if text and text not in seen:
                merged_suggestions.append(text)
                seen.add(text)
    source = "llm" if any(item.get("source") == "llm" for item in per_model) else "heuristic"
    judge_trace_id = next(
        (str(item.get("judge_trace_id")) for item in per_model if item.get("judge_trace_id")),
        None,
    )
    return {
        "dimension_scores": dimension_scores,
        "overall_score": overall,
        "rationale": " | ".join(rationales[:3]) if rationales else "No rationale provided by judges.",
        "improvement_suggestions": merged_suggestions[:5],
        "source": source,
        "judge_trace_id": judge_trace_id,
        "per_model": per_model,
    }


def _error_type(error: Exception) -> str:
    text = str(error).lower()
    if "http" in text or "url" in text or "network" in text:
        return "network"
    if "json" in text or "parse" in text:
        return "parse"
    return "runtime"


def run_single_case(
    case: dict[str, Any],
    skill_content: str,
    compare_mode: str,
    judge_models: list[str],
    client: LLMClient,
    grader: JudgeClient,
    output_dir: Path,
    evidence_root: Path | None,
) -> dict[str, Any]:
    prompt = str(case["prompt"])
    assertions = [str(item) for item in case["assertions"] if isinstance(item, str)]
    case_id = str(case["id"])
    case_slug = _slug(case_id, "case")

    case_output_dir = output_dir / case_slug
    case_output_dir.mkdir(parents=True, exist_ok=True)
    case_evidence_dir = evidence_root / case_slug if evidence_root else None
    if case_evidence_dir:
        case_evidence_dir.mkdir(parents=True, exist_ok=True)

    skill_payload = "" if compare_mode == "without_skill" else skill_content
    execution_label = "without_skill" if compare_mode == "without_skill" else "with_skill"
    execution_result = client.run_skill(prompt, skill_payload, case_evidence_dir, execution_label)
    output_text = str(execution_result.get("output_text", ""))

    for filename, content in execution_result.get("artifacts", {}).items():
        (case_output_dir / filename).write_text(str(content), encoding="utf-8")

    layer1 = _layer1_checks(prompt, output_text, assertions)
    assertion_results = _grade_assertions(output_text, assertions)

    if not layer1["passed"]:
        for item in assertion_results:
            item["passed"] = False
            item["evidence"] = f"Layer1 gate blocked: {item['evidence']}"

    if compare_mode == "no_skill":
        baseline_result = client.run_skill(prompt, "", case_evidence_dir, "baseline_no_skill")
        baseline_text = str(baseline_result.get("output_text", ""))
        if baseline_text == output_text:
            for item in assertion_results:
                item["passed"] = False
                item["evidence"] = "No improvement compared with no-skill baseline output."

    passed_assertions = sum(1 for item in assertion_results if bool(item.get("passed")))
    total_assertions = len(assertion_results)
    pass_rate = (passed_assertions / total_assertions) if total_assertions else 1.0
    passed = bool(layer1["passed"]) and pass_rate == 1.0

    quality_per_model = [
        grader.grade(prompt, output_text, assertion_results, model_name, case_evidence_dir)
        for model_name in judge_models
    ]
    layer2 = _aggregate_quality(quality_per_model)

    grade = {
        "summary": {
            "passed": passed_assertions if layer1["passed"] else 0,
            "failed": total_assertions - (passed_assertions if layer1["passed"] else 0),
            "pass_rate": pass_rate if layer1["passed"] else 0.0,
        },
        "layer1": layer1,
        "layer2": layer2,
        "results": assertion_results,
    }
    (case_output_dir / "grading.json").write_text(json.dumps(grade, indent=2), encoding="utf-8")

    return {
        "case_id": case_id,
        "pass_rate": grade["summary"]["pass_rate"],
        "passed": passed,
        "layer1_pass": bool(layer1["passed"]),
        "quality_score": layer2["overall_score"],
        "dimension_scores": layer2["dimension_scores"],
        "judge_rationale": layer2.get("rationale"),
        "judge_suggestions": layer2.get("improvement_suggestions", []),
        "judge_source": layer2.get("source", "heuristic"),
        "raw_response_path": execution_result.get("raw_response_path"),
        "latency_ms": execution_result.get("latency_ms"),
        "input_tokens": execution_result.get("input_tokens"),
        "output_tokens": execution_result.get("output_tokens"),
        "judge_trace_id": execution_result.get("judge_trace_id") or layer2.get("judge_trace_id"),
    }


def _parse_judge_models(args: argparse.Namespace) -> list[str]:
    raw = getattr(args, "judge_models", None)
    if not raw:
        return [args.model]
    models = [item.strip() for item in str(raw).split(",") if item.strip()]
    return models if models else [args.model]


def _aggregate_case_dimension_scores(results: list[dict[str, Any]]) -> dict[str, float]:
    buckets: dict[str, list[float]] = {}
    for item in results:
        dim = item.get("dimension_scores", {})
        if not isinstance(dim, dict):
            continue
        for key, value in dim.items():
            buckets.setdefault(str(key), []).append(float(value))
    return {key: round(mean(values), 4) for key, values in sorted(buckets.items()) if values}


def run(args: argparse.Namespace) -> dict[str, Any]:
    try:
        eval_set = json.loads(read_text_file(args.eval_set_path))
    except (json.JSONDecodeError, FileNotFoundError, OSError, ValueError) as exc:
        return {"status": "error", "message": f"Failed to read or parse eval set file: {exc}"}

    try:
        skill_content = read_text_file(args.skill_path)
    except FileNotFoundError:
        return {"status": "error", "message": f"Skill file not found at {args.skill_path}"}
    except (OSError, ValueError) as exc:
        return {"status": "error", "message": f"Failed to read skill file: {exc}"}

    try:
        judge_models = _parse_judge_models(args)
        client = LLMClient(
            api_key=args.api_key,
            model=args.model,
            provider=getattr(args, "provider", None),
            base_url=getattr(args, "base_url", None),
        )
    except Exception as exc:
        return {"status": "error", "message": str(exc)}

    grader = JudgeClient(
        api_key=args.api_key,
        provider=getattr(args, "provider", None),
        base_url=getattr(args, "base_url", None),
    )
    results: list[dict[str, Any]] = []
    evidence_root = getattr(args, "evidence_dir", None)
    if isinstance(evidence_root, Path):
        evidence_root.mkdir(parents=True, exist_ok=True)
        _write_json(
            evidence_root / "meta.json",
            {
                "skill_name": args.skill_name,
                "compare_mode": args.compare_mode,
                "judge_models": judge_models,
                "case_count": len(eval_set) if isinstance(eval_set, list) else 0,
            },
        )

    with ThreadPoolExecutor(max_workers=5) as executor:
        future_to_case = {
            executor.submit(
                run_single_case,
                item,
                skill_content,
                args.compare_mode,
                judge_models,
                client,
                grader,
                args.output_dir,
                evidence_root,
            ): item
            for item in eval_set
            if isinstance(item, dict)
        }

        for future in as_completed(future_to_case):
            item = future_to_case[future]
            try:
                results.append(future.result())
            except Exception as exc:
                results.append(
                    {
                        "case_id": str(item.get("id", "")),
                        "passed": False,
                        "pass_rate": 0.0,
                        "error": str(exc),
                        "error_type": _error_type(exc),
                        "layer1_pass": False,
                        "quality_score": 0.0,
                        "dimension_scores": {},
                        "judge_rationale": f"case execution failed: {exc}",
                        "judge_suggestions": ["Fix runtime error and rerun this case."],
                        "judge_source": "heuristic",
                        "raw_response_path": None,
                        "latency_ms": None,
                        "input_tokens": None,
                        "output_tokens": None,
                        "judge_trace_id": None,
                    }
                )

    total = len(results)
    passed_count = sum(1 for item in results if bool(item.get("passed", False)))
    quality_values = [float(item.get("quality_score", 0.0)) for item in results]
    layer1_passed = sum(1 for item in results if bool(item.get("layer1_pass", False)))
    dimension_scores = _aggregate_case_dimension_scores(results)

    summary = {
        "total": total,
        "passed": passed_count,
        "failed": total - passed_count,
        "pass_rate": (passed_count / total) if total > 0 else 0.0,
        "layer1_pass_rate": (layer1_passed / total) if total > 0 else 0.0,
        "quality_mean": round(mean(quality_values), 4) if quality_values else 0.0,
    }

    final_report: dict[str, Any] = {
        "status": "success",
        "skill_name": args.skill_name,
        "summary": summary,
        "results": sorted(results, key=lambda item: str(item.get("case_id", ""))),
        "dimension_scores": dimension_scores,
        "run_meta": {
            "compare_mode": args.compare_mode,
            "model": args.model,
            "judge_models": judge_models,
        },
    }

    (args.output_dir / "summary.json").write_text(json.dumps(final_report, indent=2), encoding="utf-8")
    return final_report

