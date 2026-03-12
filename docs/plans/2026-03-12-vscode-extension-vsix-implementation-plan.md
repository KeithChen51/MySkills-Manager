# Skillar VS Code Extension (VSIX) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a VS Code extension for Skillar that users can install directly from a `.vsix` package.

**Architecture:** Create a standalone `vscode-extension` workspace. The extension scans a configured `my-skills` folder, renders a tree in VS Code Explorer, supports opening skill folders/`SKILL.md`, and packages with `vsce` to `release/skillar-vscode.vsix`.

**Tech Stack:** TypeScript, VS Code Extension API, Node.js `node:test`, `tsx`, `@vscode/vsce`.

---

## Tasks

1. Scaffold `vscode-extension` with scripts, TypeScript config, and packaging metadata.
2. Add failing tests for frontmatter parsing, skill scanning, view model mapping, and package script presence.
3. Implement minimal modules (`skills.ts`, `presentation.ts`) to satisfy tests.
4. Implement extension activation, commands, and Tree Data Provider.
5. Add root scripts (`vscode:build`, `vscode:test`, `vscode:package`) for one-command execution.
6. Verify with `npm run vscode:test`, `npm run vscode:build`, `npm run vscode:package` and ensure VSIX output exists.