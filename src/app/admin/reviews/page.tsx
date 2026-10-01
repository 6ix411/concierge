import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";

import { AdminActionForm } from "@/components/admin/action-form";
import { FilterTabs, PageHeader } from "@/components/admin/dashboard-widgets";
import { Stars } from "@/components/marketplace/rating";
import { Badge, EmptyState } from "@/components/ui";
import { moderateReviewAction } from "@/lib/admin/review-actions";
import { adminHref } from "@/lib/auth/admin-path";
import { requireAreaAccess } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Reviews" };

const filters = [
  { key: "all", label: "All" },
  { key: "low", label: "1–2 stars" },
  { key: "hidden", label: "Hidden" },
] as const;

export default async function AdminReviewsPage({ searchParams }: PageProps<"/admin/reviews">) {
  await requireAreaAccess("admin");
  const params = await searchParams;
  const filter = filters.find((f) => f.key === params.status) ?? filters[0];
  const businessId = z.guid().safeParse(params.business).data;

  let query = createAdminClient()
    .from("reviews")
    .select(
      "id, rating, comment, business_reply, status, created_at, booking_id, business:businesses(id, name), customer:users!reviews_customer_id_fkey(id, full_name)",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (filter.key === "low") query = query.lte("rating", 2);
  if (filter.key === "hidden") query = query.eq("status", "hidden");
  if (businessId) query = query.eq("business_id", businessId);
  const { data, error } = await query;
  if (error) throw new AppError("INTERNAL", "Could not load reviews.", { cause: error });
  const reviews = data ?? [];
  const scope = businessId ? `&business=${businessId}` : "";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reviews"
        description="Hide reviews that break the guidelines. Hidden reviews don’t count towards ratings."
      />
      <FilterTabs
        label="Filter reviews"
        current={filter.key}
        tabs={filters.map((f) => ({
          key: f.key,
          label: f.label,
          href: adminHref(`/reviews?status=${f.key}${scope}`),
        }))}
      />
      {businessId && (
        <p className="text-sm text-muted">
          Showing one business’s reviews.{" "}
          <Link href={adminHref(`/reviews?status=${filter.key}`)} className="font-medium hover:underline">
            Show all
          </Link>
        </p>
      )}
      {reviews.length === 0 ? (
        <EmptyState title="No reviews here" />
      ) : (
        <ul className="flex flex-col gap-3">
          {reviews.map((review) => (
            <li
              key={review.id}
              className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Stars value={review.rating} />
                  <Link
                    href={adminHref(`/businesses/${review.business?.id}`)}
                    className="font-medium hover:underline"
                  >
                    {review.business?.name}
                  </Link>
                  <span className="text-muted">
                    by{" "}
                    <Link href={adminHref(`/users/${review.customer?.id}`)} className="hover:underline">
                      {review.customer?.full_name ?? "a customer"}
                    </Link>{" "}
                    · {formatDate(review.created_at)}
                  </span>
                </div>
                {review.status === "hidden" && <Badge tone="danger">Hidden</Badge>}
              </div>
              {review.comment && <p className="text-sm whitespace-pre-line">{review.comment}</p>}
              {review.business_reply && (
                <p className="border-l-2 border-border pl-3 text-sm text-muted">
                  <span className="font-medium">Business reply:</span> {review.business_reply}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                {review.status === "published" ? (
                  <AdminActionForm
                    key="hide"
                    action={moderateReviewAction.bind(null, "hide")}
                    fields={{ reviewId: review.id }}
                    label="Hide review"
                    variant="outline"
                    reason={{ label: "Why is it hidden? (the reviewer will see this)", required: true }}
                  />
                ) : (
                  <AdminActionForm
                    key="publish"
                    action={moderateReviewAction.bind(null, "publish")}
                    fields={{ reviewId: review.id }}
                    label="Publish again"
                  />
                )}
                <Link
                  href={adminHref(`/bookings/${review.booking_id}`)}
                  className="text-sm text-muted hover:underline"
                >
                  View booking
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
