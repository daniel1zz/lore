/**
 * Test fixture: approve every pending revision of a baseline node, so a rule written through `RuleService.addRule` (a PENDING
 * ADD, BR-626) is live for the rest of the test.
 *
 * Purpose: the per-item approval model (spec-baseline-approval-is-per-item-an-edit-adds-a-pending) makes a direct rule add
 *   not live until approved; the many suites whose subject is NOT approval seed their rules through this helper instead of
 *   running a review. It is the in-process peer of `lore review` + `lore approve`.
 * Public surface: {@link approvePending}, {@link approveAllPending}.
 * Invariants: uses a BARE `ReviewService` (no judgment store, no gates): `approve` then promotes EVERY pending revision of the
 *   node; a refusal throws (a fixture fault), so a suite never builds on a half-approved node.
 * Side-effect class: store write (test-only; throwaway stores).
 */

import type { StoreInterface } from "../../src/store/store-interface.js";
import { GateEnforcer } from "../../src/service/gate-enforcer.js";
import { RecordLockService } from "../../src/service/record-lock-service.js";
import { ReviewService } from "../../src/service/review-service.js";
import { pendingCountOf } from "../../src/service/baseline-pending.js";

/**
 * Promote every pending revision of EVERY baseline node that holds one.
 *
 * @param store - the (write-context-wrapped) store the nodes live in
 * @param reviewer - the approving actor (default `agent:fixture`)
 * @throws Error when a node's approval is refused
 */
export async function approveAllPending(store: StoreInterface, reviewer = "agent:fixture"): Promise<void> {
  const nodes = await store.findMany({ type: "baseline" });
  if (!nodes.ok) throw new Error(`approveAllPending: listing baseline nodes failed: ${JSON.stringify(nodes.error)}`);
  // reason: by slug, not id: a hand-built fixture id need not be a valid ULID, and `resolveDoc` would then read it as a slug
  for (const node of nodes.value) if (pendingCountOf(node.extra) > 0) await approvePending(store, node.slug, reviewer);
}

/**
 * Promote every pending revision of baseline node `node` to its approved version.
 *
 * @param store - the (write-context-wrapped) store the node lives in
 * @param node - id or slug of the baseline node
 * @param reviewer - the approving actor (default `agent:fixture`)
 * @throws Error when the approval is refused
 */
export async function approvePending(store: StoreInterface, node: string, reviewer = "agent:fixture"): Promise<void> {
  const review = new ReviewService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const approved = await review.approve(node, { reviewer });
  if (!approved.ok) throw new Error(`approvePending(${node}) refused: ${JSON.stringify(approved.error)}`);
}
