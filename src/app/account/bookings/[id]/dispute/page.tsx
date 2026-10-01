import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DisputeCaseView } from "@/components/disputes/dispute-case";
import { requireAreaAccess } from "@/lib/auth/session";
import { getDisputeCase } from "@/lib/disputes/queries";

export const metadata: Metadata = { title: "Dispute" };

export default async function CustomerDisputePage({ params }: PageProps<"/account/bookings/[id]/dispute">) {
  const user = await requireAreaAccess("account");
  const { id } = await params;
  const data = await getDisputeCase(id);
  if (!data || data.booking.customer_id !== user.id) notFound();
  return (
    <DisputeCaseView
      data={data}
      viewer="customer"
      viewerId={user.id}
      bookingHref={`/account/bookings/${id}`}
    />
  );
}
