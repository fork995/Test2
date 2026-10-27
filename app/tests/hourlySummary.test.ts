import { describe, expect, it } from "vitest";
import {
  countTasksOn,
  hasScheduledTaskOn,
  hourColumns,
  type HourlyPrescription,
} from "../src/hourlySummary";
import { HOUR } from "../src/time";

const at = (clock: string) => Date.parse(`2026-10-18T${clock}:00Z`);
const p = (
  periodicity: unknown,
  extra: Partial<HourlyPrescription> = {},
): HourlyPrescription => ({
  start: at("09:21"),
  end: null,
  periodicity,
  resultHours: [],
  ...extra,
});
const treatment = { start: at("08:30"), end: at("23:00") };
const count = (ps: HourlyPrescription[], clock: string, now = at("10:31")) =>
  countTasksOn(ps, treatment, at(clock), now);

describe("original hourly counter, synthetic data", () => {
  for (const [n, expected] of [
    [0, [9]],
    [1, [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]],
    [8, [9, 17]],
    [12, [9, 21]],
    [24, [9]],
  ] as const)
    it(`09:21 starts at 09:00; periodicity ${n}`, () => {
      const hours = Array.from({ length: 24 }, (_, h) => h).filter(
        (h) => count([p(n)], `${String(h).padStart(2, "0")}:00`).scheduled,
      );
      expect(hours).toEqual(expected);
    });
  it("zero is one 60-minute window, not hourly recurrence or a manual exclusion", () => {
    expect(hasScheduledTaskOn(p(0), at("09:59"))).toBe(true);
    expect(hasScheduledTaskOn(p(0), at("10:00"))).toBe(false);
    expect(hasScheduledTaskOn(p(0), at("08:59"))).toBe(false);
  });
  it("clears minutes, seconds and milliseconds", () => {
    expect(
      hasScheduledTaskOn(p(24, { start: at("09:21") + 45678 }), at("09:00")),
    ).toBe(true);
  });
  for (const status of ["EXECUTED", "NOT_EXECUTED", "OTHER"])
    it(`${status}: presence of the exact result hour closes the slot`, () => {
      expect(
        count([p(1, { resultHours: [at("10:00"), at("10:00")] })], "10:00"),
      ).toEqual({ scheduled: 1, unmarked: 0, status: "done" });
    });
  it("no result => planned; past column => overdue; same hour at 10:31 stays planned", () => {
    expect(count([p(1)], "09:00").status).toBe("overdue");
    expect(count([p(1)], "10:00")).toEqual({
      scheduled: 1,
      unmarked: 1,
      status: "planned",
    });
    expect(count([p(1)], "11:00").unmarked).toBe(1);
  });
  it("a result for another minute does not fill an hourly column", () => {
    expect(
      count([p(1, { resultHours: [at("10:21")] })], "10:00").unmarked,
    ).toBe(1);
  });
  it("empty or missing dates are not scheduled", () => {
    expect(count([p(1, { start: null }), p(null)], "10:00").status).toBe(
      "nothing",
    );
  });
  it("endDate is exclusive at the slot start; a mid-hour end includes its column", () => {
    expect(hasScheduledTaskOn(p(1, { end: at("10:00") }), at("10:00"))).toBe(
      false,
    );
    expect(hasScheduledTaskOn(p(1, { end: at("10:15") }), at("10:00"))).toBe(
      true,
    );
  });
  it("edits at exact boundary count once; edits within an hour count separately", () => {
    expect(
      count([p(1, { end: at("10:00") }), p(1, { start: at("10:00") })], "10:00")
        .scheduled,
    ).toBe(1);
    expect(
      count([p(1, { end: at("10:40") }), p(1, { start: at("10:40") })], "10:00")
        .scheduled,
    ).toBe(2);
  });
  it("a result on one edit does not close another", () => {
    expect(
      count([p(1, { resultHours: [at("10:00")] }), p(1)], "10:00"),
    ).toEqual({ scheduled: 2, unmarked: 1, status: "planned" });
  });
  it("treatment overlap is half open and permits admission within the column", () => {
    expect(count([p(1, { start: at("08:00") })], "08:00").scheduled).toBe(1);
    expect(count([p(1)], "23:00").status).toBe("nothing");
    expect(countTasksOn([p(1)], null, at("10:00"), at("10:31")).status).toBe(
      "nothing",
    );
  });
  it("5-hour repetition crosses midnight from the rounded first column", () => {
    const start = at("11:21");
    expect(
      [0, 5, 10, 15, 20].map((h) =>
        hasScheduledTaskOn(p(5, { start }), at("11:00") + h * HOUR),
      ),
    ).toEqual([true, true, true, true, true]);
    expect(hasScheduledTaskOn(p(5, { start }), at("11:00") + 14 * HOUR)).toBe(
      false,
    );
  });
  it("24 repeats next day; adjacent shift columns do not duplicate their boundary", () => {
    const start = at("08:00");
    const a = hourColumns({ start, end: start + 24 * HOUR });
    const b = hourColumns({ start: start + 24 * HOUR, end: start + 48 * HOUR });
    expect(a).toHaveLength(24);
    expect(a.includes(b[0])).toBe(false);
    expect(hasScheduledTaskOn(p(24), at("09:00") + 24 * HOUR)).toBe(true);
  });
  it("zone-aware rounding supports noninteger UTC offsets", () => {
    expect(
      hasScheduledTaskOn(
        p(24, { start: at("09:21") }),
        at("09:15"),
        "Asia/Kathmandu",
      ),
    ).toBe(true);
    expect(
      hasScheduledTaskOn(
        p(24, { start: at("09:21") }),
        at("09:00"),
        "Asia/Kathmandu",
      ),
    ).toBe(false);
  });
});
