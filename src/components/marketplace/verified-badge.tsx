import { BadgeCheck } from "lucide-react";

import { Badge } from "@/components/ui";

export function VerifiedBadge() {
  return (
    <Badge tone="verified">
      <BadgeCheck aria-hidden className="size-3.5" />
      Verified
    </Badge>
  );
}
