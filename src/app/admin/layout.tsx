import { AdminNav } from "@/components/admin/admin-nav";
import { Container } from "@/components/layout/container";
import { adminHref } from "@/lib/auth/admin-path";
import { requireAreaAccess } from "@/lib/auth/session";

/** Server-side gate: runs on every request to /admin, independent of the proxy. */
export default async function Layout({ children }: LayoutProps<"/admin">) {
  await requireAreaAccess("admin");
  return (
    <Container className="flex flex-col gap-6 py-6 sm:py-10">
      <AdminNav base={adminHref()} />
      {children}
    </Container>
  );
}
