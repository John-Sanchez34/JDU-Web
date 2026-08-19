import { z } from "zod";

const DOLLARS = /^\d+(\.\d{1,2})?$/;

/**
 * Parses a dollar string into integer cents using string arithmetic.
 * `Math.round(Number("70.10") * 100)` happens to work, but the same pattern
 * silently loses a cent on other values — so the digits are handled as text.
 */
function dollarsToCents(value: string): number {
  const [whole, fraction = ""] = value.split(".");
  const paddedFraction = fraction.padEnd(2, "0");
  return Number(whole) * 100 + Number(paddedFraction);
}

const dollarAmount = z
  .string()
  .regex(DOLLARS, "Enter an amount like 65.00")
  .transform(dollarsToCents);

const clockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Enter a time like 16:00")
  .transform((value) => (value.length === 5 ? `${value}:00` : value));

export const seasonInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    registrationOpen: z.coerce.boolean().optional(),
  })
  .refine((value) => value.endDate >= value.startDate, {
    message: "The season must end on or after it starts",
    path: ["endDate"],
  });

export const offeringInputSchema = z
  .object({
    seasonId: z.uuid(),
    name: z.string().trim().min(1).max(120),
    description: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .transform((v) => v || null),
    level: z
      .string()
      .trim()
      .max(60)
      .optional()
      .transform((v) => v || null),
    minAge: z.coerce.number().int().min(0).max(120).optional(),
    maxAge: z.coerce.number().int().min(0).max(120).optional(),
    dayOfWeek: z.enum([
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ]),
    startTime: clockTime,
    endTime: clockTime,
    room: z
      .string()
      .trim()
      .max(60)
      .optional()
      .transform((v) => v || null),
    instructor: z
      .string()
      .trim()
      .max(120)
      .optional()
      .transform((v) => v || null),
    capacity: z.coerce.number().int().min(1).max(500),
    monthlyPrice: dollarAmount,
    seasonFee: dollarAmount.optional(),
  })
  .refine((value) => value.endTime > value.startTime, {
    message: "The class must end after it starts",
    path: ["endTime"],
  })
  .transform(({ monthlyPrice, seasonFee, ...rest }) => ({
    ...rest,
    monthlyPriceCents: monthlyPrice,
    seasonFeeCents: seasonFee ?? 0,
  }));
