// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { AUTH_SESSION_KEY, saveSession } from "../src/authSession";
import { STAY_TOKEN_EVENT } from "../src/stayAuth";

let container: HTMLDivElement;
let root: Root;

function jwt(exp = Math.floor(Date.now() / 1000) + 3600) {
  const payload = btoa(JSON.stringify({ exp }))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `synthetic.${payload}.not-a-signature`;
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
});

async function render() {
  await act(async () => {
    root.render(<App />);
    await Promise.resolve();
  });
}

async function remount() {
  await act(async () => root.unmount());
  root = createRoot(container);
  await render();
}

async function stayLogin(token: string) {
  await render();
  await act(async () => {
    window.dispatchEvent(
      new CustomEvent(STAY_TOKEN_EVENT, {
        detail: {
          version: 1,
          token,
          capturedAt: Date.now(),
          expiresAt: Date.now() + 3_600_000,
        },
      }),
    );
    await Promise.resolve();
  });
}

function button(name: string) {
  const result = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent?.trim() === name,
  );
  if (!result) throw new Error(`Missing button: ${name}`);
  return result;
}

it("saves a verified Stay login and restores it after the tab is reopened", async () => {
  const token = jwt();
  const fetcher = vi.fn(async () => response());
  vi.stubGlobal("fetch", fetcher);
  await stayLogin(token);
  expect(JSON.parse(localStorage.getItem(AUTH_SESSION_KEY)!)).toMatchObject({
    version: 1,
    accessToken: token,
  });
  expect(container.querySelector(".bottom-nav")).not.toBeNull();

  await remount();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(container.querySelector(".bottom-nav")).not.toBeNull();
  expect(container.querySelector("#jwt")).toBeNull();
});

it("shows restoration instead of flashing the login form", async () => {
  saveSession(jwt(), Date.now() + 3_600_000);
  let resolve!: (value: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    ),
  );
  await render();
  expect(container.textContent).toContain("Восстановление сессии");
  expect(container.querySelector("#jwt")).toBeNull();
  await act(async () => resolve(response()));
  expect(container.querySelector(".bottom-nav")).not.toBeNull();
});

it("clears a restored session on 401 but retains it on 403", async () => {
  saveSession(jwt(), Date.now() + 3_600_000);
  vi.stubGlobal("fetch", vi.fn(async () => response(401)));
  await render();
  expect(localStorage.getItem(AUTH_SESSION_KEY)).toBeNull();
  expect(container.querySelector("#jwt")).not.toBeNull();

  await act(async () => root.unmount());
  root = createRoot(container);
  saveSession(jwt(), Date.now() + 3_600_000);
  vi.stubGlobal("fetch", vi.fn(async () => response(403)));
  await render();
  expect(localStorage.getItem(AUTH_SESSION_KEY)).not.toBeNull();
  expect(container.textContent).toContain("Повторить проверку");
});

it("retains a potentially valid session after a temporary network error", async () => {
  saveSession(jwt(), Date.now() + 3_600_000);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("private network detail");
    }),
  );
  await render();
  expect(localStorage.getItem(AUTH_SESSION_KEY)).not.toBeNull();
  expect(container.textContent).toContain("Сохранённая сессия не удалена");
  expect(container.textContent).not.toContain("private network detail");
});

it("explicit logout clears memory and persistent authentication", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => response()));
  await stayLogin(jwt());
  const settings = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent?.includes("Настройки"),
  );
  expect(settings).toBeDefined();
  await act(async () => settings!.click());
  await act(async () => button("Выйти и очистить данные").click());
  expect(localStorage.getItem(AUTH_SESSION_KEY)).toBeNull();
  expect(container.querySelector("#jwt")).not.toBeNull();
});

it("synchronizes an explicit logout from another tab", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => response()));
  await stayLogin(jwt());
  await act(async () => {
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: AUTH_SESSION_KEY,
        oldValue: "saved",
        newValue: null,
      }),
    );
  });
  expect(container.querySelector("#jwt")).not.toBeNull();
  expect(container.textContent).toContain("другой вкладке");
});

it("keeps the verified in-memory session when localStorage is blocked", async () => {
  const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Blocked", "SecurityError");
  });
  vi.stubGlobal("fetch", vi.fn(async () => response()));
  await stayLogin(jwt());
  expect(container.querySelector(".bottom-nav")).not.toBeNull();
  expect(container.textContent).toContain("Safari не разрешил сохранить сессию");
  set.mockRestore();
});

it("does not accept a competing Stay token while restoration is in progress", async () => {
  const saved = jwt();
  const competing = jwt(Math.floor(Date.now() / 1000) + 7200);
  saveSession(saved, Date.now() + 3_600_000);
  let resolve!: (value: Response) => void;
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  await render();
  await act(async () => {
    window.dispatchEvent(
      new CustomEvent(STAY_TOKEN_EVENT, {
        detail: {
          version: 1,
          token: competing,
          capturedAt: Date.now(),
          expiresAt: Date.now() + 7_200_000,
        },
      }),
    );
    resolve(response());
  });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(JSON.parse(localStorage.getItem(AUTH_SESSION_KEY)!).accessToken).toBe(
    saved,
  );
});
