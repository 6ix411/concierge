import type { UserRole } from "@/types/roles";

type Data = Record<string, unknown>;

const str = (data: Data, key: string) => (typeof data[key] === "string" ? (data[key] as string) : null);

/**
 * Where a notification takes its reader, from its type and the ids it carries. Paths under the
 * admin dashboard are returned relative ("reviews?status=reported"); the caller wraps them with
 * adminHref() so the private admin URL never appears in shared code.
 */
export function notificationTarget(
  notification: { type: string; data: unknown },
  role: UserRole,
): { path: string; admin: boolean } | null {
  const data: Data =
    notification.data && typeof notification.data === "object" && !Array.isArray(notification.data)
      ? (notification.data as Data)
      : {};
  const [category, event] = notification.type.split(".");
  const bookingId = str(data, "bookingId");
  const conversationId = str(data, "conversationId");

  if (role === "admin") {
    const admin = (path: string) => ({ path, admin: true });
    if (str(data, "disputeId")) return admin(`disputes/${str(data, "disputeId")}`);
    if (category === "chat") return admin("reports");
    if (category === "review") return admin("reviews?status=reported");
    if (category === "business" || category === "verification") {
      const id = str(data, "businessId");
      return admin(id ? `businesses/${id}` : "businesses");
    }
    if (bookingId) return admin(`bookings/${bookingId}`);
    return admin("");
  }

  const area = role === "business" ? "/business" : "/account";
  const page = (path: string) => ({ path, admin: false });
  if (category === "message" && conversationId) return page(`${area}/messages/${conversationId}`);
  if (category === "account" && event === "welcome")
    return page(role === "business" ? "/business/setup" : "/concierge");
  if (category === "dispute" && bookingId) return page(`${area}/bookings/${bookingId}/dispute`);
  if (category === "review") {
    if (role === "business") return page("/business/reviews");
    if (event === "request" && bookingId) return page(`/account/bookings/${bookingId}/review`);
    return page("/account/reviews");
  }
  if (category === "payout") return page("/business/earnings");
  if (category === "billing")
    return page(event?.startsWith("featured") ? "/business/promote" : "/business/plan");
  if (category === "verification") return page("/business/verification");
  if (category === "business") return page("/business");
  if (bookingId) return page(`${area}/bookings/${bookingId}`);
  return null;
}
