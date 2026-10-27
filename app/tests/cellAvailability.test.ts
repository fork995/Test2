import { it, expect } from "vitest";
import { enabledRevision, revisionEnabled } from "../src/cellAvailability";
import {
  normalizeChains,
  normalizePatients,
  indexChains,
  CATEGORIES,
} from "../src/model";
import {
  cellWriteProblem,
  createResultWriter,
  type ResultPayload,
  type ResultTarget,
} from "../src/resultWriter";
import { hasScheduledTaskOn } from "../src/hourlySummary";
import { cellFill, cellRevisions } from "../src/cellAppearance";
const H = 3600000,
  at = Date.parse("2026-10-19T17:00:00Z"),
  iso = (t: number) => new Date(t).toISOString();
function chain(
  periodicity: unknown = 0,
  start: string | null = iso(at),
  type = "MONITORING",
) {
  return normalizeChains([
    {
      id: "chain",
      name: "Учебное измерение",
      type,
      elements: [
        {
          id: "revision",
          color: "yellow",
          dates: start ? { start, periodicity } : undefined,
          results: [],
          creationDate: iso(at - 24 * H),
        },
      ],
    },
  ])[0];
}
function patient() {
  return normalizePatients([
    {
      id: "patient",
      name: "Демо",
      card: {
        id: "record",
        status: "ACTIVE",
        treatment: {
          sheets: [
            {
              id: "sheet",
              start: iso(at - 2 * H),
              end: iso(at + 22 * H),
              locked: false,
            },
          ],
        },
      },
    },
  ])[0];
}
function target(c = chain(), time = at + H): ResultTarget {
  return {
    patient: patient(),
    chainId: c.id,
    chain: c,
    revision: c.elements[0],
    at: time,
    zone: "Europe/Moscow",
  };
}
it("draft without start is inactive despite results, color and creationDate", () => {
  const c = chain(0, null);
  c.elements[0].results.push({
    id: "r",
    idConfirmed: true,
    at,
    hour: iso(at),
    created: iso(at),
    color: "violet",
    comment: "",
    reason: "",
    status: "EXECUTED",
  });
  expect(enabledRevision(c, at, "UTC")).toBeUndefined();
  expect(cellWriteProblem(target(c, at))).not.toBeNull();
});
for (const p of [0, 3, 1, 24, null, undefined])
  it(`activation independent of periodicity ${p} and empty results`, () => {
    const c = chain(p);
    expect(enabledRevision(c, at + H, "UTC")?.id).toBe("revision");
    expect(cellWriteProblem(target(c))).toBeNull();
    expect(revisionEnabled(c.elements[0], at + H, "UTC", c)).toBe(true);
  });
for (const type of CATEGORIES)
  it(`empty manual hour is available for ${type}, without fill or schedule changes`, () => {
    const c = chain(3, iso(at), type),
      index = indexChains([c])[0];
    expect(cellWriteProblem(target(c))).toBeNull();
    expect(hasScheduledTaskOn(c.elements[0], at + H)).toBe(false);
    expect(cellFill(cellRevisions(index, at + H, "UTC"), [])).toBe("#131f23");
  });
it("continuous hour overlap includes :21 start, excludes end", () => {
  const c = chain(0, iso(at + 21 * 60000));
  expect(enabledRevision(c, at - H, "UTC")).toBeUndefined();
  expect(enabledRevision(c, at, "UTC")?.id).toBe("revision");
  const ended = structuredClone(c);
  ended.elements[0].end = at + 2 * H;
  ended.elements[0].rawEnd = iso(at + 2 * H);
  ended.elements[0].endSource = "endDate";
  expect(enabledRevision(ended, at + H, "UTC")).toBeDefined();
  expect(enabledRevision(ended, at + 2 * H, "UTC")).toBeUndefined();
});
it("parent ends at successor start; fresh GET prevents a stale revision write", async () => {
  const c = chain(3),
    child = {
      ...structuredClone(c.elements[0]),
      id: "child",
      parentId: "revision",
      start: at + 2 * H,
      rawStart: iso(at + 2 * H),
    };
  c.elements.push(child);
  expect(enabledRevision(c, at + H, "UTC")?.id).toBe("revision");
  expect(enabledRevision(c, at + 2 * H, "UTC")?.id).toBe("child");
  expect(cellWriteProblem(target(c, at + 2 * H))).not.toBeNull();
  let sent = 0;
  const t = target(chain(3), at + 3 * H);
  const writer = createResultWriter(
    {
      put: async () => {
        sent++;
      },
      remove: async () => {
        sent++;
      },
      close() {},
    },
    async () => [structuredClone(c)],
    async () => patient(),
  );
  writer.setEnabled(true);
  await expect(
    writer.save(t, { status: "EXECUTED", comment: "" }),
  ).rejects.toMatchObject({ kind: "Unavailable" });
  expect(sent).toBe(0);
});
it("boundary hour uses original first matching revision order", () => {
  const c = chain(3);
  c.elements.push({
    ...structuredClone(c.elements[0]),
    id: "next",
    parentId: "revision",
    start: at + H + 30 * 60000,
  });
  expect(enabledRevision(c, at + H, "UTC")?.id).toBe("revision");
  expect(enabledRevision(c, at + 2 * H, "UTC")?.id).toBe("next");
});
it("locked, absent and out-of-shift sheets remain unavailable", () => {
  const t = target();
  t.patient.sheets[0].locked = true;
  expect(cellWriteProblem(t)).not.toBeNull();
  t.patient.sheets = [];
  expect(cellWriteProblem(t)).not.toBeNull();
  expect(cellWriteProblem(target(chain(), at + 22 * H))).not.toBeNull();
});
it("manual result PUT/GET, duplicate prevention, DELETE/GET, reload keep row active and schedule intact", async () => {
  let c = chain(0);
  c.elements[0].results = [
    {
      id: "done",
      idConfirmed: true,
      status: "EXECUTED",
      reason: "",
      comment: "",
      color: "violet",
      hour: iso(at),
      at,
      created: iso(at),
    },
  ];
  const calls: string[] = [];
  const writer = createResultWriter(
    {
      put: async (_c, _r, p: ResultPayload) => {
        calls.push("PUT");
        c.elements[0].results.push({
          ...p,
          idConfirmed: true,
          at: Date.parse(p.hour),
          created: p.creationDate,
          color: p.color ?? "",
          reason: p.reason ?? "",
        });
      },
      remove: async (_c, _r, id) => {
        calls.push("DELETE");
        c.elements[0].results = c.elements[0].results.filter(
          (r) => r.id !== id,
        );
      },
      close() {},
    },
    async () => {
      calls.push("GET");
      return [structuredClone(c)];
    },
    async () => patient(),
  );
  writer.setEnabled(true);
  const before = JSON.stringify({ ...c.elements[0], results: [] });
  const receipt = await writer.save(target(c), {
    status: "EXECUTED",
    comment: "Учебный замер\n✓",
  });
  expect(calls).toEqual(["GET", "PUT", "GET"]);
  expect(c.elements[0].results).toHaveLength(2);
  expect(c.elements[0].results[1].hour).toBe(iso(at + H));
  expect(JSON.stringify({ ...c.elements[0], results: [] })).toBe(before);
  expect(hasScheduledTaskOn(c.elements[0], at + H)).toBe(false);
  const r = receipt.chains[0].elements[0].results.find((r) => r.at === at + H)!;
  await expect(
    writer.save(target(receipt.chains[0]), {
      status: "EXECUTED",
      comment: "дубль",
    }),
  ).rejects.toMatchObject({ kind: "Conflict" });
  const t = target(receipt.chains[0]);
  t.existing = r;
  await writer.remove(t);
  expect(c.elements[0].results.map((r) => r.id)).toEqual(["done"]);
  expect(enabledRevision(structuredClone(c), at + H, "UTC")).toBeDefined();
});
it("colleague event with minutes in selected hour prevents duplicate", async () => {
  const c = chain(3),
    t = target(c),
    fresh = structuredClone(c);
  fresh.elements[0].results = [
    {
      id: "other",
      idConfirmed: true,
      status: "EXECUTED",
      comment: "",
      color: "",
      reason: "",
      at: at + H + 60000,
      hour: iso(at + H + 60000),
      created: iso(at),
    },
  ];
  let sent = 0;
  const writer = createResultWriter(
    {
      put: async () => {
        sent++;
      },
      remove: async () => {},
      close() {},
    },
    async () => [fresh],
    async () => patient(),
  );
  writer.setEnabled(true);
  await expect(
    writer.save(t, { status: "EXECUTED", comment: "" }),
  ).rejects.toMatchObject({ kind: "Conflict" });
  expect(sent).toBe(0);
});

it("manual event in a nonrecurring hour does not change planned/overdue counters", async () => {
  const { countTasksOn } = await import("../src/hourlySummary");
  const c = chain(3),
    r = c.elements[0],
    treatment = { start: at - H, end: at + 24 * H };
  const summary = (time: number) =>
    countTasksOn(
      [{ ...r, resultHours: r.results.map((x) => x.at) }],
      treatment,
      time,
      at + 4 * H,
    );
  expect(summary(at)).toEqual({ scheduled: 1, unmarked: 1, status: "overdue" });
  r.results.push({
    id: "manual",
    idConfirmed: true,
    status: "EXECUTED",
    comment: "",
    color: "",
    reason: "",
    at: at + H,
    hour: iso(at + H),
    created: iso(at + 4 * H),
  });
  expect(summary(at + H)).toEqual({
    scheduled: 0,
    unmarked: 0,
    status: "nothing",
  });
  expect(summary(at)).toEqual({ scheduled: 1, unmarked: 1, status: "overdue" });
  expect(summary(at + 3 * H)).toEqual({
    scheduled: 1,
    unmarked: 1,
    status: "overdue",
  });
  expect(summary(at + 6 * H)).toEqual({
    scheduled: 1,
    unmarked: 1,
    status: "planned",
  });
});
it("effective treatment end and inactive card override row availability", () => {
  const t = target();
  t.patient.treatmentEnd = at + H;
  expect(cellWriteProblem(t)).toBe("Время вне периода лечения.");
  delete t.patient.treatmentEnd;
  t.patient.cardStatus = "CLOSED";
  expect(cellWriteProblem(t)).not.toBeNull();
});
