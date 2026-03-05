import { useCallback, type Dispatch, type SetStateAction } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import {
  setupAddCustomTool,
  setupApply,
  setupRemoveCustomTool,
  setupRouterHealth,
  setupSetToolAutoSync,
  setupSetToolTrackingEnabled,
  setupStatus,
  setupUpdateToolPaths,
  type SetupApplyResult,
  type ToolRouterHealthStatus,
  type ToolStatus,
} from "../../api/tauri";
import type { MessageKey } from "../../i18n/messages";
import {
  buildPathPickerOptions,
  pickPathValueFromDialogResult,
  updateDraftWithPickedPath,
  type PathPickerTarget,
  type ToolPathDraft,
} from "../toolsPathPicker";
import { EMPTY_CUSTOM_TOOL_FORM, type CustomToolForm } from "./customToolForm";

type TranslateFn = (
  key: MessageKey,
  params?: Record<string, string | number>,
) => string;

type UseToolsPageActionsParams = {
  t: TranslateFn;
  autoToolIds: string[];
  form: CustomToolForm;
  pathDrafts: Record<string, ToolPathDraft>;
  setTools: Dispatch<SetStateAction<ToolStatus[]>>;
  setRouterHealthByTool: Dispatch<SetStateAction<Record<string, ToolRouterHealthStatus>>>;
  setPathDrafts: Dispatch<SetStateAction<Record<string, ToolPathDraft>>>;
  setStatus: Dispatch<SetStateAction<string>>;
  setApplyResults: Dispatch<SetStateAction<SetupApplyResult[]>>;
  setForm: Dispatch<SetStateAction<CustomToolForm>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setSubmitting: Dispatch<SetStateAction<boolean>>;
  setSavingPathToolId: Dispatch<SetStateAction<string | null>>;
  setSyncingToolId: Dispatch<SetStateAction<string | null>>;
  setTogglingAutoToolId: Dispatch<SetStateAction<string | null>>;
  setTogglingTrackingToolId: Dispatch<SetStateAction<string | null>>;
  setShowCustomForm: Dispatch<SetStateAction<boolean>>;
};

function normalizedPath(value: string | undefined) {
  return (value ?? "").trim();
}

export function useToolsPageActions({
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
}: UseToolsPageActionsParams) {
  const loadStatus = useCallback(async () => {
    setBusy(true);
    setStatus(t("tools.loading"));
    try {
      const [data, routerHealth] = await Promise.all([setupStatus(), setupRouterHealth()]);
      setTools(data);
      setRouterHealthByTool(
        Object.fromEntries(routerHealth.map((item) => [item.toolId, item])),
      );
      setPathDrafts(() => {
        const next: Record<string, ToolPathDraft> = {};
        for (const tool of data) {
          next[tool.id] = {
            skillsDir: tool.skillsDir,
            rulesPath: tool.rulesPath ?? "",
          };
        }
        return next;
      });
      setStatus("");
    } catch (e: unknown) {
      setStatus(String(e));
    } finally {
      setBusy(false);
    }
  }, [setBusy, setStatus, t, setTools, setRouterHealthByTool, setPathDrafts]);

  const handleApplyAutoTools = useCallback(async () => {
    if (autoToolIds.length === 0) {
      setStatus(t("tools.apply.auto.none"));
      return;
    }
    setBusy(true);
    setStatus(t("tools.syncing"));
    try {
      const results = await setupApply(autoToolIds);
      setApplyResults(results);
      await loadStatus();
      setStatus("");
    } catch (e: unknown) {
      setStatus(String(e));
    } finally {
      setBusy(false);
    }
  }, [autoToolIds, loadStatus, setApplyResults, setBusy, setStatus, t]);

  const handleManualSync = useCallback(async (tool: ToolStatus) => {
    setSyncingToolId(tool.id);
    setStatus(t("tools.syncing"));
    try {
      const results = await setupApply([tool.id]);
      setApplyResults(results);
      await loadStatus();
      setStatus("");
    } catch (e: unknown) {
      setStatus(String(e));
    } finally {
      setSyncingToolId(null);
    }
  }, [loadStatus, setApplyResults, setStatus, setSyncingToolId, t]);

  const handleToggleAutoSync = useCallback(async (tool: ToolStatus) => {
    setTogglingAutoToolId(tool.id);
    setStatus(t("tools.auto.updating"));
    try {
      await setupSetToolAutoSync(tool.id, !tool.autoSync);
      setTools((prev) =>
        prev.map((item) =>
          item.id === tool.id ? { ...item, autoSync: !item.autoSync } : item,
        ),
      );
      setStatus("");
    } catch (e: unknown) {
      setStatus(String(e));
    } finally {
      setTogglingAutoToolId(null);
    }
  }, [setStatus, setTogglingAutoToolId, setTools, t]);

  const handleToggleTracking = useCallback(async (tool: ToolStatus) => {
    setTogglingTrackingToolId(tool.id);
    setStatus(t("tools.tracking.updating"));
    try {
      await setupSetToolTrackingEnabled(tool.id, !tool.trackingEnabled);
      setTools((prev) =>
        prev.map((item) =>
          item.id === tool.id ? { ...item, trackingEnabled: !item.trackingEnabled } : item,
        ),
      );
      setStatus("");
    } catch (e: unknown) {
      setStatus(String(e));
    } finally {
      setTogglingTrackingToolId(null);
    }
  }, [setStatus, setTogglingTrackingToolId, setTools, t]);

  const handleAddCustomTool = useCallback(async () => {
    if (!form.name.trim() || !form.id.trim() || !form.skillsDir.trim()) {
      setStatus(t("tools.validation.required"));
      return;
    }

    setSubmitting(true);
    setStatus(t("tools.custom.adding"));
    try {
      await setupAddCustomTool({
        name: form.name.trim(),
        id: form.id.trim(),
        skillsDir: form.skillsDir.trim(),
        rulesFile: form.rulesFile.trim() || undefined,
        icon: form.icon.trim() || undefined,
      });
      setForm(EMPTY_CUSTOM_TOOL_FORM);
      setShowCustomForm(false);
      await loadStatus();
      setStatus(t("tools.custom.added"));
    } catch (e: unknown) {
      setStatus(String(e));
    } finally {
      setSubmitting(false);
    }
  }, [form, loadStatus, setForm, setShowCustomForm, setStatus, setSubmitting, t]);

  const handleRemoveCustomTool = useCallback(async (id: string) => {
    setBusy(true);
    setStatus(t("tools.custom.removing"));
    try {
      await setupRemoveCustomTool(id);
      await loadStatus();
      setStatus(t("tools.custom.removed"));
    } catch (e: unknown) {
      setStatus(String(e));
    } finally {
      setBusy(false);
    }
  }, [loadStatus, setBusy, setStatus, t]);

  const handleSaveToolPaths = useCallback(async (tool: ToolStatus) => {
    const draft = pathDrafts[tool.id];
    if (!draft || !normalizedPath(draft.skillsDir)) {
      setStatus(t("tools.validation.skillsRequired"));
      return;
    }

    setSavingPathToolId(tool.id);
    setStatus(t("tools.path.saving"));
    try {
      await setupUpdateToolPaths(
        tool.id,
        normalizedPath(draft.skillsDir),
        normalizedPath(draft.rulesPath) || undefined,
      );
      await loadStatus();
      setStatus(t("tools.path.saved"));
    } catch (e: unknown) {
      setStatus(String(e));
    } finally {
      setSavingPathToolId(null);
    }
  }, [loadStatus, pathDrafts, setSavingPathToolId, setStatus, t]);

  const handlePickToolPath = useCallback(async (
    toolId: string,
    target: PathPickerTarget,
  ) => {
    const draft = pathDrafts[toolId];
    if (!draft) {
      return;
    }

    const selectedResult = await open({
      ...buildPathPickerOptions(
        target,
        target === "skills" ? draft.skillsDir : draft.rulesPath,
      ),
      title: target === "skills" ? t("tools.path.pickDir") : t("tools.path.pickFile"),
    });

    const selectedPath = pickPathValueFromDialogResult(selectedResult);
    setPathDrafts((prev) => {
      const currentDraft = prev[toolId];
      if (!currentDraft) {
        return prev;
      }
      return {
        ...prev,
        [toolId]: updateDraftWithPickedPath(currentDraft, target, selectedPath),
      };
    });
  }, [pathDrafts, setPathDrafts, t]);

  const handlePickCustomFormPath = useCallback(async (target: PathPickerTarget) => {
    const selectedResult = await open({
      ...buildPathPickerOptions(
        target,
        target === "skills" ? form.skillsDir : form.rulesFile,
      ),
      title: target === "skills" ? t("tools.path.pickDir") : t("tools.path.pickFile"),
    });
    const selectedPath = pickPathValueFromDialogResult(selectedResult);
    if (!selectedPath) {
      return;
    }
    if (target === "skills") {
      setForm((prev) => ({ ...prev, skillsDir: selectedPath }));
      return;
    }
    setForm((prev) => ({ ...prev, rulesFile: selectedPath }));
  }, [form.rulesFile, form.skillsDir, setForm, t]);

  return {
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
  };
}
