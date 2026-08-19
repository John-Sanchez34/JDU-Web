import { describe, expect, it } from "vitest";
import { ROLES, isRole } from "@/lib/roles";

describe("isRole", () => {
  it("accepts every role the application defines", () => {
    for (const role of ROLES) {
      expect(isRole(role)).toBe(true);
    }
  });

  it("lists the three roles in ascending privilege order", () => {
    expect(ROLES).toEqual(["parent", "staff", "admin"]);
  });

  it("rejects a misspelled role", () => {
    expect(isRole("admn")).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(isRole("")).toBe(false);
  });

  it("rejects a role in the wrong case", () => {
    expect(isRole("ADMIN")).toBe(false);
  });
});
