import { useCallback, useEffect, useState } from "react";

import { gitCommit, gitPush, gitStatus, type GitStatus } from "../api/tauri";
import KpiCard from "../components/KpiCard";
import { useI18n } from "../i18n/I18nProvider";
import "./GitPage.css";

export default function GitPage() {
  const { t } = useI18n();
  const [state, setState] = useState<GitStatus | null>(null);
  const [status, setStatus] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [actionStatus, setActionStatus] = useState("");
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);

  const refreshStatus = useCallback(async () => {
    setStatus(t("tools.loading"));
    try {
      const result = await gitStatus();
      setState(result);
      setStatus("");
    } catch (e: unknown) {
      setStatus(String(e));
    }
  }, [t]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  async function handleCommit() {
    if (committing || pushing) return;
    setCommitting(true);
    setActionStatus(t("git.committing"));
    void (async () => {
      try {
        const result = await gitCommit(commitMessage);
        setActionStatus(t("git.commit.ok", { hash: result.hash.slice(0, 8) }));
        setCommitMessage("");
        await refreshStatus();
      } catch (e: unknown) {
        setActionStatus(String(e));
      } finally {
        setCommitting(false);
      }
    })();
  }

  async function handlePush() {
    if (committing || pushing) return;
    setPushing(true);
    setActionStatus(t("git.pushing"));
    try {
      await gitPush();
      setActionStatus(t("git.push.ok"));
      await refreshStatus();
    } catch (e: unknown) {
      setActionStatus(String(e));
    } finally {
      setPushing(false);
    }
  }

  return (
    <div className="page animate-fadein">
      <header className="page-header">
        <h1 className="page-title">{t("git.title")}</h1>
        {status && <span className="page-count">{status}</span>}
      </header>

      <div className="kpi-row">
        <KpiCard label={t("git.branch")} value={state?.branch ?? "-"} />
        <KpiCard label={t("git.changed")} value={state?.changed.length ?? 0} />
        <KpiCard label={t("git.staged")} value={state?.staged.length ?? 0} />
        <KpiCard label={t("git.untracked")} value={state?.not_added.length ?? 0} />
      </div>

      <article className="chart-card">
        <h3 className="chart-title">{t("git.actions")}</h3>
        <div className="git-actions">
          <label className="field git-field">
            <span className="field-label">{t("git.commit.message")}</span>
            <input
              className="field-input"
              value={commitMessage}
              placeholder={t("git.commit.placeholder")}
              onChange={(e) => setCommitMessage(e.target.value)}
            />
          </label>
          <div className="git-action-buttons">
            <button
              className="btn btn-primary"
              onClick={() => void handleCommit()}
              disabled={committing || pushing || commitMessage.trim().length === 0}
            >
              {committing ? t("git.committing") : t("git.commit")}
            </button>
            <button className="btn btn-ghost" onClick={() => void handlePush()} disabled={committing || pushing}>
              {pushing ? t("git.pushing") : t("git.push")}
            </button>
            <button className="btn btn-ghost" onClick={() => void refreshStatus()} disabled={committing || pushing}>
              {t("git.refresh")}
            </button>
          </div>
          {actionStatus && <p className="git-action-status">{actionStatus}</p>}
        </div>
      </article>

      <div className="chart-row">
        <article className="chart-card">
          <h3 className="chart-title">{t("git.changedFiles")}</h3>
          {(state?.changed.length ?? 0) === 0 ? (
            <p className="empty-state">{t("git.empty.changed")}</p>
          ) : (
            <ul className="item-list">{state?.changed.map((f) => <li key={f}>{f}</li>)}</ul>
          )}
        </article>
        <article className="chart-card">
          <h3 className="chart-title">{t("git.stagedFiles")}</h3>
          {(state?.staged.length ?? 0) === 0 ? (
            <p className="empty-state">{t("git.empty.staged")}</p>
          ) : (
            <ul className="item-list">{state?.staged.map((f) => <li key={f}>{f}</li>)}</ul>
          )}
        </article>
      </div>

      <article className="chart-card">
        <h3 className="chart-title">{t("git.untrackedFiles")}</h3>
        {(state?.not_added.length ?? 0) === 0 ? (
          <p className="empty-state">{t("git.empty.untracked")}</p>
        ) : (
          <ul className="item-list">{state?.not_added.map((f) => <li key={f}>{f}</li>)}</ul>
        )}
      </article>
    </div>
  );
}
