// @vitest-environment jsdom
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useOptionalRefresh } from "../src/useRefresh";
let root: Root, el: HTMLDivElement;
function Test({
  enabled,
  refresh,
}: {
  enabled: boolean;
  refresh: () => Promise<void>;
}) {
  useOptionalRefresh(enabled, refresh);
  return null;
}
beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  el = document.createElement("div");
  root = createRoot(el);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});
it("disabled refresh and hidden tabs cause no requests; enabling waits the full interval", async () => {
  const refresh = vi.fn(async () => {});
  await act(async () =>
    root.render(<Test enabled={false} refresh={refresh} />),
  );
  await act(async () => vi.advanceTimersByTimeAsync(120000));
  expect(refresh).not.toHaveBeenCalled();
  await act(async () => root.render(<Test enabled refresh={refresh} />));
  await act(async () => vi.advanceTimersByTimeAsync(59999));
  expect(refresh).not.toHaveBeenCalled();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(refresh).not.toHaveBeenCalled();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  await act(async () => vi.advanceTimersByTimeAsync(60000));
  expect(refresh).toHaveBeenCalledTimes(1);
});
it("long updates cannot overlap and disabling clears future polls", async () => {
  let resolve!: () => void;
  const refresh = vi.fn(() => new Promise<void>((r) => (resolve = r)));
  await act(async () => root.render(<Test enabled refresh={refresh} />));
  await act(async () => vi.advanceTimersByTimeAsync(180000));
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => resolve());
  await act(async () => vi.advanceTimersByTimeAsync(60000));
  expect(refresh).toHaveBeenCalledTimes(2);
  await act(async () =>
    root.render(<Test enabled={false} refresh={refresh} />),
  );
  await act(async () => resolve());
  await act(async () => vi.advanceTimersByTimeAsync(120000));
  expect(refresh).toHaveBeenCalledTimes(2);
});
