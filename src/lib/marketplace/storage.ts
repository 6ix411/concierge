import { getPublicEnv } from "@/lib/env/client";

/** Public URL for a file in a public bucket (avatars, business-media). */
export function publicStorageUrl(bucket: "avatars" | "business-media", path: string | null): string | null {
  if (!path) return null;
  const base = getPublicEnv().NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
  return `${base}/storage/v1/object/public/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;
}
