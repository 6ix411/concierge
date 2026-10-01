"use client";

import { ImagePlus, Trash2, Upload } from "lucide-react";
import Image from "next/image";
import { useRef, useState, useTransition } from "react";

import { FormMessage } from "@/components/auth/form-message";
import { BusinessAvatar, BusinessCover } from "@/components/marketplace/business-avatar";
import { Button, Input } from "@/components/ui";
import type { FormState } from "@/lib/auth/schemas";
import {
  addPortfolioItemAction,
  removePortfolioItemAction,
  setBusinessImageAction,
} from "@/lib/business/actions";
import { publicStorageUrl } from "@/lib/marketplace/storage";
import { createClient } from "@/lib/supabase/client";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

function extensionFor(file: File) {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  return file.type.split("/")[1] ?? "bin";
}

function checkFile(file: File, allowVideo: boolean): string | null {
  const isImage = IMAGE_TYPES.includes(file.type);
  const isVideo = allowVideo && VIDEO_TYPES.includes(file.type);
  if (!isImage && !isVideo)
    return allowVideo
      ? "Use a JPG, PNG or WebP photo, or an MP4, MOV or WebM video."
      : "Use a JPG, PNG or WebP image.";
  if (isImage && file.size > MAX_IMAGE_BYTES) return "Photos can be up to 10 MB.";
  if (isVideo && file.size > MAX_VIDEO_BYTES) return "Videos can be up to 50 MB.";
  return null;
}

/**
 * Uploads to the business's own folder in public storage (storage rules only let the owner write
 * there), then records the file through a server action. Removes the upload if recording fails.
 */
async function uploadThenRecord(
  businessId: string,
  folder: string,
  file: File,
  record: (path: string) => Promise<FormState>,
): Promise<FormState> {
  const supabase = createClient();
  const path = `${businessId}/${folder}/${crypto.randomUUID()}.${extensionFor(file)}`;
  const { error } = await supabase.storage
    .from("business-media")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) return { status: "error", message: "The upload failed. Check your connection and try again." };
  const result = await record(path);
  if (result.status === "error") await supabase.storage.from("business-media").remove([path]);
  return result;
}

/** Logo and cover photo. */
export function BrandImages({
  businessId,
  name,
  logoPath,
  coverPath,
}: {
  businessId: string;
  name: string;
  logoPath: string | null;
  coverPath: string | null;
}) {
  const [message, setMessage] = useState<FormState | null>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"logo" | "cover" | null>(null);

  const pick = (kind: "logo" | "cover") => (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const problem = checkFile(file, false);
    if (problem) return setMessage({ status: "error", message: problem });
    setBusy(kind);
    startTransition(async () => {
      setMessage(
        await uploadThenRecord(businessId, "brand", file, (path) => setBusinessImageAction(kind, path)),
      );
      setBusy(null);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {message?.message && (
        <FormMessage tone={message.status === "success" ? "success" : "error"}>{message.message}</FormMessage>
      )}
      <div className="relative">
        <BusinessCover name={name} coverPath={coverPath} />
        <label className="absolute right-3 bottom-3 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-background/90 px-3 py-2 text-sm font-medium shadow-sm hover:bg-background">
          <ImagePlus aria-hidden className="size-4" />
          {busy === "cover" && pending ? "Uploading…" : coverPath ? "Change cover" : "Add cover photo"}
          <input type="file" accept={IMAGE_TYPES.join(",")} className="sr-only" onChange={pick("cover")} />
        </label>
      </div>
      <div className="flex items-center gap-4">
        <BusinessAvatar name={name} logoPath={logoPath} size="lg" />
        <div className="flex flex-col gap-1">
          <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium hover:bg-surface-muted">
            <Upload aria-hidden className="size-4" />
            {busy === "logo" && pending ? "Uploading…" : logoPath ? "Change logo" : "Upload logo"}
            <input type="file" accept={IMAGE_TYPES.join(",")} className="sr-only" onChange={pick("logo")} />
          </label>
          <p className="text-xs text-muted">Square JPG, PNG or WebP, up to 10 MB.</p>
        </div>
      </div>
    </div>
  );
}

type PortfolioItem = {
  id: string;
  media_type: "image" | "video";
  storage_path: string;
  caption: string | null;
};

/** Photos and videos of past work. */
export function PortfolioManager({ businessId, items }: { businessId: string; items: PortfolioItem[] }) {
  const [message, setMessage] = useState<FormState | null>(null);
  const [caption, setCaption] = useState("");
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])].slice(0, 10);
    event.target.value = "";
    if (files.length === 0) return;
    const problem = files.map((file) => checkFile(file, true)).find(Boolean);
    if (problem) return setMessage({ status: "error", message: problem });
    startTransition(async () => {
      let result: FormState = { status: "success" };
      for (const file of files) {
        const mediaType = file.type.startsWith("video/") ? "video" : "image";
        result = await uploadThenRecord(businessId, "portfolio", file, (path) =>
          addPortfolioItemAction({ path, mediaType, caption: caption || undefined }),
        );
        if (result.status === "error") break;
      }
      setMessage(result);
      if (result.status === "success") setCaption("");
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {message?.message && (
        <FormMessage tone={message.status === "success" ? "success" : "error"}>{message.message}</FormMessage>
      )}
      {items.length > 0 ? (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {items.map((item) => {
            const url = publicStorageUrl("business-media", item.storage_path);
            return (
              <li
                key={item.id}
                className="group relative aspect-square overflow-hidden rounded-xl bg-surface-muted"
              >
                {url &&
                  (item.media_type === "video" ? (
                    <video src={url} controls preload="metadata" className="size-full object-cover" />
                  ) : (
                    <Image
                      src={url}
                      alt={item.caption ?? "Portfolio photo"}
                      fill
                      sizes="(min-width: 640px) 33vw, 50vw"
                      className="object-cover"
                    />
                  ))}
                {item.caption && (
                  <p className="absolute inset-x-0 bottom-0 truncate bg-black/50 px-2 py-1 text-xs text-white">
                    {item.caption}
                  </p>
                )}
                <form
                  action={removePortfolioItemAction.bind(null, item.id)}
                  className="absolute top-2 right-2"
                >
                  <button
                    type="submit"
                    aria-label="Remove from portfolio"
                    className="rounded-lg bg-background/90 p-1.5 shadow-sm hover:bg-background"
                  >
                    <Trash2 aria-hidden className="size-4 text-danger" />
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted">No photos or videos yet. Show customers your best work.</p>
      )}
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Input
            label="Caption (optional)"
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            maxLength={300}
            placeholder="e.g. Ivory and gold reception, Eko Hotel"
          />
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={[...IMAGE_TYPES, ...VIDEO_TYPES].join(",")}
          className="sr-only"
          id="portfolio-upload"
          aria-label="Choose photos or videos"
          onChange={upload}
        />
        <Button type="button" variant="outline" loading={pending} onClick={() => fileRef.current?.click()}>
          <ImagePlus aria-hidden className="size-4" />
          Add photos or videos
        </Button>
      </div>
      <p className="text-xs text-muted">Photos up to 10 MB, videos up to 50 MB.</p>
    </div>
  );
}
