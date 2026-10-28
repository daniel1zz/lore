// @reads assets/project/lore-config-template.yaml
// @reads packages/lore/src/adapters/cli/commands/weights.ts
/**
 * AC-DR-10 — weight tables and score validation (BR-1482): `lore weights set` writes a reference document's weight table
 * (every weight > 0, summing to 1 within 1e-9, else exit 4) and refuses a kind another live document already holds;
 * `lore set` refuses the `weight_table` key; a decision with scores and no table, a table of the wrong kind or not the
 * approved version, or a dimension the table lacks exits exactly 4; changing an approved table without a premise citing a
 * milestone review or a traced issue exits exactly 4.
 * (spec-a-decision-carrying-write-records-its-decision-on-its, "Weight tables", "Refusal", D8)
 *
 * Fixture: `createItemsCorpus` (throwaway corpus, approved leaf with rules; commands run in-process as an attested agent
 * run). Never the repository's own `.lore/`. Premises use `issue:` sources so no git is asked.
 *
 * Dimensions: HAPPY (table written, scored decision stored), NEGATIVE (bad weights, unknown dimension, no table, wrong kind,
 * draft table), BOUNDARY (sum off by 1e-6 refused, a weight of 0 refused), STATE (nothing written on refusal; an approved
 * table changed goes back to draft), REGRESSION (`lore set` key guard; one table per kind).
 *
 * MOCK RISK: none — real CLI, real corpus file.
 *
 * @spec_ref AC-DR-10
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { createApp, type App } from "../../../src/app.js";
import { liveAmbient, liveWriteContext, LIVE_TEST_RUN } from "../../live-invocation.js";
import { registerTestRun } from "../../helpers/test-run-identity.js";
import { createItemsCorpus, RULE_ARGS, type ItemsCorpus } from "../../helpers/baseline-items-corpus.js";

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const DECIDED = ["--reason", "the rule under-states the claim contract", "--premise", "readers hit the gap|issue:#41|A", "--alt", "leave it|the gap stays"];
const MEANING_PASS = ["--gate", "meaning-unchanged|pass|the new text only adds what the examples already show"];

interface StoredDecision {
  reason: string;
  weight_table?: { slug: string; version: number };
  scores?: Array<{ option: string; dimension: string; value: number }>;
}

describe("AC-DR-10: weight tables and score validation", () => {
  let corpus: ItemsCorpus;
  let dbPath: string;
  let app: App;

  const sql = <T>(body: (db: Database) => T): T => {
    const db = new Database(dbPath, { readonly: true });
    try {
      return body(db);
    } finally {
      db.close();
    }
  };
  const docRow = (slug: string): { id: string; status: string; version: number; extra: Record<string, unknown> } =>
    sql((db) => {
      const row = db.query("SELECT id, status, version, extra FROM docs WHERE slug = ?").get(slug) as { id: string; status: string; version: number; extra: string };
      return { ...row, extra: JSON.parse(row.extra) as Record<string, unknown> };
    });
  const versionsOf = (slug: string): number =>
    sql((db) => (db.query("SELECT COUNT(*) AS n FROM versions v JOIN docs d ON d.id = v.doc_id WHERE d.slug = ?").get(slug) as { n: number }).n);
  const latestDecision = (slug: string): StoredDecision | null =>
    sql((db) => {
      const row = db
        .query("SELECT v.decision AS decision FROM versions v JOIN docs d ON d.id = v.doc_id WHERE d.slug = ? ORDER BY v.version DESC LIMIT 1")
        .get(slug) as { decision: string | null } | null;
      return row?.decision == null ? null : (JSON.parse(row.decision) as StoredDecision);
    });

  const createReference = async (title: string): Promise<string> => {
    const run = await corpus.must(["create", "knowledge", "--sub-type", "reference", "--title", title, "--no-ai", "--content", `# ${title}\n\nA weight table.\n`]);
    const slug = run.stdout.match(/Slug:\s+(\S+)/)?.[1];
    if (slug === undefined) throw new Error(`no slug in: ${run.stdout}`);
    return slug;
  };
  const addRule = async (statement: string): Promise<string> => {
    const run = await corpus.must(["rule", "add", corpus.leaf, "--statement", statement, ...RULE_ARGS, ...DECIDED]);
    const id = run.stdout.match(/\b(BR-\d+)\b/)?.[1];
    if (id === undefined) throw new Error(`no rule id in: ${run.stdout}`);
    return id;
  };

  let ruleTable: string;
  let docTable: string;
  let ruleTableVersion: number;
  let docTableVersion: number;
  let rules: string[] = [];
  const SCORED = (table: string, version: number, dimension: string): string[] => [
    "--weight-table", `${table}@${version}`, "--score", `change it|${dimension}|1|measured in the review`,
  ];

  beforeAll(async () => {
    corpus = await createItemsCorpus("dr10");
    dbPath = join(corpus.dir, ".lore", "lore.db");
    for (let i = 0; i < 8; i += 1) rules.push(await addRule(`Rule number ${i} refuses an unowned claim at intake.`));
    await corpus.approveAll(corpus.leaf);

    ruleTable = await createReference("Rule revision weights");
    docTable = await createReference("Document revision weights");
    // reason: `lore`, not `must`: a refused fixture write must surface as the failing tests below, not as a failed hook.
    await corpus.lore(["weights", "set", ruleTable, "--kind", "rule revision", "--dimension", "evidence=0.6", "--dimension", "reach=0.4"]);
    await corpus.lore(["weights", "set", docTable, "--kind", "document revision", "--dimension", "evidence=0.5", "--dimension", "risk=0.5"]);
    await corpus.approveAll(ruleTable);
    await corpus.approveAll(docTable);
    ruleTableVersion = docRow(ruleTable).version;
    docTableVersion = docRow(docTable).version;
    registerTestRun(corpus.dir, LIVE_TEST_RUN);
    app = createApp(dbPath, undefined, liveAmbient(), liveWriteContext());
  });

  afterAll(() => {
    app.close();
    corpus.cleanup();
  });

  describe("lore weights set", () => {
    it("writes extra.weight_table on a reference document", () => {
      expect(docRow(ruleTable).extra["weight_table"]).toEqual({ kind: "rule revision", dimensions: { evidence: 0.6, reach: 0.4 } });
    });

    it("refuses weights that do not sum to 1 (exit 4), even by 1e-6; nothing written", async () => {
      const slug = await createReference("Off-sum weights");
      const before = versionsOf(slug);
      const run = await corpus.lore(["weights", "set", slug, "--kind", "rule revision", "--dimension", "a=0.5", "--dimension", "b=0.500001"]);
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(4);
      expect(versionsOf(slug)).toBe(before);
    });

    it("refuses a weight of 0 and a negative weight (exit 4)", async () => {
      const slug = await createReference("Zero weights");
      const zero = await corpus.lore(["weights", "set", slug, "--kind", "rule revision", "--dimension", "a=0", "--dimension", "b=1"]);
      expect(zero.exitCode, `${zero.stdout}${zero.stderr}`).toBe(4);
      const negative = await corpus.lore(["weights", "set", slug, "--kind", "rule revision", "--dimension", "a=-0.5", "--dimension", "b=1.5"]);
      expect(negative.exitCode, `${negative.stdout}${negative.stderr}`).toBe(4);
    });

    it("refuses an unknown kind and a document that is not a reference (exit 4)", async () => {
      const slug = await createReference("Odd kind");
      const kind = await corpus.lore(["weights", "set", slug, "--kind", "plan revision", "--dimension", "a=1"]);
      expect(kind.exitCode, `${kind.stdout}${kind.stderr}`).toBe(4);
      const notReference = await corpus.lore(["weights", "set", corpus.leaf, "--kind", "rule revision", "--dimension", "a=1"]);
      expect(notReference.exitCode, `${notReference.stdout}${notReference.stderr}`).toBe(4);
    });

    it("refuses a kind another live document already holds, naming it", async () => {
      const slug = await createReference("Second rule table");
      const run = await corpus.lore(["weights", "set", slug, "--kind", "rule revision", "--dimension", "a=1"]);
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(4);
      expect(run.stderr).toContain(ruleTable);
      expect(docRow(slug).extra["weight_table"]).toBeUndefined();
    });
  });

  describe("lore set refuses the weight_table key", () => {
    it("CorpusService.set with a changed weight_table is refused naming lore weights set; the table is unchanged", async () => {
      const row = docRow(ruleTable);
      const res = await app.corpusService.set(ruleTable, { extra: { ...row.extra, weight_table: { kind: "rule revision", dimensions: { sneaky: 1 } } } });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe("VALIDATION_ERROR");
        expect(JSON.stringify(res.error)).toContain("lore weights set");
      }
    });
  });

  describe("score validation in the decision gate (rule set carries kind rule revision)", () => {
    const attempt = (rule: string, extra: string[]) =>
      corpus.lore(["rule", "set", rule, "--statement", `Reworded ${rule} still refuses an unowned claim.`, ...DECIDED, ...MEANING_PASS, ...extra]);

    it("scores without --weight-table: exit 4 naming weight-table; nothing written", async () => {
      const before = versionsOf(corpus.leaf);
      const run = await attempt(rules[0]!, ["--score", "change it|evidence|1|measured"]);
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(4);
      expect(run.stderr).toContain("weight");
      expect(versionsOf(corpus.leaf)).toBe(before);
    });

    it("a table of the wrong kind (document revision for a rule command): exit 4", async () => {
      const run = await attempt(rules[2]!, SCORED(docTable, docTableVersion, "evidence"));
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(4);
      expect(run.stderr).toContain("rule revision");
    });

    it("a version of the table that is not the approved one: exit 4", async () => {
      const run = await attempt(rules[3]!, SCORED(ruleTable, ruleTableVersion + 5, "evidence"));
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(4);
    });

    it("a dimension the table lacks: exit 4 naming it", async () => {
      const run = await attempt(rules[4]!, SCORED(ruleTable, ruleTableVersion, "charisma"));
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(4);
      expect(run.stderr).toContain("charisma");
    });

    it("an unknown table slug: exit 4", async () => {
      const run = await attempt(rules[5]!, SCORED("no-such-table", 1, "evidence"));
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(4);
    });

    it("the approved table of the right kind and a dimension it holds: lands and the version row stores scores and table", async () => {
      const run = await attempt(rules[6]!, SCORED(ruleTable, ruleTableVersion, "evidence"));
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(0);
      const stored = latestDecision(corpus.leaf);
      expect(stored?.weight_table).toEqual({ slug: ruleTable, version: ruleTableVersion });
      expect(stored?.scores?.[0]).toMatchObject({ dimension: "evidence", value: 1 });
    });
  });

  describe("score validation for a document-revision command (baseline set-label)", () => {
    const relabel = (extra: string[]) => corpus.lore(["baseline", "set-label", corpus.leaf, "Leaf, relabelled", ...DECIDED, ...extra]);

    it("a rule revision table is refused (exit 4); a document revision table lands", async () => {
      const wrong = await relabel(SCORED(ruleTable, ruleTableVersion, "evidence"));
      expect(wrong.exitCode, `${wrong.stdout}${wrong.stderr}`).toBe(4);
      expect(wrong.stderr).toContain("document revision");
      const right = await relabel(SCORED(docTable, docTableVersion, "risk"));
      expect(right.exitCode, `${right.stdout}${right.stderr}`).toBe(0);
      expect(latestDecision(corpus.leaf)?.weight_table).toEqual({ slug: docTable, version: docTableVersion });
    });
  });

  describe("changing an approved table is decision-carrying", () => {
    const change = (extra: string[]) => corpus.lore(["weights", "set", docTable, "--kind", "document revision", "--dimension", "evidence=0.7", "--dimension", "risk=0.3", ...extra]);

    it("without a decision: exit 4; the table and its version are unchanged", async () => {
      const before = versionsOf(docTable);
      const run = await change([]);
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(4);
      expect(run.stderr).toContain("decision");
      expect(versionsOf(docTable)).toBe(before);
    });

    it("with a complete decision whose premise is neither a milestone review nor an issue: exit 4", async () => {
      const run = await change(["--reason", "rebalance", "--premise", "a command says so|cmd:echo ok ~ ok|A", "--alt", "keep|no reason"]);
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(4);
      expect(run.stderr).toContain("milestone");
    });

    it("with a premise citing a document that is not a milestone review: exit 4", async () => {
      const run = await change(["--reason", "rebalance", "--premise", "a leaf says so|doc:" + corpus.leaf + "|A", "--alt", "keep|no reason"]);
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(4);
    });

    it("with a premise citing a traced issue: lands, the decision is stored, and the table awaits re-approval (draft)", async () => {
      const run = await change(DECIDED);
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(0);
      expect(docRow(docTable).extra["weight_table"]).toEqual({ kind: "document revision", dimensions: { evidence: 0.7, risk: 0.3 } });
      expect(docRow(docTable).status).toBe("draft");
      expect(latestDecision(docTable)?.reason).toBe("the rule under-states the claim contract");
    });

    it("the changed table is no longer the approved version: a scored decision citing it is refused (exit 4)", async () => {
      const run = await corpus.lore(["baseline", "set-label", corpus.leaf, "Leaf, relabelled again", ...DECIDED, ...SCORED(docTable, docRow(docTable).version, "risk")]);
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(4);
    });
  });

  // Last on purpose: these retire the shared tables, which every test above relies on.
  describe("a retired table no longer holds its kind", () => {
    it("AC-DR-10: a deprecated holder frees its kind for another reference document", async () => {
      const next = await createReference("Replacement document revision weights");
      const held = await corpus.lore(["weights", "set", next, "--kind", "document revision", "--dimension", "a=1"]);
      expect(held.exitCode, `${held.stdout}${held.stderr}`).toBe(4);
      await corpus.must(["set", docTable, "--status", "deprecated"]);
      const run = await corpus.lore(["weights", "set", next, "--kind", "document revision", "--dimension", "a=1"]);
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(0);
      expect(docRow(next).extra["weight_table"]).toEqual({ kind: "document revision", dimensions: { a: 1 } });
    });

    it("AC-DR-10: an invalidated holder frees its kind for the document that supersedes it", async () => {
      const next = await createReference("Replacement rule revision weights");
      const held = await corpus.lore(["weights", "set", next, "--kind", "rule revision", "--dimension", "a=1"]);
      expect(held.exitCode, `${held.stdout}${held.stderr}`).toBe(4);
      await corpus.must(["invalidate", ruleTable, "--superseded-by", next, "--reason", "r"]);
      const run = await corpus.lore(["weights", "set", next, "--kind", "rule revision", "--dimension", "a=1"]);
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(0);
      expect(docRow(next).extra["weight_table"]).toEqual({ kind: "rule revision", dimensions: { a: 1 } });
    });
  });
});
