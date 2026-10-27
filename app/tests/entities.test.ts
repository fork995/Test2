import { afterEach, expect, it, vi } from "vitest";
import {
  buildPatient,
  emptyPatientDraft,
  firstSheet,
} from "../src/patientCreation";
import { createEntityApi } from "../src/entityApi";
import { createSessionApi } from "../src/session";
import { normalizeBelongings } from "../src/belongings";
import { API } from "../src/api";
const NOW = Date.parse("2026-10-19T12:00:00Z"),
  ZONE = "Europe/Moscow";
const location = { branchId: "b", departmentId: "d" };
const branch = {
  id: "b",
  name: "Учебная клиника",
  workShiftStart: "8",
  departments: [{ id: "d", name: "Стационар" }],
};
const draft = () => ({
  ...emptyPatientDraft(NOW, ZONE),
  name: "Учебный пациент",
  species: "Кошка",
  breed: "Учебная",
  gender: "FEMALE",
  castrated: "yes",
  years: "2",
  months: "0",
  days: "0",
  weight: "4,8",
  severity: "MODERATE",
  surname: "Вымышленный",
  firstName: "Владелец",
  diagnoses: "Учебный диагноз",
  hospital: "ROUND_THE_CLOCK",
});
const thing = () => ({
  id: "019a0010-0000-7000-8000-000000000001",
  name: "Учебная миска",
  receivingDate: "2026-10-19",
  status: "RECEIVED",
  comment: "Красная\nУчебный текст",
  creationDate: new Date(NOW).toISOString(),
});
const signal = () => new AbortController().signal;
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("creates separate UUIDv7 patient, card, sheet and verified nullable optional fields", () => {
  const p = buildPatient(draft(), branch, ZONE, NOW),
    ids = [p.id, p.card.id, p.card.treatment.sheets[0].id];
  expect(new Set(ids).size).toBe(3);
  ids.forEach((id) =>
    expect(id).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/,
    ),
  );
  expect(p).toMatchObject({
    weightKg: 4.8,
    age: { years: 2, months: 0, days: 0 },
    cageNumber: null,
    castrated: true,
    owner: { patronymic: null, email: null },
  });
  expect(p.card).toMatchObject({
    status: "ACTIVE",
    number: null,
    allergies: null,
    diagnoses: ["Учебный диагноз"],
  });
  expect(p.card.treatment.sheets[0]).toMatchObject({
    start: "2026-10-19T05:00:00.000Z",
    end: "2026-10-20T05:00:00.000Z",
    locked: false,
    creationDate: p.creationDate,
  });
  expect(Object.keys(p.card)).not.toContain("prescriptions");
});
it.each([
  ["2026-10-19T04:59:00Z", "2026-10-18T05:00:00.000Z"],
  ["2026-10-19T05:00:00Z", "2026-10-19T05:00:00.000Z"],
  ["2026-10-19T22:00:00Z", "2026-10-19T05:00:00.000Z"],
])("encloses treatment %s in actual branch shift", (start, expected) =>
  expect(firstSheet(Date.parse(start), branch, ZONE).start).toBe(expected),
);
it("supports DST calendar shift, does not guess minute shift", () => {
  const s = firstSheet(
    Date.parse("2026-03-29T12:00:00Z"),
    { ...branch, workShiftStart: "0" },
    "Europe/Berlin",
  );
  expect((Date.parse(s.end) - Date.parse(s.start)) / 3600000).toBe(23);
  expect(() =>
    firstSheet(NOW, { ...branch, workShiftStart: "08:42" }, ZONE),
  ).toThrow();
});
it.each([
  "gender",
  "severity",
  "hospital",
  "castrated",
  "name",
  "years",
  "weight",
] as const)("requires explicit %s without invented defaults", (key) =>
  expect(() =>
    buildPatient({ ...draft(), [key]: "" }, branch, ZONE, NOW),
  ).toThrow(),
);
it.each([
  { months: "12" },
  { weight: "0" },
  { email: "bad" },
  { clock: "25:00" },
  { date: "2027-01-01" },
  { severity: "EXTREMELY_SEVERE" },
])("rejects invalid creation fields %j", (changes) =>
  expect(() =>
    buildPatient({ ...draft(), ...changes }, branch, ZONE, NOW),
  ).toThrow(),
);
it("preserves explicit optional creation values", () => {
  const p = buildPatient(
    {
      ...draft(),
      cage: "7",
      email: "owner@example.invalid",
      patronymic: "Учебный",
      allergies: "Учебная аллергия",
      diagnoses: "Первый\nВторой",
    },
    branch,
    ZONE,
    NOW,
  );
  expect(p.cageNumber).toBe("7");
  expect(p.card.diagnoses).toEqual(["Первый", "Второй"]);
  expect(p.card.allergies).toBe("Учебная аллергия");
});
it("uses patient ID, exact POST/PUT/DELETE and immutable belonging fields", async () => {
  const f = vi.fn(
      async (_u: string | URL | Request, _o?: RequestInit) =>
        new Response(null, { status: 200 }),
    ),
    api = createEntityApi("MOCK_ONLY", f),
    b = thing();
  await api.addBelonging("patient", b, signal());
  await api.updateBelonging("patient", { ...b, comment: "Изменено" }, signal());
  await api.deleteBelonging("patient", b.id, signal());
  expect(
    f.mock.calls.map((c) => [String(c[0]).replace(API, ""), c[1]?.method]),
  ).toEqual([
    ["/patients/patient/personal-belongings", "POST"],
    [`/patients/patient/personal-belongings/${b.id}`, "PUT"],
    [`/patients/patient/personal-belongings/${b.id}`, "DELETE"],
  ]);
  expect(JSON.parse(f.mock.calls[0][1]!.body as string)).toEqual(b);
  expect(f.mock.calls[2][1]!.body).toBeUndefined();
  expect(f.mock.calls[0][1]).toMatchObject({
    credentials: "omit",
    mode: "cors",
    redirect: "error",
    cache: "no-store",
  });
  expect(JSON.parse(f.mock.calls[1][1]!.body as string).creationDate).toBe(
    b.creationDate,
  );
});
it.each(["RETURNED", "CONSUMED"] as const)(
  "uses original finish and rollback contracts for %s",
  async (status) => {
    const f = vi.fn(
      async (_u: string | URL | Request, _o?: RequestInit) =>
        new Response(null, { status: 200 }),
    );
    const a = createEntityApi("MOCK", f);
    await a.finishBelonging("patient", "thing", status, "2026-10-19", signal());
    await a.receiveBelonging("patient", "thing", signal());
    expect(
      String(f.mock.calls[0][0]).endsWith("/personal-belongings/thing/finish"),
    ).toBe(true);
    expect(JSON.parse(f.mock.calls[0][1]!.body as string)).toEqual({
      status,
      date: "2026-10-19",
    });
    expect(String(f.mock.calls[1][0]).endsWith("/rollback-to-received")).toBe(
      true,
    );
    expect(f.mock.calls[1][1]!.body).toBeUndefined();
  },
);
it.each([401, 403, 404, 409, 500])(
  "handles %s without exposing response",
  async (status) => {
    const expired = vi.fn(),
      f = vi.fn(async () => new Response("PRIVATE BODY", { status }));
    const a = createEntityApi("MOCK", f, expired);
    await expect(
      a.deletePatient(location, "patient", signal()),
    ).rejects.toMatchObject({
      kind:
        status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "Http",
      status,
    });
    expect(expired).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
  },
);
it("hides network details, rejects paths and closed client", async () => {
  const f = vi.fn(async () => {
    throw new TypeError("PRIVATE");
  });
  const a = createEntityApi("MOCK", f);
  await expect(a.belongings("patient", signal())).rejects.toMatchObject({
    kind: "NetworkOrCors",
  });
  expect(() => a.belongings("../bad", signal())).toThrow();
  a.close();
  await expect(a.belongings("patient", signal())).rejects.toMatchObject({
    kind: "Cancelled",
  });
  expect(f).toHaveBeenCalledTimes(1);
});
function server(mode = "ok") {
  let patients: unknown[] = [],
    things: ReturnType<typeof thing>[] = [],
    stale: unknown[] = [];
  const calls: { path: string; method: string; body: any }[] = [];
  const f = vi.fn(async (u: string | URL | Request, o?: RequestInit) => {
    const path = String(u).replace(API, ""),
      method = o?.method || "GET",
      body = o?.body ? JSON.parse(o.body as string) : undefined;
    calls.push({ path, method, body });
    if (method !== "GET" && mode === "error")
      return new Response(null, { status: 403 });
    if (path === "/branches") return Response.json([branch]);
    if (path.includes("personal-belongings")) {
      if (method === "GET")
        return Response.json(mode === "stale" ? stale : things);
      stale = structuredClone(things);
      if (method === "POST") things.push(body);
      if (method === "PUT")
        things = things.map((t) => (t.id === body.id ? body : t));
      if (method === "DELETE") things = [];
      if (method === "PATCH")
        things = things.map((t) =>
          path.endsWith("/finish")
            ? { ...t, status: body.status, returnDate: body.date }
            : { ...t, status: "RECEIVED", returnDate: undefined },
        );
      return new Response(null, { status: 200 });
    }
    if (path.endsWith("/prescription-chains"))
      return Response.json([
        {
          id: "server-chain",
          name: "Учебное стандартное назначение",
          type: "NURSING",
          elements: [],
        },
      ]);
    if (method === "POST") {
      if (mode !== "stale") patients.push(body);
      return new Response(null, { status: 200 });
    }
    if (method === "DELETE") {
      if (mode !== "stale") patients = [];
      return new Response(null, { status: 200 });
    }
    return Response.json(patients);
  });
  const source = createSessionApi("MOCK", f);
  source.entities!.setEnabled(true);
  return {
    source,
    calls,
    f,
    setMode: (next: string) => {
      mode = next;
    },
  };
}
it("full belongings create/edit/return/receive/consume/delete cycle verifies every write through GET", async () => {
  const { source, calls } = server(),
    e = source.entities!,
    b = thing();
  expect(await e.list("patient", signal())).toEqual([]);
  let [current] = await e.change(
    "patient",
    { kind: "add", value: b },
    signal(),
  );
  [current] = await e.change(
    "patient",
    {
      kind: "edit",
      before: current,
      value: { ...current, comment: "Изменено\n✓" },
    },
    signal(),
  );
  expect(current.comment).toBe("Изменено\n✓");
  [current] = await e.change(
    "patient",
    { kind: "finish", before: current, status: "RETURNED", date: "2026-10-19" },
    signal(),
  );
  expect(current.returnDate).toBe("2026-10-19");
  [current] = await e.change(
    "patient",
    { kind: "receive", before: current },
    signal(),
  );
  expect(current.status).toBe("RECEIVED");
  expect(current.returnDate).toBeUndefined();
  [current] = await e.change(
    "patient",
    { kind: "finish", before: current, status: "CONSUMED", date: "2026-10-19" },
    signal(),
  );
  expect(
    await e.change("patient", { kind: "delete", before: current }, signal()),
  ).toEqual([]);
  calls.forEach((c, i) => {
    if (c.method !== "GET") expect(calls[i + 1].method).toBe("GET");
  });
  source.close();
});
it.each(["stale", "error"])(
  "does not confirm unverified belongings %s",
  async (mode) => {
    const { source } = server(mode);
    await expect(
      source.entities!.change(
        "patient",
        { kind: "add", value: thing() },
        signal(),
      ),
    ).rejects.toMatchObject({ kind: "Unverified" });
    source.close();
  },
);
it("rejects stale edits, protected identifiers, duplicate sends and disabled writes", async () => {
  const { source, calls } = server(),
    e = source.entities!;
  const [b] = await e.change(
    "patient",
    { kind: "add", value: thing() },
    signal(),
  );
  await expect(
    e.change(
      "patient",
      { kind: "edit", before: { ...b, comment: "stale" }, value: b },
      signal(),
    ),
  ).rejects.toMatchObject({ kind: "Conflict" });
  await expect(
    e.change(
      "patient",
      {
        kind: "edit",
        before: b,
        value: { ...b, creationDate: "2025-01-01T00:00:00Z" },
      },
      signal(),
    ),
  ).rejects.toMatchObject({ kind: "Conflict" });
  const one = e.change(
    "patient",
    { kind: "edit", before: b, value: { ...b, comment: "new" } },
    signal(),
  );
  await expect(
    e.change("patient", { kind: "delete", before: b }, signal()),
  ).rejects.toMatchObject({ kind: "Busy" });
  await one;
  e.setEnabled(false);
  await expect(
    e.change("patient", { kind: "delete", before: b }, signal()),
  ).rejects.toMatchObject({ kind: "Disabled" });
  expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
  source.close();
});
it("aborted previous patient never sends a mutation", async () => {
  const { source, calls } = server();
  const c = new AbortController();
  c.abort();
  await expect(
    source.entities!.change(
      "old-patient",
      { kind: "add", value: thing() },
      c.signal,
    ),
  ).rejects.toBeDefined();
  expect(calls.filter((c) => c.method !== "GET")).toHaveLength(0);
  source.close();
});
it("creates, verifies fresh list, loads server standard chains, then deletes by patient ID after exact name", async () => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  const { source, calls } = server(),
    e = source.entities!;
  const { patient } = await e.create(location, draft(), ZONE);
  expect(patient.name).toBe("Учебный пациент");
  const chains = await source.chains(patient.cardId);
  expect(chains[0].id).toBe("server-chain");
  await expect(e.remove(patient, "wrong")).rejects.toMatchObject({
    kind: "Conflict",
  });
  expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  expect(await e.remove(patient, patient.name)).toEqual([]);
  const mutation = calls.find((c) => c.method === "DELETE")!;
  expect(mutation.path.endsWith(`/patients/${patient.id}`)).toBe(true);
  expect(mutation.path).not.toContain(patient.cardId);
  expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  expect(calls.at(-1)?.method).toBe("GET");
  source.close();
});
it.each(["stale", "error"])(
  "never confirms creation with %s response",
  async (mode) => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const { source } = server(mode);
    await expect(
      source.entities!.create(location, draft(), ZONE),
    ).rejects.toMatchObject({ kind: "Unverified" });
    source.close();
  },
);
it("rejects unknown department before POST and concurrent creation", async () => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  const { source, calls } = server(),
    e = source.entities!;
  await expect(
    e.create({ ...location, departmentId: "unavailable" }, draft(), ZONE),
  ).rejects.toMatchObject({ kind: "Conflict" });
  const one = e.create(location, draft(), ZONE);
  await expect(e.create(location, draft(), ZONE)).rejects.toMatchObject({
    kind: "Busy",
  });
  await one;
  expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  source.close();
});
it("rejects malformed belonging dates and duplicate identities", () => {
  expect(() =>
    normalizeBelongings([{ ...thing(), receivingDate: "2026-02-31" }]),
  ).toThrow();
  expect(() => normalizeBelongings([thing(), thing()])).toThrow();
});

it.each(["error", "stale"])(
  "does not remove patient on failed or unverified DELETE: %s",
  async (mode) => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const { source, calls, setMode } = server();
    const { patient } = await source.entities!.create(location, draft(), ZONE);
    setMode(mode);
    await expect(
      source.entities!.remove(patient, patient.name),
    ).rejects.toMatchObject({ kind: "Unverified" });
    expect(patient.cardStatus).toBe("ACTIVE");
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
    source.close();
  },
);
