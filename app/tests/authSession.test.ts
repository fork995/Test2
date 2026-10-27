// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  AUTH_SESSION_KEY,
  clearSession,
  isSessionExpired,
  restoreSession,
  saveSession,
} from "../src/authSession";

function jwt(exp?: number) {
  const payload = btoa(JSON.stringify(exp === undefined ? {} : { exp }))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `synthetic.${payload}.not-a-signature`;
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

it("stores only version, token and the JWT-bounded expiry", () => {
  const jwtExpiry = Date.parse("2026-10-28T12:00:00Z");
  const result = saveSession(jwt(jwtExpiry / 1000), jwtExpiry + 60_000);
  expect(result.saved).toBe(true);
  expect(JSON.parse(localStorage.getItem(AUTH_SESSION_KEY)!)).toEqual({
    version: 1,
    accessToken: jwt(jwtExpiry / 1000),
    expiresAt: jwtExpiry,
  });
  expect(restoreSession(jwtExpiry - 1).session?.expiresAt).toBe(jwtExpiry);
});

it("keeps unknown expiry null and requires the caller to validate through API", () => {
  saveSession("opaque-access-token", null);
  expect(restoreSession().session).toEqual({
    version: 1,
    accessToken: "opaque-access-token",
    expiresAt: null,
  });
});

it("discards expired, corrupted and structurally invalid records", () => {
  const now = Date.parse("2026-10-27T12:00:00Z");
  saveSession(jwt((now - 1000) / 1000), now - 1000);
  expect(restoreSession(now)).toMatchObject({ session: null, discarded: true });
  expect(localStorage.getItem(AUTH_SESSION_KEY)).toBeNull();

  localStorage.setItem(AUTH_SESSION_KEY, "{broken");
  expect(restoreSession(now)).toMatchObject({ session: null, discarded: true });

  localStorage.setItem(
    AUTH_SESSION_KEY,
    JSON.stringify({ version: 2, accessToken: "token", expiresAt: null }),
  );
  expect(restoreSession(now)).toMatchObject({ session: null, discarded: true });
});

it("does not trust a malformed JWT claim as an expiry", () => {
  const saved = saveSession("bad.invalid-base64.signature", null);
  expect(saved.session.expiresAt).toBeNull();
  expect(isSessionExpired(saved.session)).toBe(false);
});

it("falls back to the current tab when Safari blocks persistent storage", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Blocked", "SecurityError");
  });
  expect(saveSession("token", null).saved).toBe(false);
  vi.restoreAllMocks();
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("Blocked", "SecurityError");
  });
  expect(restoreSession()).toEqual({
    session: null,
    storageAvailable: false,
    discarded: false,
  });
});

it("clearSession removes only the Test2 authentication record", () => {
  localStorage.setItem("other", "value");
  saveSession("token", null);
  expect(clearSession()).toBe(true);
  expect(localStorage.getItem(AUTH_SESSION_KEY)).toBeNull();
  expect(localStorage.getItem("other")).toBe("value");
});
