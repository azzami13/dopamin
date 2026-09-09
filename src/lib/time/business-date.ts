const DATE_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jakarta",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jakarta",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function jakartaDate(now = new Date()): string {
  const parts = DATE_FORMAT.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function jakartaTime(now = new Date()): string {
  return TIME_FORMAT.format(now);
}

export function previousDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() - 1);
  return utc.toISOString().slice(0, 10);
}

export function previousJakartaBusinessDate(now = new Date()): string {
  return previousDate(jakartaDate(now));
}

export function isIsoBusinessDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function timeAtOrAfter(nowHHMM: string, scheduled: string): boolean {
  return nowHHMM.slice(0, 5) >= scheduled.slice(0, 5);
}
