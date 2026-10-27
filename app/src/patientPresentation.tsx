import type { CSSProperties } from "react";
/** Original hC, patient-card labels and original severity CSS RGB values. */
export const SEVERITIES = {
  CRITICAL: { label: "Критический", rgb: "152 6 26" },
  HIGH_SEVERE: { label: "Крайне тяжёлый", rgb: "252 34 32" },
  SEVERE: { label: "Тяжёлый", rgb: "255 216 0" },
  MODERATE: { label: "Средней тяжести", rgb: "70 155 222" },
  SATISFACTORY: { label: "Удовлетворительный", rgb: "56 229 0" },
} as const;
export function severityLabel(raw: string): string {
  return SEVERITIES[raw as keyof typeof SEVERITIES]?.label ?? raw;
}
export function SeverityBadge({ value }: { value: string }) {
  const known = SEVERITIES[value as keyof typeof SEVERITIES];
  return (
    <span
      className={`severity-badge${known ? " severity-known" : ""}`}
      style={
        known ? ({ "--severity-rgb": known.rgb } as CSSProperties) : undefined
      }
    >
      {severityLabel(value) || "Тяжесть не указана"}
    </span>
  );
}
