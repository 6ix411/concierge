"use server";

import { refreshPage } from "@/lib/utils/refresh";
import { z } from "zod";

import { recordAdminAction } from "@/lib/auth/admin-audit";
import { fieldErrorsFrom, type FormState } from "@/lib/auth/schemas";
import { requireRole } from "@/lib/auth/session";
import { toFormError } from "@/lib/business/action-utils";
import { slugify } from "@/lib/business/slug";
import { AppError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";

import { categorySchema } from "./schemas";

/** Creates or edits a marketplace category. Categories are one level deep: a parent can't have a parent. */
export async function saveCategoryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let message = "Category saved.";
  const values = {
    name: String(formData.get("name") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    description: String(formData.get("description") ?? ""),
    parentId: String(formData.get("parentId") ?? ""),
    sortOrder: String(formData.get("sortOrder") ?? "0"),
  };
  try {
    const admin = await requireRole("admin");
    const parsed = categorySchema.safeParse({
      categoryId: formData.get("categoryId") || undefined,
      name: formData.get("name"),
      slug: formData.get("slug") ?? undefined,
      description: formData.get("description") ?? undefined,
      parentId: formData.get("parentId") ?? "",
      sortOrder: formData.get("sortOrder") || 0,
      isActive: formData.get("isActive") === "on",
    });
    if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error), values };
    const input = parsed.data;
    const slug = input.slug ?? slugify(input.name);

    const db = createAdminClient();
    if (input.parentId) {
      if (input.parentId === input.categoryId)
        return { status: "error", fieldErrors: { parentId: "A category can't be its own parent." }, values };
      const { data: parent } = await db
        .from("service_categories")
        .select("id, parent_id")
        .eq("id", input.parentId)
        .maybeSingle();
      if (!parent || parent.parent_id)
        return { status: "error", fieldErrors: { parentId: "Choose a main category." }, values };
      if (input.categoryId) {
        const { count } = await db
          .from("service_categories")
          .select("id", { count: "exact", head: true })
          .eq("parent_id", input.categoryId);
        if (count)
          return {
            status: "error",
            fieldErrors: {
              parentId: "This category has its own sub-categories, so it must stay a main one.",
            },
            values,
          };
      }
    }

    const row = {
      name: input.name,
      slug,
      description: input.description ?? null,
      parent_id: input.parentId,
      sort_order: input.sortOrder,
      is_active: input.isActive,
    };
    const { data, error } = input.categoryId
      ? await db.from("service_categories").update(row).eq("id", input.categoryId).select("id").single()
      : await db.from("service_categories").insert(row).select("id").single();
    if (error?.code === "23505")
      return {
        status: "error",
        fieldErrors: { slug: "Another category already uses this web address." },
        values,
      };
    if (error || !data) throw new AppError("INTERNAL", "Could not save the category.", { cause: error });

    await recordAdminAction(admin, {
      action: input.categoryId ? "category.update" : "category.create",
      targetType: "service_categories",
      targetId: data.id,
      metadata: { name: input.name, slug, active: input.isActive },
    });
    message = input.categoryId ? `${input.name} saved.` : `${input.name} added.`;
  } catch (error) {
    return { ...toFormError(error, "We couldn't save the category. Please try again."), values };
  }
  refreshPage();
  return { status: "success", message };
}

/** Deletes a category nobody uses. Categories in use can be hidden instead. */
export async function deleteCategoryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const admin = await requireRole("admin");
    const categoryId = z.guid().parse(formData.get("categoryId"));
    const db = createAdminClient();
    const { data: category } = await db
      .from("service_categories")
      .select("id, name")
      .eq("id", categoryId)
      .maybeSingle();
    if (!category) throw new AppError("NOT_FOUND", "Category not found.");

    const [children, businesses, services] = await Promise.all([
      db.from("service_categories").select("id", { count: "exact", head: true }).eq("parent_id", category.id),
      db
        .from("businesses")
        .select("id", { count: "exact", head: true })
        .eq("primary_category_id", category.id),
      db
        .from("business_services")
        .select("id", { count: "exact", head: true })
        .eq("category_id", category.id),
    ]);
    if ((children.count ?? 0) + (businesses.count ?? 0) + (services.count ?? 0) > 0)
      throw new AppError(
        "CONFLICT",
        `${category.name} is in use by businesses, services or sub-categories. Hide it instead.`,
      );

    const { error } = await db.from("service_categories").delete().eq("id", category.id);
    if (error) throw new AppError("INTERNAL", "Could not delete the category.", { cause: error });
    await recordAdminAction(admin, {
      action: "category.delete",
      targetType: "service_categories",
      targetId: category.id,
      metadata: { name: category.name },
    });
  } catch (error) {
    return toFormError(error, "We couldn't delete the category. Please try again.");
  }
  refreshPage();
  return { status: "success", message: "Category deleted." };
}
