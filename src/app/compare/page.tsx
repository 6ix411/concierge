import type { Metadata } from "next";
import Link from "next/link";

import { Container } from "@/components/layout/container";
import { BusinessAvatar } from "@/components/marketplace/business-avatar";
import { Rating } from "@/components/marketplace/rating";
import { priceLabel } from "@/components/marketplace/service-list";
import { VerifiedBadge } from "@/components/marketplace/verified-badge";
import { EmptyState, LinkButton } from "@/components/ui";
import { getBusinessBySlug } from "@/lib/marketplace/queries";

export const metadata: Metadata = { title: "Compare providers" };

export default async function ComparePage({ searchParams }: PageProps<"/compare">) {
  const { ids } = await searchParams;
  const slugs = [...new Set((Array.isArray(ids) ? ids : ids ? [ids] : []).flatMap((v) => v.split(",")))]
    .filter((slug) => /^[a-z0-9-]{1,80}$/.test(slug))
    .slice(0, 4);
  const businesses = (await Promise.all(slugs.map((slug) => getBusinessBySlug(slug)))).filter(
    (b): b is NonNullable<typeof b> => b !== null,
  );

  if (businesses.length < 2) {
    return (
      <Container className="py-10">
        <EmptyState
          title="Pick at least two providers to compare"
          description="Tick “Compare” on search or concierge results, then press Compare selected."
          action={
            <LinkButton href="/search" variant="outline">
              Find providers
            </LinkButton>
          }
        />
      </Container>
    );
  }

  const rows: { label: string; render: (b: (typeof businesses)[number]) => React.ReactNode }[] = [
    { label: "Rating", render: (b) => <Rating value={Number(b.rating_avg)} count={b.rating_count} /> },
    { label: "Category", render: (b) => b.primary_category?.name ?? "—" },
    {
      label: "Areas",
      render: (b) => [...new Set(b.areas.map((a) => a.area ?? a.city ?? a.state))].join(", ") || "—",
    },
    {
      label: "Services",
      render: (b) => (
        <ul className="flex flex-col gap-1">
          {b.services.slice(0, 4).map((s) => (
            <li key={s.id}>
              <span className="block">{s.name}</span>
              <span className="text-muted">{priceLabel(s)}</span>
            </li>
          ))}
        </ul>
      ),
    },
    {
      label: "Reviews",
      render: (b) => `${b.rating_count} verified review${b.rating_count === 1 ? "" : "s"}`,
    },
  ];

  return (
    <Container className="flex flex-col gap-6 py-6 sm:py-10">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Compare providers</h1>
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {/* On phones two providers fit side by side; more scroll sideways under the fixed labels. */}
        <table
          className="w-full border-separate border-spacing-0 text-left text-sm"
          style={{ minWidth: 80 + businesses.length * 140 }}
        >
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 w-20 bg-background sm:w-28" />
              {businesses.map((b) => (
                <th
                  key={b.id}
                  scope="col"
                  className="border-b border-border p-2 align-top font-normal sm:p-3"
                >
                  <div className="flex flex-col gap-2">
                    <BusinessAvatar name={b.name} logoPath={b.logo_path} size="sm" />
                    <Link href={`/businesses/${b.slug}`} className="font-semibold hover:underline">
                      {b.name}
                    </Link>
                    {b.is_verified && <VerifiedBadge />}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-b border-border bg-background py-2 pr-2 align-top text-xs font-medium text-muted sm:p-3 sm:text-sm"
                >
                  {row.label}
                </th>
                {businesses.map((b) => (
                  <td key={b.id} className="border-b border-border p-2 align-top sm:p-3">
                    {row.render(b)}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td className="sticky left-0 z-10 bg-background" />
              {businesses.map((b) => (
                <td key={b.id} className="p-2 sm:p-3">
                  <LinkButton href={`/book/${b.slug}`} size="sm" className="w-full sm:w-auto">
                    Book
                  </LinkButton>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </Container>
  );
}
