import type { ReactNode } from "react";

import "./KpiCard.css";

type Props = {
    label: string;
    value: ReactNode;
    dimension?: string;
    description?: string;
    valueTone?: "default" | "positive" | "negative" | "neutral";
};

export default function KpiCard({
    label,
    value,
    dimension,
    description,
    valueTone = "default",
}: Props) {
    const tooltip = [dimension, description].filter(Boolean).join(" - ");

    return (
        <div className="kpi">
            <div className="kpi-label-row">
                <span className="kpi-label">{label}</span>
                {tooltip && (
                    <button
                        type="button"
                        className="kpi-help-icon"
                        title={tooltip}
                        aria-label={tooltip}
                    >
                        i
                    </button>
                )}
            </div>
            {dimension && <span className="kpi-dimension">{dimension}</span>}
            <strong className={`kpi-value ${valueTone}`}>{value}</strong>
        </div>
    );
}
