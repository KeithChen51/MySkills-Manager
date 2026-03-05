# MySkills Router Native Multi-Tool Integration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `myskills-router` reliably discoverable and executable via each tool's native mechanism, so Skillar scales beyond Codex/Antigravity without brittle tool-specific hacks.

**Architecture:** Introduce a capability-driven tool adapter model. Prefer native skill discovery and native instruction chains; only use startup context injection where the tool officially supports it. Keep a layered fallback: discovery -> instruction gate -> optional startup injection -> observability.

**Tech Stack:** Rust (Tauri backend), TypeScript/React (UI), JSON config files, existing setup engine modules in `src-tauri/src/setup`.

---

## Scope Freeze (This Plan Assumes)

1. Do **not** build a fake "universal SessionStart hook" abstraction.
2. Codex path strategy must align with native discovery (`~/.agents/skills`) first.
3. Existing rules injection remains as safety net; do not remove gate rules until health checks prove parity.

---

## Iteration 1: Codex Reliability Baseline (P0)

**Objective:** Eliminate current "myskills-router unavailable" incidents in Codex with minimal-risk fixes.

### Task 1.1: Add BOM-safe frontmatter parsing

**Files:**
- Modify: `src-tauri/src/skills.rs`
- Test: `src-tauri/src/skills.rs` (unit tests section)

**Changes:**
1. Normalize input by stripping UTF-8 BOM before frontmatter detection.
2. Keep current parsing behavior unchanged for non-BOM files.
3. Add unit tests:
   - `SKILL.md` with BOM + valid frontmatter -> parsed name is correct.
   - Existing non-BOM cases remain green.

**Acceptance Criteria:**
1. `list_skills` includes `myskills-router` even when file has BOM.
2. No regression in existing parsing tests.

---

### Task 1.2: Update Codex built-in path candidates to include native discovery path

**Files:**
- Modify: `src-tauri/src/setup/tool_catalog.rs`
- Modify: `src-tauri/src/setup/tests.rs`

**Changes:**
1. For built-in `codex`, add candidate path order:
   - `~/.agents/skills` (preferred)
   - `~/.codex/skills` (legacy fallback)
2. Keep override behavior highest priority.
3. Extend tests to verify:
   - Auto-detect prefers `.agents/skills` when present.
   - Falls back to `.codex/skills` when `.agents/skills` missing.

**Acceptance Criteria:**
1. `setup_status` for codex reports selected path as `.agents/skills` when available.
2. Existing codex tests still pass.

---

### Task 1.3: Ensure router seeding reaches active skills root and codex-selected path

**Files:**
- Modify: `src-tauri/src/onboarding.rs`
- Modify: `src-tauri/src/setup/apply_engine.rs`
- Test: `src-tauri/src/onboarding.rs`, `src-tauri/src/setup/tests.rs`

**Changes:**
1. Keep current root seeding (`MYSKILLS_ROOT_DIR`) unchanged.
2. During `setup_apply` for codex copy mode, verify/seed `myskills-router` in selected codex skills dir if absent.
3. Add tests for first-run user with empty codex target path.

**Acceptance Criteria:**
1. After setup apply, codex target path always contains `myskills-router/SKILL.md`.
2. No duplicate/legacy `myskills-command` leakage.

---

## Iteration 2: Capability-Driven Multi-Tool Adapters (P1)

**Objective:** Replace hardcoded per-tool assumptions with explicit capabilities so Skillar can scale to more tools.

### Task 2.1: Introduce tool capability model

**Files:**
- Modify: `src-tauri/src/setup/tool_catalog.rs`
- Modify: `src-tauri/src/setup/types.rs`
- Modify: `src-tauri/src/setup/status_aggregation.rs`
- Test: `src-tauri/src/setup/tests.rs`

**Changes:**
1. Add capability flags in descriptor/status:
   - `native_skill_discovery`
   - `instruction_chain_supported`
   - `startup_injection_supported`
   - `hook_config_supported`
2. Populate built-ins with conservative defaults:
   - Codex: native skill discovery + instruction chain.
   - Claude Code: skill discovery + instruction chain + hook config.
   - OpenCode: skill discovery + instruction chain (plugin integration via explicit path, not assumed universal hook schema).
   - Cursor/Windsurf/Trae/Antigravity: based on current supported integration path.

**Acceptance Criteria:**
1. `setup_status` returns capability-aware metadata.
2. Frontend can render "native mode vs fallback mode".

---

### Task 2.2: Split setup apply flow by capability instead of tool id branching

**Files:**
- Modify: `src-tauri/src/setup/apply_engine.rs`
- Modify: `src-tauri/src/setup/rule_hook_ops.rs`
- Test: `src-tauri/src/setup/tests.rs`

**Changes:**
1. Refactor apply flow to stages:
   - Stage A: sync skills content
   - Stage B: enforce instruction gate (rules/AGENTS marker block)
   - Stage C: optional hook/plugin bootstrap only when capability says supported
2. Keep existing rollback semantics.
3. Ensure unsupported startup injection never blocks successful setup.

**Acceptance Criteria:**
1. Apply success no longer depends on non-native hook assumptions.
2. Hook failures degrade gracefully to instruction-gate-only mode.

---

## Iteration 3: Router Effectiveness Observability (P2)

**Objective:** Make router health measurable so regressions are visible before users report them.

### Task 3.1: Add backend router health probe

**Files:**
- Add: `src-tauri/src/setup/router_health.rs`
- Modify: `src-tauri/src/setup.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/setup/tests.rs`

**Changes:**
1. Add command `setup_router_health()` that returns per-tool checks:
   - discoverable (router visible in active skills path)
   - gate_present (rule block present)
   - startup_injection_present (if supported)
   - last_usage_seen (from logs, optional)
2. Classify health:
   - `healthy`
   - `degraded`
   - `broken`

**Acceptance Criteria:**
1. API output is deterministic for all built-in tools.
2. Degraded/broken states include actionable reason string.

---

### Task 3.2: Surface router health in Tools page

**Files:**
- Modify: `src/api/tauri.ts`
- Modify: `src/pages/ToolsPage.tsx`
- Modify: `src/pages/tools/ToolCard.tsx`
- Modify: `src/i18n/messages.ts`

**Changes:**
1. Show router health badge per tool.
2. Show quick-fix CTA when degraded/broken:
   - "Re-apply setup"
   - "Open path settings"
3. Keep status concise; no verbose diagnostics in card body.

**Acceptance Criteria:**
1. Tool cards clearly display router health state.
2. Users can recover common issues in <=2 clicks.

---

## Iteration 4: Extensibility for New Tools (P3)

**Objective:** Make adding a new tool mostly data/config work, not deep code branching.

### Task 4.1: Externalize built-in tool definitions

**Files:**
- Add: `src-tauri/src/setup/tool_registry.rs`
- Modify: `src-tauri/src/setup/tool_catalog.rs`
- Test: `src-tauri/src/setup/tests.rs`

**Changes:**
1. Move static tool defaults + candidate paths + capability profile into one registry layer.
2. Keep current built-ins functionally equivalent.
3. Define clear extension points for future tools (e.g., Cline, Roo, Aider desktop wrappers).

**Acceptance Criteria:**
1. Adding a new tool requires only registry entry + tests.
2. No behavior regression for existing built-ins.

---

### Task 4.2: Add integration contract tests by capability class

**Files:**
- Add/Modify: `src-tauri/src/setup/tests.rs`

**Changes:**
1. Add test suites grouped by capability classes:
   - native-only tools
   - native + hook tools
   - rules-fallback tools
2. Add matrix assertions:
   - path selection
   - router discoverability
   - gate injection idempotency
   - rollback safety

**Acceptance Criteria:**
1. Any new tool integration must pass capability contract tests.
2. CI catches path-model regressions early.

---

## Rollout Plan

1. Release 1 (`vNext.1`): Iteration 1 only (Codex reliability hotfix).
2. Release 2 (`vNext.2`): Iteration 2 + 3 (capability model + health probe/UI).
3. Release 3 (`vNext.3`): Iteration 4 (extensibility hardening).

---

## Risk Register

1. **Risk:** Tool vendor behavior changes (paths/events) silently break integration.  
   **Mitigation:** Capability probes + health checks + path validation matrix.

2. **Risk:** Over-aggressive fallback removal causes router gaps.  
   **Mitigation:** Keep instruction gate as permanent baseline, never hook-only.

3. **Risk:** Path migration confusion for existing users (`.codex/skills` vs `.agents/skills`).  
   **Mitigation:** Auto-detect + UI migration hint + non-destructive fallback.

---

## Definition of Done (Program Level)

1. `myskills-router` is discoverable and callable in each enabled tool via that tool's native mechanism.
2. Setup engine no longer assumes universal SessionStart hook semantics.
3. Router health is observable in backend API and UI.
4. New tool onboarding requires registry-level changes, not ad-hoc branch logic.
