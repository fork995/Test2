import { it, expect } from "vitest";
import { normalizeChains, indexChains } from "../src/model";
import { buildFeed, revisionDiagnostics } from "../src/feed";
import { clinicalFields, workClinicalFields } from "../src/clinical";
import { rawChains, T } from "./fixtures";
import { mockData } from "../src/mock";
import type { Period } from "../src/period";
const window: Period = {
  start: Date.parse(T(18, 8)),
  end: Date.parse(T(19, 8)),
  key: "test",
  source: "sheet",
  patients: 1,
  warnings: [],
};
const indexes = () => indexChains(normalizeChains(rawChains));
it("work rows hide raw technical parameters and move missing-dose-unit warning to details", () => {
  const chain = normalizeChains([
    {
      id: "m",
      type: "MEDICATION",
      elements: [
        {
          id: "r",
          specifics: {
            dose: 5,
            route: "в/в",
            weightKg: 4,
            viewMode: "test",
            parentId: "parent",
          },
        },
      ],
    },
  ])[0];
  const clinical = workClinicalFields(chain, chain.elements[0]);
  expect(clinical.fields.map((f) => f.value).sort()).toEqual(
    ["5", "в/в"].sort(),
  );
  expect(
    clinical.fields.some((f) => /weight|viewMode|parentId/.test(f.path)),
  ).toBe(false);
  expect(clinical.warnings.join(" ")).toContain("единицы не подтверждены");
});
it("chronological feed uses result.hour, not later creationDate", () => {
  const feed = buildFeed(indexes(), window);
  expect(feed.events.map((e) => e.entry!.result.id)).toEqual([
    "s1",
    "m1",
    "v1",
    "mid1",
    "mid2",
  ]);
  expect(feed.events.find((e) => e.entry?.result.id === "m1")?.at).toBe(
    Date.parse(T(18, 10)),
  );
});
it("half-open adjacent shifts never duplicate midnight/boundary events", () => {
  const first = buildFeed(indexes(), window).events;
  const second = buildFeed(indexes(), {
    ...window,
    start: window.end,
    end: Date.parse(T(20, 8)),
  }).events;
  expect(first.some((e) => e.entry?.result.id === "m2")).toBe(false);
  expect(second.map((e) => e.entry!.result.id)).toContain("m2");
  expect(first.some((a) => second.some((b) => a.key === b.key))).toBe(false);
});
it("category filters apply to all feed sections", () => {
  const data = buildFeed(indexes(), window, "SOLUTION");
  expect(data.events).toHaveLength(1);
  expect(data.unscheduled).toHaveLength(0);
  expect(data.events[0].index.chain.id).toBe("solution");
});
it("manual chains do not create clarification cards for any revision", () => {
  const data = buildFeed(indexes(), window);
  expect(data.unscheduled.filter((i) => i.index.chain.id === "med")).toEqual(
    [],
  );
  expect(data.events.some((i) => i.entry?.result.id === "previous")).toBe(
    false,
  );
});
it("missing endDate remains uncertain, never waiting/overdue/not executed", () => {
  const source = indexes();
  source.find((i) => i.chain.id === "activity")!.chain.elements[0].periodicity =
    1;
  const card = buildFeed(source, window).unscheduled.find(
    (i) => i.index.chain.id === "activity",
  )!;
  expect(card.confidence).toBe("uncertain");
  expect(card.entry).toBeUndefined();
  expect(card.warnings.join(" ")).toContain(
    "Активность редакции не подтверждена",
  );
});
it("known finished and future revisions are not silently considered current", () => {
  const data = indexChains(
    normalizeChains([
      {
        id: "old",
        elements: [{ id: "e", dates: { start: T(17, 8) }, endDate: T(17, 9) }],
      },
      { id: "future", elements: [{ id: "f", dates: { start: T(20, 8) } }] },
    ]),
  );
  expect(buildFeed(data, window).unscheduled).toEqual([]);
});
it("missing/ambiguous hour is kept outside the chronological feed", () => {
  const feed = buildFeed(indexes(), window);
  expect(feed.unplaced).toHaveLength(1);
  expect(feed.unplaced[0].at).toBeNull();
  expect(feed.unplaced[0].entry?.result.created).toBe(T(18, 12));
});
it("forks/cycles/missing parents produce warnings and never invent one active revision", () => {
  const forks = indexChains(
    normalizeChains([
      {
        id: "fork",
        elements: [
          { id: "a", dates: { start: T(18, 8) } },
          { id: "b", parentId: "a", dates: { start: T(18, 9) } },
          { id: "c", parentId: "a", dates: { start: T(18, 9) } },
        ],
      },
      {
        id: "cycle",
        elements: [
          { id: "x", parentId: "y", dates: { start: T(18, 8) } },
          { id: "y", parentId: "x", dates: { start: T(18, 9) } },
        ],
      },
      {
        id: "missing",
        elements: [{ id: "z", parentId: "absent", dates: { start: T(18, 8) } }],
      },
    ]),
  );
  const feed = buildFeed(forks, window);
  expect(
    feed.unscheduled.find((i) => i.index.chain.id === "fork")?.revision,
  ).toBeUndefined();
  expect(feed.warnings.length).toBeGreaterThan(0);
  expect(revisionDiagnostics(forks[1]).join(" ")).toContain("цикл");
  expect(revisionDiagnostics(forks[2]).join(" ")).toContain("родительская");
});
it("manual results survive outside bounds without fictitious schedule warnings", () => {
  const data = indexChains(
    normalizeChains([
      {
        id: "c",
        elements: [
          {
            id: "e",
            dates: { start: T(18, 12) },
            endDate: T(18, 13),
            results: [{ id: "r", hour: T(18, 10), status: "EXECUTED" }],
          },
        ],
      },
    ]),
  );
  const item = buildFeed(data, window).events[0];
  expect(item.entry?.result.status).toBe("EXECUTED");
  expect(item.warnings).toEqual([]);
});
it("specifics periodicity 0, 1, 24 does not promote a manual dates definition", () => {
  for (const periodicity of [0, 1, 24]) {
    const data = indexChains(
      normalizeChains([
        {
          id: "c",
          elements: [
            { id: "e", dates: { start: T(18, 8) }, specifics: { periodicity } },
          ],
        },
      ]),
    );
    expect(buildFeed(data, window).events).toEqual([]);
    expect(buildFeed(data, window).unscheduled).toHaveLength(0);
  }
});
it("large feed indexes all data while preserving chronology", () => {
  const data = mockData(true, Date.parse(T(18, 12)));
  const feed = buildFeed(indexChains(data.chains), {
    ...window,
    start: data.start,
    end: data.start + 24 * 3600000,
  });
  // The synthetic current and next hour intentionally have no marks.
  expect(feed.events).toHaveLength(360 * 22);
  expect(feed.unscheduled).toHaveLength(360);
  for (let i = 1; i < feed.events.length; i++)
    expect(feed.events[i].at!).toBeGreaterThanOrEqual(feed.events[i - 1].at!);
});
it("literal duplicate result within a revision is shown once", () => {
  const entry = { id: "r", hour: T(18, 10), status: "EXECUTED" };
  const data = indexChains(
    normalizeChains([
      {
        id: "c",
        elements: [
          { id: "e", dates: { start: T(18, 8) }, results: [entry, entry] },
        ],
      },
    ]),
  );
  expect(buildFeed(data, window).events).toHaveLength(1);
});
it("medication retains source quantities and uses the shared volume calculation", () => {
  const chain = normalizeChains(rawChains)[0],
    fields = clinicalFields(chain, chain.elements[1]);
  expect(fields.find((f) => f.label === "Доза из API")?.value).toBe("5 мг");
  expect(fields.find((f) => f.label === "Путь введения")?.value).toBe("в/в");
  expect(fields.find((f) => f.label === "Концентрация")?.value).toBe(
    "10 мг/мл",
  );
  expect(
    fields.find((f) => f.label === "Масса из исходных данных")?.value,
  ).toBe("4,2 кг");
  expect(fields.find((f) => f.label === "Набрать")?.value).toBe("0,5 мл");
});
it("dose without unit stays raw and doseValue is not multiplied by weight", () => {
  const c = normalizeChains([
    {
      id: "c",
      type: "MEDICATION",
      elements: [
        {
          id: "e",
          specifics: { doseValue: 2, doseUnit: "мг/кг", patientWeightKg: 5 },
        },
        { id: "f", specifics: { dose: 2 } },
      ],
    },
  ])[0];
  expect(
    clinicalFields(c, c.elements[0]).find((f) => f.label === "Доза из API")
      ?.value,
  ).toBe("2 мг/кг");
  expect(
    clinicalFields(c, c.elements[1]).find((f) => f.label === "Доза из API")
      ?.value,
  ).toBe("2");
  expect(workClinicalFields(c, c.elements[1]).warnings.join(" ")).toContain(
    "единицы не подтверждены",
  );
});
it("scarce.value=15 means 15 ml/h; maintenance is not reinterpreted", () => {
  const c = normalizeChains(rawChains)[1];
  const fields = clinicalFields(c, c.elements[0]);
  expect(fields.find((f) => f.label === "Скорость инфузии")?.value).toBe(
    "15 мл/ч",
  );
  expect(fields.some((f) => f.label === "maintenance")).toBe(false);
});
it("unknown clinical fields remain in source data for diagnostics, not clinical labels", () => {
  const c = normalizeChains([
    {
      id: "c",
      type: "MEDICATION",
      elements: [
        {
          id: "e",
          specifics: { drugName: "Demo", unknownDose: { value: 7, unit: "x" } },
        },
      ],
    },
  ])[0];
  const fields = clinicalFields(c, c.elements[0]);
  expect(
    fields.find((f) => f.path === "specifics.unknownDose.value")?.value,
  ).toBeUndefined();
  expect(c.elements[0].specifics.unknownDose).toEqual({ value: 7, unit: "x" });
});
it("contradictory and empty chains remain inspectable rather than silently vanishing", () => {
  const data = indexChains(
    normalizeChains([
      { id: "empty", name: "Пустая цепочка", elements: [] },
      {
        id: "invalid",
        name: "Противоречие",
        elements: [{ id: "e", dates: { start: T(18, 10) }, endDate: T(18, 8) }],
      },
    ]),
  );
  const feed = buildFeed(data, window);
  expect(feed.unscheduled).toHaveLength(2);
  expect(feed.unscheduled.every((i) => i.confidence === "uncertain")).toBe(
    true,
  );
});
it("diagnostic memoization cannot acquire per-period activity warnings by mutation", () => {
  const index = indexes().find((i) => i.chain.id === "activity")!;
  const before = [...revisionDiagnostics(index)];
  buildFeed([index], window);
  expect(revisionDiagnostics(index)).toEqual(before);
});
it("an empty chain diagnostic is stable across repeated feed builds", () => {
  const index = indexChains(
    normalizeChains([{ id: "empty", elements: [] }]),
  )[0];
  const before = [...revisionDiagnostics(index)];
  buildFeed([index], window);
  buildFeed([index], window);
  expect(revisionDiagnostics(index)).toEqual(before);
});
it("prescribed weight with an explicit unit is preserved without duplicating the unit", () => {
  const c = normalizeChains([
    {
      id: "c",
      type: "MEDICATION",
      elements: [
        { id: "e", specifics: { patientWeightKg: { value: 4.2, unit: "кг" } } },
      ],
    },
  ])[0];
  expect(
    clinicalFields(c, c.elements[0]).find(
      (f) => f.label === "Масса из исходных данных",
    )?.value,
  ).toBe("4,2 кг");
});
