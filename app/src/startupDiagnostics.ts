/** Never log exceptions, messages, URLs, tokens, component stacks or patient data. */
export type StartupPhase = "module-load" | "mount" | "timeout" | "react-render";
export function reportStartupFailure(phase: StartupPhase, error?: unknown) {
  const allowed = new Set([
    "Error",
    "TypeError",
    "SyntaxError",
    "ReferenceError",
    "RangeError",
    "URIError",
    "EvalError",
  ]);
  let type = "UnknownError";
  try {
    if (error instanceof Error && allowed.has(error.name)) type = error.name;
  } catch {
    /* Ignore unsafe exception accessors. */
  }
  console.error("[CleverVet Mobile] Startup failed", {
    code: "CV_STARTUP_FAILED",
    phase,
    errorType: type,
  });
}
