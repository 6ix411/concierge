"use client";

import { useActionState } from "react";

import { CONNECTION_MESSAGE, isConnectionError } from "./connection";

type State = { status: string; message?: string };

/**
 * `useActionState` for forms that call a server action. If the request can't get through (the
 * phone lost signal), the form shows a "check your connection" error instead of the whole page
 * failing. Any other error still reaches the error page.
 */
export function useFormAction<S extends State>(
  action: (state: S, payload: FormData) => Promise<S>,
  initialState: S,
) {
  return useActionState<S, FormData>(async (state, payload) => {
    try {
      return await action(state as S, payload);
    } catch (error) {
      if (isConnectionError(error)) return { ...(state as S), status: "error", message: CONNECTION_MESSAGE };
      throw error;
    }
  }, initialState as Awaited<S>) as [S, (payload: FormData) => void, boolean];
}
