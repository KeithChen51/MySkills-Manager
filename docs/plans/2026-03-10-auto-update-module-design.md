# MySkills Manager Auto-Update Module Design (Cockpit-Tools Inspired)

**Date:** 2026-03-10  
**Goal:** Upgrade current Tauri updater usage from manual-only flow to a complete update system with auto-check, optional silent download, version-jump release notes, and a reliable GitHub + Gitee release pipeline.

---

## 1. Current State vs Gaps

### Already available
- Manual update flow in [`src/pages/SettingsPage.tsx`](/Users/Keith/.codex/worktrees/a97b/myskills-manager/src/pages/SettingsPage.tsx) using `check()` + `downloadAndInstall()`.
- Tauri updater plugin initialized in [`src-tauri/src/lib.rs`](/Users/Keith/.codex/worktrees/a97b/myskills-manager/src-tauri/src/lib.rs).
- Release scripts already generate and sync updater artifacts (`latest.json`, setup exe, `.sig`) for GitHub and Gitee packaging.

### Missing pieces
- Startup auto-check with interval gating.
- Silent background download mode (`auto_install`) with unified state handling.
- Persistent update settings (`auto_check`, `auto_install`, `check_interval_hours`, `last_check_time`).
- Post-upgrade "version jump" changelog display.
- Unified update logging pipeline across frontend and backend.

---

## 2. What to Borrow from Cockpit-Tools

From cockpit-tools, the most useful patterns are:
- A persisted backend `UpdateSettings` model.
- A single frontend update state machine: `hidden | available | downloading | ready`.
- Startup update flow that branches by settings (`auto_check`, `auto_install`).
- Retry/backoff for retryable network errors, but immediate fail for non-retryable errors.
- Cached pending release notes used by `check_version_jump` after app restart.

This removes fragmented update logic and gives one consistent path for manual and auto updates.

---

## 3. Target Architecture for This Repo

### 3.1 Backend (Rust, new module)

Create [`src-tauri/src/update_checker.rs`](/Users/Keith/.codex/worktrees/a97b/myskills-manager/src-tauri/src/update_checker.rs) with:

- `UpdateSettings`
  - `auto_check: bool` (default `true`)
  - `check_interval_hours: u64` (default `6`)
  - `auto_install: bool` (default `false`)
  - `last_check_time: u64`
  - `last_run_version: String`
- `PendingUpdateNotes`
  - `version`
  - `release_notes`
  - `release_notes_zh`

Add tauri commands and register in [`src-tauri/src/lib.rs`](/Users/Keith/.codex/worktrees/a97b/myskills-manager/src-tauri/src/lib.rs):
- `get_update_settings`
- `save_update_settings`
- `should_check_updates`
- `update_last_check_time`
- `save_pending_update_notes`
- `check_version_jump`
- `update_log`

Persistence location:
- `%LOCALAPPDATA%/Skillar/update_settings.json`
- `%LOCALAPPDATA%/Skillar/pending_update_notes.json`

### 3.2 Frontend Update Domain (new hook)

Create [`src/updater/useAppUpdater.ts`](/Users/Keith/.codex/worktrees/a97b/myskills-manager/src/updater/useAppUpdater.ts):

- State
  - `UpdateAction` (`hidden | available | downloading | ready`)
  - `progress`, `retryStatus`, `error`, `errorDetails`
- Actions
  - `startupCheck()`
  - `manualCheck()`
  - `downloadUpdate()`
  - `cancelDownload()`
  - `restartAndApply()`
- Dependencies
  - `@tauri-apps/plugin-updater` (`check`, `download`, `install`)
  - `@tauri-apps/plugin-process` (`relaunch`)
  - Retry utility (same model as cockpit-tools)

### 3.3 Page integration

- [`src/App.tsx`](/Users/Keith/.codex/worktrees/a97b/myskills-manager/src/App.tsx)
  - Run `startupCheck()` after initial boot delay (5-8s).
  - If `auto_install=true`, silently download and move to `ready`.
  - If `auto_install=false`, show update dialog and let user decide.
  - Run `check_version_jump` on startup to show changelog after successful upgrade.

- [`src/pages/SettingsPage.tsx`](/Users/Keith/.codex/worktrees/a97b/myskills-manager/src/pages/SettingsPage.tsx)
  - Keep manual check button.
  - Add toggles for `auto_check`, `auto_install`.
  - Add interval selector (`1h`, `6h`, `24h`).
  - Persist settings through new tauri API wrappers in [`src/api/tauri.ts`](/Users/Keith/.codex/worktrees/a97b/myskills-manager/src/api/tauri.ts).

---

## 4. Release + Updater Contract (GitHub and Gitee)

Current scripts already fit the target flow:
- [`scripts/sync-github-release.mjs`](/Users/Keith/.codex/worktrees/a97b/myskills-manager/scripts/sync-github-release.mjs)
- [`scripts/prepare-gitee-package.mjs`](/Users/Keith/.codex/worktrees/a97b/myskills-manager/scripts/prepare-gitee-package.mjs)

Required artifact contract for updater:
- `Skillar_<version>_x64-setup.exe`
- `Skillar_<version>_x64-setup.exe.sig`
- `latest.json`

`latest.json` must always satisfy:
- `version` matches installer version
- `platforms.windows-x86_64` (and `windows-x86_64-nsis`) contain valid `url` + `signature`
- `pub_date` is ISO8601

---

## 5. Channel Strategy

### Phase A (ship first)
- Keep current GitHub updater endpoint as primary.
- Deliver full in-app update UX (auto-check, silent download, version-jump notes).
- Keep Gitee as mirror/offline upload workflow for company environment.

### Phase B (dual channel)
- Validate updater behavior for multi-endpoint fallback in current Tauri version.
- If stable, configure both GitHub and Gitee endpoints.
- If not stable, use dual build variants (GitHub build and Gitee build).

---

## 6. Suggested Execution Order

1. Backend settings + command layer + Rust unit tests.
2. Frontend `useAppUpdater` hook and shared state machine.
3. Settings UI controls and i18n keys.
4. Startup flow + version jump modal wiring in `App.tsx`.
5. Release contract check script for `latest.json` integrity.
6. End-to-end verification: no update, update available, network failure, signature issue, post-upgrade first launch.

---

## 7. Acceptance Criteria

- Auto-check runs on startup according to configured interval.
- Silent mode downloads updates in background and reaches `ready` state.
- Manual and auto flows share the same update state and error surface.
- First launch after upgrade can show release notes for the jumped version.
- GitHub and Gitee updater metadata both pass integrity checks and can be consumed by client updater logic.

