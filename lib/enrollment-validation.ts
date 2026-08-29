import { z } from "zod";

export const enrollmentRequestSchema = z.object({
  studentId: z.uuid("Choose a student."),
  offeringId: z.uuid("Choose a class."),
});

export const enrollmentIdSchema = z.object({
  enrollmentId: z.uuid("That enrollment could not be found."),
});
