/**
 * Needs-you route — `/needs-you`. Thin wrapper around the props-driven `NeedsYou` page (read-only).
 * Source: spec-human-review-surface-decisions-audit-items-and-pending D3
 */

import { createFileRoute } from "@tanstack/react-router";
import { NeedsYou } from "@/components/NeedsYou";

export const Route = createFileRoute("/needs-you")({
  component: NeedsYouPage,
});

function NeedsYouPage(): React.ReactElement {
  return <NeedsYou />;
}
