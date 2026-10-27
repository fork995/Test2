import { API } from "../src/api";
export const P_HOUR = 3600000,
  P_NOW = Date.parse("2026-10-19T12:31:00Z"),
  pIso = (n: number) => new Date(n).toISOString();
export const pSpecifics = () => ({
  concentration: {
    value: 10,
    units: { substance: "MILLIGRAM", volume: "MILLILITRE" },
  },
  dosage: { value: 1, units: { substance: "MILLIGRAM", volume: "KILOGRAM" } },
  route: "INTRAVENOUS",
  weightKg: 4,
  viewMode: "DOSAGE",
  supplementarySolvent: null,
});
export function prescriptionServer(history = false) {
  const rawPatient = {
    id: "patient",
    name: "ДЕМО · Учебный пациент",
    weightKg: 4,
    species: "Кошка",
    card: {
      id: "record",
      status: "ACTIVE",
      treatment: {
        start: "2026-10-19T05:00:00Z",
        sheets: [
          {
            id: "sheet",
            start: "2026-10-19T05:00:00Z",
            end: "2026-10-20T05:00:00Z",
            locked: false,
          },
        ],
      },
    },
  };
  const rawResult = {
    id: "old-result",
    status: "EXECUTED",
    hour: "2026-10-19T07:00:00.000Z",
    creationDate: "2026-10-19T07:31:00.000Z",
    comment: "Демо ✓",
    color: "violet",
  };
  const rawChain = {
    id: "chain",
    name: "Учебное назначение",
    type: "MEDICATION",
    elements: [
      {
        id: "revision",
        color: "yellow",
        instruction: "Учебная инструкция",
        dates: { start: "2026-10-19T06:00:00.000Z", periodicity: 8 },
        specifics: pSpecifics(),
        results: history ? [rawResult] : [],
        creationDate: "2026-10-19T05:00:00.000Z",
      },
    ],
  };
  let data: any[] = [
    structuredClone(rawChain),
    {
      ...structuredClone(rawChain),
      id: "other-chain",
      elements: [
        {
          ...structuredClone(rawChain.elements[0]),
          id: "other-revision",
          results: [{ ...rawResult, id: "other-result" }],
        },
      ],
    },
  ];
  const calls: { method: string; path: string; body: any }[] = [];
  const failure = new Map<string, number>();
  let normalizeTimes = false;
  const normalizeTimeStrings = (v: unknown): unknown =>
    typeof v === "string"
      ? v.replace(/\.000Z$/, "Z")
      : Array.isArray(v)
        ? v.map(normalizeTimeStrings)
        : v && typeof v === "object"
          ? Object.fromEntries(
              Object.entries(v).map(([k, x]) => [k, normalizeTimeStrings(x)]),
            )
          : v;
  let stale = false,
    readFail = false,
    delay: Promise<void> | undefined;
  const fetcher: typeof fetch = async (input, options) => {
    const path = String(input).replace(API, ""),
      method = options?.method ?? "GET",
      body = options?.body ? JSON.parse(String(options.body)) : undefined;
    calls.push({ method, path, body });
    if (method === "GET") {
      if (path === "/branches")
        return Response.json([
          {
            id: "b",
            name: "ИВЦ Запад",
            workShiftStart: "08:00",
            departments: [{ id: "d", name: "Хирургический стационар" }],
          },
        ]);
      if (path === "/branches/b/departments/d/patients")
        return Response.json([rawPatient]);
      if (path === "/patients/patient/personal-belongings")
        return Response.json([]);
      if (path === "/medical-records/record/prescription-chains") {
        if (readFail && calls.some((c) => c.method !== "GET"))
          throw new TypeError("PRIVATE");
        return Response.json(
          normalizeTimes
            ? normalizeTimeStrings(data)
            : stale && calls.some((c) => c.method !== "GET")
              ? [rawChain]
              : data,
        );
      }
      throw Error("Unknown mocked read");
    }
    if (delay) await delay;
    const key =
      method === "PATCH"
        ? "PATCH"
        : method === "POST" && path.endsWith("/prescription-chains")
          ? "create"
          : method === "POST"
            ? "revision"
            : method;
    const error = failure.get(key);
    if (error) {
      if (error === 999) throw new TypeError("PRIVATE");
      return new Response(null, { status: error });
    }
    const parts = path.split("/");
    if (method === "POST" && parts.length === 4) {
      data.push({ ...body, elements: [body.prescription] });
      delete data.at(-1).prescription;
    } else if (method === "POST" && parts.length === 5)
      data.find((c) => c.id === parts[4]).elements.push(body);
    else if (method === "PATCH" && parts[6] === "finish")
      data
        .find((c) => c.id === parts[4])
        .elements.find((r: any) => r.id === parts[5]).endDate = body.end;
    else if (method === "DELETE" && parts.length === 6) {
      const c = data.find((c) => c.id === parts[4]);
      c.elements = c.elements.filter((r: any) => r.id !== parts[5]);
    } else if (method === "DELETE" && parts.length === 5)
      data = data.filter((c) => c.id !== parts[4]);
    else throw Error("Unknown mocked mutation");
    return new Response(null, { status: 200 });
  };
  return {
    fetcher,
    calls,
    failure,
    rawPatient,
    get data() {
      return data;
    },
    set data(v: any[]) {
      data = v;
    },
    set normalizeTimes(v: boolean) {
      normalizeTimes = v;
    },
    set stale(v: boolean) {
      stale = v;
    },
    set readFail(v: boolean) {
      readFail = v;
    },
    set delay(v: Promise<void>) {
      delay = v;
    },
  };
}
