import { useI18n } from "../i18n/I18nProvider";
import "./SilentUpdateToast.css";

type Props = {
  version: string;
  onRestart: () => void | Promise<void>;
  onDismiss: () => void;
};

export default function SilentUpdateToast({ version, onRestart, onDismiss }: Props) {
  const { t } = useI18n();
  return (
    <div className="silent-update-toast" role="status" aria-live="polite">
      <span className="silent-update-text">
        {t("settings.update.toast.ready", { version })}
      </span>
      <div className="silent-update-actions">
        <button type="button" className="btn btn-ghost" onClick={onDismiss}>
          {t("settings.update.dialog.later")}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void onRestart()}>
          {t("settings.update.dialog.restartNow")}
        </button>
      </div>
    </div>
  );
}
