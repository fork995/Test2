// @vitest-environment jsdom
import { it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  readPreferences,
  saveEditingPreference,
  saveDepartmentPreference,
} from "../src/preferences";
import { initialDepartment } from "../src/departmentSelection";
import { normalizeBranches } from "../src/model";
const KEY = "clevervet.mobile.preferences.v1";
beforeEach(() => {
  localStorage.clear();
  readPreferences();
  readPreferences(true);
});
afterEach(() => vi.restoreAllMocks());
it("editing is enabled on first launch, repeated reads and reload without a saved setting", () => {
  expect(readPreferences().editingEnabled).toBe(true);
  expect(readPreferences().editingEnabled).toBe(true);
  expect(localStorage.length).toBe(0);
});
it("explicit false survives a fresh module (page reload), department changes and new reads", async () => {
  expect(saveEditingPreference(false)).toBe(true);
  saveDepartmentPreference({ branchId: "west-id", departmentId: "surgery-id" });
  vi.resetModules();
  const fresh = await import("../src/preferences");
  expect(fresh.readPreferences()).toEqual({
    editingEnabled: false,
    department: { branchId: "west-id", departmentId: "surgery-id" },
  });
});
it("honors an existing saved false without replacing it by the new default", () => {
  localStorage.setItem(
    KEY,
    JSON.stringify({ version: 1, editingEnabled: false, department: null }),
  );
  expect(readPreferences().editingEnabled).toBe(false);
});
it("stores only editing flag and branch/department IDs, stripping arbitrary injected data", () => {
  localStorage.setItem(
    KEY,
    JSON.stringify({
      editingEnabled: false,
      token: "FAKE_PRIVATE",
      patients: [{ name: "Invented" }],
      department: { branchId: "b", departmentId: "d", other: "ignored" },
    }),
  );
  saveEditingPreference(true);
  expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({
    version: 1,
    editingEnabled: true,
    department: { branchId: "b", departmentId: "d" },
  });
  expect(localStorage.length).toBe(1);
});
it("demo choices do not overwrite the real settings", () => {
  saveEditingPreference(false);
  saveDepartmentPreference({ branchId: "b", departmentId: "d" });
  saveEditingPreference(true, true);
  saveDepartmentPreference(
    { branchId: "demo-b", departmentId: "demo-d" },
    true,
  );
  expect(readPreferences()).toEqual({
    editingEnabled: false,
    department: { branchId: "b", departmentId: "d" },
  });
});
it("blocked storage falls back to RAM and reports that persistence failed", () => {
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Blocked");
  });
  expect(saveEditingPreference(false)).toBe(false);
  expect(readPreferences().editingEnabled).toBe(false);
  spy.mockRestore();
  saveEditingPreference(true);
});
it("rejects nonboolean defaults and invalid IDs", () => {
  localStorage.setItem(
    KEY,
    JSON.stringify({
      editingEnabled: "false",
      department: { branchId: "b", departmentId: "../wrong" },
    }),
  );
  expect(readPreferences()).toEqual({ editingEnabled: true, department: null });
});
const branches = () =>
  normalizeBranches([
    {
      id: "other-b",
      name: "Другая клиника",
      departments: [{ id: "other-d", name: "Другое отделение" }],
    },
    {
      id: "west-b",
      name: " ИВЦ   Запад ",
      departments: [
        { id: "wrong-d", name: "Терапия" },
        { id: "surgery-d", name: "хирургический стационар" },
      ],
    },
  ]);
it("resolves exact IDs from the GET response even when target is not first", () => {
  expect(initialDepartment(branches(), null)).toEqual({
    branchId: "west-b",
    departmentId: "surgery-d",
    notice: "",
  });
});
it("restores user's saved IDs even after response order changes", () => {
  expect(
    initialDepartment(branches().reverse(), {
      branchId: "other-b",
      departmentId: "other-d",
    }),
  ).toEqual({ branchId: "other-b", departmentId: "other-d", notice: "" });
});
it("missing default does not load a random first department", () => {
  const result = initialDepartment(branches().slice(0, 1), null);
  expect(result.departmentId).toBe("");
  expect(result.branchId).toBe("");
  expect(result.notice).toContain("недоступно");
});
it("missing saved permissions show a warning and never silently switch", () => {
  const result = initialDepartment(branches(), {
    branchId: "west-b",
    departmentId: "revoked-d",
  });
  expect(result.branchId).toBe("west-b");
  expect(result.departmentId).toBe("");
  expect(result.notice).toContain("Сохранённое отделение недоступно");
});
it("duplicate target names require explicit choice rather than an ordinal guess", () => {
  const b = branches();
  b[1].departments.push({ id: "duplicate", name: "Хирургический стационар" });
  expect(initialDepartment(b, null).departmentId).toBe("");
  expect(initialDepartment(b, null).notice).toContain("несколько");
});
