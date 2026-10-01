import { BadgeCheck, CalendarCheck, CalendarX, MapPin, MessageCircle, Star, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";

import { Container } from "@/components/layout/container";
import { AvailabilityTable } from "@/components/marketplace/availability-table";
import { BusinessAvatar, BusinessCover } from "@/components/marketplace/business-avatar";
import { Rating } from "@/components/marketplace/rating";
import { completedLabel } from "@/components/marketplace/business-card";
import { RatingSummary, ReviewList } from "@/components/marketplace/review-list";
import { AddonList, ServiceList } from "@/components/marketplace/service-list";
import { VerifiedBadge } from "@/components/marketplace/verified-badge";
import { LinkButton } from "@/components/ui";
import { lagosToday, addDays } from "@/lib/dates";
import { formatDate, formatPriceRange } from "@/lib/format";
import { getBusinessBySlug } from "@/lib/marketplace/queries";
import { formatRequestDate } from "@/lib/matching/explain";
import { publicStorageUrl } from "@/lib/marketplace/storage";

export async function generateMetadata({ params }: PageProps<"/businesses/[slug]">): Promise<Metadata> {
  const business = await getBusinessBySlug((await params).slug);
  if (!business) return { title: "Business not found" };
  return { title: business.name, description: business.description?.slice(0, 160) };
}

export default async function BusinessProfilePage({ params }: PageProps<"/businesses/[slug]">) {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) notFound();

  const areas = [
    ...new Set(business.areas.map((a) => [a.area, a.city ?? a.state].filter(Boolean).join(", "))),
  ];
  const packages = business.services.filter((service) => service.is_package && !service.is_addon);
  const mainServices = business.services.filter((service) => !service.is_addon && !service.is_package);
  const price = formatPriceRange(business.stats.minPriceMinor, business.stats.maxPriceMinor);
  const location = [business.city, business.state].filter(Boolean).join(", ");
  const today = lagosToday();
  const daysOff = business.availability
    .filter(
      (rule) =>
        rule.specific_date &&
        !rule.is_available &&
        rule.specific_date >= today &&
        rule.specific_date <= addDays(today, 60),
    )
    .map((rule) => rule.specific_date!)
    .sort()
    .slice(0, 6);
  const notice =
    business.min_notice_hours >= 48
      ? `${Math.round(business.min_notice_hours / 24)} days`
      : `${business.min_notice_hours} hour${business.min_notice_hours === 1 ? "" : "s"}`;
  const addons = business.services.filter((service) => service.is_addon);
  const paused = !business.accepting_bookings;

  return (
    <Container className="flex flex-col gap-8 py-4 pb-28 sm:py-8 md:pb-10">
      <header className="flex flex-col gap-4">
        <BusinessCover name={business.name} coverPath={business.cover_path} />
        <div className="-mt-12 flex items-end gap-4 px-2 sm:-mt-14">
          <BusinessAvatar
            name={business.name}
            logoPath={business.logo_path}
            size="lg"
            className="ring-4 ring-background"
          />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{business.name}</h1>
            {business.is_verified && <VerifiedBadge />}
          </div>
          {business.is_verified && business.verified_at && (
            <p className="inline-flex items-center gap-1.5 text-sm text-muted">
              <BadgeCheck aria-hidden className="size-4 text-verified" />
              Documents checked by the Concierge team · verified {formatDate(business.verified_at)}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
            <Rating value={Number(business.rating_avg)} count={business.rating_count} />
            {business.primary_category && <span>{business.primary_category.name}</span>}
            {(business.city || business.state) && (
              <span className="inline-flex items-center gap-1">
                <MapPin aria-hidden className="size-3.5" />
                {[business.city, business.state].filter(Boolean).join(", ")}
              </span>
            )}
          </div>
          {business.description && <p className="max-w-2xl leading-relaxed">{business.description}</p>}
        </div>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-4">
          {[
            {
              icon: Star,
              label: "Rating",
              value:
                business.rating_count > 0
                  ? `${Number(business.rating_avg).toFixed(1)} from ${business.rating_count} review${business.rating_count === 1 ? "" : "s"}`
                  : "No reviews yet",
            },
            {
              icon: CalendarCheck,
              label: "On Concierge",
              value: completedLabel(business.stats.completedBookings),
            },
            {
              icon: Wallet,
              label: "Pricing",
              value: price ?? (business.stats.hasQuoteOnly ? "Price on request" : "Not listed"),
            },
            { icon: MapPin, label: "Based in", value: location || "Not listed" },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="flex flex-col gap-1 bg-surface p-3">
              <dt className="flex items-center gap-1.5 text-xs text-muted">
                <Icon aria-hidden className="size-3.5" />
                {label}
              </dt>
              <dd className="text-sm font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        {paused ? (
          <p className="rounded-xl bg-surface-muted px-4 py-3 text-sm text-muted">
            {business.name} isn’t taking new bookings right now. Check back soon.
          </p>
        ) : (
          <div className="hidden gap-2 md:flex">
            <LinkButton href={`/book/${business.slug}`} size="lg">
              Book now
            </LinkButton>
            <LinkButton href={`/book/${business.slug}?quote=1`} size="lg" variant="outline">
              Request a quote
            </LinkButton>
          </div>
        )}
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-8">
          <section aria-labelledby="services-heading" className="flex flex-col gap-3">
            <h2 id="services-heading" className="text-lg font-semibold">
              Services and prices
            </h2>
            {mainServices.length > 0 ? (
              <ServiceList
                services={mainServices}
                bookHref={(id) => `/book/${business.slug}?service=${id}`}
                bookable={!paused}
              />
            ) : packages.length > 0 ? (
              <p className="text-sm text-muted">This business offers packages only (below).</p>
            ) : (
              <p className="text-sm text-muted">
                This business hasn’t listed services yet. Request a quote instead.
              </p>
            )}
          </section>

          {packages.length > 0 && (
            <section aria-labelledby="packages-heading" className="flex flex-col gap-3">
              <div>
                <h2 id="packages-heading" className="text-lg font-semibold">
                  Packages
                </h2>
                <p className="text-sm text-muted">Bundles at one price, with everything they include.</p>
              </div>
              <ServiceList
                services={packages}
                bookHref={(id) => `/book/${business.slug}?service=${id}`}
                bookable={!paused}
              />
            </section>
          )}

          {addons.length > 0 && (
            <section aria-labelledby="addons-heading" className="flex flex-col gap-3">
              <div>
                <h2 id="addons-heading" className="text-lg font-semibold">
                  Add-ons
                </h2>
                <p className="text-sm text-muted">Optional extras you can add when you book a service.</p>
              </div>
              <AddonList addons={addons} />
            </section>
          )}

          <section aria-labelledby="portfolio-heading" className="flex flex-col gap-3">
            <h2 id="portfolio-heading" className="text-lg font-semibold">
              Portfolio
            </h2>
            {business.portfolio.length === 0 ? (
              <p className="text-sm text-muted">No photos or videos yet.</p>
            ) : (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {business.portfolio.map((item) => {
                  const url = publicStorageUrl("business-media", item.storage_path);
                  if (!url) return null;
                  return (
                    <li
                      key={item.id}
                      className="relative aspect-square overflow-hidden rounded-xl bg-surface-muted"
                    >
                      {item.media_type === "video" ? (
                        <video src={url} controls preload="metadata" className="size-full object-cover" />
                      ) : (
                        <Image
                          src={url}
                          alt={item.caption ?? `${business.name} portfolio`}
                          fill
                          sizes="(min-width: 640px) 33vw, 50vw"
                          className="object-cover"
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="reviews-heading" className="flex flex-col gap-3">
            <h2 id="reviews-heading" className="text-lg font-semibold">
              Reviews
            </h2>
            <RatingSummary
              average={Number(business.rating_avg)}
              count={business.rating_count}
              breakdown={business.stats.ratingBreakdown}
            />
            <ReviewList reviews={business.reviews} businessName={business.name} />
          </section>
        </div>

        <aside className="flex flex-col gap-6">
          <section
            aria-labelledby="areas-heading"
            className="rounded-2xl border border-border bg-surface p-4"
          >
            <h2 id="areas-heading" className="font-semibold">
              Service areas
            </h2>
            <p className="mt-2 text-sm text-muted">{areas.length > 0 ? areas.join(", ") : "Not listed"}</p>
          </section>
          <section
            aria-labelledby="hours-heading"
            className="rounded-2xl border border-border bg-surface p-4"
          >
            <h2 id="hours-heading" className="font-semibold">
              Availability
            </h2>
            <div className="mt-2">
              <AvailabilityTable rules={business.availability} />
            </div>
            <ul className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3 text-sm text-muted">
              <li>Book at least {notice} ahead.</li>
              <li>Takes bookings up to {business.booking_window_days} days ahead.</li>
              {paused && <li className="text-foreground">Not taking new bookings right now.</li>}
            </ul>
            {daysOff.length > 0 && (
              <div className="mt-3 border-t border-border pt-3">
                <p className="inline-flex items-center gap-1.5 text-sm font-medium">
                  <CalendarX aria-hidden className="size-4" />
                  Upcoming days off
                </p>
                <p className="mt-1 text-sm text-muted">{daysOff.map(formatRequestDate).join(" · ")}</p>
              </div>
            )}
          </section>
          <section className="rounded-2xl border border-border bg-surface p-4 text-sm text-muted">
            <p className="inline-flex items-center gap-2">
              <MessageCircle aria-hidden className="size-4 shrink-0" />
              Once your booking is confirmed, you can chat with this business directly on Concierge.
            </p>
          </section>
        </aside>
      </div>

      {!paused && (
        <div className="fixed inset-x-0 bottom-16 z-20 flex gap-2 border-t border-border bg-background/95 p-3 backdrop-blur md:hidden">
          <LinkButton href={`/book/${business.slug}`} className="flex-1">
            Book now
          </LinkButton>
          <LinkButton href={`/book/${business.slug}?quote=1`} variant="outline" className="flex-1">
            Get a quote
          </LinkButton>
        </div>
      )}
    </Container>
  );
}
