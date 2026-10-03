import { apiRoute } from "@/lib/api/v1";
import { searchBusinesses } from "@/lib/marketplace/queries";
import { PAGE_SIZE, parseSearchParams } from "@/lib/marketplace/search-params";

export const dynamic = "force-dynamic";

/**
 * Search verified providers (the same engine and rules as the website's search: approved, active
 * businesses on the platform only). Public. Query: q, category, location, date, guests, max (₦),
 * sort, page.
 */
export const GET = apiRoute(async (request: Request) => {
  const raw = Object.fromEntries(new URL(request.url).searchParams);
  const params = parseSearchParams(raw);
  const results = await searchBusinesses(params);
  return {
    results: results.slice(0, PAGE_SIZE),
    page: params.page,
    hasMore: results.length > PAGE_SIZE,
  };
});
