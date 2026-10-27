import { it, expect } from "vitest";
import {
  normalizeChains,
  normalizePatients,
  indexChains,
  type Patient,
} from "../src/model";
import {
  buildPatientSchedule,
  API_SCHEDULE_POLICY,
  summaryForHour,
} from "../src/scheduleEngine";
import { rawPatients, T } from "./fixtures";
import type { Period } from "../src/period";
// Fully synthetic shapes, not copied HAR records or clinical information.
const period: Period = {
  key: "synthetic",
  source: "sheet",
  patients: 1,
  warnings: [],
  start: Date.parse(T(18, 8)),
  end: Date.parse(T(19, 8)),
};
const patient = () => normalizePatients(rawPatients(1))[0];
const edit = (extra: Record<string, unknown> = {}) => ({
  id: "current",
  color: "",
  dates: { start: T(18, 8), periodicity: 1 },
  endDate: null,
  results: [] as { id: string; hour: string; status: string }[],
  ...extra,
});
const run = (elements: unknown[], p: Patient = patient(), window = period) =>
  buildPatientSchedule(
    indexChains(normalizeChains([{ id: "c", name: "Synthetic", elements }])),
    p,
    window,
    API_SCHEDULE_POLICY,
  );
const times = (data: ReturnType<typeof run>) => data.tasks.map((t) => t.at);
it("incomplete historic ancestors do not veto a dated current prescription", () => {
  const data = run([
    edit({
      id: "old",
      dates: null,
      results: [{ id: "bad", hour: "bad", status: "EXECUTED" }],
    }),
    edit({ parentId: "old" }),
  ]);
  expect(data.tasks).toHaveLength(24);
  expect(data.tasks.every((t) => t.revision.id === "current")).toBe(true);
});
it("multiple undated intermediate edits never erase a valid descendant", () => {
  expect(
    run([
      edit({ id: "root", dates: null }),
      edit({ id: "middle", parentId: "root", dates: null }),
      edit({ parentId: "middle" }),
    ]).tasks,
  ).toHaveLength(24);
});
it("historical off-grid marks do not invalidate a later stopped-boundary edition", () => {
  const data = run([
    edit({
      id: "old",
      dates: { start: T(17, 8), periodicity: 24 },
      endDate: T(18, 8),
      results: [{ id: "off", hour: T(17, 9), status: "EXECUTED" }],
    }),
    edit({ parentId: "old" }),
  ]);
  expect(data.issues).toEqual([]);
  expect(data.tasks).toHaveLength(24);
});
it("an unknown or cyclic parent link does not override explicit independent dates in original counter", () => {
  const data = run([
    edit({ id: "a", parentId: "b", endDate: T(18, 9) }),
    edit({
      id: "b",
      parentId: "a",
      dates: { start: T(18, 9), periodicity: 1 },
      endDate: T(18, 10),
    }),
  ]);
  expect(times(data)).toEqual([T(18, 8), T(18, 9)].map(Date.parse));
});
it("an open parent is not silently shortened by a child's parentId", () => {
  const data = run([
    edit({ id: "old", endDate: null }),
    edit({ parentId: "old", endDate: T(18, 10) }),
  ]);
  expect(data.slots.filter((t) => t.at === Date.parse(T(18, 8)))).toHaveLength(
    2,
  );
});
it("overlapping sheet records do not double count or suppress prescriptions", () => {
  const p = patient();
  p.sheets.push({
    id: "overlap",
    start: Date.parse(T(18, 8)),
    end: Date.parse(T(18, 10)),
    source: "direct",
  });
  const data = run([edit({ endDate: T(18, 12) })], p);
  expect(times(data)).toEqual(
    [T(18, 8), T(18, 9), T(18, 10), T(18, 11)].map(Date.parse),
  );
});
for (const status of ["EXECUTED", "NOT_EXECUTED"])
  it(`whole-hour ${status} fills the rounded 15:42 slot and leaves 23:00/07:00`, () => {
    const data = run([
      edit({
        dates: { start: T(18, 15, 42), periodicity: 8 },
        results: [
          { id: "r", hour: T(18, 15), creationDate: T(18, 23, 42), status },
        ],
      }),
    ]);
    expect(times(data)).toEqual([T(18, 23), T(19, 7)].map(Date.parse));
  });
it("minutes and seconds round down, while endDate itself stays exact", () => {
  expect(
    times(
      run([
        edit({
          dates: { start: "2026-10-18T08:42:15Z", periodicity: 1 },
          endDate: T(18, 11, 20),
        }),
      ]),
    ),
  ).toEqual([8, 9, 10, 11].map((h) => Date.parse(T(18, h))));
});
it("a same-column nonzero-minute result does not fill the exact hourly key", () => {
  expect(
    times(
      run([
        edit({
          dates: { start: T(18, 8, 40), periodicity: 1 },
          endDate: T(18, 10),
          results: [{ id: "r", hour: T(18, 8, 20), status: "EXECUTED" }],
        }),
      ]),
    ),
  ).toEqual([T(18, 8), T(18, 9)].map(Date.parse));
});
it("minute changes in one hour retain each prescription and its own result", () => {
  const data = run([
    edit({
      id: "old",
      dates: { start: T(18, 8, 10), periodicity: 1 },
      endDate: T(18, 8, 40),
    }),
    edit({
      parentId: "old",
      dates: { start: T(18, 8, 40), periodicity: 1 },
      endDate: T(18, 9),
      results: [{ id: "r", hour: T(18, 8), status: "EXECUTED" }],
    }),
  ]);
  expect(times(data)).toEqual([Date.parse(T(18, 8))]);
  expect(data.tasks[0].revision.id).toBe("old");
});
it("duplicate results close only one slot and do not hide other hours", () => {
  const data = run([
    edit({
      dates: { start: T(18, 8, 42), periodicity: 1 },
      endDate: T(18, 11),
      results: [
        { id: "a", hour: T(18, 8), status: "EXECUTED" },
        { id: "a", hour: T(18, 8), status: "EXECUTED" },
        { id: "b", hour: T(18, 9), status: "NOT_EXECUTED" },
      ],
    }),
  ]);
  expect(times(data)).toEqual([Date.parse(T(18, 10))]);
});
it("colorless zero-window prescriptions participate in the same summary", () => {
  const raw = Array.from({ length: 12 }, (_, i) => ({
    id: `c-${i}`,
    name: "Same synthetic name",
    elements: [
      edit({
        id: `p-${i}`,
        dates: { start: T(18, 12, 21), periodicity: i < 7 ? 24 : 0 },
        results: [
          {
            id: "mark",
            hour: T(18, 12),
            status: i % 2 ? "EXECUTED" : "NOT_EXECUTED",
          },
        ],
      }),
    ],
  }));
  const indexes = indexChains(normalizeChains(raw));
  const schedule = buildPatientSchedule(
    indexes,
    patient(),
    period,
    API_SCHEDULE_POLICY,
  );
  expect(
    summaryForHour(schedule, Date.parse(T(18, 12)), Date.parse(T(18, 12, 31))),
  ).toEqual({ scheduled: 12, unmarked: 0, status: "done" });
  expect(schedule.tasks).toHaveLength(0);
});
it("27 chains / 43 prescriptions / 118 synthetic results retain expected hourly counts", () => {
  const raw = Array.from({ length: 27 }, (_, i) => ({
    id: `c-${i}`,
    name: "Same synthetic name",
    elements:
      i < 16
        ? [
            edit({
              id: `old-${i}`,
              endDate: T(18, 10),
              results: [{ id: "r", hour: T(18, 8), status: "EXECUTED" }],
            }),
            edit({
              id: `new-${i}`,
              parentId: `old-${i}`,
              dates: { start: T(18, 10), periodicity: 1 },
              endDate: T(18, 12),
              results: [{ id: "r", hour: T(18, 10), status: "NOT_EXECUTED" }],
            }),
          ]
        : [
            edit({
              id: `single-${i}`,
              endDate: T(18, 12),
              results: [{ id: "r", hour: T(18, 8), status: "EXECUTED" }],
            }),
          ],
  }));
  for (let i = 0; i < 75; i++)
    raw[0].elements[0].results.push({
      id: `repeat-${i}`,
      hour: T(18, 8),
      status: "EXECUTED",
    });
  const indexes = indexChains(normalizeChains(raw));
  expect(indexes).toHaveLength(27);
  expect(indexes.flatMap((i) => i.chain.elements)).toHaveLength(43);
  expect(indexes.flatMap((i) => i.entries)).toHaveLength(118);
  const schedule = buildPatientSchedule(
    indexes,
    patient(),
    period,
    API_SCHEDULE_POLICY,
  );
  expect(
    [8, 9, 10, 11].map((h) =>
      summaryForHour(schedule, Date.parse(T(18, h)), Date.parse(T(18, 8, 31))),
    ),
  ).toEqual([
    { scheduled: 27, unmarked: 0, status: "done" },
    { scheduled: 27, unmarked: 27, status: "planned" },
    { scheduled: 27, unmarked: 11, status: "planned" },
    { scheduled: 27, unmarked: 27, status: "planned" },
  ]);
  expect(schedule.slots).toHaveLength(108);
  expect(schedule.tasks).toHaveLength(65);
});
