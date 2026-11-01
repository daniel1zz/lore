// @reads packages/lore/src/adapters/cli/commands/baseline.ts
// @reads packages/lore/src/adapters/cli/commands/rule.ts
// @reads assets/project/lore-config-template.yaml
/**
 * AC-BIA-5 (spec-baseline-approval-is-per-item-an-edit-adds-a-pending, BR-628, BR-648, BR-722, BR-1339): `baseline set-label`,
 * `baseline depends`, `baseline glossary`, `baseline map --command`, a body edit and a rule move each record a pending revision
 * of exactly ONE item; the node prints `draft (N pending)`; `lore set --status approved` on a baseline node exits 4; coverage
 * measures the approved commands; a node with nothing pending prints `approved`.
 *
 * Throwaway corpus (mkdtemp + `lore init`); the AI behind `lore review` is a shell-script test double.
 *
 * Coverage:
 *   HAPPY      each own-part write is ONE pending node revision holding only that field; a move is one pending rule revision.
 *   NEGATIVE   `lore set --status approved|draft` on a baseline node exits 4; the stored text/label/commands stay approved.
 *   BOUNDARY   several own-part writes share the node's one pending item (count stays 1); a clean node prints approved.
 *   STATE      the derived status follows the pending count, and an approved move relocates the rule with the registry.
 *   REGRESSION coverage's declared commands are the approved ones until the revision is approved.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { leavesUnder } from "../../src/service/leaf-coverage";
import { createItemsCorpus, type ItemsCorpus, type StoredNode } from "../helpers/baseline-items-corpus";

const TIMEOUT_MS = 180_000;

/**
 * The decision an agent's write to a node with an approved version carries (BR-1476). This suite is about derived status, not
 * decisions, so every gated write below appends the same complete decision.
 */
const DECIDED = ["--reason", "exercise the pending revision", "--premise", "the suite drives it|issue:#1|A", "--alt", "write nothing|nothing to observe"];

let corpus: ItemsCorpus;
let otherLeaf = "";
let editSeq = 0;

/** The node-part fields the pending revision carries (its `revision_id` aside). */
function nodeFields(node: StoredNode): string[] {
  return Object.keys(node.extra.pending?.node ?? {}).filter((k) => k !== "revision_id");
}

/**
 * A body edit of the templated leaf: its text is rendered from its fields (`set --content` is refused), so the edit
 * rewrites the `statement` field through a fields file.
 */
function statementEdit(text: string): string[] {
  const path = join(corpus.dir, `statement-${String(++editSeq)}.json`);
  writeFileSync(path, JSON.stringify({ fields: { statement: text } }));
  return ["--fields-file", path];
}

/** The tree line of the leaf. */
async function treeLine(slug: string): Promise<string> {
  const tree = await corpus.must(["baseline", "tree"]);
  return tree.stdout.split("\n").find((l) => l.includes(`(${slug},`)) ?? "";
}

async function discardNodeRevision(): Promise<void> {
  await corpus.must(["reject", corpus.leaf, "--item", "node"]);
  const node = corpus.node(corpus.leaf);
  expect(node.extra.pending).toBeUndefined();
  expect(node.status).toBe("approved");
}

beforeAll(async () => {
  corpus = await createItemsCorpus("bia-5");
  otherLeaf = await corpus.addLeaf("Other leaf");
}, TIMEOUT_MS);

afterAll(() => corpus.cleanup());

describe("AC-BIA-5: node status is derived from its items", () => {
  it("HAPPY: set-label records ONE pending revision of the node part; the approved label stays", async () => {
    const before = corpus.node(corpus.leaf);
    const set = await corpus.lore(["baseline", "set-label", corpus.leaf, "A new label", ...DECIDED]);
    expect(set.exitCode).toBe(0);
    const node = corpus.node(corpus.leaf);
    expect(node.extra["label"]).toBe("Leaf");
    expect(nodeFields(node)).toEqual(["label"]);
    expect(node.extra.pending?.node?.["label"]).toBe("A new label");
    expect(Object.keys(node.extra.pending?.rules ?? {})).toEqual([]);
    expect(node.extra.rules).toEqual(before.extra.rules);
    expect(node.status).toBe("draft");
    expect(await treeLine(corpus.leaf)).toContain("draft (1 pending)");
    await discardNodeRevision();
    expect(corpus.node(corpus.leaf).extra["label"]).toBe("Leaf");
  }, TIMEOUT_MS);

  it("HAPPY: depends records ONE pending revision holding only depends_on", async () => {
    const set = await corpus.lore(["baseline", "depends", corpus.leaf, "--add", "BR-1", ...DECIDED]);
    expect(set.exitCode).toBe(0);
    const node = corpus.node(corpus.leaf);
    expect(node.extra["depends_on"]).toBeUndefined();
    expect(nodeFields(node)).toEqual(["depends_on"]);
    expect(node.extra.pending?.node?.["depends_on"]).toEqual(["BR-1"]);
    expect(await treeLine(corpus.leaf)).toContain("draft (1 pending)");
    await discardNodeRevision();
  }, TIMEOUT_MS);

  it("HAPPY: a glossary entry records ONE pending revision of the branch holding only the glossary", async () => {
    const set = await corpus.lore(["baseline", "glossary", "add", corpus.branch, "--term", "widget", "--meaning", "a small gadget", ...DECIDED]);
    expect(set.exitCode).toBe(0);
    const node = corpus.node(corpus.branch);
    expect(node.extra["glossary"]).toBeUndefined();
    expect(Object.keys(node.extra.pending?.node ?? {}).filter((k) => k !== "revision_id")).toEqual(["glossary"]);
    expect(await treeLine(corpus.branch)).toContain("draft (1 pending)");
    await corpus.must(["reject", corpus.branch, "--item", "node"]);
    expect(corpus.node(corpus.branch).status).toBe("approved");
  }, TIMEOUT_MS);

  it("HAPPY/REGRESSION: map --command records ONE pending revision; coverage reads the approved commands until it is approved", async () => {
    const set = await corpus.lore(["baseline", "map", corpus.leaf, "--command", "ac add", ...DECIDED]);
    expect(set.exitCode).toBe(0);
    const node = corpus.node(corpus.leaf);
    expect(node.extra["commands"]).toBeUndefined();
    expect(nodeFields(node)).toEqual(["commands"]);
    expect(node.extra.pending?.node?.["commands"]).toEqual(["ac add"]);
    // the census's declared commands: none are approved yet
    expect(leavesUnder({ id: node.id, slug: node.slug, extra: node.extra }, [])).toEqual([]);

    await corpus.approveAll(corpus.leaf);
    const approved = corpus.node(corpus.leaf);
    expect(approved.extra["commands"]).toEqual(["ac add"]);
    expect(approved.extra.pending).toBeUndefined();
    expect(leavesUnder({ id: approved.id, slug: approved.slug, extra: approved.extra }, [])).toEqual([{ slug: corpus.leaf, commands: ["ac add"] }]);
  }, TIMEOUT_MS);

  it("HAPPY/NEGATIVE: a body edit records ONE pending revision; the stored body and title stay approved", async () => {
    const before = corpus.node(corpus.leaf);
    const set = await corpus.lore(["set", corpus.leaf, ...statementEdit("A rewritten body that nobody has approved."), ...DECIDED]);
    expect(set.exitCode).toBe(0);
    const node = corpus.node(corpus.leaf);
    expect(node.content).toBe(before.content);
    expect(node.title).toBe(before.title);
    expect(nodeFields(node)).toEqual(["content"]);
    expect(node.extra.pending?.node?.["content"]).toContain("A rewritten body");
    expect(node.status).toBe("draft");
    expect(await treeLine(corpus.leaf)).toContain("draft (1 pending)");
    await discardNodeRevision();
    expect(corpus.node(corpus.leaf).content).toBe(before.content);
  }, TIMEOUT_MS);

  it("BOUNDARY: several own-part writes share the node's one pending item", async () => {
    await corpus.must(["baseline", "set-label", corpus.leaf, "Second label", ...DECIDED]);
    await corpus.must(["set", corpus.leaf, "--title", "A second title", ...DECIDED]);
    const node = corpus.node(corpus.leaf);
    expect(nodeFields(node).sort()).toEqual(["label", "title"]);
    expect(await treeLine(corpus.leaf)).toContain("draft (1 pending)");
    await discardNodeRevision();
  }, TIMEOUT_MS);

  it("HAPPY/STATE: a rule move records ONE pending revision of the rule; it stays on its leaf until approved", async () => {
    const source0 = corpus.node(corpus.leaf);
    const dest0 = corpus.node(otherLeaf);
    const moved = await corpus.lore(["rule", "set", "BR-1", "--move-to", otherLeaf, ...DECIDED]);
    expect(moved.exitCode).toBe(0);
    const source = corpus.node(corpus.leaf);
    const dest = corpus.node(otherLeaf);
    expect(source.extra.rules?.map((r) => r["id"])).toEqual(["BR-1"]);
    expect(Object.keys(source.extra.pending?.rules ?? {})).toEqual(["BR-1"]);
    expect(source.extra.pending?.rules?.["BR-1"]?.move_to).toBe(dest0.id);
    expect(source.extra.pending?.node).toBeUndefined();
    expect(source.status).toBe("draft");
    expect(await treeLine(corpus.leaf)).toContain("draft (1 pending)");
    // the destination is untouched until the move is approved
    expect(dest.version).toBe(dest0.version);
    expect(dest.extra.rules).toBeUndefined();
    expect(source.version).toBe(source0.version + 1);

    await corpus.approveAll(corpus.leaf);
    const after = corpus.node(corpus.leaf);
    const destAfter = corpus.node(otherLeaf);
    expect(after.extra.rules).toBeUndefined();
    expect(after.extra.pending).toBeUndefined();
    expect(after.status).toBe("approved");
    expect(destAfter.extra.rules?.map((r) => r["id"])).toEqual(["BR-1"]);
    expect(corpus.registryState("BR-1")).toBe("live");
    expect(destAfter.status).toBe("approved");
  }, TIMEOUT_MS);

  it("BOUNDARY: a never-approved node has no approved version to protect: its own part is written directly and it stays draft until approved", async () => {
    const created = await corpus.must(["baseline", "add", corpus.branch, "--node", "leaf", "--label", "Fresh", "--title", "Fresh leaf"]);
    const slug = created.stdout.match(/Created baseline leaf (\S+) \(/)?.[1] ?? "";
    expect(slug).not.toBe("");
    const born = corpus.node(slug);
    expect(born.status).toBe("draft");
    expect(Object.keys(born.extra.pending ?? {})).toEqual(["node"]);
    expect(born.extra.pending?.node?.["initial"]).toBe(true);
    expect(await treeLine(slug)).toContain("draft (1 pending)");

    await corpus.must(["baseline", "set-label", slug, "Fresh again"]);
    await corpus.must(["set", slug, "--content", "A fresh body."]);
    const edited = corpus.node(slug);
    expect(edited.extra["label"]).toBe("Fresh again");
    expect(edited.content.trim()).toBe("A fresh body.");
    expect(Object.keys(edited.extra.pending?.node ?? {}).sort()).toEqual(["initial", "revision_id"]);
    // the first approval removes the marker: the node becomes approved
    await corpus.approveAll(slug);
    const approved = corpus.node(slug);
    expect(approved.status).toBe("approved");
    expect(approved.extra.pending).toBeUndefined();
    expect(approved.extra["label"]).toBe("Fresh again");
  }, TIMEOUT_MS);

  it("REGRESSION: an export mirror shows the approved text, never the pending revision as if it were approved", async () => {
    await corpus.must(["set", corpus.leaf, ...statementEdit("PENDING-BODY-NOBODY-APPROVED"), ...DECIDED]);
    await corpus.must(["rule", "add", corpus.leaf, "--statement", "PENDING-RULE-NOBODY-APPROVED", "--confidence", "established", "--enforced-by", "guaranteed", "--example", "e", ...DECIDED]);
    const exported = await corpus.lore(["export-docs", "--type", "baseline", "--force"]);
    expect(exported.exitCode).toBe(0);
    const mirrorDir = join(corpus.dir, "docs", "requirements", "baseline");
    const files = readdirSync(mirrorDir).filter((f) => f.endsWith(".md"));
    expect(files.length).toBeGreaterThan(0);
    const text = files.map((f) => readFileSync(join(mirrorDir, f), "utf8")).join("\n");
    expect(text).not.toContain("PENDING-BODY-NOBODY-APPROVED");
    expect(text).not.toContain("PENDING-RULE-NOBODY-APPROVED");
    expect(text).not.toContain("pending:");
    await corpus.must(["reject", corpus.leaf, "--item", "node"]);
    await corpus.must(["reject", corpus.leaf, "--item", "BR-2"]);
    expect(corpus.node(corpus.leaf).status).toBe("approved");
  }, TIMEOUT_MS);

  it("NEGATIVE: lore set --status approved|draft on a baseline node exits 4; a clean node prints approved", async () => {
    await corpus.must(["baseline", "set-label", corpus.leaf, "Pending again", ...DECIDED]);
    expect(corpus.node(corpus.leaf).status).toBe("draft");
    const approve = await corpus.lore(["set", corpus.leaf, "--status", "approved"]);
    expect(approve.exitCode).toBe(4);
    expect(approve.stderr).toContain("derived");
    expect(corpus.node(corpus.leaf).status).toBe("draft");

    await corpus.approveAll(corpus.leaf);
    expect(corpus.node(corpus.leaf).status).toBe("approved");
    const line = await treeLine(corpus.leaf);
    expect(line).toContain(`(${corpus.leaf}, approved)`);
    expect(line).not.toContain("pending");
    const draft = await corpus.lore(["set", corpus.leaf, "--status", "draft"]);
    expect(draft.exitCode).toBe(4);
    expect(corpus.node(corpus.leaf).status).toBe("approved");
  }, TIMEOUT_MS);
});
