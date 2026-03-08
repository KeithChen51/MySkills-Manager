/** SVG icon components (Lucide-style, 24x24 viewBox). */

type IconProps = { size?: number; className?: string };

const defaults = { size: 20 };

function svg(props: IconProps, d: string) {
    const s = props.size ?? defaults.size;
    return (
        <svg
            width={s}
            height={s}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d={d} />
        </svg>
    );
}

/* multi-path SVG helper */
function svgMulti(props: IconProps, paths: string[]) {
    const s = props.size ?? defaults.size;
    return (
        <svg
            width={s}
            height={s}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            {paths.map((d, i) => (
                <path key={i} d={d} />
            ))}
        </svg>
    );
}

/** Hexagon / Skills */
export function IconSkills(p: IconProps = {}) {
    return svgMulti(p, [
        "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z",
        "M12 22V12",
        "M3.27 6.96 12 12.01l8.73-5.05",
    ]);
}

/** BarChart3 / Dashboard */
export function IconDashboard(p: IconProps = {}) {
    return svgMulti(p, [
        "M3 3v18h18",
        "M18 17V9",
        "M13 17V5",
        "M8 17v-3",
    ]);
}

/** List / Logs */
export function IconLogs(p: IconProps = {}) {
    return svgMulti(p, [
        "M8 6h13",
        "M8 12h13",
        "M8 18h13",
        "M3 6h.01",
        "M3 12h.01",
        "M3 18h.01",
    ]);
}

/** Wrench / Tools */
export function IconTools(p: IconProps = {}) {
    return svg(
        p,
        "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
    );
}

/** FileText / Rules */
export function IconRules(p: IconProps = {}) {
    return svgMulti(p, [
        "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z",
        "M14 2v6h6",
        "M16 13H8",
        "M16 17H8",
        "M10 9H8",
    ]);
}

/** GitBranch / Git */
export function IconGit(p: IconProps = {}) {
    return svgMulti(p, [
        "M6 3v12",
        "M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
        "M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
        "M18 9a9 9 0 0 1-9 9",
    ]);
}

/** Settings / Gear */
export function IconSettings(p: IconProps = {}) {
    return svgMulti(p, [
        "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
        "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1.08z",
    ]);
}

/** Sun */
export function IconSun(p: IconProps = {}) {
    return svgMulti(p, [
        "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z",
        "M12 1v2",
        "M12 21v2",
        "M4.22 4.22l1.42 1.42",
        "M18.36 18.36l1.42 1.42",
        "M1 12h2",
        "M21 12h2",
        "M4.22 19.78l1.42-1.42",
        "M18.36 5.64l1.42-1.42",
    ]);
}

/** Moon */
export function IconMoon(p: IconProps = {}) {
    return svg(p, "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z");
}

/** Search */
export function IconSearch(p: IconProps = {}) {
    return svgMulti(p, [
        "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z",
        "M21 21l-4.35-4.35",
    ]);
}

/** Edit / Pencil */
export function IconEdit(p: IconProps = {}) {
    return svgMulti(p, [
        "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7",
        "M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z",
    ]);
}

/** MoreHorizontal / Ellipsis */
export function IconMoreHorizontal(p: IconProps = {}) {
    return svgMulti(p, ["M5 12h.01", "M12 12h.01", "M19 12h.01"]);
}

/** Trash2 */
export function IconTrash(p: IconProps = {}) {
    return svgMulti(p, [
        "M3 6h18",
        "M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2",
        "M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14",
        "M10 11v6",
        "M14 11v6",
    ]);
}

/** X / Close */
export function IconClose(p: IconProps = {}) {
    return svgMulti(p, ["M18 6 6 18", "M6 6l12 12"]);
}

/** ChevronLeft */
export function IconChevronLeft(p: IconProps = {}) {
    return svg(p, "M15 18l-6-6 6-6");
}

/** ChevronRight */
export function IconChevronRight(p: IconProps = {}) {
    return svg(p, "M9 18l6-6-6-6");
}

/** Save */
export function IconSave(p: IconProps = {}) {
    return svgMulti(p, [
        "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z",
        "M17 21v-8H7v8",
        "M7 3v5h8",
    ]);
}

/** RefreshCw */
export function IconRefresh(p: IconProps = {}) {
    return svgMulti(p, [
        "M23 4v6h-6",
        "M1 20v-6h6",
        "M3.51 9a9 9 0 0 1 14.85-3.36L23 10",
        "M20.49 15a9 9 0 0 1-14.85 3.36L1 14",
    ]);
}

/** Plus */
export function IconPlus(p: IconProps = {}) {
    return svgMulti(p, ["M12 5v14", "M5 12h14"]);
}

/** Folder */
export function IconFolder(p: IconProps = {}) {
    return svgMulti(p, [
        "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
        "M3 10h18",
    ]);
}

/** FlaskConical / Eval */
export function IconEval(p: IconProps = {}) {
    return svgMulti(p, [
        "M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2",
        "M8.5 2h7",
        "M7 16.5h10",
    ]);
}
