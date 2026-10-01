import { describe, expect, it } from "vitest";

import { canReview } from "@/lib/bookings/rules";

import { MAX_REVIEW_PHOTO_BYTES, reviewPhotosProblem, sniffImageType } from "./rules";

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

describe("sniffImageType", () => {
  it("recognises JPEG, PNG and WebP from their first bytes", () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("image/png");
    expect(sniffImageType(bytes(...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")))).toBe("image/webp");
  });

  it("rejects anything else, whatever it is called", () => {
    expect(sniffImageType(bytes(...ascii("<svg onload=alert(1)>")))).toBeNull();
    expect(sniffImageType(bytes(...ascii("%PDF-1.7")))).toBeNull();
    expect(sniffImageType(bytes(...ascii("GIF89a")))).toBeNull();
    expect(sniffImageType(bytes())).toBeNull();
  });
});

describe("reviewPhotosProblem", () => {
  const photo = { size: 1000, type: "image/jpeg" };

  it("allows no photos or up to four", () => {
    expect(reviewPhotosProblem([])).toBeNull();
    expect(reviewPhotosProblem([photo, photo, photo, photo])).toBeNull();
  });

  it("refuses a fifth photo, other file types and large files", () => {
    expect(reviewPhotosProblem([photo, photo, photo, photo, photo])).toMatch(/up to 4/);
    expect(reviewPhotosProblem([{ size: 1000, type: "image/gif" }])).toMatch(/JPG, PNG or WebP/);
    expect(reviewPhotosProblem([{ size: MAX_REVIEW_PHOTO_BYTES + 1, type: "image/png" }])).toMatch(/5 MB/);
  });
});

describe("canReview", () => {
  const booking = { status: "completed", hasReview: false } as Parameters<typeof canReview>[0];

  it("only completed bookings without a review", () => {
    expect(canReview(booking)).toBe(true);
    expect(canReview({ ...booking, hasReview: true })).toBe(false);
    for (const status of [
      "confirmed",
      "in_progress",
      "cancelled",
      "disputed",
      "refunded",
      "reviewed",
    ] as const)
      expect(canReview({ ...booking, status })).toBe(false);
  });
});
