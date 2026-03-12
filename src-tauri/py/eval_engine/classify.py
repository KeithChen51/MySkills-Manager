"""
Classify SKILL.md into SoK / Anthropic / SkillsBench taxonomy labels.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
import urllib.error
import urllib.request

READ_ENCODINGS = ("utf-8", "utf-8-sig", "gb18030")

SOK_REPRESENTATIONS = (
    "Natural-language",
    "Tool macros",
    "Code-as-skill",
    "Hybrid",
)

SOK_SCOPES = (
    "Single-tool",
    "Multi-tool",
    "Web",
    "OS/Desktop",
    "Software Engineering",
    "Robotics/Physical",
)

ANTHROPIC_CATEGORIES = (
    "Document & Asset Creation",
    "Workflow Automation",
    "MCP Enhancement",
)

SKILLSBENCH_DOMAINS = (
    "Healthcare",
    "Manufacturing",
    "Cybersecurity",
    "Natural Science",
    "Energy",
    "Office & White Collar",
    "Finance",
    "Media & Content Production",
    "Robotics",
    "Mathematics",
    "Software Engineering",
)

DIFFICULTY_CORE = ("Core", "Extended", "Extreme")
DIFFICULTY_LEVEL_BY_CORE = {
    "Core": "Easy",
    "Extended": "Medium",
    "Extreme": "Hard",
}


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
        raise ValueError("Model output does not contain a JSON object")
    return json.loads(text[start : end + 1])


def _request_openai_compatible(api_key: str, model: str, base_url: str | None, prompt: str) -> str:
    endpoint = (base_url or "https://api.openai.com/v1").rstrip("/") + "/chat/completions"
    payload = {
        "model": model,
        "temperature": 0.0,
        "messages": [
            {
                "role": "system",
                "content": "You classify agent skills. Return strict JSON only.",
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
            "Authorization": f"Bearer {api_key}",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            raw = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:  # pragma: no cover - network path
        details = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"LLM HTTP {exc.code}: {details}") from exc
    except urllib.error.URLError as exc:  # pragma: no cover - network path
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


def _canon(value: str) -> str:
    return " ".join(value.strip().lower().replace("_", " ").split())


def _normalize_enum(value: Any, allowed: tuple[str, ...], fallback: str) -> str:
    text = str(value or "").strip()
    if not text:
        return fallback
    needle = _canon(text)
    for candidate in allowed:
        if needle == _canon(candidate):
            return candidate
    return fallback


def _normalize_difficulty_core(value: Any) -> str:
    text = str(value or "").strip().lower()
    if text == "core":
        return "Core"
    if text == "extended":
        return "Extended"
    if text == "extreme":
        return "Extreme"
    if text == "easy":
        return "Core"
    if text == "medium":
        return "Extended"
    if text == "hard":
        return "Extreme"
    return "Core"


def _normalize_taxonomy_payload(payload: dict[str, Any], model: str) -> dict[str, Any]:
    representation = _normalize_enum(
        payload.get("sokRepresentation"), SOK_REPRESENTATIONS, "Natural-language"
    )
    scope = _normalize_enum(payload.get("sokScope"), SOK_SCOPES, "Single-tool")
    anthropic = _normalize_enum(
        payload.get("anthropicCategory"), ANTHROPIC_CATEGORIES, "Workflow Automation"
    )
    domain = _normalize_enum(
        payload.get("skillsbenchDomain"), SKILLSBENCH_DOMAINS, "Software Engineering"
    )
    difficulty_core = _normalize_difficulty_core(
        payload.get("skillsbenchDifficultyCore") or payload.get("skillsbenchDifficultyLevel")
    )
    difficulty_level = DIFFICULTY_LEVEL_BY_CORE[difficulty_core]

    return {
        "sokRepresentation": representation,
        "sokScope": scope,
        "sokGroup": f"{representation} × {scope}",
        "anthropicCategory": anthropic,
        "skillsbenchDomain": domain,
        "skillsbenchDifficultyCore": difficulty_core,
        "skillsbenchDifficultyLevel": difficulty_level,
        "classifiedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "classifierModel": model.strip() or "unknown",
    }


def _heuristic_classify(skill_content: str, model: str) -> dict[str, Any]:
    lowered = skill_content.lower()
    representation = "Natural-language"
    if "```" in skill_content and "python" in lowered:
        representation = "Code-as-skill"
    if "tool" in lowered or "invoke" in lowered or "mcp" in lowered:
        representation = "Tool macros"
    if "```" in skill_content and ("tool" in lowered or "mcp" in lowered):
        representation = "Hybrid"

    scope = "Single-tool"
    if "multi-tool" in lowered or "multiple tools" in lowered:
        scope = "Multi-tool"
    elif "web" in lowered or "browser" in lowered:
        scope = "Web"
    elif "desktop" in lowered or "os" in lowered or "powershell" in lowered:
        scope = "OS/Desktop"
    elif "code" in lowered or "repository" in lowered or "test" in lowered:
        scope = "Software Engineering"
    elif "robot" in lowered:
        scope = "Robotics/Physical"

    anthropic = "Workflow Automation"
    if "mcp" in lowered:
        anthropic = "MCP Enhancement"
    elif "document" in lowered or "blog" in lowered or "write" in lowered:
        anthropic = "Document & Asset Creation"

    domain = "Software Engineering"
    if "finance" in lowered:
        domain = "Finance"
    elif "health" in lowered:
        domain = "Healthcare"
    elif "robot" in lowered:
        domain = "Robotics"
    elif "math" in lowered:
        domain = "Mathematics"
    elif "cyber" in lowered or "security" in lowered:
        domain = "Cybersecurity"

    line_count = len([line for line in skill_content.splitlines() if line.strip()])
    if line_count >= 140:
        difficulty_core = "Extreme"
    elif line_count >= 60:
        difficulty_core = "Extended"
    else:
        difficulty_core = "Core"

    return _normalize_taxonomy_payload(
        {
            "sokRepresentation": representation,
            "sokScope": scope,
            "anthropicCategory": anthropic,
            "skillsbenchDomain": domain,
            "skillsbenchDifficultyCore": difficulty_core,
        },
        model=model,
    )


def _build_prompt(skill_name: str, skill_content: str) -> str:
    return f"""
Classify the following skill into fixed taxonomy values.

Skill name:
{skill_name}

Skill content:
---
{skill_content[:12000]}
---

Return JSON object only with keys:
- sokRepresentation (one of: {", ".join(SOK_REPRESENTATIONS)})
- sokScope (one of: {", ".join(SOK_SCOPES)})
- anthropicCategory (one of: {", ".join(ANTHROPIC_CATEGORIES)})
- skillsbenchDomain (one of: {", ".join(SKILLSBENCH_DOMAINS)})
- skillsbenchDifficultyCore (one of: {", ".join(DIFFICULTY_CORE)})
""".strip()


def run(args: argparse.Namespace) -> dict[str, Any]:
    try:
        skill_content = read_text_file(args.skill_path)
    except (FileNotFoundError, OSError, ValueError) as exc:
        return {"status": "error", "message": f"Failed to read skill file: {exc}"}

    model = str(args.model or "").strip()
    if not model:
        return {"status": "error", "message": "Model is required"}

    provider = str(args.provider or "openai-compatible").strip().lower()
    use_llm = provider == "openai-compatible" and bool(str(args.api_key or "").strip())

    if use_llm:
        prompt = _build_prompt(args.skill_name, skill_content)
        try:
            content = _request_openai_compatible(
                api_key=str(args.api_key).strip(),
                model=model,
                base_url=(str(args.base_url).strip() if args.base_url else None),
                prompt=prompt,
            )
            payload = _extract_json_object(content)
            taxonomy = _normalize_taxonomy_payload(payload, model=model)
            return {"status": "success", "taxonomy": taxonomy}
        except Exception as exc:  # pragma: no cover - retry fallback path
            taxonomy = _heuristic_classify(skill_content, model=model)
            return {
                "status": "success",
                "taxonomy": taxonomy,
                "message": f"LLM classification failed, fallback heuristic used: {exc}",
            }

    taxonomy = _heuristic_classify(skill_content, model=model)
    return {
        "status": "success",
        "taxonomy": taxonomy,
        "message": "LLM classification unavailable, fallback heuristic used.",
    }
