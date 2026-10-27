export const HOUR = 3600000;
export function deviceZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
export function validZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("ru", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
export function formatTime(at: number, zone: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
}
export function formatDate(at: number, zone: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: zone,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(at);
}
export function formatStamp(at: number | null, zone: string): string {
  return at === null
    ? "Время без подтверждённого часового пояса"
    : `${formatDate(at, zone)} ${formatTime(at, zone)}`;
}
function parts(at: number, zone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return {
    year: +p.year,
    month: +p.month,
    day: +p.day,
    hour: +p.hour,
    minute: +p.minute,
    second: +p.second,
  };
}
export function dayKey(at: number, zone: string): string {
  const p = parts(at, zone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
export function addDay(key: string, amount: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + amount)).toISOString().slice(0, 10);
}
export function shiftClock(raw: string, zone: string): string | null {
  const match = /^(\d\d):(\d\d)(?::\d\d)?$/.exec(raw);
  if (match && +match[1] < 24 && +match[2] < 60)
    return `${match[1]}:${match[2]}`;
  if (/T.*(?:Z|[+-]\d\d:\d\d)$/i.test(raw) && Number.isFinite(Date.parse(raw)))
    return formatTime(Date.parse(raw), zone);
  return null;
}
// Convert a wall clock in the selected IANA zone to an instant. Reject nonexistent/ambiguous DST clocks.
export function zonedStart(
  key: string,
  clock: string,
  zone: string,
): number | null {
  const [year, month, day] = key.split("-").map(Number),
    [hour, minute] = clock.split(":").map(Number);
  if (
    ![year, month, day, hour, minute].every(Number.isFinite) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  )
    return null;
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = desired;
  for (let i = 0; i < 5; i++) {
    const p = parts(candidate, zone);
    const observed = Date.UTC(
      p.year,
      p.month - 1,
      p.day,
      p.hour,
      p.minute,
      p.second,
    );
    candidate += desired - observed;
  }
  const matches = (n: number) => {
    const p = parts(n, zone);
    return (
      p.year === year &&
      p.month === month &&
      p.day === day &&
      p.hour === hour &&
      p.minute === minute
    );
  };
  if (!matches(candidate)) return null;
  if (
    [-2 * HOUR, -HOUR, -HOUR / 2, HOUR / 2, HOUR, 2 * HOUR].some((delta) =>
      matches(candidate + delta),
    )
  )
    return null;
  return candidate;
}
export function currentShiftKey(
  now: number,
  clock: string,
  zone: string,
): string {
  const today = dayKey(now, zone),
    start = zonedStart(today, clock, zone);
  return start !== null && now < start ? addDay(today, -1) : today;
}
export function hours(start: number, end = start + 24 * HOUR): number[] {
  return Array.from(
    { length: Math.max(0, Math.ceil((end - start) / HOUR)) },
    (_, i) => start + i * HOUR,
  );
}
