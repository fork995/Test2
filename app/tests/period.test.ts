import { it, expect } from "vitest";
import { normalizePatients } from "../src/model";
import {
  sheetPeriods,
  resolvePeriod,
  adjacentPeriod,
  shiftPeriod,
  patientPeriodWarnings,
} from "../src/period";
import { hours } from "../src/time";
import { rawPatients, T } from "./fixtures";
const patients = () => normalizePatients(rawPatients());
it("reads direct sheets start/end and keeps exact boundaries at 08:00 when app opens at 08:42", () => {
  const data = patients(),
    periods = sheetPeriods(data);
  expect(data[0].sheets).toHaveLength(3);
  const selected = resolvePeriod(
    periods,
    "2026-10-18",
    "08:42",
    "UTC",
    "auto",
    Date.parse(T(18, 8, 42)),
  )!;
  expect(selected.start).toBe(Date.parse(T(18, 8)));
  expect(selected.end).toBe(Date.parse(T(19, 8)));
  expect(selected.source).toBe("sheet");
});
it("direct start/end have priority over older aliases", () => {
  const data = normalizePatients([
    {
      id: 1,
      card: {
        id: 2,
        treatment: {
          sheets: [
            {
              start: T(18, 8),
              end: T(19, 8),
              dates: { start: T(18, 8, 42), end: T(19, 9) },
            },
          ],
        },
      },
    },
  ]);
  expect(data[0].sheets[0].start).toBe(Date.parse(T(18, 8)));
});
it("full sheet boundaries are not silently clipped to 24h", () => {
  const data = normalizePatients([
    {
      id: 1,
      card: {
        id: 2,
        treatment: { sheets: [{ start: T(18, 8), end: T(20, 8) }] },
      },
    },
  ]);
  const period = resolvePeriod(
    sheetPeriods(data),
    "2026-10-18",
    "08:00",
    "UTC",
    "auto",
    Date.parse(T(18, 12)),
  )!;
  expect(hours(period.start, period.end)).toHaveLength(48);
});
it("navigation uses non-overlapping real sheets and preserves midnight crossing", () => {
  const periods = sheetPeriods(patients()),
    current = periods[1];
  expect(adjacentPeriod(periods, current, -1)?.end).toBe(current.start);
  expect(adjacentPeriod(periods, current, 1)?.start).toBe(current.end);
});
it("shift fallback is anchored and calendar DST intervals do not overlap", () => {
  const a = shiftPeriod("2026-11-01", "00:00", "America/New_York")!,
    b = shiftPeriod("2026-11-02", "00:00", "America/New_York")!;
  expect(a.end - a.start).toBe(25 * 3600000);
  expect(a.end).toBe(b.start);
});
it("unknown shift without sheets never falls back to current opening time", () => {
  expect(
    resolvePeriod(
      [],
      "2026-10-18",
      "",
      "UTC",
      "auto",
      Date.parse(T(18, 8, 42)),
    ),
  ).toBeNull();
});
it("overlapping sheets warn and arrows skip overlaps", () => {
  const data = normalizePatients([
    {
      id: 1,
      card: {
        id: 2,
        treatment: {
          sheets: [
            { start: T(18, 8), end: T(19, 8) },
            { start: T(18, 9), end: T(19, 9) },
            { start: T(19, 9), end: T(20, 9) },
          ],
        },
      },
    },
  ]);
  const periods = sheetPeriods(data);
  expect(periods[0].warnings.length).toBeGreaterThan(0);
  expect(adjacentPeriod(periods, periods[0], 1)?.start).toBe(
    Date.parse(T(19, 9)),
  );
});
it("patients with mismatched/no sheets get explicit diagnostic warnings", () => {
  const period = sheetPeriods(patients())[1];
  expect(patientPeriodWarnings(patients()[0], period)).toEqual([]);
  const other = normalizePatients([{ id: 1, card: { id: 2 } }])[0];
  expect(patientPeriodWarnings(other, period).join(" ")).toContain(
    "не распознаны",
  );
});
it("actual current sheet wins even before an incorrect workShiftStart such as 08:42", () => {
  const reference = Date.parse(T(18, 8, 30));
  const period = resolvePeriod(
    sheetPeriods(patients()),
    "2026-10-17",
    "08:42",
    "UTC",
    "auto",
    reference,
  )!;
  expect(period.start).toBe(Date.parse(T(18, 8)));
});
