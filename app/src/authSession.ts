import { jwtExpiresAt } from "./authImport";

export const AUTH_SESSION_KEY = "clevervet.mobile.auth-session.v1";
const VERSION = 1 as const;
const MAX_TOKEN_LENGTH = 16_384;

export interface SavedAuthSession {
  version: typeof VERSION;
  accessToken: string;
  expiresAt: number | null;
}

export interface RestoredAuthSession {
  session: SavedAuthSession | null;
  storageAvailable: boolean;
  discarded: boolean;
}

function validToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_TOKEN_LENGTH &&
    !/\s/.test(value)
  );
}

function effectiveExpiry(token: string, value: unknown): number | null | false {
  const stored =
    value === null
      ? null
      : typeof value === "number" && Number.isFinite(value) && value > 0
        ? Math.trunc(value)
        : false;
  if (stored === false) return false;
  const jwt = jwtExpiresAt(token);
  if (stored === null) return jwt;
  return jwt === null ? stored : Math.min(stored, jwt);
}

export function isSessionExpired(
  session: Pick<SavedAuthSession, "expiresAt">,
  now = Date.now(),
): boolean {
  return session.expiresAt !== null && session.expiresAt <= now;
}

export function saveSession(
  accessToken: string,
  expiresAt: number | null,
): { saved: boolean; session: SavedAuthSession } {
  const token = accessToken.trim().replace(/^Bearer\s+/i, "");
  if (!validToken(token)) throw new TypeError("Invalid session token");
  const boundedExpiry = effectiveExpiry(token, expiresAt);
  if (boundedExpiry === false) throw new TypeError("Invalid session expiry");
  const session: SavedAuthSession = {
    version: VERSION,
    accessToken: token,
    expiresAt: boundedExpiry,
  };
  try {
    localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
    return { saved: true, session };
  } catch {
    return { saved: false, session };
  }
}

export function clearSession(): boolean {
  try {
    localStorage.removeItem(AUTH_SESSION_KEY);
    return true;
  } catch {
    return false;
  }
}

export function restoreSession(now = Date.now()): RestoredAuthSession {
  let raw: string | null;
  try {
    raw = localStorage.getItem(AUTH_SESSION_KEY);
  } catch {
    return { session: null, storageAvailable: false, discarded: false };
  }
  if (raw === null)
    return { session: null, storageAvailable: true, discarded: false };
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      value.version !== VERSION ||
      !validToken(value.accessToken)
    )
      throw new TypeError("Invalid saved session");
    const expiresAt = effectiveExpiry(value.accessToken, value.expiresAt);
    if (expiresAt === false) throw new TypeError("Invalid saved expiry");
    const session: SavedAuthSession = {
      version: VERSION,
      accessToken: value.accessToken,
      expiresAt,
    };
    if (isSessionExpired(session, now)) {
      clearSession();
      return { session: null, storageAvailable: true, discarded: true };
    }
    return { session, storageAvailable: true, discarded: false };
  } catch {
    clearSession();
    return { session: null, storageAvailable: true, discarded: true };
  }
}

export function isSessionStorageEvent(event: StorageEvent): boolean {
  return (
    event.key === AUTH_SESSION_KEY &&
    event.newValue === null
  );
}
