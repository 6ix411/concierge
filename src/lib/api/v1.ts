import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import type { FormState } from "@/lib/auth/schemas";
import { requireUser, type SessionUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { toErrorResponse } from "@/lib/errors/http";
import { bearerToken } from "@/lib/supabase/server";

/**
 * Version 1 of the JSON API for the future iOS and Android apps (docs/api.md). It is a thin layer
 * over the same server code the website uses: the same validation, permission checks, rate limits
 * and database rules, so a phone app can never do more than the website.
 *
 * Every response is `{ data }` or `{ error: { code, message, details? } }` and is never cached.
 */
type Handler<Ctx> = (request: Request, context: Ctx) => Promise<unknown>;

export function apiRoute<Ctx>(handler: Handler<Ctx>) {
  return async (request: Request, context: Ctx): Promise<Response> => {
    try {
      const data = await handler(request, context);
      return noStore(NextResponse.json({ data }));
    } catch (error) {
      return noStore(toErrorResponse(error));
    }
  };
}

function noStore<T extends Response>(response: T): T {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/**
 * The signed-in user of an API call. Only the Authorization header counts here: a browser's session
 * cookie is never accepted, so another website can't make a visitor's browser call the API.
 */
export async function requireApiUser(): Promise<SessionUser> {
  if (!(await bearerToken()))
    throw new AppError("UNAUTHENTICATED", "Send the access token as Authorization: Bearer <token>.");
  return requireUser();
}

/** The JSON body, which must be an object. */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length") ?? 0) > 64 * 1024)
    throw new AppError("BAD_REQUEST", "The request is too large.");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AppError("BAD_REQUEST", "Send a JSON object.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new AppError("BAD_REQUEST", "Send a JSON object.");
  return body as Record<string, unknown>;
}

/** An id in the URL: anything that isn't one is "not found", like the website. */
export function idParam(value: string): string {
  const id = z.guid().safeParse(value);
  if (!id.success) throw new AppError("NOT_FOUND", "Not found.");
  return id.data;
}

/** JSON fields as the form fields the website sends: arrays repeat, true is "on", null is left out. */
export function toFormData(fields: Record<string, unknown>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item === null || item === undefined || item === false) continue;
      if (typeof item === "object")
        throw new AppError("BAD_REQUEST", `"${key}" must be text, a number or a list.`);
      form.append(key, item === true ? "on" : String(item));
    }
  }
  return form;
}

/** Where a server action asked to send the browser (Next.js redirect), if it did. */
function redirectTarget(error: unknown): string | null {
  const digest = (error as { digest?: unknown } | null)?.digest;
  if (typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT;")) return null;
  return digest.split(";")[2] ?? null;
}

/**
 * Runs one of the website's form actions for an API call and turns its outcome into the API's
 * shape: a validation problem is 422 with the field messages, any other refusal 400, success the
 * action's message plus, when the website would have moved to a new page, that page's path
 * (for example the new booking's id in `/account/bookings/<id>`).
 */
export async function runFormAction(
  action: (prev: FormState, form: FormData) => Promise<FormState>,
  fields: Record<string, unknown>,
): Promise<{ message: string | null; path: string | null }> {
  let state: FormState;
  try {
    state = await action({ status: "idle" }, toFormData(fields));
  } catch (error) {
    const path = redirectTarget(error);
    if (path) return { message: null, path };
    throw error;
  }
  if (state.status === "error") {
    if (state.fieldErrors && Object.keys(state.fieldErrors).length)
      throw new AppError("VALIDATION_FAILED", state.message ?? "Check the highlighted fields.", {
        details: { fields: state.fieldErrors },
      });
    throw new AppError("BAD_REQUEST", state.message ?? "That didn't work. Please try again.");
  }
  return { message: state.message ?? null, path: null };
}
