# Skillar Bundled VSIX Install Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add one-click VS Code extension installation inside Skillar by bundling the VSIX into the desktop app and ensuring VS Code extension data path matches Skillar skills directory.

**Architecture:** During desktop packaging, generate VSIX and copy it into `src-tauri/resources`. Tauri backend exposes a command that resolves bundled VSIX, installs with VS Code CLI, and updates VS Code user settings `skillar.skillsRoot` to Skillar current skills directory. Settings page adds an install button that triggers this command.

**Tech Stack:** Tauri (Rust), React + TypeScript, Node scripts, Node test runner (`tsx --test`), Rust unit tests.

---

### Task 1: Packaging pipeline and resource embedding

**Files:**
- Create: `scripts/prepare-vscode-vsix-resource.mjs`
- Modify: `package.json`
- Modify: `src-tauri/tauri.conf.json`
- Test: `test/vscodeVsixResourceScript.test.ts`

**Steps:** write failing script test -> run test (fail) -> implement copy script and build script wiring -> rerun test (pass).

### Task 2: Backend install command and VS Code settings sync

**Files:**
- Create: `src-tauri/src/vscode_extension.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/vscode_extension.rs` (unit tests)

**Steps:** add failing Rust tests for settings sync and CLI fallback behavior -> run targeted cargo test (fail) -> implement command + helpers -> rerun cargo test (pass).

### Task 3: Frontend API + Settings UI action

**Files:**
- Modify: `src/api/tauri.ts`
- Modify: `src/pages/SettingsPage.tsx`
- Modify: `src/i18n/messages.ts`
- Test: `test/settingsVscodeInstallIntegration.test.ts`

**Steps:** add failing UI/API integration test -> run node tests (fail) -> implement API function, status handling, button & i18n -> rerun tests (pass).

### Task 4: End-to-end verification

**Files:**
- Verify only

**Steps:** run `npm run vscode:test`, `npm run test -- test/vscodeVsixResourceScript.test.ts`, `cargo test --manifest-path src-tauri/Cargo.toml vscode_extension`, and `npm run vscode:package`; confirm VSIX resource is bundled and installation command is callable.
