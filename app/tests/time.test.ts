import { it, expect } from "vitest";
import {
  HOUR,
  zonedStart,
  shiftClock,
  currentShiftKey,
  hours,
  addDay,
  formatTime,
  validZone,
} from "../src/time";
it("starts a 24h window at branch shift, not midnight", () => {
  const start = zonedStart("2026-10-18", "08:00", "Europe/Moscow")!;
  expect(new Date(start).toISOString()).toBe("2026-10-18T05:00:00.000Z");
  expect(hours(start)).toHaveLength(24);
  expect(hours(start)[23] - start).toBe(23 * HOUR);
  expect(formatTime(start, "Europe/Moscow")).toBe("08:00");
});
it("before shift start, current shift belongs to the previous local calendar date", () => {
  expect(
    currentShiftKey(
      Date.parse("2026-10-18T03:00:00Z"),
      "08:00",
      "Europe/Moscow",
    ),
  ).toBe("2026-10-17");
});
it("calendar navigation crosses months and years without UTC/local mixing", () => {
  expect(addDay("2026-12-31", 1)).toBe("2027-01-01");
  expect(addDay("2026-03-01", -1)).toBe("2026-02-28");
});
it("parses shift clock only if supported, and converts ISO to selected zone", () => {
  expect(shiftClock("08:30:00", "UTC")).toBe("08:30");
  expect(shiftClock("2026-10-18T05:00:00Z", "Europe/Moscow")).toBe("08:00");
  expect(shiftClock("28800", "UTC")).toBeNull();
  expect(shiftClock("25:00", "UTC")).toBeNull();
});
it("rejects invalid zones", () => {
  expect(validZone("Europe/Moscow")).toBe(true);
  expect(validZone("Not/AZone")).toBe(false);
});
it("DST nonexistent and ambiguous times require explicit correction", () => {
  expect(zonedStart("2026-03-08", "02:30", "America/New_York")).toBeNull();
  expect(zonedStart("2026-11-01", "01:30", "America/New_York")).toBeNull();
  expect(zonedStart("2026-03-08", "08:00", "America/New_York")).not.toBeNull();
});
it("honors actual sheet end, including a short last hour", () => {
  const start = Date.parse("2026-10-18T08:15:00Z");
  expect(hours(start, start + 2.5 * HOUR)).toEqual([
    start,
    start + HOUR,
    start + 2 * HOUR,
  ]);
});
