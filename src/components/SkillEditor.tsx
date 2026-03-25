import Editor, { loader } from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";

import {
  setupStatus,
  skillsGetContent,
  skillsListFiles,
  skillsSaveContent,
  type SkillFileEntry,
  type SkillMeta,
} from "../api/tauri";
import { copyModeToolsRequiringResync } from "../domain/copyModeWarning";
import {
  fromEditableDocument,
  toEditableDocument,
  type EditableSkillDocument,
} from "../domain/skillDocument";
import { tagsFromInput, tagsToInput } from "../domain/tagInput";
import { useI18n } from "../i18n/I18nProvider";
import useDialogA11y from "./useDialogA11y";
import { IconClose, IconSave } from "./icons";
import "./SkillEditor.css";

type Props = {
  skill: SkillMeta;
  onClose: () => void;
  onSaved: () => void;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(path: string): string {
  if (path.endsWith(".md")) return "[MD]";
  if (path.endsWith(".ts") || path.endsWith(".js") || path.endsWith(".mjs")) return "[JS]";
  if (path.endsWith(".py")) return "[PY]";
  if (path.endsWith(".sh") || path.endsWith(".ps1")) return "[SH]";
  if (path.endsWith(".json") || path.endsWith(".yaml") || path.endsWith(".yml")) return "[CFG]";
  if (path.endsWith(".css")) return "[CSS]";
  if (path.includes("/")) return "[DIR]";
  return "[FILE]";
}

export default function SkillEditor({ skill, onClose, onSaved }: Props) {
  const { t } = useI18n();
  const [doc, setDoc] = useState<EditableSkillDocument | null>(null);
  const [fileList, setFileList] = useState<SkillFileEntry[]>([]);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedFile, setSelectedFile] = useState("SKILL.md");
  const [monacoReady, setMonacoReady] = useState(false);
  const monacoConfiguredRef = useRef(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const { dialogRef } = useDialogA11y<HTMLDivElement>({
    open: true,
    onClose,
    initialFocusRef: closeButtonRef,
  });

  useEffect(() => {
    if (monacoConfiguredRef.current) {
      return;
    }
    monacoConfiguredRef.current = true;
    let active = true;
    void Promise.all([
      import("monaco-editor/esm/vs/editor/editor.api"),
      import("monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution"),
    ])
      .then(([monaco]) => {
        loader.config({ monaco });
        if (active) {
          setMonacoReady(true);
        }
      })
      .catch(() => {
        if (active) {
          setMonacoReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setDoc(null);
    setFileList([]);
    setSelectedFile("SKILL.md");
    setStatus(t("editor.loading"));
    void Promise.all([
      skillsGetContent(skill.name),
      skillsListFiles(skill.name),
    ])
      .then(([content, files]) => {
        setDoc(toEditableDocument(content));
        setFileList(files);
        setStatus("");
      })
      .catch((err: unknown) => setStatus(String(err)));
  }, [skill.name, t]);

  async function handleSave() {
    if (!doc) return;
    setSaving(true);
    setStatus(t("editor.saving"));
    try {
      const content = fromEditableDocument(doc);
      await skillsSaveContent(skill.name, content);

      let nextStatus = t("editor.saved");
      try {
        const tools = await setupStatus();
        const copyModeTools = copyModeToolsRequiringResync(tools);
        if (copyModeTools.length > 0) {
          nextStatus = `${nextStatus} ${t("editor.copyModeWarning", {
            tools: copyModeTools.join(", "),
          })}`;
        }
      } catch {
        // Save succeeded; skip warning if status check fails.
      }

      setStatus(nextStatus);
      onSaved();
    } catch (err) {
      setStatus(String(err));
    } finally {
      setSaving(false);
    }
  }

  const meta = doc?.frontmatter;
  const tags = meta ? tagsToInput(meta.tags) : "";
  const extraKeys = meta ? Object.keys(meta.extra).sort() : [];
  const totalSize = fileList.reduce((sum, f) => sum + f.size, 0);

  function updateFrontmatter(key: string, value: unknown) {
    setDoc((prev) =>
      prev ? { ...prev, frontmatter: { ...prev.frontmatter, [key]: value } } : prev,
    );
  }

  function updateExtra(key: string, value: string) {
    setDoc((prev) =>
      prev
        ? {
          ...prev,
          frontmatter: {
            ...prev.frontmatter,
            extra: { ...prev.frontmatter.extra, [key]: value },
          },
        }
        : prev,
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal-window"
        role="dialog"
        aria-modal="true"
        aria-label={skill.name}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="modal-header">
          <div className="modal-header-left">
            <h2 className="modal-title">{skill.name}</h2>
            {meta?.description && (
              <p className="modal-desc">{meta.description}</p>
            )}
          </div>
          <div className="modal-header-right">
            <span className="modal-status">{status}</span>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving || !doc}
            >
              <IconSave size={14} />
              {saving ? t("editor.saving") : t("editor.save")}
            </button>
            <button
              ref={closeButtonRef}
              type="button"
              className="modal-close-btn"
              onClick={onClose}
              aria-label={t("editor.close")}
              title={t("editor.close")}
            >
              <IconClose size={18} />
            </button>
          </div>
        </header>

        {/* Metadata bar */}
        <div className="modal-meta">
          <div className="meta-field">
            <span className="meta-label">{t("editor.category")}</span>
            <input
              className="meta-input"
              value={meta?.category ?? ""}
              placeholder="-"
              onChange={(e) => updateFrontmatter("category", e.target.value)}
            />
          </div>
          <div className="meta-field">
            <span className="meta-label">{t("editor.tags")}</span>
            <input
              className="meta-input"
              value={tags}
              placeholder="-"
              onChange={(e) => updateFrontmatter("tags", tagsFromInput(e.target.value))}
            />
          </div>
          <div className="meta-field">
            <span className="meta-label">{t("editor.updatedAt")}</span>
            <span className="meta-value">{meta?.last_updated || "-"}</span>
          </div>
          {extraKeys.map((key) => (
            <div className="meta-field" key={key}>
              <span className="meta-label">{key}</span>
              <input
                className="meta-input"
                value={String(meta?.extra[key] ?? "")}
                onChange={(e) => updateExtra(key, e.target.value)}
              />
            </div>
          ))}
          <div className="meta-field meta-field-wide">
            <span className="meta-label">{t("editor.notes")}</span>
            <input
              className="meta-input"
              value={meta?.my_notes ?? ""}
              placeholder="-"
              onChange={(e) => updateFrontmatter("my_notes", e.target.value)}
            />
          </div>
        </div>

        {/* Main body: file list + editor */}
        <div className="modal-body">
          {/* Left: file tree */}
          <aside className="modal-files">
            <div className="modal-files-header">
              <span className="modal-files-title">{t("editor.files", { count: fileList.length })}</span>
              <span className="modal-files-size">{formatSize(totalSize)}</span>
            </div>
            <ul className="modal-files-list">
              {fileList.map((f) => (
                <li key={f.path} className="modal-files-item">
                  <button
                    type="button"
                    className={`modal-files-item-btn${f.path === selectedFile ? " active" : ""}`}
                    onClick={() => setSelectedFile(f.path)}
                    aria-current={f.path === selectedFile ? "true" : undefined}
                  >
                    <span className="modal-files-icon">{fileIcon(f.path)}</span>
                    <span className="modal-files-name">{f.path}</span>
                    <span className="modal-files-fsize">{formatSize(f.size)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          {/* Right: editor */}
          <div className="modal-editor">
            {selectedFile === "SKILL.md" ? (
              monacoReady ? (
                <Editor
                  language="markdown"
                  options={{
                    automaticLayout: true,
                    fontSize: 13,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    wordWrap: "on",
                  }}
                  value={doc?.body ?? ""}
                  onChange={(value) =>
                    setDoc((prev) => (prev ? { ...prev, body: value ?? "" } : prev))
                  }
                />
              ) : (
                <div className="modal-editor-placeholder">
                  <p className="modal-editor-placeholder-file">SKILL.md</p>
                  <p className="modal-editor-placeholder-hint">{t("editor.loading")}</p>
                </div>
              )
            ) : (
              <div className="modal-editor-placeholder">
                <p className="modal-editor-placeholder-file">{selectedFile}</p>
                <p className="modal-editor-placeholder-hint">
                  {t("editor.readonlyHint")}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

