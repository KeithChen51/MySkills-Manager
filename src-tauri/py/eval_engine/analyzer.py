"""
Analyzer module for the Skillar Skill Evaluator engine.

Performs four-step automated analysis of evaluation results:
1. Per-Assertion pattern analysis
2. Cross-Case pattern analysis
3. Efficiency trade-off analysis
4. Improvement suggestion generation

Output contract: { analyzer_notes, improvement_suggestions, description_feedback }
"""

from __future__ import annotations

import json
from typing import Any

try:
    from .llm_client import LLMClient, extract_json_object
except ImportError:
    from llm_client import LLMClient, extract_json_object  # type: ignore


# ---------------------------------------------------------------------------
# Pattern analysis helpers (heuristic, no LLM needed)
# ---------------------------------------------------------------------------


def _per_assertion_patterns(
    functional_results: list[dict[str, Any]],
    functional_without_skill: list[dict[str, Any]] | None,
) -> list[str]:
    """Analyze per-case with_skill vs without_skill patterns."""
    notes: list[str] = []
    if not functional_without_skill:
        return notes

    ws_by_id = {r.get("case_id"): r for r in functional_results}
    wos_by_id = {r.get("case_id"): r for r in functional_without_skill}

    both_pass = 0
    both_fail = 0
    skill_value = 0
    high_variance = 0

    for case_id in ws_by_id:
        ws = ws_by_id.get(case_id, {})
        wos = wos_by_id.get(case_id, {})
        ws_pass = bool(ws.get("passed"))
        wos_pass = bool(wos.get("passed"))

        if ws_pass and wos_pass:
            both_pass += 1
        elif not ws_pass and not wos_pass:
            both_fail += 1
        elif ws_pass and not wos_pass:
            skill_value += 1

    total = len(ws_by_id)
    if both_pass > total * 0.5:
        notes.append(
            f"区分度不足：{both_pass}/{total} 个用例在有技能和无技能场景下均通过。"
            "建议增加更严格的断言。"
        )
    if both_fail > total * 0.3:
        notes.append(
            f"能力差距：{both_fail}/{total} 个用例在两种配置下均失败。"
            "这些用例可能超出了当前模型的能力范围。"
        )
    if skill_value > 0:
        notes.append(
            f"核心价值：技能在 {skill_value}/{total} 个用例中提供了独特价值"
            "（有技能通过，无技能失败）。"
        )
    return notes


def _cross_case_patterns(
    trigger_results: list[dict[str, Any]],
    functional_results: list[dict[str, Any]],
) -> list[str]:
    """Analyze patterns across cases by bucket/category."""
    notes: list[str] = []

    # Trigger bucket analysis
    bucket_stats: dict[str, dict[str, int]] = {}
    for r in trigger_results:
        bucket = r.get("test_bucket", "unknown")
        bucket_stats.setdefault(bucket, {"total": 0, "passed": 0})
        bucket_stats[bucket]["total"] += 1
        if r.get("pass"):
            bucket_stats[bucket]["passed"] += 1

    worst_bucket = None
    worst_rate = 1.0
    for bucket, stats in bucket_stats.items():
        rate = stats["passed"] / max(1, stats["total"])
        if rate < worst_rate:
            worst_rate = rate
            worst_bucket = bucket

    if worst_bucket and worst_rate < 0.7:
        notes.append(
            f"最弱触发分类：'{worst_bucket}'，通过率仅 {worst_rate:.0%}。"
            "建议优先改进该分类的技能描述。"
        )

    # Functional failure concentration
    failed_cases = [r for r in functional_results if not r.get("passed")]
    if len(failed_cases) > len(functional_results) * 0.5:
        notes.append(
            f"功能失败率较高：{len(failed_cases)}/{len(functional_results)} 个功能用例失败。"
            "建议简化断言条件或改进技能指令。"
        )

    return notes


def _efficiency_analysis(
    functional_results: list[dict[str, Any]],
    functional_without_skill: list[dict[str, Any]] | None,
) -> list[str]:
    """Analyze efficiency trade-offs between with_skill and without_skill."""
    notes: list[str] = []
    if not functional_without_skill:
        return notes

    def _avg(items: list[dict[str, Any]], key: str) -> float:
        values = [r.get(key, 0) for r in items if r.get(key) is not None]
        return sum(values) / max(1, len(values))

    ws_tokens = _avg(functional_results, "input_tokens") + _avg(functional_results, "output_tokens")
    wos_tokens = _avg(functional_without_skill, "input_tokens") + _avg(functional_without_skill, "output_tokens")
    ws_latency = _avg(functional_results, "latency_ms")
    wos_latency = _avg(functional_without_skill, "latency_ms")

    ws_pass = sum(1 for r in functional_results if r.get("passed")) / max(1, len(functional_results))
    wos_pass = sum(1 for r in functional_without_skill if r.get("passed")) / max(1, len(functional_without_skill))

    token_delta = ws_tokens - wos_tokens
    latency_delta = ws_latency - wos_latency
    pass_delta = ws_pass - wos_pass

    notes.append(
        f"效率权衡：技能使通过率变化 {pass_delta:+.0%}，"
        f"Token 开销变化 {token_delta:+.0f}，延迟变化 {latency_delta:+.0f}ms。"
    )

    if token_delta > 2000 and pass_delta < 0.1:
        notes.append(
            "警告：Token 开销较大（+{:.0f}），但通过率提升有限（{:+.0%}）。"
            "建议优化技能指令以减少 Token 消耗。".format(token_delta, pass_delta)
        )

    return notes


# ---------------------------------------------------------------------------
# LLM-based analysis (optional, uses Judge model)
# ---------------------------------------------------------------------------


def _llm_analyze(
    client: LLMClient,
    result_json: dict[str, Any],
    heuristic_notes: list[str],
) -> dict[str, Any]:
    """Use Judge model to generate structured improvement suggestions."""
    # Prepare a condensed summary for the judge
    summary = {
        "trigger_pass_rate": result_json.get("trigger_clean", {}).get("summary", {}).get("pass_rate", 0),
        "functional_pass_rate": result_json.get("functional", {}).get("summary", {}).get("pass_rate", 0),
        "dimension_scores": result_json.get("dimension_scores", {}),
        "heuristic_notes": heuristic_notes,
        "mode": result_json.get("mode", "unknown"),
    }

    # Include without_skill comparison if available
    wos = result_json.get("functional_without_skill")
    if wos and isinstance(wos, dict):
        summary["without_skill_pass_rate"] = wos.get("summary", {}).get("pass_rate", 0)

    system_prompt = (
        "你是一位专业的 AI 技能评估专家。请分析以下评测结果并提供可操作的改进建议。"
        "仅返回 JSON，包含以下字段："
        "analyzer_notes（字符串数组，分析要点），improvement_suggestions（字符串数组，改进建议），"
        "description_feedback（可选字符串，技能描述改进建议）。请全部用中文回答。"
    )
    user_prompt = (
        f"评测结果摘要：\n{json.dumps(summary, ensure_ascii=False, indent=2)}\n\n"
        "请提供具体、可操作的分析，重点关注：\n"
        "1. 触发准确性模式及描述改进机会\n"
        "2. 功能正确性差距及 SKILL.md 内容改进\n"
        "3. 效率权衡及优化建议\n"
        "4. 测试集质量和覆盖率改进"
    )

    response = client.chat_json(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        temperature=0.1,
    )
    parsed = extract_json_object(str(response["content"]))

    raw_notes = parsed.get("analyzer_notes", [])
    raw_suggestions = parsed.get("improvement_suggestions", [])
    description_feedback = parsed.get("description_feedback")

    return {
        "analyzer_notes": [str(n).strip() for n in raw_notes if str(n).strip()][:10],
        "improvement_suggestions": [str(s).strip() for s in raw_suggestions if str(s).strip()][:10],
        "description_feedback": str(description_feedback).strip() if description_feedback else None,
    }


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def run(
    result_json: dict[str, Any],
    api_key: str | None = None,
    model: str | None = None,
    base_url: str | None = None,
    provider: str | None = None,
) -> dict[str, Any]:
    """Run the four-step analysis pipeline.

    Args:
        result_json: Complete evaluation pipeline output JSON.
        api_key: Optional API key for LLM-based analysis. If not provided, only heuristic analysis runs.
        model: Optional model for LLM-based analysis.
        base_url: Optional base URL for LLM API.
        provider: Optional provider string.

    Returns:
        Dict with analyzer_notes, improvement_suggestions, description_feedback.
    """
    # Extract sub-results
    trigger_clean = result_json.get("trigger_clean") or {}
    trigger_results = trigger_clean.get("results") or []
    functional = result_json.get("functional") or {}
    functional_results = functional.get("results") or []
    functional_wos = result_json.get("functional_without_skill") or {}
    functional_wos_results = functional_wos.get("results") if isinstance(functional_wos, dict) else None

    # Step 1: Per-assertion pattern analysis
    notes: list[str] = _per_assertion_patterns(functional_results, functional_wos_results)

    # Step 2: Cross-case pattern analysis
    notes.extend(_cross_case_patterns(trigger_results, functional_results))

    # Step 3: Efficiency trade-off analysis
    notes.extend(_efficiency_analysis(functional_results, functional_wos_results))

    # Step 4: LLM-based improvement suggestion generation (if credentials available)
    suggestions: list[str] = []
    description_feedback: str | None = None

    if api_key and model:
        try:
            client = LLMClient(
                api_key=api_key,
                model=model,
                base_url=base_url,
                provider=provider,
            )
            llm_result = _llm_analyze(client, result_json, notes)
            # Merge LLM notes with heuristic notes
            notes.extend(llm_result.get("analyzer_notes", []))
            suggestions = llm_result.get("improvement_suggestions", [])
            description_feedback = llm_result.get("description_feedback")
        except Exception as exc:
            notes.append(f"LLM 分析因出错跳过：{str(exc)[:200]}")
            suggestions.append("建议使用更强的模型重新运行分析器以获取详细建议。")

    # Deduplicate notes
    seen: set[str] = set()
    unique_notes: list[str] = []
    for note in notes:
        if note not in seen:
            unique_notes.append(note)
            seen.add(note)

    return {
        "analyzer_notes": unique_notes[:15],
        "improvement_suggestions": suggestions[:10],
        "description_feedback": description_feedback,
    }
