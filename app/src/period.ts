import type { Patient } from "./model";
import { addDay, currentShiftKey, dayKey, zonedStart } from "./time";
export interface Period {
  start: number;
  end: number;
  source: "sheet" | "shift";
  key: string;
  patients: number;
  warnings: string[];
}
export function sheetPeriods(patients: Patient[]): Period[] {
  const map = new Map<string, Period>();
  for (const patient of patients) {
    const seen = new Set<string>();
    for (const sheet of patient.sheets) {
      const key = `${sheet.start}/${sheet.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const old = map.get(key);
      if (old) old.patients++;
      else
        map.set(key, {
          start: sheet.start,
          end: sheet.end,
          source: "sheet",
          key,
          patients: 1,
          warnings: [],
        });
    }
  }
  const periods = [...map.values()].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  );
  for (let i = 0; i < periods.length; i++)
    for (
      let j = i + 1;
      j < periods.length && periods[j].start < periods[i].end;
      j++
    ) {
      periods[i].warnings = [
        "Границы листов пересекаются. Проверьте выбранный интервал.",
      ];
      periods[j].warnings = [
        "Границы листов пересекаются. Проверьте выбранный интервал.",
      ];
    }
  return periods;
}
export function shiftPeriod(
  day: string,
  clock: string,
  zone: string,
): Period | null {
  if (!clock) return null;
  const start = zonedStart(day, clock, zone),
    end = zonedStart(addDay(day, 1), clock, zone);
  return start !== null && end !== null && end > start
    ? {
        start,
        end,
        source: "shift",
        key: `shift:${day}`,
        patients: 0,
        warnings: [],
      }
    : null;
}
// Absolute sheet boundaries always win in automatic mode. Never use Date.now() as a boundary.
export function resolvePeriod(
  periods: Period[],
  day: string,
  clock: string,
  zone: string,
  choice: string,
  reference: number,
): Period | null {
  const shift = shiftPeriod(day, clock, zone);
  if (choice === "shift") return shift;
  if (choice !== "auto") return periods.find((p) => p.key === choice) ?? null;
  const currentSelection = day === initialDay(reference, clock, zone);
  const currentSheets = periods.filter(
    (p) => p.start <= reference && reference < p.end,
  );
  if (currentSelection && currentSheets.length) {
    return [...currentSheets].sort(
      (a, b) => b.patients - a.patients || b.start - a.start || a.end - b.end,
    )[0];
  }
  const relevant = shift
    ? periods.filter((p) => p.start < shift.end && p.end > shift.start)
    : periods.filter(
        (p) =>
          (p.start <= reference && reference < p.end) ||
          dayKey(p.start, zone) === day,
      );
  if (relevant.length) {
    return [...relevant].sort((a, b) => {
      const aContains = shift
        ? a.start <= shift.start && shift.start < a.end
        : a.start <= reference && reference < a.end;
      const bContains = shift
        ? b.start <= shift.start && shift.start < b.end
        : b.start <= reference && reference < b.end;
      return (
        Number(bContains) - Number(aContains) ||
        b.patients - a.patients ||
        Math.abs(a.start - (shift?.start ?? reference)) -
          Math.abs(b.start - (shift?.start ?? reference)) ||
        a.start - b.start
      );
    })[0];
  }
  return shift;
}
export function initialDay(now: number, clock: string, zone: string): string {
  return clock ? currentShiftKey(now, clock, zone) : dayKey(now, zone);
}
export function adjacentPeriod(
  periods: Period[],
  period: Period,
  direction: -1 | 1,
): Period | undefined {
  // Automatic arrows never jump into an overlapping sheet and duplicate boundary results.
  return direction < 0
    ? [...periods].reverse().find((p) => p.end <= period.start)
    : periods.find((p) => p.start >= period.end);
}
export function patientPeriodWarnings(
  patient: Patient,
  period: Period | null,
): string[] {
  if (!period)
    return ["Интервал не определён. Укажите начало смены в настройках."];
  if (!patient.sheets.length)
    return [
      "Границы листов пациента не распознаны; используется выбранный интервал отделения.",
    ];
  const matched = patient.sheets.some(
    (s) => s.start === period.start && s.end === period.end,
  );
  if (matched) return [];
  return [
    "Границы листов пациента отличаются от выбранного интервала. Проверьте источник интервала в настройках; результаты отфильтрованы по общей смене.",
  ];
}
