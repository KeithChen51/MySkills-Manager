# Skillar VS Code Extension

This extension lets you browse and open skills from your local `my-skills` directory, with a built-in Git dashboard.

## Commands

- `Skillar: Open My Skills Folder`
- `Skillar: Refresh Skills Index`
- `Skillar: Open Skill README`
- `Skillar: Open Git Dashboard`

## View

- Only one Skillar view is used in the Activity Bar.
- The view is a graphical dashboard (`webview`) with Chinese UI by default.
- Use the Skills tab for browsing skills and opening `SKILL.md`.
- Use the Git tab for branch status, changed/staged/untracked files, commit, and push.
- The Activity Bar icon uses `media/skillar-activity-logo.png`.
- The extension icon uses `media/skillar-icon-centered-light.png`.

## Configuration

- `skillar.skillsRoot`: path to your local `my-skills` root directory. Default: `~/my-skills`.

## Package

```bash
npm install
npm run package
```

The VSIX output is written to `../release/skillar-vscode.vsix`.

## Install From VSIX

1. Open VS Code.
2. Open Extensions view (`Ctrl+Shift+X`).
3. Click the top-right `...` menu.
4. Select `Install from VSIX...`.
5. Choose `release/skillar-vscode.vsix`.
