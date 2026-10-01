import { z } from "zod";

import { isNigerianState } from "./locations";
import { MIN_DESCRIPTION_LENGTH } from "./onboarding";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .optional()
    .transform((value) => (value ? value : undefined));

/** Accepts 0803 123 4567, +234 803 123 4567 or 2348031234567 and stores +2348031234567. */
export function normalizeNigerianPhone(input: string): string | null {
  const digits = input.replace(/[\s()-]/g, "");
  if (/^0[789][01]\d{8}$/.test(digits)) return `+234${digits.slice(1)}`;
  if (/^\+?234[789][01]\d{8}$/.test(digits)) return `+${digits.replace(/^\+/, "")}`;
  if (/^\+[1-9]\d{6,14}$/.test(digits)) return digits;
  return null;
}

/** "1,500,000" or "1500000.50" (naira) to kobo. Returns null if it isn't a valid amount. */
export function nairaToKobo(input: string): number | null {
  const cleaned = input.replace(/[₦,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const kobo = Math.round(Number(cleaned) * 100);
  return Number.isSafeInteger(kobo) ? kobo : null;
}

const MAX_PRICE_KOBO = 1_000_000_000 * 100; // ₦1bn

const nairaAmount = z
  .string()
  .trim()
  .min(1, "Enter a price.")
  .transform((value, ctx) => {
    const kobo = nairaToKobo(value);
    if (kobo === null || kobo <= 0 || kobo > MAX_PRICE_KOBO) {
      ctx.addIssue({ code: "custom", message: "Enter a price in naira, e.g. 150000." });
      return z.NEVER;
    }
    return kobo;
  });

const state = z.string().trim().refine(isNigerianState, "Choose a state.");

export const businessDetailsSchema = z
  .object({
    name: z.string().trim().min(2, "Enter your business name.").max(120),
    description: z
      .string()
      .trim()
      .min(
        MIN_DESCRIPTION_LENGTH,
        `Describe your business in at least ${MIN_DESCRIPTION_LENGTH} characters so customers know what you do.`,
      )
      .max(5000),
    categoryId: z.uuid("Choose a category."),
    phone: optionalText(30).transform((value, ctx) => {
      if (!value) return undefined;
      const phone = normalizeNigerianPhone(value);
      if (!phone) {
        ctx.addIssue({ code: "custom", message: "Enter a valid phone number, e.g. 0803 123 4567." });
        return z.NEVER;
      }
      return phone;
    }),
    email: optionalText(254).pipe(z.email("Enter a valid email address.").optional()),
    website: optionalText(200).pipe(
      z
        .url({ protocol: /^https?$/, message: "Enter a full web address, e.g. https://example.com." })
        .optional(),
    ),
    addressLine: optionalText(200),
    city: z.string().trim().min(2, "Enter your city or area.").max(80),
    state,
  })
  .refine((value) => value.phone || value.email, {
    message: "Add a phone number or an email address so the platform can reach you.",
    path: ["phone"],
  });
export type BusinessDetailsInput = z.infer<typeof businessDetailsSchema>;

export const serviceAreaSchema = z.object({
  state,
  area: optionalText(80),
});

export const serviceKinds = ["service", "package", "addon"] as const;
export type ServiceKind = (typeof serviceKinds)[number];

export const serviceSchema = z
  .object({
    serviceId: z.uuid().optional(),
    name: z.string().trim().min(2, "Enter a name for this service.").max(120),
    description: optionalText(3000),
    categoryId: z
      .uuid()
      .optional()
      .or(z.literal("").transform(() => undefined)),
    kind: z.enum(serviceKinds),
    pricingType: z.enum(["fixed", "hourly", "starting_from", "quote_only"]),
    price: z.string().trim().optional(),
    durationMinutes: z.coerce
      .number()
      .int("Enter whole minutes.")
      .min(15, "At least 15 minutes.")
      .max(60 * 24 * 30)
      .optional()
      .or(z.literal("").transform(() => undefined)),
    includes: z
      .string()
      .optional()
      .transform((value) =>
        (value ?? "")
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(0, 20),
      ),
    isActive: z.boolean(),
  })
  .transform((value, ctx) => {
    let priceMinor: number | null = null;
    if (value.pricingType !== "quote_only") {
      const parsed = nairaAmount.safeParse(value.price ?? "");
      if (!parsed.success) {
        ctx.addIssue({ code: "custom", path: ["price"], message: "Enter a price in naira, e.g. 150000." });
        return z.NEVER;
      }
      priceMinor = parsed.data;
    }
    if (
      value.kind === "addon" &&
      (value.pricingType === "quote_only" || value.pricingType === "starting_from")
    ) {
      ctx.addIssue({ code: "custom", path: ["pricingType"], message: "Add-ons need a set price." });
      return z.NEVER;
    }
    if (value.kind === "package" && value.includes.length === 0) {
      ctx.addIssue({ code: "custom", path: ["includes"], message: "List what the package includes." });
      return z.NEVER;
    }
    return {
      serviceId: value.serviceId,
      row: {
        name: value.name,
        description: value.description ?? null,
        category_id: value.categoryId ?? null,
        pricing_type: value.pricingType,
        price_minor: priceMinor,
        duration_minutes: value.durationMinutes ?? null,
        is_package: value.kind === "package",
        is_addon: value.kind === "addon",
        package_includes: value.kind === "package" ? value.includes : [],
        is_active: value.isActive,
      },
    };
  });

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 09:00.");

export const weeklyHoursSchema = z
  .array(
    z.object({ day: z.number().int().min(0).max(6), open: z.boolean(), start: z.string(), end: z.string() }),
  )
  .length(7)
  .superRefine((days, ctx) => {
    days.forEach((day, index) => {
      if (!day.open) return;
      if (!time.safeParse(day.start).success || !time.safeParse(day.end).success) {
        ctx.addIssue({ code: "custom", path: [index], message: "Use times like 09:00." });
      } else if (day.end <= day.start) {
        ctx.addIssue({ code: "custom", path: [index], message: "Closing time must be after opening time." });
      }
    });
  });

export const bookingSettingsSchema = z.object({
  acceptingBookings: z.boolean(),
  minNoticeHours: z.coerce
    .number()
    .int()
    .min(0, "Can't be negative.")
    .max(720, "At most 30 days (720 hours)."),
  bookingWindowDays: z.coerce
    .number()
    .int()
    .min(1, "At least 1 day.")
    .max(730, "At most 2 years (730 days)."),
  maxBookingsPerDay: z.coerce
    .number()
    .int()
    .min(1, "At least 1.")
    .max(100)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export const blockedDateSchema = z.object({
  date: z.iso.date("Choose a date."),
});

export const verificationDocumentTypes = [
  "cac_certificate",
  "national_id",
  "drivers_license",
  "international_passport",
  "voters_card",
  "utility_bill",
  "professional_license",
  "other",
] as const;

export const verificationDocumentSchema = z.object({
  documentType: z.enum(verificationDocumentTypes, "Choose the type of document."),
  documentNumber: optionalText(100),
  notes: optionalText(2000),
  path: z.string().min(1, "Upload the document."),
  requestId: z
    .uuid()
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export const portfolioItemSchema = z.object({
  path: z.string().min(1),
  mediaType: z.enum(["image", "video"]),
  caption: optionalText(300),
});

export const quoteSchema = z.object({
  bookingId: z.uuid(),
  amount: nairaAmount,
  notes: optionalText(3000),
});

export const bookingDecisionSchema = z.object({
  bookingId: z.uuid(),
  reason: optionalText(500),
});

export const reviewReplySchema = z.object({
  reviewId: z.uuid(),
  reply: z.string().trim().min(2, "Write a reply.").max(2000),
});
