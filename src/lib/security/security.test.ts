import { describe, expect, it, vi } from "vitest";

import { contentSecurityPolicy } from "./csp";
import { allowedFileType, IMAGE_TYPES, sniffFileType } from "./files";

vi.mock("@/lib/env/server", () => ({ getServerEnv: () => ({ SUPABASE_SERVICE_ROLE_KEY: "test-secret" }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, delete: () => {} }) }));

const { isValidRecovery, recoveryCookie } = await import("@/lib/auth/recovery");

const bytes = (...values: (number | string)[]) =>
  new Uint8Array(values.flatMap((v) => (typeof v === "string" ? [...v].map((c) => c.charCodeAt(0)) : [v])));

describe("sniffFileType", () => {
  it("knows photos, videos and documents by their first bytes", () => {
    expect(sniffFileType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffFileType(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(sniffFileType(bytes("GIF89a"))).toBe("image/gif");
    expect(sniffFileType(bytes(0, 0, 0, 0x18, "ftypheic"))).toBe("image/heic");
    expect(sniffFileType(bytes(0, 0, 0, 0x18, "ftypmp42"))).toBe("video/mp4");
    expect(sniffFileType(bytes("%PDF-1.7"))).toBe("application/pdf");
    expect(sniffFileType(bytes("PK", 3, 4, "....[Content_Types].xml....word/document.xml"))).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(sniffFileType(bytes("Menu for Saturday:\n- jollof\n- small chops\n"))).toBe("text/plain");
  });

  it("refuses dangerous or disguised files", () => {
    expect(sniffFileType(bytes("<html><script>alert(1)</script>"))).toBeNull();
    expect(sniffFileType(bytes("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffFileType(bytes("MZ", 0x90, 0, 3, 0))).toBeNull();
    expect(sniffFileType(bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1))).toBeNull();
    expect(sniffFileType(bytes("PK", 3, 4, "[Content_Types].xml word/ vbaProject.bin"))).toBeNull();
    expect(sniffFileType(bytes("PK", 3, 4, "just a zip"))).toBeNull();
  });

  it("checks against what the feature allows", () => {
    expect(allowedFileType(bytes("%PDF-1.4"), IMAGE_TYPES)).toBeNull();
    expect(allowedFileType(bytes(0xff, 0xd8, 0xff), IMAGE_TYPES)).toBe("image/jpeg");
  });
});

describe("contentSecurityPolicy", () => {
  const policy = contentSecurityPolicy("abc123", "https://xyz.supabase.co", false);

  it("only runs scripts with this request's nonce", () => {
    expect(policy).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it("can't be framed, posts only here and talks only to Supabase", () => {
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("upgrade-insecure-requests");
    expect(policy).toContain("connect-src 'self' https://xyz.supabase.co wss://xyz.supabase.co");
  });
});

describe("password reset session", () => {
  const user = "a0000000-0000-0000-0000-000000000001";

  it("is valid for the same account for 15 minutes", () => {
    const { value } = recoveryCookie(user, 0);
    expect(isValidRecovery(value, user, 14 * 60 * 1000)).toBe(true);
    expect(isValidRecovery(value, user, 16 * 60 * 1000)).toBe(false);
  });

  it("can't be moved to another account or forged", () => {
    const { value } = recoveryCookie(user, 0);
    expect(isValidRecovery(value, "a0000000-0000-0000-0000-000000000002", 0)).toBe(false);
    const [id, expires] = value.split(".");
    expect(isValidRecovery(`${id}.${Number(expires) + 9999}.${value.split(".")[2]}`, user, 0)).toBe(false);
    expect(isValidRecovery(undefined, user, 0)).toBe(false);
  });
});
