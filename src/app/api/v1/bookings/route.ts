import { apiRoute, readJson, requireApiUser, runFormAction } from "@/lib/api/v1";
import { createBookingAction } from "@/lib/bookings/actions";
import { listCustomerBookings } from "@/lib/bookings/queries";
import { bookingTabs, listBusinessBookings, type BookingTab } from "@/lib/business/booking-queries";
import { getOwnBusiness } from "@/lib/business/queries";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * The account's bookings. Customers: ?view=upcoming|past. Businesses: ?tab=requests|upcoming|past
 * (with the customer's name only, never their contact details).
 */
export const GET = apiRoute(async (request: Request) => {
  const user = await requireApiUser();
  const params = new URL(request.url).searchParams;
  if (user.role === "customer")
    return listCustomerBookings(user.id, params.get("view") === "past" ? "past" : "upcoming");
  if (user.role === "business") {
    const business = await getOwnBusiness(user.id);
    if (!business) throw new AppError("NOT_FOUND", "Register your business first.");
    const tab = (params.get("tab") ?? "requests") as BookingTab;
    return listBusinessBookings(business.id, tab in bookingTabs ? tab : "requests");
  }
  throw new AppError("FORBIDDEN", "Bookings are for customers and businesses.");
});

/**
 * Ask a business for a booking or a quote (customers). Body: { business (slug), mode: "book" |
 * "quote", serviceIds, packageId?, quantities?: { [serviceId]: n }, date, time, addressLine, area,
 * city, state, guests?, notes?, requestKey }. Prices always come from the database. Send the same
 * requestKey (a UUID made once per request) when retrying, so a lost reply never books twice.
 */
export const POST = apiRoute(async (request: Request) => {
  const user = await requireApiUser();
  if (user.role !== "customer") throw new AppError("FORBIDDEN", "Only customers can book.");
  const { business, quantities, ...fields } = await readJson(request);
  if (typeof business !== "string") throw new AppError("BAD_REQUEST", "Say which business (its slug).");
  const quantityFields =
    quantities && typeof quantities === "object" && !Array.isArray(quantities)
      ? Object.fromEntries(Object.entries(quantities).map(([id, n]) => [`quantity-${id}`, n]))
      : {};
  const result = await runFormAction(createBookingAction.bind(null, business), {
    ...fields,
    ...quantityFields,
  });
  const id = result.path?.match(/\/account\/bookings\/([0-9a-f-]{36})/)?.[1];
  if (!id) throw new AppError("INTERNAL", "The booking was not created.");
  return { id };
});
