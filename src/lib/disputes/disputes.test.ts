import { describe, expect, it } from "vitest";

import { bookingStatusAfterDispute, isDisputeOpen } from "@/lib/admin/rules";

import { MAX_EVIDENCE_BYTES, evidenceProblem, sniffEvidenceType } from "./rules";

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
const bytes = (...values: number[]) => new Uint8Array(values);

describe("sniffEvidenceType", () => {
  it("recognises photos, videos and PDFs from their first bytes", () => {
    expect(sniffEvidenceType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffEvidenceType(bytes(...ascii("%PDF-1.7\n")))).toBe("application/pdf");
    expect(sniffEvidenceType(bytes(0, 0, 0, 0x18, ...ascii("ftypmp42")))).toBe("video/mp4");
    expect(sniffEvidenceType(bytes(0, 0, 0, 0x14, ...ascii("ftypqt  ")))).toBe("video/quicktime");
    expect(sniffEvidenceType(bytes(0x1a, 0x45, 0xdf, 0xa3, 0x01))).toBe("video/webm");
  });

  it("rejects anything else, whatever it is called", () => {
    expect(sniffEvidenceType(bytes(...ascii("<html><script>")))).toBeNull();
    expect(sniffEvidenceType(bytes(...ascii("PK\u0003\u0004 word document")))).toBeNull();
    expect(sniffEvidenceType(bytes(...ascii("MZ executable")))).toBeNull();
  });
});

describe("evidenceProblem", () => {
  const pdf = { size: 1000, type: "application/pdf" };

  it("allows up to five photos, videos or PDFs within 20 MB", () => {
    expect(evidenceProblem([])).toBeNull();
    expect(evidenceProblem([pdf, pdf, pdf, pdf, { size: 1000, type: "video/mp4" }])).toBeNull();
  });

  it("refuses too many files, other types and too much in total", () => {
    expect(evidenceProblem(Array(6).fill(pdf))).toMatch(/up to 5/);
    expect(evidenceProblem([{ size: 10, type: "application/zip" }])).toMatch(/photos/);
    expect(
      evidenceProblem([
        { size: MAX_EVIDENCE_BYTES / 2, type: "video/mp4" },
        { size: MAX_EVIDENCE_BYTES / 2 + 1, type: "video/mp4" },
      ]),
    ).toMatch(/20 MB/);
  });
});

describe("dispute statuses", () => {
  it("open, under review and escalated are still being handled", () => {
    expect(["open", "under_review", "escalated"].every((s) => isDisputeOpen(s as never))).toBe(true);
    expect(isDisputeOpen("resolved")).toBe(false);
    expect(isDisputeOpen("closed")).toBe(false);
  });

  it("a dismissed dispute returns the booking to where it was", () => {
    expect(bookingStatusAfterDispute("dismissed", "in_progress")).toBe("in_progress");
    expect(bookingStatusAfterDispute("customer", "completed")).toBe("cancelled");
    expect(bookingStatusAfterDispute("business", "reviewed")).toBe("reviewed");
  });
});
