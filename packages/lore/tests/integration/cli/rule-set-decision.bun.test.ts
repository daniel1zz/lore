// @reads assets/project/lore-config-template.yaml
// @reads packages/lore/src/adapters/cli/commands/rule.ts
/**
 * AC-DR-4 — `lore rule set` and `lore rule add` by an agent on an approved leaf carry a decision (BR-1476, BR-1477,
 * BR-1478, BR-1479): examples-only and a confidence lowering need none; a confidence raise exits exactly 4 (it goes through
 * `lore rule propose`); a statement change needs the written gate `meaning-unchanged|pass|<evidence>` (missing or `fail`
 * exits exactly 4 and records no revision) and, with it passing plus reason, premise and alternative, the revision's
 * version row records the decision with the replaced statement (`before`) and the computed gate `evidence-s-to-c` (fail
 * when a D or E premise is present, still recorded); `lore rule add` without a decision exits exactly 4; direct
 * `RuleService.setRule` / `addRule` calls refuse the same way.
 * (spec-a-decision-carrying-write-records-its-decision-on-its, "Which writes carry a decision", "Refusal", D3, D7)
 *
 * Fixture: `createItemsCorpus` (a throwaway corpus holding an APPROVED leaf with BR-1; commands run in-process as an
 * attested agent run). Never the repository's own `.lore/`. No test here calls an MCP tool handler.
 *
 * Dimensions: HAPPY (decision recorded with `before` and both gates), NEGATIVE (raise, missing and failing gate, no
 * decision), BOUNDARY (examples-only, lowering, weak premise), STATE (no revision written on refusal), REGRESSION (a human
 * party owes none; a pending add leaf is gated like any approved leaf).
 *
 * MOCK RISK: none — real CLI, real corpus file; premises use `issue:` sources so no git is asked.
 *
 * @spec_ref AC-DR-4
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { createApp, type App } from "../../../src/app.js";
import { liveAmbient, liveWriteContext, LIVE_TEST_RUN } from "../../live-invocation.js";
import { registerTestRun, scrubIdentityEnv } from "../../helpers/test-run-identity.js";
import { runLoreInProcess } from "../../helpers/run-lore-in-process.js";
import { createItemsCorpus, RULE_ARGS, type ItemsCorpus } from "../../helpers/baseline-items-corpus.js";

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const OLD_STATEMENT = "A claim is refused when it names no owner.";
const NEW_STATEMENT = "A claim is refused when it names no owner or no expiry.";

/** A complete decision as CLI flags (premise tier A). */
const DECIDED = ["--reason", "the rule under-states the claim contract", "--premise", "readers hit the gap|issue:#41|A", "--alt", "leave it|the gap stays"];
/** The judged gate a statement change must state. */
const MEANING_PASS = ["--gate", "meaning-unchanged|pass|the new text only adds the expiry the examples already show"];
const MEANING_FAIL = ["--gate", "meaning-unchanged|fail|the new text widens the rule"];

interface StoredDecision {
  reason: string;
  before?: string;
  premises: unknown[];
  gates?: Array<{ id: string; verdict: string; computed: boolean }>;
}

describe("AC-DR-4: rule set / rule add carry a decision", () => {
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
  const versionsOf = (slug: string): number =>
    sql((db) => (db.query("SELECT COUNT(*) AS n FROM versions v JOIN docs d ON d.id = v.doc_id WHERE d.slug = ?").get(slug) as { n: number }).n);
  const latestDecision = (slug: string): StoredDecision | null =>
    sql((db) => {
      const row = db
        .query("SELECT v.decision AS decision FROM versions v JOIN docs d ON d.id = v.doc_id WHERE d.slug = ? ORDER BY v.version DESC LIMIT 1")
        .get(slug) as { decision: string | null } | null;
      return row?.decision == null ? null : (JSON.parse(row.decision) as StoredDecision);
    });
  const pendingRevision = (ruleId: string): unknown => corpus.node(corpus.leaf).extra.pending?.rules?.[ruleId];

  const addRule = async (statement: string, confidence: string): Promise<string> => {
    const run = await corpus.must(["rule", "add", corpus.leaf, "--statement", statement, "--confidence", confidence, "--enforced-by", "guaranteed", "--example", "an example", ...DECIDED]);
    const id = run.stdout.match(/\b(BR-\d+)\b/)?.[1];
    if (id === undefined) throw new Error(`no rule id in: ${run.stdout}`);
    return id;
  };

  let unconfirmedRule: string;
  let examplesRule: string;
  let lowerRule: string;
  let statementRule: string;
  let weakRule: string;
  let enforcedRule: string;

  beforeAll(async () => {
    corpus = await createItemsCorpus("dr4");
    dbPath = join(corpus.dir, ".lore", "lore.db");
    unconfirmedRule = await addRule(OLD_STATEMENT, "unconfirmed");
    examplesRule = await addRule("An unowned claim is refused at intake.", "established");
    lowerRule = await addRule("A claim without an owner never reaches review.", "established");
    statementRule = await addRule("An ownerless claim cannot be filed.", "established");
    weakRule = await addRule("A claim must name its owner before filing.", "established");
    enforcedRule = await addRule("A claim names its owner in the first field.", "established");
    await corpus.approveAll(corpus.leaf);
    registerTestRun(corpus.dir, LIVE_TEST_RUN);
    app = createApp(dbPath, undefined, liveAmbient(), liveWriteContext());
  });

  afterAll(() => {
    app.close();
    corpus.cleanup();
  });

  describe("trivial patches need no decision", () => {
    it("examples-only: exit 0, no decision stored", async () => {
      const run = await corpus.lore(["rule", "set", examplesRule, "--example", "a claim with no owner is refused at intake"]);
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(0);
      expect(latestDecision(corpus.leaf)).toBeNull();
    });

    it("a confidence lowering alone (established -> observed): exit 0, no decision stored", async () => {
      const run = await corpus.lore(["rule", "set", lowerRule, "--confidence", "observed"]);
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(0);
      expect(latestDecision(corpus.leaf)).toBeNull();
    });
  });

  describe("a confidence raise", () => {
    it("exits exactly 4 pointing to `lore rule propose`, even with a complete decision; no revision recorded", async () => {
      const before = versionsOf(corpus.leaf);
      const run = await corpus.lore(["rule", "set", unconfirmedRule, "--confidence", "established", ...DECIDED]);
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(4);
      expect(run.stderr).toContain("rule propose");
      expect(versionsOf(corpus.leaf)).toBe(before);
      expect(pendingRevision(unconfirmedRule)).toBeUndefined();
    });
  });

  describe("a statement change", () => {
    it("with no decision at all: exit 4 naming the missing parts; no revision recorded", async () => {
      const before = versionsOf(corpus.leaf);
      const run = await corpus.lore(["rule", "set", statementRule, "--statement", NEW_STATEMENT]);
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(4);
      expect(run.stderr).toContain("decision");
      expect(versionsOf(corpus.leaf)).toBe(before);
      expect(pendingRevision(statementRule)).toBeUndefined();
    });

    it("with reason, premise and alternative but without meaning-unchanged: exit 4 naming the gate; no revision recorded", async () => {
      const before = versionsOf(corpus.leaf);
      const run = await corpus.lore(["rule", "set", statementRule, "--statement", NEW_STATEMENT, ...DECIDED]);
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(4);
      expect(run.stderr).toContain("meaning-unchanged");
      expect(versionsOf(corpus.leaf)).toBe(before);
      expect(pendingRevision(statementRule)).toBeUndefined();
    });

    it("with meaning-unchanged failing: exit 4; no revision recorded", async () => {
      const before = versionsOf(corpus.leaf);
      const run = await corpus.lore(["rule", "set", statementRule, "--statement", NEW_STATEMENT, ...DECIDED, ...MEANING_FAIL]);
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(4);
      expect(run.stderr).toContain("meaning-unchanged");
      expect(versionsOf(corpus.leaf)).toBe(before);
      expect(pendingRevision(statementRule)).toBeUndefined();
    });

    it("with meaning-unchanged passing plus a complete decision: lands; the version row records before and both gates", async () => {
      const run = await corpus.lore(["rule", "set", statementRule, "--statement", NEW_STATEMENT, ...DECIDED, ...MEANING_PASS]);
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(0);
      expect(pendingRevision(statementRule)).toBeDefined();
      const stored = latestDecision(corpus.leaf);
      expect(stored?.reason).toBe("the rule under-states the claim contract");
      expect(stored?.before).toBe("An ownerless claim cannot be filed.");
      const gates = stored?.gates ?? [];
      expect(gates.find((g) => g.id === "meaning-unchanged")).toMatchObject({ verdict: "pass", computed: false });
      expect(gates.find((g) => g.id === "evidence-s-to-c")).toMatchObject({ verdict: "pass", computed: true });
    });

    it("with a D premise beside the S..C one: lands, and the computed gate evidence-s-to-c is recorded as fail", async () => {
      const run = await corpus.lore([
        "rule", "set", weakRule, "--statement", "A claim must name its owner and expiry before filing.",
        ...DECIDED, "--premise", "a colleague said so|issue:#42|D", ...MEANING_PASS,
      ]);
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(0);
      const stored = latestDecision(corpus.leaf);
      expect(stored?.before).toBe("A claim must name its owner before filing.");
      expect(stored?.premises).toHaveLength(2);
      expect((stored?.gates ?? []).find((g) => g.id === "evidence-s-to-c")).toMatchObject({ verdict: "fail", computed: true });
    });
  });

  describe("another non-trivial patch (enforced-by) needs a complete decision but no meaning gate", () => {
    it("without a decision: exit 4; with one: lands, no `before` stored", async () => {
      const refused = await corpus.lore(["rule", "set", enforcedRule, "--enforced-by", "both"]);
      expect(refused.exitCode, `${refused.stdout}${refused.stderr}`).toBe(4);
      expect(refused.stderr).toContain("decision");
      const landed = await corpus.lore(["rule", "set", enforcedRule, "--enforced-by", "both", ...DECIDED]);
      expect(landed.exitCode, `${landed.stdout}${landed.stderr}`).toBe(0);
      expect(latestDecision(corpus.leaf)?.before).toBeUndefined();
    });
  });

  describe("lore rule add on an approved leaf", () => {
    it("without a decision: exit 4 naming each missing part; no version written", async () => {
      const before = versionsOf(corpus.leaf);
      const run = await corpus.lore(["rule", "add", corpus.leaf, "--statement", "A fresh rule nobody decided.", ...RULE_ARGS]);
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(4);
      expect(run.stderr).toContain("reason (");
      expect(run.stderr).toContain("premise of tier S..C");
      expect(run.stderr).toContain("alternative (");
      expect(versionsOf(corpus.leaf)).toBe(before);
    });

    it("with a complete decision: lands and the version row records it", async () => {
      const run = await corpus.lore(["rule", "add", corpus.leaf, "--statement", "A fresh rule somebody decided.", ...RULE_ARGS, ...DECIDED]);
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(0);
      expect(latestDecision(corpus.leaf)?.reason).toBe("the rule under-states the claim contract");
    });
  });

  describe("a human party owes no decision (D9)", () => {
    it("rule set --statement and rule add as a human session succeed with no decision", async () => {
      const env = { ...scrubIdentityEnv(process.env), HOME: corpus.dir, EDITOR: "true" };
      const run = (args: string[]) => runLoreInProcess(args, { cwd: corpus.dir, home: corpus.dir, env, identity: "none" });
      expect((await run(["session", "start", "--human", "dana"])).exitCode).toBe(0);
      const set = await run(["rule", "set", "BR-1", "--statement", "The approved statement, edited by a person."]);
      expect(set.exitCode, `${set.stdout}${set.stderr}`).toBe(0);
      expect(latestDecision(corpus.leaf)?.before).toBeUndefined();
      const add = await run(["rule", "add", corpus.leaf, "--statement", "A rule a person adds.", ...RULE_ARGS]);
      expect(add.exitCode, `${add.stdout}${add.stderr}`).toBe(0);
    });
  });

  describe("direct service calls refuse the same way", () => {
    it("RuleService.setRule: a statement change with no decision is refused (field decision) and writes nothing", async () => {
      const before = versionsOf(corpus.leaf);
      const res = await app.ruleService!.setRule("BR-1", { statement: "A direct edit nobody decided." });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatchObject({ code: "VALIDATION_ERROR", field: "decision" });
      expect(versionsOf(corpus.leaf)).toBe(before);
    });

    it("RuleService.setRule: a statement change with a decision but a failing meaning gate is refused", async () => {
      const res = await app.ruleService!.setRule("BR-1", { statement: "A direct edit." }, {
        decision: {
          reason: "r",
          premises: [{ claim: "c", tier: "A", source: { kind: "issue", number: 7 } }],
          alternatives: [{ option: "o", why_rejected: "w" }],
          gates: [{ id: "meaning-unchanged", verdict: "fail", evidence: "it widens", computed: false }],
        },
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatchObject({ code: "VALIDATION_ERROR", field: "decision" });
    });

    it("RuleService.addRule with no decision is refused (field decision)", async () => {
      const before = versionsOf(corpus.leaf);
      const res = await app.ruleService!.addRule(corpus.leaf, { statement: "A direct add nobody decided.", confidence: "established", enforced_by: "guaranteed", examples: ["e"] });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatchObject({ code: "VALIDATION_ERROR", field: "decision" });
      expect(versionsOf(corpus.leaf)).toBe(before);
    });

    it("RuleService.addRule with a complete decision lands and records it", async () => {
      const res = await app.ruleService!.addRule(
        corpus.leaf,
        { statement: "A direct add somebody decided.", confidence: "established", enforced_by: "guaranteed", examples: ["e"] },
        { decision: { reason: "direct", premises: [{ claim: "c", tier: "A", source: { kind: "issue", number: 7 } }], alternatives: [{ option: "o", why_rejected: "w" }] } },
      );
      expect(res.ok, JSON.stringify(res.ok ? "" : res.error)).toBe(true);
      expect(latestDecision(corpus.leaf)?.reason).toBe("direct");
    });
  });
});
