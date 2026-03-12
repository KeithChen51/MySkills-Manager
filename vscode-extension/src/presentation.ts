import type { SkillItem } from "./skills";

export interface SkillViewItem {
  label: string;
  description: string;
  folderPath: string;
  skillMdPath: string;
}

export function createSkillViewItems(skills: SkillItem[]): SkillViewItem[] {
  return skills.map((skill) => ({
    label: skill.name,
    description: skill.description,
    folderPath: skill.folderPath,
    skillMdPath: skill.skillMdPath,
  }));
}
