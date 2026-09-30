import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AppError } from "./app-error";
import { toErrorResponse, withErrorHandling } from "./http";

describe("toErrorResponse", () => {
  it("returns an AppError's code, message and status", async () => {
    const response = toErrorResponse(new AppError("NOT_FOUND", "Business not found."));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "NOT_FOUND", message: "Business not found." } });
  });

  it("hides the message of unexpected errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = toErrorResponse(new Error("db password is hunter2"));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("hunter2");
  });

  it("maps validation errors to 422", async () => {
    const result = z.object({ email: z.email() }).safeParse({ email: "nope" });
    const response = toErrorResponse(result.error);
    expect(response.status).toBe(422);
  });
});

describe("withErrorHandling", () => {
  it("turns a thrown AppError into a response", async () => {
    const handler = withErrorHandling(async () => {
      throw new AppError("FORBIDDEN", "Not allowed.");
    });
    const response = await handler(new Request("http://test"), {});
    expect(response.status).toBe(403);
  });
});
