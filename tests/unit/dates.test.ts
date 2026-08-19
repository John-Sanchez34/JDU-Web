import { describe, expect, it } from "vitest";
import { formatDayOfWeek, todayIso } from "@/lib/dates";

describe("formatDayOfWeek", () => {
  it("capitalizes each weekday", () => {
    expect(formatDayOfWeek("monday")).toBe("Monday");
    expect(formatDayOfWeek("saturday")).toBe("Saturday");
  });
});

describe("todayIso", () => {
  it("returns a YYYY-MM-DD string", () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("formats a supplied date in UTC", () => {
    expect(todayIso(new Date("2026-09-01T23:30:00Z"))).toBe("2026-09-01");
    expect(todayIso(new Date("2026-09-01T00:30:00Z"))).toBe("2026-09-01");
  });
});
