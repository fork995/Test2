import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
export function checkProduction(directory) {
  const html = readFileSync(resolve(directory, "index.html"), "utf8");
  const refs = [
    ...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/g),
  ].map((m) => m[1]);
  if (!refs.some((p) => p.endsWith(".js")))
    throw new Error("Missing JavaScript entry");
  const checked = new Set();
  function check(ref, base) {
    if (/^(?:https?:|\/\/|\/)/.test(ref))
      throw new Error("Nonrelative production asset");
    const path = resolve(base, ref);
    if (!path.startsWith(resolve(directory) + "/") || !existsSync(path))
      throw new Error(`Missing production asset: ${ref}`);
    if (checked.has(path)) return;
    checked.add(path);
    if (path.endsWith(".js")) {
      const code = readFileSync(path, "utf8");
      for (const m of code.matchAll(
        /["']((?:\.\/)?assets\/[A-Za-z0-9_-]+\.(?:js|css))["']/g,
      ))
        check(m[1], resolve(directory));
      for (const m of code.matchAll(
        /["'](\.\/[A-Za-z0-9_-]+\.(?:js|css))["']/g,
      ))
        check(m[1], dirname(path));
    }
  }
  refs.forEach((ref) => check(ref, resolve(directory)));
  return checked.size;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === new URL(import.meta.url).pathname
) {
  const n = checkProduction(process.argv[2] ?? "app/dist");
  console.log(`Production asset check: ${n} files verified`);
}
