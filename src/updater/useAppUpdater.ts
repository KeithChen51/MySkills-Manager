import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update as UpdaterUpdate } from "@tauri-apps/plugin-updater";

import {
  checkVersionJump,
  getUpdateSettings,
  savePendingUpdateNotes,
  saveUpdateSettings,
  shouldCheckUpdates,
  type UpdateSettings,
  type VersionJumpInfo,
  updateLastCheckTime,
  updateLog,
} from "../api/tauri";
import { parseUpdaterReleaseNotes, resolveUpdaterDownloadUrl } from "./releaseNotes";
import {
  createUpdaterCanceledError,
  isRetryableUpdaterError,
  isUpdaterCanceledError,
  retryWithBackoff,
  sanitizeUpdaterErrorMessage,
  UPDATE_CHECK_RETRY_DELAYS_MS,
  UPDATE_DOWNLOAD_RETRY_DELAYS_MS,
} from "./retry";
import {
  cancelToAvailableOrHidden,
  INITIAL_UPDATE_ACTION,
  toAvailable,
  toDownloading,
  toReady,
  withProgress,
} from "./stateMachine";
import type { UpdateAction, UpdateCheckSource, UpdateDialogState, UpdaterStore } from "./types";

const DEFAULT_UPDATE_SETTINGS: UpdateSettings = {
  auto_check: true,
  last_check_time: 0,
  check_interval_hours: 24,
  auto_install: false,
  last_run_version: "",
};

const INITIAL_DIALOG: UpdateDialogState = {
  open: false,
  source: "auto",
  checking: false,
  checkError: "",
  noUpdate: false,
  updateInfo: null,
};

const INITIAL_STORE: UpdaterStore = {
  settings: DEFAULT_UPDATE_SETTINGS,
  settingsLoading: true,
  settingsSaving: false,
  dialog: INITIAL_DIALOG,
  action: INITIAL_UPDATE_ACTION,
  retryStatus: "",
  actionError: "",
  actionErrorDetails: "",
  restarting: false,
  silentReadyVersion: null,
  versionJumpInfo: null,
  startupChecked: false,
};

type CheckResult = {
  hasUpdate: boolean;
  latestVersion?: string;
};

type UseAppUpdaterOptions = {
  enabled: boolean;
};

export function useAppUpdater(options: UseAppUpdaterOptions) {
  const [store, setStore] = useState<UpdaterStore>(INITIAL_STORE);
  const pendingUpdateRef = useRef<UpdaterUpdate | null>(null);
  const activeDownloadRef = useRef<UpdaterUpdate | null>(null);
  const cancelRequestedRef = useRef(false);
  const downloadTaskIdRef = useRef(0);

  const writeUpdaterLog = useCallback((level: "info" | "warn" | "error", message: string) => {
    void updateLog(level, message).catch(() => {});
  }, []);

  const closeUpdaterHandle = useCallback(async (handle: UpdaterUpdate | null | undefined) => {
    if (!handle) {
      return;
    }
    await handle.close().catch(() => {});
  }, []);

  const loadSettings = useCallback(async () => {
    setStore((prev) => ({
      ...prev,
      settingsLoading: true,
    }));
    try {
      const settings = await getUpdateSettings();
      setStore((prev) => ({
        ...prev,
        settings,
        settingsLoading: false,
      }));
    } catch (error) {
      writeUpdaterLog("warn", `load settings failed: ${sanitizeUpdaterErrorMessage(error)}`);
      setStore((prev) => ({
        ...prev,
        settingsLoading: false,
      }));
    }
  }, [writeUpdaterLog]);

  const persistSettingsPatch = useCallback(
    async (patch: Partial<UpdateSettings>) => {
      let nextSettings = DEFAULT_UPDATE_SETTINGS;
      setStore((prev) => {
        nextSettings = {
          ...prev.settings,
          ...patch,
        };
        return {
          ...prev,
          settings: nextSettings,
          settingsSaving: true,
        };
      });
      try {
        await saveUpdateSettings(nextSettings);
        setStore((prev) => ({
          ...prev,
          settingsSaving: false,
        }));
      } catch (error) {
        writeUpdaterLog("error", `save settings failed: ${sanitizeUpdaterErrorMessage(error)}`);
        setStore((prev) => ({
          ...prev,
          settingsSaving: false,
        }));
        await loadSettings();
      }
    },
    [loadSettings, writeUpdaterLog],
  );

  const checkForUpdatesWithRetry = useCallback(
    async (source: UpdateCheckSource): Promise<CheckResult> => {
      const update = await retryWithBackoff(
        async () => check(),
        {
          delaysMs: UPDATE_CHECK_RETRY_DELAYS_MS,
          shouldRetry: isRetryableUpdaterError,
          onRetry: ({ retryIndex, totalRetries }) => {
            setStore((prev) => ({
              ...prev,
              retryStatus: `check retry ${retryIndex}/${totalRetries}`,
            }));
          },
        },
      );

      if (!update) {
        setStore((prev) => ({
          ...prev,
          retryStatus: "",
          dialog: source === "manual"
            ? {
                ...prev.dialog,
                checking: false,
                noUpdate: true,
                checkError: "",
                updateInfo: null,
              }
            : prev.dialog,
        }));
        return { hasUpdate: false };
      }

      const parsedNotes = parseUpdaterReleaseNotes(update.body);
      const currentVersion = update.currentVersion || (await getVersion());
      setStore((prev) => {
        const alreadyReady =
          prev.action.state === "ready" && prev.action.version === update.version;
        const nextAction: UpdateAction = alreadyReady ? prev.action : toAvailable(update.version);
        return {
          ...prev,
          retryStatus: "",
          actionError: "",
          actionErrorDetails: "",
          action: nextAction,
          dialog: {
            ...prev.dialog,
            checking: false,
            noUpdate: false,
            checkError: "",
            updateInfo: {
              currentVersion,
              latestVersion: update.version,
              releaseNotes: parsedNotes.releaseNotes,
              releaseNotesZh: parsedNotes.releaseNotesZh,
              downloadUrl: resolveUpdaterDownloadUrl(update.version, update.rawJson),
            },
          },
        };
      });
      writeUpdaterLog("info", `check complete (${source}), found update ${update.version}`);
      return {
        hasUpdate: true,
        latestVersion: update.version,
      };
    },
    [writeUpdaterLog],
  );

  const cancelDownload = useCallback(async () => {
    if (store.action.state !== "downloading") {
      return;
    }
    cancelRequestedRef.current = true;
    downloadTaskIdRef.current += 1;
    setStore((prev) => ({
      ...prev,
      retryStatus: "",
      actionError: "",
      actionErrorDetails: "",
    }));
    const active = activeDownloadRef.current;
    if (active) {
      await closeUpdaterHandle(active);
      activeDownloadRef.current = null;
    }
    setStore((prev) => ({
      ...prev,
      action: cancelToAvailableOrHidden(prev.action),
    }));
    writeUpdaterLog("info", "download canceled by user");
  }, [closeUpdaterHandle, store.action.state, writeUpdaterLog]);

  const downloadUpdate = useCallback(
    async (expectedVersion: string, silent = false) => {
      const taskId = Date.now();
      cancelRequestedRef.current = false;
      downloadTaskIdRef.current = taskId;
      setStore((prev) => ({
        ...prev,
        retryStatus: "",
        actionError: "",
        actionErrorDetails: "",
        action: toDownloading(expectedVersion),
      }));
      writeUpdaterLog("info", `download start: ${expectedVersion}`);

      try {
        const downloadedUpdate = await retryWithBackoff(
          async () => {
            if (cancelRequestedRef.current || downloadTaskIdRef.current !== taskId) {
              throw createUpdaterCanceledError();
            }

            const candidate = await check();
            if (!candidate) {
              throw new Error("No update available from updater plugin");
            }
            activeDownloadRef.current = candidate;

            const notes = parseUpdaterReleaseNotes(candidate.body);
            await savePendingUpdateNotes(
              candidate.version,
              notes.releaseNotes,
              notes.releaseNotesZh,
            ).catch((error) => {
              writeUpdaterLog("warn", `cache pending notes failed: ${sanitizeUpdaterErrorMessage(error)}`);
            });

            let downloaded = 0;
            let contentLength = 0;
            await candidate.download((event: DownloadEvent) => {
              if (cancelRequestedRef.current || downloadTaskIdRef.current !== taskId) {
                throw createUpdaterCanceledError();
              }
              setStore((prev) => {
                if (prev.action.state !== "downloading") {
                  return prev;
                }
                if (event.event === "Started") {
                  contentLength = event.data.contentLength ?? 0;
                  return {
                    ...prev,
                    action: {
                      ...withProgress(prev.action, 0, candidate.version),
                    },
                  };
                }
                if (event.event === "Progress") {
                  downloaded += event.data.chunkLength;
                  const nextProgress = contentLength > 0
                    ? Math.min(100, Math.round((downloaded / contentLength) * 100))
                    : Math.min(95, prev.action.progress + 1);
                  return {
                    ...prev,
                    action: {
                      ...withProgress(prev.action, nextProgress, candidate.version),
                    },
                  };
                }
                return {
                  ...prev,
                  action: {
                    ...withProgress(prev.action, 100, candidate.version),
                  },
                };
              });
            });

            if (cancelRequestedRef.current || downloadTaskIdRef.current !== taskId) {
              throw createUpdaterCanceledError();
            }
            return candidate;
          },
          {
            delaysMs: UPDATE_DOWNLOAD_RETRY_DELAYS_MS,
            shouldRetry: isRetryableUpdaterError,
            onRetry: ({ retryIndex, totalRetries }) => {
              setStore((prev) => ({
                ...prev,
                retryStatus: `download retry ${retryIndex}/${totalRetries}`,
                action: prev.action.state === "downloading"
                  ? {
                      ...prev.action,
                      progress: 0,
                    }
                  : prev.action,
              }));
            },
          },
        );

        if (pendingUpdateRef.current) {
          await closeUpdaterHandle(pendingUpdateRef.current);
        }
        pendingUpdateRef.current = downloadedUpdate;
        activeDownloadRef.current = null;
        setStore((prev) => ({
          ...prev,
          retryStatus: "",
          actionError: "",
          actionErrorDetails: "",
          action: toReady(downloadedUpdate.version),
          silentReadyVersion: silent ? downloadedUpdate.version : prev.silentReadyVersion,
        }));
        writeUpdaterLog("info", `download ready: ${downloadedUpdate.version}`);
      } catch (error) {
        if (isUpdaterCanceledError(error) || cancelRequestedRef.current) {
          setStore((prev) => ({
            ...prev,
            retryStatus: "",
            actionError: "",
            actionErrorDetails: "",
          }));
          return;
        }
        setStore((prev) => ({
          ...prev,
          retryStatus: "",
          actionError: "auto update failed",
          actionErrorDetails: sanitizeUpdaterErrorMessage(error),
          action: cancelToAvailableOrHidden(prev.action),
        }));
        writeUpdaterLog("error", `download failed: ${sanitizeUpdaterErrorMessage(error)}`);
      }
    },
    [closeUpdaterHandle, writeUpdaterLog],
  );

  const restartAndApply = useCallback(async () => {
    setStore((prev) => ({
      ...prev,
      restarting: true,
    }));
    try {
      const pending = pendingUpdateRef.current;
      if (pending) {
        await pending.install();
      }
      await closeUpdaterHandle(pending);
      pendingUpdateRef.current = null;
      setStore((prev) => ({
        ...prev,
        restarting: false,
        silentReadyVersion: null,
        action: INITIAL_UPDATE_ACTION,
        dialog: {
          ...prev.dialog,
          open: false,
        },
      }));
      await relaunch();
    } catch (error) {
      setStore((prev) => ({
        ...prev,
        restarting: false,
        actionError: "restart apply failed",
        actionErrorDetails: sanitizeUpdaterErrorMessage(error),
      }));
      writeUpdaterLog("error", `restart apply failed: ${sanitizeUpdaterErrorMessage(error)}`);
    }
  }, [closeUpdaterHandle, writeUpdaterLog]);

  const openManualCheckDialog = useCallback(async () => {
    setStore((prev) => ({
      ...prev,
      retryStatus: "",
      actionError: "",
      actionErrorDetails: "",
      dialog: {
        ...prev.dialog,
        open: true,
        source: "manual",
        checking: true,
        noUpdate: false,
        checkError: "",
      },
    }));
    try {
      await checkForUpdatesWithRetry("manual");
      await updateLastCheckTime().catch(() => {});
    } catch (error) {
      setStore((prev) => ({
        ...prev,
        retryStatus: "",
        dialog: {
          ...prev.dialog,
          checking: false,
          checkError: sanitizeUpdaterErrorMessage(error),
          noUpdate: false,
          updateInfo: null,
        },
      }));
      writeUpdaterLog("error", `manual check failed: ${sanitizeUpdaterErrorMessage(error)}`);
    }
  }, [checkForUpdatesWithRetry, writeUpdaterLog]);

  const closeDialog = useCallback(() => {
    if (store.action.state === "downloading") {
      void cancelDownload();
    }
    setStore((prev) => ({
      ...prev,
      dialog: {
        ...prev.dialog,
        open: false,
      },
    }));
  }, [cancelDownload, store.action.state]);

  const handlePrimaryAction = useCallback(async () => {
    if (store.action.state === "ready") {
      await restartAndApply();
      return;
    }
    const targetVersion = store.action.version || store.dialog.updateInfo?.latestVersion || "";
    if (!targetVersion) {
      return;
    }
    await downloadUpdate(targetVersion, false);
  }, [downloadUpdate, restartAndApply, store.action.state, store.action.version, store.dialog.updateInfo]);

  useEffect(() => {
    if (!options.enabled) {
      return;
    }
    void loadSettings();
    let active = true;
    void checkVersionJump()
      .then((jump) => {
        if (!active || !jump) {
          return;
        }
        setStore((prev) => ({
          ...prev,
          versionJumpInfo: jump as VersionJumpInfo,
        }));
      })
      .catch(() => {});
    return () => {
      active = false;
      const pending = pendingUpdateRef.current;
      const activeDownload = activeDownloadRef.current;
      void closeUpdaterHandle(pending);
      void closeUpdaterHandle(activeDownload);
      pendingUpdateRef.current = null;
      activeDownloadRef.current = null;
    };
  }, [closeUpdaterHandle, loadSettings, options.enabled]);

  useEffect(() => {
    if (!options.enabled || store.settingsLoading || store.startupChecked) {
      return;
    }
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          if (!store.settings.auto_check) {
            return;
          }
          const shouldCheck = await shouldCheckUpdates().catch(() => true);
          if (!shouldCheck) {
            return;
          }
          const result = await checkForUpdatesWithRetry("auto");
          if (result.hasUpdate) {
            if (store.settings.auto_install && result.latestVersion) {
              await downloadUpdate(result.latestVersion, true);
            } else {
              setStore((prev) => ({
                ...prev,
                dialog: {
                  ...prev.dialog,
                  open: true,
                  source: "auto",
                },
              }));
            }
          }
          await updateLastCheckTime().catch(() => {});
        } catch (error) {
          writeUpdaterLog("error", `startup check failed: ${sanitizeUpdaterErrorMessage(error)}`);
        } finally {
          setStore((prev) => ({
            ...prev,
            startupChecked: true,
          }));
        }
      })();
    }, 6000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    checkForUpdatesWithRetry,
    downloadUpdate,
    options.enabled,
    store.settings,
    store.settingsLoading,
    store.startupChecked,
    writeUpdaterLog,
  ]);

  const dismissSilentReady = useCallback(() => {
    setStore((prev) => ({
      ...prev,
      silentReadyVersion: null,
    }));
  }, []);

  const dismissVersionJump = useCallback(() => {
    setStore((prev) => ({
      ...prev,
      versionJumpInfo: null,
    }));
  }, []);

  return {
    ...store,
    setUpdaterSettings: persistSettingsPatch,
    openManualCheckDialog,
    closeDialog,
    handlePrimaryAction,
    cancelDownload,
    restartAndApply,
    dismissSilentReady,
    dismissVersionJump,
  };
}
