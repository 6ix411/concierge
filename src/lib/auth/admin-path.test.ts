import { afterEach, describe, expect, it, vi } from "vitest";

import { adminHref, getAdminPath, isInternalAdminPath, toInternalAdminPath } from "./admin-path";
import { areaForPath, homePathForRole } from "./permissions";

const secret = "5c1e0f7a9b2d4e6f8a0c2e4f";

describe("private admin path", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is disabled when not configured or too short to be private", () => {
    vi.stubEnv("ADMIN_PATH", "");
    expect(getAdminPath()).toBeNull();
    vi.stubEnv("ADMIN_PATH", "admin");
    expect(getAdminPath()).toBeNull();
    vi.stubEnv("ADMIN_PATH", "../../etc/passwd-12345678");
    expect(getAdminPath()).toBeNull();
    expect(areaForPath("/admin")).toBeNull();
  });

  it("maps the private URL onto the internal route", () => {
    vi.stubEnv("ADMIN_PATH", secret);
    expect(getAdminPath()).toBe(`/${secret}`);
    expect(toInternalAdminPath(`/${secret}`)).toBe("/admin");
    expect(toInternalAdminPath(`/${secret}/businesses`)).toBe("/admin/businesses");
    expect(toInternalAdminPath(`/${secret}x`)).toBeNull();
    expect(adminHref("/businesses")).toBe(`/${secret}/businesses`);
  });

  it("treats only the private URL as the admin area", () => {
    vi.stubEnv("ADMIN_PATH", secret);
    expect(areaForPath(`/${secret}/disputes`)).toBe("admin");
    expect(areaForPath("/admin")).toBeNull();
    expect(isInternalAdminPath("/admin/disputes")).toBe(true);
    expect(isInternalAdminPath("/administrator")).toBe(false);
  });

  it("sends admins to the private URL after sign-in", () => {
    vi.stubEnv("ADMIN_PATH", secret);
    expect(homePathForRole("admin")).toBe(`/${secret}`);
  });
});
