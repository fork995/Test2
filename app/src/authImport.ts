const IMPORT_PARAMETER = "importAuth";

export function authImportRequested(search = location.search): boolean {
  return new URLSearchParams(search).get(IMPORT_PARAMETER) === "1";
}

export function clearAuthImportParameter() {
  const url = new URL(location.href);
  if (!url.searchParams.has(IMPORT_PARAMETER)) return;
  url.searchParams.delete(IMPORT_PARAMETER);
  history.replaceState(
    history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
}

/** Reads only the non-secret exp claim. The token itself is never retained here. */
export function jwtExpiresAt(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || !parts[1]) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded)) as { exp?: unknown };
    return typeof payload.exp === "number" &&
      Number.isFinite(payload.exp) &&
      payload.exp > 0
      ? Math.trunc(payload.exp * 1000)
      : null;
  } catch {
    return null;
  }
}

export function tokenExpiryWarning(expiresAt: number | null, now = Date.now()) {
  if (expiresAt === null) return "";
  const remaining = expiresAt - now;
  if (remaining <= 0)
    return "Срок действия токена истёк. Откройте оригинальный CleverVet и снова запустите команду.";
  if (remaining <= 30 * 60 * 1000)
    return `Токен истекает менее чем через ${Math.max(1, Math.ceil(remaining / 60000))} мин. Приготовьтесь повторно запустить команду CleverVet.`;
  return "";
}

export function clipboardReadMessage(error: unknown) {
  let name = "";
  try {
    if (error !== null && typeof error === "object" && "name" in error)
      name = String(error.name);
  } catch {
    /* Ignore unsafe error accessors and never expose their values. */
  }
  return name === "NotAllowedError"
    ? "Safari не разрешил чтение буфера. Разрешите доступ или выберите «Ввести токен вручную»."
    : "Не удалось прочитать буфер обмена. Выберите «Ввести токен вручную».";
}
