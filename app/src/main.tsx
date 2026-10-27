import { createRoot } from "react-dom/client";
import { Component, useLayoutEffect, type ReactNode } from "react";
import { App } from "./App";
import { showStartupFailure } from "./startup";
import "./style.css";
export class SafetyBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    showStartupFailure("react-render", error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
function Ready({ onReady }: { onReady: () => void }) {
  useLayoutEffect(onReady, [onReady]);
  return null;
}
export function mountApp(onReady: () => void) {
  const element = document.getElementById("root");
  if (!element) throw new Error("Missing root");
  const root = createRoot(element, {
    onCaughtError: () => {},
    onUncaughtError: (error) => showStartupFailure("react-render", error),
  });
  root.render(
    <SafetyBoundary>
      <App />
      <Ready onReady={onReady} />
    </SafetyBoundary>,
  );
  return () => root.unmount();
}
