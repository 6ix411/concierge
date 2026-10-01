import { z } from "zod";

import { percentToBps } from "./rules";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep it under ${max} characters.`)
    .optional()
    .transform((value) => value || undefined);

const requiredReason = z
  .string({ error: "Give a reason." })
  .trim()
  .min(3, "Give a reason.")
  .max(1000, "Keep it under 1000 characters.");

export const bookingAdminSchema = z.object({
  bookingId: z.guid(),
  reason: optionalText(1000),
});

export const disputeOpenSchema = z.object({
  bookingId: z.guid(),
  reason: z
    .string({ error: "Say what went wrong." })
    .trim()
    .min(3, "Say what went wrong.")
    .max(200, "Keep the summary under 200 characters."),
  description: optionalText(5000),
});

export const disputeResolveSchema = z.object({
  disputeId: z.guid(),
  resolution: z
    .string({ error: "Explain the decision." })
    .trim()
    .min(3, "Explain the decision. Both sides will see it.")
    .max(2000, "Keep it under 2000 characters."),
});

export const reviewModerationSchema = z.object({
  reviewId: z.guid(),
  reason: optionalText(1000),
});

export const reviewPhotoRemovalSchema = z.object({
  photoId: z.guid(),
  reason: optionalText(1000),
});

export const userStatusSchema = z.object({
  userId: z.guid(),
  reason: optionalText(1000),
});

export const reasonSchema = requiredReason;

export const categorySchema = z.object({
  categoryId: z.guid().optional(),
  name: z
    .string({ error: "Enter a name." })
    .trim()
    .min(2, "Enter a name.")
    .max(80, "Keep the name under 80 characters."),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .max(80)
    .optional()
    .transform((value) => value || undefined)
    .refine((value) => !value || /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value), {
      message: "Use lowercase letters, numbers and dashes.",
    }),
  description: optionalText(300),
  parentId: z
    .union([z.guid(), z.literal("")])
    .optional()
    .transform((value) => value || null),
  sortOrder: z.coerce
    .number({ error: "Enter a number." })
    .int("Enter a whole number.")
    .min(0)
    .max(1000)
    .default(0),
  isActive: z.boolean(),
});

export const commissionSchema = z.object({
  percent: z.string({ error: "Enter a percentage." }).transform((value, ctx) => {
    const bps = percentToBps(value);
    if (bps === null) {
      ctx.addIssue({ code: "custom", message: "Enter a percentage between 0 and 50." });
      return z.NEVER;
    }
    return bps;
  }),
});

export const businessCommissionSchema = z.object({
  businessId: z.guid(),
  percent: z
    .string()
    .trim()
    .transform((value, ctx) => {
      if (value === "") return null; // back to the platform default
      const bps = percentToBps(value);
      if (bps === null) {
        ctx.addIssue({ code: "custom", message: "Enter a percentage between 0 and 50, or leave it empty." });
        return z.NEVER;
      }
      return bps;
    }),
});
