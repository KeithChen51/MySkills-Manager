import {
    IconDashboard,
    IconEval,
    IconGit,
    IconLogs,
    IconSettings,
    IconSkills,
    IconTools,
} from "./icons";
import { useI18n } from "../i18n/I18nProvider";
import { useTheme } from "../theme/ThemeProvider";
import brandLogoTransparent from "../../skillar-design-pack/logo/skillar-logo-transparent.png";
import brandLogoWhiteBg from "../../skillar-design-pack/logo/skillar-logo-white-bg.png";
import "./Sidebar.css";

export type ViewName = "skills" | "dashboard" | "logs" | "tools" | "eval" | "git" | "settings";

type Props = {
    active: ViewName;
    onChange: (view: ViewName) => void;
};

export default function Sidebar({ active, onChange }: Props) {
    const { t } = useI18n();
    const { resolvedTheme } = useTheme();
    const brandLogoSrc = resolvedTheme === "dark" ? brandLogoWhiteBg : brandLogoTransparent;
    const betaLabel = "BETA";
    const navItems: { view: ViewName; icon: React.ReactNode; label: string; beta?: boolean }[] = [
        { view: "skills", icon: <IconSkills size={20} />, label: t("nav.skills") },
        { view: "tools", icon: <IconTools size={20} />, label: t("nav.tools") },
        { view: "dashboard", icon: <IconDashboard size={20} />, label: t("nav.dashboard") },
        { view: "logs", icon: <IconLogs size={20} />, label: t("nav.logs") },
        { view: "eval", icon: <IconEval size={20} />, label: t("nav.eval"), beta: true },
        { view: "git", icon: <IconGit size={20} />, label: t("nav.git") },
    ];

    return (
        <nav className="sidebar-nav">
            <div className="sidebar-top">
                <div className="sidebar-brand">
                    <div className="sidebar-logo" aria-label="Skillar logo">
                        <img src={brandLogoSrc} alt="Skillar" className="sidebar-logo-image" />
                    </div>
                    <div className="sidebar-brand-copy">
                        <strong className="sidebar-brand-text">Skillar</strong>
                        <span className="sidebar-brand-subtitle">MySkills Manager</span>
                    </div>
                </div>
                <div className="sidebar-items">
                    {navItems.map((item) => {
                        const label = item.beta
                            ? `${item.label} (${betaLabel})`
                            : item.label;
                        return (
                            <button
                                type="button"
                                key={item.view}
                                className={`sidebar-item${active === item.view ? " active" : ""}`}
                                onClick={() => onChange(item.view)}
                                aria-label={label}
                                title={label}
                            >
                                {item.icon}
                                <span className="sidebar-label-wrap">
                                    <span className="sidebar-label">{item.label}</span>
                                    {item.beta ? (
                                        <span className="sidebar-beta-badge">{betaLabel}</span>
                                    ) : null}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>
            <div className="sidebar-bottom">
                <button
                    type="button"
                    className={`sidebar-item sidebar-item-secondary${active === "settings" ? " active" : ""}`}
                    onClick={() => onChange("settings")}
                    aria-label={t("nav.settings")}
                    title={t("nav.settings")}
                >
                    <IconSettings size={20} />
                    <span className="sidebar-label">{t("nav.settings")}</span>
                </button>
            </div>
        </nav>
    );
}
