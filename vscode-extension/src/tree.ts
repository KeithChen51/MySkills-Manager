import * as vscode from "vscode";

import { createSkillViewItems } from "./presentation";
import type { SkillItem } from "./skills";

export class SkillTreeItem extends vscode.TreeItem {
  readonly folderPath: string;
  readonly skillMdPath: string;

  constructor(label: string, description: string, folderPath: string, skillMdPath: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.folderPath = folderPath;
    this.skillMdPath = skillMdPath;
    this.description = undefined;
    const markdownTooltip = new vscode.MarkdownString(undefined, true);
    markdownTooltip.appendMarkdown(`**${label}**\n\n`);
    if (description.trim()) {
      markdownTooltip.appendMarkdown(`${description.trim()}\n\n`);
    }
    markdownTooltip.appendMarkdown(`\`${skillMdPath}\``);
    this.tooltip = markdownTooltip;
    this.command = {
      command: "skillar.openSkillReadme",
      title: "Open Skill README",
      arguments: [this],
    };
    this.contextValue = "skillar.skillItem";
  }
}

export class ActionTreeItem extends vscode.TreeItem {
  constructor(label: string, commandId: string, tooltip?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.command = {
      command: commandId,
      title: label,
    };
    this.tooltip = tooltip ?? label;
    this.description = "Open";
    this.contextValue = "skillar.actionItem";
  }
}

export type SkillarTreeItem = SkillTreeItem | ActionTreeItem;

export class SkillsTreeDataProvider implements vscode.TreeDataProvider<SkillarTreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<SkillarTreeItem | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private items: SkillarTreeItem[] = [];

  setSkills(skills: SkillItem[]): void {
    const actionItems: SkillarTreeItem[] = [
      new ActionTreeItem(
        "Git Source Control",
        "skillar.openGitView",
        "Open VS Code Source Control view",
      ),
    ];
    const skillItems = createSkillViewItems(skills).map(
      (item) => new SkillTreeItem(item.label, item.description, item.folderPath, item.skillMdPath),
    );
    this.items = [...actionItems, ...skillItems];
    this.refresh();
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  getTreeItem(element: SkillarTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): SkillarTreeItem[] {
    return this.items;
  }
}
