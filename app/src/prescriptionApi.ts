import { API, ApiError } from "./api";
import type {
  PrescriptionPayload,
  NewPrescriptionChain,
} from "./prescriptions";
export interface PrescriptionApi {
  create(
    card: string,
    body: NewPrescriptionChain,
    s: AbortSignal,
  ): Promise<void>;
  addRevision(
    card: string,
    chain: string,
    body: PrescriptionPayload,
    s: AbortSignal,
  ): Promise<void>;
  finish(
    card: string,
    chain: string,
    revision: string,
    end: string,
    s: AbortSignal,
  ): Promise<void>;
  deleteRevision(
    card: string,
    chain: string,
    revision: string,
    s: AbortSignal,
  ): Promise<void>;
  deleteChain(card: string, chain: string, s: AbortSignal): Promise<void>;
  close(): void;
}
export function createPrescriptionApi(
  initialToken: string,
  fetchImpl: typeof fetch = fetch,
  onUnauthorized: () => void = () => {},
  timeoutMs = 30000,
): PrescriptionApi {
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
  function path(card: string, chain?: string, revision?: string) {
    const parts = [
      card,
      ...(chain !== undefined ? [chain] : []),
      ...(revision !== undefined ? [revision] : []),
    ];
    if (!parts.every((v) => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(v)))
      throw new ApiError("InvalidResponse");
    return `/medical-records/${encodeURIComponent(card)}/prescription-chains${chain !== undefined ? `/${encodeURIComponent(chain)}` : ""}${revision !== undefined ? `/${encodeURIComponent(revision)}` : ""}`;
  }
  async function send(
    url: string,
    method: "POST" | "PATCH" | "DELETE",
    external: AbortSignal,
    body?: unknown,
  ) {
    if (closed || !token || external.aborted) throw new ApiError("Cancelled");
    const c = new AbortController();
    running.add(c);
    const abort = () => c.abort();
    external.addEventListener("abort", abort, { once: true });
    let timeout = false;
    const timer = setTimeout(() => {
      timeout = true;
      c.abort();
    }, timeoutMs);
    try {
      const response = await fetchImpl(API + url, {
        method,
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: c.signal,
      });
      if (response.status === 401) {
        close();
        onUnauthorized();
        throw new ApiError("Unauthorized", 401);
      }
      if (response.status === 403) throw new ApiError("Forbidden", 403);
      if (response.status !== 200) throw new ApiError("Http", response.status);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(
        timeout
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
  return {
    create: (c, b, s) => send(path(c), "POST", s, b),
    addRevision: (c, ch, b, s) => send(path(c, ch), "POST", s, b),
    finish: (c, ch, r, end, s) =>
      send(path(c, ch, r) + "/finish", "PATCH", s, { end }),
    deleteRevision: (c, ch, r, s) => send(path(c, ch, r), "DELETE", s),
    deleteChain: (c, ch, s) => send(path(c, ch), "DELETE", s),
    close,
  };
}
