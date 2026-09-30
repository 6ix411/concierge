import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// `server-only` throws outside a React Server environment; tests exercise server modules directly.
vi.mock("server-only", () => ({}));
