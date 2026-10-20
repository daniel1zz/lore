// @reads packages/lore/src/adapters/cli/commands/rule.ts
// @reads assets/project/lore-config-template.yaml
/**
 * AC-BIA-2 (spec-baseline-approval-is-per-item-an-edit-adds-a-pending, BR-626, BR-1338): `lore rule add` on an approved leaf
 * adds a PENDING ADD. The registry lifecycle is `proposed`, a criterion citing it is not citable as live, coverage and the
 * tree tallies do not count it, and the leaf's other items stay approved. `lore approve --item BR-n` without a review that
 * saw it exits 4; after `lore review` and `lore approve --item BR-n` it is live.
 *
 * Throwaway corpus (mkdtemp + `lore init`); the AI behind `lore review` is a shell-script test double.
 *
 * Coverage:
 *   HAPPY      review then approve --item makes the rule live: registry live, listed on the leaf, citable.
 *   NEGATIVE   approve --item before any review that saw it exits 4 naming BR-n and writes nothing; a citation of it is not live.
 *   BOUNDARY   the id is allocated (burned) at add time and shown by `rule show` as a pending add.
 *   STATE      registry `proposed` -> `live`; the leaf is `draft (1 pending)` then `approved`.
 *   REGRESSION an add never demotes: the approved BR-1 and the node part carry no revision.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { SQLiteStore } from "../../src/store/sqlite-store";
import { specCitesLiveRuleInCorpus } from "../../src/service/spec-approval-citation";
import { RULE_ARGS, createItemsCorpus, type ItemsCorpus } from "../helpers/baseline-items-corpus";

const TIMEOUT_MS = 120_000;
const ADDED = "A rule added directly to an approved leaf.";

let corpus: ItemsCorpus;

async function citesLive(ruleId: string): Promise<boolean> {
  const store = new SQLiteStore(join(corpus.dir, ".lore", "lore.db"), { readonly: true });
  try {
    const criteria = [{ id: "AC-X-1", statement: "does the thing in under 200ms", verify: { mode: "human" }, cites: [ruleId] }];
    const measured = await specCitesLiveRuleInCorpus(store, criteria, []);
    if (!measured.ok) throw new Error(JSON.stringify(measured.error));
    return measured.value;
  } finally {
    store.close();
  }
}

beforeAll(async () => {
  corpus = await createItemsCorpus("bia-2");
}, TIMEOUT_MS);

afterAll(() => corpus.cleanup());

describe("AC-BIA-2: a direct rule add is not live until approved", () => {
  it("HAPPY/STATE: the add is pending: registry proposed, not listed on the leaf, other items approved", async () => {
    const before = corpus.node(corpus.leaf);
    const added = await corpus.lore(["rule", "add", corpus.leaf, "--statement", ADDED, ...RULE_ARGS]);
    expect(added.exitCode).toBe(0);
    expect(added.stdout).toContain("BR-2");
    expect(added.stdout).toContain("pending add");

    const after = corpus.node(corpus.leaf);
    expect(corpus.registryState("BR-2")).toBe("proposed");
    expect(after.extra.rules?.map((r) => r["id"])).toEqual(["BR-1"]);
    expect(Object.keys(after.extra.pending?.rules ?? {})).toEqual(["BR-2"]);
    expect(after.extra.pending?.rules?.["BR-2"]?.rule["statement"]).toBe(ADDED);
    expect(after.extra.pending?.node).toBeUndefined();
    expect(after.version).toBe(before.version + 1);
    expect(after.status).toBe("draft");
    expect(corpus.registryState("BR-1")).toBe("live");
    const tree = await corpus.lore(["baseline", "tree", corpus.leaf]);
    expect(tree.stdout).toContain("draft (1 pending)");
  }, TIMEOUT_MS);

  it("NEGATIVE: a criterion citing the pending add is not citable as live; coverage and tallies do not count it", async () => {
    expect(await citesLive("BR-2")).toBe(false);
    expect(await citesLive("BR-1")).toBe(true);
    const tree = JSON.parse((await corpus.lore(["baseline", "tree", corpus.leaf, "--json"])).stdout) as {
      data: Array<{ slug: string; rules: { live: number } }>;
    };
    expect(tree.data.find((n) => n.slug === corpus.leaf)?.rules.live).toBe(1);
    const find = await corpus.lore(["rule", "find", "--text", "added directly"]);
    expect(find.stdout).toContain("No matching rules");
    const shown = await corpus.lore(["rule", "show", "BR-2"]);
    expect(shown.exitCode).toBe(0);
    expect(shown.stdout).toContain("pending add");
    expect(shown.stdout).toContain("not in the baseline until approved");
  }, TIMEOUT_MS);

  it("NEGATIVE: approve --item BR-2 without a review that saw it exits 4, naming it, and writes nothing", async () => {
    const before = corpus.node(corpus.leaf);
    const refused = await corpus.lore(["approve", corpus.leaf, "--item", "BR-2"]);
    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain("BR-2");
    expect(refused.stderr).toContain("lore review");
    const after = corpus.node(corpus.leaf);
    expect(after.version).toBe(before.version);
    expect(corpus.registryState("BR-2")).toBe("proposed");
    expect(after.extra.rules?.map((r) => r["id"])).toEqual(["BR-1"]);
  }, TIMEOUT_MS);

  it("HAPPY: after lore review, approve --item BR-2 makes it live", async () => {
    await corpus.must(["review", corpus.leaf]);
    const approved = await corpus.lore(["approve", corpus.leaf, "--item", "BR-2"]);
    expect(approved.exitCode).toBe(0);
    expect(approved.stdout).toContain("BR-2");
    expect(approved.stdout).toContain("status: approved");

    const node = corpus.node(corpus.leaf);
    expect(node.extra.rules?.map((r) => r["id"])).toEqual(["BR-1", "BR-2"]);
    expect(node.extra.pending).toBeUndefined();
    expect(node.status).toBe("approved");
    expect(corpus.registryState("BR-2")).toBe("live");
    expect(await citesLive("BR-2")).toBe(true);
    const shown = await corpus.lore(["rule", "show", "BR-2"]);
    expect(shown.stdout).toMatch(/BR-2 \[live, established\]/);
  }, TIMEOUT_MS);
});
