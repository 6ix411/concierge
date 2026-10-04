import "server-only";

import { refresh } from "next/cache";

/**
 * Refreshes the page that called a server action. The same actions also serve the mobile API
 * (src/app/api/v1), where there is no page to refresh, so there it does nothing.
 */
export function refreshPage(): void {
  try {
    refresh();
  } catch {
    // Called from a route handler (API request): nothing to refresh.
  }
}
