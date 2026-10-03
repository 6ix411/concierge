import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

type Row = { id: string; email: string; role: string; status: string; full_name: string | null } | null;

const state: { userId: string | null; row: Row; ownsBusiness: boolean } = {
  userId: null,
  row: null,
  ownsBusiness: false,
};

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: <T>(fn: T) => fn,
}));

vi.mock("@/lib/supabase/server", () => ({
  bearerToken: async () => null,
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.userId ? { id: state.userId } : null }, error: null }),
    },
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({
          data: table === "users" ? state.row : state.ownsBusiness ? { id: "biz" } : null,
          error: null,
        }),
      };
      return query;
    },
  }),
}));

const { requireBusinessOwner, requireRole, requireUser } = await import("./session");

function signInAs(role: string, status = "active") {
  state.userId = "user-1";
  state.row = { id: "user-1", email: "a@b.ng", role, status, full_name: null };
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(AppError);
  await expect(promise).rejects.toMatchObject({ code });
}

describe("server-side guards", () => {
  beforeEach(() => {
    state.userId = null;
    state.row = null;
    state.ownsBusiness = false;
  });

  it("rejects signed-out callers", async () => {
    await expectCode(requireUser(), "UNAUTHENTICATED");
  });

  it("rejects suspended users", async () => {
    signInAs("customer", "suspended");
    await expectCode(requireUser(), "FORBIDDEN");
  });

  it("enforces roles from the database row", async () => {
    signInAs("customer");
    await expectCode(requireRole("admin"), "FORBIDDEN");
    await expect(requireRole("customer")).resolves.toMatchObject({ role: "customer" });
  });

  it("only lets owners manage a business", async () => {
    signInAs("business");
    await expectCode(requireBusinessOwner("biz"), "FORBIDDEN");
    state.ownsBusiness = true;
    await expect(requireBusinessOwner("biz")).resolves.toMatchObject({ role: "business" });
  });

  it("does not let customers manage businesses", async () => {
    signInAs("customer");
    state.ownsBusiness = true;
    await expectCode(requireBusinessOwner("biz"), "FORBIDDEN");
  });

  it("lets admins through unless disallowed", async () => {
    signInAs("admin");
    await expect(requireBusinessOwner("biz")).resolves.toMatchObject({ role: "admin" });
    await expectCode(requireBusinessOwner("biz", { allowAdmin: false }), "FORBIDDEN");
  });
});
