import type { Metadata } from "next";
import Link from "next/link";

import { CommissionForm } from "@/components/admin/commission-form";
import { PageHeader, Panel, StatCard } from "@/components/admin/dashboard-widgets";
import { COMMISSION_SETTING, formatBps } from "@/lib/admin/rules";
import { getAdminStats } from "@/lib/admin/stats";
import { updateCommissionAction } from "@/lib/admin/settings-actions";
import { adminHref } from "@/lib/auth/admin-path";
import { requireAreaAccess } from "@/lib/auth/session";
import { formatDateTime, formatNaira } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Commission" };

export default async function AdminCommissionPage() {
  await requireAreaAccess("admin");
  const db = createAdminClient();
  const [setting, custom, stats] = await Promise.all([
    db
      .from("platform_settings")
      .select("value, updated_at, updated_by:users(full_name)")
      .eq("key", COMMISSION_SETTING)
      .maybeSingle(),
    db
      .from("businesses")
      .select("id, name, commission_rate_bps")
      .not("commission_rate_bps", "is", null)
      .order("name"),
    getAdminStats(0),
  ]);
  const bps = Number(setting.data?.value);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Commission"
        description="The platform's share of each booking. It's taken from the business's payout."
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Platform commission" value={formatBps(bps)} hint="For new bookings" />
        <StatCard label="Platform fees earned" value={formatNaira(stats.platform_fees_minor)} />
        <StatCard
          label="Pending payouts"
          value={formatNaira(stats.pending_payouts_minor)}
          hint="Owed to businesses after commission"
        />
      </div>
      <Panel title="Platform commission">
        <p className="text-sm text-muted">
          Each booking keeps the rate it was made at, so changing this only affects new bookings.
          {setting.data?.updated_at && (
            <>
              {" "}
              Last changed {formatDateTime(setting.data.updated_at)}
              {setting.data.updated_by?.full_name && ` by ${setting.data.updated_by.full_name}`}.
            </>
          )}
        </p>
        <CommissionForm action={updateCommissionAction} defaultValue={String(bps / 100)} />
      </Panel>
      <Panel title="Businesses with a custom rate">
        {(custom.data ?? []).length === 0 ? (
          <p className="text-sm text-muted">
            None. Set a custom rate from a provider’s page, for example for a launch partner.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {(custom.data ?? []).map((business) => (
              <li key={business.id} className="flex justify-between gap-3 py-2">
                <Link href={adminHref(`/businesses/${business.id}`)} className="font-medium hover:underline">
                  {business.name}
                </Link>
                <span className="tabular-nums">{formatBps(business.commission_rate_bps ?? 0)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
