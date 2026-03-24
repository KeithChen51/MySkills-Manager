import { useState } from "react";

import type { SkillMeta } from "../api/tauri";
import { useI18n } from "../i18n/I18nProvider";
import SkillsPage from "./SkillsPage";
import ToolsPage from "./ToolsPage";
import "./SkillToolsPage.css";

type Props = {
  skills: SkillMeta[];
  onRefresh: () => void;
};

type SkillToolsTab = "skills" | "tools";

export default function SkillToolsPage({ skills, onRefresh }: Props) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<SkillToolsTab>("skills");
  const skillsTabId = "skill-tools-tab-skills";
  const toolsTabId = "skill-tools-tab-tools";
  const skillsPanelId = "skill-tools-panel-skills";
  const toolsPanelId = "skill-tools-panel-tools";

  return (
    <div className="skill-tools-shell">
      <div className="skill-tools-tabs" role="tablist" aria-label={t("skillsTools.tab.aria")}>
        <button
          id={skillsTabId}
          type="button"
          role="tab"
          aria-selected={activeTab === "skills"}
          aria-controls={skillsPanelId}
          className={`skill-tools-tab ${activeTab === "skills" ? "active" : ""}`}
          onClick={() => setActiveTab("skills")}
        >
          {t("skillsTools.tab.skills")}
        </button>
        <button
          id={toolsTabId}
          type="button"
          role="tab"
          aria-selected={activeTab === "tools"}
          aria-controls={toolsPanelId}
          className={`skill-tools-tab ${activeTab === "tools" ? "active" : ""}`}
          onClick={() => setActiveTab("tools")}
        >
          {t("skillsTools.tab.tools")}
        </button>
      </div>

      <section
        id={skillsPanelId}
        role="tabpanel"
        aria-labelledby={skillsTabId}
        className={`skill-tools-pane ${activeTab === "skills" ? "is-active" : ""}`}
        aria-hidden={activeTab !== "skills"}
      >
        <SkillsPage skills={skills} onRefresh={onRefresh} />
      </section>

      <section
        id={toolsPanelId}
        role="tabpanel"
        aria-labelledby={toolsTabId}
        className={`skill-tools-pane ${activeTab === "tools" ? "is-active" : ""}`}
        aria-hidden={activeTab !== "tools"}
      >
        <ToolsPage />
      </section>
    </div>
  );
}
