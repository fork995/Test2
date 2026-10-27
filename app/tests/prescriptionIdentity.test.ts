import { it, expect } from "vitest";
import { normalizeChains, normalizePatients, indexChains } from "../src/model";
import {
  buildPatientSchedule,
  API_SCHEDULE_POLICY,
  apiHourColumn,
  timeBucket,
} from "../src/scheduleEngine";
import { rawPatients, T } from "./fixtures";
import type { Period } from "../src/period";

// Entirely synthetic cases reproducing structural patterns, not patient HAR records.
const period: Period = {
  start: Date.parse(T(18, 8)),
  end: Date.parse(T(19, 8)),
  key: "synthetic",
  source: "sheet",
  patients: 1,
  warnings: [],
};
const patient = () => normalizePatients(rawPatients(1))[0];
const edit = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  color: "yellow",
  dates: { start: T(18, 8), periodicity: 1 },
  endDate: T(18, 12),
  results: [],
  ...extra,
});
const chain = <T>(id: string, elements: T[]) => ({
  id,
  name: "Учебное одинаковое название",
  type: "MEDICATION",
  elements,
});
const run = (raw: unknown[], window = period) =>
  buildPatientSchedule(
    indexChains(normalizeChains(raw)),
    patient(),
    window,
    API_SCHEDULE_POLICY,
  );

it("independent chains with the same name/time/color do not share a prescription's result", () => {
  const data = run([
    chain("a", [
      edit("p-a", {
        endDate: T(18, 9),
        results: [{ id: "result", hour: T(18, 8), status: "EXECUTED" }],
      }),
    ]),
    chain("b", [edit("p-b", { endDate: T(18, 9) })]),
  ]);
  expect(data.issues).toEqual([]);
  expect(data.tasks).toHaveLength(1);
  expect(data.tasks[0].index.chain.id).toBe("b");
});
it("the same prescription ID in different chains cannot leak a result across chain scope", () => {
  const data = run([
    chain("a", [
      edit("same-p", {
        endDate: T(18, 9),
        results: [{ id: "mark", hour: T(18, 8), status: "NOT_EXECUTED" }],
      }),
    ]),
    chain("b", [edit("same-p", { endDate: T(18, 9) })]),
  ]);
  expect(data.tasks).toHaveLength(1);
  expect(data.tasks[0].index.chain.id).toBe("b");
});
for (const status of ["EXECUTED", "NOT_EXECUTED"])
  it(`an off-grid historical ${status} does not close a new prescription at that hour`, () => {
    const data = run([
      chain("a", [
        edit("old", {
          dates: { start: T(18, 8), periodicity: 24 },
          endDate: T(18, 9),
          results: [{ id: "old-mark", hour: T(18, 9), status }],
        }),
        edit("new", {
          parentId: "old",
          dates: { start: T(18, 9), periodicity: 1 },
          endDate: T(18, 11),
        }),
      ]),
    ]);
    expect(data.tasks.map((t) => t.at)).toEqual(
      [T(18, 8), T(18, 9), T(18, 10)].map(Date.parse),
    );
    expect(
      data.tasks.find((t) => t.at === Date.parse(T(18, 9)))?.revision.id,
    ).toBe("new");
  });
it("a zero-window prescription's result cannot close an automatic successor", () => {
  const data = run([
    chain("a", [
      edit("manual", {
        dates: { start: T(18, 8), periodicity: 0 },
        endDate: T(18, 10),
        results: [{ id: "manual-mark", hour: T(18, 10), status: "EXECUTED" }],
      }),
      edit("automatic", {
        parentId: "manual",
        dates: { start: T(18, 10), periodicity: 1 },
        endDate: T(18, 12),
      }),
    ]),
  ]);
  expect(data.tasks.map((t) => t.at)).toEqual(
    [T(18, 8), T(18, 10), T(18, 11)].map(Date.parse),
  );
});
it("three linked prescriptions keep separate colors, intervals and result ownership", () => {
  const raw = [
    chain("a", [
      edit("old", {
        color: "violet",
        endDate: T(18, 10),
        results: [{ id: "a", hour: T(18, 8), status: "EXECUTED" }],
      }),
      edit("middle", {
        parentId: "old",
        color: "yellow",
        dates: { start: T(18, 10), periodicity: 1 },
        endDate: T(18, 13),
        creationDate: T(18, 20),
        results: [{ id: "b", hour: T(18, 10), status: "EXECUTED" }],
      }),
      edit("latest", {
        parentId: "middle",
        color: "custom-api-color",
        dates: { start: T(18, 13), periodicity: 1 },
        endDate: T(18, 16),
        results: [{ id: "c", hour: T(18, 13), status: "NOT_EXECUTED" }],
      }),
    ]),
  ];
  const data = run(raw);
  expect(data.issues).toEqual([]);
  expect(data.tasks.map((t) => [t.at, t.revision.color])).toEqual([
    [Date.parse(T(18, 9)), "violet"],
    [Date.parse(T(18, 11)), "yellow"],
    [Date.parse(T(18, 12)), "yellow"],
    [Date.parse(T(18, 14)), "custom-api-color"],
    [Date.parse(T(18, 15)), "custom-api-color"],
  ]);
  expect(indexChains(normalizeChains(raw))[0].entries).toHaveLength(3);
});
it("matching uses the prescription ID rather than JavaScript object identity", () => {
  const indexes = indexChains(
    normalizeChains([
      chain("a", [
        edit("old", {
          dates: { start: T(18, 8, 10), periodicity: 1 },
          endDate: T(18, 8, 40),
          results: [{ id: "mark", hour: T(18, 8), status: "EXECUTED" }],
        }),
        edit("new", {
          parentId: "old",
          dates: { start: T(18, 8, 40), periodicity: 1 },
          endDate: T(18, 9, 40),
        }),
      ]),
    ]),
  );
  indexes[0].entries[0].revision = { ...indexes[0].entries[0].revision };
  const data = buildPatientSchedule(
    indexes,
    patient(),
    period,
    API_SCHEDULE_POLICY,
  );
  expect(data.issues).toEqual([]);
  expect(data.tasks.map((t) => t.at)).toEqual(
    [T(18, 8), T(18, 9)].map(Date.parse),
  );
});
it("a mark with unknown prescription identity is not attached to another prescription by hour", () => {
  const indexes = indexChains(
    normalizeChains([
      chain("a", [
        edit("p", {
          endDate: T(18, 9),
          results: [{ id: "r", hour: T(18, 8), status: "EXECUTED" }],
        }),
      ]),
    ]),
  );
  indexes[0].entries[0].revision = {
    ...indexes[0].entries[0].revision,
    id: "unknown-prescription",
  };
  const data = buildPatientSchedule(
    indexes,
    patient(),
    period,
    API_SCHEDULE_POLICY,
  );
  expect(data.tasks.map((t) => t.at)).toEqual([Date.parse(T(18, 8))]);
});
it("duplicate result IDs are not used instead of prescription identity and do not close future hours", () => {
  const data = run([
    chain("a", [
      edit("p-a", {
        endDate: T(18, 10),
        results: [
          { id: "same-result", hour: T(18, 8), status: "EXECUTED" },
          { id: "same-result", hour: T(18, 8), status: "EXECUTED" },
        ],
      }),
    ]),
    chain("b", [
      edit("p-b", {
        endDate: T(18, 10),
        results: [
          { id: "same-result", hour: T(18, 9), status: "NOT_EXECUTED" },
        ],
      }),
    ]),
  ]);
  expect(data.tasks.map((t) => [t.index.chain.id, t.at])).toEqual([
    ["b", Date.parse(T(18, 8))],
    ["a", Date.parse(T(18, 9))],
  ]);
  expect(data.tasks.every((t) => JSON.parse(t.key)[1] === t.revision.id)).toBe(
    true,
  );
});
it("minute-column matching remains available within the same prescription ID", () => {
  const data = run([
    chain("a", [
      edit("p-a", {
        dates: { start: T(18, 8, 42), periodicity: 8 },
        endDate: T(19, 8),
        results: [
          {
            id: "mark",
            hour: T(18, 8),
            creationDate: T(18, 16, 42),
            status: "EXECUTED",
          },
        ],
      }),
    ]),
  ]);
  expect(data.tasks.map((t) => t.at)).toEqual(
    [T(18, 16), T(19, 0)].map(Date.parse),
  );
  expect(data.tasks.map((t) => apiHourColumn(t.at))).toEqual(
    [T(18, 16), T(19, 0)].map(Date.parse),
  );
});
it("a synthetic snapshot can correctly have no current/next unmarked tasks but six in the following hour", () => {
  const rows = Array.from({ length: 6 }, (_, i) =>
    chain(`chain-${i}`, [
      edit(`prescription-${i}`, {
        dates: {
          start: T(18, i < 4 ? 16 : 18),
          periodicity: i < 2 ? 1 : i < 4 ? 2 : 24,
        },
        endDate: T(18, 19),
        results:
          i < 2
            ? [
                { id: "a", hour: T(18, 16), status: "EXECUTED" },
                { id: "b", hour: T(18, 17), status: "EXECUTED" },
              ]
            : i < 4
              ? [{ id: "a", hour: T(18, 16), status: "EXECUTED" }]
              : [],
      }),
    ]),
  );
  const data = run(rows);
  const now = Date.parse(T(18, 16, 40));
  expect(
    data.tasks.filter((t) => timeBucket(t.at, now, "UTC") === "current"),
  ).toHaveLength(0);
  expect(
    data.tasks.filter((t) => timeBucket(t.at, now, "UTC") === "next"),
  ).toHaveLength(0);
  expect(data.tasks.filter((t) => t.at === Date.parse(T(18, 18)))).toHaveLength(
    6,
  );
  const all = run(
    rows.map((r) => ({
      ...r,
      elements: r.elements.map((e) => ({ ...e, results: [] })),
    })),
  );
  expect(all.tasks.filter((t) => t.at === Date.parse(T(18, 16)))).toHaveLength(
    4,
  );
  expect(all.tasks.filter((t) => t.at === Date.parse(T(18, 17)))).toHaveLength(
    2,
  );
});
