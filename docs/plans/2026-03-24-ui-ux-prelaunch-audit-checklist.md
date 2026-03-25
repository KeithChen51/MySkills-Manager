# UI/UX Pre-Launch Audit Checklist (2026-03-24)

## Purpose
- Freeze a single source of truth for pre-launch UI/UX remediation.
- Track issue-by-issue progress to avoid drift.
- Execute in skill batches: `/optimize` -> `/normalize` -> `/adapt` -> `/harden` -> `/clarify` -> `/polish` -> `/audit`.

## Verification Snapshot
- `npm run lint`: pass
- `npm run build`: pass with chunk-size warnings (`installCanvasRenderer ~532.51 kB`, `monaco-editor-contrib ~1025.15 kB`, `monaco-editor-common ~782.98 kB`, `monaco-editor-browser ~631.26 kB`)

## Batch A Progress (2026-03-24)
- `UIUX-001`: IN_PROGRESS
  - Entry chunk reduced from ~`1799 kB` to ~`160 kB` after page/component lazy loading + chunk strategy update.
  - ECharts footprint reduced by migrating from `echarts-for-react` default entry to `echarts-for-react/lib/core + echarts/core` selective modules.
  - Chart runtime isolated with `DeferredEChart` (`IntersectionObserver + React.lazy + Suspense`), only fetched when chart area enters viewport.
  - ECharts split by usage path: Dashboard (`bar/line/pie`) and Eval (`bar`) use separate lazy modules; previous single `EChartsLite ~574.80 kB` now becomes `installCanvasRenderer ~532.51 kB` + `EChartsLite ~42.90 kB` + `EChartsEvalLite ~0.24 kB`.
  - `KpiCard` chunk reduced from previous chart-coupled size (~`575 kB`) to ~`1.78 kB`.
  - Monaco no longer ships as single `monaco-vendor` chunk; split into `monaco-*` groups via `manualChunks` to reduce per-chunk peak.
  - Current largest Monaco chunks: `monaco-editor-contrib ~1025.15 kB`, `monaco-editor-common ~782.98 kB`, `monaco-editor-browser ~631.26 kB`.
  - Remaining large chunks: `installCanvasRenderer ~532.51 kB` and the three Monaco editor groups above.
- `UIUX-002`: DONE
  - Route/page imports moved to lazy loading in `src/App.tsx`.
  - `SkillEditor` moved to lazy loading in `src/pages/SkillsPage.tsx`.
  - Eval page now avoids first-load mount until visited once (keeps state after first open).
  - Added `manualChunks` split for `react-vendor`, `tauri-vendor`, and Monaco grouped chunks in `vite.config.ts`.
- `UIUX-015`: DONE
  - Progress-bar animation updated from `width` transition to `transform: scaleX(...)` in:
    - `src/components/UpdateNotification.tsx` + `src/components/UpdateNotification.css`
    - `src/pages/EvalPage.tsx` + `src/pages/EvalPage.css`

## Batch B Progress (2026-03-24)
- `UIUX-004`: DONE
  - Eval milestone active state switched from hard-coded blue (`#3b82f6`) to tokenized accent styles in `src/pages/EvalPage.css` (`var(--accent)` + `color-mix` ring).
- `UIUX-005`: DONE
  - Git syncing state pill switched from hard-coded cyan/blue values to `--info-*` token-based styles in `src/pages/GitPage.css`.
- `UIUX-006`: DONE
  - Score star filled gradient switched from hard-coded amber hex values to `--highlight` / `--highlight-hover` tokens in `src/pages/EvalPage.css`.
- `UIUX-016`: DONE
  - Git overlay scrim now uses `--overlay-scrim` token mix instead of hard-coded `#0b1224` in `src/pages/GitPage.css`.
- `UIUX-017`: DONE
  - Added `--text-inverse` token in `src/styles/tokens.css` and replaced residual hard-coded white text in `src/styles/primitives.css` and `src/pages/EvalPage.css`.

## Batch C Progress (2026-03-24)
- `UIUX-007`: DONE
  - Result filter pills and page-size select now use `var(--control-height-touch)` in `src/pages/EvalPage.css` (`.eval-result-filter-pill`, `.eval-result-page-size .filter-select`).
- `UIUX-008`: DONE
  - Tool info indicator touch target expanded from `20x20` to `var(--control-height-touch)` in `src/pages/ToolsPage.css` (`.tool-card-info-icon`).
- `UIUX-009`: DONE
  - Settings nav item minimum height raised from `40px` to `var(--control-height-touch)` in `src/pages/SettingsPage.css` (`.settings-nav-item`).
- `UIUX-010`: DONE
  - Reduced nowrap rigidity by allowing wrapping in run button, history path row, results table cells, and tools header status (`src/pages/EvalPage.css`, `src/pages/ToolsPage.css`).
- `UIUX-011`: DONE
  - Replaced fixed `620px` min-height with `clamp(480px, 64vh, 760px)` and added small-screen reset in `src/pages/SettingsPage.css` (`.settings-workbench`, `.settings-pane`).

## Batch D Progress (2026-03-24)
- `UIUX-003`: DONE
  - Hardened scroll layering by switching key non-scroll wrappers to `overflow: clip` and restoring explicit root scroll on Git page:
    - `src/App.css` (`.app-shell`)
    - `src/pages/SkillToolsPage.css` (`.skill-tools-shell`, `.skill-tools-pane`)
    - `src/pages/GitPage.css` (`.git-page` uses `overflow-y: auto` + clipped x-axis)
- `UIUX-012`: DONE
  - Replaced focusable `span` help pattern with semantic, assistive hint linkage:
    - `src/pages/tools/ToolCard.tsx`: manual sync button now uses `aria-describedby`
    - Added hidden descriptive text via `.sr-only` utility in `src/styles/primitives.css`
    - Info icon now decorative (`aria-hidden="true"`)
- `UIUX-014`: DONE
  - Added app-level automated UI regression guard command and checker:
    - `package.json`: `test:ui-regression`
    - `scripts/ui-regression-check.mjs`: validates scroll-shell contracts, ToolCard accessibility pattern, and page-shell consistency.

## Batch E Progress (2026-03-24)
- `UIUX-013`: DONE
  - Localized Chinese technical labels and descriptions in `src/i18n/messages.ts`:
    - `settings.modelGroup.url` -> `基础地址（Base URL）`
    - `settings.modelGroup.apiKey` -> `API 密钥`
    - `settings.evalConfig.apiKey` / `settings.evalConfig.baseUrl` / `settings.evalConfig.help` updated to Chinese wording.
- `UIUX-018`: DONE
  - Removed stale drag-related i18n keys from `src/i18n/messages.ts`:
    - `settings.modelGroup.dragGroup`
    - `settings.modelGroup.dragModel`

## Batch F Progress (2026-03-24)
- Focus-visible consistency pass completed across high-frequency navigation and control surfaces:
  - `src/components/Sidebar.css` (`.sidebar-item:focus-visible`)
  - `src/pages/SkillToolsPage.css` (`.skill-tools-tab:focus-visible`, unified gap + tab min-height token)
  - `src/pages/SettingsPage.css` (`.settings-nav-item:focus-visible`)
  - `src/pages/ToolsPage.css` (`.tool-switch:focus-visible`, `.tool-path-picker:focus-visible`, strengthened `.tool-card-info-icon:focus-visible`)
  - `src/pages/GitPage.css` (`.git-repo-card-main:focus-visible`)
- Objective: close micro-interaction consistency gaps before final audit without changing page information architecture.

## Batch G Progress (2026-03-24)

### Anti-Patterns Verdict
- Pass. Current interface does not show strong AI-template signals (no generic hero-metric slab, no heavy glassmorphism stack, no gradient headline abuse).
- Visual language stays consistent with the previously selected "ordered but light control" direction.

### Executive Summary
- Total open issues after re-audit: `3`
- Severity split: `High 1` / `Medium 0` / `Low 2` / `Critical 0`
- Primary blocker: `UIUX-001` (bundle/chunk size risk)
- Audit quality score: `8.5 / 10`
- Fresh verification evidence:
  - `npm run test:ui-regression`: pass (`lint + build + ui-regression-check`)
  - `ui-regression-check`: `15` checks passed
  - Build still reports large chunks (`installCanvasRenderer ~532.51kB`, `monaco-editor-contrib ~1.03MB`, `monaco-editor-common ~782.98kB`, `monaco-editor-browser ~631.26kB`)

### Detailed Findings by Severity

#### High
- `UIUX-001` (existing, still open)
  - Location: build artifacts / Vite chunk report
  - Category: Performance
  - Description: Monaco + CanvasRenderer related chunks remain large even after lazy split.
  - Impact: cold-start and first-hit latency risk on lower-spec office machines.
  - Recommendation: continue `/optimize` with Monaco language/contrib reduction and chart renderer gating strategy.

#### Medium
- None.

#### Low
- `UIUX-019` (new)
  - Location: `src/pages/EvalPage.css`, `src/components/SkillEditor.css`
  - Category: Theming
  - Description: residual hex literals remain mostly as fallback values in `var(...)` / `color-mix(...)`.
  - Impact: low; does not currently break theme consistency, but weakens long-term token purity.
  - Recommendation: sweep remaining fallback literals into semantic token aliases via `/normalize`.
- `UIUX-020` (new)
  - Location: `src/components/SkillCard.css`, `src/components/SkillEditor.css`, `src/components/UpdateNotification.css`, `src/pages/EvalPage.css`, `src/pages/ToolsPage.css`
  - Category: Accessibility/Responsive
  - Description: some interactive elements still use `30-42px` dimensions.
  - Impact: low in current desktop-only scope; potential friction if touch or dense zoom scenarios are introduced later.
  - Recommendation: keep as accepted debt for desktop launch, promote to `/adapt` backlog when mobile/touch scope opens.

### Patterns & Systemic Notes
- Token system is already dominant, but fallback literal cleanup is not yet fully complete.
- Control sizing has two eras in codebase: older `40px` baseline and newer tokenized `--control-height-touch`.

### Positive Findings
- High-frequency controls now have consistent `:focus-visible` states across sidebar, tab switch, settings nav, tools actions, and git cards.
- Scroll-layer regressions were successfully hardened with shell overflow contracts and guard script.
- Chinese settings copy normalization and drag-sort cleanup are both stable.

### Recommendations by Priority
1. Immediate: continue `/optimize` for `UIUX-001` (only high-severity open item).
2. Short-term: keep token hygiene as a merge gate (`UIUX-019` already closed).
3. Medium-term: touch-size normalization milestone is complete (`UIUX-020` closed).
4. Long-term: keep `test:ui-regression` as gate in pre-release routine.

## Batch H Progress (2026-03-24)
- `/normalize` follow-up completed:
  - `UIUX-019`: DONE
  - Removed color fallback literals from:
    - `src/pages/EvalPage.css`
    - `src/components/SkillEditor.css`
  - Verified by `npm run test:ui-regression` (pass, 15 guard checks pass).

## Batch I Progress (2026-03-24)
- `/adapt` follow-up completed:
  - `UIUX-020`: DONE
  - Upgraded interactive control sizing to `--control-height-touch` in:
    - `src/components/SkillCard.css`
    - `src/components/SkillEditor.css`
    - `src/components/UpdateNotification.css`
    - `src/components/VersionJumpNotification.css`
    - `src/pages/DashboardPage.css`
  - Remaining `30-42px` sizes are non-interactive visuals (tag chips, milestone circle, switch thumb, status text container).
  - Verified by `npm run test:ui-regression` (pass, 15 guard checks pass).

## Current Open Items
- `UIUX-001` (High, `/optimize`) remains the only unresolved item.

## Issue Checklist (All Items)

| ID | Status | Severity | Category | Issue | Evidence | Recommended Skill |
|---|---|---|---|---|---|---|
| UIUX-001 | IN_PROGRESS | High | Performance | Build chunk size too large (startup/runtime risk) | Build output after optimize: `index ~160kB`; chart path split and deferred (`installCanvasRenderer ~532.51kB`); Monaco split from single vendor into grouped chunks (largest `monaco-editor-contrib ~1.03MB`) | `/optimize` |
| UIUX-002 | DONE | High | Performance | Heavy eager imports in app/page shell and editor paths | Lazy loading added in `src/App.tsx` and `src/pages/SkillsPage.tsx` | `/optimize` |
| UIUX-003 | DONE | High | Resilience | Scroll-container layering still fragile (regression risk) | Hardened via `overflow: clip` wrappers and explicit Git root scroll in `src/App.css`, `src/pages/SkillToolsPage.css`, `src/pages/GitPage.css` | `/harden` |
| UIUX-004 | DONE | High | Theming | Hard-coded active blue in eval milestone states | Replaced with tokenized accent styles in `src/pages/EvalPage.css` (`var(--accent)` + token-based ring/shadow) | `/normalize` |
| UIUX-005 | DONE | Medium | Theming | Hard-coded syncing blue in Git state pill | Replaced with `--info-bg` / `--info` token mix in `src/pages/GitPage.css` | `/normalize` |
| UIUX-006 | DONE | Medium | Theming | Hard-coded amber gradient for score star | Replaced with `--highlight` + `--highlight-hover` gradient in `src/pages/EvalPage.css` | `/normalize` |
| UIUX-007 | DONE | Medium | Accessibility | Result filter/button controls below 44px touch target | `src/pages/EvalPage.css:1619,1654` now use `var(--control-height-touch)` | `/adapt` |
| UIUX-008 | DONE | Medium | Accessibility | Tool info icon touch target too small (`20x20`) | `src/pages/ToolsPage.css:433,436` now use `var(--control-height-touch)` | `/adapt` |
| UIUX-009 | DONE | Medium | Accessibility | Settings nav items use `40px` minimum height | `src/pages/SettingsPage.css:54` now uses `var(--control-height-touch)` | `/adapt` |
| UIUX-010 | DONE | Medium | Responsive | Heavy `nowrap` usage can cause truncation at narrow widths | Wrapping enabled in `src/pages/EvalPage.css:314,1101,1686` and `src/pages/ToolsPage.css:43` | `/adapt` |
| UIUX-011 | DONE | Medium | Responsive | Fixed min-height in settings workbench/pane can reduce flexibility | `src/pages/SettingsPage.css:10,99` now use `clamp(...)`; small screens reset at `:447,451` | `/adapt` |
| UIUX-012 | DONE | Medium | Accessibility | Help/info indicator uses focusable `span` (`role="img"`) rather than semantic control pattern | `src/pages/tools/ToolCard.tsx` now uses `aria-describedby` + decorative icon; `.sr-only` utility added in `src/styles/primitives.css` | `/harden` |
| UIUX-013 | DONE | Medium | Copy/I18n | Chinese locale still has English technical labels (`Base URL`, `API Key`) | Localized in `src/i18n/messages.ts` (`settings.modelGroup.url/apiKey`, `settings.evalConfig.*`) | `/clarify` |
| UIUX-014 | DONE | Medium | QA | No app-level automated UI regression script in npm commands | Added `test:ui-regression` in `package.json` + `scripts/ui-regression-check.mjs` guard | `/harden` |
| UIUX-015 | DONE | Low | Motion/Perf | Progress bars animate via `transform` instead of `width` transitions | `src/pages/EvalPage.css`, `src/components/UpdateNotification.css` | `/optimize` |
| UIUX-016 | DONE | Low | Theming | Overlay color still mixes hard-coded `#0b1224` | Replaced with tokenized scrim mix (`--overlay-scrim`) in `src/pages/GitPage.css` | `/normalize` |
| UIUX-017 | DONE | Low | Theming | Residual hard-coded white remains in component styles | Introduced `--text-inverse` token and replaced direct `#fff` usage in `src/styles/primitives.css` and `src/pages/EvalPage.css` | `/normalize` |
| UIUX-018 | DONE | Low | Copy Cleanup | Drag-related i18n keys remain after sorting feature removal | Removed `settings.modelGroup.dragGroup/dragModel` from `src/i18n/messages.ts` | `/clarify` |
| UIUX-019 | DONE | Low | Theming | Residual fallback literals in eval/editor styles | Removed fallback color literals in `src/pages/EvalPage.css` and `src/components/SkillEditor.css`; `npm run test:ui-regression` pass | `/normalize` |
| UIUX-020 | DONE | Low | Accessibility/Responsive | Interactive controls were in `30-42px` size band | Normalized key interactive controls to `--control-height-touch`; `npm run test:ui-regression` pass | `/adapt` |

## Execution Batches

### Batch A - `/optimize`
- UIUX-001, UIUX-002, UIUX-015

### Batch B - `/normalize`
- UIUX-004, UIUX-005, UIUX-006, UIUX-016, UIUX-017

### Batch C - `/adapt`
- UIUX-007, UIUX-008, UIUX-009, UIUX-010, UIUX-011

### Batch D - `/harden`
- UIUX-003, UIUX-012, UIUX-014

### Batch E - `/clarify`
- UIUX-013, UIUX-018

### Batch F - `/polish`
- Visual micro-consistency pass after A-E complete

### Batch G - `/audit`
- Final re-audit and closure report
- Follow-up queue created: UIUX-019, UIUX-020

### Batch H - `/normalize`
- UIUX-019

### Batch I - `/adapt`
- UIUX-020

## Progress Rules
- Do not mark any item `DONE` without command-level evidence.
- Update this file after each batch and keep IDs stable.
- If scope changes, add new IDs instead of rewriting old IDs.
