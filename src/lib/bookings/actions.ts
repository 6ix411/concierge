"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { fieldErrorsFrom, type FormState } from "@/lib/auth/schemas";
import { requireRole } from "@/lib/auth/session";
import { lagosDateTime } from "@/lib/dates";
import { AppError, isAppError, logger } from "@/lib/errors";
import { notify } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

import {
  canCustomerAcceptQuote,
  checkBookingWindow,
  canCustomerCancel,
  canCustomerReschedule,
  isWithinAvailability,
  priceBooking,
  type BookingStatus,
} from "./rules";
import { bookingRequestSchema, cancelSchema, rescheduleSchema } from "./schemas";

const DEFAULT_DURATION_MINUTES = 120;

function toFormError(error: unknown, fallback: string): FormState {
  if (isAppError(error) && error.status < 500) return { status: "error", message: error.message };
  logger.error(fallback, { error });
  return { status: "error", message: fallback };
}

/** Create a booking or quote request. Prices always come from the database, never the form. */
export async function createBookingAction(
  businessSlug: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  let bookingId: string;
  try {
    const customer = await requireRole("customer");

    const serviceIds = formData.getAll("serviceIds").map(String);
    const quantities = Object.fromEntries(
      serviceIds.map((id) => [id, formData.get(`quantity-${id}`) ?? "1"] as const),
    );
    const parsed = bookingRequestSchema.safeParse({
      mode: formData.get("mode"),
      serviceIds,
      quantities,
      date: formData.get("date"),
      time: formData.get("time"),
      addressLine: formData.get("addressLine"),
      area: formData.get("area"),
      state: formData.get("state"),
      notes: formData.get("notes") || undefined,
    });
    if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };
    const input = parsed.data;

    const supabase = await createClient();
    const { data: business } = await supabase
      .from("businesses")
      .select("id, name, accepting_bookings, min_notice_hours, booking_window_days, max_bookings_per_day")
      .eq("slug", businessSlug)
      .eq("status", "approved")
      .maybeSingle();
    if (!business) throw new AppError("NOT_FOUND", "This business isn't available for booking.");
    if (!business.accepting_bookings)
      return { status: "error", message: `${business.name} isn't taking new bookings right now.` };

    const [{ data: services, error: servicesError }, { data: availability }] = await Promise.all([
      supabase
        .from("business_services")
        .select("id, name, pricing_type, price_minor, duration_minutes, is_addon")
        .eq("business_id", business.id)
        .eq("is_active", true),
      supabase
        .from("business_availability")
        .select("day_of_week, specific_date, start_time, end_time, is_available")
        .eq("business_id", business.id),
    ]);
    if (servicesError) throw new AppError("INTERNAL", "Could not load services.", { cause: servicesError });

    const offered = new Set((services ?? []).map((s) => s.id));
    if (input.serviceIds.some((id) => !offered.has(id))) {
      return {
        status: "error",
        message: "One of the services is no longer available. Please refresh and try again.",
      };
    }

    const chosen = (services ?? []).filter((s) => input.serviceIds.includes(s.id));
    if (chosen.length > 0 && chosen.every((s) => s.is_addon)) {
      return {
        status: "error",
        fieldErrors: { serviceIds: "Add-ons are extras. Choose a main service too." },
      };
    }

    if (
      availability &&
      availability.length > 0 &&
      !isWithinAvailability(availability, input.date, input.time)
    ) {
      return {
        status: "error",
        fieldErrors: { time: "The business isn't available then. Check their hours and pick another time." },
      };
    }

    const timing = checkBookingWindow(business, lagosDateTime(input.date, input.time));
    if (timing) return { status: "error", fieldErrors: timing };

    if (business.max_bookings_per_day) {
      const dayStart = lagosDateTime(input.date, "00:00");
      const { count } = await createAdminClient()
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("business_id", business.id)
        .in("status", ["accepted", "confirmed", "in_progress"])
        .gte("scheduled_start", dayStart.toISOString())
        .lt("scheduled_start", new Date(dayStart.getTime() + 86_400_000).toISOString());
      if ((count ?? 0) >= business.max_bookings_per_day) {
        return {
          status: "error",
          fieldErrors: { date: "The business is fully booked that day. Pick another date." },
        };
      }
    }

    const quote = priceBooking(
      services ?? [],
      input.serviceIds.map((id) => ({ serviceId: id, quantity: input.quantities[id] ?? 1 })),
    );
    const isQuote = input.mode === "quote" || quote.needsQuote;
    const duration =
      input.serviceIds.reduce((sum, id) => {
        const service = services?.find((s) => s.id === id);
        return sum + (service?.duration_minutes ?? 0) * (input.quantities[id] ?? 1);
      }, 0) || DEFAULT_DURATION_MINUTES;

    const start = lagosDateTime(input.date, input.time);
    const end = new Date(start.getTime() + duration * 60_000);

    const admin = createAdminClient();
    const [{ data: private_ }, { data: setting }] = await Promise.all([
      admin.from("businesses").select("owner_id, commission_rate_bps").eq("id", business.id).single(),
      admin.from("platform_settings").select("value").eq("key", "default_commission_rate_bps").maybeSingle(),
    ]);
    const commission = private_?.commission_rate_bps ?? Number(setting?.value ?? 1000);

    const { data: booking, error: bookingError } = await admin
      .from("bookings")
      .insert({
        customer_id: customer.id,
        business_id: business.id,
        status: isQuote ? "quote_requested" : "requested",
        scheduled_start: start.toISOString(),
        scheduled_end: end.toISOString(),
        address_line: input.addressLine,
        city: input.area,
        state: input.state,
        customer_notes: input.notes ?? null,
        subtotal_minor: quote.subtotalMinor,
        platform_fee_minor: quote.platformFeeMinor,
        total_minor: quote.totalMinor,
        commission_rate_bps: commission,
      })
      .select("id, reference")
      .single();
    if (bookingError || !booking)
      throw new AppError("INTERNAL", "Could not create the booking.", { cause: bookingError });

    if (quote.items.length > 0) {
      const { error: itemsError } = await admin.from("booking_items").insert(
        quote.items.map((item) => ({
          booking_id: booking.id,
          service_id: item.serviceId,
          name: item.name,
          unit_price_minor: item.unitPriceMinor,
          quantity: item.quantity,
        })),
      );
      if (itemsError) {
        await admin.from("bookings").delete().eq("id", booking.id);
        throw new AppError("INTERNAL", "Could not create the booking.", { cause: itemsError });
      }
    }

    if (private_?.owner_id) {
      await notify({
        userId: private_.owner_id,
        type: isQuote ? "booking.quote_requested" : "booking.requested",
        title: isQuote ? "New quote request" : "New booking request",
        body: `${customer.fullName ?? "A customer"} sent ${booking.reference}.`,
        data: { bookingId: booking.id },
      });
    }
    bookingId = booking.id;
  } catch (error) {
    return toFormError(error, "We couldn't send your request. Please try again.");
  }
  redirect(`/account/bookings/${bookingId}?sent=1`);
}

/** Loads the caller's own booking (RLS) with the fields the rules need. */
async function loadOwnBooking(bookingId: string, customerId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("bookings")
    .select(
      "id, reference, status, scheduled_start, scheduled_end, business_id, customer_id, businesses(owner_id, name)",
    )
    .eq("id", bookingId)
    .eq("customer_id", customerId)
    .maybeSingle();
  if (!data) throw new AppError("NOT_FOUND", "Booking not found.");
  return data;
}

/** Updates only if the status hasn't changed since we checked (protects against double submits). */
async function updateIfStatus(
  bookingId: string,
  customerId: string,
  expected: BookingStatus,
  changes: Database["public"]["Tables"]["bookings"]["Update"],
) {
  const { data, error } = await createAdminClient()
    .from("bookings")
    .update(changes)
    .eq("id", bookingId)
    .eq("customer_id", customerId)
    .eq("status", expected)
    .select("id");
  if (error) throw new AppError("INTERNAL", "Could not update the booking.", { cause: error });
  if (!data || data.length === 0)
    throw new AppError("CONFLICT", "This booking changed. Refresh to see the latest.");
}

export async function cancelBookingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const customer = await requireRole("customer");
    const input = cancelSchema.parse({
      bookingId: formData.get("bookingId"),
      reason: formData.get("reason") || undefined,
    });
    const booking = await loadOwnBooking(input.bookingId, customer.id);
    if (!canCustomerCancel(booking)) {
      throw new AppError(
        "FORBIDDEN",
        "This booking can no longer be cancelled here. If something went wrong, contact support.",
      );
    }
    await updateIfStatus(booking.id, customer.id, booking.status, {
      status: "cancelled",
      cancelled_by: customer.id,
      cancellation_reason: input.reason ?? null,
    });
    if (booking.businesses?.owner_id) {
      await notify({
        userId: booking.businesses.owner_id,
        type: "booking.cancelled",
        title: "Booking cancelled",
        body: `${booking.reference} was cancelled by the customer.`,
        data: { bookingId: booking.id },
      });
    }
  } catch (error) {
    return toFormError(error, "We couldn't cancel the booking. Please try again.");
  }
  refresh();
  return { status: "success", message: "Booking cancelled." };
}

export async function rescheduleBookingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const customer = await requireRole("customer");
    const parsed = rescheduleSchema.safeParse({
      bookingId: formData.get("bookingId"),
      date: formData.get("date"),
      time: formData.get("time"),
    });
    if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };
    const input = parsed.data;
    const booking = await loadOwnBooking(input.bookingId, customer.id);
    if (!canCustomerReschedule(booking)) {
      throw new AppError(
        "FORBIDDEN",
        "The business has already accepted. Agree a new time with them in chat.",
      );
    }

    const supabase = await createClient();
    const { data: availability } = await supabase
      .from("business_availability")
      .select("day_of_week, specific_date, start_time, end_time, is_available")
      .eq("business_id", booking.business_id);
    if (
      availability &&
      availability.length > 0 &&
      !isWithinAvailability(availability, input.date, input.time)
    ) {
      return { status: "error", fieldErrors: { time: "The business isn't available then." } };
    }

    const start = lagosDateTime(input.date, input.time);
    const previousDuration =
      booking.scheduled_start && booking.scheduled_end
        ? new Date(booking.scheduled_end).getTime() - new Date(booking.scheduled_start).getTime()
        : DEFAULT_DURATION_MINUTES * 60_000;
    await updateIfStatus(booking.id, customer.id, booking.status, {
      scheduled_start: start.toISOString(),
      scheduled_end: new Date(start.getTime() + previousDuration).toISOString(),
    });
    if (booking.businesses?.owner_id) {
      await notify({
        userId: booking.businesses.owner_id,
        type: "booking.rescheduled",
        title: "Booking time changed",
        body: `The customer moved ${booking.reference}.`,
        data: { bookingId: booking.id },
      });
    }
  } catch (error) {
    return toFormError(error, "We couldn't change the time. Please try again.");
  }
  refresh();
  return { status: "success", message: "New time saved." };
}

export async function acceptQuoteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let bookingId: string;
  try {
    const customer = await requireRole("customer");
    bookingId = cancelSchema.shape.bookingId.parse(formData.get("bookingId"));
    const booking = await loadOwnBooking(bookingId, customer.id);
    if (!canCustomerAcceptQuote(booking)) throw new AppError("CONFLICT", "There's no quote to accept.");
    await updateIfStatus(booking.id, customer.id, "quoted", { status: "accepted" });
    if (booking.businesses?.owner_id) {
      await notify({
        userId: booking.businesses.owner_id,
        type: "booking.quote_accepted",
        title: "Quote accepted",
        body: `The customer accepted your quote for ${booking.reference}. Waiting for payment.`,
        data: { bookingId: booking.id },
      });
    }
  } catch (error) {
    return toFormError(error, "We couldn't accept the quote. Please try again.");
  }
  redirect(`/checkout/${bookingId}`);
}
