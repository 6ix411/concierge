import { apiRoute, idParam, readJson, requireApiUser, runFormAction } from "@/lib/api/v1";
import { acceptQuoteAction, cancelBookingAction, rescheduleBookingAction } from "@/lib/bookings/actions";
import { sendQuoteAction, updateBookingStatusAction } from "@/lib/business/booking-actions";
import { AppError } from "@/lib/errors";
import { startCheckoutAction } from "@/lib/payments/actions";
import { submitReviewAction } from "@/lib/reviews/actions";

export const dynamic = "force-dynamic";

type Run = (bookingId: string, body: Record<string, unknown>) => Promise<unknown>;

/** What a customer can do with their booking. */
const customerActions: Record<string, Run> = {
  // Body: { reason? }
  cancel: (bookingId, body) => runFormAction(cancelBookingAction, { ...body, bookingId }),
  // Body: { date: "YYYY-MM-DD", time: "HH:MM" }
  reschedule: (bookingId, body) => runFormAction(rescheduleBookingAction, { ...body, bookingId }),
  "accept-quote": (bookingId) => runFormAction(acceptQuoteAction, { bookingId }),
  // Opens the payment provider's checkout: send the customer to `checkoutUrl` in a browser view.
  // The booking is confirmed only after the payment is verified with the provider on our server.
  pay: async (bookingId) => {
    const state = await startCheckoutAction(bookingId, { status: "idle" });
    if (state.status !== "success" || !state.redirectTo)
      throw new AppError("BAD_REQUEST", state.message ?? "This booking isn't ready for payment.");
    return { checkoutUrl: state.redirectTo };
  },
  // Body: { rating: 1-5, comment? } (only after the job is completed)
  review: (bookingId, body) =>
    runFormAction(submitReviewAction, { rating: body.rating, comment: body.comment, bookingId }),
};

/** What a business can do with a booking for their business. */
const businessActions: Record<string, Run> = {
  accept: (bookingId) => runFormAction(updateBookingStatusAction.bind(null, "accept"), { bookingId }),
  // Body: { reason } (required)
  decline: (bookingId, body) =>
    runFormAction(updateBookingStatusAction.bind(null, "decline"), { reason: body.reason, bookingId }),
  start: (bookingId) => runFormAction(updateBookingStatusAction.bind(null, "start"), { bookingId }),
  complete: (bookingId) => runFormAction(updateBookingStatusAction.bind(null, "complete"), { bookingId }),
  // Body: { reason } (required)
  cancel: (bookingId, body) =>
    runFormAction(updateBookingStatusAction.bind(null, "cancel"), { reason: body.reason, bookingId }),
  // Body: { amount (₦), notes? }
  quote: (bookingId, body) =>
    runFormAction(sendQuoteAction, { amount: body.amount, notes: body.notes, bookingId }),
};

/**
 * POST /api/v1/bookings/{id}/{action}. The same checks as the website decide whether the action is
 * allowed for this booking in its current status.
 */
export const POST = apiRoute(
  async (request: Request, ctx: RouteContext<"/api/v1/bookings/[id]/[action]">) => {
    const user = await requireApiUser();
    const params = await ctx.params;
    const bookingId = idParam(params.id);
    const actions =
      user.role === "customer" ? customerActions : user.role === "business" ? businessActions : {};
    const run = Object.hasOwn(actions, params.action) ? actions[params.action] : undefined;
    if (!run) throw new AppError("NOT_FOUND", "Not found.");
    const body = request.headers.get("content-type")?.includes("application/json")
      ? await readJson(request)
      : {};
    return (await run(bookingId, body)) ?? { ok: true };
  },
);
