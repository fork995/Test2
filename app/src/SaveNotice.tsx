import { useEffect } from "react";
/** Out-of-flow, one-line acknowledgement; errors keep their separate visible alerts. */
export function SaveNotice({
  message,
  onExpire,
}: {
  message: string;
  onExpire: () => void;
}) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onExpire, 5000);
    return () => clearTimeout(timer);
  }, [message, onExpire]);
  return message ? (
    <p className="save-notice" role="status" aria-live="polite">
      {message}
    </p>
  ) : null;
}
