"use client";

import { useEffect } from "react";

import { recordProfileViewAction } from "@/lib/analytics/actions";

/** Counts one view per business per browser tab session. Renders nothing. */
export function ProfileViewTracker({ businessId }: { businessId: string }) {
  useEffect(() => {
    const key = `viewed:${businessId}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // Storage blocked: count the view anyway.
    }
    void recordProfileViewAction(businessId).catch(() => {});
  }, [businessId]);
  return null;
}
