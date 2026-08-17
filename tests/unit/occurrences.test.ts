import { describe, expect, it } from "vitest";
import { generateOccurrenceDates } from "@/lib/occurrences";

describe("generateOccurrenceDates", () => {
  it("returns every matching weekday inside the range", () => {
    // 2026-09-01 is a Tuesday.
    const dates = generateOccurrenceDates("2026-09-01", "2026-09-30", "tuesday");
    expect(dates).toEqual([
      "2026-09-01",
      "2026-09-08",
      "2026-09-15",
      "2026-09-22",
      "2026-09-29",
    ]);
  });

  it("skips forward when the range starts before the first matching day", () => {
    const dates = generateOccurrenceDates("2026-09-01", "2026-09-30", "friday");
    expect(dates[0]).toBe("2026-09-04");
    expect(dates).toHaveLength(4);
  });

  it("includes the end date when it falls on the target weekday", () => {
    const dates = generateOccurrenceDates("2026-09-01", "2026-09-08", "tuesday");
    expect(dates).toEqual(["2026-09-01", "2026-09-08"]);
  });

  it("returns an empty array when no matching day falls in the range", () => {
    expect(generateOccurrenceDates("2026-09-01", "2026-09-03", "sunday")).toEqual([]);
  });

  it("crosses month and year boundaries", () => {
    const dates = generateOccurrenceDates("2026-12-28", "2027-01-11", "monday");
    expect(dates).toEqual(["2026-12-28", "2027-01-04", "2027-01-11"]);
  });

  it("handles a leap day correctly", () => {
    // 2028-02-29 is a Tuesday.
    const dates = generateOccurrenceDates("2028-02-22", "2028-03-07", "tuesday");
    expect(dates).toEqual(["2028-02-22", "2028-02-29", "2028-03-07"]);
  });

  it("is timezone independent", () => {
    // Dates must not shift by a day regardless of the machine's timezone.
    const original = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Kiritimati"; // UTC+14
      const ahead = generateOccurrenceDates("2026-09-01", "2026-09-15", "tuesday");
      process.env.TZ = "Pacific/Midway"; // UTC-11
      const behind = generateOccurrenceDates("2026-09-01", "2026-09-15", "tuesday");
      expect(ahead).toEqual(behind);
      expect(ahead[0]).toBe("2026-09-01");
    } finally {
      process.env.TZ = original;
    }
  });

  it("rejects an end date before the start date", () => {
    expect(() =>
      generateOccurrenceDates("2026-09-30", "2026-09-01", "tuesday"),
    ).toThrow("end date");
  });

  it("rejects a malformed date", () => {
    expect(() =>
      generateOccurrenceDates("September 1", "2026-09-30", "tuesday"),
    ).toThrow("YYYY-MM-DD");
  });
});
