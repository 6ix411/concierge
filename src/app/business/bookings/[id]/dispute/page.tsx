import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DisputeCaseView } from "@/components/disputes/dispute-case";
import { requireOwnBusiness } from "@/lib/business/queries";
import { getDisputeCase } from "@/lib/disputes/queries";
import { pageId } from "@/lib/security/ids";

export const metadata: Metadata = { title: "Dispute" };

export default async function BusinessDisputePage({ params }: PageProps<"/business/bookings/[id]/dispute">) {
  const { user, business } = await requireOwnBusiness();
  const id = pageId((await params).id);
  const data = await getDisputeCase(id);
  if (!data || data.booking.business_id !== business.id) notFound();
  return (
    <DisputeCaseView
      data={data}
      viewer="business"
      viewerId={user.id}
      bookingHref={`/business/bookings/${id}`}
    />
  );
}
