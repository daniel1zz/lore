/**
 * TanStack Query client singleton for the Lore dashboard.
 * Purpose: shared QueryClient instance with sensible defaults for read-only corpus browsing.
 * Public surface: queryClient
 * Invariants: staleTime=5min avoids redundant refetches; retry=1 guards against transient errors.
 * Side-effect class: stateful (holds query cache)
 */

import { QueryClient } from "@tanstack/react-query";

/** Shared query client. Exported for injection into QueryClientProvider and tests. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
});
