/**
 * EvalSetup.tsx — Step 1-3 configuration (v6.0)
 * Uses existing EvalPage.css patterns: chart-card, eval-config-grid, eval-flow-guide, field-label/field-input.
 */
import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useEvalStore, useEvalDispatch, type EvalMode } from "./EvalStore";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/messages";
import { evalGetConfig, type SkillMeta } from "../../api/tauri";

interface Props {
  skills: SkillMeta[];
}

type ModelGroupOption = { groupName: string; models: string[] };

/** Standalone model selector — renders models grouped by model group */
function ModelSelect({
  value,
  onChange,
  placeholder,
  modelGroupOptions,
  t,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  modelGroupOptions: ModelGroupOption[];
  t: (key: MessageKey) => string;
}) {
  const allModels = modelGroupOptions.flatMap((g) => g.models);
  return (
    <div style={{ display: "flex", gap: "var(--sp-xs)" }}>
      <select
        className="filter-select"
        value={allModels.includes(value) ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        style={{ flex: 1 }}
      >
        <option value="">{placeholder ?? t("eval.config.selectModel" as MessageKey)}</option>
        {modelGroupOptions.map((group) => (
          <optgroup key={group.groupName} label={group.groupName}>
            {group.models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <input
        className="field-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("eval.config.model.placeholder" as MessageKey)}
        style={{ flex: 1, maxWidth: 240 }}
        title={t("eval.config.model.customHint" as MessageKey)}
      />
    </div>
  );
}

export default function EvalSetup({ skills }: Props) {
  const { t } = useI18n();
  const state = useEvalStore();
  const dispatch = useEvalDispatch();
  const [datasetSourceMode, setDatasetSourceMode] = useState<"ai" | "pick">("ai");

  // ── Load configured models from Settings (model groups) ──
  const [modelGroupOptions, setModelGroupOptions] = useState<ModelGroupOption[]>([]);
  useEffect(() => {
    void evalGetConfig()
      .then((config) => {
        const groups = config.modelGroups ?? [];
        const options: ModelGroupOption[] = groups
          .filter((g) => g.models.length > 0)
          .map((g) => ({ groupName: g.name, models: g.models }));
        setModelGroupOptions(options);

        // Auto-fill defaults — use first model from first group
        const firstModel = groups[0]?.models[0];
        if (firstModel) {
          if (!state.sampleModel) dispatch({ type: "SET_SAMPLE_MODEL", payload: firstModel });
          if (!state.model) dispatch({ type: "SET_MODEL", payload: firstModel });
        }
        if (config.judgeModel?.trim()) {
          dispatch({ type: "SET_JUDGE_MODEL", payload: config.judgeModel.trim() });
        }
      })
      .catch(() => {
        setModelGroupOptions([]);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Generate state ──
  type GenResult = { triggerCount?: number; functionalCount?: number; savedPath?: string; error?: string };
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<GenResult | null>(null);
  const [genElapsed, setGenElapsed] = useState(0);
  const [genStage, setGenStage] = useState("");

  const handleGenerate = useCallback(async () => {
    const skillMeta = skills.find((s) => s.name === state.selectedSkill);
    if (!skillMeta || !state.sampleModel.trim()) return;
    const skillPath = `${skillMeta.directory.replace(/[\\/]+$/, "")}/SKILL.md`;

    setGenerating(true);
    setGenResult(null);
    setGenElapsed(0);
    setGenStage(t("eval.samples.stage.generating" as MessageKey));
    const startMs = Date.now();
    const timer = setInterval(() => {
      setGenElapsed(Math.round((Date.now() - startMs) / 1000));
    }, 1000);

    try {
      const { evalGenerateSamples, evalSaveDataset } = await import("../../api/tauri");
      const isQuick = state.evalMode === "quick";
      const drafts = await evalGenerateSamples({
        skillName: state.selectedSkill,
        skillPath,
        model: state.sampleModel.trim(),
        triggerCount: 72,
        functionalCount: isQuick ? 0 : 36,
      });

      // Auto-save trigger dataset
      setGenStage(t("eval.samples.stage.savingTrigger" as MessageKey));
      let savedPath = "";
      if (drafts.triggerDraft) {
        const saveResult = await evalSaveDataset({
          path: undefined,
          content: drafts.triggerDraft,
          kind: "trigger",
          skillName: state.selectedSkill,
        });
        if (saveResult.path) {
          dispatch({ type: "SET_TRIGGER_SET_PATH", payload: saveResult.path });
          savedPath = saveResult.path;
        }
      }
      // Auto-save functional dataset (skip in quick mode)
      if (!isQuick && drafts.functionalDraft) {
        setGenStage(t("eval.samples.stage.savingFunctional" as MessageKey));
        const saveResult = await evalSaveDataset({
          path: undefined,
          content: drafts.functionalDraft,
          kind: "functional",
          skillName: state.selectedSkill,
        });
        if (saveResult.path) {
          dispatch({ type: "SET_FUNCTIONAL_SET_PATH", payload: saveResult.path });
        }
      }

      const triggerCount = drafts.triggerDraft ? JSON.parse(drafts.triggerDraft).length : 0;
      const functionalCount = !isQuick && drafts.functionalDraft ? JSON.parse(drafts.functionalDraft).length : 0;
      setGenResult({ triggerCount, functionalCount, savedPath });
    } catch (error: unknown) {
      setGenResult({ error: String(error) });
    } finally {
      clearInterval(timer);
      setGenerating(false);
      setGenStage("");
    }
  }, [skills, state.selectedSkill, state.sampleModel, state.evalMode, dispatch, t]);

  // ── File Picker ──
  const pickEvalSet = useCallback(
    async (kind: "trigger" | "functional") => {
      const selected = await open({
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
        title:
          kind === "trigger"
            ? t("eval.dataset.trigger" as MessageKey)
            : t("eval.dataset.functional" as MessageKey),
      });
      if (!selected) return;
      const path = typeof selected === "string" ? selected : Array.isArray(selected) ? selected[0] : null;
      if (!path) return;
      if (kind === "trigger") {
        dispatch({ type: "SET_TRIGGER_SET_PATH", payload: path });
      } else {
        dispatch({ type: "SET_FUNCTIONAL_SET_PATH", payload: path });
      }
    },
    [dispatch, t],
  );

  // ── Step logic ──
  const needsFunctional = state.evalMode !== "quick";
  const activeStep = state.stepOverride ?? (
    !state.selectedSkill ? 1 : !state.triggerSetPath ? 2 : needsFunctional && !state.functionalSetPath ? 2 : 3
  );
  const step1Done = !!state.selectedSkill;
  const step2Done = step1Done && !!state.triggerSetPath && (!needsFunctional || !!state.functionalSetPath);
  const step3Done = step2Done && !!state.model;

  const step2Generating = generating; // AI generation in progress
  const stepStatus = (step: number, done: boolean) => {
    if (step === 2 && step2Generating) return "generating";
    return activeStep === step ? "active" : done ? "done" : "pending";
  };

  const jumpToStep = useCallback(
    (s: 1 | 2 | 3) => dispatch({ type: "PATCH", payload: { stepOverride: s } }),
    [dispatch],
  );

  const flowCompletedCount = [step1Done, step2Done, step3Done].filter(Boolean).length;

  return (
    <article className="chart-card eval-config-card">
      <h3 className="chart-title">{t("eval.config.title" as MessageKey)}</h3>
      <p className="eval-advisory-note">{t("eval.notice.nonBlocking" as MessageKey)}</p>

      {/* ── Flow Guide ── */}
      <div className="eval-flow-sticky">
        <div className="eval-flow-head">
          <span className="eval-flow-complete">
            {t("eval.flow.completed" as MessageKey, { done: flowCompletedCount, total: 3 })}
          </span>
        </div>
        <section className="eval-flow-guide" aria-label={t("eval.flow.aria" as MessageKey)}>
          {([1, 2, 3] as const).map((step) => {
            const done = step === 1 ? step1Done : step === 2 ? step2Done : step3Done;
            const status = stepStatus(step, done);
            return (
              <button
                key={step}
                type="button"
                className={`eval-flow-step is-${status}`}
                aria-current={activeStep === step ? "step" : undefined}
                onClick={() => jumpToStep(step)}
              >
                <span className="eval-flow-index">{step}</span>
                <div>
                  <strong>{t(`eval.flow.step${step}.title` as MessageKey)}</strong>
                  <small>{t(`eval.flow.step${step}.desc` as MessageKey)}</small>
                </div>
                <span className={`eval-flow-state eval-flow-state-${status}`}>
                  {t(`eval.flow.state.${status}` as MessageKey)}
                </span>
              </button>
            );
          })}
        </section>
      </div>

      {/* ── Config Grid ── */}
      <div className="eval-config-grid">
        {/* Step 1: Skill Selection */}
        {activeStep === 1 && (
          <>
            <p className="eval-config-group-title">{t("eval.flow.group.step1" as MessageKey)}</p>
            <div className="field">
              <label className="field-label">{t("eval.config.skill" as MessageKey)}</label>
              <select
                className="filter-select"
                value={state.selectedSkill}
                onChange={(e) => dispatch({ type: "SET_SELECTED_SKILL", payload: e.target.value })}
              >
                <option value="">{t("eval.config.selectSkill" as MessageKey)}</option>
                {skills.map((skill) => (
                  <option key={skill.name} value={skill.name}>{skill.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field-label">{t("eval.config.mode" as MessageKey)}</label>
              <select
                className="filter-select"
                value={state.evalMode}
                onChange={(e) => dispatch({ type: "SET_MODE", payload: e.target.value as EvalMode })}
              >
                <option value="quick">{t("eval.config.mode.quick" as MessageKey)}</option>
                <option value="standard">{t("eval.mode.standard" as MessageKey)}</option>
                <option value="full">{t("eval.config.mode.full" as MessageKey)}</option>
              </select>
            </div>
          </>
        )}

        {/* Step 2: Datasets — Dual-mode Source */}
        {activeStep === 2 && (
          <>
            <p className="eval-config-group-title">{t("eval.flow.group.step2" as MessageKey)}</p>

            {/* ── Source Mode Toggle ── */}
            <div className="eval-dataset-actions eval-field-wide">
              <button
                className={`btn ${datasetSourceMode === "ai" ? "btn-primary" : "btn-ghost"} eval-action-btn`}
                onClick={() => setDatasetSourceMode("ai")}
              >
                🤖 {t("eval.dataset.source.ai" as MessageKey)}
              </button>
              <button
                className={`btn ${datasetSourceMode === "pick" ? "btn-primary" : "btn-ghost"} eval-action-btn`}
                onClick={() => setDatasetSourceMode("pick")}
              >
                📁 {t("eval.dataset.source.pick" as MessageKey)}
              </button>
            </div>

            {/* ── Mode A: AI 即时生成 ── */}
            {datasetSourceMode === "ai" && (
              <>
                <div className="field eval-field-wide">
                  <label className="field-label">{t("eval.config.generationModel" as MessageKey)}</label>
                  <ModelSelect
                    value={state.sampleModel}
                    onChange={(v) => dispatch({ type: "SET_SAMPLE_MODEL", payload: v })}
                    modelGroupOptions={modelGroupOptions}
                    t={t}
                  />
                </div>
                <div className="eval-dataset-actions eval-field-wide">
                  <button
                    className="btn btn-primary eval-action-btn"
                    disabled={generating || !state.selectedSkill || !state.sampleModel.trim()}
                    onClick={() => void handleGenerate()}
                  >
                    {generating
                      ? `⏳ ${t("eval.samples.generating" as MessageKey)}...`
                      : needsFunctional
                        ? t("eval.samples.generate" as MessageKey, { trigger: 72, functional: 36 })
                        : t("eval.samples.generate" as MessageKey, { trigger: 72, functional: 0 })}
                  </button>
                </div>

                {/* Progress feedback */}
                {generating && (
                  <div className="eval-gen-card eval-field-wide">
                    <div className="eval-gen-card-header">
                      <span className="eval-gen-card-icon">⚙️</span>
                      <div className="eval-gen-card-text">
                        <strong>{genStage || t("eval.samples.generating" as MessageKey)}</strong>
                        <small>{t("eval.dataset.source.aiHint" as MessageKey)}</small>
                      </div>
                      <span className="eval-gen-card-elapsed">
                        {Math.floor(genElapsed / 60) > 0
                          ? `${Math.floor(genElapsed / 60)}m ${genElapsed % 60}s`
                          : `${genElapsed}s`}
                      </span>
                    </div>
                    <div className="eval-gen-card-bar">
                      <div className="eval-gen-card-bar-shimmer" />
                    </div>
                  </div>
                )}

                {/* Result feedback */}
                {!generating && genResult && (
                  <div className={`eval-preflight-card eval-field-wide`} style={{
                    borderColor: genResult.error ? "var(--danger)" : "var(--success)",
                  }}>
                    {genResult.error ? (
                      <>
                        <p className="eval-running-stage-status" style={{ color: "var(--danger)" }}>
                          ❌ {genResult.error}
                        </p>
                        <button
                          className="btn btn-ghost"
                          style={{ marginTop: "var(--sp-xs)" }}
                          onClick={() => void handleGenerate()}
                        >
                          🔄 {t("eval.samples.retry" as MessageKey)}
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="eval-running-stage-status" style={{ color: "var(--success)" }}>
                          ✅ {t("eval.samples.generated" as MessageKey, {
                            trigger: genResult.triggerCount ?? 0,
                            functional: genResult.functionalCount ?? 0,
                          })}
                        </p>
                        {genResult.savedPath && (
                          <p className="eval-path-hint">
                            📁 {genResult.savedPath}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}

                {!generating && !genResult && (
                  <p className="eval-path-hint eval-field-wide">
                    {t("eval.dataset.source.aiHint" as MessageKey)}
                  </p>
                )}
              </>
            )}

            {/* ── Mode B: 选择文件 ── */}
            {datasetSourceMode === "pick" && (
              <>
                <div className="field eval-field-wide">
                  <label className="field-label">{t("eval.dataset.trigger" as MessageKey)}</label>
                  <div className="eval-path-row">
                    <input
                      className="field-input"
                      value={state.triggerSetPath}
                      onChange={(e) => dispatch({ type: "SET_TRIGGER_SET_PATH", payload: e.target.value })}
                      placeholder="...trigger-eval.json"
                    />
                    <button
                      className="btn btn-ghost"
                      onClick={() => void pickEvalSet("trigger")}
                    >
                      {t("eval.dataset.pick" as MessageKey)}
                    </button>
                  </div>
                <p className="eval-path-hint">
                  {t("eval.dataset.defaultPath" as MessageKey, { path: state.storagePaths?.datasetDir ?? "--" })}
                </p>
                </div>
                {needsFunctional && (
                <div className="field eval-field-wide">
                  <label className="field-label">{t("eval.dataset.functional" as MessageKey)}</label>
                  <div className="eval-path-row">
                    <input
                      className="field-input"
                      value={state.functionalSetPath}
                      onChange={(e) => dispatch({ type: "SET_FUNCTIONAL_SET_PATH", payload: e.target.value })}
                      placeholder="...functional-eval.json"
                    />
                    <button
                      className="btn btn-ghost"
                      onClick={() => void pickEvalSet("functional")}
                    >
                      {t("eval.dataset.pick" as MessageKey)}
                    </button>
                  </div>
                </div>
                )}
                <p className="eval-path-hint eval-field-wide">
                  {t("eval.dataset.source.pickHint" as MessageKey)}
                </p>
              </>
            )}
          </>
        )}

        {/* Step 3: Config + Three-Role Models */}
        {activeStep === 3 && (
          <>
            <p className="eval-config-group-title">{t("eval.flow.group.step3" as MessageKey)}</p>
            <div className="field">
              <label className="field-label">{t("eval.config.runModel" as MessageKey)}</label>
              <ModelSelect
                value={state.model}
                onChange={(v) => dispatch({ type: "SET_MODEL", payload: v })}
                modelGroupOptions={modelGroupOptions}
                t={t}
              />
            </div>

            {/* v6.0: Three-Role Model Config */}
            <p className="eval-config-group-title">{t("eval.config.judgeModel" as MessageKey)}</p>
            <div className="field">
              <label className="field-label">{t("eval.config.judgeModel" as MessageKey)}</label>
              <ModelSelect
                value={state.judgeModel}
                onChange={(v) => dispatch({ type: "SET_JUDGE_MODEL", payload: v })}
                placeholder={t("eval.config.judgeModelHint" as MessageKey)}
                modelGroupOptions={modelGroupOptions}
                t={t}
              />
            </div>

            <div className="field">
              <label className="field-label">{t("eval.config.repeats" as MessageKey)}</label>
              <input
                className="field-input"
                type="number"
                min={1}
                max={5}
                value={state.repeatsInput}
                onChange={(e) => dispatch({ type: "SET_REPEATS_INPUT", payload: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="field-label">{t("eval.config.maxParallelArms" as MessageKey)}</label>
              <input
                className="field-input"
                type="number"
                min={1}
                max={4}
                value={state.maxParallelArmsInput}
                onChange={(e) => dispatch({ type: "SET_MAX_PARALLEL_ARMS_INPUT", payload: e.target.value })}
              />
            </div>
          </>
        )}
      </div>
    </article>
  );
}
