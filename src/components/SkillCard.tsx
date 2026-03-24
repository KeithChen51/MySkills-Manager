import { useEffect, useMemo, useRef, useState } from "react";

import type { SkillInsight } from "../api/tauri";
import {
  evalTrend,
  trendFromValues,
  usageCountForWindow,
  usagePrevCountForWindow,
  type InsightTrend,
  type SkillInsightWindow,
} from "../domain/skillInsights";
import { formatLogTimestamp } from "../domain/logTimestamp";
import { formatTaxonomyTagLabel } from "../domain/skillTaxonomyDisplay";
import { IconEdit, IconMoreHorizontal, IconTrash } from "./icons";
import { useI18n } from "../i18n/I18nProvider";
import "./SkillCard.css";

type Props = {
  name: string;
  description?: string;
  category?: string;
  tags?: string[];
  insightWindow: SkillInsightWindow;
  insight?: SkillInsight | null;
  onEdit: () => void;
  onViewInsights: () => void;
  onDelete: () => void;
  deleteBusy?: boolean;
};

export default function SkillCard({
  name,
  description,
  category,
  tags,
  insightWindow,
  insight,
  onEdit,
  onViewInsights,
  onDelete,
  deleteBusy = false,
}: Props) {
  const { t, locale } = useI18n();
  const preferChineseTaxonomy = locale.toLowerCase().startsWith("zh");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const chips = useMemo(() => {
    const out: string[] = [];
    if (category) {
      out.push(category);
    }
    for (const tag of tags ?? []) {
      if (!out.includes(tag)) {
        out.push(tag);
      }
    }
    return out.slice(0, 3);
  }, [category, tags]);

  const avatarVariant = useMemo(() => {
    let hash = 0;
    for (let i = 0; i < name.length; i += 1) {
      hash = (hash << 5) - hash + name.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) % 5;
  }, [name]);

  const avatarLabel = useMemo(() => {
    const normalized = name.trim();
    if (!normalized) {
      return "*";
    }
    const chars = Array.from(normalized);
    const firstVisible = chars.find((char) => /[\p{L}\p{N}]/u.test(char)) ?? chars[0];
    return /^[a-z]$/i.test(firstVisible) ? firstVisible.toUpperCase() : firstVisible;
  }, [name]);

  const usageCount = insight ? usageCountForWindow(insight.usage, insightWindow) : null;
  const usagePrev = insight ? usagePrevCountForWindow(insight.usage, insightWindow) : null;
  const usageTrend = trendFromValues(usageCount, usagePrev);
  const evalPassRate = insight?.eval.latestPassRate ?? null;
  const evalTrendDirection = insight ? evalTrend(insight.eval) : "na";
  const lastUsedText = insight?.usage.lastUsedAt
    ? formatLogTimestamp(insight.usage.lastUsedAt, locale)
    : t("skills.insights.usage.lastUsed.empty");
  const evalStatusText = insight?.eval.latestStatus ?? t("skills.insights.eval.status.none");

  function trendGlyph(direction: InsightTrend): string {
    if (direction === "up") return "^";
    if (direction === "down") return "v";
    if (direction === "flat") return "=";
    return ".";
  }

  function trendText(direction: InsightTrend): string {
    if (direction === "up") return t("skills.insights.trend.up");
    if (direction === "down") return t("skills.insights.trend.down");
    if (direction === "flat") return t("skills.insights.trend.flat");
    return t("skills.insights.trend.na");
  }

  useEffect(() => {
    if (!menuOpen) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  function runMenuAction(action: () => void) {
    setMenuOpen(false);
    action();
  }

  return (
    <article className="skill-card">
      <button type="button" className="skill-card-primary-btn" onClick={onEdit} aria-label={t("skill.edit")}>
        <div className="skill-card-main">
          <div className={`skill-card-avatar skill-card-avatar-${avatarVariant}`} aria-hidden="true">
            <span className="skill-card-avatar-label">{avatarLabel}</span>
          </div>
          <div className="skill-card-copy">
            <h3 className="skill-card-name">{name}</h3>
            <p className="skill-card-desc">{description || t("skill.noDesc")}</p>
          </div>
        </div>

        <div className="skill-card-insights">
          <div className="skill-card-insight-row">
            <span className="skill-card-insight-label">
              {t("skills.insights.usage.window", { days: insightWindow })}
            </span>
            <strong className="skill-card-insight-value">{usageCount ?? "--"}</strong>
            <span className={`skill-card-insight-trend ${usageTrend}`}>
              {trendGlyph(usageTrend)} {trendText(usageTrend)}
            </span>
          </div>
          <div className="skill-card-insight-row">
            <span className="skill-card-insight-label">{t("skills.insights.eval.passRate")}</span>
            <strong className="skill-card-insight-value">
              {evalPassRate === null ? "--" : `${Math.round(evalPassRate * 100)}%`}
            </strong>
            <span className={`skill-card-insight-trend ${evalTrendDirection}`}>
              {trendGlyph(evalTrendDirection)} {trendText(evalTrendDirection)}
            </span>
          </div>
          <div className="skill-card-insight-meta">
            <span>{t("skills.insights.usage.lastUsed", { time: lastUsedText })}</span>
            <span>{t("skills.insights.eval.latestStatus", { status: evalStatusText })}</span>
          </div>
        </div>
      </button>

      <div className="skill-card-divider" />

      <div className="skill-card-footer">
        <div className="skill-card-enable">
          <span className="skill-card-enable-label">{t("skills.enableFor")}</span>
          {chips.length > 0 ? (
            <div className="skill-card-tags">
              {chips.map((chip) => (
                <span key={chip} className="skill-card-tag">
                  {formatTaxonomyTagLabel(chip, preferChineseTaxonomy)}
                </span>
              ))}
              {(tags?.length ?? 0) > chips.length && (
                <span className="skill-card-tag">+{(tags?.length ?? 0) - chips.length}</span>
              )}
            </div>
          ) : (
            <span className="skill-card-empty">{t("skills.enableFor.empty")}</span>
          )}
        </div>
        <button
          className="btn btn-ghost skill-card-detail-btn"
          onClick={onViewInsights}
        >
          {t("skills.insights.detail")}
        </button>
        <div className="skill-card-actions" ref={menuRef} onClick={(e) => e.stopPropagation()}>
          <button
            className="skill-card-menu-trigger"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={t("skill.actions")}
            title={t("skill.actions")}
            onClick={() => setMenuOpen((prev) => !prev)}
          >
            <IconMoreHorizontal size={16} />
          </button>
          {menuOpen && (
            <div className="skill-card-menu" role="menu">
              <button
                className="skill-card-menu-item"
                role="menuitem"
                onClick={() => runMenuAction(onEdit)}
              >
                <IconEdit size={14} />
                {t("skill.edit")}
              </button>
              <button
                className="skill-card-menu-item danger"
                role="menuitem"
                onClick={() => runMenuAction(onDelete)}
                disabled={deleteBusy}
              >
                <IconTrash size={14} />
                {deleteBusy ? t("skill.delete.processing") : t("skill.delete")}
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
