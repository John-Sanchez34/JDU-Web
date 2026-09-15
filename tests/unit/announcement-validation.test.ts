import { describe, expect, it } from "vitest";
import { announcementEditSchema, announcementInputSchema } from "@/lib/announcement-validation";

const base = { title: "Recital tickets", body: "Tickets are at the desk." };

describe("announcementInputSchema", () => {
  it("accepts an announcement addressed to everyone", () => {
    const parsed = announcementInputSchema.safeParse({ ...base, audienceType: "all" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.classOfferingId).toBeNull();
  });

  it("requires a class when the audience is a class", () => {
    const parsed = announcementInputSchema.safeParse({
      ...base,
      audienceType: "class_offering",
    });
    expect(parsed.success).toBe(false);
  });

  it("ignores a class when the audience is everyone", () => {
    const parsed = announcementInputSchema.safeParse({
      ...base,
      audienceType: "all",
      classOfferingId: "8f8c4c34-0f3a-4f3f-9f3a-4f3f9f3a4f3f",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.classOfferingId).toBeNull();
  });

  it("rejects an empty title or body", () => {
    expect(announcementInputSchema.safeParse({ ...base, title: "  ", audienceType: "all" }).success)
      .toBe(false);
    expect(announcementInputSchema.safeParse({ ...base, body: "", audienceType: "all" }).success)
      .toBe(false);
  });
});

describe("announcementEditSchema", () => {
  it("accepts a form carrying no audience, because the edit form disables it", () => {
    expect(announcementEditSchema.safeParse(base).success).toBe(true);
  });

  it("still requires a title and a body", () => {
    expect(announcementEditSchema.safeParse({ ...base, title: " " }).success).toBe(false);
  });
});
