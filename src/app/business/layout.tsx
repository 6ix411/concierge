import { BusinessNav } from "@/components/business/business-nav";
import { Container } from "@/components/layout/container";
import { requireAreaAccess } from "@/lib/auth/session";
import { getOwnBusiness } from "@/lib/business/queries";

/** Server-side gate: runs on every request to /business, independent of the proxy. */
export default async function Layout({ children }: LayoutProps<"/business">) {
  const user = await requireAreaAccess("business");
  const business = user.role === "business" ? await getOwnBusiness(user.id) : null;
  return (
    <Container className="flex flex-col gap-6 py-6 sm:py-10">
      {business && <BusinessNav />}
      {children}
    </Container>
  );
}
