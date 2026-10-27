import { describe, it, expect } from "vitest";
import {
  normalizeBranches,
  normalizePatients,
  normalizeChains,
  instant,
  indexChains,
  revisionIntervals,
  effectiveRevisions,
  entriesInRange,
  safeColor,
  cardState,
  lastKnownRevision,
  parameters,
} from "../src/model";
import { mockData } from "../src/mock";
const iso = (h: number) => new Date(Date.UTC(2026, 9, 18, h)).toISOString();
const chain = (elements: unknown[]) =>
  normalizeChains([{ id: "c", name: "Test", type: "SOLUTION", elements }])[0];
describe("runtime adapters", () => {
  it("accepts missing departments and excludes missing ids", () => {
    expect(
      normalizeBranches([
        { id: 1, name: "A" },
        { id: 2, departments: [] },
        {},
      ]).map((b) => b.departments),
    ).toEqual([[], []]);
  });
  it("never confuses patient.id and card.id; normalizes medical fields", () => {
    const p = normalizePatients([
      {
        id: "patient",
        name: "Demo",
        weightKg: 0,
        cageNumber: 0,
        species: { name: "Кошка" },
        card: {
          id: "card",
          status: "ACTIVE",
          diagnoses: [{ name: "Учебный диагноз" }],
          treatment: { sheets: [] },
        },
      },
    ])[0];
    expect(p.id).toBe("patient");
    expect(p.cardId).toBe("card");
    expect(p.weight).toBe("0");
    expect(p.cage).toBe("0");
    expect(p.diagnoses).toBe("Учебный диагноз");
    expect(cardState(p)).toBe("active");
  });
  it("does not silently call unknown status active or show closed cards", () => {
    const p = normalizePatients([
      { id: "1", card: { id: "c", status: "OTHER" } },
      { id: "2", card: { id: "d", status: "CLOSED" } },
      { id: "3" },
    ]);
    expect(p.map(cardState)).toEqual(["unknown", "inactive", "inactive"]);
  });
  it("recognizes only complete offset-qualified sheet intervals", () => {
    const p = normalizePatients([
      {
        id: 1,
        card: {
          id: 2,
          treatment: {
            sheets: [
              { id: 1, dates: { start: iso(8), end: iso(12) } },
              { id: 2, startDate: iso(12), endDate: iso(16) },
              { dates: { start: "2026-10-18T08:00:00", end: iso(12) } },
              { dates: { start: iso(14), end: iso(10) } },
            ],
          },
        },
      },
    ])[0];
    expect(p.sheets).toHaveLength(2);
  });
  it("keeps revision/result colors separate and execution hour distinct from creation", () => {
    const c = chain([
      {
        id: "e",
        color: "#112233",
        dates: { start: iso(0) },
        specifics: { scarce: { value: 2.5 }, maintenance: true },
        results: [
          {
            id: 1,
            hour: iso(9),
            creationDate: iso(11),
            color: "#aabbcc",
            status: "NOT_EXECUTED",
            reason: "UNKNOWN_REASON",
          },
        ],
      },
    ]);
    const e = c.elements[0];
    expect(e.color).toBe("#112233");
    expect(e.results[0].color).toBe("#aabbcc");
    expect(e.results[0].at).toBe(Date.parse(iso(9)));
    expect(e.results[0].created).toBe(iso(11));
    expect(e.specifics).toEqual({ scarce: { value: 2.5 }, maintenance: true });
    expect(e.results[0].reason).toBe("UNKNOWN_REASON");
  });
});
describe("revision safety", () => {
  it("bounds parent by unique child when endDate missing", () => {
    const c = chain([
      { id: "a", dates: { start: iso(0) } },
      { id: "b", parentId: "a", dates: { start: iso(8) } },
    ]);
    const intervals = revisionIntervals(c);
    expect(intervals[0].end).toBe(Date.parse(iso(8)));
    expect(intervals[0].inferred).toBe(true);
    expect(intervals[1].end).toBeNull();
    const index = indexChains([c])[0];
    expect(effectiveRevisions(index, Date.parse(iso(4)))[0].id).toBe("a");
    expect(effectiveRevisions(index, Date.parse(iso(9)))).toEqual([]);
  });
  it("does not treat overlapping parent/child as simultaneous", () => {
    const c = chain([
      { id: "a", dates: { start: iso(0) }, endDate: iso(20) },
      { id: "b", parentId: "a", dates: { start: iso(8) }, endDate: iso(16) },
    ]);
    expect(
      effectiveRevisions(indexChains([c])[0], Date.parse(iso(10))).map(
        (e) => e.id,
      ),
    ).toEqual(["b"]);
  });
  it("does not guess a successor from unrelated chronological revisions", () => {
    expect(
      revisionIntervals(
        chain([
          { id: "a", dates: { start: iso(0) } },
          { id: "b", dates: { start: iso(8) } },
        ]),
      )[0].end,
    ).toBeNull();
  });
  it("rejects ambiguous parent forks and overlapping unrelated intervals", () => {
    const c = chain([
      { id: "a", dates: { start: iso(0) }, endDate: iso(24) },
      { id: "b", parentId: "a", dates: { start: iso(5) }, endDate: iso(24) },
      { id: "d", parentId: "a", dates: { start: iso(6) }, endDate: iso(24) },
    ]);
    expect(revisionIntervals(c)[0].ambiguous).toBe(true);
    expect(
      effectiveRevisions(indexChains([c])[0], Date.parse(iso(10))),
    ).toEqual([]);
  });
  it("does not use creationDate to place results with numeric or time-only hour", () => {
    const c = chain([
      {
        id: "a",
        results: [
          { hour: 9, creationDate: iso(9) },
          { hour: "10:00", creationDate: iso(10) },
          { hour: iso(11), creationDate: iso(12) },
        ],
      },
    ]);
    const indexed = indexChains([c])[0];
    expect(indexed.unplaced).toHaveLength(2);
    expect(indexed.entries).toHaveLength(1);
  });
  it("preserves multiple results in an hour, including unknown statuses", () => {
    const c = chain([
      {
        id: "a",
        dates: { start: iso(0) },
        results: [
          { id: 1, hour: iso(9), status: "EXECUTED" },
          { id: 2, hour: iso(9), status: "NOT_EXECUTED" },
          { id: 3, hour: iso(9), status: "OTHER" },
        ],
      },
    ]);
    expect(
      entriesInRange(
        indexChains([c])[0],
        Date.parse(iso(9)),
        Date.parse(iso(10)),
      ),
    ).toHaveLength(3);
  });
  it("does not infer a latest revision if starts missing or tied", () => {
    expect(
      lastKnownRevision(chain([{ id: "a" }, { id: "b" }])),
    ).toBeUndefined();
    expect(
      lastKnownRevision(
        chain([
          { id: "a", dates: { start: iso(1) } },
          { id: "b", dates: { start: iso(1) } },
        ]),
      ),
    ).toBeUndefined();
  });
  it("caps CSS colors and parameters to safe formats", () => {
    expect(safeColor("#AABBCC")).toBe("#AABBCC");
    expect(safeColor("url(https://external.test/x)")).toBe("#6f8790");
    expect(parameters({ maintenance: true, periodicity: 24 })).toEqual([
      ["maintenance", "да"],
      ["periodicity", "24"],
    ]);
  });
  it("renders named and numeric CSS colors without accepting URLs or injected declarations", () => {
    for (const color of [
      "yellow",
      "violet",
      "cornflowerblue",
      "rgb(255, 0, 0)",
      "hsl(60, 100%, 50%)",
    ])
      expect(safeColor(color)).toBe(color);
    expect(safeColor("  yellow  ")).toBe("yellow");
    for (const color of [
      "yellow; background: red",
      "var(--secret)",
      "inherit",
      "url(/external)",
      "expression(1)",
    ])
      expect(safeColor(color)).toBe("#6f8790");
  });
});
describe("large data and absolute instants", () => {
  it("handles 360 chains and over 13,000 results with range indexing", () => {
    const data = mockData(true, Date.parse("2026-10-18T12:00:00Z"));
    const indexed = indexChains(data.chains);
    expect(indexed).toHaveLength(360);
    expect(indexed.reduce((sum, i) => sum + i.entries.length, 0)).toBe(13320);
    expect(
      entriesInRange(indexed[0], data.start, data.start + 24 * 3600000),
    ).toHaveLength(22);
  });
  it("does not invent a schedule from periodicity 0, 1, 24", () => {
    for (const periodicity of [0, 1, 24]) {
      const index = indexChains([
        chain([
          { id: "a", dates: { start: iso(0) }, specifics: { periodicity } },
        ]),
      ])[0];
      expect(index.entries).toEqual([]);
    }
  });
  it("accepts offsets, rejects missing zones, invalid calendar dates, and invalid clocks", () => {
    expect(instant("2026-10-18T09:00:00+03:00")).toBe(
      Date.parse("2026-10-18T06:00:00Z"),
    );
    for (const invalid of [
      "2026-10-18T09:00:00",
      "09:00",
      9,
      "2026-02-30T09:00:00Z",
      "2026-10-18T24:00:00Z",
    ])
      expect(instant(invalid)).toBeNull();
  });
});

it("preserves treatment.duration.start independently of sheet start", () => {
  const patient = normalizePatients([
    {
      id: "synthetic",
      card: {
        id: "record",
        treatment: {
          duration: { start: "2026-10-18T09:21:00+03:00" },
          sheets: [
            {
              start: "2026-10-18T10:00:00+03:00",
              end: "2026-10-19T10:00:00+03:00",
            },
          ],
        },
      },
    },
  ])[0];
  expect(patient.treatmentStart).toBe(Date.parse("2026-10-18T09:21:00+03:00"));
  expect(patient.sheets[0].start).toBe(Date.parse("2026-10-18T10:00:00+03:00"));
});
