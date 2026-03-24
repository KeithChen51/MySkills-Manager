import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type SetupApplyResult, type ToolRouterHealthStatus, type ToolStatus } from "../api/tauri";
import { IconClose, IconPlus, IconRefresh } from "../components/icons";
import { useI18n } from "../i18n/I18nProvider";
import { type ToolPathDraft } from "./toolsPathPicker";
import CustomToolFormCard from "./tools/CustomToolFormCard";
import ToolSection from "./tools/ToolSection";
import { EMPTY_CUSTOM_TOOL_FORM, type CustomToolForm } from "./tools/customToolForm";
import { useToolsPageActions } from "./tools/useToolsPageActions";
import "./ToolsPage.css";

type ToolSyncFeedback = {
  kind: "ok" | "warn";
  text: string;
};

export default function ToolsPage() {
  const { t, locale } = useI18n();
  const [tools, setTools] = useState<ToolStatus[]>([]);
  const [routerHealthByTool, setRouterHealthByTool] = useState<
    Record<string, ToolRouterHealthStatus>
  >({});
  const [pathDrafts, setPathDrafts] = useState<Record<string, ToolPathDraft>>({});
  const [status, setStatus] = useState("");
  const [syncFeedbackByTool, setSyncFeedbackByTool] = useState<Record<string, ToolSyncFeedback>>({});
  const [form, setForm] = useState<CustomToolForm>(EMPTY_CUSTOM_TOOL_FORM);
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savingPathToolId, setSavingPathToolId] = useState<string | null>(null);
  const [syncingToolId, setSyncingToolId] = useState<string | null>(null);
  const [togglingAutoToolId, setTogglingAutoToolId] = useState<string | null>(null);
  const [togglingTrackingToolId, setTogglingTrackingToolId] = useState<string | null>(null);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const syncFeedbackTimersRef = useRef<Record<string, number>>({});

  const installedTools = useMemo(() => tools.filter((tool) => tool.exists), [tools]);
  const uninstalledTools = useMemo(() => tools.filter((tool) => !tool.exists), [tools]);
  const autoToolIds = useMemo(
    () => tools.filter((tool) => tool.exists && tool.autoSync).map((tool) => tool.id),
    [tools],
  );

  const handleManualSyncResult = useCallback(
    (toolId: string, result: SetupApplyResult) => {
      const existingTimer = syncFeedbackTimersRef.current[toolId];
      if (existingTimer) {
        window.clearTimeout(existingTimer);
      }

      const text = result.success
        ? t("tools.manual.result.success", { action: result.action })
        : t("tools.manual.result.failed", { reason: result.error || t("tools.result.failed") });
      const nextFeedback: ToolSyncFeedback = {
        kind: result.success ? "ok" : "warn",
        text,
      };
      setSyncFeedbackByTool((prev) => ({ ...prev, [toolId]: nextFeedback }));

      const timeoutMs = result.success ? 2500 : 5000;
      syncFeedbackTimersRef.current[toolId] = window.setTimeout(() => {
        setSyncFeedbackByTool((prev) => {
          const next = { ...prev };
          delete next[toolId];
          return next;
        });
        delete syncFeedbackTimersRef.current[toolId];
      }, timeoutMs);
    },
    [t],
  );

  const {
    loadStatus,
    handleManualSync,
    handleToggleAutoSync,
    handleToggleTracking,
    handleAddCustomTool,
    handleRemoveCustomTool,
    handleSaveToolPaths,
    handlePickToolPath,
    handlePickCustomFormPath,
  } = useToolsPageActions({
    t,
    autoToolIds,
    form,
    pathDrafts,
    setTools,
    setRouterHealthByTool,
    setPathDrafts,
    setStatus,
    onManualSyncResult: handleManualSyncResult,
    setForm,
    setBusy,
    setSubmitting,
    setSavingPathToolId,
    setSyncingToolId,
    setTogglingAutoToolId,
    setTogglingTrackingToolId,
    setShowCustomForm,
  });

  const sectionItems = useMemo(
    () => [
      {
        key: "installed",
        title: t("tools.section.installed", { count: installedTools.length }),
        tools: installedTools,
        installed: true,
      },
      {
        key: "uninstalled",
        title: t("tools.section.uninstalled", { count: uninstalledTools.length }),
        tools: uninstalledTools,
        installed: false,
      },
    ],
    [installedTools, t, uninstalledTools],
  );

  const commonSectionProps = {
    routerHealthByTool,
    pathDrafts,
    busy,
    savingPathToolId,
    syncingToolId,
    togglingAutoToolId,
    togglingTrackingToolId,
    syncFeedbackByTool,
    locale,
    t,
    onDraftChange: (toolId: string, nextDraft: ToolPathDraft) =>
      setPathDrafts((prev) => ({ ...prev, [toolId]: nextDraft })),
    onPickToolPath: (toolId: string, target: "skills" | "rules") => void handlePickToolPath(toolId, target),
    onManualSync: (tool: ToolStatus) => void handleManualSync(tool),
    onToggleAutoSync: (tool: ToolStatus) => void handleToggleAutoSync(tool),
    onToggleTracking: (tool: ToolStatus) => void handleToggleTracking(tool),
    onSaveToolPaths: (tool: ToolStatus) => void handleSaveToolPaths(tool),
    onRemoveCustomTool: (toolId: string) => void handleRemoveCustomTool(toolId),
  };

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    return () => {
      for (const timerId of Object.values(syncFeedbackTimersRef.current)) {
        window.clearTimeout(timerId);
      }
      syncFeedbackTimersRef.current = {};
    };
  }, []);

  return (
    <div className="page animate-fadein tools-page">
      <header className="page-header tools-page-header page-header-grid">
        <div className="tools-header-copy page-header-copy">
          <h1 className="page-title">{t("tools.title")}</h1>
          <p className="tools-installed">{t("tools.count", { count: tools.length })}</p>
        </div>
        <div className="tools-header-actions page-header-actions-grid">
          <div className="tools-actions-row page-header-actions-row">
            {status && (
              <span className="tools-header-status" role="status" aria-live="polite">
                {status}
              </span>
            )}
            <button className="btn btn-ghost tools-header-btn" onClick={() => void loadStatus()} disabled={busy}>
              <IconRefresh size={14} />
              {t("tools.refresh")}
            </button>
            <button
              className={`btn tools-header-btn ${showCustomForm ? "btn-ghost" : "btn-primary"}`}
              onClick={() => setShowCustomForm((prev) => !prev)}
              disabled={submitting}
            >
              {showCustomForm ? <IconClose size={14} /> : <IconPlus size={14} />}
              {showCustomForm ? t("tools.form.hide") : t("tools.form.show")}
            </button>
          </div>
        </div>
      </header>

      <div className="tools-sections">
        {sectionItems.map((section) => (
          <ToolSection
            key={section.key}
            title={section.title}
            tools={section.tools}
            installed={section.installed}
            {...commonSectionProps}
          />
        ))}
      </div>

      {showCustomForm && (
        <CustomToolFormCard
          form={form}
          submitting={submitting}
          t={t}
          onHide={() => setShowCustomForm(false)}
          onChange={setForm}
          onPickPath={(target) => void handlePickCustomFormPath(target)}
          onSubmit={() => void handleAddCustomTool()}
        />
      )}

    </div>
  );
}

