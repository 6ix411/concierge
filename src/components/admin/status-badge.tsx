import { Badge } from "@/components/ui";
import { businessStatusInfo, type BusinessStatus } from "@/lib/business/status";

export function StatusBadge({ status }: { status: BusinessStatus }) {
  const info = businessStatusInfo[status];
  return <Badge tone={info.tone}>{info.label}</Badge>;
}
