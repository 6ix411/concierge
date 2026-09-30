import { z } from "zod";

import { addDays, lagosToday } from "@/lib/dates";

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.")
  .refine((value) => value > lagosToday(), "Choose a date from tomorrow onwards.")
  .refine((value) => value <= addDays(lagosToday(), 365), "Choose a date within the next year.");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose a time.");

export const bookingRequestSchema = z
  .object({
    mode: z.enum(["book", "quote"]),
    serviceIds: z.array(z.uuid()).max(10),
    quantities: z.record(z.string(), z.coerce.number().int().min(1).max(100)),
    date,
    time,
    addressLine: z.string().trim().min(3, "Enter the address.").max(300),
    area: z.string().trim().min(2, "Enter the area.").max(80),
    state: z.string().trim().min(2, "Enter the state.").max(80),
    notes: z.string().trim().max(3000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === "book" && value.serviceIds.length === 0) {
      ctx.addIssue({ code: "custom", path: ["serviceIds"], message: "Choose at least one service." });
    }
    if (value.mode === "quote" && value.serviceIds.length === 0 && (value.notes?.length ?? 0) < 10) {
      ctx.addIssue({
        code: "custom",
        path: ["notes"],
        message: "Describe what you need (at least 10 characters).",
      });
    }
  });
export type BookingRequest = z.infer<typeof bookingRequestSchema>;

export const rescheduleSchema = z.object({ bookingId: z.uuid(), date, time });
export const cancelSchema = z.object({
  bookingId: z.uuid(),
  reason: z.string().trim().max(500).optional(),
});
