import "./KpiCard.css";

type Props = {
    label: string;
    value: string | number;
    dimension?: string;
    description?: string;
};

export default function KpiCard({ label, value, dimension, description }: Props) {
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
            <strong className="kpi-value">{value}</strong>
        </div>
    );
}
