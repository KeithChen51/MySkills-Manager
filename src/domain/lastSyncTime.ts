const BEIJING_TIME_ZONE = "Asia/Shanghai";

export function formatLastSyncTime(
  value: string | undefined,
  locale: string,
  neverLabel: string,
  timeZone = BEIJING_TIME_ZONE,
): string {
  if (!value) {
    return neverLabel;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  const formatter = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  });

  return formatter.format(parsed);
}
