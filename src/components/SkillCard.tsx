import { useEffect, useMemo, useRef, useState } from "react";

import { IconEdit, IconMoreHorizontal, IconTrash } from "./icons";
import { useI18n } from "../i18n/I18nProvider";
import "./SkillCard.css";

type Props = {
  name: string;
  description?: string;
  category?: string;
  tags?: string[];
  onEdit: () => void;
  onDelete: () => void;
  deleteBusy?: boolean;
};

export default function SkillCard({
  name,
  description,
  category,
  tags,
  onEdit,
  onDelete,
  deleteBusy = false,
}: Props) {
  const { t } = useI18n();
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
    <article className="skill-card" onClick={onEdit}>
      <div className="skill-card-main">
        <div className={`skill-card-avatar skill-card-avatar-${avatarVariant}`} aria-hidden="true">
          <span className="skill-card-avatar-label">{avatarLabel}</span>
        </div>
        <div className="skill-card-copy">
          <h3 className="skill-card-name">{name}</h3>
          <p className="skill-card-desc">{description || t("skill.noDesc")}</p>
        </div>
      </div>

      <div className="skill-card-divider" />

      <div className="skill-card-footer">
        <div className="skill-card-enable">
          <span className="skill-card-enable-label">{t("skills.enableFor")}</span>
          {chips.length > 0 ? (
            <div className="skill-card-tags">
              {chips.map((chip) => (
                <span key={chip} className="skill-card-tag">
                  {chip}
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
