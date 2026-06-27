/**
 * Dashboard type re-exports and dashboard-specific types.
 * Purpose: single import point for all domain types used in the dashboard.
 * Public surface: re-exported @lore/core types + DashboardRoute.
 * Invariants: dashboard MUST NOT import from @lore/lore (AC-D-Bnd1).
 * Side-effect class: pure (type-only module)
 */

// Re-export domain types from @lore/core (the boundary-safe package)
export type {
  DocRecord,
  DocSummary,
  DocType,
  DocStatus,
  DocRole,
  LinkType,
  CreateDocInput,
} from "@lore/core";

// Re-export API types from lib/api.ts for convenience
export type {
  DocWithNavigation,
  DocNavigation,
  ListResponse,
  SearchResponse,
  TreeNode,
  StatusResponse,
  ResolvedMdx,
  ResolvedComponent,
  ResolutionWarning,
  ListOpts,
  SearchOpts,
  TreeOpts,
  GetDocOpts,
} from "./lib/api.js";
