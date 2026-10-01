/** The registration steps, in order. Each one is also a dashboard page once the business is set up. */
export const onboardingSteps = [
  {
    key: "details",
    title: "Business information",
    description: "Name, category, contact details and location.",
  },
  { key: "areas", title: "Service areas", description: "Where you work." },
  { key: "services", title: "Services and pricing", description: "What you offer, packages and add-ons." },
  { key: "availability", title: "Availability", description: "Working days, hours and booking rules." },
  { key: "portfolio", title: "Portfolio", description: "Logo, photos and videos of your work." },
  { key: "verification", title: "Verification", description: "Documents that prove your business is real." },
] as const;

export type OnboardingStep = (typeof onboardingSteps)[number]["key"];

export function isOnboardingStep(value: unknown): value is OnboardingStep {
  return onboardingSteps.some((step) => step.key === value);
}

export type OnboardingSnapshot = {
  business: {
    name: string | null;
    description: string | null;
    primary_category_id: string | null;
    phone: string | null;
    email: string | null;
    city: string | null;
    state: string | null;
    logo_path: string | null;
  };
  areaCount: number;
  /** Active main services and packages (add-ons don't count). */
  mainServiceCount: number;
  openDayCount: number;
  portfolioCount: number;
  verificationCount: number;
};

export const MIN_DESCRIPTION_LENGTH = 40;

/** Which steps are complete. Every step is required before submitting for review. */
export function onboardingProgress(snapshot: OnboardingSnapshot): Record<OnboardingStep, boolean> {
  const { business } = snapshot;
  return {
    details: Boolean(
      business.name &&
      (business.description?.trim().length ?? 0) >= MIN_DESCRIPTION_LENGTH &&
      business.primary_category_id &&
      (business.phone || business.email) &&
      business.city &&
      business.state,
    ),
    areas: snapshot.areaCount > 0,
    services: snapshot.mainServiceCount > 0,
    availability: snapshot.openDayCount > 0,
    portfolio: Boolean(business.logo_path) && snapshot.portfolioCount > 0,
    verification: snapshot.verificationCount > 0,
  };
}

/** Titles of the steps still to do, in order. */
export function missingSteps(progress: Record<OnboardingStep, boolean>): string[] {
  return onboardingSteps.filter((step) => !progress[step.key]).map((step) => step.title);
}

/** The first unfinished step, or null when the registration is complete. */
export function nextStep(progress: Record<OnboardingStep, boolean>): OnboardingStep | null {
  return onboardingSteps.find((step) => !progress[step.key])?.key ?? null;
}
