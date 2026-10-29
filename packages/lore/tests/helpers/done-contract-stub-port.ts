/**
 * Test helper: a done-contract port for unit tests that build a bare `ReviewService` and approve a task.
 *
 * Purpose: `ReviewService.approve` of a task needs a done-contract port (D43: approve always compiles or refuses), so a bare
 * construction in a unit test passes this stub, which returns a fixed valid contract and never reads a store or git.
 * Public surface: {@link stubDoneContractPort}.
 * Side-effect class: pure.
 */

import { ok } from "@lore/core";
import type { ApproveContractPort } from "../../src/service/done-contract-service";

/** A port that compiles every task to a one-oracle `code` contract at a fixed commit. */
export function stubDoneContractPort(): ApproveContractPort {
  return {
    async compileForApprove(task, opts) {
      return ok({
        compiled_at_commit: "0".repeat(40),
        kind: "code",
        base_branch: "main",
        oracles: [{ id: "typecheck", command: "bun run typecheck" }],
        red_required: opts.redWaiverReason === undefined,
        ...(opts.redWaiverReason !== undefined ? { red_waiver_reason: opts.redWaiverReason } : {}),
        landing_route: "main",
        new_symbols: [],
        added_oracles: [],
      });
    },
  };
}
