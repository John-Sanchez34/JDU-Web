import { describe, expect, it } from "vitest";
import { studentInputSchema } from "@/lib/validation";

describe("studentInputSchema", () => {
  it("accepts a valid student", () => {
    const parsed = studentInputSchema.parse({
      firstName: "Maya",
      lastName: "Alvarez",
      birthdate: "2015-04-12",
      notes: "",
    });
    expect(parsed.firstName).toBe("Maya");
    expect(parsed.notes).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    const parsed = studentInputSchema.parse({
      firstName: "  Maya  ",
      lastName: " Alvarez ",
      birthdate: "2015-04-12",
    });
    expect(parsed.firstName).toBe("Maya");
    expect(parsed.lastName).toBe("Alvarez");
  });

  it("rejects an empty name", () => {
    expect(() =>
      studentInputSchema.parse({
        firstName: "   ",
        lastName: "Alvarez",
        birthdate: "2015-04-12",
      }),
    ).toThrow();
  });

  it("rejects a malformed birthdate", () => {
    expect(() =>
      studentInputSchema.parse({
        firstName: "Maya",
        lastName: "Alvarez",
        birthdate: "04/12/2015",
      }),
    ).toThrow();
  });

  it("rejects a birthdate in the future", () => {
    expect(() =>
      studentInputSchema.parse({
        firstName: "Maya",
        lastName: "Alvarez",
        birthdate: "2999-01-01",
      }),
    ).toThrow();
  });

  it("rejects an implausibly old birthdate", () => {
    expect(() =>
      studentInputSchema.parse({
        firstName: "Maya",
        lastName: "Alvarez",
        birthdate: "1900-01-01",
      }),
    ).toThrow();
  });
});
