import { it, expect } from "vitest";
import {
  normalizePatients,
  normalizeChains,
  indexChains,
  type Patient,
} from "../src/model";
import {
  API_SCHEDULE_POLICY,
  DEMO_SCHEDULE_POLICY,
  compareSchedules,
  buildPatientSchedule,
  currentHourStart,
  timeBucket,
  summaryForHour,
  type SchedulePolicy,
} from "../src/scheduleEngine";
import { T, rawPatients } from "./fixtures";
import type { Period } from "../src/period";
const period: Period = {
  start: Date.parse(T(18, 8)),
  end: Date.parse(T(19, 8)),
  key: "test",
  source: "sheet",
  patients: 1,
  warnings: [],
};
const patient = () => normalizePatients(rawPatients(1))[0];
const item = (extra: Record<string, unknown> = {}) => ({
  id: "r",
  color: "violet",
  dates: { start: T(18, 8), periodicity: 24 },
  endDate: T(20, 8),
  results: [],
  ...extra,
});
const run = (
  elements: unknown[],
  policy = API_SCHEDULE_POLICY,
  p: Patient = patient(),
  window = period,
  zone = "UTC",
) =>
  buildPatientSchedule(
    indexChains(
      normalizeChains([
        { id: "c", name: "Synthetic", type: "MEDICATION", elements },
      ]),
    ),
    p,
    window,
    policy,
    "ALL",
    zone,
  );
const times = (data: ReturnType<typeof run>) => data.tasks.map((t) => t.at);

for (const color of [
  "yellow",
  "violet",
  "red",
  "cornflowerblue",
  "#123abc",
  "unknown-api-color",
  "",
  "   ",
  null,
  undefined,
])
  it(`revision color ${String(color)} never filters an 8-hour schedule`, () => {
    const data = run([
      item({ color, dates: { start: T(18, 12), periodicity: 8 } }),
    ]);
    expect(times(data)).toEqual(
      [T(18, 12), T(18, 20), T(19, 4)].map(Date.parse),
    );
    expect(data.issues).toEqual([]);
  });
for (const status of ["EXECUTED", "NOT_EXECUTED", "OTHER", ""])
  it(`exact ${status} result is present according to original filledAt and closes one slot`, () => {
    const data = run([
      item({
        dates: { start: T(18, 12), periodicity: 8 },
        results: [{ id: "mark", hour: T(18, 12), status, color: "blue" }],
      }),
    ]);
    expect(times(data)).toEqual([T(18, 20), T(19, 4)].map(Date.parse));
    expect(
      summaryForHour(data, Date.parse(T(18, 12)), Date.parse(T(18, 12, 31)))
        .status,
    ).toBe("done");
    expect(data.slots[0].revision.color).toBe("violet");
    expect(data.slots[0].entry?.result.color).toBe("blue");
  });
it("10:31 current and next columns contain unmarked hourly assignments, including minute starts", () => {
  const data = run([item({ dates: { start: T(18, 9, 21), periodicity: 1 } })]);
  for (const [h, bucket] of [
    [10, "current"],
    [11, "next"],
  ] as const) {
    expect(
      data.tasks
        .filter(
          (t) => timeBucket(t.at, Date.parse(T(18, 10, 31)), "UTC") === bucket,
        )
        .map((t) => t.at),
    ).toEqual([Date.parse(T(18, h))]);
  }
});
it("5 hours from 11:21 gives 11,16,21,02,07", () => {
  expect(
    times(run([item({ dates: { start: T(18, 11, 21), periodicity: 5 } })])),
  ).toEqual(
    [T(18, 11), T(18, 16), T(18, 21), T(19, 2), T(19, 7)].map(Date.parse),
  );
});
it("zero supplies one rounded slot and no future recurrence", () => {
  const data = run([item({ dates: { start: T(18, 11, 21), periodicity: 0 } })]);
  expect(times(data)).toEqual([Date.parse(T(18, 11))]);
  expect(data.complete).toBe(true);
});
it("zero with an exact mark is done; off-schedule marks remain in history", () => {
  const data = run([
    item({
      dates: { start: T(18, 11, 21), periodicity: 0 },
      results: [
        { id: "one", hour: T(18, 11), status: "EXECUTED" },
        { id: "other", hour: T(18, 14), status: "NOT_EXECUTED" },
      ],
    }),
  ]);
  expect(data.tasks).toEqual([]);
  expect(data.slots).toHaveLength(1);
  expect(data.slots[0].index.entries).toHaveLength(2);
});
it("fractional periods produce at most one task per prescription per hourly column", () => {
  const data = run([
    item({
      dates: { start: T(18, 10, 30), periodicity: 0.5 },
      endDate: T(18, 12),
    }),
  ]);
  expect(times(data)).toEqual([T(18, 10), T(18, 11)].map(Date.parse));
});
it("successor at an exact stopped boundary creates no duplicate", () => {
  const data = run([
    item({
      id: "old",
      dates: { start: T(18, 8), periodicity: 1 },
      endDate: T(18, 11),
    }),
    item({
      id: "new",
      parentId: "old",
      dates: { start: T(18, 11), periodicity: 0 },
    }),
  ]);
  expect(times(data)).toEqual(
    [T(18, 8), T(18, 9), T(18, 10), T(18, 11)].map(Date.parse),
  );
  expect(new Set(data.tasks.map((t) => t.key)).size).toBe(4);
});
it("parentId alone never replaces an explicit endDate in original listForStat", () => {
  const data = run([
    item({
      id: "old",
      dates: { start: T(18, 8), periodicity: 1 },
      endDate: T(18, 12),
    }),
    item({
      id: "new",
      parentId: "old",
      dates: { start: T(18, 11), periodicity: 1 },
      endDate: T(18, 12),
    }),
  ]);
  expect(data.slots.filter((t) => t.at === Date.parse(T(18, 11)))).toHaveLength(
    2,
  );
});
it("a mid-hour edit counts its two distinct prescriptions, with isolated results", () => {
  const data = run([
    item({
      id: "old",
      dates: { start: T(18, 8, 10), periodicity: 1 },
      endDate: T(18, 8, 40),
      results: [{ id: "mark", hour: T(18, 8), status: "EXECUTED" }],
    }),
    item({
      id: "new",
      parentId: "old",
      dates: { start: T(18, 8, 40), periodicity: 1 },
      endDate: T(18, 9),
    }),
  ]);
  expect(data.slots).toHaveLength(2);
  expect(data.tasks.map((t) => t.revision.id)).toEqual(["new"]);
});
it("repeated result IDs/hours close a slot once and creationDate never closes another hour", () => {
  const data = run([
    item({
      dates: { start: T(18, 10), periodicity: 1 },
      endDate: T(18, 14),
      results: [
        {
          id: "a",
          hour: T(18, 11),
          status: "EXECUTED",
          creationDate: T(18, 12),
        },
        {
          id: "a",
          hour: T(18, 11),
          status: "NOT_EXECUTED",
          creationDate: T(18, 12),
        },
        { id: "b", hour: T(18, 13), status: "NOT_EXECUTED" },
      ],
    }),
  ]);
  expect(times(data)).toEqual([T(18, 10), T(18, 12)].map(Date.parse));
  expect(data.slots).toHaveLength(4);
});
it("non-hour results are not rounded into hourly marks", () => {
  expect(
    times(
      run([
        item({
          results: [{ id: "r", hour: T(18, 8, 21), status: "EXECUTED" }],
        }),
      ]),
    ),
  ).toEqual([Date.parse(T(18, 8))]);
});
it("ended prescriptions cannot return later; a mid-hour end still includes its column", () => {
  expect(run([item({ endDate: T(18, 8) })]).tasks).toEqual([]);
  expect(times(run([item({ endDate: T(18, 8, 20) })]))).toEqual([
    Date.parse(T(18, 8)),
  ]);
});
it("adjacent shifts exclude their final boundary and support midnight", () => {
  const a = run(
    [item({ dates: { start: T(18, 23), periodicity: 1 }, endDate: T(19, 2) })],
    API_SCHEDULE_POLICY,
    patient(),
    { ...period, start: Date.parse(T(18, 20)), end: Date.parse(T(19, 0)) },
  );
  const b = run(
    [item({ dates: { start: T(18, 23), periodicity: 1 }, endDate: T(19, 2) })],
    API_SCHEDULE_POLICY,
    patient(),
    { ...period, start: Date.parse(T(19, 0)), end: Date.parse(T(19, 4)) },
  );
  expect(times(a)).toEqual([Date.parse(T(18, 23))]);
  expect(times(b)).toEqual([T(19, 0), T(19, 1)].map(Date.parse));
});
it("treatment starts mid-hour and ends with the last sheet, not each sheet separately", () => {
  const p = patient();
  p.treatmentStart = Date.parse(T(18, 10, 21));
  p.sheets = [
    {
      id: "last",
      source: "direct",
      start: Date.parse(T(18, 15)),
      end: Date.parse(T(18, 18)),
    },
  ];
  expect(
    times(
      run(
        [item({ dates: { start: T(18, 8), periodicity: 1 } })],
        API_SCHEDULE_POLICY,
        p,
      ),
    ),
  ).toEqual(Array.from({ length: 8 }, (_, i) => Date.parse(T(18, 10 + i))));
});
it("no known treatment period is partial, never false zero success", () => {
  const p = patient();
  p.sheets = [];
  const data = run([item()], API_SCHEDULE_POLICY, p);
  expect(data.tasks).toEqual([]);
  expect(data.complete).toBe(false);
});
it("missing/invalid dates do not become a schedule and do not veto a valid sibling", () => {
  const data = run([
    item({ id: "draft", dates: null }),
    item({ id: "current" }),
  ]);
  expect(data.tasks.map((t) => t.revision.id)).toEqual(["current"]);
  expect(data.slots).toHaveLength(1);
});
for (const periodicity of [-1, "24", NaN, Infinity])
  it(`invalid periodicity ${String(periodicity)} is not inferred from specifics`, () => {
    const data = run([
      item({
        dates: { start: T(18, 8), periodicity },
        specifics: { periodicity: 24 },
      }),
    ]);
    expect(data.tasks).toEqual([]);
    expect(data.complete).toBe(false);
  });
it("unsupported hypothesis and fixture scopes cannot authorize an API rule", () => {
  for (const rules of [
    [{ ...API_SCHEDULE_POLICY.rules[1], status: "hypothesis" as const }],
    DEMO_SCHEDULE_POLICY.rules,
  ]) {
    const policy: SchedulePolicy = { id: "unverified", domain: "api", rules };
    expect(
      run([item({ dates: { start: T(18, 8), periodicity: 1 } })], policy).tasks,
    ).toEqual([]);
  }
});
it("date-end aliases and malformed endDate are diagnostic, not silently open-ended", () => {
  for (const extra of [
    { endDate: "bad" },
    {
      endDate: undefined,
      dates: { start: T(18, 8), end: T(19, 8), periodicity: 24 },
    },
  ]) {
    const data = run([item(extra)]);
    expect(data.tasks).toEqual([]);
    expect(data.issues).toHaveLength(1);
  }
});
it("a malformed historical mark warns without suppressing all otherwise scheduled columns", () => {
  const data = run([
    item({ results: [{ id: "bad", hour: "08:00", status: "EXECUTED" }] }),
  ]);
  expect(data.tasks).toHaveLength(1);
  expect(data.complete).toBe(false);
});
it("comparison includes zero and never calibrates a rule from creationDate", () => {
  const indexes = indexChains(
    normalizeChains([
      {
        id: "c",
        elements: [
          item({
            dates: { start: T(18, 8, 21), periodicity: 0 },
            results: [
              { id: "match", hour: T(18, 8), creationDate: T(18, 9) },
              { id: "off", hour: T(18, 9), creationDate: T(18, 8) },
            ],
          }),
        ],
      },
    ]),
  );
  expect(compareSchedules(indexes)[0]).toMatchObject({
    periodicity: 0,
    matched: 1,
    contradictions: 1,
  });
  expect(Object.isFrozen(API_SCHEDULE_POLICY.rules)).toBe(true);
});
it("timezone grouping supports midnight and noninteger UTC offsets", () => {
  expect(
    timeBucket(Date.parse(T(19, 0)), Date.parse(T(18, 23, 45)), "UTC"),
  ).toBe("next");
  expect(currentHourStart(Date.parse(T(18, 8, 42)), "Asia/Kathmandu")).toBe(
    Date.parse(T(18, 8, 15)),
  );
});
it("the selected zone controls both schedule rounding and column labels", () => {
  const p = patient();
  const start = Date.parse(T(18, 8, 15));
  p.sheets = [{ id: "s", start, end: start + 24 * 3600000, source: "direct" }];
  expect(
    times(
      run(
        [item({ dates: { start: T(18, 9, 21), periodicity: 24 } })],
        API_SCHEDULE_POLICY,
        p,
        { ...period, start, end: start + 24 * 3600000 },
        "Asia/Kathmandu",
      ),
    ),
  ).toEqual([Date.parse(T(18, 9, 15))]);
});
it("category filtering changes counts without changing shared records", () => {
  const indexes = indexChains(
    normalizeChains([{ id: "c", type: "MEDICATION", elements: [item()] }]),
  );
  expect(
    buildPatientSchedule(
      indexes,
      patient(),
      period,
      API_SCHEDULE_POLICY,
      "SOLUTION",
    ).slots,
  ).toEqual([]);
  expect(
    buildPatientSchedule(
      indexes,
      patient(),
      period,
      API_SCHEDULE_POLICY,
      "MEDICATION",
    ).slots,
  ).toHaveLength(1);
});
