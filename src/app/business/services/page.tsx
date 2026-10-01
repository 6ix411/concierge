import type { Metadata } from "next";

import { ServicesManager } from "@/components/business/services-manager";
import { getCategoryOptions } from "@/lib/business/categories";
import { listOwnServices, requireOwnBusiness } from "@/lib/business/queries";

export const metadata: Metadata = { title: "Services" };

export default async function BusinessServicesPage() {
  const { business } = await requireOwnBusiness();
  const [services, categories] = await Promise.all([listOwnServices(business.id), getCategoryOptions()]);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Services</h1>
        <p className="mt-1 text-muted">
          Services, packages and add-ons with their prices. Price changes apply to new bookings only.
        </p>
      </div>
      <ServicesManager services={services} categories={categories} />
    </div>
  );
}
