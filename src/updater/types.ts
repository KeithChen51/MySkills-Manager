import type { UpdateSettings, VersionJumpInfo } from "../api/tauri";

export type UpdateCheckSource = "auto" | "manual";

export type UpdateActionState = "hidden" | "available" | "downloading" | "ready";

export type UpdateAction = {
  state: UpdateActionState;
  version: string | null;
  progress: number;
  requiresInstall: boolean;
};

export type UpdateInfo = {
  currentVersion: string;
  latestVersion: string;
  releaseNotes: string;
  releaseNotesZh: string;
  downloadUrl: string;
};

export type UpdateDialogState = {
  open: boolean;
  source: UpdateCheckSource;
  checking: boolean;
  checkError: string;
  noUpdate: boolean;
  updateInfo: UpdateInfo | null;
};

export type UpdaterStore = {
  settings: UpdateSettings;
  settingsLoading: boolean;
  settingsSaving: boolean;
  dialog: UpdateDialogState;
  action: UpdateAction;
  retryStatus: string;
  actionError: string;
  actionErrorDetails: string;
  restarting: boolean;
  silentReadyVersion: string | null;
  versionJumpInfo: VersionJumpInfo | null;
  startupChecked: boolean;
};
