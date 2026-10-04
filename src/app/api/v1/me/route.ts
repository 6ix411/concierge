import { apiRoute, requireApiUser } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** The signed-in account. */
export const GET = apiRoute(async () => {
  const user = await requireApiUser();
  return { id: user.id, email: user.email, role: user.role, fullName: user.fullName };
});
