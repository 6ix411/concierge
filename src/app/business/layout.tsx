import { requireAreaAccess } from "@/lib/auth/session";

/** Server-side gate: runs on every request to /business, independent of the proxy. */
export default async function Layout({ children }: LayoutProps<"/business">) {
  await requireAreaAccess("business");
  return children;
}
