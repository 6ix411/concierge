"use client";

import { useState } from "react";

import { FormMessage } from "@/components/auth/form-message";
import { Button, Select } from "@/components/ui";
import type { FormState } from "@/lib/auth/schemas";
import {
  decideBusinessAction,
  requestVerificationInfoAction,
  reviewDocumentAction,
} from "@/lib/admin/business-actions";
import { adminBusinessDecisions, type AdminBusinessDecision } from "@/lib/admin/business-review";
import { documentTypeLabels } from "@/lib/business/verification";
import { useFormAction } from "@/lib/utils/use-form-action";

function Feedback({ state }: { state: FormState }) {
  if (!state.message) return null;
  return <FormMessage tone={state.status === "success" ? "success" : "error"}>{state.message}</FormMessage>;
}

const textarea =
  "rounded-xl border border-border bg-surface p-3 text-base focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none sm:text-sm";

function DecisionForm({ businessId, decision }: { businessId: string; decision: AdminBusinessDecision }) {
  const [state, formAction, pending] = useFormAction(decideBusinessAction.bind(null, decision), {
    status: "idle",
  });
  const needsReason = decision === "reject" || decision === "suspend";
  const [open, setOpen] = useState(false);
  const label = adminBusinessDecisions[decision].label;

  if (needsReason && !open) {
    return (
      <Button type="button" variant="outline" className="text-danger" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }
  return (
    <form action={formAction} className={needsReason ? "flex w-full flex-col gap-2" : ""}>
      <input type="hidden" name="businessId" value={businessId} />
      {needsReason && (
        <>
          <label htmlFor={`${decision}-reason`} className="text-sm font-medium">
            Reason (the business will see this)
          </label>
          <textarea id={`${decision}-reason`} name="reason" rows={3} maxLength={1000} className={textarea} />
          {state.fieldErrors?.reason && <p className="text-sm text-danger">{state.fieldErrors.reason}</p>}
        </>
      )}
      {state.status === "error" && !state.fieldErrors && <Feedback state={state} />}
      <div className="flex gap-2">
        <Button
          type="submit"
          variant={
            needsReason
              ? "danger"
              : decision === "approve" || decision === "reinstate"
                ? "primary"
                : "outline"
          }
          loading={pending}
        >
          {label}
        </Button>
        {needsReason && (
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

export function BusinessDecisions({
  businessId,
  decisions,
}: {
  businessId: string;
  decisions: AdminBusinessDecision[];
}) {
  if (decisions.length === 0)
    return <p className="text-sm text-muted">No decisions available in this status.</p>;
  return (
    <div className="flex flex-wrap items-start gap-2">
      {decisions.map((decision) => (
        <DecisionForm key={decision} businessId={businessId} decision={decision} />
      ))}
    </div>
  );
}

export function RequestInfoForm({ businessId }: { businessId: string }) {
  const [state, formAction, pending] = useFormAction(requestVerificationInfoAction, { status: "idle" });
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="businessId" value={businessId} />
      <Feedback state={state} />
      <Select label="Document (optional)" name="documentType" defaultValue="">
        <option value="">Any document</option>
        {Object.entries(documentTypeLabels).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="request-message" className="text-sm font-medium">
          What do you need?
        </label>
        <textarea
          id="request-message"
          name="message"
          rows={3}
          maxLength={1000}
          placeholder="e.g. Please upload a utility bill showing your business address."
          className={textarea}
        />
        {state.fieldErrors?.message && <p className="text-sm text-danger">{state.fieldErrors.message}</p>}
      </div>
      <Button type="submit" variant="outline" loading={pending} className="self-start">
        Request information
      </Button>
    </form>
  );
}

export function DocumentDecision({ verificationId }: { verificationId: string }) {
  const [approveState, approve, approving] = useFormAction(reviewDocumentAction.bind(null, "approved"), {
    status: "idle",
  });
  const [rejectState, reject, rejecting] = useFormAction(reviewDocumentAction.bind(null, "rejected"), {
    status: "idle",
  });
  const [rejectOpen, setRejectOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <Feedback
        state={
          approveState.status === "error"
            ? approveState
            : rejectState.status === "error" && !rejectState.fieldErrors
              ? rejectState
              : { status: "idle" }
        }
      />
      {rejectOpen ? (
        <form action={reject} className="flex flex-col gap-2">
          <input type="hidden" name="verificationId" value={verificationId} />
          <label htmlFor={`notes-${verificationId}`} className="text-sm font-medium">
            Why isn’t it accepted?
          </label>
          <textarea
            id={`notes-${verificationId}`}
            name="notes"
            rows={2}
            maxLength={1000}
            className={textarea}
          />
          {rejectState.fieldErrors?.notes && (
            <p className="text-sm text-danger">{rejectState.fieldErrors.notes}</p>
          )}
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="danger" loading={rejecting}>
              Reject document
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex gap-2">
          <form action={approve}>
            <input type="hidden" name="verificationId" value={verificationId} />
            <Button type="submit" size="sm" loading={approving}>
              Accept
            </Button>
          </form>
          <Button type="button" size="sm" variant="outline" onClick={() => setRejectOpen(true)}>
            Reject
          </Button>
        </div>
      )}
    </div>
  );
}
