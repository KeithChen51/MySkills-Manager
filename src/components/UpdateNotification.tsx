import { useMemo, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import type { UpdateAction, UpdateInfo } from "../updater/types";
import "./UpdateNotification.css";

type Props = {
  open: boolean;
  checking: boolean;
  noUpdate: boolean;
  checkError: string;
  updateInfo: UpdateInfo | null;
  action: UpdateAction;
  retryStatus: string;
  actionError: string;
  actionErrorDetails: string;
  restarting: boolean;
  onClose: () => void;
  onPrimaryAction: () => void | Promise<void>;
  onRetryCheck: () => void | Promise<void>;
  onCancelDownload: () => void | Promise<void>;
};

function renderReleaseNotes(notes: string) {
  const lines = notes
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return null;
  }
  return (
    <ul className="update-release-notes-list">
      {lines.map((line, idx) => (
        <li key={`${line}-${idx}`}>{line.replace(/^- /, "")}</li>
      ))}
    </ul>
  );
}

export default function UpdateNotification({
  open,
  checking,
  noUpdate,
  checkError,
  updateInfo,
  action,
  retryStatus,
  actionError,
  actionErrorDetails,
  restarting,
  onClose,
  onPrimaryAction,
  onRetryCheck,
  onCancelDownload,
}: Props) {
  const { t, locale } = useI18n();
  const [showErrorDetails, setShowErrorDetails] = useState(false);

  const notes = useMemo(() => {
    if (!updateInfo) return "";
    if (locale === "zh-CN" && updateInfo.releaseNotesZh.trim()) {
      return updateInfo.releaseNotesZh;
    }
    return updateInfo.releaseNotes;
  }, [locale, updateInfo]);

  if (!open) {
    return null;
  }

  const isDownloading = action.state === "downloading";
  const isReady = action.state === "ready";
  const progress = Math.max(0, Math.min(100, Math.round(action.progress)));

  function handleOverlayClick() {
    if (isDownloading) {
      void onCancelDownload();
    }
    onClose();
  }

  function handleCloseClick() {
    if (isDownloading) {
      void onCancelDownload();
    }
    onClose();
  }

  function renderBody() {
    if (checking) {
      return (
        <p className="update-message">{t("settings.update.dialog.checking")}</p>
      );
    }

    if (noUpdate) {
      return (
        <p className="update-message">{t("settings.update.dialog.upToDate")}</p>
      );
    }

    if (checkError) {
      return (
        <div className="update-error-block">
          <p className="update-message update-message-error">
            {t("settings.update.dialog.checkFailed")}: {checkError}
          </p>
        </div>
      );
    }

    if (!updateInfo) {
      return null;
    }

    return (
      <>
        <p className="update-version">v{updateInfo.latestVersion}</p>
        <p className="update-message">
          {t("settings.update.dialog.message", {
            current: updateInfo.currentVersion,
          })}
        </p>

        {isDownloading && (
          <div className="update-progress">
            <div className="update-progress-bar">
              <div className="update-progress-fill" style={{ transform: `scaleX(${progress / 100})` }} />
            </div>
            <span className="update-progress-text">
              {t("settings.update.dialog.downloading")} {progress}%
            </span>
          </div>
        )}

        {retryStatus && (
          <p className="update-status update-status-retry">{retryStatus}</p>
        )}

        {actionError && !isDownloading && (
          <div className="update-error-block">
            <p className="update-status update-status-error">
              {t("settings.update.failed")}: {actionError}
            </p>
            {actionErrorDetails && (
              <button
                type="button"
                className="update-link-btn"
                onClick={() => setShowErrorDetails((prev) => !prev)}
              >
                {showErrorDetails
                  ? t("settings.update.dialog.hideErrorDetails")
                  : t("settings.update.dialog.showErrorDetails")}
              </button>
            )}
            {showErrorDetails && actionErrorDetails && (
              <p className="update-error-details">{actionErrorDetails}</p>
            )}
          </div>
        )}

        {notes && (
          <div className="update-release-notes">
            <h3>{t("settings.update.dialog.whatsNew")}</h3>
            <div className="update-release-notes-content">{renderReleaseNotes(notes)}</div>
          </div>
        )}
      </>
    );
  }

  function renderFooter() {
    if (checking) {
      return (
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {t("settings.update.dialog.close")}
        </button>
      );
    }

    if (noUpdate) {
      return (
        <button type="button" className="btn btn-primary" onClick={onClose}>
          {t("settings.update.dialog.close")}
        </button>
      );
    }

    if (checkError) {
      return (
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t("settings.update.dialog.close")}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void onRetryCheck()}>
            {t("settings.update.dialog.retryCheck")}
          </button>
        </>
      );
    }

    if (!updateInfo) {
      return null;
    }

    return (
      <>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            if (isDownloading) {
              void onCancelDownload();
            }
            onClose();
          }}
          disabled={restarting}
        >
          {isDownloading
            ? t("settings.update.dialog.cancelUpdate")
            : isReady
              ? t("settings.update.dialog.later")
              : t("settings.update.dialog.close")}
        </button>

        {actionError && updateInfo.downloadUrl && (
          <a
            className="btn btn-ghost update-manual-link"
            href={updateInfo.downloadUrl}
            target="_blank"
            rel="noreferrer"
          >
            {t("settings.update.dialog.downloadManually")}
          </a>
        )}

        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void onPrimaryAction()}
          disabled={isDownloading || restarting}
        >
          {restarting
            ? t("settings.update.dialog.restarting")
            : isReady
              ? t("settings.update.dialog.restartNow")
              : isDownloading
                ? t("settings.update.dialog.downloading")
                : t("settings.update.dialog.updateNow")}
        </button>
      </>
    );
  }

  return (
    <div
      className="update-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t("settings.update.dialog.title")}
      onClick={handleOverlayClick}
    >
      <div className="update-modal chart-card" onClick={(event) => event.stopPropagation()}>
        <header className="update-header">
          <h2>{t("settings.update.dialog.title")}</h2>
          <button
            type="button"
            className="update-close-btn"
            onClick={handleCloseClick}
            aria-label={t("settings.update.dialog.close")}
            title={t("settings.update.dialog.close")}
          >
            ×
          </button>
        </header>
        <div className="update-body">{renderBody()}</div>
        <footer className="update-footer">{renderFooter()}</footer>
      </div>
    </div>
  );
}

