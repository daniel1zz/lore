// @reads packages/lore/src/adapters/cli/commands/rule.ts
// @reads assets/project/lore-config-template.yaml
/**
 * AC-BIA-1 (spec-baseline-approval-is-per-item-an-edit-adds-a-pending, BR-627, BR-628, BR-1338): on an approved leaf,
 * `lore rule set BR-x --statement Y` records a pending revision of that ONE rule. The leaf's other rules and own part stay
 * approved; `rule show` prints the approved statement and Y labelled pending; the readers (rule index, citation measure)
 * read the approved statement; approving the leaf after a review makes Y the approved version.
 *
 * Throwaway corpus per suite (mkdtemp + `lore init`); the AI behind `lore review` is a shell-script test double. Commands run
 * in-process through the real CLI.
 *
 * Coverage:
 *   HAPPY      the revision is pending, the approved version governs, approval promotes it.
 *   NEGATIVE   a retire of another rule is also pending only; a readers' lookup of the pending text finds nothing.
 *   BOUNDARY   setting the statement back to the approved one leaves nothing pending; the second rule and the node part
 *              carry no revision.
 *   STATE      the node is `draft` while a revision is pending and `approved` again once it is promoted.
 *   REGRESSION nothing in the write demotes a status first (the leaf stays reviewable item by item).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { SQLiteStore } from "../../src/store/sqlite-store";
import { specCitesLiveRuleInCorpus } from "../../src/service/spec-approval-citation";
import { APPROVED_STATEMENT, RULE_ARGS, createItemsCorpus, type ItemsCorpus } from "../helpers/baseline-items-corpus";

const TIMEOUT_MS = 120_000;
const REVISED = "The revised statement Y of the first rule.";
const SECOND = "The approved statement of the second rule.";

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
  corpus = await createItemsCorpus("bia-1");
  await corpus.must(["rule", "add", corpus.leaf, "--statement", SECOND, ...RULE_ARGS]);
  await corpus.approveAll(corpus.leaf);
}, TIMEOUT_MS);

afterAll(() => corpus.cleanup());

describe("AC-BIA-1: a rule revision is pending while the approved version governs", () => {
  it("HAPPY: rule set records a pending revision of BR-1 only; the other items stay approved", async () => {
    const before = corpus.node(corpus.leaf);
    const set = await corpus.lore(["rule", "set", "BR-1", "--statement", REVISED]);
    expect(set.exitCode).toBe(0);
    expect(set.stdout).toContain("pending revision of BR-1");

    const after = corpus.node(corpus.leaf);
    // the approved versions are untouched
    expect(after.extra.rules?.map((r) => r["statement"])).toEqual([APPROVED_STATEMENT, SECOND]);
    // exactly one pending revision, of BR-1, carrying Y; no pending revision of BR-2 or of the node's own part
    expect(Object.keys(after.extra.pending?.rules ?? {})).toEqual(["BR-1"]);
    expect(after.extra.pending?.rules?.["BR-1"]?.rule["statement"]).toBe(REVISED);
    expect(after.extra.pending?.node).toBeUndefined();
    // the write moved no approval and demoted nothing first: one new version, derived status draft (1 pending)
    expect(after.version).toBe(before.version + 1);
    expect(after.status).toBe("draft");
    expect(after.title).toBe(before.title);
    expect(after.content).toBe(before.content);
    const tree = await corpus.lore(["baseline", "tree"]);
    expect(tree.stdout).toContain("draft (1 pending)");
  }, TIMEOUT_MS);

  it("HAPPY: rule show prints the approved statement and Y labelled pending", async () => {
    const shown = await corpus.lore(["rule", "show", "BR-1"]);
    expect(shown.exitCode).toBe(0);
    expect(shown.stdout).toContain(APPROVED_STATEMENT);
    expect(shown.stdout).toMatch(/pending[^\n]*: The revised statement Y/);
    const json = JSON.parse((await corpus.lore(["rule", "show", "BR-1", "--json"])).stdout) as {
      data: { statement: string; state: string; pending?: { statement: string; kind: string } };
    };
    expect(json.data.statement).toBe(APPROVED_STATEMENT);
    expect(json.data.state).toBe("live");
    expect(json.data.pending).toMatchObject({ statement: REVISED, kind: "revision" });
  }, TIMEOUT_MS);

  it("NEGATIVE: the readers read the approved statement (rule index, citation measure, tree tally)", async () => {
    const byApproved = await corpus.lore(["rule", "find", "--text", "approved statement of the first"]);
    expect(byApproved.stdout).toContain("BR-1");
    const byPending = await corpus.lore(["rule", "find", "--text", "revised statement Y"]);
    expect(byPending.stdout).toContain("No matching rules");
    // a pending retirement of BR-2 does not stop it being live: a criterion citing it is still citable
    const retire = await corpus.lore(["rule", "set", "BR-2", "--lifecycle", "retired", "--note", "no longer true"]);
    expect(retire.exitCode).toBe(0);
    expect(await citesLive("BR-2")).toBe(true);
    const tree = JSON.parse((await corpus.lore(["baseline", "tree", corpus.leaf, "--json"])).stdout) as {
      data: Array<{ slug: string; rules: { live: number; retired: number }; pending: number }>;
    };
    const entry = tree.data.find((n) => n.slug === corpus.leaf);
    expect(entry?.rules).toMatchObject({ live: 2, retired: 0 });
    expect(entry?.pending).toBe(2);
    expect(corpus.registryState("BR-2")).toBe("live");
    expect(corpus.node(corpus.leaf).extra.rules?.[1]?.["lifecycle"]).toBe("live");
  }, TIMEOUT_MS);

  it("BOUNDARY: setting a statement back to the approved text leaves no revision of that rule", async () => {
    const back = await corpus.lore(["rule", "set", "BR-1", "--statement", APPROVED_STATEMENT]);
    expect(back.exitCode).toBe(0);
    const node = corpus.node(corpus.leaf);
    expect(Object.keys(node.extra.pending?.rules ?? {})).toEqual(["BR-2"]);
    const reject = await corpus.lore(["reject", corpus.leaf, "--item", "BR-2"]);
    expect(reject.exitCode).toBe(0);
    const clean = corpus.node(corpus.leaf);
    expect(clean.extra.pending).toBeUndefined();
    expect(clean.status).toBe("approved");
  }, TIMEOUT_MS);

  it("STATE: approving the leaf after a review makes Y the approved version", async () => {
    await corpus.must(["rule", "set", "BR-1", "--statement", REVISED]);
    expect(corpus.node(corpus.leaf).status).toBe("draft");
    await corpus.approveAll(corpus.leaf);
    const node = corpus.node(corpus.leaf);
    expect(node.extra.rules?.[0]?.["statement"]).toBe(REVISED);
    expect(node.extra.rules?.[1]?.["statement"]).toBe(SECOND);
    expect(node.extra.pending).toBeUndefined();
    expect(node.status).toBe("approved");
    const shown = await corpus.lore(["rule", "show", "BR-1"]);
    expect(shown.stdout).toContain(REVISED);
    expect(shown.stdout).not.toMatch(/\npending/);
  }, TIMEOUT_MS);
});
