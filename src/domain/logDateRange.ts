const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

function parseYmd(value: string): [number, number, number] | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return undefined;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return undefined;
  }

  // Validate date parts by round-tripping through UTC.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return undefined;
  }

  return [year, month, day];
}

function toUtcIsoFromBeijingDate(
  value: string,
  hour: number,
  minute: number,
  second: number,
): string | undefined {
  const parts = parseYmd(value);
  if (!parts) {
    return undefined;
  }
  const [year, month, day] = parts;
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second) - BEIJING_OFFSET_MS;
  return new Date(utcMs).toISOString().replace(".000Z", "Z");
}

export function toIsoStart(value: string): string | undefined {
  return value ? toUtcIsoFromBeijingDate(value, 0, 0, 0) : undefined;
}

export function toIsoEnd(value: string): string | undefined {
  return value ? toUtcIsoFromBeijingDate(value, 23, 59, 59) : undefined;
}
