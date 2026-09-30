export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-1 items-center justify-center py-16">
      <span className="size-6 animate-spin rounded-full border-2 border-muted border-r-transparent" />
    </div>
  );
}
