import type { Metadata } from "next";

import { DetailsForm } from "@/components/business/details-form";
import { BrandImages, PortfolioManager } from "@/components/business/media-manager";
import { ServiceAreasEditor } from "@/components/business/service-areas-editor";
import { LinkButton } from "@/components/ui";
import { updateBusinessDetailsAction } from "@/lib/business/actions";
import { getCategoryOptions } from "@/lib/business/categories";
import { listPortfolio, listServiceAreas, requireOwnBusiness } from "@/lib/business/queries";

export const metadata: Metadata = { title: "Business profile" };

export default async function BusinessProfileSettingsPage() {
  const { business } = await requireOwnBusiness();
  const [categories, areas, portfolio] = await Promise.all([
    getCategoryOptions(),
    listServiceAreas(business.id),
    listPortfolio(business.id),
  ]);

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
          <p className="mt-1 text-muted">What customers see on your public page.</p>
        </div>
        {business.status === "approved" && (
          <LinkButton href={`/businesses/${business.slug}`} variant="outline" size="sm">
            View public profile
          </LinkButton>
        )}
      </div>

      <section aria-labelledby="brand-heading" className="flex flex-col gap-4">
        <h2 id="brand-heading" className="text-lg font-semibold">
          Logo and cover
        </h2>
        <BrandImages
          businessId={business.id}
          name={business.name}
          logoPath={business.logo_path}
          coverPath={business.cover_path}
        />
      </section>

      <section aria-labelledby="details-heading" className="flex flex-col gap-4">
        <h2 id="details-heading" className="text-lg font-semibold">
          Business information
        </h2>
        <DetailsForm action={updateBusinessDetailsAction} categories={categories} defaults={business} />
      </section>

      <section aria-labelledby="areas-heading" className="flex flex-col gap-4">
        <h2 id="areas-heading" className="text-lg font-semibold">
          Service areas
        </h2>
        <ServiceAreasEditor areas={areas} defaultState={business.state} />
      </section>

      <section aria-labelledby="portfolio-heading" className="flex flex-col gap-4">
        <h2 id="portfolio-heading" className="text-lg font-semibold">
          Portfolio
        </h2>
        <PortfolioManager businessId={business.id} items={portfolio} />
      </section>
    </div>
  );
}
