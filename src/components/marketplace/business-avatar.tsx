import Image from "next/image";

import { initials } from "@/lib/format";
import { publicStorageUrl } from "@/lib/marketplace/storage";
import { cn } from "@/lib/utils/cn";

const palettes = [
  "from-amber-200 to-rose-200 text-amber-950",
  "from-emerald-200 to-teal-200 text-emerald-950",
  "from-sky-200 to-indigo-200 text-indigo-950",
  "from-fuchsia-200 to-pink-200 text-fuchsia-950",
  "from-lime-200 to-emerald-200 text-lime-950",
];

function paletteFor(seed: string) {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return palettes[hash % palettes.length];
}

export function BusinessAvatar({
  name,
  logoPath,
  size = "md",
  className,
}: {
  name: string;
  logoPath: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const url = publicStorageUrl("business-media", logoPath);
  const dimension = size === "lg" ? 80 : size === "md" ? 56 : 40;
  const classes = cn(
    "shrink-0 overflow-hidden rounded-2xl",
    size === "lg" ? "size-20 text-2xl" : size === "md" ? "size-14 text-lg" : "size-10 text-sm",
    className,
  );

  if (url) {
    return (
      <Image src={url} alt="" width={dimension} height={dimension} className={cn(classes, "object-cover")} />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        classes,
        "flex items-center justify-center bg-gradient-to-br font-semibold",
        paletteFor(name),
      )}
    >
      {initials(name)}
    </span>
  );
}

export function BusinessCover({ name, coverPath }: { name: string; coverPath: string | null }) {
  const url = publicStorageUrl("business-media", coverPath);
  if (url) {
    return (
      <div className="relative h-36 w-full overflow-hidden rounded-2xl sm:h-56">
        <Image
          src={url}
          alt=""
          fill
          sizes="(min-width: 1024px) 1024px, 100vw"
          className="object-cover"
          priority
        />
      </div>
    );
  }
  return (
    <div aria-hidden className={cn("h-28 w-full rounded-2xl bg-gradient-to-br sm:h-44", paletteFor(name))} />
  );
}
