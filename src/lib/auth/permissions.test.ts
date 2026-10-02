import { describe, expect, it } from "vitest";

import { areaForPath, canAccessArea, homePathForRole, safeRedirectPath } from "./permissions";

describe("canAccessArea", () => {
  it.each([
    ["customer", "account", true],
    ["customer", "business", false],
    ["customer", "admin", false],
    ["business", "business", true],
    ["business", "account", false],
    ["business", "admin", false],
    ["admin", "admin", true],
    ["admin", "business", true],
  ] as const)("%s → %s = %s", (role, area, expected) => {
    expect(canAccessArea(role, area)).toBe(expected);
  });
});

describe("areaForPath", () => {
  it("matches areas and their sub-paths only", () => {
    expect(areaForPath("/business")).toBe("business");
    expect(areaForPath("/account/bookings")).toBe("account");
    expect(areaForPath("/accounts")).toBeNull();
    expect(areaForPath("/")).toBeNull();
  });
});

describe("homePathForRole", () => {
  it("sends each role to its own area", () => {
    expect(homePathForRole("customer")).toBe("/account");
    expect(homePathForRole("business")).toBe("/business");
  });
});

describe("safeRedirectPath", () => {
  it("allows relative paths", () => {
    expect(safeRedirectPath("/business?tab=1")).toBe("/business?tab=1");
  });
  it.each([
    "https://evil.com",
    "//evil.com",
    "/\\evil.com",
    "evil",
    undefined,
    "/\t/evil.com",
    "/\n/evil.com",
    "/ /evil.com",
  ])("rejects %s", (value) => {
    expect(safeRedirectPath(value, "/home")).toBe("/home");
  });
});
