import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Container } from "@/components/layout/container";
import { ResultsList } from "@/components/marketplace/results-list";
import { SearchFilters } from "@/components/marketplace/search-filters";
import { getCategories, searchBusinesses } from "@/lib/marketplace/queries";
import { parseSearchParams } from "@/lib/marketplace/search-params";

async function findCategory(slug: string) {
  const categories = await getCategories();
  for (const parent of categories) {
    if (parent.slug === slug) return { category: parent, parent: null, categories };
    const child = parent.children.find((c) => c.slug === slug);
    if (child) return { category: { ...child, children: [] }, parent, categories };
  }
  return null;
}

export async function generateMetadata({ params }: PageProps<"/services/[slug]">): Promise<Metadata> {
  const found = await findCategory((await params).slug);
  return { title: found?.category.name ?? "Services" };
}

export default async function CategoryPage({ params, searchParams }: PageProps<"/services/[slug]">) {
  const { slug } = await params;
  const found = await findCategory(slug);
  if (!found) notFound();
  const { category, parent, categories } = found;

  const raw = await searchParams;
  const filters = parseSearchParams(raw);
  const results = await searchBusinesses({ ...filters, category: slug });

  const pageHref = (page: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(raw))
      if (typeof value === "string" && value) next.set(key, value);
    next.set("page", String(page));
    return `/services/${slug}?${next.toString()}`;
  };

  return (
    <Container className="flex flex-col gap-6 py-6 sm:py-10">
      <div>
        <nav aria-label="Breadcrumb" className="mb-2 text-sm text-muted">
          <Link href="/services" className="hover:underline">
            Services
          </Link>
          {parent && (
            <>
              {" / "}
              <Link href={`/services/${parent.slug}`} className="hover:underline">
                {parent.name}
              </Link>
            </>
          )}
        </nav>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{category.name}</h1>
        {category.description && <p className="mt-1 text-muted">{category.description}</p>}
        {category.children.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {category.children.map((child) => (
              <li key={child.id}>
                <Link
                  href={`/services/${child.slug}`}
                  className="inline-block rounded-full border border-border px-3 py-1 text-sm hover:bg-surface-muted"
                >
                  {child.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <SearchFilters
        categories={categories}
        action={`/services/${slug}`}
        hideCategory
        values={{
          q: filters.query ?? undefined,
          location: filters.location ?? undefined,
          date: filters.date ?? undefined,
          guests: filters.guests ? String(filters.guests) : undefined,
          max: filters.maxNaira,
          sort: filters.sort,
        }}
      />
      <ResultsList
        results={results}
        page={filters.page}
        pageHref={pageHref}
        needs={{
          location: filters.location ?? null,
          date: filters.date ?? null,
          time: null,
          guests: filters.guests ?? null,
          budgetMinor: filters.maxPriceMinor ?? null,
        }}
      />
    </Container>
  );
}
