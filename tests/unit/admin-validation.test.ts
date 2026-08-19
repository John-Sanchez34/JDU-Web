import { describe, expect, it } from "vitest";
import { offeringInputSchema, seasonInputSchema } from "@/lib/admin-validation";

describe("seasonInputSchema", () => {
  it("accepts a valid season", () => {
    const parsed = seasonInputSchema.parse({
      name: "Fall 2026",
      startDate: "2026-09-01",
      endDate: "2026-12-19",
    });
    expect(parsed.name).toBe("Fall 2026");
  });

  it("rejects an end date before the start date", () => {
    expect(() =>
      seasonInputSchema.parse({
        name: "Backwards",
        startDate: "2026-12-19",
        endDate: "2026-09-01",
      }),
    ).toThrow();
  });
});

describe("offeringInputSchema", () => {
  const valid = {
    seasonId: "8f1b0f4e-1c2d-4a5b-9e6f-7a8b9c0d1e2f",
    name: "Ballet I",
    dayOfWeek: "tuesday",
    startTime: "16:00",
    endTime: "17:00",
    capacity: "12",
    monthlyPrice: "65.00",
    seasonFee: "50.00",
  };

  it("converts dollar strings to integer cents", () => {
    const parsed = offeringInputSchema.parse(valid);
    expect(parsed.monthlyPriceCents).toBe(6500);
    expect(parsed.seasonFeeCents).toBe(5000);
  });

  it("handles amounts that would drift in floating point", () => {
    expect(
      offeringInputSchema.parse({ ...valid, monthlyPrice: "70.10" })
        .monthlyPriceCents,
    ).toBe(7010);
    expect(
      offeringInputSchema.parse({ ...valid, monthlyPrice: "0.29" })
        .monthlyPriceCents,
    ).toBe(29);
  });

  it("normalizes a time without seconds", () => {
    const parsed = offeringInputSchema.parse(valid);
    expect(parsed.startTime).toBe("16:00:00");
    expect(parsed.endTime).toBe("17:00:00");
  });

  it("rejects an end time at or before the start time", () => {
    expect(() =>
      offeringInputSchema.parse({ ...valid, endTime: "16:00" }),
    ).toThrow();
    expect(() =>
      offeringInputSchema.parse({ ...valid, endTime: "15:00" }),
    ).toThrow();
  });

  it("rejects a capacity below one", () => {
    expect(() =>
      offeringInputSchema.parse({ ...valid, capacity: "0" }),
    ).toThrow();
  });

  it("rejects a negative price", () => {
    expect(() =>
      offeringInputSchema.parse({ ...valid, monthlyPrice: "-5.00" }),
    ).toThrow();
  });

  it("rejects a price with more than two decimal places", () => {
    expect(() =>
      offeringInputSchema.parse({ ...valid, monthlyPrice: "65.005" }),
    ).toThrow();
  });
});
