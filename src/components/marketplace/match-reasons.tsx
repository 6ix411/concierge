import { Check, X } from "lucide-react";

import type { Reason } from "@/lib/matching/explain";

/** Which of the customer's needs a business meets (tick) and which it doesn't (cross). */
export function MatchReasons({ reasons }: { reasons: Reason[] }) {
  if (reasons.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1">
      {reasons.map((reason) => (
        <li
          key={reason.text}
          className={
            reason.met ? "flex items-start gap-2 text-sm" : "flex items-start gap-2 text-sm text-muted"
          }
        >
          {reason.met ? (
            <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-verified" />
          ) : (
            <X aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />
          )}
          <span>
            <span className="sr-only">{reason.met ? "Meets: " : "Doesn’t meet: "}</span>
            {reason.text}
          </span>
        </li>
      ))}
    </ul>
  );
}
