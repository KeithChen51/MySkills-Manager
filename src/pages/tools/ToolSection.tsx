import type { ToolRouterHealthStatus, ToolStatus } from "../../api/tauri";
import type { MessageKey } from "../../i18n/messages";
import type { PathPickerTarget, ToolPathDraft } from "../toolsPathPicker";
import ToolCard from "./ToolCard";

type TranslateFn = (
  key: MessageKey,
  params?: Record<string, string | number>,
) => string;

type ToolSectionProps = {
  title: string;
  tools: ToolStatus[];
  installed: boolean;
  routerHealthByTool: Record<string, ToolRouterHealthStatus>;
  pathDrafts: Record<string, ToolPathDraft>;
  busy: boolean;
  savingPathToolId: string | null;
  syncingToolId: string | null;
  togglingAutoToolId: string | null;
  togglingTrackingToolId: string | null;
  locale: string;
  t: TranslateFn;
  onDraftChange: (toolId: string, nextDraft: ToolPathDraft) => void;
  onPickToolPath: (toolId: string, target: PathPickerTarget) => void;
  onManualSync: (tool: ToolStatus) => void;
  onToggleAutoSync: (tool: ToolStatus) => void;
  onToggleTracking: (tool: ToolStatus) => void;
  onSaveToolPaths: (tool: ToolStatus) => void;
  onRemoveCustomTool: (id: string) => void;
};

function normalizedPath(value: string | undefined) {
  return (value ?? "").trim();
}

export default function ToolSection({
  title,
  tools,
  installed,
  routerHealthByTool,
  pathDrafts,
  busy,
  savingPathToolId,
  syncingToolId,
  togglingAutoToolId,
  togglingTrackingToolId,
  locale,
  t,
  onDraftChange,
  onPickToolPath,
  onManualSync,
  onToggleAutoSync,
  onToggleTracking,
  onSaveToolPaths,
  onRemoveCustomTool,
}: ToolSectionProps) {
  return (
    <section className="tools-section">
      <h2 className="tools-section-title">{title}</h2>
      <div className="tools-grid">
        {tools.map((tool) => {
          const draft = pathDrafts[tool.id] ?? {
            skillsDir: tool.skillsDir,
            rulesPath: tool.rulesPath ?? "",
          };

          return (
            <ToolCard
              key={tool.id}
              tool={tool}
              installed={installed}
              routerHealth={routerHealthByTool[tool.id]}
              draft={draft}
              hasPathChange={
                normalizedPath(draft.skillsDir) !== normalizedPath(tool.skillsDir) ||
                normalizedPath(draft.rulesPath) !== normalizedPath(tool.rulesPath)
              }
              busy={busy}
              savingCurrentTool={savingPathToolId === tool.id}
              syncingCurrentTool={syncingToolId === tool.id}
              togglingAutoCurrentTool={togglingAutoToolId === tool.id}
              togglingTrackingCurrentTool={togglingTrackingToolId === tool.id}
              skillsDirConfigured={Boolean(normalizedPath(draft.skillsDir))}
              locale={locale}
              t={t}
              onDraftChange={(nextDraft) => onDraftChange(tool.id, nextDraft)}
              onPickToolPath={(target) => onPickToolPath(tool.id, target)}
              onManualSync={() => onManualSync(tool)}
              onToggleAutoSync={() => onToggleAutoSync(tool)}
              onToggleTracking={() => onToggleTracking(tool)}
              onSaveToolPaths={() => onSaveToolPaths(tool)}
              onRemoveCustomTool={() => onRemoveCustomTool(tool.id)}
            />
          );
        })}
      </div>
    </section>
  );
}
