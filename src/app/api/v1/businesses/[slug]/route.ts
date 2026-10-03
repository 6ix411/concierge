import { apiRoute } from "@/lib/api/v1";
import { AppError } from "@/lib/errors";
import { getBusinessBySlug } from "@/lib/marketplace/queries";

export const dynamic = "force-dynamic";

/** A provider's public profile: services, areas, availability, portfolio and reviews. Public. */
export const GET = apiRoute(async (_request: Request, ctx: RouteContext<"/api/v1/businesses/[slug]">) => {
  const slug = (await ctx.params).slug;
  const business = /^[a-z0-9-]{1,120}$/.test(slug) ? await getBusinessBySlug(slug) : null;
  if (!business) throw new AppError("NOT_FOUND", "Not found.");
  return business;
});
