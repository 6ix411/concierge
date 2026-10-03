import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ErrorPage from "@/app/error";

import { CONNECTION_MESSAGE, isConnectionError } from "./connection";
import { useFormAction } from "./use-form-action";

afterEach(() => vi.restoreAllMocks());

describe("isConnectionError", () => {
  it("recognises how each browser reports a dropped connection", () => {
    expect(isConnectionError(new TypeError("Failed to fetch"))).toBe(true); // Chrome
    expect(isConnectionError(new TypeError("Load failed"))).toBe(true); // Safari
    expect(isConnectionError(new TypeError("NetworkError when attempting to fetch resource."))).toBe(true); // Firefox
  });

  it("treats the browser being offline as a dropped connection", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect(isConnectionError(new Error("anything"))).toBe(true);
  });

  it("leaves real errors alone", () => {
    expect(isConnectionError(new Error("Could not create the booking."))).toBe(false);
    expect(isConnectionError("Failed to fetch")).toBe(false);
  });
});

type State = { status: "idle" | "error" | "success"; message?: string };

function Form({ action }: { action: (state: State, data: FormData) => Promise<State> }) {
  const [state, formAction, pending] = useFormAction(action, { status: "idle" });
  return (
    <form action={formAction}>
      <p role="status">{pending ? "sending" : (state.message ?? state.status)}</p>
      <button type="submit">Send</button>
    </form>
  );
}

describe("useFormAction", () => {
  it("shows a connection message when the request can't get through", async () => {
    render(<Form action={() => Promise.reject(new TypeError("Failed to fetch"))} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send" })));
    expect(await screen.findByText(CONNECTION_MESSAGE)).toBeInTheDocument();
  });

  it("passes the action's own result through", async () => {
    render(<Form action={async () => ({ status: "error", message: "Pick a date." })} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send" })));
    expect(await screen.findByText("Pick a date.")).toBeInTheDocument();
  });
});

describe("the error page", () => {
  it("apologises, offers a retry and gives a reference, without the technical message", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const retry = vi.fn();
    const error = Object.assign(new Error('relation "bookings" does not exist'), { digest: "abc123" });
    render(<ErrorPage error={error} retry={retry} />);
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeInTheDocument();
    expect(screen.getByText(/abc123/)).toBeInTheDocument();
    expect(screen.queryByText(/does not exist/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
