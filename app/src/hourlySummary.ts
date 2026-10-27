import { HOUR } from "./time";

/** Pure equivalents of Ss/Vl.hasScheduledTaskOn, Bc.filledAt and KR.count.
 * Inputs are absolute instants. No API, storage, colors, names or creationDate.
 */
export interface HourlyPrescription {
  start: number | null;
  end: number | null;
  periodicity: unknown;
  resultHours: readonly (number | null)[];
}
export interface TimeRange {
  start: number;
  end: number;
}
export type HourStatus = "nothing" | "done" | "planned" | "overdue";
export interface HourSummary {
  scheduled: number;
  unmarked: number;
  status: HourStatus;
}

export type ScheduleKind =
  | "INACTIVE"
  | "MANUAL_AS_NEEDED"
  | "ONCE"
  | "PERIODIC"
  | "UNCONFIRMED";
export const MANUAL_AS_NEEDED_LABEL = "По необходимости · отмечается вручную";
export function classifySchedule(prescription: {
  start: number | null;
  periodicity: unknown;
}): ScheduleKind {
  const { start, periodicity } = prescription;
  if (start === null || !Number.isFinite(start)) return "INACTIVE";
  if (periodicity === undefined || periodicity === null)
    return "MANUAL_AS_NEEDED";
  if (
    typeof periodicity !== "number" ||
    !Number.isFinite(periodicity) ||
    periodicity < 0
  )
    return "UNCONFIRMED";
  return periodicity === 0 ? "ONCE" : "PERIODIC";
}

const formatters = new Map<string, Intl.DateTimeFormat>();
export function hourStart(at: number, zone = "UTC"): number {
  if (zone === "UTC") return Math.floor(at / HOUR) * HOUR;
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en", {
      timeZone: zone,
      minute: "2-digit",
      second: "2-digit",
    });
    if (formatters.size >= 8) formatters.clear();
    formatters.set(zone, formatter);
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(at).map((p) => [p.type, p.value]),
  );
  return (
    at -
    +parts.minute * 60000 -
    +parts.second * 1000 -
    (((at % 1000) + 1000) % 1000)
  );
}

export function overlapsHour(range: TimeRange, at: number): boolean {
  return range.start < at + HOUR && range.end > at;
}

export function hasScheduledTaskOn(
  prescription: Pick<HourlyPrescription, "start" | "end" | "periodicity">,
  at: number,
  zone = "UTC",
): boolean {
  const { start, end, periodicity } = prescription;
  if (
    start === null ||
    !Number.isFinite(start) ||
    typeof periodicity !== "number" ||
    !Number.isFinite(periodicity) ||
    periodicity < 0 ||
    (end !== null && (!Number.isFinite(end) || at >= end || end < start))
  )
    return false;
  return scheduleWindowContains(hourStart(start, zone), periodicity, at);
}

export function scheduleWindowContains(
  anchor: number,
  periodicity: number,
  at: number,
): boolean {
  const delta = at - anchor;
  if (delta < 0) return false;
  if (periodicity === 0) return delta < HOUR;
  const step = periodicity * HOUR;
  if (!Number.isFinite(step) || step <= 0) return false;
  // ga.include checks a 60-minute window, rather than equality to a generated instant.
  return delta - Math.floor(delta / step) * step < HOUR;
}

export function filledAt(
  prescription: HourlyPrescription,
  at: number,
): boolean {
  // Original Bc.filledAt is independent of status and compares hour exactly.
  return prescription.resultHours.some((hour) => hour === at);
}

export function countTasksOn(
  prescriptions: readonly HourlyPrescription[],
  treatment: TimeRange | null,
  at: number,
  now: number,
  zone = "UTC",
): HourSummary {
  if (!treatment || !overlapsHour(treatment, at))
    return { scheduled: 0, unmarked: 0, status: "nothing" };
  const scheduled = prescriptions.filter((p) =>
    hasScheduledTaskOn(p, at, zone),
  );
  return summarizeCounts(
    scheduled.length,
    scheduled.filter((p) => !filledAt(p, at)).length,
    at,
    now,
    zone,
  );
}

export function summarizeCounts(
  scheduled: number,
  unmarked: number,
  at: number,
  now: number,
  zone = "UTC",
): HourSummary {
  return {
    scheduled,
    unmarked,
    status: !scheduled
      ? "nothing"
      : !unmarked
        ? "done"
        : at < hourStart(now, zone)
          ? "overdue"
          : "planned",
  };
}

/** hi.hours: enumerate columns once, not individual recurrence events. */
export function hourColumns(range: TimeRange, zone = "UTC"): number[] {
  const count = Math.max(0, Math.ceil((range.end - range.start) / HOUR));
  if (!Number.isFinite(count) || count > 10000) return [];
  const first = hourStart(range.start, zone);
  return Array.from({ length: count }, (_, i) => first + i * HOUR);
}
