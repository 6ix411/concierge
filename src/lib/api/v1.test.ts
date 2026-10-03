import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

const state: { token: string | null } = { token: null };

vi.mock("@/lib/supabase/server", () => ({ bearerToken: async () => state.token }));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({ id: "user-1", role: "customer" }),
}));

const { apiRoute, idParam, readJson, requireApiUser, runFormAction, toFormData } = await import("./v1");

beforeEach(() => {
  state.token = null;
});

describe("apiRoute", () => {
  it("wraps results as { data } and never caches", async () => {
    const response = await apiRoute(async () => ({ ok: true }))(new Request("http://x"), {});
    expect(await response.json()).toEqual({ data: { ok: true } });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("turns refusals into { error } with the right status", async () => {
    const response = await apiRoute(async () => {
      throw new AppError("NOT_FOUND", "Not found.");
    })(new Request("http://x"), {});
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("NOT_FOUND");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("requireApiUser", () => {
  it("refuses calls without a bearer token", async () => {
    await expect(requireApiUser()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("returns the user when a token is sent", async () => {
    state.token = "a.b.c";
    await expect(requireApiUser()).resolves.toMatchObject({ id: "user-1" });
  });
});

describe("readJson", () => {
  const post = (body: string, headers: Record<string, string> = {}) =>
    new Request("http://x", { method: "POST", body, headers });

  it("accepts a JSON object", async () => {
    await expect(readJson(post('{"a":1}'))).resolves.toEqual({ a: 1 });
  });

  it("refuses arrays, bad JSON and large bodies", async () => {
    await expect(readJson(post("[1]"))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(readJson(post("{nope"))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(readJson(post("{}", { "content-length": String(65 * 1024) }))).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

describe("idParam", () => {
  it("treats anything that isn't an id as not found", () => {
    expect(idParam("c0000000-0000-0000-0000-000000000007")).toBe("c0000000-0000-0000-0000-000000000007");
    expect(() => idParam("1 or 1=1")).toThrow(AppError);
  });
});

describe("toFormData", () => {
  it("sends JSON the way the website's forms do", () => {
    const form = toFormData({
      note: "Hi",
      guests: 4,
      agree: true,
      skip: false,
      gone: null,
      tags: ["a", "b"],
    });
    expect(form.get("note")).toBe("Hi");
    expect(form.get("guests")).toBe("4");
    expect(form.get("agree")).toBe("on");
    expect(form.has("skip")).toBe(false);
    expect(form.has("gone")).toBe(false);
    expect(form.getAll("tags")).toEqual(["a", "b"]);
  });

  it("refuses nested objects", () => {
    expect(() => toFormData({ nested: { a: 1 } })).toThrow(/must be text/);
  });
});

describe("runFormAction", () => {
  it("returns the action's message", async () => {
    await expect(runFormAction(async () => ({ status: "success", message: "Done." }), {})).resolves.toEqual({
      message: "Done.",
      path: null,
    });
  });

  it("returns where the website would have gone after a redirect", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/account/bookings/abc;307;",
    });
    await expect(
      runFormAction(async () => {
        throw redirect;
      }, {}),
    ).resolves.toEqual({ message: null, path: "/account/bookings/abc" });
  });

  it("maps field errors to 422 and other errors to 400", async () => {
    await expect(
      runFormAction(async () => ({ status: "error", fieldErrors: { notes: "Too long." } }), {}),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { fields: { notes: "Too long." } } });
    await expect(runFormAction(async () => ({ status: "error", message: "No." }), {})).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "No.",
    });
  });

  it("lets other errors through", async () => {
    await expect(
      runFormAction(async () => {
        throw new Error("boom");
      }, {}),
    ).rejects.toThrow("boom");
  });
});
