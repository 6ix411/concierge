// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { formatFileSize, isSeen, sharesContactDetails } from "./rules";

describe("sharesContactDetails", () => {
  it.each([
    "Call me on 08031234567",
    "my number is +234 803 123 4567",
    "0803-123-4567",
    "email ada@example.com",
  ])("notices %s", (text) => expect(sharesContactDetails(text)).toBe(true));
  it.each(["Booking for 250 guests on 17 Oct", "Total ₦1,350,000", "Setup at 08:30"])("ignores %s", (text) =>
    expect(sharesContactDetails(text)).toBe(false),
  );
});

describe("isSeen", () => {
  it("is seen once the other person read past the message", () => {
    expect(isSeen("2026-10-01T10:00:00Z", "2026-10-01T10:00:05Z")).toBe(true);
    expect(isSeen("2026-10-01T10:00:00Z", "2026-10-01T09:59:59Z")).toBe(false);
    expect(isSeen("2026-10-01T10:00:00Z", null)).toBe(false);
  });
});

describe("formatFileSize", () => {
  it("shows KB and MB", () => {
    expect(formatFileSize(200)).toBe("1 KB");
    expect(formatFileSize(150 * 1024)).toBe("150 KB");
    expect(formatFileSize(12.5 * 1024 * 1024)).toBe("12.5 MB");
  });
});

/** Every file under a folder. */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("the AI concierge never takes part in customer–business chat", () => {
  const aiFiles = ["src/lib/concierge", "src/app/concierge", "src/components/concierge"].flatMap(files);

  it("has AI code to check", () => expect(aiFiles.length).toBeGreaterThan(3));

  it.each(['"messages"', '"conversations"', '"conversation_reads"', "chat-attachments", "@/lib/chat"])(
    "no AI file references %s",
    (needle) => {
      const offenders = aiFiles.filter((file) => readFileSync(file, "utf8").includes(needle));
      expect(offenders).toEqual([]);
    },
  );
});
