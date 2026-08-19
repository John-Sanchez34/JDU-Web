import { describe, expect, it } from "vitest";
import { addDaysIso, weekBounds } from "@/lib/week";

describe("addDaysIso", () => {
  it("adds days across a month boundary", () => {
    expect(addDaysIso("2026-09-29", 3)).toBe("2026-10-02");
  });

  it("subtracts days across a year boundary", () => {
    expect(addDaysIso("2027-01-02", -3)).toBe("2026-12-30");
  });

  it("handles a leap day", () => {
    expect(addDaysIso("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("weekBounds", () => {
  it("returns Sunday through Saturday for a midweek date", () => {
    // 2026-09-02 is a Wednesday.
    expect(weekBounds("2026-09-02")).toEqual({
      from: "2026-08-30",
      to: "2026-09-05",
    });
  });

  it("returns the same week when given its Sunday", () => {
    expect(weekBounds("2026-08-30")).toEqual({
      from: "2026-08-30",
      to: "2026-09-05",
    });
  });

  it("returns the same week when given its Saturday", () => {
    expect(weekBounds("2026-09-05")).toEqual({
      from: "2026-08-30",
      to: "2026-09-05",
    });
  });
});
