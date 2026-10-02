"use server";

import { isAppError, logger } from "@/lib/errors";
import { requireOwnBusinessForAction } from "@/lib/business/action-utils";
import type { CheckoutState } from "@/lib/payments/actions";
import { enforceRateLimit } from "@/lib/security/rate-limit";

import { startCharge } from "./charges";
import { checkoutSchema } from "./rules";

/**
 * A business owner starts paying for a plan or featured placement. Returns the provider's checkout
 * page; the price comes from the catalogue in the database.
 */
export async function startBusinessCheckoutAction(
  kind: string,
  code: string,
  _prev: CheckoutState,
): Promise<CheckoutState> {
  try {
    const { user, business } = await requireOwnBusinessForAction();
    const parsed = checkoutSchema.safeParse({ kind, code });
    if (!parsed.success) return { status: "error", message: "That option isn’t available." };
    if (business.status !== "approved")
      return { status: "error", message: "You can choose a paid plan once your business is approved." };
    if (parsed.data.kind === "featured" && !(business.is_verified && business.accepting_bookings))
      return {
        status: "error",
        message: "Featured placement needs a verified business that is taking bookings.",
      };
    await enforceRateLimit("checkout.start", user.id);
    return {
      status: "success",
      redirectTo: await startCharge(parsed.data.kind, parsed.data.code, business, user),
    };
  } catch (error) {
    if (isAppError(error) && error.status < 500) return { status: "error", message: error.message };
    logger.error("Business checkout failed", { error });
    return { status: "error", message: "We couldn't start the payment. Please try again." };
  }
}
