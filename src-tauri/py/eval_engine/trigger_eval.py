#!/usr/bin/env python3
"""
Core module for running trigger accuracy evaluations.
"""

import argparse
import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

READ_ENCODINGS = ("utf-8", "utf-8-sig", "gb18030")


def read_text_file(path: Path) -> str:
    last_error: UnicodeDecodeError | None = None
    for encoding in READ_ENCODINGS:
        try:
            return path.read_text(encoding=encoding)
        except UnicodeDecodeError as exc:
            last_error = exc
    raise ValueError(f"Failed to decode file '{path}'. Please save it as UTF-8.") from last_error


def validate_trigger_eval_set(payload: object) -> list[dict]:
    if not isinstance(payload, list):
        raise ValueError("Invalid trigger eval set: expected top-level JSON array.")

    validated: list[dict] = []
    required = ("query", "should_trigger")
    for index, item in enumerate(payload, start=1):
        if not isinstance(item, dict):
            raise ValueError(
                f"Invalid trigger eval set: item #{index} must be an object with required keys: query, should_trigger."
            )

        missing = [key for key in required if key not in item]
        if missing:
            raise ValueError(
                f"Invalid trigger eval set: item #{index} missing required keys: query, should_trigger."
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

        validated.append({"query": query, "should_trigger": should_trigger})

    return validated

# A simple placeholder for a generic LLM API client
# In a real implementation, this would be a more robust client
# supporting different providers (OpenAI, Anthropic, etc.)
class LLMClient:
    def __init__(self, api_key: str, model: str):
        self.api_key = api_key
        self.model = model

    @staticmethod
    def _tokenize(text: str) -> set[str]:
        lowered = text.lower()
        latin_tokens = re.findall(r"[a-z0-9_]{3,}", lowered)
        cjk_chars = re.findall(r"[\u4e00-\u9fff]", text)
        cjk_bigrams = [f"{cjk_chars[i]}{cjk_chars[i + 1]}" for i in range(len(cjk_chars) - 1)]
        return set(latin_tokens + cjk_bigrams)

    def _skill_score(self, prompt: str, skill: dict) -> int:
        prompt_tokens = self._tokenize(prompt)
        if not prompt_tokens:
            return 0
        profile = f"{skill.get('name', '')} {skill.get('description', '')}"
        profile_tokens = self._tokenize(profile)
        return len(prompt_tokens & profile_tokens)

    def check_trigger(
        self,
        prompt: str,
        available_skills: list[dict],
        env_type: str,
    ) -> tuple[bool, str | None]:
        """
        Simulates an LLM call and checks if the target skill is triggered.
        Returns (triggered, triggered_skill_name).
        """
        target_skill_name = available_skills[0]['name']  # Assuming target is always first
        if target_skill_name.lower() in prompt.lower():
            return (True, target_skill_name)

        if env_type == "complex" and len(available_skills) > 1:
            scored = [(self._skill_score(prompt, skill), skill["name"]) for skill in available_skills]
            best_score, best_skill_name = max(scored, key=lambda item: item[0])
            if best_score > 0:
                return (True, best_skill_name)

            # Deterministic fallback noise to simulate multi-skill competition.
            checksum = sum(ord(ch) for ch in prompt)
            if checksum % 5 == 0:
                distractor_index = (checksum % (len(available_skills) - 1)) + 1
                return (True, available_skills[distractor_index]["name"])

        return (False, None)

def run_single_query(query: str, skill_name: str, skill_description: str, env_type: str, installed_skills_dir: Path | None, client: LLMClient) -> tuple[bool, str | None]:
    """
    Runs a single query and returns whether the skill was triggered and which skill was triggered.
    """
    available_skills = [{
        "name": skill_name,
        "description": skill_description
    }]

    if env_type == 'complex' and installed_skills_dir:
        for skill_file in installed_skills_dir.glob('*/SKILL.md'):
            if skill_file.parent.name != skill_name:
                # Simplified parsing of SKILL.md for description
                content = read_text_file(skill_file)
                desc = "No description"
                if "description:" in content:
                    desc = content.split("description:", 1)[1].splitlines()[0].strip().strip('"').strip("'")
                available_skills.append({
                    "name": skill_file.parent.name,
                    "description": desc
                })

    return client.check_trigger(query, available_skills, env_type)

def run(args: argparse.Namespace) -> dict:
    """Runs the full trigger evaluation set."""
    try:
        eval_set = validate_trigger_eval_set(json.loads(read_text_file(args.eval_set_path)))
    except (json.JSONDecodeError, FileNotFoundError, OSError, ValueError) as e:
        return {
            "status": "error",
            "message": f"Failed to read or parse eval set file: {e}"
        }

    client = LLMClient(api_key=args.api_key, model=args.model)
    results = []
    
    # In a real scenario, you might use more sophisticated skill parsing
    # For now, we assume a simple description is passed or can be found.
    # This part is simplified as the skill content is not directly used in this mock.
    skill_description = "A mock skill description."

    with ThreadPoolExecutor(max_workers=10) as executor:
        future_to_query = {
            executor.submit(
                run_single_query, 
                item['query'], 
                args.skill_name, 
                skill_description, 
                args.env_type, 
                args.installed_skills_dir, 
                client
            ): item for item in eval_set
        }

        for future in as_completed(future_to_query):
            item = future_to_query[future]
            try:
                triggered, triggered_skill_name = future.result()
                should_trigger = item['should_trigger']
                
                passed = (triggered and should_trigger and triggered_skill_name == args.skill_name) or \
                         (not triggered and not should_trigger)

                results.append({
                    "query": item['query'],
                    "should_trigger": should_trigger,
                    "triggered": triggered,
                    "triggered_skill_name": triggered_skill_name,
                    "pass": bool(passed) # Ensure it's a JSON-serializable boolean
                })
            except Exception as e:
                results.append({
                    "query": item['query'],
                    "should_trigger": item['should_trigger'],
                    "triggered": False,
                    "triggered_skill_name": None,
                    "pass": False,
                    "error": str(e)
                })

    total = len(results)
    passed_count = sum(1 for r in results if r['pass'])
    
    summary = {
        "total": total,
        "passed": passed_count,
        "failed": total - passed_count,
        "pass_rate": passed_count / total if total > 0 else 0
    }

    return {
        "status": "success",
        "skill_name": args.skill_name,
        "summary": summary,
        "results": results
    }
