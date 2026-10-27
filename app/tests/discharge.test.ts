import { afterEach, expect, it, vi } from "vitest";
import { API } from "../src/api";
import { createDischargeApi } from "../src/dischargeApi";
import { createSessionApi } from "../src/session";
import {
  dischargeTime,
  dischargeProblem,
  FINISH_RESULTS,
} from "../src/discharge";
import { normalizeChains, normalizePatients } from "../src/model";
const END = "2026-10-18T17:41:00.000Z",
  AT = Date.parse(END),
  H = 3600000;
function raw() {
  return {
    id: "test-patient",
    name: "Учебный пациент",
    card: {
      id: "test-card",
      status: "ACTIVE",
      treatment: {
        start: "2026-10-18T07:00:00Z",
        sheets: [
          {
            id: "sheet",
            start: "2026-10-18T07:00:00Z",
            end: "2026-10-19T07:00:00Z",
          },
        ],
      },
    },
  };
}
const signal = () => new AbortController().signal;
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("converts Moscow wall clock to UTC, including the date boundary", () => {
  expect(new Date(dischargeTime("2026-10-18", "20:41")!).toISOString()).toBe(
    END,
  );
  expect(new Date(dischargeTime("2026-10-19", "01:15")!).toISOString()).toBe(
    "2026-10-18T22:15:00.000Z",
  );
});
it.each([
  ["2026-02-30", "20:41"],
  ["2026-10-18", "25:00"],
  ["", ""],
  ["2026-10-18", "1:00"],
])("rejects invalid discharge clock %s %s", (day, time) =>
  expect(dischargeTime(day, time)).toBeNull(),
);
it("retains all five original finish results but does not send them by inference", () =>
  expect(FINISH_RESULTS).toEqual([
    "DISCHARGED",
    "DIED",
    "TRANSFERRED_TO_DAY_HOSPITAL",
    "TRANSFERRED_TO_ROUND_THE_CLOCK_HOSPITAL",
    "INTERRUPTED_BY_OWNER",
  ]));
it("uses card.id, exact finish PATCH body, original patient GET, memory JWT and no credentials", async () => {
  const fetcher = vi.fn(
    async (_u: string, o: RequestInit) =>
      new Response(o.method === "GET" ? JSON.stringify(raw()) : "", {
        status: 200,
      }),
  );
  const api = createDischargeApi("MOCK_NOT_JWT", fetcher as typeof fetch);
  await api.patient("test-branch", "test-patient", signal());
  await api.finish("test-card", END, signal());
  expect(fetcher.mock.calls[0][0]).toBe(
    `${API}/branches/test-branch/patients/test-patient`,
  );
  expect(fetcher.mock.calls[0][1].headers).not.toHaveProperty("Content-Type");
  expect(fetcher.mock.calls[1][0]).toBe(
    `${API}/medical-records/test-card/finish`,
  );
  const o = fetcher.mock.calls[1][1];
  expect(o).toMatchObject({
    method: "PATCH",
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer",
  });
  expect(JSON.parse(o.body as string)).toEqual({
    result: "DISCHARGED",
    end: END,
  });
  expect(o.headers).toEqual({
    Authorization: "Bearer MOCK_NOT_JWT",
    Accept: "application/json",
    "Content-Type": "application/json",
  });
  expect(fetcher.mock.calls.some(([u]) => u.includes("MOCK"))).toBe(false);
  api.close();
  await expect(api.finish("test-card", END, signal())).rejects.toMatchObject({
    kind: "Cancelled",
  });
});
it.each([201, 204, 400, 401, 403, 409, 500])(
  "only accepts status 200; handles %s without arbitrary response text",
  async (status) => {
    const unauthorized = vi.fn();
    const f = vi.fn(
      async () =>
        new Response(status === 204 ? null : "sensitive text", { status }),
    );
    const api = createDischargeApi("MOCK", f, unauthorized);
    await expect(api.finish("card", END, signal())).rejects.toMatchObject({
      kind:
        status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "Http",
      status,
    });
    expect(unauthorized).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
  },
);
it("normalizes network failure and rejects invalid paths before any fetch", async () => {
  const f = vi.fn(async () => {
    throw new TypeError("sensitive text");
  });
  const api = createDischargeApi("MOCK", f);
  await expect(api.finish("../other", END, signal())).rejects.toMatchObject({
    kind: "InvalidResponse",
  });
  await expect(api.finish("card", "bad-date", signal())).rejects.toMatchObject({
    kind: "InvalidResponse",
  });
  expect(f).not.toHaveBeenCalled();
  await expect(api.finish("card", END, signal())).rejects.toMatchObject({
    kind: "NetworkOrCors",
  });
});
it("times out and aborts the narrow discharge request", async () => {
  vi.useFakeTimers();
  const f = vi.fn(
    (_u: string | URL | Request, o?: RequestInit) =>
      new Promise<Response>((_resolve, reject) =>
        o?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        ),
      ),
  );
  const api = createDischargeApi("MOCK", f, () => {}, 10);
  const result = expect(
    api.finish("card", END, signal()),
  ).rejects.toMatchObject({ kind: "Timeout" });
  await vi.advanceTimersByTimeAsync(11);
  await result;
});
function chain(periodicity: unknown, results: unknown[] = []) {
  return normalizeChains([
    {
      id: "chain",
      name: "Учебное",
      type: "NURSING",
      elements: [
        {
          id: "revision",
          dates: { start: "2026-10-18T17:21:00Z", periodicity },
          results,
        },
      ],
    },
  ]);
}
it("honors original min/max and unfinished tasks without changing schedule rules", () => {
  const p = normalizePatients([raw()])[0];
  expect(dischargeProblem(p, [], AT)).toBeNull();
  expect(dischargeProblem(p, [], p.admissionStart!)).toContain(
    "минимум на минуту",
  );
  expect(dischargeProblem(p, [], AT + 30 * H)).toContain("последнего листа");
  expect(dischargeProblem(p, chain(1), AT)).toContain("незавершённые задания");
  for (const status of ["EXECUTED", "NOT_EXECUTED"])
    expect(
      dischargeProblem(
        p,
        chain(0, [{ id: "r", hour: "2026-10-18T17:00:00Z", status }]),
        AT,
      ),
    ).toBeNull();
  expect(dischargeProblem(p, chain(null), AT)).toBeNull();
  expect(dischargeProblem(p, chain(undefined), AT)).toBeNull();
  expect(dischargeProblem(p, chain(-1), AT)).toContain("неоднозначные");
  expect(
    dischargeProblem(
      p,
      chain(null, [
        { id: "r", hour: END, creationDate: "2026-10-18T10:00:00Z" },
      ]),
      AT,
    ),
  ).toContain("последней отметки");
});
function server(
  mode: "ok" | "error" | "stale-card" | "stale-list" | "failed-get" = "ok",
) {
  const p = raw(),
    calls: { method: string; path: string; body?: unknown }[] = [];
  let finished = false;
  const f = vi.fn(
    async (url: string | URL | Request, options?: RequestInit) => {
      const method = options?.method ?? "GET",
        path = String(url).replace(API, "");
      calls.push({
        method,
        path,
        body: options?.body ? JSON.parse(options.body as string) : undefined,
      });
      if (method === "PATCH") {
        if (mode === "error") return new Response("", { status: 500 });
        finished = true;
        return new Response("", { status: 200 });
      }
      if (path.endsWith("/prescription-chains")) return Response.json([]);
      if (path.endsWith("/patients"))
        return Response.json(finished && mode !== "stale-list" ? [] : [p]);
      if (path === "/branches/b/patients/test-patient") {
        if (finished && mode === "failed-get")
          throw new TypeError("read failed");
        return Response.json(
          finished && mode !== "stale-card"
            ? {
                ...p,
                card: {
                  ...p.card,
                  status: "ARCHIVED",
                  treatment: { ...p.card.treatment, end: END },
                },
              }
            : p,
        );
      }
      throw Error("Unexpected mocked path");
    },
  );
  return { f, calls, p };
}
it("does not mutate before explicit enable; verifies both card and list after PATCH", async () => {
  const { f, calls } = server();
  const source = createSessionApi("MOCK", f);
  const [p] = await source.patients("b", "d");
  await expect(source.discharge!.finish(p, AT)).rejects.toMatchObject({
    kind: "Disabled",
  });
  expect(calls).toHaveLength(1);
  source.discharge!.setEnabled(true);
  const result = await source.discharge!.finish(p, AT);
  expect(result.patients).toEqual([]);
  expect(result.patient.treatmentEnd).toBe(AT);
  expect(calls.map((c) => c.method)).toEqual([
    "GET",
    "GET",
    "GET",
    "PATCH",
    "GET",
    "GET",
  ]);
  expect(calls[3]).toEqual({
    method: "PATCH",
    path: "/medical-records/test-card/finish",
    body: { result: "DISCHARGED", end: END },
  });
  source.close();
});
it.each(["error", "stale-card", "stale-list", "failed-get"] as const)(
  "never confirms incomplete discharge: %s",
  async (mode) => {
    const { f, calls } = server(mode);
    const source = createSessionApi("MOCK", f);
    const [p] = await source.patients("b", "d");
    source.discharge!.setEnabled(true);
    await expect(source.discharge!.finish(p, AT)).rejects.toMatchObject({
      kind: "Unverified",
    });
    expect(p.cardStatus).toBe("ACTIVE");
    if (mode !== "error")
      expect(calls.slice(-2).every((c) => c.method === "GET")).toBe(true);
    source.close();
  },
);
it("prevents concurrent discharge and closes it with the session", async () => {
  const { f, calls } = server();
  const source = createSessionApi("MOCK", f);
  const [p] = await source.patients("b", "d");
  source.discharge!.setEnabled(true);
  const first = source.discharge!.finish(p, AT);
  await expect(source.discharge!.finish(p, AT)).rejects.toMatchObject({
    kind: "Busy",
  });
  await first;
  expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
  source.close();
  await expect(source.discharge!.finish(p, AT)).rejects.toMatchObject({
    kind: "Disabled",
  });
});
it("rejects changed card identity without sending PATCH", async () => {
  const { f, calls, p: rawPatient } = server();
  const source = createSessionApi("MOCK", f);
  const [p] = await source.patients("b", "d");
  rawPatient.card.id = "changed-card-after-list-was-loaded";
  source.discharge!.setEnabled(true);
  await expect(source.discharge!.finish(p, AT)).rejects.toMatchObject({
    kind: "Conflict",
  });
  expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  source.close();
});
