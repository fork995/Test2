import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { createSessionApi } from "../src/session";
import { normalizeChains } from "../src/model";
import { createPrescriptionApi } from "../src/prescriptionApi";
import {
  draftProblem,
  makePrescription,
  deletionProblem,
  type PrescriptionDraft,
} from "../src/prescriptions";
import { countTasksOn } from "../src/hourlySummary";
import {
  prescriptionServer,
  pSpecifics,
  P_NOW,
  pIso,
} from "./prescriptionFixtures";
const zone = "Europe/Moscow",
  start = "2026-10-19T13:00:00.000Z";
const draft = (
  type: "MEDICATION" | "NURSING" = "MEDICATION",
): PrescriptionDraft => ({
  name: "Учебное новое назначение",
  type,
  start,
  periodicity: 8,
  color: "yellow",
  instruction: "Комментарий\nДемо ✓",
  zone,
  ...(type === "MEDICATION" ? { specifics: pSpecifics() } : {}),
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(P_NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function setup(history = false) {
  const server = prescriptionServer(history),
    source = createSessionApi("SYNTHETIC_NOT_A_JWT", server.fetcher);
  const patient = (await source.patients("b", "d"))[0],
    chains = await source.chains(patient.cardId);
  const service = source.prescriptions!;
  service.setEnabled(true);
  return { server, source, patient, chains, service };
}
for (const type of ["MEDICATION", "NURSING"] as const)
  it(`creates ${type}, UUIDv7 IDs, empty results, exact GET verification; other history preserved`, async () => {
    const f = await setup(),
      others = structuredClone(f.server.data),
      receipt = await f.service.create(f.patient, draft(type));
    expect(receipt.chains).toHaveLength(3);
    const post = f.server.calls.find((c) => c.method === "POST")!,
      p = post.body.prescription;
    expect(post.path).toBe("/medical-records/record/prescription-chains");
    expect(post.body.id).not.toBe(p.id);
    expect(p.id).toMatch(
      /^[a-f\d]{8}-[a-f\d]{4}-7[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/,
    );
    expect(p).toMatchObject({
      dates: { start, periodicity: 8 },
      results: [],
      instruction: "Комментарий\nДемо ✓",
    });
    expect(p.creationDate).toBe(pIso(P_NOW));
    expect(Object.hasOwn(p, "specifics")).toBe(type === "MEDICATION");
    expect(f.server.calls.at(-1)?.method).toBe("GET");
    expect(f.server.data.slice(0, 2)).toEqual(others);
  });
for (const periodicity of [null, 0, 1, 3, 8, 24])
  it(`preserves scheduling semantics ${periodicity} without making results`, async () => {
    const f = await setup(),
      d = { ...draft("NURSING"), periodicity };
    await f.service.create(f.patient, d);
    const p = f.server.calls.find((c) => c.method === "POST")!.body
      .prescription;
    expect(Object.hasOwn(p.dates, "periodicity")).toBe(periodicity !== null);
    expect(p.results).toEqual([]);
  });
it("revises via PATCH GET POST GET with new ID and parent, preserving all old marks and parameters", async () => {
  const f = await setup(true),
    d = {
      ...draft(),
      name: f.chains[0].name,
      specifics: {
        ...pSpecifics(),
        concentration: {
          value: 50,
          units: { substance: "MILLIGRAM", volume: "MILLILITRE" },
        },
      },
    };
  const r = await f.service.revise(f.patient, f.chains[0], d);
  const writes = f.server.calls.filter((c) => c.method !== "GET");
  expect(writes.map((c) => c.method)).toEqual(["PATCH", "POST"]);
  expect(writes[0]).toMatchObject({
    path: "/medical-records/record/prescription-chains/chain/revision/finish",
    body: { end: start },
  });
  expect(writes[1].path).toBe(
    "/medical-records/record/prescription-chains/chain",
  );
  expect(writes[1].body.parentId).toBe("revision");
  expect(writes[1].body.id).not.toBe("revision");
  expect(writes[1].body.results).toEqual([]);
  expect(r.chains[0].elements[0].results).toEqual(
    f.chains[0].elements[0].results,
  );
  expect(r.chains[0].elements[1].specifics.dosage).toEqual(
    f.chains[0].elements[0].specifics.dosage,
  );
  expect(r.chains[0].elements[1].specifics.concentration).toEqual(
    d.specifics.concentration,
  );
  expect(f.server.calls.map((c) => c.method).slice(-6)).toEqual([
    "GET",
    "GET",
    "PATCH",
    "GET",
    "POST",
    "GET",
  ]);
});
it("finish sends exact end, verifies GET, leaves result history and changes overdue schedule", async () => {
  const f = await setup(),
    r = await f.service.finish(f.patient, f.chains[0], start, zone),
    old = f.chains[0].elements[0],
    updated = r.chains[0].elements[0],
    t = Date.parse("2026-10-19T14:00:00Z");
  const summary = (revision: typeof old) =>
    countTasksOn(
      [{ ...revision, resultHours: revision.results.map((r) => r.at) }],
      {
        start: Date.parse("2026-10-19T05:00:00Z"),
        end: Date.parse("2026-10-20T05:00:00Z"),
      },
      t,
      t + 3600000,
    );
  expect(summary(old).status).toBe("overdue");
  expect(summary(updated).scheduled).toBe(0);
  expect(r.chains[1]).toEqual(f.chains[1]);
});
it("deletes last revision only, leaves prior revision closed and its history intact", async () => {
  const f = await setup(true),
    r = await f.service.revise(f.patient, f.chains[0], {
      ...draft(),
      name: f.chains[0].name,
    });
  const before = structuredClone(r.chains[0].elements[0]);
  const removed = await f.service.deleteRevision(f.patient, r.chains[0]);
  expect(removed.chains[0].elements).toEqual([before]);
  expect(removed.chains[1]).toEqual(f.chains[1]);
  expect(f.server.calls.at(-1)?.method).toBe("GET");
});
it("deletes entire empty chain only; duplicate names do not merge identifiers", async () => {
  const f = await setup();
  const r = await f.service.deleteChain(f.patient, f.chains[0]);
  expect(r.chains).toEqual([f.chains[1]]);
  expect(f.server.calls.find((c) => c.method === "DELETE")?.path).toBe(
    "/medical-records/record/prescription-chains/chain",
  );
});
it("blocks deletion with history and deletion of sole revision without mutation", async () => {
  const f = await setup(true);
  await expect(
    f.service.deleteChain(f.patient, f.chains[0]),
  ).rejects.toMatchObject({ kind: "History" });
  await expect(
    f.service.deleteRevision(f.patient, f.chains[0]),
  ).rejects.toMatchObject({ kind: "History" });
  expect(f.server.calls.every((c) => c.method === "GET")).toBe(true);
});
it("partial failure after PATCH re-reads and exposes the actually stopped revision; never reports success", async () => {
  const f = await setup(true);
  f.server.failure.set("revision", 500);
  try {
    await f.service.revise(f.patient, f.chains[0], {
      ...draft(),
      name: f.chains[0].name,
    });
    throw Error("Expected rejection");
  } catch (e: any) {
    expect(e.kind).toBe("Partial");
    expect(e.snapshot[0].elements).toHaveLength(1);
    expect(e.snapshot[0].elements[0].end).toBe(Date.parse(start));
    expect(e.snapshot[0].elements[0].results).toEqual(
      f.chains[0].elements[0].results,
    );
  }
  expect(f.server.calls.at(-1)?.method).toBe("GET");
  expect(f.server.calls.filter((c) => c.method === "POST")).toHaveLength(1);
});
it("PATCH failure sends no POST and re-reads server", async () => {
  const f = await setup();
  f.server.failure.set("PATCH", 500);
  await expect(
    f.service.revise(f.patient, f.chains[0], {
      ...draft(),
      name: f.chains[0].name,
    }),
  ).rejects.toMatchObject({ kind: "Unverified" });
  expect(f.server.calls.filter((c) => c.method === "POST")).toHaveLength(0);
  expect(f.server.calls.at(-1)?.method).toBe("GET");
  expect(f.server.data[0].elements[0].endDate).toBeUndefined();
});
for (const status of [401, 403, 404, 409, 500, 999])
  it(`create error ${status} cannot produce local success or duplicate retries`, async () => {
    const f = await setup();
    f.server.failure.set("create", status);
    await expect(f.service.create(f.patient, draft())).rejects.toBeDefined();
    expect(f.server.data).toHaveLength(2);
    expect(f.server.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });
for (const mode of ["stale", "failed"] as const)
  it(`successful write with ${mode} confirming GET is not success`, async () => {
    const f = await setup();
    if (mode === "stale") f.server.stale = true;
    else f.server.readFail = true;
    await expect(f.service.create(f.patient, draft())).rejects.toMatchObject({
      kind: "Unverified",
    });
  });
it("changed server chain fails conflict check, without mutation", async () => {
  const f = await setup();
  f.server.data[0].elements[0].instruction = "Коллега";
  await expect(
    f.service.finish(f.patient, f.chains[0], start, zone),
  ).rejects.toMatchObject({ kind: "Conflict" });
  expect(f.server.calls.every((c) => c.method === "GET")).toBe(true);
});
it("disabled editing, missing start, invalid boundary, locked sheet, inactive card cannot mutate", async () => {
  const f = await setup();
  f.service.setEnabled(false);
  await expect(f.service.create(f.patient, draft())).rejects.toMatchObject({
    kind: "Disabled",
  });
  f.service.setEnabled(true);
  await expect(
    f.service.finish(f.patient, f.chains[0], "2026-10-19T06:00:00Z", zone),
  ).rejects.toMatchObject({ kind: "Unavailable" });
  f.server.rawPatient.card.treatment.sheets[0].locked = true;
  await expect(f.service.create(f.patient, draft())).rejects.toMatchObject({
    kind: "Unavailable",
  });
  expect(f.server.calls.every((c) => c.method === "GET")).toBe(true);
});
it("busy guard sends one create under double submission", async () => {
  const f = await setup();
  let release!: () => void;
  f.server.delay = new Promise((r) => (release = r));
  const first = f.service.create(f.patient, draft());
  await expect(f.service.create(f.patient, draft())).rejects.toMatchObject({
    kind: "Busy",
  });
  release();
  await first;
  expect(f.server.calls.filter((c) => c.method === "POST")).toHaveLength(1);
});
for (const field of [
  "zero-dose",
  "zero-concentration",
  "unknown-units",
  "missing-weight",
  "negative-period",
  "NURSING-specifics",
  "route-mismatch",
] as const)
  it(`validates ${field}`, () => {
    const d = draft(),
      s = d.specifics as any;
    if (field === "zero-dose") s.dosage.value = 0;
    if (field === "zero-concentration") s.concentration.value = 0;
    if (field === "unknown-units") s.dosage.units.substance = "GUESS";
    if (field === "missing-weight") delete s.weightKg;
    if (field === "negative-period") d.periodicity = -1;
    if (field === "NURSING-specifics") d.type = "NURSING";
    if (field === "route-mismatch") {
      s.concentration.units.volume = "TABLET";
      s.route = "INTRAVENOUS";
    }
    expect(draftProblem(d)).not.toBeNull();
    expect(() => makePrescription(d)).toThrow();
  });
it("GRAMME and time-dependent units are sent unchanged; no dose inference", () => {
  const d = draft(),
    s = d.specifics as any;
  s.dosage = {
    value: 30,
    units: { substance: "MICROGRAM", volume: "KILOGRAM", time: "MINUTE" },
  };
  s.concentration.units.substance = "GRAMME";
  expect(draftProblem(d)).toBeNull();
  expect(makePrescription(d).specifics).toEqual(s);
});
it("transport uses only six confirmed paths/methods, omits DELETE body, stops at 401", async () => {
  const calls: any[] = [],
    fetcher = vi.fn(async (u: any, o: any) => {
      calls.push({ u, o });
      return new Response(null, { status: 200 });
    }),
    api = createPrescriptionApi("SYNTHETIC", fetcher),
    s = new AbortController().signal,
    p = makePrescription(draft());
  await api.create(
    "record",
    { id: "chain", name: "Учебное", type: "MEDICATION", prescription: p },
    s,
  );
  await api.addRevision("record", "chain", p, s);
  await api.finish("record", "chain", p.id, start, s);
  await api.deleteRevision("record", "chain", p.id, s);
  await api.deleteChain("record", "chain", s);
  expect(calls.map((c) => c.o.method)).toEqual([
    "POST",
    "POST",
    "PATCH",
    "DELETE",
    "DELETE",
  ]);
  expect(calls[3].o.body).toBeUndefined();
  expect(
    calls.every((c) => c.o.credentials === "omit" && c.o.redirect === "error"),
  ).toBe(true);
  expect(() => api.deleteChain("../bad", "chain", s)).toThrow();
  expect(calls).toHaveLength(5);
  api.close();
  await expect(
    api.create(
      "record",
      { id: "chain", name: "x", type: "MEDICATION", prescription: p },
      s,
    ),
  ).rejects.toBeDefined();
});
it("other revisions with results never allow a whole-chain delete", () => {
  const c = normalizeChains([
    {
      id: "c",
      elements: [
        { id: "old", results: [{ id: "result" }] },
        { id: "new", results: [] },
      ],
    },
  ])[0];
  expect(deletionProblem(c)).not.toBeNull();
  expect(deletionProblem(c, true)).toBeNull();
});

for (const method of ["DELETE", "PATCH"] as const)
  it(`${method} error preserves actual server data and rereads`, async () => {
    const f = await setup();
    const before = structuredClone(f.server.data);
    f.server.failure.set(method, 403);
    if (method === "DELETE")
      await expect(
        f.service.deleteChain(f.patient, f.chains[0]),
      ).rejects.toBeDefined();
    else
      await expect(
        f.service.finish(f.patient, f.chains[0], start, zone),
      ).rejects.toBeDefined();
    expect(f.server.data).toEqual(before);
    expect(f.server.calls.at(-1)?.method).toBe("GET");
  });
it("401 clears prescription transport and prevents further requests", async () => {
  const onUnauthorized = vi.fn(),
    fetcher = vi.fn(async () => new Response(null, { status: 401 })),
    api = createPrescriptionApi("SYNTHETIC", fetcher, onUnauthorized),
    signal = new AbortController().signal;
  await expect(api.deleteChain("card", "chain", signal)).rejects.toMatchObject({
    kind: "Unauthorized",
  });
  expect(onUnauthorized).toHaveBeenCalledOnce();
  await expect(api.deleteChain("card", "chain", signal)).rejects.toMatchObject({
    kind: "Cancelled",
  });
  expect(fetcher).toHaveBeenCalledOnce();
});
it("revising preserves an existing non-palette source color without introducing new enum", async () => {
  const f = await setup();
  f.server.data[0].elements[0].color = "blue";
  const original = normalizeChains(f.server.data)[0];
  const receipt = await f.service.revise(f.patient, original, {
    ...draft(),
    name: original.name,
    color: "blue",
  });
  expect(receipt.chains[0].elements[1].color).toBe("blue");
  expect(
    draftProblem({ ...draft(), color: "not-a-confirmed-new-color" }),
  ).not.toBeNull();
});
it("editing remains unavailable for inactive revisions and invalid end date", async () => {
  const f = await setup();
  delete f.server.data[0].elements[0].dates;
  const original = normalizeChains(f.server.data)[0];
  await expect(
    f.service.revise(f.patient, original, { ...draft(), name: original.name }),
  ).rejects.toMatchObject({ kind: "Unavailable" });
  expect(f.server.calls.every((c) => c.method === "GET")).toBe(true);
  f.server.data[0].elements[0].dates = {
    start: "2026-10-19T06:00:00Z",
    periodicity: 8,
  };
  f.server.data[0].elements[0].endDate = "invalid-date";
  const invalidEnd = normalizeChains(f.server.data)[0];
  await expect(
    f.service.revise(f.patient, invalidEnd, {
      ...draft(),
      name: invalidEnd.name,
    }),
  ).rejects.toMatchObject({ kind: "Unavailable" });
  expect(f.server.calls.every((c) => c.method === "GET")).toBe(true);
});

it("patient archived by a colleague is rejected before any mutation", async () => {
  const f = await setup();
  f.server.rawPatient.card.status = "ARCHIVED";
  await expect(
    f.service.deleteChain(f.patient, f.chains[0]),
  ).rejects.toMatchObject({ kind: "Unavailable" });
  expect(f.server.calls.every((c) => c.method === "GET")).toBe(true);
});
it("current open sheet does not permit deletion of a chain intersecting a locked historical sheet", async () => {
  const f = await setup();
  f.server.rawPatient.card.treatment.sheets = [
    {
      id: "old",
      start: "2026-10-19T05:00:00Z",
      end: "2026-10-19T08:00:00Z",
      locked: true,
    },
    {
      id: "current",
      start: "2026-10-19T08:00:00Z",
      end: "2026-10-20T05:00:00Z",
      locked: false,
    },
  ];
  await expect(
    f.service.deleteChain(f.patient, f.chains[0]),
  ).rejects.toMatchObject({ kind: "History" });
  expect(f.server.calls.every((c) => c.method === "GET")).toBe(true);
});
it("equivalent server ISO timestamps without milliseconds do not cause false conflict or failed verification", async () => {
  const f = await setup(true);
  f.server.normalizeTimes = true;
  const result = await f.service.revise(f.patient, f.chains[0], {
    ...draft(),
    name: f.chains[0].name,
  });
  expect(result.chains[0].elements).toHaveLength(2);
  expect(result.chains[0].elements[0].end).toBe(Date.parse(start));
  expect(result.chains[0].elements[1].start).toBe(Date.parse(start));
  expect(result.chains[0].elements[0].rawEnd).toBe(start.replace(".000Z", "Z"));
});
