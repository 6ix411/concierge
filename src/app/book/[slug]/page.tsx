import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BookingForm } from "@/components/bookings/booking-form";
import { Container } from "@/components/layout/container";
import { AvailabilityTable } from "@/components/marketplace/availability-table";
import { BusinessAvatar } from "@/components/marketplace/business-avatar";
import { VerifiedBadge } from "@/components/marketplace/verified-badge";
import { requireAreaAccess } from "@/lib/auth/session";
import { createBookingAction } from "@/lib/bookings/actions";
import { formatBookingLocation } from "@/lib/bookings/workflow";
import { addDays, lagosToday } from "@/lib/dates";
import { getBusinessBySlug } from "@/lib/marketplace/queries";
import { getBookingFeeRule } from "@/lib/revenue/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Book" };

export default async function BookPage({ params, searchParams }: PageProps<"/book/[slug]">) {
  const user = await requireAreaAccess("account");
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) notFound();

  const { service, quote, date } = await searchParams;
  const preselected = (Array.isArray(service) ? service : service ? [service] : []).filter((id) =>
    business.services.some((s) => s.id === id),
  );

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("customer_profiles")
    .select("address_line, city, state")
    .eq("user_id", user.id)
    .maybeSingle();

  const bookingFee = await getBookingFeeRule();
  const today = lagosToday();
  // Earliest day that respects the business's notice period (the server checks the exact time).
  const minDate = addDays(today, Math.max(1, Math.ceil(business.min_notice_hours / 24)));
  const maxDate = addDays(today, business.booking_window_days);
  // The concierge can hand over a date; it's only a starting value the customer can change.
  const presetDate =
    typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= minDate && date <= maxDate
      ? date
      : undefined;
  return (
    <Container className="grid gap-8 pt-6 pb-24 sm:pt-10 md:pb-10 lg:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <BusinessAvatar name={business.name} logoPath={business.logo_path} size="sm" />
          <div>
            <p className="text-sm text-muted">Booking with</p>
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/businesses/${business.slug}`} className="font-semibold hover:underline">
                {business.name}
              </Link>
              {business.is_verified && <VerifiedBadge />}
            </div>
          </div>
        </div>
        {user.role !== "customer" ? (
          <p className="text-muted">Bookings are made from customer accounts.</p>
        ) : !business.accepting_bookings ? (
          <p className="rounded-xl bg-surface-muted px-4 py-3 text-muted">
            {business.name} isn’t taking new bookings right now. Check back soon.
          </p>
        ) : (
          <BookingForm
            action={createBookingAction.bind(null, business.slug)}
            services={business.services}
            preselected={preselected}
            quoteMode={quote === "1" || business.services.length === 0}
            minDate={minDate}
            maxDate={maxDate}
            defaults={{
              addressLine: profile?.address_line ?? undefined,
              city: profile?.city ?? undefined,
              state: profile?.state ?? undefined,
              date: presetDate,
            }}
            serviceAreas={business.areas.map((area) =>
              formatBookingLocation({ address_line: null, ...area }),
            )}
            bookingFee={bookingFee}
          />
        )}
      </div>
      <aside className="h-fit rounded-2xl border border-border bg-surface p-4">
        <h2 className="font-semibold">When they work</h2>
        <div className="mt-2">
          <AvailabilityTable rules={business.availability} />
        </div>
      </aside>
    </Container>
  );
}
