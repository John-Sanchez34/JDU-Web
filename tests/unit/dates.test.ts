import { describe, expect, it } from "vitest";
import { daysSince, formatDayOfWeek, todayIso } from "@/lib/dates";

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

describe("daysSince", () => {
  it("counts whole UTC days between two dates", () => {
    const now = new Date("2026-09-15T09:00:00Z");
    expect(daysSince(new Date("2026-09-15T08:00:00Z"), now)).toBe(0);
    expect(daysSince(new Date("2026-09-14T23:59:00Z"), now)).toBe(1);
    expect(daysSince(new Date("2026-09-01T12:00:00Z"), now)).toBe(14);
  });

  it("counts calendar days, not elapsed hours", () => {
    // Two hours apart, but either side of UTC midnight: that is one day.
    const now = new Date("2026-09-15T01:00:00Z");
    expect(daysSince(new Date("2026-09-14T23:00:00Z"), now)).toBe(1);
  });

  it("treats a future date as zero rather than going negative", () => {
    const now = new Date("2026-09-15T09:00:00Z");
    expect(daysSince(new Date("2026-09-20T09:00:00Z"), now)).toBe(0);
  });
});
