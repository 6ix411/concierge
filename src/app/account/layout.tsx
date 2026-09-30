import { AccountNav } from "@/components/account/account-nav";
import { Container } from "@/components/layout/container";
import { requireAreaAccess } from "@/lib/auth/session";

/** Server-side gate: runs on every request to /account, independent of the proxy. */
export default async function Layout({ children }: LayoutProps<"/account">) {
  await requireAreaAccess("account");
  return (
    <Container className="flex flex-col gap-6 py-6 sm:py-10">
      <AccountNav />
      {children}
    </Container>
  );
}
