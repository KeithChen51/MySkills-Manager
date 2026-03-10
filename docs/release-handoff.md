# Release + Gitee Handoff Workflow

This project supports a two-target release workflow:

1. Sync release assets to GitHub (for public updater endpoint).
2. Generate a Gitee-ready offline package in `gitee-ver` for manual upload on a company machine.

## Prerequisites

- Build updater artifacts locally first:

```bash
npm run build:desktop:windows:update
```

- Ensure GitHub CLI is installed and logged in (`gh auth status`).

## One-command flow

```bash
npm run release:windows:update:all
```

This command runs:

1. `build:desktop:windows:update`
2. `release:sync:github`
3. `pack:gitee`

## GitHub sync only

```bash
npm run release:sync:github
```

It will:

- Ensure release tag `v<package.json version>` exists.
- Generate `release/latest.json` with GitHub download URLs.
- Upload the following assets with `--clobber`:
  - `release/Skillar.exe`
  - `release/Skillar_<version>_x64-setup.exe`
  - `release/Skillar_<version>_x64-setup.exe.sig`
  - `release/latest.json`

## Gitee offline package only

```bash
npm run pack:gitee
```

Default output directory:

- `<workspace-parent>/gitee-ver`

Override output directory:

```bash
set GITEE_SYNC_DIR=C:\Own Docm\Coding\My-Skills\gitee-ver
npm run pack:gitee
```

Generated files:

- `Skillar.exe`
- `Skillar_<version>_x64-setup.exe`
- `Skillar_<version>_x64-setup.exe.sig`
- `latest.json` (Gitee updater manifest)
- `MySkills-Manager-v<version>-source.zip`

## Gitee updater URL settings

Set one of:

- `GITEE_RELEASE_BASE_URL` (full base URL), or
- `GITEE_REPO` (like `your-org/your-repo`)

Example:

```bash
set GITEE_REPO=your-org/your-repo
npm run pack:gitee
```

Then `latest.json` URLs become:

- `https://gitee.com/your-org/your-repo/releases/download/v<version>/<installer>`
