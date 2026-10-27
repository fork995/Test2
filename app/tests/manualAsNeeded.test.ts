import { expect, it } from "vitest";
import { classifySchedule, countTasksOn } from "../src/hourlySummary";
import { normalizeChains, normalizePatients, indexChains } from "../src/model";
import {
  buildPatientSchedule,
  API_SCHEDULE_POLICY,
  summaryForHour,
} from "../src/scheduleEngine";
import { buildFeed, revisionDiagnostics } from "../src/feed";
import { rawPatients, T } from "./fixtures";
import type { Period } from "../src/period";
const period: Period = {
  start: Date.parse(T(18, 8)),
  end: Date.parse(T(19, 8)),
  source: "sheet",
  key: "synthetic",
  patients: 1,
  warnings: [],
};
const make = (dates: Record<string, unknown>, results: unknown[] = []) =>
  indexChains(
    normalizeChains([
      {
        id: "manual",
        name: "Synthetic event",
        type: "MONITORING",
        elements: [{ id: "p", dates, results, creationDate: T(18, 7) }],
      },
    ]),
  );
const run = (indexes: ReturnType<typeof make>) =>
  buildPatientSchedule(
    indexes,
    normalizePatients(rawPatients(1))[0],
    period,
    API_SCHEDULE_POLICY,
  );
for (const n of [undefined, null]) {
  for (const status of [null, "EXECUTED", "NOT_EXECUTED", "CUSTOM_STATUS"])
    it(`manual ${String(n)}, result ${String(status)}: no slots, counters or warnings; exact records retained`, () => {
      const dates =
        n === undefined
          ? { start: T(18, 8, 21) }
          : { start: T(18, 8, 21), periodicity: n };
      const records = status
        ? [
            {
              id: "mark",
              hour: T(18, 10, 17),
              creationDate: T(18, 12, 42),
              status,
              comment: "Synthetic event value",
            },
          ]
        : [];
      const indexes = make(dates, records),
        revision = indexes[0].chain.elements[0];
      const before = JSON.stringify(indexes[0].chain);
      expect(classifySchedule(revision)).toBe("MANUAL_AS_NEEDED");
      const schedule = run(indexes);
      expect(schedule).toMatchObject({
        slots: [],
        tasks: [],
        issues: [],
        complete: true,
      });
      for (const h of [8, 9, 15])
        expect(
          summaryForHour(
            schedule,
            Date.parse(T(18, h)),
            Date.parse(T(18, 8, 31)),
          ).status,
        ).toBe("nothing");
      expect(revision.periodicity).toBeNull(); // The normalizer does not invent 0 or 1.
      expect(revisionDiagnostics(indexes[0])).toEqual([]);
      const feed = buildFeed(indexes, period);
      expect(feed.unscheduled).toEqual([]);
      expect(feed.warnings).toEqual([]);
      expect(feed.events).toHaveLength(records.length);
      if (status) {
        expect(indexes[0].entries[0].result).toMatchObject({
          at: Date.parse(T(18, 10, 17)),
          status,
          created: T(18, 12, 42),
        });
        expect(feed.events[0].warnings).toEqual([]);
      }
      expect(JSON.stringify(indexes[0].chain)).toBe(before);
      expect(
        countTasksOn(
          [{ ...revision, resultHours: revision.results.map((r) => r.at) }],
          period,
          Date.parse(T(18, 8)),
          Date.parse(T(18, 12)),
        ).status,
      ).toBe("nothing");
    });
}
it.each([
  [null, undefined, "INACTIVE"],
  [null, 0, "INACTIVE"],
  [Date.parse(T(18, 8)), 0, "ONCE"],
  [Date.parse(T(18, 8)), 1, "PERIODIC"],
  [Date.parse(T(18, 8)), 24, "PERIODIC"],
  [Date.parse(T(18, 8)), "0", "UNCONFIRMED"],
  [Date.parse(T(18, 8)), "", "UNCONFIRMED"],
] as const)(
  "classification keeps %s / %s as %s",
  (start, periodicity, expected) => {
    expect(classifySchedule({ start, periodicity })).toBe(expected);
  },
);
it("manual, explicit zero, and recurring siblings keep distinct behavior and result ownership", () => {
  const indexes = indexChains(
    normalizeChains([
      {
        id: "mixed",
        elements: [
          {
            id: "manual",
            dates: { start: T(18, 8, 21) },
            results: [{ id: "r", hour: T(18, 8), status: "EXECUTED" }],
          },
          {
            id: "zero",
            dates: { start: T(18, 8, 21), periodicity: 0 },
            results: [],
          },
          {
            id: "hourly",
            dates: { start: T(18, 8, 21), periodicity: 1 },
            endDate: T(18, 10),
            results: [],
          },
          { id: "inactive", dates: { periodicity: null }, results: [] },
        ],
      },
    ]),
  );
  const schedule = run(indexes);
  expect(schedule.tasks.map((t) => [t.revision.id, t.at])).toEqual([
    ["zero", Date.parse(T(18, 8))],
    ["hourly", Date.parse(T(18, 8))],
    ["hourly", Date.parse(T(18, 9))],
  ]);
  expect(schedule.complete).toBe(true);
  expect(indexes[0].entries).toHaveLength(1);
});
it("manual mode is normal even without results, sheet context or a selected interval", () => {
  const p = normalizePatients(rawPatients(1))[0];
  p.sheets = [];
  expect(
    buildPatientSchedule(
      make({ start: T(18, 8), periodicity: null }),
      p,
      null,
      API_SCHEDULE_POLICY,
    ),
  ).toMatchObject({ issues: [], tasks: [], complete: true });
});
