import { useEffect, useRef } from "react";
export function useOptionalRefresh(
  enabled: boolean,
  refresh: () => Promise<void>,
  intervalMs = 60000,
) {
  const callback = useRef(refresh);
  callback.current = refresh;
  useEffect(() => {
    if (!enabled) return;
    let running = false,
      disposed = false;
    const run = async () => {
      if (disposed || running || document.visibilityState === "hidden") return;
      running = true;
      try {
        await callback.current();
      } finally {
        running = false;
      }
    };
    const timer = setInterval(() => {
      void run();
    }, intervalMs);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [enabled, intervalMs]);
}
