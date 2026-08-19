import { z } from "zod";
import { todayIso } from "@/lib/dates";

const EARLIEST_BIRTHDATE = "1920-01-01";

const trimmedName = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1, "Required").max(80));

export const studentInputSchema = z.object({
  firstName: trimmedName,
  lastName: trimmedName,
  birthdate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker")
    .refine((value) => value <= todayIso(), "Birthdate cannot be in the future")
    .refine(
      (value) => value >= EARLIEST_BIRTHDATE,
      "Birthdate is not plausible",
    ),
  notes: z
    .string()
    .max(2000)
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : null;
    }),
});

export type StudentInput = z.infer<typeof studentInputSchema>;
