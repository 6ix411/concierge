import { Badge } from "@/components/ui";
import { businessStatusInfo, type BusinessStatus } from "@/lib/business/status";
import { cn } from "@/lib/utils/cn";

/** The business's review status, what it means and the platform's note on the latest decision. */
export function StatusCard({
  status,
  note,
  action,
  className,
}: {
  status: BusinessStatus;
  note?: string | null;
  action?: React.ReactNode;
  className?: string;
}) {
  const info = businessStatusInfo[status];
  return (
    <section
      aria-label="Business status"
      className={cn(
        "flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between",
        info.tone === "danger" ? "border-danger/30 bg-danger/5" : "border-border bg-surface",
        className,
      )}
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">Status</span>
          <Badge tone={info.tone}>{info.label}</Badge>
        </div>
        <p className="text-sm">{info.message}</p>
        {note && (status === "rejected" || status === "suspended") && (
          <p className="text-sm">
            <span className="font-medium">Reason: </span>
            {note}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </section>
  );
}
