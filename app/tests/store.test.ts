import { it, expect, vi } from "vitest";
import { PrescriptionStore } from "../src/store";
import { ApiError } from "../src/api";
import { normalizeChains, type Chain } from "../src/model";
import { markFetched, type Source } from "../src/source";
function fixture() {
  const waits = new Map<
    string,
    { resolve: (data: Chain[]) => void; reject: (error: unknown) => void }
  >();
  let active = 0,
    max = 0;
  const chains = vi.fn(
    (card: string, signal?: AbortSignal) =>
      new Promise<Chain[]>((resolve, reject) => {
        active++;
        max = Math.max(max, active);
        let settled = false;
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          active--;
          fn();
        };
        waits.set(card, {
          resolve: (data) => finish(() => resolve(data)),
          reject: (error) => finish(() => reject(error)),
        });
        signal?.addEventListener(
          "abort",
          () => finish(() => reject(new ApiError("Cancelled"))),
          { once: true },
        );
      }),
  );
  const source: Source = {
    demo: true,
    branches: async () => [],
    patients: async () => [],
    chains,
    close: vi.fn(),
  };
  const expire = vi.fn();
  const store = new PrescriptionStore(source, expire);
  return { store, chains, waits, expire, max: () => max };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const data = () =>
  markFetched(
    normalizeChains([{ id: "c", name: "Учебное назначение", elements: [] }]),
  );
it("queue never exceeds 3 simultaneous prescription loads and waits for every patient", async () => {
  const f = fixture();
  const jobs = Array.from({ length: 8 }, (_, i) =>
    f.store.request(`card-${i}`),
  );
  await tick();
  expect(f.chains).toHaveBeenCalledTimes(3);
  expect(
    [...f.store.getSnapshot().values()].filter((d) => d.phase === "queued"),
  ).toHaveLength(5);
  f.waits.get("card-0")!.resolve(data());
  await tick();
  expect(f.chains).toHaveBeenCalledTimes(4);
  expect(
    [...f.store.getSnapshot().values()].filter((d) => d.phase === "ready"),
  ).toHaveLength(1);
  for (let i = 1; i < 8; i++) {
    f.waits.get(`card-${i}`)!.resolve(data());
    await tick();
  }
  await Promise.all(jobs);
  expect(f.max()).toBe(3);
  expect(
    [...f.store.getSnapshot().values()].every((d) => d.phase === "ready"),
  ).toBe(true);
  f.store.close();
});
it("one 403 does not block other patients or make queued patients complete", async () => {
  const f = fixture();
  const jobs = ["a", "b", "c", "d"].map((c) => f.store.request(c));
  await tick();
  f.waits.get("b")!.reject(new ApiError("Forbidden", 403));
  await tick();
  expect(f.store.getSnapshot().get("b")?.phase).toBe("error");
  expect(f.store.getSnapshot().get("d")?.phase).toBe("loading");
  for (const id of ["a", "c", "d"]) f.waits.get(id)!.resolve(data());
  await Promise.all(jobs);
  expect(
    [...f.store.getSnapshot().values()].filter((d) => d.phase === "ready"),
  ).toHaveLength(3);
  expect(f.expire).not.toHaveBeenCalled();
  f.store.close();
});
it("in-flight loads are shared by general feed and selected patient", async () => {
  const f = fixture();
  const a = f.store.request("c"),
    b = f.store.request("c");
  expect(a).toBe(b);
  await tick();
  expect(f.chains).toHaveBeenCalledTimes(1);
  f.waits.get("c")!.resolve(data());
  await a;
  await f.store.request("c");
  expect(f.chains).toHaveBeenCalledTimes(1);
  f.store.close();
});
it("manual refresh bypasses ready state and does not reuse a completed error as data", async () => {
  const f = fixture();
  const first = f.store.request("c");
  await tick();
  f.waits.get("c")!.reject(new ApiError("Http", 500));
  await first;
  expect(f.store.getSnapshot().get("c")?.phase).toBe("error");
  const refresh = f.store.request("c", true);
  await tick();
  expect(f.chains).toHaveBeenLastCalledWith(
    "c",
    expect.any(AbortSignal),
    true,
    false,
  );
  f.waits.get("c")!.resolve(data());
  await refresh;
  expect(f.store.getSnapshot().get("c")?.phase).toBe("ready");
  f.store.close();
});
it("close aborts running/queued requests and clears medical state", async () => {
  const f = fixture();
  const jobs = ["a", "b", "c", "d", "e"].map((id) => f.store.request(id));
  await tick();
  f.store.close();
  await Promise.all(jobs);
  await tick();
  expect(f.store.getSnapshot().size).toBe(0);
  expect(f.chains).toHaveBeenCalledTimes(3);
  await f.store.request("new");
  expect(f.chains).toHaveBeenCalledTimes(3);
});
it("401 stops the whole queue and expires the session", async () => {
  const f = fixture();
  const jobs = ["a", "b", "c", "d", "e"].map((id) => f.store.request(id));
  await tick();
  f.waits.get("a")!.reject(new ApiError("Unauthorized", 401));
  await Promise.all(jobs);
  await tick();
  expect(f.expire).toHaveBeenCalledTimes(1);
  expect(f.chains).toHaveBeenCalledTimes(3);
  expect(f.store.getSnapshot().size).toBe(0);
});
it("pruning removes departed patients, cancels their jobs, and cannot resurrect them", async () => {
  const f = fixture();
  const jobs = ["a", "b", "c", "d"].map((id) => f.store.request(id));
  await tick();
  f.store.prune(new Set(["a"]));
  f.waits.get("a")!.resolve(data());
  await Promise.all(jobs);
  await tick();
  expect([...f.store.getSnapshot().keys()]).toEqual(["a"]);
  expect(f.chains).toHaveBeenCalledTimes(3);
  f.store.close();
});
it("diagnostic retry also occupies only one queue slot", async () => {
  const f = fixture();
  const job = f.store.request("c", true, true);
  await tick();
  expect(f.chains).toHaveBeenCalledWith(
    "c",
    expect.any(AbortSignal),
    true,
    true,
  );
  f.waits.get("c")!.resolve(data());
  await job;
  expect(f.store.getSnapshot().get("c")?.diagnostic).toBe(true);
  f.store.close();
});
it("refresh retains the previous immutable snapshot until success and keeps it flagged after a failure", async () => {
  const f = fixture();
  const first = f.store.request("c");
  await tick();
  f.waits.get("c")!.resolve(data());
  await first;
  const before = f.store.getSnapshot().get("c")!;
  const update = f.store.request("c", true);
  await tick();
  expect(f.store.getSnapshot().get("c")?.indexes).toBe(before.indexes);
  expect(f.store.getSnapshot().get("c")?.hasData).toBe(true);
  expect(f.store.getSnapshot().get("c")?.phase).toBe("loading");
  f.waits.get("c")!.reject(new ApiError("Http", 500));
  await update;
  const failed = f.store.getSnapshot().get("c")!;
  expect(failed.phase).toBe("error");
  expect(failed.hasData).toBe(true);
  expect(failed.indexes).toBe(before.indexes);
  expect(failed.receivedAt).toBe(before.receivedAt);
  const retry = f.store.request("c", true);
  await tick();
  f.waits.get("c")!.resolve(markFetched(normalizeChains([])));
  await retry;
  expect(f.store.getSnapshot().get("c")?.chains).toEqual([]);
  expect(f.store.getSnapshot().get("c")?.indexes).not.toBe(before.indexes);
  expect(f.store.getSnapshot().get("c")?.phase).toBe("ready");
  f.store.close();
});
it("verified write receipt supersedes an older pending refresh and cannot be replaced by it", async () => {
  const f = fixture();
  const pending = f.store.request("card", true);
  await tick();
  const verified = markFetched(
    normalizeChains([{ id: "verified", elements: [] }]),
  );
  f.store.acceptVerified("card", verified);
  await pending;
  await tick();
  expect(f.store.getSnapshot().get("card")?.chains).toBe(verified);
  expect(f.store.getSnapshot().get("card")?.phase).toBe("ready");
  f.store.close();
});
