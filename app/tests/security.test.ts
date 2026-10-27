import { it, expect } from "vitest";
import viteConfig from "../vite.config";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const root = new URL("../", import.meta.url).pathname;
const files = readdirSync(join(root, "src")).filter((f) =>
  /\.(tsx?|css)$/.test(f),
);
const source = files
  .map((f) => readFileSync(join(root, "src", f), "utf8"))
  .join("\n");
it("only allowlisted preferences and the minimal auth session can use persistent storage", () => {
  const noPreferences = files
    .filter(
      (f) =>
        ![
          "preferences.ts",
          "authSession.ts",
          "startupDiagnostics.ts",
        ].includes(f),
    )
    .map((f) => readFileSync(join(root, "src", f), "utf8"))
    .join("\n");
  expect(noPreferences).not.toMatch(
    /localStorage|sessionStorage|indexedDB|document\.cookie|console\.|XMLHttpRequest|sendBeacon|WebSocket|serviceWorker|caches\./,
  );
  expect(
    files
      .filter((f) => f !== "startupDiagnostics.ts")
      .map((f) => readFileSync(join(root, "src", f), "utf8"))
      .join("\n"),
  ).not.toMatch(
    /sessionStorage|indexedDB|document\.cookie|console\.|sendBeacon|WebSocket/,
  );
  const diagnostics = readFileSync(
    join(root, "src/startupDiagnostics.ts"),
    "utf8",
  );
  expect(diagnostics).not.toMatch(
    /localStorage|sessionStorage|indexedDB|document\.cookie|error\.(?:message|stack)|JSON\.stringify/,
  );
  expect(source).not.toMatch(/method\s*:\s*['"]OPTIONS/);
  const transport = readFileSync(join(root, "src/resultTransport.ts"), "utf8");
  const rest = files
    .filter(
      (f) =>
        !["resultTransport.ts", "entityApi.ts", "prescriptionApi.ts"].includes(
          f,
        ),
    )
    .map((f) => readFileSync(join(root, "src", f), "utf8"))
    .join("\n");
  expect(rest).not.toMatch(/method\s*:\s*['"](?:PUT|DELETE)/);
  expect(transport).toContain('method: payload ? "PUT" : "DELETE"');
  expect(transport).toContain("/execution-results/");
  const discharge = readFileSync(join(root, "src/dischargeApi.ts"), "utf8");
  expect(discharge).toContain('method: end === undefined ? "GET" : "PATCH"');
  expect(discharge).toContain("/finish`");
  expect(discharge).toContain("isFinishResult(result)");
  expect(discharge).toContain("JSON.stringify({ result, end })");
  const transfer = readFileSync(join(root, "src/transferApi.ts"), "utf8");
  expect(transfer).toContain('method: "PATCH"');
  expect(transfer).toContain(
    "/patients/${encodeURIComponent(patientId)}/branch",
  );
  expect(transfer).toMatch(
    /JSON\.stringify\(\{\s*id: to\.branchId,\s*department: to\.departmentId,?\s*\}\)/,
  );
  const withoutDischarge = files
    .filter(
      (f) =>
        ![
          "dischargeApi.ts",
          "transferApi.ts",
          "entityApi.ts",
          "prescriptionApi.ts",
        ].includes(f),
    )
    .map((f) => readFileSync(join(root, "src", f), "utf8"))
    .join("\n");
  expect(/"PATCH"|"POST"/.test(withoutDischarge)).toBe(false);
  const prescriptions = readFileSync(
    join(root, "src/prescriptionApi.ts"),
    "utf8",
  );
  expect(prescriptions).toContain("/prescription-chains");
  expect(prescriptions).toContain('method: "POST" | "PATCH" | "DELETE"');
  expect(prescriptions).not.toContain('"PUT"');
  expect(prescriptions).not.toContain("/execution-results/");
  const entities = readFileSync(join(root, "src/entityApi.ts"), "utf8");
  expect(entities).toContain("/personal-belongings");
  expect(entities).toContain("createPatient:");
  expect(entities).not.toMatch(/storage\.yandex|fetchImpl\(.*https:/);
  const archive = readFileSync(join(root, "src/archiveApi.ts"), "utf8");
  expect(archive).toContain('method: "GET"');
  expect(archive).not.toMatch(
    /"(?:POST|PUT|PATCH|DELETE)"|response\.(?:json|text)\(/,
  );
  expect(archive).toContain("/archive/medical-records");
  expect(source.match(/fetchImpl\(/g)).toHaveLength(7);
  const authImport = readFileSync(join(root, "src/authImport.ts"), "utf8");
  const stayAuth = readFileSync(join(root, "src/stayAuth.ts"), "utf8");
  const stayUserscript = readFileSync(
    join(root, "../stay/clevervet-mobile-stay.user.js"),
    "utf8",
  );
  const app = readFileSync(join(root, "src/App.tsx"), "utf8");
  expect(authImport).toContain("searchParams.delete(IMPORT_PARAMETER)");
  expect(authImport).toContain("history.replaceState");
  expect(authImport).not.toMatch(
    /localStorage|sessionStorage|document\.cookie|console\.|access_token|refresh_token/,
  );
  expect(app).toContain("navigator.clipboard.readText()");
  expect(app).not.toContain("navigator.clipboard.writeText");
  expect(app).not.toMatch(/searchParams\.(?:set|append).*token/i);
  expect(stayAuth).not.toMatch(
    /localStorage|sessionStorage|document\.cookie|console\.|fetch\(/,
  );
  expect(stayUserscript).not.toMatch(
    /@require|console\.|\bfetch\s*\(|XMLHttpRequest|location\.(?:href|search|hash)\s*=/,
  );
  expect(stayUserscript.match(/^\/\/ @match\s+/gm)).toHaveLength(2);
  expect(stayUserscript).toContain("GM_deleteValue(STORAGE_KEY)");
  const authSession = readFileSync(join(root, "src/authSession.ts"), "utf8");
  expect(authSession).toContain("accessToken");
  expect(authSession).not.toMatch(/refreshToken|refresh_token|password|profile/);
});
it("limits production resources to local assets and the CleverVet API", () => {
  const html = readFileSync(join(root, "index.html"), "utf8");
  expect(html).toContain("connect-src 'self' https://backend.clevervet.tech");
  expect(html).not.toMatch(/<script[^>]+src=["']https?:/);
  expect(html).not.toMatch(/<link[^>]+href=["']https?:/);
  expect(html).toContain(
    "img-src 'self' data: blob: https://storage.yandexcloud.net/clevervet-patient-photos/",
  );
  expect(source).not.toMatch(/https?:\/\/(?!backend\.clevervet\.tech)/);
});
it("uses relative Vite base for GitHub Pages and ships no env files", () => {
  expect(viteConfig.base).toBe("./");
  expect(readdirSync(root).some((f) => f.startsWith(".env"))).toBe(false);
});
it("publication workflow requires a manual dispatch and explicit opt-in", () => {
  const workflow = readFileSync(
    join(root, "..", ".github/workflows/pages.yml"),
    "utf8",
  );
  expect(workflow).toContain("workflow_dispatch:");
  expect(workflow).toContain("if: inputs.publish == true");
  expect(workflow).toContain("default: false");
  expect(workflow).not.toMatch(/^\s+(push|pull_request):/m);
});
