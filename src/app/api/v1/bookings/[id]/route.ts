import { apiRoute, idParam, requireApiUser } from "@/lib/api/v1";
import { getCustomerBooking } from "@/lib/bookings/queries";
import { getBusinessBooking } from "@/lib/business/booking-queries";
import { getOwnBusiness } from "@/lib/business/queries";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** One booking, if it is the customer's own or for the signed-in owner's business. */
export const GET = apiRoute(async (_request: Request, ctx: RouteContext<"/api/v1/bookings/[id]">) => {
  const user = await requireApiUser();
  const id = idParam((await ctx.params).id);
  let booking = null;
  if (user.role === "customer") booking = await getCustomerBooking(user.id, id);
  if (user.role === "business") {
    const business = await getOwnBusiness(user.id);
    booking = business ? await getBusinessBooking(id, business.id) : null;
  }
  if (!booking) throw new AppError("NOT_FOUND", "Not found.");
  return booking;
});
