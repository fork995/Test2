/** Persistent storage is restricted to these nonclinical preferences. No session/API objects. */
export interface DepartmentChoice {
  branchId: string;
  departmentId: string;
}
export interface Preferences {
  editingEnabled: boolean;
  department: DepartmentChoice | null;
}
const KEY = "clevervet.mobile.preferences.v1";
const DEMO_KEY = "clevervet.mobile.demo-preferences.v1";
const defaults = (): Preferences => ({
  editingEnabled: true,
  department: null,
});
const fallback = new Map<string, Preferences>();
const unsaved = new Set<string>();
function id(value: unknown): value is string {
  return (
    typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)
  );
}
function sanitize(raw: unknown): Preferences {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults();
  const r = raw as Record<string, unknown>,
    d = r.department as Record<string, unknown> | null;
  return {
    editingEnabled:
      typeof r.editingEnabled === "boolean" ? r.editingEnabled : true,
    department:
      d && typeof d === "object" && id(d.branchId) && id(d.departmentId)
        ? { branchId: d.branchId, departmentId: d.departmentId }
        : null,
  };
}
export function readPreferences(demo = false): Preferences {
  const key = demo ? DEMO_KEY : KEY;
  if (unsaved.has(key)) return fallback.get(key) ?? defaults();
  try {
    const value = localStorage.getItem(key);
    const result = value === null ? defaults() : sanitize(JSON.parse(value));
    fallback.set(key, result);
    return result;
  } catch {
    return fallback.get(key) ?? defaults();
  }
}
function writePreferences(value: Preferences, demo: boolean): boolean {
  const key = demo ? DEMO_KEY : KEY,
    clean = sanitize(value);
  fallback.set(key, clean);
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        editingEnabled: clean.editingEnabled,
        department: clean.department,
      }),
    );
    unsaved.delete(key);
    return true;
  } catch {
    unsaved.add(key);
    return false;
  }
}
export function saveEditingPreference(enabled: boolean, demo = false): boolean {
  return writePreferences(
    { ...readPreferences(demo), editingEnabled: enabled },
    demo,
  );
}
export function saveDepartmentPreference(
  department: DepartmentChoice,
  demo = false,
): boolean {
  return writePreferences({ ...readPreferences(demo), department }, demo);
}
