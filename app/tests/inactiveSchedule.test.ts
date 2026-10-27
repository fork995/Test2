import { expect, it } from "vitest";
import { indexChains, normalizeChains, normalizePatients } from "../src/model";
import {
  API_SCHEDULE_POLICY,
  buildPatientSchedule,
  compareRule,
  compareSchedules,
  summaryForHour,
} from "../src/scheduleEngine";
import { buildFeed, revisionDiagnostics } from "../src/feed";
import { rawPatients, T } from "./fixtures";
import type { Period } from "../src/period";
const period: Period = {
  start: Date.parse(T(18, 8)),
  end: Date.parse(T(19, 8)),
  key: "synthetic",
  source: "sheet",
  patients: 1,
  warnings: [],
};
const patient = () => normalizePatients(rawPatients(1))[0];
const index = (elements: unknown[]) =>
  indexChains(normalizeChains([{ id: "c", name: "Synthetic", elements }]));
const inactive = (start: unknown = undefined, periodicity: unknown = 1) => ({
  id: "inactive",
  dates: { start, periodicity },
  color: "yellow",
  creationDate: T(18, 8),
  endDate: T(19, 8),
  instruction: "Synthetic instruction",
  specifics: { dose: { value: 1, unit: "мг" } },
  results: [
    {
      id: "stored",
      hour: T(18, 8),
      creationDate: T(18, 9),
      status: "EXECUTED",
    },
  ],
});
it.each([
  undefined,
  null,
  "",
  "bad",
  "08:00",
  "2026-10-18T08:00:00",
  "2026-02-30T08:00:00Z",
  123,
])(
  "invalid start %s is inactive, has no slots or schedule warnings, and preserves the source",
  (start) => {
    for (const n of [0, 1, 24]) {
      const indexes = index([inactive(start, n)]);
      const before = JSON.stringify(indexes[0].chain);
      const schedule = buildPatientSchedule(
        indexes,
        patient(),
        period,
        API_SCHEDULE_POLICY,
      );
      expect(schedule.slots).toEqual([]);
      expect(schedule.tasks).toEqual([]);
      expect(schedule.issues).toEqual([]);
      expect(schedule.complete).toBe(true);
      for (const h of [8, 9, 20])
        expect(
          summaryForHour(
            schedule,
            Date.parse(T(18, h)),
            Date.parse(T(18, 8, 31)),
          ),
        ).toEqual({ scheduled: 0, unmarked: 0, status: "nothing" });
      expect(indexes[0].entries).toHaveLength(1);
      expect(indexes[0].chain.elements[0].specifics).toEqual({
        dose: { value: 1, unit: "мг" },
      });
      expect(JSON.stringify(indexes[0].chain)).toBe(before);
      expect(revisionDiagnostics(indexes[0])).toEqual([]);
    }
  },
);
it("missing dates altogether is a normal inactive state", () => {
  const indexes = index([{ ...inactive(), dates: null }]);
  expect(
    buildPatientSchedule(indexes, patient(), period, API_SCHEDULE_POLICY),
  ).toMatchObject({ slots: [], tasks: [], issues: [], complete: true });
});
it("inactive cells skip period, treatment, rule, end and result diagnostics", () => {
  const indexes = index([
    {
      ...inactive(null, -1),
      endDate: "bad",
      results: [{ id: "bad", hour: "bad", status: "EXECUTED" }],
    },
  ]);
  const p = patient();
  p.sheets = [];
  for (const view of [period, null])
    expect(
      buildPatientSchedule(indexes, p, view, API_SCHEDULE_POLICY),
    ).toMatchObject({ slots: [], tasks: [], issues: [], complete: true });
  expect(indexes[0].unplaced).toHaveLength(1);
});
it("inactive history does not create warnings for valid recurring and zero-window siblings", () => {
  const indexes = index([
    { ...inactive(), id: "old", endDate: T(18, 8) },
    {
      id: "hourly",
      parentId: "old",
      dates: { start: T(18, 8, 21), periodicity: 1 },
      endDate: T(18, 10),
      results: [],
    },
    {
      id: "once",
      parentId: "hourly",
      dates: { start: T(18, 10, 21), periodicity: 0 },
      endDate: T(18, 11),
      results: [],
    },
    {
      ...inactive(null),
      id: "later",
      parentId: "once",
      creationDate: T(18, 20),
    },
  ]);
  const schedule = buildPatientSchedule(
    indexes,
    patient(),
    period,
    API_SCHEDULE_POLICY,
  );
  expect(schedule.tasks.map((s) => [s.revision.id, s.at])).toEqual([
    ["hourly", Date.parse(T(18, 8))],
    ["hourly", Date.parse(T(18, 9))],
    ["once", Date.parse(T(18, 10))],
  ]);
  expect(schedule.issues).toEqual([]);
  expect(revisionDiagnostics(indexes[0])).toEqual([]);
  expect(indexes[0].chain.elements).toHaveLength(4);
});
it("inactive results are not ambiguous schedule calibration samples", () => {
  const indexes = index([
    inactive(null, 1),
    { id: "valid", dates: { start: T(18, 8), periodicity: 0 }, results: [] },
  ]);
  expect(
    compareRule(
      indexes[0],
      API_SCHEDULE_POLICY.rules.find((r) => r.periodicity === 1)!,
    ),
  ).toMatchObject({ observed: 0, matched: 0, contradictions: 0, unplaced: 0 });
  expect(compareSchedules(indexes).map((r) => r.periodicity)).toEqual([0]);
});
it("legacy feed excludes inactive schedule cards and warnings but retains their results", () => {
  const indexes = index([inactive()]);
  const data = buildFeed(indexes, period);
  expect(data.unscheduled).toEqual([]);
  expect(data.warnings).toEqual([]);
  expect(data.events).toHaveLength(1);
  expect(data.events[0].warnings).toEqual([]);
  expect(buildFeed(indexes, null).unscheduled).toEqual([]);
});
it("a valid start with unknown periodicity still requires clarification", () => {
  const schedule = buildPatientSchedule(
    index([
      { ...inactive(T(18, 8)), dates: { start: T(18, 8), periodicity: -1 } },
    ]),
    patient(),
    period,
    API_SCHEDULE_POLICY,
  );
  expect(schedule.issues).toHaveLength(1);
  expect(schedule.complete).toBe(false);
});

it("multiple inactive children do not make the valid parent diagnostically ambiguous", () => {
  const indexes = index([
    {
      id: "active",
      dates: { start: T(18, 8), periodicity: 1 },
      endDate: T(18, 10),
    },
    { ...inactive(), id: "draft-a", parentId: "active" },
    { ...inactive(), id: "draft-b", parentId: "active" },
  ]);
  expect(revisionDiagnostics(indexes[0])).toEqual([]);
  expect(
    buildPatientSchedule(indexes, patient(), period, API_SCHEDULE_POLICY),
  ).toMatchObject({ issues: [], complete: true });
  expect(indexes[0].chain.elements).toHaveLength(3);
});
