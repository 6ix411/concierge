"use server";

import { after } from "next/server";
import { z } from "zod";

import { getSessionUser } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

import { fromRealVisitor, recordProfileView } from "./track";

/**
 * Counts a view of a business profile. Called by the page once it has loaded in a browser, so link
 * previews and crawlers aren't counted. The owner's and admins' own visits don't count either.
 * Nothing about the viewer is stored.
 */
export async function recordProfileViewAction(businessId: unknown): Promise<void> {
  const id = z.guid().safeParse(businessId);
  if (!id.success) return;
  if (!(await fromRealVisitor())) return;
  if (!(await checkRateLimit("analytics.view"))) return;

  const viewer = await getSessionUser();
  if (viewer?.role === "admin") return;
  const { data: business } = await createAdminClient()
    .from("businesses")
    .select("id, owner_id, status")
    .eq("id", id.data)
    .maybeSingle();
  if (!business || business.status !== "approved" || business.owner_id === viewer?.id) return;

  after(() => recordProfileView(business.id));
}
