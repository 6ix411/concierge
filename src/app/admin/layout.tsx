import { requireAreaAccess } from "@/lib/auth/session";

/** Server-side gate: runs on every request to /admin, independent of the proxy. */
export default async function Layout({ children }: LayoutProps<"/admin">) {
  await requireAreaAccess("admin");
  return children;
}
