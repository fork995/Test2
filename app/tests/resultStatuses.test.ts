import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSessionApi } from "../src/session";
import { type ResultTarget } from "../src/resultWriter";
import { normalizeChains, indexChains } from "../src/model";
import {
  buildPatientSchedule,
  API_SCHEDULE_POLICY,
  summaryForHour,
} from "../src/scheduleEngine";
import { cellFill, cellRevisions } from "../src/cellAppearance";
import { PrescriptionStore } from "../src/store";
import { API } from "../src/api";
const H = 3600000,
  at = Date.parse("2026-10-19T07:00:00Z"),
  now = at + 3 * H,
  iso = (t: number) => new Date(t).toISOString(),
  zone = "Europe/Moscow";
type Status = "EXECUTED" | "NOT_EXECUTED";
beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(now));
afterEach(() => vi.restoreAllMocks());
function server(status?: Status, periodicity: unknown = 1) {
  const patient = {
    id: "patient",
    name: "Учебный пациент",
    card: {
      id: "record",
      status: "ACTIVE",
      treatment: {
        start: iso(at - 2 * H),
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
  };
  const result = (id: string, hour: number, s: Status) => ({
    id,
    status: s,
    reason: s === "NOT_EXECUTED" ? "DEVICE_ABSENT" : undefined,
    comment: s === "EXECUTED" ? "Учебный комментарий ✓" : "",
    color: "violet",
    hour: iso(hour),
    creationDate: iso(now - 60000),
  });
  let chains = [
    {
      id: "chain",
      name: "Учебное назначение",
      type: "NURSING",
      elements: [
        {
          id: "prescription",
          color: "yellow",
          dates: { start: iso(at), periodicity },
          endDate: iso(at + 20 * H),
          specifics: {},
          results: [
            ...(status ? [result("result", at, status)] : []),
            result("another-hour", at + H, "EXECUTED"),
          ],
        },
      ],
    },
  ];
  const calls: { path: string; method: string; body: any }[] = [];
  let error = 0,
    stale = false,
    failRead = false,
    sent = false;
  const original = structuredClone(chains);
  const fetcher = vi.fn(
    async (url: string | URL | Request, o?: RequestInit) => {
      const path = String(url).replace(API, ""),
        method = o?.method ?? "GET",
        body = o?.body ? JSON.parse(o.body as string) : undefined;
      calls.push({ path, method, body });
      if (method !== "GET") {
        if (error) return new Response(null, { status: error });
        expect(path).toMatch(
          /^\/medical-records\/record\/prescriptions\/prescription\/execution-results\/[a-zA-Z0-9-]+$/,
        );
        const id = path.split("/").at(-1)!;
        sent = true;
        if (method === "DELETE")
          chains[0].elements[0].results = chains[0].elements[0].results.filter(
            (r) => r.id !== id,
          );
        else {
          expect(method).toBe("PUT");
          expect(["EXECUTED", "NOT_EXECUTED"]).toContain(body.status);
          chains[0].elements[0].results = chains[0].elements[0].results
            .filter((r) => r.id !== id)
            .concat(body);
        }
        return new Response(null, { status: 200 });
      }
      if (path.endsWith("/prescription-chains")) {
        if (failRead && sent) throw new TypeError("PRIVATE");
        return Response.json(stale && sent ? original : chains);
      }
      if (path === "/branches/b/departments/d/patients")
        return Response.json([patient]);
      throw Error("Unknown mock request");
    },
  );
  const source = createSessionApi("MOCK_NOT_A_TOKEN", fetcher);
  source.results!.setEnabled(true);
  async function load(): Promise<ResultTarget> {
    const [p] = await source.patients("b", "d", undefined, true),
      [c] = await source.chains("record", undefined, true);
    return {
      patient: p,
      chainId: c.id,
      revision: c.elements[0],
      at,
      zone,
      existing: c.elements[0].results.find((r) => r.at === at),
    };
  }
  return {
    source,
    load,
    calls,
    patient,
    get chains() {
      return chains;
    },
    setError: (s: number) => (error = s),
    setStale: () => (stale = true),
    setReadError: () => (failRead = true),
  };
}
const period = {
  start: at - 2 * H,
  end: at + 22 * H,
  source: "sheet" as const,
  key: "shift",
  patients: 1,
  warnings: [],
};
function summary(
  chains: ReturnType<typeof normalizeChains>,
  target: ResultTarget,
  hour = at,
) {
  return summaryForHour(
    buildPatientSchedule(
      indexChains(chains),
      target.patient,
      period,
      API_SCHEDULE_POLICY,
      "ALL",
      zone,
    ),
    hour,
    now,
    zone,
  );
}
const transitions = [
  ["unmarked", "EXECUTED"],
  ["unmarked", "NOT_EXECUTED"],
  ["EXECUTED", "unmarked"],
  ["EXECUTED", "NOT_EXECUTED"],
  ["NOT_EXECUTED", "unmarked"],
  ["NOT_EXECUTED", "EXECUTED"],
] as const;
it.each(transitions)(
  "past-hour transition %s → %s verifies GET, exact target and no changes to other hours",
  async (from, to) => {
    const f = server(from === "unmarked" ? undefined : from),
      target = await f.load(),
      other = structuredClone(
        f.chains[0].elements[0].results.find((r) => r.id === "another-hour"),
      );
    expect(summary(normalizeChains(f.chains), target).unmarked).toBe(
      from === "unmarked" ? 1 : 0,
    );
    const receipt =
      to === "unmarked"
        ? await f.source.results!.remove(target)
        : await f.source.results!.save(target, {
            status: to,
            comment: to === "EXECUTED" ? "Новый текст\n🐾" : "",
            reason: to === "NOT_EXECUTED" ? "ORGANIZATIONAL" : undefined,
          });
    const writes = f.calls.filter((c) => c.method !== "GET");
    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe(to === "unmarked" ? "DELETE" : "PUT");
    if (to === "unmarked") {
      expect(writes[0].path).toBe(
        "/medical-records/record/prescriptions/prescription/execution-results/result",
      );
      expect(writes[0].body).toBeUndefined();
      expect(summary(receipt.chains, target)).toMatchObject({
        unmarked: 1,
        status: "overdue",
      });
    } else {
      expect(writes[0].body).toMatchObject({ status: to, hour: iso(at) });
      if (to === "EXECUTED") {
        expect(writes[0].body).not.toHaveProperty("reason");
        expect(writes[0].body.comment).toBe("Новый текст\n🐾");
      } else expect(writes[0].body.reason).toBe("ORGANIZATIONAL");
      expect(summary(receipt.chains, target)).toMatchObject({
        unmarked: 0,
        status: "done",
      });
    }
    expect(f.calls.at(-1)).toMatchObject({
      method: "GET",
      path: "/medical-records/record/prescription-chains",
    });
    expect(
      f.chains[0].elements[0].results.find((r) => r.id === "another-hour"),
    ).toEqual(other);
    expect(receipt.chains[0].elements[0].color).toBe("yellow");
    expect(receipt.chains[0].elements[0].periodicity).toBe(1);
    if (to === "unmarked") {
      const [i] = indexChains(receipt.chains);
      expect(cellFill(cellRevisions(i, at, zone), [])).toBe("yellow");
      expect(i.entries.some((e) => e.result.at === at)).toBe(false);
    }
    expect(f.calls.some((c) => ["POST", "PATCH"].includes(c.method))).toBe(
      false,
    );
    f.source.close();
  },
);
it.each([0, 1, 8, 24])(
  "periodicity %s: deleting result restores exactly one past scheduled slot",
  async (p) => {
    const f = server("EXECUTED", p),
      t = await f.load(),
      r = await f.source.results!.remove(t);
    expect(summary(r.chains, t)).toMatchObject({
      scheduled: 1,
      unmarked: 1,
      status: "overdue",
    });
    expect(summary(r.chains, t, at + 4 * H).status).not.toBe("overdue");
    f.source.close();
  },
);
it("multiple missing prescriptions count 1, 2, 3, then EXECUTED/NOT_EXECUTED clear pending work", async () => {
  const f = server("EXECUTED"),
    t = await f.load();
  f.chains.push(
    {
      ...structuredClone(f.chains[0]),
      id: "chain-2",
      elements: [
        {
          ...structuredClone(f.chains[0].elements[0]),
          id: "prescription-2",
          results: [],
        },
      ],
    },
    {
      ...structuredClone(f.chains[0]),
      id: "chain-3",
      elements: [
        {
          ...structuredClone(f.chains[0].elements[0]),
          id: "prescription-3",
          results: [],
        },
      ],
    },
  );
  expect(summary(normalizeChains(f.chains), t).unmarked).toBe(2);
  const r = await f.source.results!.remove(t);
  expect(summary(r.chains, t)).toMatchObject({
    unmarked: 3,
    status: "overdue",
  });
  f.source.close();
});
it.each([undefined, null])(
  "manual %s: delete removes only event; never automatic overdue or prefill",
  async (p) => {
    const f = server("EXECUTED", p);
    f.chains[0].elements[0].dates.periodicity = p;
    const t = await f.load();
    const r = await f.source.results!.remove(t);
    expect(summary(r.chains, t)).toMatchObject({
      scheduled: 0,
      unmarked: 0,
      status: "nothing",
    });
    const [i] = indexChains(r.chains);
    expect(cellFill(cellRevisions(i, at, zone), [])).toBe("#131f23");
    expect(i.entries.some((e) => e.result.id === "another-hour")).toBe(true);
    f.source.close();
  },
);
it("inactive revisions cannot be written, deleted or counted", async () => {
  const f = server("EXECUTED"),
    t = await f.load();
  t.revision.start = null;
  await expect(f.source.results!.remove(t)).rejects.toMatchObject({
    kind: "Unavailable",
  });
  const data = normalizeChains(f.chains);
  data[0].elements[0].start = null;
  expect(summary(data, t)).toMatchObject({
    scheduled: 0,
    unmarked: 0,
    status: "nothing",
  });
  expect(f.calls.some((c) => c.method !== "GET")).toBe(false);
  f.source.close();
});
it("future scheduled slots are not blocked by current clock", async () => {
  const f = server(),
    t = await f.load();
  t.at = at + 8 * H;
  t.existing = undefined;
  const r = await f.source.results!.save(t, {
    status: "EXECUTED",
    comment: "",
  });
  expect(r.chains[0].elements[0].results.some((r) => r.at === t.at)).toBe(true);
  expect(summary(normalizeChains(f.chains), t, t.at).status).toBe("done");
  f.source.close();
});
it("duplicate automatic results are not bulk-deleted or misreported as planned", async () => {
  const f = server("EXECUTED");
  f.chains[0].elements[0].results.push({
    ...structuredClone(f.chains[0].elements[0].results[0]),
    id: "duplicate",
  });
  const t = await f.load();
  await expect(f.source.results!.remove(t)).rejects.toMatchObject({
    kind: "AmbiguousSlot",
  });
  expect(f.calls.some((c) => c.method === "DELETE")).toBe(false);
  f.source.close();
});
it.each(["DELETE", "PUT"])(
  "%s errors preserve verified snapshot; no optimistic update",
  async (method) => {
    const f = server("EXECUTED"),
      t = await f.load(),
      store = new PrescriptionStore(f.source, () => {});
    const before = normalizeChains(f.chains);
    store.acceptVerified("record", before);
    f.setError(500);
    await expect(
      method === "DELETE"
        ? f.source.results!.remove(t)
        : f.source.results!.save(t, {
            status: "NOT_EXECUTED",
            reason: "DEVICE_ABSENT",
            comment: "",
          }),
    ).rejects.toMatchObject({ kind: "Unverified" });
    expect(store.getSnapshot().get("record")!.chains).toBe(before);
    expect(summary(before, t).unmarked).toBe(0);
    expect(f.chains[0].elements[0].results[0].status).toBe("EXECUTED");
    store.close();
    f.source.close();
  },
);
it.each(["stale", "failed"])(
  "DELETE success but %s verification never confirms planned",
  async (mode) => {
    const f = server("EXECUTED"),
      t = await f.load();
    if (mode === "stale") f.setStale();
    else f.setReadError();
    await expect(f.source.results!.remove(t)).rejects.toMatchObject({
      kind: "Unverified",
    });
    expect(f.calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
    f.source.close();
  },
);
it.each(["DELETE", "PUT"])("double %s sends once", async (method) => {
  const f = server("EXECUTED"),
    t = await f.load(),
    run = () =>
      method === "DELETE"
        ? f.source.results!.remove(t)
        : f.source.results!.save(t, {
            status: "NOT_EXECUTED",
            reason: "ORGANIZATIONAL",
            comment: "",
          });
  const first = run();
  await expect(run()).rejects.toMatchObject({ kind: "Busy" });
  await first;
  expect(f.calls.filter((c) => c.method !== "GET")).toHaveLength(1);
  f.source.close();
});

it("does not delete a result ID repeated at a different hour", async () => {
  const f = server("EXECUTED");
  f.chains[0].elements[0].results.push({
    ...structuredClone(f.chains[0].elements[0].results[0]),
    hour: iso(at + 2 * H),
  });
  const t = await f.load();
  await expect(f.source.results!.remove(t)).rejects.toMatchObject({
    kind: "Conflict",
  });
  expect(f.calls.some((c) => c.method === "DELETE")).toBe(false);
  f.source.close();
});
