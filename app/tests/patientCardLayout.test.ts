import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/style.css"), "utf8");

it("keeps the approved two-column patient-card layout on narrow iPhones", () => {
  expect(css).toMatch(
    /\.patient-list\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s,
  );
  expect(css).toMatch(
    /\.patient-card-photo\s*\{[^}]*aspect-ratio:\s*2\s*\/\s*1/s,
  );
  expect(css).toMatch(
    /\.patient-card-diagnosis\s*\{[^}]*-webkit-line-clamp:\s*2/s,
  );
  expect(css).toMatch(/@media\s*\(max-width:\s*360px\)/);
  expect(css).not.toMatch(/\.patient-(?:list|tile|card)[^{]*\{[^}]*transform:\s*scale/s);
});

it("keeps card counters horizontal and the menu over the photo", () => {
  expect(css).toMatch(
    /\.patient-card-counters\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s,
  );
  expect(css).toMatch(
    /\.patient-card-counters\s*>\s*span\s*\{[^}]*white-space:\s*nowrap/s,
  );
  expect(css).toMatch(
    /\.patient-card-menu\s*\{[^}]*position:\s*absolute[^}]*top:\s*7px[^}]*right:\s*7px/s,
  );
});
