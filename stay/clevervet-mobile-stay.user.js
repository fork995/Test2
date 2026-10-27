// ==UserScript==
// @name         CleverVet Mobile — автоматический вход в Test2
// @namespace    https://fork995.github.io/Test2/
// @version      1.0.0
// @description  Одноразово передаёт действующий сеанс CleverVet в тестовое мобильное приложение.
// @match        https://www.app.clevervet.tech/*
// @match        https://fork995.github.io/Test2/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";

  const ORIGINAL_ORIGIN = "https://www.app.clevervet.tech";
  const TEST_ORIGIN = "https://fork995.github.io";
  const TEST_PATH = "/Test2/";
  const STORAGE_KEY = "clevervet-mobile:stay-auth:v1";
  const MAX_AGE_MS = 3 * 60 * 1000;
  const CLAIM_TTL_MS = 1_500;
  const READY_EVENT = "clevervet-mobile:stay-ready:v1";
  const BRIDGE_READY_EVENT = "clevervet-mobile:stay-bridge-ready:v1";
  const TOKEN_EVENT = "clevervet-mobile:stay-token:v1";

  async function getStored() {
    try {
      return await GM_getValue(STORAGE_KEY, null);
    } catch {
      return null;
    }
  }

  async function setStored(value) {
    await GM_setValue(STORAGE_KEY, value);
  }

  async function clearStored() {
    try {
      if (typeof GM_deleteValue === "function") {
        await GM_deleteValue(STORAGE_KEY);
      } else {
        await GM_setValue(STORAGE_KEY, null);
      }
    } catch {
      try {
        await GM_setValue(STORAGE_KEY, null);
      } catch {
        // Stay недоступен: обычный экран входа Test2 остаётся рабочим.
      }
    }
  }

  function decodeJwtExpiry(token) {
    try {
      const parts = token.split(".");
      if (parts.length !== 3 || !parts[1]) return null;
      const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
      const payload = JSON.parse(atob(padded));
      return typeof payload.exp === "number" && Number.isFinite(payload.exp)
        ? Math.trunc(payload.exp * 1000)
        : null;
    } catch {
      return null;
    }
  }

  function normalizeExpiry(value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
      return null;
    return Math.trunc(value < 1_000_000_000_000 ? value * 1000 : value);
  }

  function findAuth0Token(now) {
    let best = null;
    try {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (
          !key ||
          !key.startsWith("@@auth0spajs@@") ||
          !key.includes("api.clevervet.tech")
        )
          continue;
        let cached;
        try {
          cached = JSON.parse(localStorage.getItem(key) || "null");
        } catch {
          continue;
        }
        const token = cached?.body?.access_token;
        const cacheExpiry = normalizeExpiry(cached?.expiresAt);
        if (
          typeof token !== "string" ||
          !token ||
          /\s/.test(token) ||
          !cacheExpiry
        )
          continue;
        const jwtExpiry = decodeJwtExpiry(token);
        const expiresAt =
          jwtExpiry === null ? cacheExpiry : Math.min(cacheExpiry, jwtExpiry);
        if (expiresAt <= now + 15_000) continue;
        if (!best || expiresAt > best.expiresAt) best = { token, expiresAt };
      }
    } catch {
      return null;
    }
    return best;
  }

  function validTransfer(value, now) {
    return Boolean(
      value &&
        value.version === 1 &&
        typeof value.token === "string" &&
        value.token.length > 0 &&
        value.token.length <= 16_384 &&
        !/\s/.test(value.token) &&
        typeof value.capturedAt === "number" &&
        Number.isFinite(value.capturedAt) &&
        value.capturedAt <= now + 30_000 &&
        now - value.capturedAt <= MAX_AGE_MS &&
        typeof value.expiresAt === "number" &&
        Number.isFinite(value.expiresAt) &&
        value.expiresAt > now,
    );
  }

  function claimId() {
    if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
    const bytes = new Uint32Array(4);
    crypto.getRandomValues(bytes);
    return [...bytes].map((part) => part.toString(16)).join("-");
  }

  async function captureFromOriginal() {
    let attempts = 20;
    let finished = false;
    const attempt = async () => {
      if (finished) return;
      const now = Date.now();
      const found = findAuth0Token(now);
      if (found) {
        finished = true;
        await setStored({
          version: 1,
          token: found.token,
          capturedAt: now,
          expiresAt: found.expiresAt,
        });
        found.token = "";
        return;
      }
      attempts -= 1;
      if (attempts > 0) setTimeout(() => void attempt(), 750);
    };
    await attempt();
  }

  function installTestBridge() {
    let delivered = false;
    let delivering = false;
    let claimRetryScheduled = false;

    const deliver = async () => {
      if (delivered || delivering) return;
      delivering = true;
      try {
        const now = Date.now();
        const stored = await getStored();
        if (!validTransfer(stored, now)) {
          if (stored !== null && stored !== undefined) await clearStored();
          return;
        }
        if (
          typeof stored.claimedAt === "number" &&
          now - stored.claimedAt < CLAIM_TTL_MS
        ) {
          if (!claimRetryScheduled) {
            claimRetryScheduled = true;
            setTimeout(() => {
              claimRetryScheduled = false;
              void deliver();
            }, CLAIM_TTL_MS + 50);
          }
          return;
        }
        const ownClaim = claimId();
        await setStored({ ...stored, claimId: ownClaim, claimedAt: now });
        await new Promise((resolve) => setTimeout(resolve, 100));
        const claimed = await getStored();
        if (claimed?.claimId !== ownClaim) return;
        const transfer = {
          version: 1,
          token: claimed.token,
          capturedAt: claimed.capturedAt,
          expiresAt: claimed.expiresAt,
        };
        await clearStored();
        delivered = true;
        window.dispatchEvent(
          new CustomEvent(TOKEN_EVENT, { detail: transfer }),
        );
        transfer.token = "";
      } catch {
        await clearStored();
      } finally {
        delivering = false;
      }
    };

    window.addEventListener(READY_EVENT, () => void deliver());
    window.dispatchEvent(
      new CustomEvent(BRIDGE_READY_EVENT, { detail: { version: 1 } }),
    );
  }

  if (location.origin === ORIGINAL_ORIGIN) {
    void captureFromOriginal();
  } else if (
    location.origin === TEST_ORIGIN &&
    location.pathname.startsWith(TEST_PATH)
  ) {
    installTestBridge();
  }
})();
