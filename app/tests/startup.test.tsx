// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { startApplication, showStartupFailure } from "../src/startup";
import { reportStartupFailure } from "../src/startupDiagnostics";
import { SafetyBoundary } from "../src/main";
let root: Root | undefined;
const shell = () => document.getElementById("startup-fallback")!;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML =
    '<main id="startup-fallback"><h1>Не удалось загрузить CleverVet Mobile</h1><a href="./" role="button">Повторить</a></main><div id="root"></div>';
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.replaceChildren();
});
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
it("keeps static fallback until React has actually committed", async () => {
  let ready!: () => void;
  startApplication(async () => ({
    mountApp: (onReady) => {
      ready = onReady;
    },
  }));
  await settle();
  expect(shell().hidden).toBe(false);
  ready();
  expect(shell().hidden).toBe(true);
  expect(document.getElementById("root")!.dataset.startup).toBe("ready");
});
for (const error of [
  new TypeError("PRIVATE bearer patient"),
  new SyntaxError("PRIVATE"),
  new ReferenceError("PRIVATE"),
])
  it(`module ${error.name} keeps readable fallback with retry`, async () => {
    startApplication(async () => {
      throw error;
    });
    await settle();
    expect(shell().hidden).toBe(false);
    expect(document.getElementById("root")!.hidden).toBe(true);
    expect(shell().textContent).toContain(
      "Не удалось загрузить CleverVet Mobile",
    );
    expect(shell().querySelector("a")?.getAttribute("href")).toBe("./");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "PRIVATE",
    );
  });
it("synchronous loader and mount exceptions are handled", async () => {
  startApplication(() => {
    throw Error("SECRET");
  });
  await settle();
  expect(console.error).toHaveBeenCalled();
  vi.mocked(console.error).mockClear();
  startApplication(async () => ({
    mountApp: () => {
      throw Error("SECRET");
    },
  }));
  await settle();
  expect(console.error).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ phase: "mount" }),
  );
});
it("timeout and late module resolution never remove failed fallback", async () => {
  vi.useFakeTimers();
  let resolve!: (v: any) => void;
  const mount = vi.fn();
  startApplication(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
    100,
  );
  await settle();
  vi.advanceTimersByTime(101);
  resolve({ mountApp: mount });
  await settle();
  expect(mount).not.toHaveBeenCalled();
  expect(shell().hidden).toBe(false);
});
it("cancelled startup never mounts or logs", async () => {
  const mount = vi.fn();
  const cancel = startApplication(async () => ({ mountApp: mount }));
  cancel();
  await settle();
  expect(mount).not.toHaveBeenCalled();
  expect(console.error).not.toHaveBeenCalled();
});
it("reporter only logs fixed phase and allowlisted exception type, never message or stack", () => {
  const error = new Error("SECRET patient JWT");
  error.name = "SECRET name";
  error.stack = "SECRET stack";
  reportStartupFailure("module-load", error);
  expect(vi.mocked(console.error).mock.calls).toEqual([
    [
      "[CleverVet Mobile] Startup failed",
      {
        code: "CV_STARTUP_FAILED",
        phase: "module-load",
        errorType: "UnknownError",
      },
    ],
  ]);
});
it("React render exception shows static fallback instead of blank screen without raw React logging", async () => {
  function Broken(): never {
    throw new Error("SECRET patient");
  }
  shell().hidden = true;
  root = createRoot(document.getElementById("root")!, {
    onCaughtError: () => {},
  });
  await act(async () =>
    root!.render(
      <SafetyBoundary>
        <Broken />
      </SafetyBoundary>,
    ),
  );
  expect(shell().hidden).toBe(false);
  expect(document.getElementById("root")!.hidden).toBe(true);
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
    "SECRET",
  );
});
it("runtime failure after successful startup restores retry screen", async () => {
  startApplication(async () => ({ mountApp: (r) => r() }));
  await settle();
  expect(shell().hidden).toBe(true);
  showStartupFailure("react-render", new Error("PRIVATE"));
  expect(shell().hidden).toBe(false);
});
