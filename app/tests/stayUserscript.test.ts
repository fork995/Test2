import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { expect, it } from "vitest";

const script = readFileSync(
  join(process.cwd(), "../stay/clevervet-mobile-stay.user.js"),
  "utf8",
);
const STORAGE_KEY = "clevervet-mobile:stay-auth:v1";
const READY_EVENT = "clevervet-mobile:stay-ready:v1";
const TOKEN_EVENT = "clevervet-mobile:stay-token:v1";
let claimSequence = 0;

function jwt(exp: number) {
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  return `synthetic.${payload}.not-a-signature`;
}

function wait(milliseconds = 0) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function harness({
  origin,
  pathname,
  storage = new Map<string, unknown>(),
  local = new Map<string, string>(),
  realTimers = true,
}: {
  origin: string;
  pathname: string;
  storage?: Map<string, unknown>;
  local?: Map<string, string>;
  realTimers?: boolean;
}) {
  const listeners = new Map<
    string,
    Set<(event: { type: string; detail?: unknown }) => void>
  >();
  const received: Array<{ type: string; detail?: unknown }> = [];
  class FakeCustomEvent {
    type: string;
    detail: unknown;
    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type;
      this.detail = init?.detail;
    }
  }
  const window = {
    addEventListener(
      type: string,
      listener: (event: { type: string; detail?: unknown }) => void,
    ) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    dispatchEvent(event: { type: string; detail?: unknown }) {
      received.push({
        type: event.type,
        detail:
          event.detail && typeof event.detail === "object"
            ? { ...(event.detail as Record<string, unknown>) }
            : event.detail,
      });
      listeners.get(event.type)?.forEach((listener) => listener(event));
      return true;
    },
  };
  const localStorage = {
    get length() {
      return local.size;
    },
    key(index: number) {
      return [...local.keys()][index] ?? null;
    },
    getItem(key: string) {
      return local.get(key) ?? null;
    },
  };
  const context = {
    window,
    location: { origin, pathname },
    localStorage,
    CustomEvent: FakeCustomEvent,
    GM_getValue: async (key: string, fallback: unknown) =>
      storage.has(key) ? storage.get(key) : fallback,
    GM_setValue: async (key: string, value: unknown) => {
      storage.set(key, structuredClone(value));
    },
    GM_deleteValue: async (key: string) => {
      storage.delete(key);
    },
    atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
    crypto: {
      randomUUID: () => `claim-${++claimSequence}`,
      getRandomValues: (value: Uint32Array) => {
        value.fill(++claimSequence);
        return value;
      },
    },
    setTimeout: realTimers
      ? setTimeout
      : (_callback: () => void, _milliseconds: number) => 0,
    clearTimeout,
    Uint32Array,
    structuredClone,
  };
  vm.runInNewContext(script, context);
  return { window, received, storage };
}

it("is self-contained and limited to the two approved pages", () => {
  expect(script.match(/^\/\/ @match\s+/gm)).toHaveLength(2);
  expect(script).toContain("https://www.app.clevervet.tech/*");
  expect(script).toContain("https://fork995.github.io/Test2/*");
  expect(script).toContain("@grant        GM_deleteValue");
  expect(script).not.toMatch(/@require|\bfetch\s*\(|XMLHttpRequest|console\./);
  expect(script).not.toMatch(/location\.(?:href|search|hash)\s*=/);
  expect(script).not.toMatch(/innerHTML|textContent|localStorage\.setItem/);
});

it("copies a fresh Auth0 API token and its effective expiry on the original site", async () => {
  const now = Date.now();
  const tokenExpiry = Math.floor((now + 3_600_000) / 1000);
  const token = jwt(tokenExpiry);
  const local = new Map([
    [
      "@@auth0spajs@@::client::https://api.clevervet.tech/::openid",
      JSON.stringify({
        body: { access_token: token },
        expiresAt: Math.floor((now + 7_200_000) / 1000),
      }),
    ],
  ]);
  const { storage } = harness({
    origin: "https://www.app.clevervet.tech",
    pathname: "/patients",
    local,
  });
  await wait();
  const saved = storage.get(STORAGE_KEY) as Record<string, unknown>;
  expect(saved.token).toBe(token);
  expect(saved.version).toBe(1);
  expect(saved.expiresAt).toBe(tokenExpiry * 1000);
  expect(Number(saved.capturedAt)).toBeGreaterThanOrEqual(now);
});

it("does not store an expired Auth0 token", async () => {
  const now = Date.now();
  const token = jwt(Math.floor(now / 1000) - 1);
  const local = new Map([
    [
      "@@auth0spajs@@::client::https://api.clevervet.tech/::openid",
      JSON.stringify({
        body: { access_token: token },
        expiresAt: Math.floor((now + 3_600_000) / 1000),
      }),
    ],
  ]);
  const { storage } = harness({
    origin: "https://www.app.clevervet.tech",
    pathname: "/",
    local,
    realTimers: false,
  });
  await wait();
  expect(storage.has(STORAGE_KEY)).toBe(false);
});

it("delivers one fresh transfer to Test2 and deletes GM storage first", async () => {
  const now = Date.now();
  const token = jwt(Math.floor((now + 3_600_000) / 1000));
  const storage = new Map<string, unknown>([
    [
      STORAGE_KEY,
      { version: 1, token, capturedAt: now, expiresAt: now + 3_600_000 },
    ],
  ]);
  const tab = harness({
    origin: "https://fork995.github.io",
    pathname: "/Test2/",
    storage,
  });
  tab.window.dispatchEvent(
    new (class {
      type = READY_EVENT;
    })(),
  );
  await wait(150);
  const delivered = tab.received.filter((event) => event.type === TOKEN_EVENT);
  expect(delivered).toHaveLength(1);
  expect((delivered[0].detail as Record<string, unknown>).token).toBe(token);
  expect(storage.has(STORAGE_KEY)).toBe(false);
});

it("clears stale GM data without dispatching a token", async () => {
  const now = Date.now();
  const storage = new Map<string, unknown>([
    [
      STORAGE_KEY,
      {
        version: 1,
        token: "stale.token.value",
        capturedAt: now - 180_001,
        expiresAt: now + 3_600_000,
      },
    ],
  ]);
  const tab = harness({
    origin: "https://fork995.github.io",
    pathname: "/Test2/",
    storage,
  });
  tab.window.dispatchEvent(
    new (class {
      type = READY_EVENT;
    })(),
  );
  await wait(10);
  expect(tab.received.some((event) => event.type === TOKEN_EVENT)).toBe(false);
  expect(storage.has(STORAGE_KEY)).toBe(false);
});

it("allows only one of two simultaneous Test2 tabs to consume the transfer", async () => {
  const now = Date.now();
  const token = jwt(Math.floor((now + 3_600_000) / 1000));
  const storage = new Map<string, unknown>([
    [
      STORAGE_KEY,
      { version: 1, token, capturedAt: now, expiresAt: now + 3_600_000 },
    ],
  ]);
  const first = harness({
    origin: "https://fork995.github.io",
    pathname: "/Test2/",
    storage,
  });
  const second = harness({
    origin: "https://fork995.github.io",
    pathname: "/Test2/",
    storage,
  });
  first.window.dispatchEvent(
    new (class {
      type = READY_EVENT;
    })(),
  );
  second.window.dispatchEvent(
    new (class {
      type = READY_EVENT;
    })(),
  );
  await wait(250);
  const deliveries = [...first.received, ...second.received].filter(
    (event) => event.type === TOKEN_EVENT,
  );
  expect(deliveries).toHaveLength(1);
  expect(storage.has(STORAGE_KEY)).toBe(false);
});
