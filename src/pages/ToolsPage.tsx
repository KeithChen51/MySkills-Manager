import { useEffect, useMemo, useState } from "react";

import { type SetupApplyResult, type ToolRouterHealthStatus, type ToolStatus } from "../api/tauri";
import { IconClose, IconPlus, IconRefresh, IconSave } from "../components/icons";
import { useI18n } from "../i18n/I18nProvider";
import { type ToolPathDraft } from "./toolsPathPicker";
import CustomToolFormCard from "./tools/CustomToolFormCard";
import ToolSection from "./tools/ToolSection";
import { EMPTY_CUSTOM_TOOL_FORM, type CustomToolForm } from "./tools/customToolForm";
import { useToolsPageActions } from "./tools/useToolsPageActions";
import "./ToolsPage.css";

export default function ToolsPage() {
  const { t, locale } = useI18n();
  const [tools, setTools] = useState<ToolStatus[]>([]);
  const [routerHealthByTool, setRouterHealthByTool] = useState<
    Record<string, ToolRouterHealthStatus>
  >({});
  const [pathDrafts, setPathDrafts] = useState<Record<string, ToolPathDraft>>({});
  const [status, setStatus] = useState("");
  const [applyResults, setApplyResults] = useState<SetupApplyResult[]>([]);
  const [form, setForm] = useState<CustomToolForm>(EMPTY_CUSTOM_TOOL_FORM);
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savingPathToolId, setSavingPathToolId] = useState<string | null>(null);
  const [syncingToolId, setSyncingToolId] = useState<string | null>(null);
  const [togglingAutoToolId, setTogglingAutoToolId] = useState<string | null>(null);
  const [togglingTrackingToolId, setTogglingTrackingToolId] = useState<string | null>(null);
  const [showCustomForm, setShowCustomForm] = useState(false);

  const installedTools = useMemo(() => tools.filter((tool) => tool.exists), [tools]);
  const uninstalledTools = useMemo(() => tools.filter((tool) => !tool.exists), [tools]);
  const autoToolIds = useMemo(
    () => tools.filter((tool) => tool.exists && tool.autoSync).map((tool) => tool.id),
    [tools],
  );

  const {
    loadStatus,
    handleApplyAutoTools,
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
    setApplyResults,
    setForm,
    setBusy,
    setSubmitting,
    setSavingPathToolId,
    setSyncingToolId,
    setTogglingAutoToolId,
    setTogglingTrackingToolId,
    setShowCustomForm,
  });

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  return (
    <div className="page animate-fadein tools-page">
      <header className="page-header tools-page-header">
        <div className="tools-header-copy">
          <h1 className="page-title">{t("tools.title")}</h1>
          <p className="tools-installed">{t("tools.count", { count: tools.length })}</p>
        </div>
        <div className="tools-header-actions">
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
          <button
            className="btn btn-primary tools-header-btn"
            onClick={() => void handleApplyAutoTools()}
            disabled={busy || autoToolIds.length === 0}
          >
            <IconSave size={14} />
            {busy ? t("tools.syncing") : t("tools.apply.auto.button", { count: autoToolIds.length })}
          </button>
        </div>
      </header>

      <div className="tools-sections">
        <ToolSection
          title={t("tools.section.installed", { count: installedTools.length })}
          tools={installedTools}
          installed
          routerHealthByTool={routerHealthByTool}
          pathDrafts={pathDrafts}
          busy={busy}
          savingPathToolId={savingPathToolId}
          syncingToolId={syncingToolId}
          togglingAutoToolId={togglingAutoToolId}
          togglingTrackingToolId={togglingTrackingToolId}
          locale={locale}
          t={t}
          onDraftChange={(toolId, nextDraft) =>
            setPathDrafts((prev) => ({ ...prev, [toolId]: nextDraft }))
          }
          onPickToolPath={(toolId, target) => void handlePickToolPath(toolId, target)}
          onManualSync={(tool) => void handleManualSync(tool)}
          onToggleAutoSync={(tool) => void handleToggleAutoSync(tool)}
          onToggleTracking={(tool) => void handleToggleTracking(tool)}
          onSaveToolPaths={(tool) => void handleSaveToolPaths(tool)}
          onRemoveCustomTool={(toolId) => void handleRemoveCustomTool(toolId)}
        />

        <ToolSection
          title={t("tools.section.uninstalled", { count: uninstalledTools.length })}
          tools={uninstalledTools}
          installed={false}
          routerHealthByTool={routerHealthByTool}
          pathDrafts={pathDrafts}
          busy={busy}
          savingPathToolId={savingPathToolId}
          syncingToolId={syncingToolId}
          togglingAutoToolId={togglingAutoToolId}
          togglingTrackingToolId={togglingTrackingToolId}
          locale={locale}
          t={t}
          onDraftChange={(toolId, nextDraft) =>
            setPathDrafts((prev) => ({ ...prev, [toolId]: nextDraft }))
          }
          onPickToolPath={(toolId, target) => void handlePickToolPath(toolId, target)}
          onManualSync={(tool) => void handleManualSync(tool)}
          onToggleAutoSync={(tool) => void handleToggleAutoSync(tool)}
          onToggleTracking={(tool) => void handleToggleTracking(tool)}
          onSaveToolPaths={(tool) => void handleSaveToolPaths(tool)}
          onRemoveCustomTool={(toolId) => void handleRemoveCustomTool(toolId)}
        />
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

      {applyResults.length > 0 && (
        <article className="chart-card">
          <h3 className="chart-title">{t("tools.result.title")}</h3>
          <div className="tools-results">
            {applyResults.map((result) => (
              <div key={result.tool} className="tools-result-item">
                <strong>{result.tool}</strong>
                <span className={`tool-card-badge ${result.success ? "ok" : "warn"}`}>
                  {result.success ? t("tools.result.success") : t("tools.result.failed")}
                </span>
                <span>{result.action}</span>
                {result.error && <span className="tools-error">{result.error}</span>}
              </div>
            ))}
          </div>
        </article>
      )}
    </div>
  );
}

