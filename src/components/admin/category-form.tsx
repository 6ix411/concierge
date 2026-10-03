"use client";

import { useState } from "react";

import { FormMessage } from "@/components/auth/form-message";
import { Button, Input, Select } from "@/components/ui";
import { deleteCategoryAction, saveCategoryAction } from "@/lib/admin/category-actions";
import type { FormState } from "@/lib/auth/schemas";
import { useFormAction } from "@/lib/utils/use-form-action";

export type CategoryDefaults = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parent_id: string | null;
  sort_order: number;
  is_active: boolean;
};

/** Add a category, or edit one when `category` is given. */
export function CategoryForm({
  category,
  parents,
  onDone,
  onSaved,
}: {
  category?: CategoryDefaults;
  parents: { id: string; name: string }[];
  onDone?: () => void;
  /** Called after a successful save, with the confirmation to show. */
  onSaved?: (message: string) => void;
}) {
  const [state, formAction, pending] = useFormAction(
    async (prev: FormState, formData: FormData) => {
      const result = await saveCategoryAction(prev, formData);
      if (result.status === "success" && onSaved) onSaved(result.message ?? "Saved.");
      return result;
    },
    { status: "idle" } as FormState,
  );
  const errors = state.fieldErrors ?? {};
  const values = state.status === "error" ? state.values : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {category && <input type="hidden" name="categoryId" value={category.id} />}
      {state.message && (
        <FormMessage tone={state.status === "success" ? "success" : "error"}>{state.message}</FormMessage>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Name"
          name="name"
          required
          maxLength={80}
          defaultValue={values?.name ?? category?.name}
          error={errors.name}
        />
        <Input
          label="Web address"
          name="slug"
          maxLength={80}
          placeholder="Made from the name"
          hint={category ? "Changing it breaks old links to this category." : undefined}
          defaultValue={values?.slug ?? category?.slug}
          error={errors.slug}
        />
      </div>
      <Input
        label="Description (optional)"
        name="description"
        maxLength={300}
        defaultValue={values?.description ?? category?.description ?? ""}
        error={errors.description}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Belongs to"
          name="parentId"
          defaultValue={values?.parentId ?? category?.parent_id ?? ""}
          error={errors.parentId}
        >
          <option value="">Nothing (main category)</option>
          {parents
            .filter((parent) => parent.id !== category?.id)
            .map((parent) => (
              <option key={parent.id} value={parent.id}>
                {parent.name}
              </option>
            ))}
        </Select>
        <Input
          label="Order"
          name="sortOrder"
          type="number"
          min={0}
          max={1000}
          defaultValue={values?.sortOrder ?? category?.sort_order ?? 0}
          hint="Lower numbers show first."
          error={errors.sortOrder}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={category?.is_active ?? true}
          className="size-4"
        />
        Show on the marketplace
      </label>
      <div className="flex gap-2">
        <Button type="submit" loading={pending}>
          {category ? "Save category" : "Add category"}
        </Button>
        {onDone && (
          <Button type="button" variant="ghost" onClick={onDone}>
            Close
          </Button>
        )}
      </div>
    </form>
  );
}

/** A category row: edit in place, or delete when nothing uses it. */
export function CategoryRow({
  category,
  parents,
  usage,
  children,
}: {
  category: CategoryDefaults;
  parents: { id: string; name: string }[];
  usage: string;
  children?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [deleteState, deleteAction, deleting] = useFormAction(deleteCategoryAction, { status: "idle" });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">
            {category.name}
            {!category.is_active && <span className="ml-2 text-xs font-normal text-muted">(hidden)</span>}
          </p>
          <p className="text-xs text-muted">
            /{category.slug} · {usage}
          </p>
        </div>
        {!editing && (
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setSaved(null);
                setEditing(true);
              }}
            >
              Edit
            </Button>
            <form action={deleteAction}>
              <input type="hidden" name="categoryId" value={category.id} />
              <Button
                type="submit"
                size="sm"
                variant="ghost"
                loading={deleting}
                aria-label={`Delete ${category.name}`}
              >
                Delete
              </Button>
            </form>
          </div>
        )}
      </div>
      {deleteState.message && (
        <FormMessage tone={deleteState.status === "success" ? "success" : "error"}>
          {deleteState.message}
        </FormMessage>
      )}
      {saved && !editing && <FormMessage tone="success">{saved}</FormMessage>}
      {editing && (
        <CategoryForm
          category={category}
          parents={parents}
          onDone={() => setEditing(false)}
          onSaved={(message) => {
            setSaved(message);
            setEditing(false);
          }}
        />
      )}
      {children}
    </div>
  );
}
