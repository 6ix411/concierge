import { apiRoute } from "@/lib/api/v1";
import { getCategories } from "@/lib/marketplace/queries";

export const dynamic = "force-dynamic";

/** Service categories with their sub-categories. Public. */
export const GET = apiRoute(async () => getCategories());
