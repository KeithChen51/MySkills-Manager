import { useState } from "react";

import type { ToolRouterHealthStatus, ToolStatus } from "../../api/tauri";
import { IconFolder } from "../../components/icons";
import ToolLogo from "../../components/ToolLogo";
import { formatLastSyncTime } from "../../domain/lastSyncTime";
import { buildToolPathDiagnostics } from "../../domain/toolPathDiagnostics";
import type { MessageKey } from "../../i18n/messages";
import type { PathPickerTarget, ToolPathDraft } from "../toolsPathPicker";

type TranslateFn = (
  key: MessageKey,
  params?: Record<string, string | number>,
) => string;

type ToolCardProps = {
  tool: ToolStatus;
  routerHealth?: ToolRouterHealthStatus;
  installed: boolean;
  draft: ToolPathDraft;
  hasPathChange: boolean;
  busy: boolean;
  savingCurrentTool: boolean;
  syncingCurrentTool: boolean;
  togglingAutoCurrentTool: boolean;
  togglingTrackingCurrentTool: boolean;
  skillsDirConfigured: boolean;
  locale: string;
  t: TranslateFn;
  onDraftChange: (next: ToolPathDraft) => void;
  onPickToolPath: (target: PathPickerTarget) => void;
  onManualSync: () => void;
  onToggleAutoSync: () => void;
  onToggleTracking: () => void;
  onSaveToolPaths: () => void;
  onRemoveCustomTool: () => void;
};

function pathSourceLabel(
  source: string,
  t: TranslateFn,
) {
  switch (source) {
    case "override":
      return t("tools.pathSource.override");
    case "auto-detected":
      return t("tools.pathSource.autoDetected");
    case "custom":
      return t("tools.pathSource.custom");
    default:
      return t("tools.pathSource.default");
  }
}

function healthBadgeClass(health: string) {
  if (health === "healthy") {
    return "ok";
  }
  if (health === "broken") {
    return "warn";
  }
  return "neutral";
}

function healthLabel(health: string, t: TranslateFn) {
  if (health === "healthy") {
    return t("tools.routerHealth.healthy");
  }
  if (health === "broken") {
    return t("tools.routerHealth.broken");
  }
  return t("tools.routerHealth.degraded");
}

export default function ToolCard({
  tool,
  routerHealth,
  installed,
  draft,
  hasPathChange,
  busy,
  savingCurrentTool,
  syncingCurrentTool,
  togglingAutoCurrentTool,
  togglingTrackingCurrentTool,
  skillsDirConfigured,
  locale,
  t,
  onDraftChange,
  onPickToolPath,
  onManualSync,
  onToggleAutoSync,
  onToggleTracking,
  onSaveToolPaths,
  onRemoveCustomTool,
}: ToolCardProps) {
  const [pathsOpen, setPathsOpen] = useState(false);
  const { skillsPathHealthy, rulesPathHealthy, skillsPathLabel, rulesPathLabel } =
    buildToolPathDiagnostics(tool);
  const healthNeedsFix = routerHealth && routerHealth.health !== "healthy";

  return (
    <article key={tool.id} className={`tool-card ${installed ? "" : "tool-card-uninstalled"}`.trim()}>
      <header className="tool-card-header">
        <div className="tool-card-identity">
          <ToolLogo id={tool.id} name={tool.name} icon={tool.icon} />
          <div className="tool-card-title-wrap">
            <div className="tool-card-title-row">
              <h3 className="tool-card-title">{tool.name}</h3>
              <span className={`tool-card-badge ${installed ? "ok" : "neutral"}`}>
                {installed ? t("tools.status.detected") : t("tools.status.notDetected")}
              </span>
              {tool.syncMode !== "none" && (
                <span className="tool-card-badge neutral">{tool.syncMode.toUpperCase()}</span>
              )}
              {tool.isCustom && <span className="tool-card-badge neutral">{t("tools.custom")}</span>}
            </div>
            <p className="tool-card-id">ID: {tool.id}</p>
          </div>
        </div>
        <div className="tool-card-toggles">
          <div className="tool-card-toggle-wrap">
            <span className="tool-switch-label">{t("tools.auto.toggle")}</span>
            <button
              type="button"
              className={`tool-switch ${tool.autoSync ? "active" : ""}`}
              aria-pressed={tool.autoSync}
              aria-label={t("tools.aria.autoToggle", { tool: tool.name })}
              onClick={onToggleAutoSync}
              disabled={busy || togglingAutoCurrentTool}
            >
              <span className="tool-switch-thumb" />
            </button>
          </div>
          <div className="tool-card-toggle-wrap">
            <span className="tool-switch-label">{t("tools.tracking.toggle")}</span>
            <button
              type="button"
              className={`tool-switch ${tool.trackingEnabled ? "active" : ""}`}
              aria-pressed={tool.trackingEnabled}
              aria-label={t("tools.aria.trackingToggle", { tool: tool.name })}
              onClick={onToggleTracking}
              disabled={busy || togglingTrackingCurrentTool}
            >
              <span className="tool-switch-thumb" />
            </button>
          </div>
        </div>
      </header>

      <div className="tool-card-divider" />

      <details
        className="tool-paths-accordion"
        open={pathsOpen}
        onToggle={(event) => setPathsOpen((event.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="tool-paths-summary">{t("tools.path.section")}</summary>
        <div className="tool-card-paths">
          <label className="tool-path-field">
            <span className="tool-path-label">{t("tools.path.rules")}</span>
            <div className="tool-path-row">
              <input
                className="field-input tools-path-input"
                value={draft.rulesPath}
                onChange={(e) =>
                  onDraftChange({ ...draft, rulesPath: e.target.value })
                }
                placeholder="C:\\Users\\Keith\\.codex\\AGENTS.md"
              />
              <button
                type="button"
                className="tool-path-picker"
                onClick={() => onPickToolPath("rules")}
                disabled={busy || savingCurrentTool}
                title={t("tools.path.pickFile")}
                aria-label={t("tools.path.pickFile")}
              >
                <IconFolder size={15} />
              </button>
            </div>
          </label>

          <label className="tool-path-field">
            <span className="tool-path-label">{t("tools.path.skills")}</span>
            <div className="tool-path-row">
              <input
                className="field-input tools-path-input"
                value={draft.skillsDir}
                onChange={(e) =>
                  onDraftChange({ ...draft, skillsDir: e.target.value })
                }
                placeholder="C:\\Users\\Keith\\.codex\\skills"
              />
              <button
                type="button"
                className="tool-path-picker"
                onClick={() => onPickToolPath("skills")}
                disabled={busy || savingCurrentTool}
                title={t("tools.path.pickDir")}
                aria-label={t("tools.path.pickDir")}
              >
                <IconFolder size={15} />
              </button>
            </div>
          </label>
        </div>
      </details>

      <footer className="tool-card-footer">
        <div className="tool-card-meta">
          <span>{t("tools.syncedSkills")}: {tool.syncedSkills}</span>
          <span>{t("tools.syncMode")}: {tool.syncMode}</span>
          <span>{t("tools.integrationMode", { mode: tool.integrationMode })}</span>
          <span>{t("tools.pathSource")}: {pathSourceLabel(tool.pathSource, t)}</span>
          <span>
            {t("tools.lastSync")}:{" "}
            {formatLastSyncTime(tool.lastSyncTime, locale, t("tools.lastSync.never"))}
          </span>
        </div>

        <div className="tool-card-flags">
          {routerHealth && (
            <span
              className={`tool-card-badge ${healthBadgeClass(routerHealth.health)}`}
              title={routerHealth.reason}
            >
              {healthLabel(routerHealth.health, t)}
            </span>
          )}
          <span className={`tool-card-badge ${tool.configured ? "ok" : "warn"}`}>
            {tool.configured ? t("tools.flag.rulesOk") : t("tools.flag.rulesMissing")}
          </span>
          <span className={`tool-card-badge ${skillsPathHealthy ? "ok" : "warn"}`}>
            {skillsPathLabel}
          </span>
          <span className={`tool-card-badge ${rulesPathHealthy ? "ok" : "warn"}`}>
            {rulesPathLabel}
          </span>
          {tool.id === "claude-code" && (
            <span className={`tool-card-badge ${tool.hookConfigured ? "ok" : "warn"}`}>
              {tool.hookConfigured ? t("tools.flag.hookOk") : t("tools.flag.hookMissing")}
            </span>
          )}
        </div>
      </footer>

      <div className={`tool-card-health-actions ${healthNeedsFix ? "" : "is-placeholder"}`.trim()} aria-hidden={!healthNeedsFix}>
        {healthNeedsFix ? (
          <>
            <button
              type="button"
              className="btn btn-ghost tool-card-action-btn"
              onClick={onManualSync}
              disabled={busy || syncingCurrentTool}
            >
              {t("tools.routerHealth.reapply")}
            </button>
            <button
              type="button"
              className="btn btn-ghost tool-card-action-btn"
              onClick={() => setPathsOpen(true)}
              disabled={busy || savingCurrentTool}
            >
              {t("tools.routerHealth.openPath")}
            </button>
            <span className="tool-card-health-reason">{routerHealth.reason}</span>
          </>
        ) : (
          <span className="tool-card-health-placeholder" />
        )}
      </div>

      <div className="tool-card-actions">
        {installed && (
          <button
            type="button"
            className="btn btn-primary tool-card-action-btn"
            onClick={onManualSync}
            disabled={busy || syncingCurrentTool}
          >
            {syncingCurrentTool ? t("tools.manual.syncing") : t("tools.manual.button")}
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost tool-card-action-btn"
          onClick={onSaveToolPaths}
          disabled={busy || savingCurrentTool || !hasPathChange || !skillsDirConfigured}
        >
          {savingCurrentTool ? t("tools.path.saving") : t("tools.path.save")}
        </button>
        {tool.isCustom && (
          <button
            className="btn btn-ghost tool-card-action-btn"
            onClick={onRemoveCustomTool}
            disabled={busy || savingCurrentTool}
          >
            {t("tools.remove")}
          </button>
        )}
      </div>
    </article>
  );
}
