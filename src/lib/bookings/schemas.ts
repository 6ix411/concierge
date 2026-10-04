import { z } from "zod";

import { sharesContactDetails } from "@/lib/chat/rules";
import { addDays, lagosToday } from "@/lib/dates";

/** Phone numbers and emails stay private until the booking is confirmed (then the chat opens). */
export const NO_CONTACT_DETAILS =
  "Please leave out phone numbers and email addresses. You can chat on Concierge once the booking is confirmed.";

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.")
  .refine((value) => value > lagosToday(), "Choose a date from tomorrow onwards.")
  .refine((value) => value <= addDays(lagosToday(), 365), "Choose a date within the next year.");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose a time.");

export const bookingRequestSchema = z
  .object({
    mode: z.enum(["book", "quote"]),
    /** Services and add-ons. */
    serviceIds: z.array(z.guid()).max(10),
    packageId: z.guid().optional(),
    quantities: z.record(z.string(), z.coerce.number().int().min(1).max(100)),
    date,
    time,
    addressLine: z.string().trim().min(3, "Enter the address.").max(300),
    area: z.string().trim().min(2, "Enter the area.").max(80),
    city: z.string().trim().min(2, "Enter the city.").max(80),
    state: z.string().trim().min(2, "Enter the state.").max(80),
    guests: z.coerce
      .number({ error: "Enter a number." })
      .int("Enter a whole number.")
      .min(1, "Enter at least 1.")
      .max(100000, "That's more guests than we can book.")
      .optional(),
    notes: z
      .string()
      .trim()
      .max(3000)
      .refine((value) => !sharesContactDetails(value), NO_CONTACT_DETAILS)
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === "book" && value.serviceIds.length === 0 && !value.packageId) {
      ctx.addIssue({ code: "custom", path: ["serviceIds"], message: "Choose a service or a package." });
    }
    if (
      value.mode === "quote" &&
      value.serviceIds.length === 0 &&
      !value.packageId &&
      (value.notes?.length ?? 0) < 10
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["notes"],
        message: "Describe what you need (at least 10 characters).",
      });
    }
  });
export type BookingRequest = z.infer<typeof bookingRequestSchema>;

export const rescheduleSchema = z.object({ bookingId: z.guid(), date, time });
export const cancelSchema = z.object({
  bookingId: z.guid(),
  reason: z.string().trim().max(500).optional(),
});
