/**
 * Doc type/status Badge variant mapping — single derivation point for the
 * type/status badge colors so `DocCard` and `SearchResultCard` render the
 * exact same variant for the same `DocType`/`DocStatus` value (SPEC-037 D5,
 * AC-37-8 — search results previously had no badges at all; giving them a
 * hand-rolled second variant table would immediately drift from DocCard's).
 * Extracted from `DocCard.tsx`, which previously defined these inline as
 * private, unexported functions.
 *
 * Public surface: getTypeBadgeVariant, getStatusBadgeVariant
 * Side-effect class: pure
 * Source: SPEC-015 §3.3 M5 (origin), SPEC-037 §1 D5 (extraction for reuse)
 */

import type { BadgeProps } from "@/components/ui/badge";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

/** Map DocType to a badge variant for visual distinction. */
export function getTypeBadgeVariant(type: string): BadgeVariant {
  switch (type) {
    case "prd":
    case "spec":
      return "default";
    case "adr":
    case "plan":
      return "secondary";
    default:
      return "outline";
  }
}

/** Map DocStatus to a badge variant. */
export function getStatusBadgeVariant(status: string): BadgeVariant {
  switch (status) {
    case "active":
    case "approved":
      return "default";
    case "draft":
    case "in-review":
      return "secondary";
    case "archived":
    case "deprecated":
      return "outline";
    default:
      return "outline";
  }
}
