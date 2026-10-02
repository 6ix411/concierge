import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Container } from "@/components/layout/container";
import { CategoryIcon } from "@/components/marketplace/category-icon";
import { getCategories } from "@/lib/marketplace/queries";

export const metadata: Metadata = { title: "Services" };

export default async function ServicesPage() {
  const categories = await getCategories();

  return (
    <Container className="flex flex-col gap-6 py-6 sm:py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Services</h1>
        <p className="mt-1 text-muted">Browse by category. Every provider is verified.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {categories.map((category) => (
          <section key={category.id} className="rounded-2xl border border-border bg-surface p-4">
            <Link href={`/services/${category.slug}`} className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-muted">
                <CategoryIcon name={category.icon} className="size-5" />
              </span>
              <span className="flex-1">
                <span className="block font-semibold">{category.name}</span>
                {category.description && (
                  <span className="block text-sm text-muted">{category.description}</span>
                )}
              </span>
              <ChevronRight aria-hidden className="size-4 text-muted" />
            </Link>
            {category.children.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2">
                {category.children.map((child) => (
                  <li key={child.id}>
                    <Link
                      href={`/services/${child.slug}`}
                      className="inline-block rounded-full border border-border px-3 py-2 text-sm hover:bg-surface-muted"
                    >
                      {child.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </Container>
  );
}
