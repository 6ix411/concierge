import "server-only";

import type { CategoryOption } from "@/components/business/details-form";
import { getCategories } from "@/lib/marketplace/queries";

/** Categories for business forms, grouped under their parent (e.g. Events: Event Decoration). */
export async function getCategoryOptions(): Promise<CategoryOption[]> {
  const tree = await getCategories();
  return tree.flatMap((parent) =>
    parent.children.length > 0
      ? parent.children.map((child) => ({ id: child.id, name: child.name, group: parent.name }))
      : [{ id: parent.id, name: parent.name, group: parent.name }],
  );
}
