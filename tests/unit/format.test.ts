import { describe, expect, it } from "vitest";
import { formatCents, formatTimeRange } from "@/lib/format";

describe("formatCents", () => {
  it("renders whole dollars", () => {
    expect(formatCents(6500)).toBe("$65.00");
  });

  it("renders cents without floating point drift", () => {
    expect(formatCents(1)).toBe("$0.01");
    expect(formatCents(999)).toBe("$9.99");
    expect(formatCents(123456)).toBe("$1,234.56");
  });

  it("renders zero", () => {
    expect(formatCents(0)).toBe("$0.00");
  });

  it("renders credits as negative amounts", () => {
    expect(formatCents(-2500)).toBe("-$25.00");
  });

  it("rejects non-integer input", () => {
    expect(() => formatCents(65.5)).toThrow("must be an integer");
  });
});

describe("formatTimeRange", () => {
  it("renders a morning class", () => {
    expect(formatTimeRange("09:00:00", "10:00:00")).toBe(
      "9:00 AM – 10:00 AM",
    );
  });

  it("renders an evening class crossing noon", () => {
    expect(formatTimeRange("16:30:00", "17:45:00")).toBe(
      "4:30 PM – 5:45 PM",
    );
  });

  it("renders noon and midnight correctly", () => {
    expect(formatTimeRange("12:00:00", "13:00:00")).toBe(
      "12:00 PM – 1:00 PM",
    );
    expect(formatTimeRange("00:00:00", "01:00:00")).toBe(
      "12:00 AM – 1:00 AM",
    );
  });
});
