import Form from "next/form";

import { Button, Input, Select } from "@/components/ui";
import type { CategoryTree } from "@/lib/marketplace/queries";
import { sortOptions } from "@/lib/marketplace/search-params";

export function SearchFilters({
  categories,
  values,
  action = "/search",
  hideCategory = false,
}: {
  categories: CategoryTree[];
  values: { q?: string; category?: string; location?: string; max?: string; sort?: string };
  action?: string;
  hideCategory?: boolean;
}) {
  return (
    <Form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
      <div className="sm:col-span-2 lg:col-span-2">
        <Input label="Service" name="q" placeholder="e.g. wedding photographer" defaultValue={values.q} />
      </div>
      <Input label="Area" name="location" placeholder="e.g. Lekki" defaultValue={values.location} />
      {!hideCategory && (
        <Select label="Category" name="category" defaultValue={values.category ?? ""}>
          <option value="">All categories</option>
          {categories.map((category) => (
            <optgroup key={category.id} label={category.name}>
              <option value={category.slug}>All {category.name}</option>
              {category.children.map((child) => (
                <option key={child.id} value={child.slug}>
                  {child.name}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      )}
      <Input
        label="Max budget (₦)"
        name="max"
        inputMode="numeric"
        placeholder="Any"
        defaultValue={values.max}
      />
      <Select label="Sort by" name="sort" defaultValue={values.sort ?? "relevance"}>
        {sortOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      <Button type="submit" className="sm:col-span-2 lg:col-span-1">
        Search
      </Button>
    </Form>
  );
}
