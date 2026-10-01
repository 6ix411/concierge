/** A review's photos as small thumbnails; each opens the full photo in a new tab. */
export function ReviewPhotos({ urls, label = "Review photo" }: { urls: string[]; label?: string }) {
  if (urls.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-2" aria-label="Photos">
      {urls.map((url, index) => (
        <li key={url}>
          <a href={url} target="_blank" rel="noreferrer" className="block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={`${label} ${index + 1}`}
              loading="lazy"
              className="size-20 rounded-xl border border-border object-cover sm:size-24"
            />
          </a>
        </li>
      ))}
    </ul>
  );
}
