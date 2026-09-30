import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { AppError, isAppError, type ErrorCode } from "./app-error";
import { logger } from "./logger";

export type ApiErrorBody = {
  error: { code: ErrorCode; message: string; details?: Record<string, unknown> };
};

export type ApiResult<T> = { data: T } | ApiErrorBody;

/** Converts any thrown value into a safe JSON error response. Unknown errors never leak their message. */
export function toErrorResponse(error: unknown): NextResponse<ApiErrorBody> {
  if (error instanceof ZodError) {
    return toErrorResponse(
      new AppError("VALIDATION_FAILED", "The request data is invalid.", {
        details: { issues: error.issues.map(({ path, message }) => ({ path, message })) },
      }),
    );
  }

  if (isAppError(error)) {
    if (error.status >= 500) logger.error(error.message, { code: error.code, cause: error.cause });
    return NextResponse.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status },
    );
  }

  logger.error("Unhandled error", { error });
  return NextResponse.json(
    { error: { code: "INTERNAL", message: "Something went wrong. Please try again." } },
    { status: 500 },
  );
}

type RouteHandler<Ctx> = (request: Request, context: Ctx) => Promise<Response>;

/** Wraps a route handler so every thrown error becomes a consistent JSON response. */
export function withErrorHandling<Ctx>(handler: RouteHandler<Ctx>): RouteHandler<Ctx> {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}
