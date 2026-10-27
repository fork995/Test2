import { API, ApiError } from "./api";
import {
  ResultWriteError,
  type ResultPayload,
  type ResultTransport,
} from "./resultWriter";
// Deliberately no generic request API: only execution-result PUT / DELETE.
export function createResultTransport(
  initialToken: string,
  fetchImpl: typeof fetch = fetch,
  onUnauthorized: () => void = () => {},
  timeoutMs = 30000,
): ResultTransport {
  let token = initialToken,
    closed = false;
  initialToken = "";
  const running = new Set<AbortController>();
  async function send(
    card: string,
    revision: string,
    id: string,
    signal: AbortSignal,
    payload?: ResultPayload,
  ) {
    if (closed || !token || signal.aborted) throw new ApiError("Cancelled");
    if (
      ![card, revision, id].every((x) =>
        /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(x),
      )
    )
      throw new ResultWriteError("Unavailable");
    const controller = new AbortController();
    running.add(controller);
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const response = await fetchImpl(
        `${API}/medical-records/${encodeURIComponent(card)}/prescriptions/${encodeURIComponent(revision)}/execution-results/${encodeURIComponent(id)}`,
        {
          method: payload ? "PUT" : "DELETE",
          mode: "cors",
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
          referrerPolicy: "no-referrer",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            ...(payload ? { "Content-Type": "application/json" } : {}),
          },
          ...(payload ? { body: JSON.stringify(payload) } : {}),
          signal: controller.signal,
        },
      );
      if (response.status === 401) {
        close();
        onUnauthorized();
        throw new ApiError("Unauthorized", 401);
      }
      if (response.status === 403) throw new ApiError("Forbidden", 403);
      if ([409, 412].includes(response.status))
        throw new ApiError("Http", response.status);
      if (![200, 201, 204].includes(response.status))
        throw new ApiError("Http", response.status);
      // Do not inspect arbitrary response bodies. Fresh GET is the source of truth.
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        timedOut
          ? "Timeout"
          : controller.signal.aborted
            ? "Cancelled"
            : error instanceof TypeError
              ? "NetworkOrCors"
              : "Unexpected",
      );
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      running.delete(controller);
    }
  }
  function close() {
    closed = true;
    token = "";
    running.forEach((c) => c.abort());
    running.clear();
  }
  return {
    put: (c, r, p, s) => send(c, r, p.id, s, p),
    remove: (c, r, id, s) => send(c, r, id, s),
    close,
  };
}
