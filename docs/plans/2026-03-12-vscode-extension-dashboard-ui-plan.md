# VS Code Dashboard UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a dedicated graphical dashboard for the Skillar VS Code extension that can be shown in the sidebar and opened beside the editor.

**Architecture:** Keep the existing tree view as-is, add a new webview-based dashboard view (`skillarDashboard`) in Explorer, and add commands to open the same dashboard in an editor-side panel (right side). Reuse existing skills scanning logic to ensure one data source.

**Tech Stack:** VS Code extension API, TypeScript, existing `scanSkills` and config resolution flow.

---

### Task 1: Add failing tests for dashboard UI behavior

**Files:**
- Create: `vscode-extension/test/dashboardHtml.test.ts`
- Modify: `vscode-extension/test/packaging.test.ts`

**Step 1: Write failing tests**
- Assert dashboard HTML renders skills, escapes unsafe content, and supports empty state.
- Assert `package.json` contributes `skillar.openDashboard`, `skillar.openDashboardBeside`, and `skillarDashboard` view.

**Step 2: Run tests to verify failures**

Run: `npm test --prefix vscode-extension`  
Expected: `dashboardHtml` module missing and manifest assertion failures.

### Task 2: Implement dashboard webview model and HTML

**Files:**
- Create: `vscode-extension/src/dashboardHtml.ts`

**Step 1: Implement minimal HTML generator**
- Export `createDashboardHtml`.
- Render root path, skill list cards, actions (`refresh`, `openFolder`, `openSkill`), and empty-state text.
- Escape user/file content.

**Step 2: Keep actions message-based**
- Post messages to extension host from webview buttons.

### Task 3: Wire dashboard in extension activation

**Files:**
- Modify: `vscode-extension/src/extension.ts`
- Modify: `vscode-extension/package.json`

**Step 1: Register dashboard sidebar view provider**
- Add `skillarDashboard` webview view in Explorer.

**Step 2: Register panel commands**
- `skillar.openDashboard`: open in active editor group.
- `skillar.openDashboardBeside`: open in side group.

**Step 3: Reuse one state loader**
- Load skills from same `skillar.skillsRoot` and update both tree and dashboard.
- Keep command handlers for folder open and readme open consistent.

### Task 4: Verify and package readiness

**Files:**
- Modify: `vscode-extension/README.md` (if needed for usage notes)

**Step 1: Run extension tests**

Run: `npm test --prefix vscode-extension`  
Expected: all tests pass.

**Step 2: Build extension**

Run: `npm run build --prefix vscode-extension`  
Expected: TypeScript build passes.
