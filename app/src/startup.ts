import { reportStartupFailure, type StartupPhase } from "./startupDiagnostics";
export function showStartupFailure(phase: StartupPhase, error?: unknown) {
  const shell = document.getElementById("startup-fallback"),
    root = document.getElementById("root");
  if (shell) shell.hidden = false;
  if (root) {
    root.hidden = true;
    root.dataset.startup = "failed";
  }
  reportStartupFailure(phase, error);
}
export function startApplication(
  load: () => Promise<{ mountApp: (ready: () => void) => unknown }>,
  timeoutMs = 20000,
) {
  let cancelled = false,
    failed = false,
    ready = false;
  const root = document.getElementById("root");
  if (root) {
    root.hidden = false;
    root.dataset.startup = "loading";
  }
  const fail = (phase: StartupPhase, error?: unknown) => {
    if (cancelled || failed) return;
    failed = true;
    clearTimeout(timer);
    showStartupFailure(phase, error);
  };
  const timer = setTimeout(() => {
    if (!ready && root?.dataset.startup !== "failed") fail("timeout");
  }, timeoutMs);
  void Promise.resolve()
    .then(load)
    .then(
      (module) => {
        if (cancelled || failed) return;
        try {
          module.mountApp(() => {
            if (cancelled || failed) return;
            ready = true;
            clearTimeout(timer);
            const shell = document.getElementById("startup-fallback");
            if (shell) shell.hidden = true;
            if (root) {
              root.hidden = false;
              root.dataset.startup = "ready";
            }
          });
        } catch (error) {
          fail("mount", error);
        }
      },
      (error) => fail("module-load", error),
    );
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}
