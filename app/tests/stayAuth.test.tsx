// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App";
import {
  parseStayAuthTransfer,
  STAY_BRIDGE_READY_EVENT,
  STAY_READY_EVENT,
  STAY_TOKEN_EVENT,
} from "../src/stayAuth";

let container: HTMLDivElement;
let root: Root;

function jwt(exp: number) {
  const payload = btoa(JSON.stringify({ exp }))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `synthetic.${payload}.not-a-signature`;
}

function transfer(
  token: string,
  now = Date.now(),
  expiresAt = now + 3_600_000,
) {
  return { version: 1, token, capturedAt: now, expiresAt };
}

function response(status = 200, body: unknown = []) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  history.replaceState(null, "", "/Test2/");
  localStorage.clear();
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function render(search = "") {
  history.replaceState(null, "", `/Test2/${search}`);
  await act(async () => root.render(<App />));
}

async function send(value: unknown) {
  await act(async () => {
    window.dispatchEvent(new CustomEvent(STAY_TOKEN_EVENT, { detail: value }));
    await Promise.resolve();
  });
}

it("accepts only a fresh, unexpired, bounded Stay transfer", () => {
  const now = Date.parse("2026-10-27T12:00:00Z");
  const valid = transfer("header.payload.signature", now, now + 60_000);
  expect(parseStayAuthTransfer(valid, now)).toEqual(valid);
  expect(
    parseStayAuthTransfer({ ...valid, capturedAt: now - 180_001 }, now),
  ).toBeNull();
  expect(
    parseStayAuthTransfer({ ...valid, capturedAt: now + 30_001 }, now),
  ).toBeNull();
  expect(parseStayAuthTransfer({ ...valid, expiresAt: now }, now)).toBeNull();
  expect(
    parseStayAuthTransfer({ ...valid, token: "bad token" }, now),
  ).toBeNull();
  expect(parseStayAuthTransfer(null, now)).toBeNull();
});

it("announces readiness after the app listener is installed", async () => {
  const ready = vi.fn();
  window.addEventListener(STAY_READY_EVENT, ready);
  await render();
  expect(ready).toHaveBeenCalledOnce();
  window.dispatchEvent(new CustomEvent(STAY_BRIDGE_READY_EVENT));
  expect(ready).toHaveBeenCalledTimes(2);
  window.removeEventListener(STAY_READY_EVENT, ready);
});

it("validates a Stay token through the existing API and opens patients", async () => {
  const token = jwt(Math.floor(Date.now() / 1000) + 3600);
  const fetcher = vi.fn(async (url: string, options: RequestInit) => {
    expect(url).toBe("https://backend.clevervet.tech/api/branches");
    expect((options.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${token}`,
    );
    expect(url).not.toContain(token);
    return response();
  });
  vi.stubGlobal("fetch", fetcher);
  await render();
  await send(transfer(token));
  expect(fetcher).toHaveBeenCalledOnce();
  expect(
    container
      .querySelector('.bottom-nav button[aria-current="page"]')
      ?.textContent?.trim(),
  ).toContain("Пациенты");
  expect(location.href).not.toContain(token);
});

it("coexists with importAuth and does not read the clipboard", async () => {
  const token = jwt(Math.floor(Date.now() / 1000) + 3600);
  const readText = vi.fn();
  vi.stubGlobal("navigator", { clipboard: { readText } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response()),
  );
  await render("?importAuth=1&keep=1");
  await send(transfer(token));
  expect(readText).not.toHaveBeenCalled();
  expect(location.search).toBe("?keep=1");
  expect(container.querySelector(".bottom-nav")).not.toBeNull();
});

it.each([401, 403])(
  "keeps manual login after Stay receives HTTP %s",
  async (status) => {
    const token = jwt(Math.floor(Date.now() / 1000) + 3600);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(status)),
    );
    await render();
    await send(transfer(token));
    expect(container.querySelector("#jwt")).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "снова откройте Test2",
    );
  },
);

it("ignores expired and duplicate transfers without repeated login attempts", async () => {
  const now = Date.parse("2026-10-27T12:00:00Z");
  vi.spyOn(Date, "now").mockReturnValue(now);
  const token = jwt(Math.floor(now / 1000) + 3600);
  const fetcher = vi.fn(async () => response());
  vi.stubGlobal("fetch", fetcher);
  await render();
  await send(transfer(token, now - 181_000, now + 60_000));
  expect(fetcher).not.toHaveBeenCalled();
  expect(container.querySelector("#jwt")).not.toBeNull();
  await send(transfer(token, now, now + 60_000));
  await send(transfer(token, now, now + 60_000));
  expect(fetcher).toHaveBeenCalledOnce();
});

it("leaves manual login usable after a network failure", async () => {
  const token = jwt(Math.floor(Date.now() / 1000) + 3600);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("private network details");
    }),
  );
  await render();
  await send(transfer(token));
  expect(container.querySelector("#jwt")).not.toBeNull();
  expect(container.textContent).toContain("CORS, сеть, TLS");
  expect(container.textContent).not.toContain("private network details");
});

it("uses the earlier GM expiry and gives Stay-specific renewal guidance", async () => {
  vi.useFakeTimers();
  const now = Date.parse("2026-10-27T12:00:00Z");
  vi.setSystemTime(now);
  const token = jwt(Math.floor((now + 3_600_000) / 1000));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response()),
  );
  await render();
  await send(transfer(token, now, now + 1000));
  expect(container.querySelector(".bottom-nav")).not.toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(container.querySelector("#jwt")).not.toBeNull();
  expect(container.textContent).toContain("снова откройте Test2");
  expect(container.textContent).not.toContain("запустите команду");
});
