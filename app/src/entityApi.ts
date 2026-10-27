import { API, ApiError } from "./api";
import type { NewPatient } from "./patientCreation";
import type { Belonging } from "./belongings";
import type { Location } from "./transferApi";
export interface EntityApi {
  belongings(patient: string, signal: AbortSignal): Promise<unknown[]>;
  addBelonging(
    patient: string,
    body: Belonging,
    signal: AbortSignal,
  ): Promise<void>;
  updateBelonging(
    patient: string,
    body: Belonging,
    signal: AbortSignal,
  ): Promise<void>;
  deleteBelonging(
    patient: string,
    id: string,
    signal: AbortSignal,
  ): Promise<void>;
  finishBelonging(
    patient: string,
    id: string,
    status: "RETURNED" | "CONSUMED",
    date: string,
    signal: AbortSignal,
  ): Promise<void>;
  receiveBelonging(
    patient: string,
    id: string,
    signal: AbortSignal,
  ): Promise<void>;
  createPatient(
    location: Location,
    body: NewPatient,
    signal: AbortSignal,
  ): Promise<void>;
  deletePatient(
    location: Location,
    patient: string,
    signal: AbortSignal,
  ): Promise<void>;
  close(): void;
}
const valid = (id: string) => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id);
/** Narrow original Mc/GH resources; no public arbitrary URL/method API. */
export function createEntityApi(
  initialToken: string,
  fetchImpl: typeof fetch = fetch,
  onUnauthorized: () => void = () => {},
  timeoutMs = 30000,
): EntityApi {
  let token = initialToken,
    closed = false;
  initialToken = "";
  const running = new Set<AbortController>();
  function close() {
    closed = true;
    token = "";
    running.forEach((c) => c.abort());
    running.clear();
  }
  function belongingsPath(patient: string, id?: string) {
    if (!valid(patient) || (id !== undefined && !valid(id)))
      throw new ApiError("InvalidResponse");
    return `/patients/${encodeURIComponent(patient)}/personal-belongings${id ? `/${encodeURIComponent(id)}` : ""}`;
  }
  function patientPath(l: Location, id?: string) {
    if (![l.branchId, l.departmentId, ...(id ? [id] : [])].every(valid))
      throw new ApiError("InvalidResponse");
    return `/branches/${encodeURIComponent(l.branchId)}/departments/${encodeURIComponent(l.departmentId)}/patients${id ? `/${encodeURIComponent(id)}` : ""}`;
  }
  function body(b: Belonging) {
    return {
      id: b.id,
      name: b.name,
      receivingDate: b.receivingDate,
      status: b.status,
      comment: b.comment,
      creationDate: b.creationDate,
      ...(b.returnDate
        ? {
            returnDate: b.returnDate,
            finishDate: `${b.returnDate}T00:00:00.000Z`,
          }
        : {}),
    };
  }
  async function send(
    path: string,
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    external: AbortSignal,
    payload?: unknown,
  ): Promise<unknown[]> {
    if (closed || !token || external.aborted) throw new ApiError("Cancelled");
    const c = new AbortController();
    running.add(c);
    const abort = () => c.abort();
    external.addEventListener("abort", abort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      c.abort();
    }, timeoutMs);
    try {
      const r = await fetchImpl(API + path, {
        method,
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(payload === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        signal: c.signal,
      });
      if (r.status === 401) {
        close();
        onUnauthorized();
        throw new ApiError("Unauthorized", 401);
      }
      if (r.status === 403) throw new ApiError("Forbidden", 403);
      if (r.status !== 200) throw new ApiError("Http", r.status);
      if (method !== "GET") return []; // Confirmed writes can have empty bodies.
      const value: unknown = await r.json();
      if (!Array.isArray(value)) throw new ApiError("InvalidResponse");
      if (c.signal.aborted || closed) throw new ApiError("Cancelled");
      return value;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(
        timedOut
          ? "Timeout"
          : c.signal.aborted
            ? "Cancelled"
            : e instanceof TypeError
              ? "NetworkOrCors"
              : "Unexpected",
      );
    } finally {
      clearTimeout(timer);
      external.removeEventListener("abort", abort);
      running.delete(c);
    }
  }
  const write = async (
    path: string,
    method: "POST" | "PUT" | "PATCH" | "DELETE",
    s: AbortSignal,
    payload?: unknown,
  ) => {
    await send(path, method, s, payload);
  };
  return {
    belongings: (p, s) => send(belongingsPath(p), "GET", s),
    addBelonging: (p, b, s) => write(belongingsPath(p), "POST", s, body(b)),
    updateBelonging: (p, b, s) =>
      write(belongingsPath(p, b.id), "PUT", s, body(b)),
    deleteBelonging: (p, id, s) => write(belongingsPath(p, id), "DELETE", s),
    finishBelonging: (p, id, status, date, s) =>
      write(belongingsPath(p, id) + "/finish", "PATCH", s, { status, date }),
    receiveBelonging: (p, id, s) =>
      write(belongingsPath(p, id) + "/rollback-to-received", "PATCH", s),
    createPatient: (l, b, s) => write(patientPath(l), "POST", s, b),
    deletePatient: (l, p, s) => write(patientPath(l, p), "DELETE", s),
    close,
  };
}
