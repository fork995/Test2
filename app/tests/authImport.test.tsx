// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App";
import {
  authImportRequested,
  clearAuthImportParameter,
  clipboardReadMessage,
  jwtExpiresAt,
  tokenExpiryWarning,
} from "../src/authImport";

let container: HTMLDivElement;
let root: Root;

function jwt(exp?: number) {
  const payload = btoa(JSON.stringify(exp === undefined ? {} : { exp }))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `synthetic.${payload}.not-a-signature`;
}

beforeEach(() => {
  history.replaceState(null, "", "/AppTest-/");
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

async function render(search = "?importAuth=1") {
  history.replaceState(null, "", `/AppTest-/${search}`);
  await act(async () => root.render(<App />));
}

function button(name: string) {
  const found = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find((node) => node.textContent?.trim() === name);
  if (!found) throw Error(`Missing button: ${name}`);
  return found;
}

async function click(name: string) {
  await act(async () => button(name).click());
}

function clipboard(value: string | Error) {
  const readText = vi.fn(async () => {
    if (typeof value !== "string") throw value;
    return value;
  });
  vi.stubGlobal("navigator", { clipboard: { readText } });
  return readText;
}

function response(status = 200, body: unknown = []) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

it("recognizes and removes only the import signal without placing a token in URL", () => {
  history.replaceState(null, "", "/AppTest-/?keep=1&importAuth=1#section");
  expect(authImportRequested()).toBe(true);
  clearAuthImportParameter();
  expect(location.pathname + location.search + location.hash).toBe(
    "/AppTest-/?keep=1#section",
  );
});

it("parses only a finite exp claim and produces expiry warnings", () => {
  const exp = 1_800_000_000;
  expect(jwtExpiresAt(jwt(exp))).toBe(exp * 1000);
  expect(jwtExpiresAt(jwt())).toBeNull();
  expect(jwtExpiresAt("not-a-jwt")).toBeNull();
  expect(tokenExpiryWarning(exp * 1000, exp * 1000)).toContain("истёк");
  expect(tokenExpiryWarning(exp * 1000, exp * 1000 - 10 * 60000)).toContain(
    "10 мин",
  );
});

it("shows quick login without reading clipboard until the user taps", async () => {
  const readText = clipboard(jwt(Math.floor(Date.now() / 1000) + 3600));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response()),
  );
  await render();
  expect(container.textContent).toContain("Быстрый вход");
  expect(container.textContent).toContain("Токен CleverVet скопирован");
  expect(readText).not.toHaveBeenCalled();
});

it("imports clipboard token, validates through API and clears importAuth", async () => {
  const token = jwt(Math.floor(Date.now() / 1000) + 3600);
  const readText = clipboard(`  ${token}\n`);
  const fetcher = vi.fn(async (url: string, options: RequestInit) => {
    expect(url).toBe("https://backend.clevervet.tech/api/branches");
    expect((options.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${token}`,
    );
    expect(url).not.toContain(token);
    return response();
  });
  vi.stubGlobal("fetch", fetcher);
  await render("?importAuth=1&keep=1");
  await click("Войти с токеном из буфера");
  expect(readText).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledOnce();
  expect(container.querySelector(".bottom-nav")).not.toBeNull();
  expect(
    container
      .querySelector('.bottom-nav button[aria-current="page"]')
      ?.textContent?.trim(),
  ).toContain("Пациенты");
  expect(location.search).toBe("?keep=1");
  expect(location.href).not.toContain(token);
});

it("ends an imported in-memory session when exp is reached", async () => {
  vi.useFakeTimers();
  const now = Date.parse("2026-10-27T12:00:00Z");
  vi.setSystemTime(now);
  clipboard(jwt(Math.floor((now + 1000) / 1000)));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response()),
  );
  await render();
  await click("Войти с токеном из буфера");
  expect(container.querySelector(".bottom-nav")).not.toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(container.querySelector("#jwt")).not.toBeNull();
  expect(container.textContent).toContain("Срок действия токена истёк");
});

it("shows a near-expiry warning after successful validation", async () => {
  const now = Date.parse("2026-10-27T12:00:00Z");
  vi.spyOn(Date, "now").mockReturnValue(now);
  clipboard(jwt(Math.floor((now + 20 * 60000) / 1000)));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response()),
  );
  await render();
  await click("Войти с токеном из буфера");
  expect(
    container.querySelector(".auth-expiry-warning")?.textContent,
  ).toContain("20 мин");
});

it.each([401, 403])(
  "keeps quick login open after HTTP %s and asks for a fresh token",
  async (status) => {
    clipboard(jwt(Math.floor(Date.now() / 1000) + 3600));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(status)),
    );
    await render();
    await click("Войти с токеном из буфера");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "снова запустите команду",
    );
    expect(location.search).toBe("?importAuth=1");
    expect(container.textContent).toContain("Быстрый вход");
  },
);

it("rejects an expired clipboard token before any API request", async () => {
  const now = Date.parse("2026-10-27T12:00:00Z");
  vi.spyOn(Date, "now").mockReturnValue(now);
  clipboard(jwt(Math.floor(now / 1000) - 1));
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await render();
  await click("Войти с токеном из буфера");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "истёк",
  );
  expect(fetcher).not.toHaveBeenCalled();
});

it("handles denied, missing and empty clipboard without network requests", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  clipboard(new DOMException("private clipboard detail", "NotAllowedError"));
  await render();
  await click("Войти с токеном из буфера");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Safari не разрешил",
  );
  expect(container.textContent).not.toContain("private clipboard detail");
  expect(fetcher).not.toHaveBeenCalled();

  vi.stubGlobal("navigator", {});
  await click("Войти с токеном из буфера");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "не поддерживает чтение",
  );

  clipboard("   ");
  await click("Войти с токеном из буфера");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "нет корректного токена",
  );
  expect(fetcher).not.toHaveBeenCalled();
});

it("sanitizes network errors and preserves manual login as fallback", async () => {
  const token = jwt(Math.floor(Date.now() / 1000) + 3600);
  clipboard(token);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Promise.reject(new TypeError(token))),
  );
  await render();
  await click("Войти с токеном из буфера");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "CORS, сеть, TLS",
  );
  expect(container.textContent).not.toContain(token);
  await click("Ввести токен вручную");
  expect(container.querySelector("#jwt")).not.toBeNull();
  expect(location.search).toBe("");
});

it("uses a generic clipboard error without exposing raw details", () => {
  expect(clipboardReadMessage(new Error("secret clipboard value"))).toBe(
    "Не удалось прочитать буфер обмена. Выберите «Ввести токен вручную».",
  );
});
