import type { UpdateAction } from "./types";

export const INITIAL_UPDATE_ACTION: UpdateAction = {
  state: "hidden",
  version: null,
  progress: 0,
  requiresInstall: true,
};

export function toAvailable(version: string): UpdateAction {
  return {
    state: "available",
    version,
    progress: 0,
    requiresInstall: true,
  };
}

export function toDownloading(version: string): UpdateAction {
  return {
    state: "downloading",
    version,
    progress: 0,
    requiresInstall: true,
  };
}

export function toReady(version: string): UpdateAction {
  return {
    state: "ready",
    version,
    progress: 100,
    requiresInstall: true,
  };
}

export function withProgress(action: UpdateAction, progress: number, version?: string): UpdateAction {
  const clamped = Math.max(0, Math.min(100, Math.round(progress)));
  return {
    ...action,
    version: version ?? action.version,
    progress: clamped,
  };
}

export function cancelToAvailableOrHidden(action: UpdateAction): UpdateAction {
  if (action.version) {
    return toAvailable(action.version);
  }
  return INITIAL_UPDATE_ACTION;
}
