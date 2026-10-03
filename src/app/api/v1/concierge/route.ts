import { apiRoute, readJson, requireApiUser } from "@/lib/api/v1";
import { bearerToken } from "@/lib/supabase/server";
import { askConciergeAction } from "@/lib/concierge/actions";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * Ask the AI concierge. Body: { message, conversationId? } when signed in (the conversation is
 * saved to the account, like on the website), or { message, history? } as a visitor. Recommended
 * providers come from the platform's verified businesses only.
 */
export const POST = apiRoute(async (request: Request) => {
  if (await bearerToken()) await requireApiUser();
  const body = await readJson(request);
  const result = await askConciergeAction({
    message: body.message as string,
    conversationId: (body.conversationId as string | undefined) ?? null,
    history: body.history as never,
  });
  if (!result.ok) throw new AppError("BAD_REQUEST", result.error);
  return { reply: result.reply, conversationId: result.conversationId };
});
