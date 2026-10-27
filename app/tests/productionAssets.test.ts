import { it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
it("production checker rejects the exact missing-assets failure and checks dynamic dependencies", () => {
  const root = mkdtempSync(join(tmpdir(), "cv-assets-"));
  const checker = new URL("../../tools/check-production.mjs", import.meta.url)
    .pathname;
  try {
    writeFileSync(
      join(root, "index.html"),
      '<script type="module" src="./assets/entry.js"></script>',
    );
    expect(() =>
      execFileSync(process.execPath, [checker, root], { stdio: "pipe" }),
    ).toThrow();
    mkdirSync(join(root, "assets"));
    writeFileSync(
      join(root, "assets/entry.js"),
      'import("./main.js");const files=["./main.css"]',
    );
    expect(() =>
      execFileSync(process.execPath, [checker, root], { stdio: "pipe" }),
    ).toThrow();
    writeFileSync(join(root, "assets/main.js"), "export const x=1");
    writeFileSync(join(root, "assets/main.css"), "body{}");
    expect(
      execFileSync(process.execPath, [checker, root]).toString(),
    ).toContain("3 files verified");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
