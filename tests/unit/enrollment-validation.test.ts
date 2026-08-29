import { describe, expect, it } from "vitest";
import { enrollmentRequestSchema } from "@/lib/enrollment-validation";

describe("enrollmentRequestSchema", () => {
  it("accepts a pair of UUIDs", () => {
    const result = enrollmentRequestSchema.safeParse({
      studentId: "8f1b6f9e-1f5c-4a2b-9c3d-2e4f5a6b7c8d",
      offeringId: "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a studentId that is not a UUID", () => {
    const result = enrollmentRequestSchema.safeParse({
      studentId: "not-a-uuid",
      offeringId: "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a missing offeringId", () => {
    const result = enrollmentRequestSchema.safeParse({
      studentId: "8f1b6f9e-1f5c-4a2b-9c3d-2e4f5a6b7c8d",
    });

    expect(result.success).toBe(false);
  });

  it("requires a student to be chosen", () => {
    const result = enrollmentRequestSchema.safeParse({
      studentId: "",
      offeringId: "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toBe("Choose a student.");
  });
});
