import { formatDate, formatNaira } from "@/lib/format";
import type { BusinessBilling } from "@/lib/revenue/queries";

const statusLabels: Record<string, string> = {
  success: "Paid",
  pending: "Not completed",
  failed: "Failed",
  abandoned: "Not completed",
};

/** What the business has paid the platform for plans and featured placement. */
export function ChargeHistory({ charges }: { charges: BusinessBilling["charges"] }) {
  if (charges.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-semibold">Payments to Concierge</h2>
      <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr>
              <th className="p-3 font-medium">Date</th>
              <th className="p-3 font-medium">For</th>
              <th className="p-3 font-medium">Reference</th>
              <th className="p-3 text-right font-medium">Amount</th>
              <th className="p-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {charges.map((charge) => (
              <tr key={charge.id} className="border-t border-border">
                <td className="p-3 whitespace-nowrap">{formatDate(charge.paid_at ?? charge.created_at)}</td>
                <td className="p-3">
                  {charge.kind === "subscription" ? "Plan" : "Featured placement"} ·{" "}
                  <span className="capitalize">{charge.item_code}</span>
                </td>
                <td className="p-3 font-mono text-xs">{charge.reference}</td>
                <td className="p-3 text-right tabular-nums">{formatNaira(charge.amount_minor)}</td>
                <td className="p-3">{statusLabels[charge.status] ?? charge.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
