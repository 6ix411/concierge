import { requireAreaAccess } from "@/lib/auth/session";

/** Server-side gate: runs on every request to /account, independent of the proxy. */
export default async function Layout({ children }: LayoutProps<"/account">) {
  await requireAreaAccess("account");
  return children;
}
