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
import { addDays, lagosToday } from "@/lib/dates";
import { getBusinessBySlug } from "@/lib/marketplace/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Book" };

export default async function BookPage({ params, searchParams }: PageProps<"/book/[slug]">) {
  const user = await requireAreaAccess("account");
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) notFound();

  const { service, quote } = await searchParams;
  const preselected = (Array.isArray(service) ? service : service ? [service] : []).filter((id) =>
    business.services.some((s) => s.id === id),
  );

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("customer_profiles")
    .select("address_line, city, state")
    .eq("user_id", user.id)
    .maybeSingle();

  const today = lagosToday();
  return (
    <Container className="grid gap-8 py-6 sm:py-10 lg:grid-cols-[1fr_320px]">
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
        ) : (
          <BookingForm
            action={createBookingAction.bind(null, business.slug)}
            services={business.services}
            preselected={preselected}
            quoteMode={quote === "1" || business.services.length === 0}
            minDate={addDays(today, 1)}
            maxDate={addDays(today, 365)}
            defaults={{
              addressLine: profile?.address_line ?? undefined,
              area: profile?.city ?? undefined,
              state: profile?.state ?? undefined,
            }}
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
