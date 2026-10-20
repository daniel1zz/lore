// @reads packages/lore/src/adapters/cli/commands/approve.ts
// @reads packages/lore/src/adapters/cli/commands/reject.ts
// @reads assets/project/lore-config-template.yaml
/**
 * AC-BIA-3 (spec-baseline-approval-is-per-item-an-edit-adds-a-pending, BR-627, BR-1338): two sessions each add one rule to
 * one leaf; `lore review` sees both; a third rule added after the review is not promoted by `lore approve` and stays pending;
 * a second write to a reviewed item replaces its pending revision, so `lore approve` then exits 4 naming it;
 * `lore reject --item` discards one pending revision and leaves the other.
 *
 * Throwaway corpus (mkdtemp + `lore init`); the AI behind `lore review` is a shell-script test double.
 *
 * Coverage:
 *   HAPPY      two sessions' adds are both pending and both promoted by one review + approve.
 *   NEGATIVE   a rule added after the review is not promoted; a revision rewritten after the review refuses the approval and
 *              nothing is approved.
 *   BOUNDARY   `--item` on an unchanged reviewed revision still approves while a sibling is stale.
 *   STATE      the rewritten revision has a new revision id; the discarded item reads as never written.
 *   REGRESSION two sessions writing different items never interfere (both revisions are kept).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RULE_ARGS, createItemsCorpus, type ItemsCorpus } from "../helpers/baseline-items-corpus";

const TIMEOUT_MS = 180_000;

let corpus: ItemsCorpus;

const idsOf = (rules: Array<Record<string, unknown>> | undefined): unknown[] => (rules ?? []).map((r) => r["id"]);

beforeAll(async () => {
  corpus = await createItemsCorpus("bia-3");
}, TIMEOUT_MS);

afterAll(() => corpus.cleanup());

describe("AC-BIA-3: approval promotes exactly the reviewed revisions", () => {
  it("HAPPY: two sessions add one rule each; the review sees both; approve promotes both", async () => {
    await corpus.must(["rule", "add", corpus.leaf, "--statement", "Rule added by session A.", ...RULE_ARGS], "session-a");
    await corpus.must(["rule", "add", corpus.leaf, "--statement", "Rule added by session B.", ...RULE_ARGS], "session-b");
    // REGRESSION: neither write demoted or replaced the other's revision
    const pending = corpus.node(corpus.leaf).extra.pending?.rules ?? {};
    expect(Object.keys(pending).sort()).toEqual(["BR-2", "BR-3"]);

    await corpus.must(["review", corpus.leaf]);
    // a third rule written AFTER the review
    await corpus.must(["rule", "add", corpus.leaf, "--statement", "Rule added after the review.", ...RULE_ARGS], "session-a");
    expect(Object.keys(corpus.node(corpus.leaf).extra.pending?.rules ?? {}).sort()).toEqual(["BR-2", "BR-3", "BR-4"]);

    const approved = await corpus.lore(["approve", corpus.leaf]);
    expect(approved.exitCode).toBe(0);
    expect(approved.stdout).toContain("BR-2");
    expect(approved.stdout).toContain("BR-3");
    expect(approved.stdout).toContain("1 pending: BR-4");

    const node = corpus.node(corpus.leaf);
    expect(idsOf(node.extra.rules)).toEqual(["BR-1", "BR-2", "BR-3"]);
    // NEGATIVE: the rule written after the review was not promoted and stays pending (and proposed in the registry)
    expect(Object.keys(node.extra.pending?.rules ?? {})).toEqual(["BR-4"]);
    expect(corpus.registryState("BR-4")).toBe("proposed");
    expect(corpus.registryState("BR-2")).toBe("live");
    expect(corpus.registryState("BR-3")).toBe("live");
    expect(node.status).toBe("draft");
  }, TIMEOUT_MS);

  it("NEGATIVE/STATE: a revision rewritten after the review refuses the approval, naming it; nothing is approved", async () => {
    await corpus.must(["rule", "add", corpus.leaf, "--statement", "Rule five, first wording.", ...RULE_ARGS]);
    await corpus.must(["rule", "add", corpus.leaf, "--statement", "Rule six.", ...RULE_ARGS]);
    await corpus.must(["review", corpus.leaf]);
    const reviewed = corpus.node(corpus.leaf).extra.pending?.rules ?? {};
    expect(Object.keys(reviewed).sort()).toEqual(["BR-4", "BR-5", "BR-6"]);
    const firstRevision = reviewed["BR-5"]?.revision_id;

    // a second write to a reviewed item replaces its pending revision
    await corpus.must(["rule", "set", "BR-5", "--statement", "Rule five, second wording."]);
    const rewritten = corpus.node(corpus.leaf).extra.pending?.rules ?? {};
    expect(rewritten["BR-5"]?.rule["statement"]).toBe("Rule five, second wording.");
    expect(rewritten["BR-5"]?.revision_id).not.toBe(firstRevision);
    expect(rewritten["BR-6"]?.revision_id).toBe(reviewed["BR-6"]?.revision_id);

    const before = corpus.node(corpus.leaf);
    const refused = await corpus.lore(["approve", corpus.leaf]);
    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain("BR-5");
    expect(refused.stderr).toContain("changed after the review");
    const after = corpus.node(corpus.leaf);
    expect(after.version).toBe(before.version);
    expect(idsOf(after.extra.rules)).toEqual(["BR-1", "BR-2", "BR-3"]);
  }, TIMEOUT_MS);

  it("BOUNDARY: --item approves the unchanged reviewed revision while its sibling is stale", async () => {
    const approved = await corpus.lore(["approve", corpus.leaf, "--item", "BR-6"]);
    expect(approved.exitCode).toBe(0);
    const node = corpus.node(corpus.leaf);
    expect(idsOf(node.extra.rules)).toEqual(["BR-1", "BR-2", "BR-3", "BR-6"]);
    expect(Object.keys(node.extra.pending?.rules ?? {}).sort()).toEqual(["BR-4", "BR-5"]);
    expect(corpus.registryState("BR-6")).toBe("live");
    expect(node.status).toBe("draft");
  }, TIMEOUT_MS);

  it("STATE: reject --item discards one pending revision and leaves the other", async () => {
    const rejected = await corpus.lore(["reject", corpus.leaf, "--item", "BR-5"]);
    expect(rejected.exitCode).toBe(0);
    expect(rejected.stdout).toContain("BR-5");
    const node = corpus.node(corpus.leaf);
    expect(Object.keys(node.extra.pending?.rules ?? {})).toEqual(["BR-4"]);
    expect(idsOf(node.extra.rules)).toEqual(["BR-1", "BR-2", "BR-3", "BR-6"]);
    // NEGATIVE: an item that holds no pending revision is refused
    const again = await corpus.lore(["reject", corpus.leaf, "--item", "BR-5"]);
    expect(again.exitCode).toBe(4);
    expect(again.stderr).toContain("BR-5");
  }, TIMEOUT_MS);
});
