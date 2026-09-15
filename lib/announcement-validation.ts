import { z } from "zod";

/*
 * The audience pair is normalised here as well as checked in the database:
 * the check constraint is the guarantee, and this is the part that turns a
 * mistake into a sentence a person can act on instead of a 500.
 */
export const announcementInputSchema = z
  .object({
    title: z.string().trim().min(1, "Give the announcement a title.").max(200),
    body: z.string().trim().min(1, "Write something in the body."),
    audienceType: z.enum(["all", "class_offering"]),
    classOfferingId: z.uuid().optional(),
  })
  .transform((input) => ({
    ...input,
    // `?? null`, not `!`: a missing field parses as `undefined`, and the
    // refine below checks `!== null` — leaving it `undefined` would let a
    // class-audience row with no class through.
    classOfferingId:
      input.audienceType === "class_offering" ? (input.classOfferingId ?? null) : null,
  }))
  .refine((input) => input.audienceType === "all" || input.classOfferingId !== null, {
    message: "Choose which class this is for.",
    path: ["classOfferingId"],
  });

/**
 * Editing changes the copy and nothing else.
 *
 * Separate from the create schema for a concrete reason: the edit form
 * disables the audience controls, and a disabled field submits nothing — so
 * parsing an edit with `announcementInputSchema` would fail on a missing
 * `audienceType` every time. The audience is also genuinely immutable once
 * rows have gone out addressed to it.
 */
export const announcementEditSchema = z.object({
  title: z.string().trim().min(1, "Give the announcement a title.").max(200),
  body: z.string().trim().min(1, "Write something in the body."),
});

export const announcementIdSchema = z.object({ announcementId: z.uuid() });
