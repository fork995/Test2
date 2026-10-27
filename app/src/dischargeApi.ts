import { API, ApiError } from "./api";
import { normalizePatients, obj, type Patient } from "./model";
import { isFinishResult, type FinishResult } from "./finishResults";

export interface DischargeApi {
  patient(
    branch: string,
    patient: string,
    signal: AbortSignal,
  ): Promise<Patient>;
  finish(
    card: string,
    end: string,
    signal: AbortSignal,
    result?: FinishResult,
  ): Promise<void>;
  close(): void;
}
const validId = (id: string) => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id);
/** Original gA.byIdInCurrentBranch + Mc.finishTreatment. No general mutation API. */
export function createDischargeApi(
  initialToken: string,
  fetchImpl: typeof fetch = fetch,
  onUnauthorized: () => void = () => {},
  timeoutMs = 30000,
): DischargeApi {
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
  async function request(
    path: string,
    external: AbortSignal,
    end?: string,
    result: FinishResult = "DISCHARGED",
  ) {
    if (closed || !token || external.aborted) throw new ApiError("Cancelled");
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
      const response = await fetchImpl(API + path, {
        method: end === undefined ? "GET" : "PATCH",
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(end === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(end === undefined ? {} : { body: JSON.stringify({ result, end }) }),
        signal: controller.signal,
      });
      if (response.status === 401) {
        close();
        onUnauthorized();
        throw new ApiError("Unauthorized", 401);
      }
      if (response.status === 403) throw new ApiError("Forbidden", 403);
      if (response.status !== 200) throw new ApiError("Http", response.status);
      if (end !== undefined) return;
      const raw: unknown = await response.json();
      if (controller.signal.aborted || closed) throw new ApiError("Cancelled");
      if (!obj(raw).card) throw new ApiError("InvalidResponse");
      const patient = normalizePatients([raw])[0];
      if (!patient?.cardId) throw new ApiError("InvalidResponse");
      return patient;
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
  }
  return {
    patient: async (branch, patient, signal) => {
      if (![branch, patient].every(validId))
        throw new ApiError("InvalidResponse");
      return (await request(
        `/branches/${encodeURIComponent(branch)}/patients/${encodeURIComponent(patient)}`,
        signal,
      ))!;
    },
    finish: async (card, end, signal, result = "DISCHARGED") => {
      if (
        !validId(card) ||
        !isFinishResult(result) ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(end) ||
        !Number.isFinite(Date.parse(end))
      )
        throw new ApiError("InvalidResponse");
      await request(
        `/medical-records/${encodeURIComponent(card)}/finish`,
        signal,
        end,
        result,
      );
    },
    close,
  };
}
