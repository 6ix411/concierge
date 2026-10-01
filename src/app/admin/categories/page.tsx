import type { Metadata } from "next";

import { CategoryForm, CategoryRow } from "@/components/admin/category-form";
import { PageHeader, Panel } from "@/components/admin/dashboard-widgets";
import { requireAreaAccess } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Categories" };

function usageLabel(businesses: number, services: number) {
  const parts = [
    businesses ? `${businesses} business${businesses === 1 ? "" : "es"}` : null,
    services ? `${services} service${services === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "Not used yet";
}

export default async function AdminCategoriesPage() {
  await requireAreaAccess("admin");
  const db = createAdminClient();
  const [categories, businesses, services] = await Promise.all([
    db
      .from("service_categories")
      .select("id, name, slug, description, parent_id, sort_order, is_active")
      .order("sort_order")
      .order("name"),
    db.from("businesses").select("primary_category_id").not("primary_category_id", "is", null),
    db.from("business_services").select("category_id").not("category_id", "is", null),
  ]);
  if (categories.error)
    throw new AppError("INTERNAL", "Could not load categories.", { cause: categories.error });

  const count = (rows: Record<string, string | null>[] | null, column: string) => {
    const counts = new Map<string, number>();
    for (const row of rows ?? []) {
      const id = row[column];
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  };
  const businessCounts = count(businesses.data, "primary_category_id");
  const serviceCounts = count(services.data, "category_id");
  const all = categories.data ?? [];
  const mains = all.filter((c) => !c.parent_id);
  const parents = mains.map((c) => ({ id: c.id, name: c.name }));
  const usage = (id: string) => usageLabel(businessCounts.get(id) ?? 0, serviceCounts.get(id) ?? 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Categories"
        description="The marketplace categories providers choose from and customers browse. Hidden categories stay on existing listings."
      />
      <Panel title="Add a category">
        <CategoryForm parents={parents} />
      </Panel>
      <ul className="flex flex-col gap-3">
        {mains.map((main) => {
          const subs = all.filter((c) => c.parent_id === main.id);
          return (
            <li key={main.id} className="rounded-2xl border border-border bg-surface p-4">
              <CategoryRow category={main} parents={parents} usage={usage(main.id)}>
                {subs.length > 0 && (
                  <ul className="flex flex-col gap-3 border-l-2 border-border pl-4">
                    {subs.map((sub) => (
                      <li key={sub.id}>
                        <CategoryRow category={sub} parents={parents} usage={usage(sub.id)} />
                      </li>
                    ))}
                  </ul>
                )}
              </CategoryRow>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
