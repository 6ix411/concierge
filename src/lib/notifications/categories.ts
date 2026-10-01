/** How notification categories are named in the notification centre. */
export const notificationCategories = {
  booking: "Bookings",
  payment: "Payments",
  message: "Messages",
  review: "Reviews",
  dispute: "Disputes",
  business: "Business",
  verification: "Verification",
  payout: "Payouts",
  account: "Account",
  chat: "Chat reports",
} as const;

export type NotificationCategory = keyof typeof notificationCategories;

export function categoryLabel(category: string | null): string {
  return (category && notificationCategories[category as NotificationCategory]) || "Updates";
}
