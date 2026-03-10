export function parseUpdaterReleaseNotes(body: string | null | undefined): {
  releaseNotes: string;
  releaseNotesZh: string;
} {
  if (!body || !body.trim()) {
    return {
      releaseNotes: "",
      releaseNotesZh: "",
    };
  }

  const normalized = body.trim();
  if (normalized.startsWith("{") && normalized.endsWith("}")) {
    try {
      const parsed = JSON.parse(normalized) as {
        release_notes?: string;
        release_notes_zh?: string;
      };
      const releaseNotes = parsed.release_notes?.trim() ?? "";
      const releaseNotesZh = parsed.release_notes_zh?.trim() ?? "";
      return {
        releaseNotes: releaseNotes || normalized,
        releaseNotesZh: releaseNotesZh || releaseNotes || normalized,
      };
    } catch {
      // fall through to plain text body
    }
  }

  return {
    releaseNotes: normalized,
    releaseNotesZh: normalized,
  };
}

export function resolveUpdaterDownloadUrl(version: string, rawJson: unknown): string {
  const fallback = `https://github.com/KeithChen51/MySkills-Manager/releases/tag/v${version}`;
  if (!rawJson || typeof rawJson !== "object") {
    return fallback;
  }

  const normalized = rawJson as {
    platforms?: Record<string, { url?: string }>;
  };
  const windowsUrl =
    normalized.platforms?.["windows-x86_64"]?.url
    ?? normalized.platforms?.["windows-x86_64-nsis"]?.url
    ?? "";
  if (windowsUrl.trim()) {
    return windowsUrl.trim();
  }
  return fallback;
}
