"use server";

import { z } from "zod";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { fieldErrorsFrom, type FormState } from "@/lib/auth/schemas";
import { requireRole } from "@/lib/auth/session";
import { lagosDateTime } from "@/lib/dates";
import { AppError, isAppError, logger } from "@/lib/errors";
import { notify } from "@/lib/notifications";
import { getBookingFeeRule } from "@/lib/revenue/queries";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import {
  busyStatuses,
  canCustomerAcceptQuote,
  canCustomerCancel,
  canCustomerReschedule,
  checkBookingWindow,
  isWithinAvailability,
  priceBooking,
} from "./rules";
import { bookingRequestSchema, cancelSchema, rescheduleSchema } from "./schemas";
import { resolveSelection } from "./selection";
import { moveBooking, updateBookingDetails } from "./transitions";

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
    await enforceRateLimit("booking.create", customer.id);

    const serviceIds = formData.getAll("serviceIds").map(String);
    const packageId = String(formData.get("packageId") ?? "") || undefined;
    const quantities = Object.fromEntries(
      serviceIds.map((id) => [id, formData.get(`quantity-${id}`) ?? "1"] as const),
    );
    const parsed = bookingRequestSchema.safeParse({
      mode: formData.get("mode"),
      serviceIds,
      packageId,
      quantities,
      date: formData.get("date"),
      time: formData.get("time"),
      addressLine: formData.get("addressLine"),
      area: formData.get("area"),
      city: formData.get("city"),
      state: formData.get("state"),
      guests: formData.get("guests") || undefined,
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

    const [{ data: services, error: servicesError }, { data: availability }, { data: areas }] =
      await Promise.all([
        supabase
          .from("business_services")
          .select("id, name, pricing_type, price_minor, duration_minutes, is_addon, is_package")
          .eq("business_id", business.id)
          .eq("is_active", true),
        supabase
          .from("business_availability")
          .select("day_of_week, specific_date, start_time, end_time, is_available")
          .eq("business_id", business.id),
        supabase.from("service_areas").select("state").eq("business_id", business.id),
      ]);
    if (servicesError) throw new AppError("INTERNAL", "Could not load services.", { cause: servicesError });

    const selection = resolveSelection(services ?? [], input);
    if (!selection.ok) {
      return selection.field
        ? { status: "error", fieldErrors: { [selection.field]: selection.message } }
        : { status: "error", message: selection.message };
    }

    const servedStates = [...new Set((areas ?? []).map((area) => area.state))];
    if (servedStates.length > 0 && !servesState(servedStates, input.state)) {
      return {
        status: "error",
        fieldErrors: { state: `${business.name} works in ${servedStates.join(", ")} only.` },
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
        .in("status", busyStatuses)
        .gte("scheduled_start", dayStart.toISOString())
        .lt("scheduled_start", new Date(dayStart.getTime() + 86_400_000).toISOString());
      if ((count ?? 0) >= business.max_bookings_per_day) {
        return {
          status: "error",
          fieldErrors: { date: "The business is fully booked that day. Pick another date." },
        };
      }
    }

    const quote = priceBooking(services ?? [], selection.lines, await getBookingFeeRule());
    const isQuote = input.mode === "quote" || quote.needsQuote;
    const duration =
      selection.lines.reduce((sum, line) => {
        const service = services?.find((s) => s.id === line.serviceId);
        return sum + (service?.duration_minutes ?? 0) * line.quantity;
      }, 0) || DEFAULT_DURATION_MINUTES;

    const start = lagosDateTime(input.date, input.time);
    const end = new Date(start.getTime() + duration * 60_000);

    const admin = createAdminClient();
    // The commission is whatever an admin has set: the business's custom rate or the platform rate.
    const [{ data: private_ }, { data: commission, error: commissionError }] = await Promise.all([
      admin.from("businesses").select("owner_id").eq("id", business.id).single(),
      admin.rpc("current_commission_rate_bps", { p_business_id: business.id }),
    ]);
    if (commissionError || commission === null)
      throw new AppError("INTERNAL", "The platform commission isn't set.", { cause: commissionError });

    // The booking and its items are created together, then sent to the business.
    const { data: created, error: createError } = await admin
      .rpc("create_booking", {
        p_booking: {
          customer_id: customer.id,
          business_id: business.id,
          scheduled_start: start.toISOString(),
          scheduled_end: end.toISOString(),
          address_line: input.addressLine,
          area: input.area,
          city: input.city,
          state: input.state,
          guests: input.guests ?? null,
          customer_notes: input.notes ?? null,
          needs_quote: isQuote,
          subtotal_minor: quote.subtotalMinor,
          platform_fee_minor: quote.platformFeeMinor,
          total_minor: quote.totalMinor,
          commission_rate_bps: commission,
          // Retries of this same submission get the booking it already made.
          request_key: z.guid().safeParse(formData.get("requestKey")).data ?? null,
        },
        p_items: quote.items.map((item, index) => ({
          service_id: item.serviceId,
          name: item.name,
          unit_price_minor: item.unitPriceMinor,
          quantity: item.quantity,
          kind: selection.lines[index]?.kind ?? "service",
        })),
      })
      .single();
    if (createError?.code === "23505")
      return {
        status: "error",
        message: `You already have a booking with ${business.name} at that time. You can find it in My bookings.`,
      };
    if (createError || !created)
      throw new AppError("INTERNAL", "Could not create the booking.", { cause: createError });

    if (created.created && private_?.owner_id) {
      await notify({
        userId: private_.owner_id,
        type: isQuote ? "booking.quote_requested" : "booking.requested",
        title: isQuote ? "New quote request" : "New booking request",
        body: `${customer.fullName ?? "A customer"} sent ${created.reference}.`,
        data: { bookingId: created.id },
      });
    }
    bookingId = created.id;
  } catch (error) {
    return toFormError(error, "We couldn't send your request. Please try again.");
  }
  redirect(`/account/bookings/${bookingId}?sent=1`);
}

/** "Lagos State" and "lagos" are the same state. */
function servesState(served: string[], state: string): boolean {
  const normalise = (value: string) =>
    value
      .toLowerCase()
      .replace(/\bstate\b/g, "")
      .replace(/[^a-z]/g, "");
  const wanted = normalise(state);
  return served.some((s) => normalise(s) === wanted || (wanted === "fct" && normalise(s) === "abuja"));
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
    await moveBooking({
      bookingId: booking.id,
      from: booking.status,
      to: "cancelled",
      actorId: customer.id,
      changes: { cancelled_by: customer.id, cancellation_reason: input.reason ?? null },
      scope: { customerId: customer.id },
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
    await enforceRateLimit("booking.change", customer.id);
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
    await updateBookingDetails({
      bookingId: booking.id,
      expectedStatus: booking.status,
      actorId: customer.id,
      changes: {
        scheduled_start: start.toISOString(),
        scheduled_end: new Date(start.getTime() + previousDuration).toISOString(),
      },
      scope: { customerId: customer.id },
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
    await moveBooking({
      bookingId: booking.id,
      from: "quoted",
      to: "accepted",
      actorId: customer.id,
      note: "Quote accepted",
      scope: { customerId: customer.id },
    });
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
