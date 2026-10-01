import type { Metadata } from "next";

import {
  BookingSettingsForm,
  DaysOffEditor,
  WeeklyHoursForm,
} from "@/components/business/availability-forms";
import { listAvailability, requireOwnBusiness } from "@/lib/business/queries";
import { lagosToday } from "@/lib/dates";

export const metadata: Metadata = { title: "Availability" };

export default async function BusinessAvailabilityPage() {
  const { business } = await requireOwnBusiness();
  const rules = await listAvailability(business.id);
  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Availability</h1>
        <p className="mt-1 text-muted">When customers can book you.</p>
      </div>
      <section aria-labelledby="hours-heading" className="flex flex-col gap-4">
        <h2 id="hours-heading" className="text-lg font-semibold">
          Working days and hours
        </h2>
        <WeeklyHoursForm rules={rules} />
      </section>
      <section aria-labelledby="settings-heading" className="flex flex-col gap-4">
        <h2 id="settings-heading" className="text-lg font-semibold">
          Booking availability
        </h2>
        <BookingSettingsForm settings={business} />
      </section>
      <section aria-labelledby="days-off-heading" className="flex flex-col gap-4">
        <h2 id="days-off-heading" className="text-lg font-semibold">
          Days off
        </h2>
        <DaysOffEditor rules={rules} minDate={lagosToday()} />
      </section>
    </div>
  );
}
