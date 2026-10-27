import {
  normalizeBranches,
  normalizePatients,
  normalizeChains,
  type Chain,
} from "./model";
import {
  diagnosticTypes,
  markFetched,
  receivedAt,
  type Source,
} from "./source";
export const API = "https://backend.clevervet.tech/api";
export type ErrorKind =
  | "Unauthorized"
  | "Forbidden"
  | "Http"
  | "NetworkOrCors"
  | "Timeout"
  | "Cancelled"
  | "InvalidResponse"
  | "Unexpected";
export class ApiError extends Error {
  constructor(
    public readonly kind: ErrorKind,
    public readonly status: number | null = null,
  ) {
    super(kind);
    this.name = "ApiError";
  }
}
export function safeError(error: unknown): string {
  if (!(error instanceof ApiError))
    return "Не удалось завершить действие. Подробности скрыты для защиты данных.";
  const messages: Record<ErrorKind, string> = {
    Unauthorized:
      "Токен недействителен или истёк. Подключитесь заново.",
    Forbidden:
      "Доступ запрещён. Проверьте права пользователя в выбранном филиале и отделении.",
    Http: "Сервер отклонил запрос. Повторите запрос позже.",
    NetworkOrCors:
      "Браузер не смог получить доступ к ответу. Возможные причины: CORS, сеть, TLS или блокировка запроса. CORS этого endpoint ещё может быть не подтверждён.",
    Timeout: "Сервер не ответил за 30 секунд. Попробуйте снова.",
    Cancelled: "Запрос отменён.",
    InvalidResponse:
      "Неожиданный формат ответа API. Ожидается JSON-массив; проверьте контракт endpoint без передачи персональных данных.",
    Unexpected:
      "Не удалось завершить запрос. Подробности скрыты для защиты данных.",
  };
  return messages[error.kind];
}
function remember<T>(
  cache: Map<string, T>,
  key: string,
  value: T,
  limit: number,
) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) cache.delete(cache.keys().next().value!);
}
function mergeChains(chains: Chain[]): Chain[] {
  const map = new Map<string, Chain>();
  for (const chain of chains) {
    const old = map.get(chain.id);
    if (!old) {
      map.set(chain.id, chain);
      continue;
    }
    const elements = new Map(old.elements.map((e) => [e.id, e]));
    for (const e of chain.elements) {
      const before = elements.get(e.id);
      elements.set(
        e.id,
        before
          ? {
              ...before,
              results: [
                ...new Map(
                  [...before.results, ...e.results].map((r) => [r.id, r]),
                ).values(),
              ],
            }
          : e,
      );
    }
    map.set(chain.id, { ...old, elements: [...elements.values()] });
  }
  return [...map.values()];
}
// No generic public request(url, method) API. Only these three GET resources exist.
export function createApi(
  initialToken: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 30000,
): Source {
  let token = initialToken,
    closed = false,
    expired = false;
  initialToken = "";
  const running = new Set<AbortController>();
  const patientCache = new Map<string, ReturnType<typeof normalizePatients>>();
  const cardCache = new Map<string, Chain[]>();
  function close() {
    closed = true;
    token = "";
    patientCache.clear();
    cardCache.clear();
    running.forEach((c) => c.abort());
    running.clear();
  }
  async function get(path: string, external?: AbortSignal): Promise<unknown[]> {
    if (expired) throw new ApiError("Unauthorized", 401);
    if (closed) throw new ApiError("Cancelled");
    const controller = new AbortController();
    running.add(controller);
    const abort = () => controller.abort();
    external?.addEventListener("abort", abort, { once: true });
    if (external?.aborted) abort();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const response = await fetchImpl(API + path, {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      if (response.status === 401) {
        expired = true;
        close();
        throw new ApiError("Unauthorized", 401);
      }
      if (response.status === 403) throw new ApiError("Forbidden", 403);
      if (response.status !== 200) throw new ApiError("Http", response.status);
      let value: unknown;
      try {
        value = await response.json();
      } catch (error) {
        if (controller.signal.aborted || error instanceof TypeError)
          throw error;
        throw new ApiError("InvalidResponse", 200);
      }
      if (controller.signal.aborted || closed) throw new ApiError("Cancelled");
      if (!Array.isArray(value)) throw new ApiError("InvalidResponse", 200);
      return value;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (timedOut) throw new ApiError("Timeout");
      if (controller.signal.aborted) throw new ApiError("Cancelled");
      throw new ApiError(
        error instanceof TypeError ? "NetworkOrCors" : "Unexpected",
      );
    } finally {
      clearTimeout(timer);
      external?.removeEventListener("abort", abort);
      running.delete(controller);
    }
  }
  const check = () => {
    if (expired) throw new ApiError("Unauthorized", 401);
    if (closed) throw new ApiError("Cancelled");
  };
  return {
    demo: false,
    branches: async (signal) =>
      normalizeBranches(await get("/branches", signal)),
    patients: async (branch, department, signal, refresh = false) => {
      check();
      const key = JSON.stringify([branch, department]);
      if (
        !refresh &&
        patientCache.has(key) &&
        Date.now() - (receivedAt(patientCache.get(key)!) ?? 0) < 60000
      )
        return patientCache.get(key)!;
      const data = normalizePatients(
        await get(
          `/branches/${encodeURIComponent(branch)}/departments/${encodeURIComponent(department)}/patients`,
          signal,
        ),
      );
      check();
      remember(patientCache, key, markFetched(data), 4);
      return data;
    },
    chains: async (card, signal, refresh = false, diagnostic = false) => {
      check();
      const key = JSON.stringify([card, diagnostic]);
      if (
        !refresh &&
        cardCache.has(key) &&
        Date.now() - (receivedAt(cardCache.get(key)!) ?? 0) < 60000
      )
        return cardCache.get(key)!;
      const path = `/medical-records/${encodeURIComponent(card)}/prescription-chains`;
      let data: Chain[];
      if (diagnostic) {
        const all: Chain[] = [];
        for (const type of diagnosticTypes)
          all.push(
            ...normalizeChains(await get(`${path}?type=${type}`, signal)),
          );
        data = mergeChains(all);
      } else data = normalizeChains(await get(path, signal));
      check();
      remember(cardCache, key, markFetched(data), 3);
      return data;
    },
    clearCache: () => {
      patientCache.clear();
      cardCache.clear();
    },
    close,
  };
}
