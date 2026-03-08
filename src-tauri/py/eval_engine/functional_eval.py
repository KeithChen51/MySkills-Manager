"""
Core module for running functional correctness evaluations.
"""

import argparse
import json
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

# Placeholder for the grader module
# from . import grader

class LLMClient:
    """A mock client to simulate running a skill and getting an output."""
    def __init__(self, api_key: str, model: str):
        self.api_key = api_key
        self.model = model

    def run_skill(self, prompt: str, skill_content: str) -> dict:
        """
        Simulates running a skill with a prompt and returns a mock output.
        In a real implementation, this would involve a complex interaction with an LLM.
        """
        # Mock output generation
        output_text = f"This is the generated output for the prompt: '{prompt}' using the skill."
        if "fail" in prompt.lower():
            output_text += "\nAnd it seems to have failed an assertion."
        
        return {
            "output_text": output_text,
            "artifacts": {"output.txt": output_text}
        }

def run_single_case(case: dict, skill_content: str, client: LLMClient, output_dir: Path) -> dict:
    """
    Runs a single functional test case.
    """
    prompt = case['prompt']
    assertions = case['assertions']
    case_id = case['id']

    # 1. Run the skill to get the output
    execution_result = client.run_skill(prompt, skill_content)

    # 2. Save artifacts
    case_output_dir = output_dir / case_id
    case_output_dir.mkdir(parents=True, exist_ok=True)
    for filename, content in execution_result.get("artifacts", {}).items():
        (case_output_dir / filename).write_text(content)

    # 3. Grade the output using a grader agent (mocked here)
    # In a real implementation, this would call the grader module.
    # grade = grader.grade(execution_result, assertions, client)
    
    # Mock grading logic
    passed_assertions = [a for a in assertions if "fail" not in execution_result["output_text"].lower()]
    grade = {
        "summary": {
            "passed": len(passed_assertions),
            "failed": len(assertions) - len(passed_assertions),
            "pass_rate": len(passed_assertions) / len(assertions) if assertions else 1
        },
        "results": [
            {"assertion": a, "passed": True, "evidence": "Mock evidence"} for a in passed_assertions
        ] + [
            {"assertion": a, "passed": False, "evidence": "Mock failure evidence"} for a in assertions if a not in passed_assertions
        ]
    }

    (case_output_dir / 'grading.json').write_text(json.dumps(grade, indent=2))

    return {
        "case_id": case_id,
        "pass_rate": grade['summary']['pass_rate'],
        "passed": grade['summary']['pass_rate'] == 1.0
    }

def run(args: argparse.Namespace) -> dict:
    """Runs the full functional evaluation set."""
    try:
        eval_set = json.loads(args.eval_set_path.read_text())
    except (json.JSONDecodeError, FileNotFoundError) as e:
        return {
            "status": "error",
            "message": f"Failed to read or parse eval set file: {e}"
        }

    try:
        skill_content = args.skill_path.read_text()
    except FileNotFoundError:
        return {
            "status": "error",
            "message": f"Skill file not found at {args.skill_path}"
        }

    client = LLMClient(api_key=args.api_key, model=args.model)
    results = []

    with ThreadPoolExecutor(max_workers=5) as executor:
        future_to_case = {
            executor.submit(run_single_case, item, skill_content, client, args.output_dir): item
            for item in eval_set
        }

        for future in as_completed(future_to_case):
            item = future_to_case[future]
            try:
                result = future.result()
                results.append(result)
            except Exception as e:
                results.append({
                    "case_id": item['id'],
                    "passed": False,
                    "error": str(e)
                })

    total = len(results)
    passed_count = sum(1 for r in results if r.get('passed', False))
    
    summary = {
        "total": total,
        "passed": passed_count,
        "failed": total - passed_count,
        "pass_rate": passed_count / total if total > 0 else 0
    }

    final_report = {
        "status": "success",
        "skill_name": args.skill_name,
        "summary": summary,
        "results": results
    }

    (args.output_dir / "summary.json").write_text(json.dumps(final_report, indent=2))

    return final_report
