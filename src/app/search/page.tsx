import type { Metadata } from "next";

import { Container } from "@/components/layout/container";
import { ResultsList } from "@/components/marketplace/results-list";
import { SearchFilters } from "@/components/marketplace/search-filters";
import { getCategories, searchBusinesses } from "@/lib/marketplace/queries";
import { parseSearchParams } from "@/lib/marketplace/search-params";

export const metadata: Metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const raw = await searchParams;
  const params = parseSearchParams(raw);
  const [categories, results] = await Promise.all([getCategories(), searchBusinesses(params)]);

  const pageHref = (page: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(raw))
      if (typeof value === "string" && value) next.set(key, value);
    next.set("page", String(page));
    return `/search?${next.toString()}`;
  };

  return (
    <Container className="flex flex-col gap-6 py-6 sm:py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Find a provider</h1>
        <p className="mt-1 text-muted">Every business here is verified by Concierge.</p>
      </div>
      <SearchFilters
        categories={categories}
        values={{
          q: params.query ?? undefined,
          category: params.category ?? undefined,
          location: params.location ?? undefined,
          date: params.date ?? undefined,
          guests: params.guests ? String(params.guests) : undefined,
          max: params.maxNaira,
          sort: params.sort,
        }}
      />
      <ResultsList
        results={results}
        page={params.page}
        pageHref={pageHref}
        needs={{
          location: params.location ?? null,
          date: params.date ?? null,
          time: null,
          guests: params.guests ?? null,
          budgetMinor: params.maxPriceMinor ?? null,
        }}
      />
    </Container>
  );
}
