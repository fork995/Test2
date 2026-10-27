import { afterEach, expect, it, vi } from "vitest";
import { createArchiveApi, archiveError } from "../src/archiveApi";
import {
  ObjectArrayParser,
  readObjectArray,
  readSingleObject,
  ARCHIVE_LIMITS,
} from "../src/archiveStream";
import {
  normalizeArchiveRecord,
  archivePredicate,
  emptyArchiveQuery,
  ARCHIVE_PAGE_SIZE,
} from "../src/archiveModel";
import { createSessionApi } from "../src/session";
import { API } from "../src/api";
const raw = (n = 0) => ({
  id: `card-${n}`,
  number: `УЧ-${n}`,
  hospital: "ROUND_THE_CLOCK",
  diagnoses: ["Учебный диагноз"],
  patient: {
    id: `patient-${n}`,
    name: `Учебный ${n}`,
    owner: { surname: "Вымышленный", name: "Владелец" },
  },
  treatment: {
    start: {
      date: "2026-10-18T05:00:00Z",
      branch: { department: { id: "d", name: "Учебный стационар" } },
    },
    finish: {
      date: "2026-10-19T05:00:00Z",
      result: "DISCHARGED",
      branch: { department: { id: "d", name: "Учебный стационар" } },
    },
  },
});
const rawCard = () => ({
  id: "patient-0",
  name: "Учебный 0",
  species: "Кошка",
  card: {
    id: "card-0",
    status: "ARCHIVED",
    treatment: {
      start: "2026-10-18T05:00:00Z",
      end: "2026-10-19T05:00:00Z",
      sheets: [],
    },
  },
});
const signal = () => new AbortController().signal,
  query = emptyArchiveQuery,
  zone = "Europe/Moscow";
/** Network mock generates a small batch at a time, never a full archive fixture. */
function stream(count: number) {
  let at = 0;
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(c) {
        if (!at) c.enqueue(enc.encode("["));
        let chunk = "";
        for (let i = 0; i < 64 && at < count; i++, at++)
          chunk += (at ? "," : "") + JSON.stringify(raw(at));
        if (chunk) c.enqueue(enc.encode(chunk));
        if (at >= count) {
          c.enqueue(enc.encode("]"));
          c.close();
        }
      },
    }),
  );
}
afterEach(() => vi.restoreAllMocks());
it("normalizes actual fields and does not invent absent species/photo/dates", () => {
  expect(normalizeArchiveRecord(raw())).toMatchObject({
    id: "card-0",
    patientId: "patient-0",
    owner: "Вымышленный Владелец",
    departmentId: "d",
  });
  const r = normalizeArchiveRecord({ id: "card", patient: { id: "patient" } });
  expect(r).toMatchObject({ name: "", owner: "", start: null, end: null });
  expect(r).not.toHaveProperty("species");
  expect(r).not.toHaveProperty("photo");
  expect(() => normalizeArchiveRecord({ id: "card" })).toThrow();
});
it.each(["Учебный 0", "вымышленный", "уч-0"])(
  "searches name, owner or card number: %s",
  (search) =>
    expect(
      archivePredicate(
        { ...query(), search },
        zone,
      )(normalizeArchiveRecord(raw())),
    ).toBe(true),
);
it("filters dates, result, hospital and finishing department", () => {
  const r = normalizeArchiveRecord(raw());
  for (const changes of [
    { result: "DIED" },
    { hospital: "DAY" },
    { department: "неизвестное" },
    { from: "2026-10-20" },
  ])
    expect(archivePredicate({ ...query(), ...changes }, zone)(r)).toBe(false);
  expect(
    archivePredicate(
      {
        ...query(),
        dateField: "start",
        from: "2026-10-18",
        to: "2026-10-18",
        department: "стационар",
      },
      zone,
    )(r),
  ).toBe(true);
});
it("includes local end date, crosses midnight without UTC/local confusion", () => {
  const a = raw();
  a.treatment.finish.date = "2026-10-18T21:00:00Z";
  const r = normalizeArchiveRecord(a);
  expect(
    archivePredicate(
      { ...query(), from: "2026-10-19", to: "2026-10-19" },
      zone,
    )(r),
  ).toBe(true);
  expect(archivePredicate({ ...query(), to: "2026-10-18" }, zone)(r)).toBe(
    false,
  );
});
it.each([
  { from: "2026-02-31" },
  { from: "2026-10-20", to: "2026-10-18" },
  { search: "x".repeat(257) },
])("rejects malformed query %j", (q) =>
  expect(() => archivePredicate({ ...query(), ...q }, zone)).toThrow(),
);
it.each([1, 2, 7, 16384])(
  "parser handles split escapes, nested arrays, braces inside text and Unicode: %s",
  (size) => {
    const rows = [
        { text: 'Кириллица 😀 ] } " \\ \n', nested: [{ n: 1 }, []] },
        { id: "second" },
      ],
      s = JSON.stringify(rows),
      found: unknown[] = [];
    const p = new ObjectArrayParser((v) => found.push(v));
    for (let i = 0; i < s.length; i += size) p.write(s.slice(i, i + size));
    p.finish();
    expect(found).toEqual(rows);
  },
);
it.each([
  "",
  "{}",
  "[null]",
  "[1]",
  "[{},]",
  "[{}][{}]",
  "[{}] garbage",
  '[{"a":1]',
  '[{"a":1}',
  "[{}",
  "[{},,{}]",
  '["x"]',
])("rejects invalid/truncated/enveloped array %s", (s) => {
  const p = new ObjectArrayParser(() => {});
  expect(() => {
    p.write(s);
    p.finish();
  }).toThrow();
});
it("accepts empty array and bounds object size and nesting", () => {
  const p = new ObjectArrayParser(() => {});
  p.write(" \n [ \r\t ] ");
  p.finish();
  expect(() =>
    new ObjectArrayParser(() => {}, 20).write('[{"name":"' + "x".repeat(21)),
  ).toThrow();
  expect(() =>
    new ObjectArrayParser(() => {}).write('[{"a":' + "[".repeat(49)),
  ).toThrow();
});
it("handles UTF-8 split across single byte network chunks", async () => {
  const bytes = new TextEncoder().encode('[{"name":"Кириллица 😀"}]');
  let at = 0;
  const r = new Response(
      new ReadableStream({
        pull(c) {
          if (at === bytes.length) c.close();
          else c.enqueue(bytes.subarray(at, ++at));
        },
      }),
    ),
    rows: unknown[] = [];
  await readObjectArray(r, signal(), (v) => rows.push(v));
  expect(rows).toEqual([{ name: "Кириллица 😀" }]);
});
it("no streaming fails closed; json/text fallback is forbidden", async () => {
  const r = { body: null, json: vi.fn(), text: vi.fn() } as unknown as Response;
  await expect(readObjectArray(r, signal(), () => {})).rejects.toMatchObject({
    kind: "StreamingUnavailable",
  });
  await expect(readSingleObject(r, signal())).rejects.toMatchObject({
    kind: "StreamingUnavailable",
  });
  expect(r.json).not.toHaveBeenCalled();
  expect(r.text).not.toHaveBeenCalled();
});
it("enforces byte/record caps, cancels reader and bounds single patient JSON", async () => {
  const cancel = vi.fn(),
    r = new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(33));
        },
        cancel,
      }),
    );
  await expect(
    readObjectArray(r, signal(), () => {}, {
      maxBytes: 32,
      maxObjectChars: 128,
      maxRecords: 10,
    }),
  ).rejects.toMatchObject({ kind: "Limit" });
  expect(cancel).toHaveBeenCalledOnce();
  await expect(
    readObjectArray(new Response("[{},{}]"), signal(), () => {}, {
      maxBytes: 100,
      maxObjectChars: 128,
      maxRecords: 1,
    }),
  ).rejects.toMatchObject({ kind: "Limit" });
  await expect(
    readSingleObject(
      new Response('{"a":"' + "x".repeat(40) + '"}'),
      signal(),
      32,
    ),
  ).rejects.toMatchObject({ kind: "Limit" });
  expect(await readSingleObject(new Response('{"a":1}'), signal())).toEqual({
    a: 1,
  });
});
it("distinguishes malformed UTF-8 from network stream error", async () => {
  await expect(
    readObjectArray(
      new Response(new Uint8Array([91, 123, 0xff])),
      signal(),
      () => {},
    ),
  ).rejects.toMatchObject({ kind: "Format" });
  const a = createArchiveApi(
    "MOCK",
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.error(new TypeError("PRIVATE"));
          },
        }),
      ),
  );
  await expect(a.page("b", query(), 0, zone, signal())).rejects.toMatchObject({
    kind: "NetworkOrCors",
  });
  a.close();
});
it("large archive retains 30 rows; URL never invents pagination/search parameters", async () => {
  const f = vi.fn(async (_u: string | URL | Request, _o?: RequestInit) =>
      stream(15000),
    ),
    a = createArchiveApi("MOCK", f);
  const p = await a.page("b", query(), 99, zone, signal());
  expect(p.rows).toHaveLength(30);
  expect(p.rows[0].id).toBe("card-2970");
  expect(p.rows.at(-1)!.id).toBe("card-2999");
  expect(p).toMatchObject({ scanned: 15000, matched: 15000, complete: true });
  expect(String(f.mock.calls[0][0])).toBe(
    `${API}/branches/b/archive/medical-records`,
  );
  expect(f.mock.calls[0][1]).toMatchObject({
    method: "GET",
    credentials: "omit",
    cache: "no-store",
    mode: "cors",
    redirect: "error",
  });
  expect(f.mock.calls[0][1]!.headers).not.toHaveProperty("Content-Type");
  a.close();
}, 20000);
it("streaming search counts matches without retaining other rows", async () => {
  const a = createArchiveApi("MOCK", async () => stream(45));
  expect(
    await a.page("b", { ...query(), search: "Учебный 4" }, 0, zone, signal()),
  ).toMatchObject({ matched: 6, scanned: 45 });
  a.close();
});
it("empty archive succeeds; truncated archive never returns partial success", async () => {
  const a = createArchiveApi("MOCK", async () => new Response("[]"));
  expect(await a.page("b", query(), 0, zone, signal())).toMatchObject({
    rows: [],
    matched: 0,
    scanned: 0,
    complete: true,
  });
  a.close();
  const b = createArchiveApi(
    "MOCK",
    async () => new Response("[" + JSON.stringify(raw()) + ","),
  );
  await expect(b.page("b", query(), 0, zone, signal())).rejects.toMatchObject({
    kind: "Format",
  });
  b.close();
});
it("uses both original patient routes and exact record identity", async () => {
  const f = vi.fn(async (_u: string | URL | Request) =>
      Response.json(rawCard()),
    ),
    a = createArchiveApi("MOCK", f),
    row = normalizeArchiveRecord(raw());
  expect((await a.patient("b", row, signal())).cardId).toBe("card-0");
  await a.patient("b", { ...row, departmentId: "" }, signal());
  expect(f.mock.calls.map((c) => String(c[0]).replace(API, ""))).toEqual([
    "/branches/b/departments/d/patients/patient-0",
    "/branches/b/patients/patient-0",
  ]);
  a.close();
});
it("never substitutes later admission of same patient", async () => {
  const p = rawCard();
  p.card.id = "later-card";
  const a = createArchiveApi("MOCK", async () => Response.json(p));
  await expect(
    a.patient("b", normalizeArchiveRecord(raw()), signal()),
  ).rejects.toMatchObject({ kind: "DifferentCard" });
  a.close();
});
it("uses card ID for chains and patient ID for belongings; hour is not creationDate", async () => {
  const f = vi.fn(async (u: string | URL | Request) =>
    String(u).endsWith("prescription-chains")
      ? Response.json([
          {
            id: "chain",
            name: "Учебный контроль",
            type: "MONITORING",
            elements: [
              {
                id: "revision",
                dates: { start: "2026-10-18T05:00:00Z" },
                results: [
                  {
                    id: "result",
                    hour: "2026-10-18T06:00:00Z",
                    creationDate: "2026-10-18T07:15:00Z",
                    status: "EXECUTED",
                    comment: "Учебная отметка",
                  },
                ],
              },
            ],
          },
        ])
      : Response.json([]),
  );
  const a = createArchiveApi("MOCK", f),
    [c] = await a.chains("card-0", signal());
  expect(c.elements[0].results[0].at).toBe(Date.parse("2026-10-18T06:00:00Z"));
  await a.belongings("patient-0", signal());
  expect(f.mock.calls.map((c) => String(c[0]).replace(API, ""))).toEqual([
    "/medical-records/card-0/prescription-chains",
    "/patients/patient-0/personal-belongings",
  ]);
  a.close();
});
it.each([401, 403, 404, 500])(
  "handles HTTP %s without response leakage",
  async (status) => {
    const expired = vi.fn(),
      a = createArchiveApi(
        "MOCK",
        async () => new Response("PRIVATE", { status }),
        expired,
      );
    await expect(a.page("b", query(), 0, zone, signal())).rejects.toMatchObject(
      {
        kind:
          status === 401
            ? "Unauthorized"
            : status === 403
              ? "Forbidden"
              : "Http",
        status,
      },
    );
    expect(expired).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
    a.close();
  },
);
it("slow connection supports timeout and explicit cancellation", async () => {
  const f = async () =>
    new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode("["));
        },
      }),
    );
  const a = createArchiveApi("MOCK", f, () => {}, 20);
  await expect(a.page("b", query(), 0, zone, signal())).rejects.toMatchObject({
    kind: "Timeout",
  });
  a.close();
  const b = createArchiveApi("MOCK", f),
    c = new AbortController(),
    p = b.page("b", query(), 0, zone, c.signal);
  setTimeout(() => c.abort(), 10);
  await expect(p).rejects.toMatchObject({ kind: "Cancelled" });
  b.close();
});
it("session close aborts archive and revokes its in-memory transport", async () => {
  const f = vi.fn(
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode("["));
          },
        }),
      ),
  );
  const source = createSessionApi("MOCK", f),
    p = source.archive!.page("b", query(), 0, zone, signal());
  source.close();
  await expect(p).rejects.toMatchObject({ kind: "Cancelled" });
  await expect(
    source.archive!.page("b", query(), 0, zone, signal()),
  ).rejects.toMatchObject({ kind: "Cancelled" });
  expect(f).toHaveBeenCalledTimes(1);
});
it("validates routes and index without requests and hides arbitrary errors", async () => {
  const f = vi.fn(),
    a = createArchiveApi("MOCK", f);
  await expect(
    a.page("../x", query(), 0, zone, signal()),
  ).rejects.toBeDefined();
  await expect(a.page("b", query(), -1, zone, signal())).rejects.toBeDefined();
  expect(f).not.toHaveBeenCalled();
  expect(ARCHIVE_LIMITS.maxBytes).toBe(33554432);
  expect(ARCHIVE_PAGE_SIZE).toBe(30);
  expect(archiveError(new Error("PRIVATE"))).not.toContain("PRIVATE");
  a.close();
});
