# UI/UX Audit Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 按审计结果系统性修复本项目 UI/UX 问题，优先解决可访问性与关键交互失效问题，并建立可持续的质量防回归机制。

**Architecture:** 采用“先红后绿”迭代：每个任务先补最小失败测试（静态结构测试 + lint +必要脚本检查），再做最小实现，最后验证并提交。先修 Critical/High，再处理 Medium/Low，最后执行整体验收。以 token 化、语义化、组件拆分和可测性增强为核心策略。

**Tech Stack:** React 19 + TypeScript + Vite + ESLint + Node test runner (`node --test`) + CSS variables/token system。

---

## Scope And Audit Mapping

- Critical: 键盘不可达交互、历史记录 Load 按钮无真实加载。
- High: 弹层语义与焦点管理、tablist 语义不完整、关键输入缺 label、i18n 硬编码、对比度风险。
- Medium: 触控目标尺寸、硬编码色值残留、响应式最小宽度策略、大组件性能、日志路径可读性。
- Low: 视觉辨识度和图表高度弹性优化。

## Global Prerequisites

- 工作目录：`C:\Own Docm\Coding\My-Skills\myskills-manager-eval-6.0`
- 建议分支：`codex/ui-ux-remediation-2026-03`
- 每个任务都执行：
  - `npm run lint`
  - `node --test <task-related-tests>`
- 所有新测试放到 `test/`，优先“行为约束”测试，避免脆弱快照。

## Commit Convention

- `fix(a11y): ...`
- `fix(ux): ...`
- `fix(theme): ...`
- `perf(ui): ...`
- `test(ui): ...`

---

### Task 1: 建立修复基线与防回归测试骨架

**Files:**
- Create: `test/uiA11ySemantics.test.ts`
- Create: `test/uiThemeTokenUsage.test.ts`
- Create: `test/uiResponsiveConstraints.test.ts`
- Modify: `package.json`（如需新增 `test:ui` 脚本）

**Step 1: Write the failing test**

- 在 `test/uiA11ySemantics.test.ts` 中先断言当前存在问题（例如 `EvalHistory` 未声明 dialog role，`SettingsPage` 使用 `role="button"` + `tabIndex` 容器）。
- 在 `test/uiThemeTokenUsage.test.ts` 中断言关键文件不应出现硬编码高频色值（允许 token 定义文件除外）。
- 在 `test/uiResponsiveConstraints.test.ts` 中断言不应出现关键交互控件 <44px。

**Step 2: Run test to verify it fails**

Run: `node --test test/uiA11ySemantics.test.ts test/uiThemeTokenUsage.test.ts test/uiResponsiveConstraints.test.ts`
Expected: FAIL（至少命中 1 条语义/主题/尺寸基线问题）

**Step 3: Write minimal implementation**

- 仅添加测试骨架与失败断言，不修业务代码。

**Step 4: Run test to verify baseline FAIL is stable**

Run: `node --test test/uiA11ySemantics.test.ts`
Expected: FAIL 且失败信息可读、可定位文件。

**Step 5: Commit**

```bash
git add test/uiA11ySemantics.test.ts test/uiThemeTokenUsage.test.ts test/uiResponsiveConstraints.test.ts
git commit -m "test(ui): add baseline failing checks for a11y/theme/responsive"
```

---

### Task 2: 修复 EvalHistory 的“Load 按钮无效”关键问题

**Files:**
- Modify: `src/pages/eval/EvalHistory.tsx`
- Modify: `src/pages/eval/EvalStore.tsx`（若缺少 load action）
- Test: `test/evalHistoryLoadAction.test.ts`

**Step 1: Write the failing test**

- 新建 `test/evalHistoryLoadAction.test.ts`，断言点击 `eval.history.load` 按钮会触发真实加载 action，而不是只 `onClose()`。
- 断言不再存在“未使用 dispatch”的死代码模式。

**Step 2: Run test to verify it fails**

Run: `node --test test/evalHistoryLoadAction.test.ts`
Expected: FAIL（当前 Load 仅关闭弹窗）

**Step 3: Write minimal implementation**

- 在 `EvalHistory.tsx` 中把 Load 按钮绑定到明确的 dispatch（例如 `LOAD_HISTORY_ENTRY`），并保留关闭行为为后置动作。
- 若 Store 缺 action，最小新增 reducer 分支。

**Step 4: Run test to verify it passes**

Run: `node --test test/evalHistoryLoadAction.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pages/eval/EvalHistory.tsx src/pages/eval/EvalStore.tsx test/evalHistoryLoadAction.test.ts
git commit -m "fix(ux): wire EvalHistory load action to real state update"
```

---

### Task 3: 修复弹层语义与焦点管理（Dialog 基线）

**Files:**
- Create: `src/components/useDialogA11y.ts`
- Modify: `src/components/SkillEditor.tsx`
- Modify: `src/pages/eval/EvalHistory.tsx`
- Modify: `src/pages/SkillsPage.tsx`（detail overlay）
- Modify: `src/pages/skills/SkillConflictDrawer.tsx`
- Test: `test/dialogAccessibility.test.ts`

**Step 1: Write the failing test**

- 精确断言基线：
  - `EvalHistory` 当前缺少 `role="dialog"` / `aria-modal="true"`。
  - `SkillEditor`、`SkillConflictDrawer`、`SkillsPage` detail overlay 已有 `role/aria-modal`，但缺 Escape 关闭与初始焦点管理。
- 目标断言（修复后）：四个弹层都满足 `role="dialog"`、`aria-modal="true"`、Escape 关闭、初始焦点落位、关闭后焦点返回触发元素。

**Step 2: Run test to verify it fails**

Run: `node --test test/dialogAccessibility.test.ts`
Expected: FAIL（至少命中 `EvalHistory` role 缺失与其余弹层键盘/焦点管理缺失）

**Step 3: Write minimal implementation**

- 抽取 `useDialogA11y`：处理 Escape、初始焦点、关闭后焦点回到触发元素。
- 仅为 `EvalHistory` 补齐缺失的 `role="dialog"` 与 `aria-modal="true"`。
- 为 `SkillEditor`、`SkillConflictDrawer`、`SkillsPage` detail overlay 接入键盘与焦点管理钩子（保留现有 dialog 语义）。

**Step 4: Run test to verify it passes**

Run: `node --test test/dialogAccessibility.test.ts && npm run lint`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/useDialogA11y.ts src/components/SkillEditor.tsx src/pages/eval/EvalHistory.tsx src/pages/SkillsPage.tsx src/pages/skills/SkillConflictDrawer.tsx test/dialogAccessibility.test.ts
git commit -m "fix(a11y): normalize dialog semantics and keyboard behavior"
```

---

### Task 4: 清除“可点击 div/伪按钮”交互债务

**Files:**
- Modify: `src/pages/eval/EvalSetup.tsx`
- Modify: `src/pages/eval/EvalHistory.tsx`
- Modify: `src/pages/SettingsPage.tsx`
- Modify: `src/pages/EvalPage.css`
- Modify: `src/pages/SettingsPage.css`
- Test: `test/interactiveSemantics.test.ts`

**Step 1: Write the failing test**

- 断言关键可交互容器不再使用 `div + onClick + role=button` 模式。
- 断言 stepper/history item/header toggles 使用原生 `button`。

**Step 2: Run test to verify it fails**

Run: `node --test test/interactiveSemantics.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- Eval stepper 条目改为 `button`。
- History item 外层改为 `button` 或 `article`+内部按钮。
- Settings 模型组折叠 header 改为 button。

**Step 4: Run test to verify it passes**

Run: `node --test test/interactiveSemantics.test.ts && npm run lint`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pages/eval/EvalSetup.tsx src/pages/eval/EvalHistory.tsx src/pages/SettingsPage.tsx src/pages/EvalPage.css src/pages/SettingsPage.css test/interactiveSemantics.test.ts
git commit -m "fix(a11y): replace clickable div patterns with semantic buttons"
```

---

### Task 5: 修复 Skills 页 tablist 语义与键盘行为

**Files:**
- Modify: `src/pages/SkillsPage.tsx`
- Modify: `src/pages/SkillsPage.css`
- Test: `test/skillsTablistA11y.test.ts`

**Step 1: Write the failing test**

- 断言 `role="tablist"` 下子项具备 `role="tab"`、`aria-selected`、键盘左右切换。

**Step 2: Run test to verify it fails**

Run: `node --test test/skillsTablistA11y.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 统一 tab 语义属性。
- 补 `onKeyDown` 处理箭头键循环切换。

**Step 4: Run test to verify it passes**

Run: `node --test test/skillsTablistA11y.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pages/SkillsPage.tsx src/pages/SkillsPage.css test/skillsTablistA11y.test.ts
git commit -m "fix(a11y): implement proper tablist semantics on Skills insight window switch"
```

---

### Task 6: 为关键输入补齐可访问标签

**Files:**
- Modify: `src/pages/SkillsPage.tsx`
- Modify: `src/components/OnboardingWizard.tsx`
- Modify: `src/pages/SettingsPage.tsx`
- Test: `test/formLabelCoverage.test.ts`

**Step 1: Write the failing test**

- 断言搜索框、路径输入框、关键配置输入具备 `<label htmlFor>` 或 `aria-label`。

**Step 2: Run test to verify it fails**

Run: `node --test test/formLabelCoverage.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 为 `skills search`、onboarding `skillsDir`、settings `skills path` 等补 label/id 绑定。

**Step 4: Run test to verify it passes**

Run: `node --test test/formLabelCoverage.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pages/SkillsPage.tsx src/components/OnboardingWizard.tsx src/pages/SettingsPage.tsx test/formLabelCoverage.test.ts
git commit -m "fix(a11y): add explicit labels for critical form controls"
```

---

### Task 7: 修复对比度风险（文本与状态色）

**Files:**
- Modify: `src/styles/tokens.css`
- Modify: `src/App.css`
- Modify: `src/pages/SettingsPage.css`
- Create: `test/colorContrastTokens.test.ts`

**Step 1: Write the failing test**

- 新增对比度测试脚本：对关键组合进行 ratio 校验（最少包含 `text-muted/status-bar`、`success on bg`）。

**Step 2: Run test to verify it fails**

Run: `node --test test/colorContrastTokens.test.ts`
Expected: FAIL（当前组合存在 <4.5）

**Step 3: Write minimal implementation**

- 调整 token：提升 `--text-muted`、success/danger 在浅背景下对比度。
- 避免组件内局部硬编码破坏 token 结果。

**Step 4: Run test to verify it passes**

Run: `node --test test/colorContrastTokens.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/styles/tokens.css src/App.css src/pages/SettingsPage.css test/colorContrastTokens.test.ts
git commit -m "fix(a11y): improve contrast ratios for muted/status semantic colors"
```

---

### Task 8: 去除关键路径中的硬编码颜色，统一 token

**Files:**
- Modify: `src/pages/eval/EvalScorecard.tsx`
- Modify: `src/pages/DashboardPage.tsx`
- Modify: `src/pages/SettingsPage.css`
- Modify: `src/pages/GitPage.css`
- Test: `test/themeTokenEnforcement.test.ts`

**Step 1: Write the failing test**

- 断言上述文件不再出现核心业务态色值字面量（允许 token 文件和必要 brand icon fill 例外白名单）。

**Step 2: Run test to verify it fails**

Run: `node --test test/themeTokenEnforcement.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 以语义变量替代：`--success`、`--warning`、`--danger`、`--chart-*`、`--text-*`。
- `EvalScorecard` 图表色值改为读取 CSS variables。

**Step 4: Run test to verify it passes**

Run: `node --test test/themeTokenEnforcement.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pages/eval/EvalScorecard.tsx src/pages/DashboardPage.tsx src/pages/SettingsPage.css src/pages/GitPage.css test/themeTokenEnforcement.test.ts
git commit -m "fix(theme): replace hardcoded UI colors with semantic tokens"
```

---

### Task 9: 清理 Eval 模块 i18n 硬编码文案

**Files:**
- Modify: `src/pages/eval/EvalSetup.tsx`
- Modify: `src/pages/eval/EvalRunning.tsx`
- Modify: `src/pages/eval/EvalResult.tsx`
- Modify: `src/pages/eval/EvalScorecard.tsx`
- Modify: `src/i18n/messages.ts`
- Test: `test/evalI18nCoverage.test.ts`

**Step 1: Write the failing test**

- 断言 Eval 子模块不存在中文硬编码提示词、状态词、统计词。

**Step 2: Run test to verify it fails**

Run: `node --test test/evalI18nCoverage.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 把全部文本迁移到 `messages.ts`，中英文双语补齐。
- 文案键命名按 `eval.*` 前缀统一。

**Step 4: Run test to verify it passes**

Run: `node --test test/evalI18nCoverage.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pages/eval/EvalSetup.tsx src/pages/eval/EvalRunning.tsx src/pages/eval/EvalResult.tsx src/pages/eval/EvalScorecard.tsx src/i18n/messages.ts test/evalI18nCoverage.test.ts
git commit -m "fix(i18n): remove hardcoded Chinese strings from eval flow"
```

---

### Task 10: 统一触控目标尺寸（>=44px）

**Files:**
- Modify: `src/styles/tokens.css`
- Modify: `src/styles/primitives.css`
- Modify: `src/pages/ToolsPage.css`
- Modify: `src/pages/GitPage.css`
- Modify: `src/pages/SkillsPage.css`
- Test: `test/targetSizeMinimum.test.ts`

**Step 1: Write the failing test**

- 断言全局按钮/输入基线高度 >=44。
- 针对 `.tool-switch`、`.git-ignore-expand` 等重点类加特判。

**Step 2: Run test to verify it fails**

Run: `node --test test/targetSizeMinimum.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 将 `--control-height` 提升为 `44px`。
- 调整局部 40/30/18px 控件，确保点击区域达标。

**Step 4: Run test to verify it passes**

Run: `node --test test/targetSizeMinimum.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/styles/tokens.css src/styles/primitives.css src/pages/ToolsPage.css src/pages/GitPage.css src/pages/SkillsPage.css test/targetSizeMinimum.test.ts
git commit -m "fix(a11y): enforce minimum 44px target size on interactive controls"
```

---

### Task 11: 响应式策略调整（大最小宽度收敛）

**Files:**
- Modify: `src/pages/SkillsPage.css`
- Modify: `src/pages/ToolsPage.css`
- Modify: `src/styles/tokens.css`
- Modify: `src/pages/LogsPage.css`
- Test: `test/responsiveLayoutConstraints.test.ts`

**Step 1: Write the failing test**

- 断言关键容器最小宽度不再固定为 420/520/540 等高阈值。
- 断言移动端断点前后布局可线性收缩。

**Step 2: Run test to verify it fails**

Run: `node --test test/responsiveLayoutConstraints.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- Skills/Tools 卡片网格最小列宽下调并使用 `clamp()`。
- Drawer 最小宽度改为视口相关策略，避免中小窗口拥挤。

**Step 4: Run test to verify it passes**

Run: `node --test test/responsiveLayoutConstraints.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pages/SkillsPage.css src/pages/ToolsPage.css src/styles/tokens.css src/pages/LogsPage.css test/responsiveLayoutConstraints.test.ts
git commit -m "fix(responsive): reduce rigid min-width constraints for mid-size viewports"
```

---

### Task 12: 提升日志页路径可读性（截断可恢复）

**Files:**
- Modify: `src/pages/LogsPage.tsx`
- Modify: `src/pages/LogsPage.css`
- Test: `test/logsPathReadability.test.ts`

**Step 1: Write the failing test**

- 断言 `cwd-cell` 截断文本可通过 `title` 或展开模式获取完整值。

**Step 2: Run test to verify it fails**

Run: `node --test test/logsPathReadability.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 为路径单元格添加 `title={log.cwd}`。
- 可选：添加点击展开行内全文视图。

**Step 4: Run test to verify it passes**

Run: `node --test test/logsPathReadability.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pages/LogsPage.tsx src/pages/LogsPage.css test/logsPathReadability.test.ts
git commit -m "fix(ux): make truncated log paths discoverable via full-path affordance"
```

---

### Task 13: 修复 EvalRunning 的 ref-in-render 与 lint 阻断

**Files:**
- Modify: `src/pages/eval/EvalRunning.tsx`
- Modify: `src/pages/eval/EvalStore.tsx`（如需）
- Test: `test/evalRunningProgressUx.test.ts`

**Step 1: Write the failing test**

- 扩展现有 `evalRunningProgressUx.test.ts`，约束阶段统计写入逻辑放在 effect/event，而非 render。

**Step 2: Run test to verify it fails**

Run: `npm run lint`
Expected: FAIL（当前已有 `react-hooks/refs` 错误）

**Step 3: Write minimal implementation**

- 将 `prevStageKey/stageStatsRef` 的读写迁入 `useEffect`。
- 保留渲染纯函数性质，避免副作用。

**Step 4: Run test to verify it passes**

Run: `npm run lint && node --test test/evalRunningProgressUx.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pages/eval/EvalRunning.tsx src/pages/eval/EvalStore.tsx test/evalRunningProgressUx.test.ts
git commit -m "fix(eval): move ref mutation out of render path in running stage view"
```

---

### Task 14: 大页面性能拆分（EvalPage/GitPage 第一阶段）

**Files:**
- Modify: `src/pages/EvalPage.tsx`
- Modify: `src/pages/GitPage.tsx`
- Create: `src/pages/eval/components/*`（按职责拆分）
- Create: `src/pages/git/components/*`（按职责拆分）
- Test: `test/evalPageStructure.test.ts`
- Test: `test/gitPageRepositoryFlow.test.ts`（更新断言）

**Step 1: Write the failing test**

- 新增结构测试：限制单文件状态数和 JSX 复杂度（字符串约束即可）。

**Step 2: Run test to verify it fails**

Run: `node --test test/evalPageStructure.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 将重型区块拆为子组件，主页面仅保留编排与状态桥接。
- 对高频列表渲染加 `useMemo`/`React.memo`。

**Step 4: Run test to verify it passes**

Run: `node --test test/evalPageStructure.test.ts test/gitPageRepositoryFlow.test.ts && npm run lint`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pages/EvalPage.tsx src/pages/GitPage.tsx src/pages/eval/components src/pages/git/components test/evalPageStructure.test.ts test/gitPageRepositoryFlow.test.ts
git commit -m "perf(ui): split large pages and reduce rerender pressure"
```

---

### Task 15: 视觉语言提升（低优先，避免 AI 模板感）

**Files:**
- Modify: `src/styles/tokens.css`
- Modify: `src/styles/primitives.css`
- Modify: `src/pages/DashboardPage.css`
- Modify: `src/components/SkillCard.css`
- Test: `test/visualSystemConsistency.test.ts`

**Step 1: Write the failing test**

- 断言关键页面存在更清晰层级差异（字号、间距、组件节奏）与非默认视觉 token。

**Step 2: Run test to verify it fails**

Run: `node --test test/visualSystemConsistency.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 优化标题层级、卡片节奏、图表高度策略、页面信息密度。
- 保持与现有品牌配色一致，不做破坏式重设计。

**Step 4: Run test to verify it passes**

Run: `node --test test/visualSystemConsistency.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/styles/tokens.css src/styles/primitives.css src/pages/DashboardPage.css src/components/SkillCard.css test/visualSystemConsistency.test.ts
git commit -m "polish(ui): improve hierarchy and rhythm to reduce template feel"
```

---

### Task 16: 全量回归与发布前验收

**Files:**
- Modify: `docs/release-handoff.md`
- Create: `docs/reports/2026-03-20-ui-ux-remediation-verification.md`

**Step 1: Write the failing test/checklist**

- 在验收报告中先列出“未通过项占位”。

**Step 2: Run full verification to expose failures**

Run: `npm run lint`
Run: `node --test test/*.test.ts`
Expected: 若仍有 FAIL，记录到报告。

**Step 3: Write minimal implementation/fixes**

- 处理剩余回归问题，直至全部通过。

**Step 4: Run final verification**

Run: `npm run lint && node --test test/*.test.ts`
Expected: PASS（lint 0 error，测试全绿）

**Step 5: Commit**

```bash
git add docs/release-handoff.md docs/reports/2026-03-20-ui-ux-remediation-verification.md
git commit -m "docs: add UI/UX remediation verification and release handoff notes"
```

---

## Manual QA Matrix (Must Pass)

- Keyboard only：可完成 Skills 搜索、Eval Step 切换、Settings 折叠展开、弹层开关。
- Screen reader：所有弹层播报 role/title 正确，关闭后焦点返回触发按钮。
- Contrast：关键文本和状态标签 >= 4.5:1（小文本场景）。
- Touch：移动端所有主交互控件 >= 44x44。
- Responsive：宽度 1280/1024/900/768/390 下无关键功能丢失。
- i18n：`zh-CN` 与 `en-US` 不出现混杂硬编码。
- Performance：Git 图/历史列表、Eval 运行态不卡顿，无明显输入延迟。

## Issue-To-Task Traceability

- CRIT-01 键盘不可达交互 -> Task 3 + Task 4 + Task 5 + Task 6
- CRIT-02 EvalHistory Load 失效 -> Task 2
- HIGH-01 弹层语义与焦点 -> Task 3
- HIGH-02 tablist 不完整 -> Task 5
- HIGH-03 缺少 label -> Task 6
- HIGH-04 i18n 硬编码 -> Task 9
- HIGH-05 对比度风险 -> Task 7
- MED-01 触控尺寸 -> Task 10
- MED-02 颜色 token 化不足 -> Task 8
- MED-03 响应式最小宽度问题 -> Task 11
- MED-04 大组件性能风险 -> Task 13 + Task 14
- MED-05 日志路径可读性 -> Task 12
- LOW-01 视觉模板感 -> Task 15
- LOW-02 图表高度弹性 -> Task 15

## Suggested Execution Order

1. Task 1-4（先清关键功能和语义）
2. Task 5-9（高优先可访问性与主题一致性）
3. Task 10-12（中优先交互与响应式）
4. Task 13-14（性能与架构）
5. Task 15-16（视觉优化与收口验收）

Plan complete and saved to `docs/plans/2026-03-20-ui-ux-audit-remediation-checklist.md`. Two execution options:

1. Subagent-Driven (this session) - I dispatch fresh subagent per task, review between tasks, fast iteration
2. Parallel Session (separate) - Open new session with executing-plans, batch execution with checkpoints

Which approach?
