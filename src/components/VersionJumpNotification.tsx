import { useMemo } from "react";
import { useI18n } from "../i18n/I18nProvider";
import type { VersionJumpInfo } from "../api/tauri";
import "./VersionJumpNotification.css";

type Props = {
  info: VersionJumpInfo;
  onClose: () => void;
};

export default function VersionJumpNotification({ info, onClose }: Props) {
  const { t, locale } = useI18n();

  const notes = useMemo(() => {
    if (locale === "zh-CN" && info.release_notes_zh.trim()) {
      return info.release_notes_zh;
    }
    return info.release_notes;
  }, [info.release_notes, info.release_notes_zh, locale]);

  return (
    <div
      className="version-jump-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t("settings.update.versionJump.title")}
      onClick={onClose}
    >
      <div className="version-jump-modal chart-card" onClick={(event) => event.stopPropagation()}>
        <header className="version-jump-header">
          <h2>{t("settings.update.versionJump.title")}</h2>
          <button
            type="button"
            className="version-jump-close"
            onClick={onClose}
            aria-label={t("settings.update.dialog.close")}
            title={t("settings.update.dialog.close")}
          >
            ×
          </button>
        </header>
        <p className="version-jump-subtitle">
          {t("settings.update.versionJump.fromTo", {
            previous: info.previous_version,
            current: info.current_version,
          })}
        </p>

        {notes.trim() ? (
          <pre className="version-jump-notes">{notes}</pre>
        ) : (
          <p className="version-jump-empty">{t("settings.update.versionJump.noNotes")}</p>
        )}

        <footer className="version-jump-footer">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {t("settings.update.versionJump.close")}
          </button>
        </footer>
      </div>
    </div>
  );
}

