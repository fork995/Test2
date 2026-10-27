import { it, expect, vi, afterEach } from "vitest";
import { createApi, ApiError, safeError } from "../src/api";
import { createMock } from "../src/source";
const fakeToken = "MOCK_VALUE_NOT_A_JWT";
const response = (status = 200, body: unknown = []) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const fetcher = (
  fn: (url: string, options: RequestInit) => Promise<Response>,
) => vi.fn(fn) as unknown as typeof fetch;
afterEach(() => {
  vi.unstubAllGlobals();
});
it("authorized GET /branches with fixed headers, no Content-Type/cookies/redirect", async () => {
  const f = fetcher(async (url, options) => {
    expect(url).toBe("https://backend.clevervet.tech/api/branches");
    expect(options).toMatchObject({
      method: "GET",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    expect(options.headers).toEqual({
      Authorization: `Bearer ${fakeToken}`,
      Accept: "application/json",
    });
    return response(200, [{ id: "b", name: "Demo" }]);
  });
  const api = createApi(fakeToken, f);
  expect((await api.branches())[0].id).toBe("b");
  api.close();
});
for (const [status, kind] of [
  [401, "Unauthorized"],
  [403, "Forbidden"],
  [500, "Http"],
] as const)
  it(`HTTP ${status} handled without reading error body`, async () => {
    const json = vi.fn(() => {
      throw Error("Never read");
    });
    const f = fetcher(async () => ({ status, json }) as unknown as Response);
    const api = createApi(fakeToken, f);
    await expect(api.branches()).rejects.toMatchObject({ kind, status });
    expect(json).not.toHaveBeenCalled();
    api.close();
  });
it("expired token 401 closes source and clears cache", async () => {
  let n = 0;
  const f = fetcher(async () =>
    ++n === 1
      ? response(200, [{ id: "c", type: "MONITORING", elements: [] }])
      : response(401),
  );
  const api = createApi(fakeToken, f);
  await api.chains("card");
  await expect(api.branches()).rejects.toMatchObject({ kind: "Unauthorized" });
  await expect(api.chains("card")).rejects.toMatchObject({
    kind: "Unauthorized",
  });
  expect(n).toBe(2);
});
it("network/CORS TypeError is ambiguous and raw messages stay hidden", async () => {
  const api = createApi(
    fakeToken,
    fetcher(async () => {
      throw new TypeError(`${fakeToken} private patient url`);
    }),
  );
  try {
    await api.branches();
    throw Error("Expected failure");
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect(safeError(error)).toContain("CORS, сеть, TLS");
    expect(safeError(error)).not.toContain(fakeToken);
    expect(JSON.stringify(error)).not.toContain(fakeToken);
  }
  api.close();
});
it("unknown exceptions are sanitized", () => {
  expect(safeError(new Error(fakeToken))).not.toContain(fakeToken);
});
it("invalid JSON and wrapped objects rejected", async () => {
  for (const r of [
    new Response("not-json", { status: 200 }),
    response(200, { data: [] }),
  ]) {
    const api = createApi(
      fakeToken,
      fetcher(async () => r),
    );
    await expect(api.branches()).rejects.toMatchObject({
      kind: "InvalidResponse",
      status: 200,
    });
    api.close();
  }
});
it("uses card id only when loading chains, caches and refreshes explicitly", async () => {
  const urls: string[] = [];
  const api = createApi(
    fakeToken,
    fetcher(async (url) => {
      urls.push(url);
      return url.endsWith("/patients")
        ? response(200, [
            { id: "patient-9", card: { id: "card-8", status: "ACTIVE" } },
          ])
        : response(200, []);
    }),
  );
  const [patient] = await api.patients("branch", "department");
  expect(urls).toHaveLength(1);
  await api.chains(patient.cardId);
  await api.chains(patient.cardId);
  expect(urls).toHaveLength(2);
  expect(urls[1]).toContain("/medical-records/card-8/prescription-chains");
  expect(urls[1]).not.toContain("patient-9");
  await api.chains(patient.cardId, undefined, true);
  expect(urls).toHaveLength(3);
  api.close();
});
it("bounded card cache and close prevent reuse of medical data", async () => {
  const f = fetcher(async () => response());
  const api = createApi(fakeToken, f);
  for (const id of ["a", "b", "c", "d", "a"]) await api.chains(id);
  expect(f).toHaveBeenCalledTimes(5);
  api.close();
  await expect(api.chains("a")).rejects.toMatchObject({ kind: "Cancelled" });
});
it("diagnostic mode makes six GETs and deduplicates chain and revision ids", async () => {
  const urls: string[] = [];
  const api = createApi(
    fakeToken,
    fetcher(async (url, options) => {
      expect(options.method).toBe("GET");
      urls.push(url);
      return response(200, [
        {
          id: "same-chain",
          type: "MONITORING",
          elements: [
            { id: "e", results: [{ id: "r", hour: "2026-10-18T08:00:00Z" }] },
          ],
        },
      ]);
    }),
  );
  const data = await api.chains("card", undefined, false, true);
  expect(urls).toHaveLength(6);
  expect(urls.every((url) => url.includes("?type="))).toBe(true);
  expect(data).toHaveLength(1);
  expect(data[0].elements).toHaveLength(1);
  expect(data[0].elements[0].results).toHaveLength(1);
  api.close();
});
it("diagnostic failures do not return a misleading partial result", async () => {
  let n = 0;
  const api = createApi(
    fakeToken,
    fetcher(async () => (++n === 2 ? response(403) : response())),
  );
  await expect(
    api.chains("card", undefined, false, true),
  ).rejects.toMatchObject({ kind: "Forbidden" });
  expect(n).toBe(2);
  api.close();
});
it("request identifiers are URL encoded and callers cannot provide a method", async () => {
  const api = createApi(
    fakeToken,
    fetcher(async (url, options) => {
      expect(url).toContain("/a%2Fb/departments/c%3Fd/patients");
      expect(options.method).toBe("GET");
      return response();
    }),
  );
  await api.patients("a/b", "c?d");
  expect(Object.keys(api).sort()).toEqual([
    "branches",
    "chains",
    "clearCache",
    "close",
    "demo",
    "patients",
  ]);
  api.close();
});
function abortingFetch() {
  return fetcher(
    async (_url, options) =>
      new Promise((_resolve, reject) => {
        const signal = options.signal!;
        const abort = () =>
          reject(new DOMException("mock secret", "AbortError"));
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      }),
  );
}
it("request timeout is distinguished from user cancellation", async () => {
  const api = createApi(fakeToken, abortingFetch(), 5);
  await expect(api.branches()).rejects.toMatchObject({ kind: "Timeout" });
  api.close();
});
it("close aborts pending fetch and releases source", async () => {
  const api = createApi(fakeToken, abortingFetch());
  const pending = api.branches();
  api.close();
  await expect(pending).rejects.toMatchObject({ kind: "Cancelled" });
});
it("route changes cancel pending fetch", async () => {
  const api = createApi(fakeToken, abortingFetch());
  const controller = new AbortController();
  const pending = api.patients("b", "d", controller.signal);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ kind: "Cancelled" });
  api.close();
});
it("empty patients supported; demo never makes network requests", async () => {
  vi.stubGlobal("fetch", () => {
    throw Error("Live network forbidden");
  });
  const source = createMock();
  expect(await source.patients("demo-branch", "demo-empty")).toEqual([]);
  expect(await source.chains("x")).toHaveLength(18);
  source.close();
  expect(await source.branches()).toEqual([]);
});
it("memory cache expires after 60 seconds and preserves receipt timestamp", async () => {
  const { receivedAt } = await import("../src/source");
  const original = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(original);
  const f = fetcher(async () => response());
  const api = createApi(fakeToken, f);
  const first = await api.chains("c");
  clock.mockReturnValue(original + 10000);
  const cached = await api.chains("c");
  expect(cached).toBe(first);
  expect(receivedAt(cached)).toBe(original);
  clock.mockReturnValue(original + 61000);
  await api.chains("c");
  expect(f).toHaveBeenCalledTimes(2);
  api.close();
  clock.mockRestore();
});
it("department cache can be explicitly cleared without changing authorization or sending a request", async () => {
  const f = fetcher(async () => response());
  const source = createApi(fakeToken, f);
  await source.chains("card");
  source.clearCache?.();
  expect(f).toHaveBeenCalledTimes(1);
  await source.chains("card");
  expect(f).toHaveBeenCalledTimes(2);
  source.close();
});
