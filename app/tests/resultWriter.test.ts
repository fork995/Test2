import { it, expect, vi, afterEach } from "vitest";
import { normalizeChains, normalizePatients, type Chain } from "../src/model";
import {
  createResultWriter,
  cellWriteProblem,
  newResultId,
  ResultWriteError,
  RESULT_REASONS,
  writeError,
  type ResultPayload,
  type ResultTarget,
  type ResultTransport,
} from "../src/resultWriter";
import { createResultTransport } from "../src/resultTransport";
import { createSessionApi, createDemoSession } from "../src/session";
import { ApiError } from "../src/api";
import { CATEGORIES } from "../src/model";
import { RESULT_COLORS, type ResultColorChange } from "../src/resultColors";
const at = Date.parse("2026-10-18T08:00:00Z"),
  iso = (n: number) => new Date(n).toISOString(),
  H = 3600000;
afterEach(() => vi.restoreAllMocks());
function fixture(periodicity: unknown = 1, existing = false) {
  vi.spyOn(Date, "now").mockReturnValue(at + 31 * 60000);
  const patient = normalizePatients([
    {
      id: "p",
      name: "Вымышленный пациент",
      card: {
        id: "card",
        status: "ACTIVE",
        treatment: {
          sheets: [
            {
              id: "sheet",
              start: iso(at - 24 * H),
              end: iso(at + 24 * H),
              locked: false,
            },
          ],
        },
      },
    },
  ])[0];
  let chains = normalizeChains([
    {
      id: "chain",
      name: "Учебный препарат",
      type: "MEDICATION",
      elements: [
        {
          id: "revision",
          color: "yellow",
          dates: { start: iso(at), periodicity },
          results: existing
            ? [
                {
                  id: "existing",
                  status: "EXECUTED",
                  comment: "Было",
                  color: "violet",
                  hour: iso(at),
                  creationDate: iso(at + 60000),
                },
              ]
            : [],
        },
      ],
    },
  ]);
  const target: ResultTarget = {
    patient,
    chainId: "chain",
    revision: structuredClone(chains[0].elements[0]),
    at,
    zone: "UTC",
    existing: existing
      ? structuredClone(chains[0].elements[0].results[0])
      : undefined,
  };
  const read = vi.fn(async () => structuredClone(chains));
  const readPatient = vi.fn(async () => structuredClone(patient));
  const put = vi.fn(async (_c: string, _r: string, p: ResultPayload) => {
    const revision = chains[0].elements[0];
    revision.results = revision.results
      .filter((r) => r.id !== p.id)
      .concat({
        id: p.id,
        idConfirmed: true,
        status: p.status,
        reason: p.reason ?? "",
        color: p.color ?? "",
        comment: p.comment,
        hour: p.hour,
        at: Date.parse(p.hour),
        created: p.creationDate,
      });
  });
  const remove = vi.fn(async (_c: string, _r: string, id: string) => {
    chains[0].elements[0].results = chains[0].elements[0].results.filter(
      (r) => r.id !== id,
    );
  });
  const transport: ResultTransport = { put, remove, close: vi.fn() };
  const writer = createResultWriter(transport, read, readPatient);
  return {
    writer,
    target,
    put,
    remove,
    read,
    readPatient,
    transport,
    get chains() {
      return chains;
    },
    set chains(v: Chain[]) {
      chains = v;
    },
  };
}
it("is view-only by default and disabled after close", async () => {
  const f = fixture();
  await expect(
    f.writer.save(f.target, { status: "EXECUTED", comment: "" }),
  ).rejects.toMatchObject({ kind: "Disabled" });
  expect(f.read).not.toHaveBeenCalled();
  f.writer.setEnabled(true);
  f.writer.close();
  await expect(
    f.writer.save(f.target, { status: "EXECUTED", comment: "" }),
  ).rejects.toMatchObject({ kind: "Disabled" });
  expect(f.transport.close).toHaveBeenCalled();
});
for (const comment of [
  "",
  "38,5",
  "ЧСС 120 · Моча 40 мл\nСтул оформленный\nРвота 2 раза 🐈",
  "  Сохранить пробелы  \n\n",
])
  it(`EXECUTED preserves arbitrary text (${comment.length} characters) and exact hour through GET`, async () => {
    const f = fixture();
    f.writer.setEnabled(true);
    const r = await f.writer.save(f.target, {
      status: "EXECUTED",
      comment,
      reason: "DEVICE_ABSENT",
    });
    const payload = f.put.mock.calls[0][2];
    expect(payload).toMatchObject({
      comment,
      status: "EXECUTED",
      hour: iso(at),
      creationDate: iso(Date.now()),
    });
    expect(payload).not.toHaveProperty("reason");
    expect(payload).not.toHaveProperty("color");
    expect(payload.id).toMatch(/^[0-9a-f-]{14}7[0-9a-f-]{21}$/);
    expect(f.read).toHaveBeenCalledTimes(2);
    expect(r.chains[0].elements[0].results[0].comment).toBe(comment);
    expect(r.chains[0].elements[0].color).toBe("yellow");
  });
for (const reason of Object.keys(RESULT_REASONS))
  it(`NOT_EXECUTED sends original enum ${reason}`, async () => {
    const f = fixture();
    f.writer.setEnabled(true);
    await f.writer.save(f.target, {
      status: "NOT_EXECUTED",
      reason,
      comment: "",
    });
    expect(f.put.mock.calls[0][2]).toMatchObject({
      reason,
      status: "NOT_EXECUTED",
    });
  });
for (const reason of [undefined, "", "Нет препарата", "UNKNOWN", "toString"])
  it(`rejects invalid reason ${reason}`, async () => {
    const f = fixture();
    f.writer.setEnabled(true);
    await expect(
      f.writer.save(f.target, { status: "NOT_EXECUTED", reason, comment: "" }),
    ).rejects.toMatchObject({ kind: "ReasonRequired" });
    expect(f.put).not.toHaveBeenCalled();
  });
it("editing preserves ID/hour/creationDate/result color; clearing comment sends empty string", async () => {
  const f = fixture(1, true);
  f.writer.setEnabled(true);
  await f.writer.save(f.target, { status: "EXECUTED", comment: "" });
  expect(f.put.mock.calls[0][2]).toEqual({
    id: "existing",
    hour: iso(at),
    creationDate: iso(at + 60000),
    status: "EXECUTED",
    comment: "",
    color: "violet",
  });
});
it("deletes only the selected result and verifies its absence", async () => {
  const f = fixture(1, true);
  f.writer.setEnabled(true);
  const r = await f.writer.remove(f.target);
  expect(f.remove.mock.calls[0].slice(0, 3)).toEqual([
    "card",
    "revision",
    "existing",
  ]);
  expect(r.chains[0].elements[0].results).toEqual([]);
  expect(f.read).toHaveBeenCalledTimes(2);
});
for (const p of [undefined, null])
  it(`manual event ${p} at selected minute does not generate a slot`, async () => {
    const f = fixture(p);
    f.target.revision.periodicity = p;
    f.chains[0].elements[0].periodicity = p;
    f.target.at = at + 17 * 60000;
    f.writer.setEnabled(true);
    await f.writer.save(f.target, { status: "EXECUTED", comment: "Событие" });
    expect(f.put.mock.calls[0][2].hour).toBe(iso(at + 17 * 60000));
  });
for (const p of [0, 1, 5, 24])
  it(`periodicity ${p} writes exact slot without changing schedule`, async () => {
    const f = fixture(p);
    f.writer.setEnabled(true);
    await f.writer.save(f.target, { status: "EXECUTED", comment: "" });
    expect(f.target.revision.periodicity).toBe(p);
    expect(f.put.mock.calls[0][2].hour).toBe(iso(at));
  });
it("rejects inactive, unscheduled, ended, locked, unknown locks and fabricated IDs", () => {
  const f = fixture();
  for (const modify of [
    (t: ResultTarget) => {
      t.revision.start = null;
    },
    (t: ResultTarget) => {
      t.at += 60000;
    },
    (t: ResultTarget) => {
      t.revision.end = at;
    },
    (t: ResultTarget) => {
      t.patient.sheets[0].locked = true;
    },
    (t: ResultTarget) => {
      t.patient.sheets[0].locked = undefined;
    },
    (t: ResultTarget) => {
      t.revision.idConfirmed = false;
    },
    (t: ResultTarget) => {
      t.patient.cardStatus = "CLOSED";
    },
    (t: ResultTarget) => {
      t.revision.id = "x/../../";
    },
  ]) {
    const t = structuredClone(f.target);
    modify(t);
    expect(cellWriteProblem(t)).not.toBeNull();
  }
});
for (const change of [
  "new result",
  "edited result",
  "schedule",
  "sheet lock",
  "removed revision",
])
  it(`rechecks current state before writing: ${change}`, async () => {
    const f = fixture(1, true);
    f.writer.setEnabled(true);
    if (change === "new result")
      f.chains[0].elements[0].results.push({
        ...f.chains[0].elements[0].results[0],
        id: "colleague",
      });
    if (change === "edited result")
      f.chains[0].elements[0].results[0].comment = "Коллега";
    if (change === "schedule") f.chains[0].elements[0].periodicity = 5;
    if (change === "sheet lock") f.target.patient.sheets[0].locked = true;
    if (change === "removed revision") f.chains[0].elements = [];
    await expect(
      f.writer.save(f.target, { status: "EXECUTED", comment: "Новое" }),
    ).rejects.toBeInstanceOf(ResultWriteError);
    expect(f.put).not.toHaveBeenCalled();
  });
it("uses prescription ID not duplicate names, and does not overwrite an existing slot", async () => {
  const f = fixture();
  f.chains.push({
    ...structuredClone(f.chains[0]),
    id: "other",
    elements: [
      { ...structuredClone(f.chains[0].elements[0]), id: "other-revision" },
    ],
  });
  f.chains[0].elements[0].results.push({
    id: "colleague",
    idConfirmed: true,
    status: "EXECUTED",
    comment: "",
    reason: "",
    color: "",
    at,
    hour: iso(at),
    created: iso(at),
  });
  f.writer.setEnabled(true);
  await expect(
    f.writer.save(f.target, { status: "EXECUTED", comment: "" }),
  ).rejects.toMatchObject({ kind: "Conflict" });
  expect(f.put).not.toHaveBeenCalled();
});
it("double tap sends one mutation", async () => {
  const f = fixture();
  f.writer.setEnabled(true);
  const first = f.writer.save(f.target, { status: "EXECUTED", comment: "" });
  await expect(
    f.writer.save(f.target, { status: "EXECUTED", comment: "" }),
  ).rejects.toMatchObject({ kind: "Busy" });
  await first;
  expect(f.put).toHaveBeenCalledTimes(1);
});
it("turning write mode off aborts a pending operation before any PUT", async () => {
  const f = fixture();
  f.writer.setEnabled(true);
  f.readPatient.mockImplementation(async () => {
    f.writer.setEnabled(false);
    return f.target.patient;
  });
  await expect(
    f.writer.save(f.target, { status: "EXECUTED", comment: "" }),
  ).rejects.toMatchObject({ kind: "Disabled" });
  expect(f.put).not.toHaveBeenCalled();
});
for (const fail of [
  "comment mismatch",
  "GET failed",
  "network during PUT",
  "DELETE not removed",
])
  it(`does not report success or retry when ${fail}`, async () => {
    const f = fixture(1, fail === "DELETE not removed");
    f.writer.setEnabled(true);
    if (fail === "comment mismatch") f.put.mockImplementation(async () => {});
    if (fail === "GET failed")
      f.read
        .mockImplementationOnce(async () => structuredClone(f.chains))
        .mockRejectedValueOnce(new ApiError("NetworkOrCors"));
    if (fail === "network during PUT")
      f.put.mockRejectedValueOnce(new ApiError("NetworkOrCors"));
    if (fail === "DELETE not removed")
      f.remove.mockImplementation(async () => {});
    await expect(
      fail === "DELETE not removed"
        ? f.writer.remove(f.target)
        : f.writer.save(f.target, { status: "EXECUTED", comment: "Текст" }),
    ).rejects.toMatchObject({ kind: "Unverified" });
    expect(f.put.mock.calls.length + f.remove.mock.calls.length).toBe(1);
  });
for (const status of [401, 403, 409, 412, 500])
  it(`HTTP ${status} is sanitized`, async () => {
    const f = fixture();
    f.writer.setEnabled(true);
    f.put.mockRejectedValue(
      new ApiError(
        status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "Http",
        status,
      ),
    );
    await expect(
      f.writer.save(f.target, { status: "EXECUTED", comment: "" }),
    ).rejects.toMatchObject(
      status === 401 || status === 403
        ? { status }
        : { kind: status === 500 ? "Unverified" : "Conflict" },
    );
  });
it("UUID is RFC 9562 v7 with correct timestamp and unique secure randomness", () => {
  const ids = new Set(Array.from({ length: 100 }, () => newResultId(at)));
  expect(ids.size).toBe(100);
  for (const id of ids) {
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(parseInt(id.replaceAll("-", "").slice(0, 12), 16)).toBe(at);
  }
});
it("errors never expose arbitrary messages", () =>
  expect(writeError(new Error("secret"))).not.toContain("secret"));
const payload: ResultPayload = {
  id: "id",
  status: "EXECUTED",
  comment: "38,5\nУчебное 🐈",
  hour: iso(at),
  creationDate: iso(at + 1000),
};
for (const method of ["PUT", "DELETE"])
  it(`transport uses only fixed ${method} execution endpoint and protected headers`, async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    const transport = createResultTransport(
      "MOCK_NOT_JWT",
      fetcher as typeof fetch,
    );
    const signal = new AbortController().signal;
    if (method === "PUT")
      await transport.put("card", "revision", payload, signal);
    else await transport.remove("card", "revision", "id", signal);
    const [url, options] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://backend.clevervet.tech/api/medical-records/card/prescriptions/revision/execution-results/id",
    );
    expect(options).toMatchObject({
      method,
      mode: "cors",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      cache: "no-store",
    });
    expect(url).not.toContain("MOCK");
    if (method === "PUT")
      expect(JSON.parse(options.body as string)).toEqual(payload);
    else expect(options).not.toHaveProperty("body");
    transport.close();
  });
for (const status of [401, 403, 409, 412, 400, 500])
  it(`transport rejects HTTP ${status} without reading error body`, async () => {
    const json = vi.fn();
    const onExpire = vi.fn();
    const fetcher = vi.fn(
      async () => ({ status, json }) as unknown as Response,
    );
    const t = createResultTransport("MOCK", fetcher as typeof fetch, onExpire);
    await expect(
      t.put("card", "revision", payload, new AbortController().signal),
    ).rejects.toMatchObject({ status });
    expect(json).not.toHaveBeenCalled();
    expect(onExpire).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
    t.close();
  });
it("transport sanitizes TypeError and rejects paths before networking", async () => {
  const fetcher = vi.fn(async () => {
    throw new TypeError("SECRET");
  });
  const t = createResultTransport("MOCK", fetcher as typeof fetch);
  await expect(
    t.put("../", "revision", payload, new AbortController().signal),
  ).rejects.toMatchObject({ kind: "Unavailable" });
  expect(fetcher).not.toHaveBeenCalled();
  await expect(
    t.put("card", "revision", payload, new AbortController().signal),
  ).rejects.toMatchObject({ kind: "NetworkOrCors" });
  t.close();
});
it("composed real session remains read-only until explicitly enabled", async () => {
  const f = vi.fn(async () => new Response("[]", { status: 200 }));
  const s = createSessionApi("MOCK", f as typeof fetch);
  expect(s.results?.isEnabled()).toBe(false);
  await s.branches();
  expect(f).toHaveBeenCalledTimes(1);
  expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe(
    "GET",
  );
  s.close();
  expect(s.results?.isEnabled()).toBe(false);
});
it("demo can save and verify locally without network, isolating patient cards", async () => {
  vi.spyOn(Date, "now").mockReturnValue(at + 31 * 60000);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw Error("No live requests");
    }),
  );
  const s = createDemoSession();
  const branches = await s.branches();
  const patients = await s.patients(
    branches[0].id,
    branches[0].departments[0].id,
  );
  const chains = await s.chains(patients[0].cardId);
  const r = chains[0].elements.find((r) => r.id.startsWith("new-"))!;
  const target = {
    patient: patients[0],
    chainId: chains[0].id,
    revision: r,
    at,
    zone: "UTC",
  };
  s.results!.setEnabled(true);
  const receipt = await s.results!.save(target, {
    status: "EXECUTED",
    comment: "Демо",
  });
  expect(
    receipt.chains[0].elements
      .find((e) => e.id === r.id)!
      .results.some((x) => x.comment === "Демо"),
  ).toBe(true);
  const other = await s.chains(patients[1].cardId);
  expect(
    other
      .flatMap((c) => c.elements.flatMap((r) => r.results))
      .some((x) => x.comment === "Демо"),
  ).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
  s.close();
  vi.unstubAllGlobals();
});
it("freshly locked sheet prevents mutation even when the opened cell was writable", async () => {
  const f = fixture();
  f.writer.setEnabled(true);
  const patient = structuredClone(f.target.patient);
  patient.sheets[0].locked = true;
  f.readPatient.mockResolvedValue(patient);
  await expect(
    f.writer.save(f.target, { status: "EXECUTED", comment: "" }),
  ).rejects.toMatchObject({ kind: "Unavailable" });
  expect(f.put).not.toHaveBeenCalled();
});
it("a failed verification after successful PUT is uncertain even if GET returns 403", async () => {
  const f = fixture();
  f.writer.setEnabled(true);
  f.read
    .mockResolvedValueOnce(structuredClone(f.chains))
    .mockRejectedValueOnce(new ApiError("Forbidden", 403));
  await expect(
    f.writer.save(f.target, { status: "EXECUTED", comment: "" }),
  ).rejects.toMatchObject({ kind: "Unverified", apiError: { status: 403 } });
  expect(f.put).toHaveBeenCalledTimes(1);
});
it("a colleague's result arriving during PUT fails verification", async () => {
  const f = fixture();
  f.writer.setEnabled(true);
  const original = f.put.getMockImplementation()!;
  f.put.mockImplementation(async (c, r, p) => {
    await original(c, r, p);
    f.chains[0].elements[0].results.push({
      ...f.chains[0].elements[0].results[0],
      id: "colleague-after",
    });
  });
  await expect(
    f.writer.save(f.target, { status: "EXECUTED", comment: "" }),
  ).rejects.toMatchObject({ kind: "Unverified" });
});
it("transport times out and aborts without retrying", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(
    (_url: string, options: RequestInit) =>
      new Promise<Response>((_resolve, reject) =>
        options.signal!.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        ),
      ),
  );
  const transport = createResultTransport(
    "MOCK",
    fetcher as typeof fetch,
    () => {},
    50,
  );
  const result = transport
    .put("card", "revision", payload, new AbortController().signal)
    .catch((e) => e);
  await vi.advanceTimersByTimeAsync(51);
  expect(await result).toMatchObject({ kind: "Timeout" });
  expect(fetcher).toHaveBeenCalledTimes(1);
  transport.close();
  vi.useRealTimers();
});
it("unknown result ID provenance and invalid end dates cannot be written", () => {
  const f = fixture(1, true);
  f.target.existing!.idConfirmed = false;
  expect(cellWriteProblem(f.target)).not.toBeNull();
  const t = fixture().target;
  t.revision.rawEnd = "invalid";
  t.revision.end = null;
  expect(cellWriteProblem(t)).not.toBeNull();
});

// Color mutations are identical for every API prescription category.
for (const category of CATEGORIES)
  for (const status of ["EXECUTED", "NOT_EXECUTED"] as const)
    for (const action of ["keep", "set", "clear"] as const)
      it(`${category} ${status} ${action}: round-trip result color without touching revision color`, async () => {
        const f = fixture(1, true);
        f.chains[0].type = category;
        f.writer.setEnabled(true);
        const source = { ...f.chains[0].elements[0], results: [] };
        const colorChange: ResultColorChange | undefined =
          action === "set"
            ? { kind: "set", value: "lightblue" }
            : action === "clear"
              ? { kind: "clear" }
              : undefined;
        const receipt = await f.writer.save(f.target, {
          status,
          reason: status === "NOT_EXECUTED" ? "DEVICE_ABSENT" : undefined,
          comment: status === "EXECUTED" ? "38,5\nУчебный текст 🐈" : "",
          ...(colorChange ? { colorChange } : {}),
        });
        const payload = f.put.mock.calls[0][2];
        if (action === "clear") expect(payload).not.toHaveProperty("color");
        else
          expect(payload.color).toBe(action === "set" ? "lightblue" : "violet");
        expect(JSON.stringify(payload)).not.toContain("colorChange");
        expect({ ...receipt.chains[0].elements[0], results: [] }).toEqual(
          source,
        );
        expect(receipt.chains[0].elements[0].results[0].color).toBe(
          action === "clear" ? "" : action === "set" ? "lightblue" : "violet",
        );
        expect(f.read).toHaveBeenCalledTimes(2);
      });
for (const color of RESULT_COLORS)
  it(`only confirmed API palette value ${color.value} is serialized`, async () => {
    const f = fixture();
    f.writer.setEnabled(true);
    await f.writer.save(f.target, {
      status: "EXECUTED",
      comment: "",
      colorChange: { kind: "set", value: color.value },
    });
    expect(JSON.parse(JSON.stringify(f.put.mock.calls[0][2])).color).toBe(
      color.value,
    );
    expect(f.chains[0].elements[0].color).toBe("yellow");
  });
for (const change of [
  null,
  "violet",
  { kind: "set", value: "red" },
  { kind: "set", value: "#fff" },
  { kind: "set", value: "" },
  { kind: "set", value: "YELLOW" },
  { kind: "clear", value: "" },
  { kind: "unknown" },
])
  it(`rejects unconfirmed color change ${JSON.stringify(change)} before any API work`, async () => {
    const f = fixture();
    f.writer.setEnabled(true);
    await expect(
      f.writer.save(f.target, {
        status: "EXECUTED",
        comment: "",
        colorChange: change as never,
      }),
    ).rejects.toMatchObject({ kind: "InvalidColor" });
    expect(f.read).not.toHaveBeenCalled();
    expect(f.put).not.toHaveBeenCalled();
  });
it("an untouched legacy result color is preserved even when it is outside the new palette", async () => {
  const f = fixture(1, true);
  for (const r of [
    f.chains[0].elements[0].results[0],
    f.target.revision.results[0],
    f.target.existing!,
  ])
    r.color = "#5b8c99";
  f.writer.setEnabled(true);
  await f.writer.save(f.target, {
    status: "EXECUTED",
    comment: "Изменился только текст",
  });
  expect(f.put.mock.calls[0][2].color).toBe("#5b8c99");
});
it("clear uses original omitted-color PUT, and retained server color fails verification", async () => {
  const f = fixture(1, true);
  const original = f.put.getMockImplementation()!;
  f.put.mockImplementation(async (c, r, p) => {
    await original(c, r, p);
    f.chains[0].elements[0].results[0].color = "violet";
  });
  f.writer.setEnabled(true);
  await expect(
    f.writer.save(f.target, {
      status: "EXECUTED",
      comment: "",
      colorChange: { kind: "clear" },
    }),
  ).rejects.toMatchObject({ kind: "Unverified" });
  expect(f.put.mock.calls[0][2]).not.toHaveProperty("color");
  expect(f.target.revision.color).toBe("yellow");
});
