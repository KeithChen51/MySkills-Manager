# GitHub Release + Gitee Offline Handoff Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow one local workflow to publish/update GitHub Release assets while also preparing Gitee-ready source + updater artifacts for offline transfer.

**Architecture:** Keep existing Windows build flow, extend local packaging scripts to generate updater `latest.json` and copy installer/signature into `gitee-ver`, then add a GitHub Release sync script that uploads current release artifacts non-interactively via `gh`.

**Tech Stack:** Node.js ESM scripts, Tauri updater artifacts, GitHub CLI (`gh`), Node test runner (`tsx --test`).

---

### Task 1: Add failing tests for updater metadata and base URL resolution

**Files:**
- Modify: `test/giteePackageScript.test.ts`

**Step 1: Write failing tests**

Add tests asserting:
- Gitee updater base URL derives from `GITEE_RELEASE_BASE_URL` or `GITEE_REPO`.
- Generated `latest.json` contains `windows-x86_64` and `windows-x86_64-nsis`.
- Signature and encoded installer URL are embedded correctly.

**Step 2: Run tests to verify failure**

Run: `npx tsx --test test/giteePackageScript.test.ts`
Expected: FAIL for missing exports/helpers.

### Task 2: Implement `latest.json` generation in Gitee packaging script

**Files:**
- Modify: `scripts/prepare-gitee-package.mjs`

**Step 1: Add minimal implementation**

Implement helpers and integrate into `prepareGiteePackage`:
- detect installer/signature artifacts
- resolve Gitee download base URL
- build and write `latest.json` in `gitee-ver`
- keep existing source zip behavior

**Step 2: Run tests**

Run: `npx tsx --test test/giteePackageScript.test.ts`
Expected: PASS.

### Task 3: Add GitHub release sync script with deterministic asset upload

**Files:**
- Create: `scripts/sync-github-release.mjs`
- Create: `test/githubReleaseSyncScript.test.ts`
- Modify: `package.json`

**Step 1: Write failing tests**

Add tests for pure helper behavior:
- repo slug parsing
- upload asset list generation (includes `latest.json`, installer, `.sig`, launcher)

**Step 2: Run tests to verify failure**

Run: `npx tsx --test test/githubReleaseSyncScript.test.ts`
Expected: FAIL due missing script exports.

**Step 3: Implement minimal script**

Implement non-interactive flow:
- read version from `package.json`
- ensure release exists for `v<version>` (create if missing)
- upload assets from `release/` using `gh release upload --clobber`

**Step 4: Wire npm scripts**

Add scripts:
- `release:sync:github`
- `release:sync:github-and-pack:gitee` (chains GitHub sync + Gitee prep)

### Task 4: Verify end-to-end script contract

**Files:**
- Modify: `README.md`

**Step 1: Document command and environment variables**

Document required env vars:
- `GITEE_REPO` or `GITEE_RELEASE_BASE_URL`
- `GITEE_SYNC_DIR` (optional override)

**Step 2: Run focused verification**

Run:
- `npx tsx --test test/giteePackageScript.test.ts test/githubReleaseSyncScript.test.ts`

Expected: PASS.

Run:
- `npm run lint` (if fast enough in environment)

Expected: PASS or report existing unrelated failures.
