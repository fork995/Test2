import { afterEach, expect, it, vi } from "vitest";
import { API } from "../src/api";
import { normalizeChains, normalizePatients } from "../src/model";
import {
  FINISH_LABELS,
  FINISH_RESULTS,
  availableFinishResults,
} from "../src/finishResults";
import { createDischargeApi } from "../src/dischargeApi";
import { createTransferApi } from "../src/transferApi";
import { createSessionApi } from "../src/session";
import { preservedHistory, transferTargets } from "../src/transfer";
import { severityLabel, SEVERITIES } from "../src/patientPresentation";
const FROM = { branchId: "b", departmentId: "d" },
  TO = { branchId: "b2", departmentId: "d2" };
const END = "2026-10-18T17:41:00.000Z";
const branches = [
  {
    id: "b",
    name: "Учебная клиника",
    workShiftStart: "08:00",
    departments: [
      { id: "d", name: "Стационар" },
      { id: "d-other", name: "Другое отделение" },
    ],
  },
  {
    id: "b2",
    name: "Учебная клиника 2",
    workShiftStart: "08:00",
    departments: [{ id: "d2", name: "Терапия" }],
  },
];
const rawPatient = () => ({
  id: "patient",
  name: "Учебный пациент",
  severity: "MODERATE",
  owner: {
    surname: "Вымышленная",
    name: "Анна",
    patronymic: "Учебная",
    phone: "DO_NOT_DISPLAY",
    email: "DO_NOT_DISPLAY",
  },
  card: {
    id: "card",
    status: "ACTIVE",
    hospital: "ROUND_THE_CLOCK",
    treatment: {
      start: "2026-10-18T08:00:00Z",
      sheets: [
        {
          id: "sheet",
          start: "2026-10-18T08:00:00Z",
          end: "2026-10-19T08:00:00Z",
        },
      ],
    },
  },
});
const rawChains = () => [
  {
    id: "chain",
    name: "Учебное назначение",
    type: "NURSING",
    elements: [
      {
        id: "revision",
        dates: { start: "2026-10-18T08:00:00Z" },
        color: "yellow",
        results: [
          {
            id: "result",
            hour: "2026-10-18T08:17:00Z",
            status: "EXECUTED",
            comment: "Учебная запись",
          },
        ],
      },
    ],
  },
];
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it.each(Object.entries(SEVERITIES))(
  "translates verified severity %s and retains raw API field",
  (key, expected) => {
    const p = normalizePatients([{ ...rawPatient(), severity: key }])[0];
    expect(p.severity).toBe(key);
    expect(severityLabel(p.severity)).toBe(expected.label);
  },
);
it("does not guess EXTREMELY_SEVERE or translate arbitrary new enum", () => {
  expect(severityLabel("EXTREMELY_SEVERE")).toBe("EXTREMELY_SEVERE");
  expect(Object.keys(SEVERITIES)).toEqual([
    "CRITICAL",
    "HIGH_SEVERE",
    "SEVERE",
    "MODERATE",
    "SATISFACTORY",
  ]);
});
it("uses original owner surname/name/patronymic only, without phone or email", () => {
  const p = normalizePatients([rawPatient()])[0];
  expect(p.ownerName).toBe("Вымышленная Анна Учебная");
  expect(JSON.stringify(p)).not.toContain("DO_NOT_DISPLAY");
  expect(
    normalizePatients([{ ...rawPatient(), owner: { name: "Анна" } }])[0]
      .ownerName,
  ).toBe("Анна");
  expect(
    normalizePatients([{ ...rawPatient(), owner: null }])[0].ownerName,
  ).toBe("");
});
it.each(FINISH_RESULTS)(
  "sends exact verified finish enum %s and UTC time",
  async (result) => {
    const f = vi.fn(async () => new Response("", { status: 200 }));
    const api = createDischargeApi("MOCK_NOT_JWT", f);
    await api.finish("card", END, new AbortController().signal, result);
    expect(f.mock.calls).toHaveLength(1);
    expect(
      JSON.parse(
        (f.mock.calls as unknown as [string, RequestInit][])[0][1]
          .body as string,
      ),
    ).toEqual({ result, end: END });
  },
);
it("matches original result filtering by hospital, and not by department transfer", () => {
  expect(FINISH_LABELS).toEqual({
    DISCHARGED: "Выписан",
    DIED: "Умер",
    TRANSFERRED_TO_DAY_HOSPITAL: "Переведён в дневной стационар",
    TRANSFERRED_TO_ROUND_THE_CLOCK_HOSPITAL:
      "Переведён в круглосуточный стационар",
    INTERRUPTED_BY_OWNER: "Лечение прервано по инициативе владельца",
  });
  expect(availableFinishResults("ROUND_THE_CLOCK")).not.toContain(
    "TRANSFERRED_TO_ROUND_THE_CLOCK_HOSPITAL",
  );
  expect(availableFinishResults("DAY")).not.toContain(
    "TRANSFERRED_TO_DAY_HOSPITAL",
  );
  expect(availableFinishResults("unknown")).toHaveLength(5);
});
it("rejects unconfirmed finish enum before any network call", async () => {
  const f = vi.fn();
  const api = createDischargeApi("MOCK", f);
  await expect(
    api.finish(
      "card",
      END,
      new AbortController().signal,
      "Русская причина" as never,
    ),
  ).rejects.toMatchObject({ kind: "InvalidResponse" });
  expect(f).not.toHaveBeenCalled();
});
it("excludes only current location and allows another department in same branch", () => {
  expect(
    transferTargets(branches, FROM).map((t) => [t.branchId, t.departmentId]),
  ).toEqual([
    ["b", "d-other"],
    ["b2", "d2"],
  ]);
});
it("uses exact original patient branch PATCH; no finish/card/prescription payload", async () => {
  const f = vi.fn(
    async (_u: string | URL | Request, _o?: RequestInit) =>
      new Response(null, { status: 204 }),
  );
  const api = createTransferApi("MOCK", f);
  await api.move(FROM, "patient", TO, new AbortController().signal);
  const [url, o] = f.mock.calls[0];
  expect(url).toBe(`${API}/branches/b/departments/d/patients/patient/branch`);
  expect(o).toMatchObject({
    method: "PATCH",
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    mode: "cors",
  });
  expect(JSON.parse(o!.body as string)).toEqual({ id: "b2", department: "d2" });
  expect(String(url)).not.toContain("MOCK");
  await expect(
    api.move(FROM, "patient", FROM, new AbortController().signal),
  ).rejects.toMatchObject({ kind: "InvalidResponse" });
  await expect(
    api.move(FROM, "../other", TO, new AbortController().signal),
  ).rejects.toMatchObject({ kind: "InvalidResponse" });
  expect(f).toHaveBeenCalledTimes(1);
});
it.each([401, 403, 409, 500])(
  "handles transfer response %s safely",
  async (status) => {
    const unauthorized = vi.fn(),
      f = vi.fn(async () => new Response("sensitive body", { status }));
    const api = createTransferApi("MOCK", f, unauthorized);
    await expect(
      api.move(FROM, "patient", TO, new AbortController().signal),
    ).rejects.toMatchObject({
      kind:
        status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "Http",
    });
    expect(unauthorized).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
  },
);
it("cancels closed transfer transport and hides network text", async () => {
  const f = vi.fn(async () => {
    throw new TypeError("private message");
  });
  const api = createTransferApi("MOCK", f);
  await expect(
    api.move(FROM, "patient", TO, new AbortController().signal),
  ).rejects.toMatchObject({ kind: "NetworkOrCors" });
  api.close();
  await expect(
    api.move(FROM, "patient", TO, new AbortController().signal),
  ).rejects.toMatchObject({ kind: "Cancelled" });
});
it("compares histories by chain/revision/result identity, never by name", () => {
  const a = normalizeChains(rawChains());
  const b = structuredClone(a);
  expect(preservedHistory(a, b)).toBe(true);
  b[0].id = "other-same-name";
  expect(preservedHistory(a, b)).toBe(false);
  b[0].id = a[0].id;
  b[0].elements[0].results = [];
  expect(preservedHistory(a, b)).toBe(false);
});
function server(
  mode: "ok" | "error" | "stale" | "new-card" | "lost-history" = "ok",
) {
  const p = rawPatient(),
    data = rawChains(),
    calls: { method: string; path: string; body?: unknown }[] = [];
  let moved = false;
  const f = vi.fn(async (url: string | URL | Request, o?: RequestInit) => {
    const path = String(url).replace(API, ""),
      method = o?.method ?? "GET";
    calls.push({
      path,
      method,
      body: o?.body ? JSON.parse(o.body as string) : undefined,
    });
    if (path === "/branches") return Response.json(branches);
    if (method === "PATCH") {
      if (mode === "error") return new Response("", { status: 500 });
      moved = true;
      return new Response(null, { status: 204 });
    }
    if (path.endsWith("/prescription-chains"))
      return Response.json(moved && mode === "lost-history" ? [] : data);
    if (path === "/branches/b/departments/d/patients")
      return Response.json(moved && mode !== "stale" ? [] : [p]);
    if (path === "/branches/b2/departments/d2/patients")
      return Response.json(
        moved
          ? [
              {
                ...p,
                card: {
                  ...p.card,
                  id: mode === "new-card" ? "new-card" : p.card.id,
                },
              },
            ]
          : [],
      );
    throw Error("Unexpected mocked endpoint");
  });
  return { f, calls, data };
}
it("verifies new location, unchanged card and histories before updating source list", async () => {
  const { f, calls, data } = server();
  const source = createSessionApi("MOCK", f);
  const [p] = await source.patients("b", "d");
  await expect(source.transfer!.move(p, TO)).rejects.toMatchObject({
    kind: "Disabled",
  });
  source.transfer!.setEnabled(true);
  const receipt = await source.transfer!.move(p, TO);
  expect(receipt.patients).toEqual([]);
  expect(receipt.patient.cardId).toBe("card");
  expect(calls.filter((c) => c.method === "PATCH")).toEqual([
    {
      method: "PATCH",
      path: "/branches/b/departments/d/patients/patient/branch",
      body: { id: "b2", department: "d2" },
    },
  ]);
  expect(calls.slice(-3).every((c) => c.method === "GET")).toBe(true);
  expect(data).toEqual(rawChains());
  source.close();
});
it.each(["error", "stale", "new-card", "lost-history"] as const)(
  "never confirms unsafe/unknown transfer %s",
  async (mode) => {
    const { f, calls } = server(mode);
    const source = createSessionApi("MOCK", f);
    const [p] = await source.patients("b", "d");
    source.transfer!.setEnabled(true);
    await expect(source.transfer!.move(p, TO)).rejects.toMatchObject({
      kind: "Unverified",
    });
    expect(p.cardStatus).toBe("ACTIVE");
    expect(p.cardId).toBe("card");
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
    source.close();
  },
);
it("rejects invalid destination before PATCH and prevents concurrent send", async () => {
  const { f, calls } = server();
  const source = createSessionApi("MOCK", f);
  const [p] = await source.patients("b", "d");
  source.transfer!.setEnabled(true);
  await expect(source.transfer!.move(p, FROM)).rejects.toMatchObject({
    kind: "Conflict",
  });
  const first = source.transfer!.move(p, TO);
  await expect(source.transfer!.move(p, TO)).rejects.toMatchObject({
    kind: "Busy",
  });
  await first;
  expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
  source.close();
});
