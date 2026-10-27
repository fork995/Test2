export const STAY_READY_EVENT = "clevervet-mobile:stay-ready:v1";
export const STAY_BRIDGE_READY_EVENT = "clevervet-mobile:stay-bridge-ready:v1";
export const STAY_TOKEN_EVENT = "clevervet-mobile:stay-token:v1";
export const STAY_TRANSFER_MAX_AGE_MS = 3 * 60 * 1000;

export type StayAuthTransfer = {
  version: 1;
  token: string;
  capturedAt: number;
  expiresAt: number;
};

export function parseStayAuthTransfer(
  value: unknown,
  now = Date.now(),
): StayAuthTransfer | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const token =
    typeof candidate.token === "string" ? candidate.token.trim() : "";
  const capturedAt = candidate.capturedAt;
  const expiresAt = candidate.expiresAt;
  if (
    candidate.version !== 1 ||
    !token ||
    token.length > 16_384 ||
    /\s/.test(token) ||
    typeof capturedAt !== "number" ||
    !Number.isFinite(capturedAt) ||
    typeof expiresAt !== "number" ||
    !Number.isFinite(expiresAt)
  )
    return null;
  if (
    capturedAt > now + 30_000 ||
    now - capturedAt > STAY_TRANSFER_MAX_AGE_MS ||
    expiresAt <= now
  )
    return null;
  return { version: 1, token, capturedAt, expiresAt };
}

export function requestStayAuth() {
  window.dispatchEvent(
    new CustomEvent(STAY_READY_EVENT, { detail: { version: 1 } }),
  );
}
