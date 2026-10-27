import { flushSync } from "react-dom";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { type Branch } from "./model";
import { type Source } from "./source";
import { createDemoSession, createSessionApi } from "./session";
import { ApiError, safeError } from "./api";
import { Workspace } from "./Workspace";
import { ErrorBox } from "./ui";
import {
  authImportRequested,
  clearAuthImportParameter,
  clipboardReadMessage,
  jwtExpiresAt,
  tokenExpiryWarning,
} from "./authImport";
import {
  parseStayAuthTransfer,
  requestStayAuth,
  STAY_BRIDGE_READY_EVENT,
  STAY_TOKEN_EVENT,
} from "./stayAuth";

type AuthOrigin = "manual" | "clipboard" | "stay" | "demo";

function expiredSessionMessage(origin: AuthOrigin) {
  if (origin === "stay")
    return "Срок действия сеанса истёк. Откройте оригинальный CleverVet, затем снова откройте Test2.";
  if (origin === "clipboard")
    return "Срок действия токена истёк. Откройте оригинальный CleverVet и снова запустите команду.";
  return "Срок действия токена истёк. Подключитесь заново.";
}

export function App() {
  const [session, setSession] = useState<{
    source: Source;
    branches: Branch[];
    expiresAt: number | null;
    expiryWarning: string;
    startOnPatients: boolean;
    authOrigin: AuthOrigin;
  } | null>(null);
  const [message, setMessage] = useState("");
  const [quickAuth, setQuickAuth] = useState(authImportRequested);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const logout = useCallback(
    (message = "Сеанс завершён. Токен и оперативные данные очищены.") => {
      sessionRef.current?.source.close();
      sessionRef.current = null;
      setSession(null);
      setMessage(message);
    },
    [],
  );
  useEffect(() => {
    const onHide = () => flushSync(() => logout());
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      sessionRef.current?.source.close();
    };
  }, [logout]);
  useEffect(() => {
    if (!session?.expiresAt) return;
    let timer = 0;
    const arm = () => {
      const remaining = session.expiresAt! - Date.now();
      if (remaining <= 0) {
        logout(expiredSessionMessage(session.authOrigin));
        return;
      }
      timer = window.setTimeout(arm, Math.min(remaining, 2_147_000_000));
    };
    arm();
    return () => window.clearTimeout(timer);
  }, [logout, session?.expiresAt]);
  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-icon" aria-hidden="true">
            CV
          </span>
          <div>
            <b>
              CleverVet <span className="brand-light">Mobile</span>
            </b>
            <small>СТАЦИОНАР · v0.5.1</small>
          </div>
        </div>
        <span className="read-badge">Просмотр / отметки</span>
      </header>
      {session ? (
        <>
          {session.expiryWarning && (
            <p className="auth-expiry-warning" role="status">
              {session.expiryWarning}
            </p>
          )}
          <Workspace
            source={session.source}
            branches={session.branches}
            initialTab={session.startOnPatients ? "patients" : undefined}
            onLogout={() => logout()}
            onExpire={(message) =>
              logout(message ?? expiredSessionMessage(session.authOrigin))
            }
          />
        </>
      ) : (
        <Connect
          message={message}
          quickAuth={quickAuth}
          onManual={() => {
            clearAuthImportParameter();
            setQuickAuth(false);
          }}
          onConnect={(source, branches, expiresAt, authOrigin) => {
            clearAuthImportParameter();
            setQuickAuth(false);
            setMessage("");
            setSession({
              source,
              branches,
              expiresAt,
              expiryWarning: tokenExpiryWarning(expiresAt),
              startOnPatients:
                authOrigin === "clipboard" || authOrigin === "stay",
              authOrigin,
            });
          }}
        />
      )}
    </div>
  );
}
function Connect({
  message,
  quickAuth,
  onManual,
  onConnect,
}: {
  message: string;
  quickAuth: boolean;
  onManual: () => void;
  onConnect: (
    s: Source,
    b: Branch[],
    expiresAt: number | null,
    authOrigin: AuthOrigin,
  ) => void;
}) {
  const input = useRef<HTMLInputElement>(null),
    pending = useRef<Source | null>(null),
    sequence = useRef(0),
    busyRef = useRef(false),
    stayAttempted = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [big, setBig] = useState(false);
  const cancel = () => {
    sequence.current++;
    pending.current?.close();
    pending.current = null;
    busyRef.current = false;
    if (input.current) input.current.value = "";
    setBusy(false);
    setError("");
  };
  useEffect(() => {
    const clear = () => {
      sequence.current++;
      pending.current?.close();
      pending.current = null;
      if (input.current) input.current.value = "";
    };
    window.addEventListener("pagehide", clear);
    return () => {
      window.removeEventListener("pagehide", clear);
      clear();
    };
  }, []);
  async function connectToken(
    token: string,
    origin: AuthOrigin,
    transferredExpiresAt: number | null = null,
  ) {
    const demo = origin === "demo";
    const quick = origin === "clipboard";
    const stay = origin === "stay";
    token = token.trim().replace(/^Bearer\s+/i, "");
    if (!demo && (!token || /\s/.test(token))) {
      setError(
        quick
          ? "В буфере нет корректного токена CleverVet."
          : stay
            ? "Stay передал некорректные данные авторизации. Откройте оригинальный CleverVet и обновите страницу."
            : "Введите Bearer JWT без пробелов.",
      );
      return;
    }
    const jwtExpiry = demo ? null : jwtExpiresAt(token);
    const expiresAt = demo
      ? null
      : transferredExpiresAt === null
        ? jwtExpiry
        : jwtExpiry === null
          ? transferredExpiresAt
          : Math.min(jwtExpiry, transferredExpiresAt);
    if (!demo && expiresAt !== null && expiresAt <= Date.now()) {
      token = "";
      setError(tokenExpiryWarning(expiresAt));
      return;
    }
    const current = ++sequence.current;
    busyRef.current = true;
    setBusy(true);
    setError("");
    const source = demo ? createDemoSession(big) : createSessionApi(token);
    token = "";
    pending.current = source;
    try {
      const branches = await source.branches();
      if (current !== sequence.current) {
        source.close();
        return;
      }
      pending.current = null;
      onConnect(source, branches, expiresAt, origin);
    } catch (error) {
      source.close();
      if (current === sequence.current)
        setError(
          (quick || stay) &&
            error instanceof ApiError &&
            (error.kind === "Unauthorized" || error.kind === "Forbidden")
            ? stay
              ? "Сеанс CleverVet недействителен или истёк. Откройте оригинальный CleverVet, затем снова откройте Test2."
              : "Токен недействителен или истёк. Откройте оригинальный CleverVet и снова запустите команду."
            : safeError(error),
        );
    } finally {
      if (current === sequence.current) {
        pending.current = null;
        busyRef.current = false;
        setBusy(false);
      }
    }
  }
  async function connect(event?: FormEvent, demo = false) {
    event?.preventDefault();
    if (busy) return;
    let token = input.current?.value || "";
    if (input.current) input.current.value = "";
    await connectToken(token, demo ? "demo" : "manual");
    token = "";
  }
  async function importClipboard() {
    if (busy) return;
    if (!navigator.clipboard?.readText) {
      setError(
        "Safari не поддерживает чтение буфера на этой странице. Выберите «Ввести токен вручную».",
      );
      return;
    }
    try {
      let token = (await navigator.clipboard.readText()).trim();
      await connectToken(token, "clipboard");
      token = "";
    } catch (error) {
      setError(clipboardReadMessage(error));
    }
  }
  useEffect(() => {
    const receive = (event: Event) => {
      if (stayAttempted.current || busyRef.current) return;
      const transfer = parseStayAuthTransfer((event as CustomEvent).detail);
      if (!transfer) return;
      stayAttempted.current = true;
      void connectToken(transfer.token, "stay", transfer.expiresAt);
    };
    const bridgeReady = () => requestStayAuth();
    window.addEventListener(STAY_TOKEN_EVENT, receive);
    window.addEventListener(STAY_BRIDGE_READY_EVENT, bridgeReady);
    requestStayAuth();
    return () => {
      window.removeEventListener(STAY_TOKEN_EVENT, receive);
      window.removeEventListener(STAY_BRIDGE_READY_EVENT, bridgeReady);
    };
  }, []);
  return (
    <main className="connect-page">
      <p className="eyebrow">Мобильное рабочее место</p>
      <h1>
        Назначения.
        <br />
        <span>Всё перед глазами.</span>
      </h1>
      <p className="intro">
        Пациенты, история назначений и результаты по часам — в одном удобном
        окне.
      </p>
      <section className="panel connect-card">
        <div className="section-title">
          <h2>{quickAuth ? "Быстрый вход" : "Подключение к CleverVet"}</h2>
          <span className="tiny-dot" />
        </div>
        <p className="muted">
          {quickAuth
            ? "Токен CleverVet скопирован. Нажмите, чтобы войти."
            : "Прямое подключение к API. Редактирование отметок включено по умолчанию; его можно отключить в настройках."}
        </p>
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        {quickAuth ? (
          <div className="quick-auth-actions">
            <button
              type="button"
              className="primary full"
              disabled={busy}
              onClick={() => void importClipboard()}
            >
              {busy ? "Проверка токена…" : "Войти с токеном из буфера"}
            </button>
            <button
              type="button"
              className="quiet full"
              disabled={busy}
              onClick={() => {
                setError("");
                onManual();
              }}
            >
              Ввести токен вручную
            </button>
          </div>
        ) : (
          <form onSubmit={(e) => void connect(e)}>
            <label htmlFor="jwt">Bearer JWT</label>
            <input
              id="jwt"
              ref={input}
              type="password"
              placeholder="Вставьте токен доступа"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={busy}
            />
            <p className="micro">
              Токен только в памяти вкладки. После обновления страницы
              потребуется повторный вход.
            </p>
            <button type="submit" className="primary full" disabled={busy}>
              {busy ? "Подключение…" : "Подключиться →"}
            </button>
            <button type="button" className="quiet full" onClick={cancel}>
              Очистить токен{busy ? " и отменить" : ""}
            </button>
          </form>
        )}
        {error && <ErrorBox message={error} />}
        <p className="micro">
          Не передавайте токен в чат или GitHub. При подключении он отправляется
          только backend.clevervet.tech по HTTPS.
        </p>
      </section>
      <section className="demo-card">
        <div>
          <h2>Сначала познакомиться</h2>
          <p className="micro">
            Обезличенные примеры. Без токена и запросов к API.
          </p>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={big}
            onChange={(e) => setBig(e.target.checked)}
          />
          Большой набор: 360 назначений
        </label>
        <button
          className="secondary full"
          disabled={busy}
          onClick={() => void connect(undefined, true)}
        >
          Открыть демо
        </button>
      </section>
      <footer>
        iPhone / Safari · токен и медицинские данные только в памяти
      </footer>
    </main>
  );
}
