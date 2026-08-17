import { describe, expect, it } from "vitest";
import { hasAtLeastRole } from "@/lib/guards";

describe("hasAtLeastRole", () => {
  it("lets a role satisfy itself", () => {
    expect(hasAtLeastRole("parent", "parent")).toBe(true);
    expect(hasAtLeastRole("staff", "staff")).toBe(true);
    expect(hasAtLeastRole("admin", "admin")).toBe(true);
  });

  it("lets a higher role satisfy a lower requirement", () => {
    expect(hasAtLeastRole("admin", "staff")).toBe(true);
    expect(hasAtLeastRole("admin", "parent")).toBe(true);
    expect(hasAtLeastRole("staff", "parent")).toBe(true);
  });

  it("does not let a lower role satisfy a higher requirement", () => {
    expect(hasAtLeastRole("parent", "staff")).toBe(false);
    expect(hasAtLeastRole("parent", "admin")).toBe(false);
    expect(hasAtLeastRole("staff", "admin")).toBe(false);
  });
});
