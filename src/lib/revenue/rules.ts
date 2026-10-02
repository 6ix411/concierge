/**
 * Revenue rules shared by the server and the dashboards: the booking fee setting, plan and package
 * edits, and how prices are described. Pure functions, no database.
 */

import { z } from "zod";

import { percentToBps } from "@/lib/admin/rules";
import { NO_BOOKING_FEE, type BookingFeeRule } from "@/lib/bookings/rules";
import { nairaToKobo } from "@/lib/business/schemas";
import { formatNaira } from "@/lib/format";

export const BOOKING_FEE_SETTING = "booking_fee";
export const FEATURED_SLOTS_SETTING = "featured_slots";

/** Highest booking fee percentage the dashboard accepts (20%). */
export const MAX_BOOKING_FEE_BPS = 2000;
const MAX_PLAN_PRICE_KOBO = 100_000_000 * 100; // ₦100m

const storedFee = z.object({
  percent_bps: z.number().int().min(0).max(10_000),
  flat_minor: z.number().int().min(0),
  cap_minor: z.number().int().min(0).nullable(),
});

/** Reads the stored setting. Anything malformed means no fee, never a surprise charge. */
export function parseBookingFee(value: unknown): BookingFeeRule {
  const parsed = storedFee.safeParse(value);
  if (!parsed.success) return NO_BOOKING_FEE;
  return {
    percentBps: parsed.data.percent_bps,
    flatMinor: parsed.data.flat_minor,
    capMinor: parsed.data.cap_minor,
  };
}

export function storeBookingFee(rule: BookingFeeRule) {
  return { percent_bps: rule.percentBps, flat_minor: rule.flatMinor, cap_minor: rule.capMinor };
}

export function hasBookingFee(rule: BookingFeeRule): boolean {
  return rule.percentBps > 0 || rule.flatMinor > 0;
}

/** "5% + ₦500 (up to ₦5,000)", or "No booking fee". */
export function describeBookingFee(rule: BookingFeeRule): string {
  if (!hasBookingFee(rule)) return "No booking fee";
  const parts = [
    rule.percentBps > 0 ? `${Number((rule.percentBps / 100).toFixed(2))}%` : null,
    rule.flatMinor > 0 ? formatNaira(rule.flatMinor) : null,
  ].filter(Boolean);
  const cap = rule.capMinor !== null && rule.percentBps > 0 ? ` (up to ${formatNaira(rule.capMinor)})` : "";
  return `${parts.join(" + ")}${cap}`;
}

const optionalNaira = (label: string) =>
  z
    .string()
    .trim()
    .transform((value, ctx) => {
      if (value === "") return 0;
      const kobo = nairaToKobo(value);
      if (kobo === null || kobo > MAX_PLAN_PRICE_KOBO) {
        ctx.addIssue({ code: "custom", message: `Enter ${label} in naira, e.g. 500.` });
        return z.NEVER;
      }
      return kobo;
    });

export const bookingFeeSchema = z
  .object({
    percent: z
      .string()
      .trim()
      .transform((value, ctx) => {
        if (value === "") return 0;
        const bps = percentToBps(value);
        if (bps === null || bps > MAX_BOOKING_FEE_BPS) {
          ctx.addIssue({ code: "custom", message: "Enter a percentage between 0 and 20." });
          return z.NEVER;
        }
        return bps;
      }),
    flat: optionalNaira("a fixed amount"),
    cap: z
      .string()
      .trim()
      .transform((value, ctx) => {
        if (value === "") return null;
        const kobo = nairaToKobo(value);
        if (kobo === null || kobo <= 0 || kobo > MAX_PLAN_PRICE_KOBO) {
          ctx.addIssue({
            code: "custom",
            message: "Enter the most a fee can be, in naira, or leave it empty.",
          });
          return z.NEVER;
        }
        return kobo;
      }),
  })
  .transform(({ percent, flat, cap }): BookingFeeRule => ({
    percentBps: percent,
    flatMinor: flat,
    capMinor: cap,
  }))
  .refine((rule) => rule.capMinor === null || rule.capMinor >= rule.flatMinor, {
    message: "The cap can't be lower than the fixed amount.",
    path: ["cap"],
  });

const perks = z
  .string()
  .max(800)
  .transform((value) =>
    value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  )
  .refine((lines) => lines.length <= 8, "Up to 8 lines.")
  .refine((lines) => lines.every((line) => line.length <= 80), "Keep each line under 80 characters.");

export const planSchema = z.object({
  code: z.enum(["free", "starter", "growth", "pro"]),
  name: z.string().trim().min(1, "Enter a name.").max(40),
  description: z.string().trim().max(300).optional(),
  price: z
    .string()
    .trim()
    .transform((value, ctx) => {
      const kobo = nairaToKobo(value);
      if (kobo === null || kobo > MAX_PLAN_PRICE_KOBO) {
        ctx.addIssue({ code: "custom", message: "Enter the monthly price in naira, e.g. 25000." });
        return z.NEVER;
      }
      return kobo;
    }),
  commission: z
    .string()
    .trim()
    .transform((value, ctx) => {
      if (value === "") return null;
      const bps = percentToBps(value);
      if (bps === null) {
        ctx.addIssue({ code: "custom", message: "Enter a percentage between 0 and 50, or leave it empty." });
        return z.NEVER;
      }
      return bps;
    }),
  perks,
  active: z.boolean(),
});

export const featuredPackageSchema = z.object({
  code: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/),
  price: z
    .string()
    .trim()
    .transform((value, ctx) => {
      const kobo = nairaToKobo(value);
      if (kobo === null || kobo <= 0 || kobo > MAX_PLAN_PRICE_KOBO) {
        ctx.addIssue({ code: "custom", message: "Enter the price in naira, e.g. 10000." });
        return z.NEVER;
      }
      return kobo;
    }),
  active: z.boolean(),
});

export const featuredSlotsSchema = z.object({
  slots: z.coerce
    .number({ error: "Enter a number from 0 to 10." })
    .int("Enter a whole number.")
    .min(0, "Enter a number from 0 to 10.")
    .max(10, "Enter a number from 0 to 10."),
});

export const checkoutSchema = z.object({
  kind: z.enum(["subscription", "featured"]),
  code: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/),
});

export function planPriceLabel(priceMinor: number): string {
  return `${formatNaira(priceMinor)}/month`;
}

/** Charge references never clash with booking payment references (PAY-…). */
export const CHARGE_REFERENCE = /^CHG-[A-F0-9]{16}$/;
