import { API, ApiError } from "./api";
export interface Location {
  branchId: string;
  departmentId: string;
}
export interface TransferApi {
  move(
    from: Location,
    patientId: string,
    to: Location,
    signal: AbortSignal,
  ): Promise<void>;
  close(): void;
}
/** Original Mv.movetoBranch / fA: change patient's branch/department, not its medical card. */
export function createTransferApi(
  initialToken: string,
  fetchImpl: typeof fetch = fetch,
  onUnauthorized: () => void = () => {},
  timeoutMs = 30000,
): TransferApi {
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
  return {
    async move(from, patientId, to, external) {
      if (closed || !token || external.aborted) throw new ApiError("Cancelled");
      if (
        ![
          from.branchId,
          from.departmentId,
          patientId,
          to.branchId,
          to.departmentId,
        ].every((id) => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id)) ||
        (from.branchId === to.branchId && from.departmentId === to.departmentId)
      )
        throw new ApiError("InvalidResponse");
      const controller = new AbortController();
      running.add(controller);
      const abort = () => controller.abort();
      external.addEventListener("abort", abort, { once: true });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      try {
        const response = await fetchImpl(
          `${API}/branches/${encodeURIComponent(from.branchId)}/departments/${encodeURIComponent(from.departmentId)}/patients/${encodeURIComponent(patientId)}/branch`,
          {
            method: "PATCH",
            mode: "cors",
            credentials: "omit",
            cache: "no-store",
            redirect: "error",
            referrerPolicy: "no-referrer",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              id: to.branchId,
              department: to.departmentId,
            }),
            signal: controller.signal,
          },
        );
        if (response.status === 401) {
          close();
          onUnauthorized();
          throw new ApiError("Unauthorized", 401);
        }
        if (response.status === 403) throw new ApiError("Forbidden", 403);
        if (![200, 204].includes(response.status))
          throw new ApiError("Http", response.status);
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
        external.removeEventListener("abort", abort);
        running.delete(controller);
      }
    },
    close,
  };
}
