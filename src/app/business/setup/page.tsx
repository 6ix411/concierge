import { Check, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { WeeklyHoursForm } from "@/components/business/availability-forms";
import { DetailsForm } from "@/components/business/details-form";
import { BrandImages, PortfolioManager } from "@/components/business/media-manager";
import { ServiceAreasEditor } from "@/components/business/service-areas-editor";
import { ServicesManager } from "@/components/business/services-manager";
import { SetupSteps } from "@/components/business/setup-steps";
import { SubmitForReview } from "@/components/business/submit-for-review";
import { VerificationUploader } from "@/components/business/verification-uploader";
import { Badge, LinkButton } from "@/components/ui";
import { adminHref } from "@/lib/auth/admin-path";
import { requireAreaAccess } from "@/lib/auth/session";
import { createBusinessAction, updateBusinessDetailsAction } from "@/lib/business/actions";
import { getCategoryOptions } from "@/lib/business/categories";
import {
  isOnboardingStep,
  missingSteps,
  nextStep,
  onboardingSteps,
  type OnboardingStep,
} from "@/lib/business/onboarding";
import {
  getOnboardingProgress,
  getOwnBusiness,
  getVerificationOverview,
  listAvailability,
  listOwnServices,
  listPortfolio,
  listServiceAreas,
} from "@/lib/business/queries";
import { canSubmitForReview } from "@/lib/business/status";
import { documentStatusInfo, documentTypeLabels } from "@/lib/business/verification";

export const metadata: Metadata = { title: "Register your business" };

type Step = OnboardingStep | "review";
const order: Step[] = [...onboardingSteps.map((s) => s.key), "review"];
const href = (step: Step) => `/business/setup?step=${step}`;

function StepHeader({ step }: { step: Step }) {
  const info = onboardingSteps.find((s) => s.key === step);
  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight">{info?.title ?? "Review and submit"}</h2>
      <p className="mt-1 text-sm text-muted">
        {info?.description ?? "Check everything is complete, then send your business to our team for review."}
      </p>
    </div>
  );
}

function StepFooter({ step }: { step: Step }) {
  const index = order.indexOf(step);
  const previous = order[index - 1];
  const following = order[index + 1];
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
      {previous ? (
        <LinkButton href={href(previous)} variant="ghost">
          Back
        </LinkButton>
      ) : (
        <span />
      )}
      {following && <LinkButton href={href(following)}>Continue</LinkButton>}
    </div>
  );
}

export default async function BusinessSetupPage({ searchParams }: PageProps<"/business/setup">) {
  const user = await requireAreaAccess("business");
  if (user.role === "admin") redirect(adminHref());
  const [business, categories, params] = await Promise.all([
    getOwnBusiness(user.id),
    getCategoryOptions(),
    searchParams,
  ]);

  // Step 1 for a brand-new provider: create the business.
  if (!business) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <div>
          <p className="text-sm font-medium text-accent">Become a provider</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Register your business</h1>
          <p className="mt-2 text-muted">
            Six short steps. You can save and come back any time. Our team reviews every business before
            customers can see it.
          </p>
        </div>
        <SetupSteps progress={null} current="details" hrefFor={() => null} />
        <StepHeader step="details" />
        <DetailsForm action={createBusinessAction} categories={categories} submitLabel="Save and continue" />
      </div>
    );
  }

  if (!canSubmitForReview(business.status)) redirect("/business");

  const progress = await getOnboardingProgress(business);
  const requested = params.step;
  const step: Step = isOnboardingStep(requested)
    ? requested
    : requested === "review"
      ? "review"
      : (nextStep(progress) ?? "review");

  let content: React.ReactNode;
  switch (step) {
    case "details":
      content = (
        <DetailsForm
          action={updateBusinessDetailsAction}
          categories={categories}
          defaults={business}
          submitLabel="Save and continue"
          next={href("areas")}
        />
      );
      break;
    case "areas":
      content = (
        <>
          <p className="text-sm text-muted">
            Add every area you serve. The concierge only recommends you to customers in these areas.
          </p>
          <ServiceAreasEditor areas={await listServiceAreas(business.id)} defaultState={business.state} />
        </>
      );
      break;
    case "services":
      content = (
        <>
          <p className="text-sm text-muted">
            Add at least one service or package with its price. Add-ons are optional extras customers can add
            when they book. Use “Price on request” when every job is priced differently.
          </p>
          <ServicesManager services={await listOwnServices(business.id)} categories={categories} />
        </>
      );
      break;
    case "availability":
      content = (
        <>
          <p className="text-sm text-muted">
            Choose the days and hours you work. Customers can only request times inside these hours. You can
            add days off and booking rules later from your dashboard.
          </p>
          <WeeklyHoursForm rules={await listAvailability(business.id)} next={href("portfolio")} />
        </>
      );
      break;
    case "portfolio":
      content = (
        <>
          <p className="text-sm text-muted">Add your logo and at least one photo or video of your work.</p>
          <BrandImages
            businessId={business.id}
            name={business.name}
            logoPath={business.logo_path}
            coverPath={business.cover_path}
          />
          <PortfolioManager businessId={business.id} items={await listPortfolio(business.id)} />
        </>
      );
      break;
    case "verification": {
      const { documents } = await getVerificationOverview(business.id);
      content = (
        <>
          <div className="flex items-start gap-3 rounded-2xl bg-surface-muted p-4 text-sm">
            <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-verified" />
            <p>
              Upload your CAC registration certificate, or a government ID if you’re not registered yet. We
              may ask for more, such as proof of address or a professional licence.
            </p>
          </div>
          {documents.length > 0 && (
            <ul className="flex flex-col gap-2">
              {documents.map((doc) => (
                <li
                  key={doc.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3 text-sm"
                >
                  <span>{documentTypeLabels[doc.document_type]}</span>
                  <Badge tone={documentStatusInfo[doc.status].tone}>
                    {documentStatusInfo[doc.status].label}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          <VerificationUploader businessId={business.id} />
        </>
      );
      break;
    }
    case "review": {
      const missing = missingSteps(progress);
      content = (
        <>
          <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-surface">
            {onboardingSteps.map((s) => (
              <li key={s.key} className="flex items-center justify-between gap-3 p-4">
                <span className="flex items-center gap-2 text-sm font-medium">
                  {progress[s.key] ? (
                    <Check aria-hidden className="size-4 text-verified" />
                  ) : (
                    <span aria-hidden className="size-4 rounded-full border border-border" />
                  )}
                  {s.title}
                </span>
                {!progress[s.key] && (
                  <Link href={href(s.key)} className="text-sm font-medium text-accent hover:underline">
                    Finish
                  </Link>
                )}
              </li>
            ))}
          </ul>
          {missing.length === 0 ? (
            <p className="text-sm text-muted">
              Everything’s ready. Once you submit, our team reviews your details and documents. You’ll get a
              notification when you’re approved, or if we need anything else.
            </p>
          ) : (
            <p className="text-sm text-muted">Finish the remaining steps to submit.</p>
          )}
          <SubmitForReview resubmit={business.status === "rejected"} disabled={missing.length > 0} />
        </>
      );
      break;
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-accent">Register your business</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{business.name}</h1>
        </div>
        <Link href="/business" className="text-sm font-medium text-muted hover:underline">
          Save and exit
        </Link>
      </div>
      <SetupSteps progress={progress} current={step} hrefFor={href} />
      <StepHeader step={step} />
      {content}
      <StepFooter step={step} />
    </div>
  );
}
