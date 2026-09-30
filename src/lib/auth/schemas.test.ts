import { describe, expect, it } from "vitest";

import { signUpSchema } from "./schemas";

const valid = { fullName: "Ada Obi", email: "ADA@Test.ng ", password: "secret123", role: "customer" };

describe("signUpSchema", () => {
  it("normalises email", () => {
    expect(signUpSchema.parse(valid).email).toBe("ada@test.ng");
  });

  it("never accepts the admin role", () => {
    expect(signUpSchema.safeParse({ ...valid, role: "admin" }).success).toBe(false);
  });

  it("requires a password with letters and numbers", () => {
    expect(signUpSchema.safeParse({ ...valid, password: "abcdefgh" }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...valid, password: "12345678" }).success).toBe(false);
  });
});
