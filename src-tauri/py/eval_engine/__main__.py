#!/usr/bin/env python3
"""
Skillar Skill Evaluator - CLI Entry Point

Routes commands to trigger/functional/sample generation modules.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    from . import classify, functional_eval, sample_gen, trigger_eval
except ImportError:
    import classify  # type: ignore
    import functional_eval  # type: ignore
    import sample_gen  # type: ignore
    import trigger_eval  # type: ignore


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Skillar Skill Evaluator CLI")
    subparsers = parser.add_subparsers(dest="command", required=True, help="Evaluation command to run")

    trigger_parser = subparsers.add_parser("trigger", help="Run trigger accuracy evaluation")
    trigger_parser.add_argument("--skill-name", required=True, help="Name of the skill to test")
    trigger_parser.add_argument("--skill-path", type=Path, help="Optional path to target SKILL.md")
    trigger_parser.add_argument("--eval-set-path", required=True, type=Path, help="Path to trigger eval JSON")
    trigger_parser.add_argument("--output-path", required=True, type=Path, help="Path to write trigger result")
    trigger_parser.add_argument("--evidence-dir", type=Path, help="Directory to persist trigger evidence")
    trigger_parser.add_argument("--env-type", choices=["clean", "complex"], default="clean")
    trigger_parser.add_argument("--installed-skills-dir", type=Path)
    trigger_parser.add_argument("--api-key", required=True)
    trigger_parser.add_argument("--model", required=True)
    trigger_parser.add_argument("--base-url")
    trigger_parser.add_argument("--provider")

    functional_parser = subparsers.add_parser("functional", help="Run functional correctness evaluation")
    functional_parser.add_argument("--skill-name", required=True, help="Name of the skill to test")
    functional_parser.add_argument("--skill-path", required=True, type=Path, help="Path to SKILL.md")
    functional_parser.add_argument("--eval-set-path", required=True, type=Path, help="Path to functional eval JSON")
    functional_parser.add_argument("--output-dir", required=True, type=Path, help="Directory to write outputs")
    functional_parser.add_argument("--evidence-dir", type=Path, help="Directory to persist functional evidence")
    functional_parser.add_argument(
        "--compare-mode",
        choices=["none", "no_skill", "without_skill"],
        default="no_skill",
    )
    functional_parser.add_argument(
        "--judge-models",
        help="Comma-separated model list for Layer2 quality aggregation",
    )
    functional_parser.add_argument("--api-key", required=True)
    functional_parser.add_argument("--model", required=True)
    functional_parser.add_argument("--base-url")
    functional_parser.add_argument("--provider")

    samples_parser = subparsers.add_parser("generate-samples", help="Generate trigger/functional sample datasets")
    samples_parser.add_argument("--skill-name", required=True, help="Name of the skill to generate cases for")
    samples_parser.add_argument("--skill-path", required=True, type=Path, help="Path to SKILL.md")
    samples_parser.add_argument("--trigger-count", type=int, default=40)
    samples_parser.add_argument("--functional-count", type=int, default=20)
    samples_parser.add_argument("--output-dir", required=True, type=Path)
    samples_parser.add_argument("--api-key", required=True)
    samples_parser.add_argument("--model", required=True)
    samples_parser.add_argument("--provider", default="openai-compatible")
    samples_parser.add_argument("--base-url")

    classify_parser = subparsers.add_parser("classify", help="Classify skill taxonomy labels")
    classify_parser.add_argument("--skill-name", required=True, help="Name of the skill to classify")
    classify_parser.add_argument("--skill-path", required=True, type=Path, help="Path to SKILL.md")
    classify_parser.add_argument("--output-path", required=True, type=Path, help="Path to write taxonomy result")
    classify_parser.add_argument("--api-key", required=True)
    classify_parser.add_argument("--model", required=True)
    classify_parser.add_argument("--provider")
    classify_parser.add_argument("--base-url")

    return parser


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()

    try:
        if args.command == "trigger":
            result = trigger_eval.run(args)
            _write_json(args.output_path, result)
        elif args.command == "functional":
            args.output_dir.mkdir(parents=True, exist_ok=True)
            result = functional_eval.run(args)
            summary_path = args.output_dir / "summary.json"
            if not summary_path.exists():
                _write_json(summary_path, result)
        elif args.command == "generate-samples":
            args.output_dir.mkdir(parents=True, exist_ok=True)
            result = sample_gen.run(args)
        elif args.command == "classify":
            result = classify.run(args)
            _write_json(args.output_path, result)
        else:
            raise ValueError(f"Unsupported command: {args.command}")
    except Exception as exc:  # pragma: no cover - CLI guard
        print(f"Skillar eval engine crashed: {exc}", file=sys.stderr)
        sys.exit(1)

    if isinstance(result, dict) and result.get("status") == "error":
        print(result.get("message", "Evaluation failed"), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
