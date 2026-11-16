// @vitest-environment jsdom
import { expect, it } from "vitest";
import { clearSession, saveSession, AUTH_SESSION_KEY } from "../src/authSession";
import { saveEditingPreference } from "../src/preferences";
it("Test3 login, preferences and logout leave Test2 storage untouched", () => {
  localStorage.clear();
  const original = {"clevervet.mobile.auth-session.v1": "test2-session", "clevervet.mobile.preferences.v1": "test2-preferences"};
  for (const [k,v] of Object.entries(original)) localStorage.setItem(k,v);
  saveSession("synthetic-token", Date.now()+60000);
  saveEditingPreference(false);
  expect(localStorage.getItem(AUTH_SESSION_KEY)).not.toBeNull();
  clearSession();
  for (const [k,v] of Object.entries(original)) expect(localStorage.getItem(k)).toBe(v);
  expect(localStorage.getItem("clevervet.mobile.test3.preferences.v1")).toContain('false');
});
