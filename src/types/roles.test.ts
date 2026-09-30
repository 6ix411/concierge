import { describe, expect, it } from "vitest";

import { isUserRole, selfServiceRoles } from "./roles";

describe("roles", () => {
  it("never lets admin be self-selected", () => {
    expect(selfServiceRoles).not.toContain("admin");
  });

  it("recognises valid roles only", () => {
    expect(isUserRole("business")).toBe(true);
    expect(isUserRole("superuser")).toBe(false);
  });
});
