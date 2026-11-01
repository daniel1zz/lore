// @reads assets/project/lore-config-template.yaml
// @spawns packages/lore/tests/helpers/approve-nodes-cli.ts
/**
 * spec-every-document-is-stored-as-structured-fields-validated-by#AC-ST-3: CROSS-FIELD CHECKS AT PROMOTE.
 *
 * For each library check (refs-resolve, refusal-has-ac, rule-change-has-ac, decision-has-rejected,
 * out-of-scope-not-in-scope, goal-has-measure) a template that lists it lets a violating draft be CREATED and refuses its
 * approval (`lore approve` and `lore set --status approved`) with exit 4 naming the check id and the offending entry; the
 * corrected document promotes; `lore template check <doc>` reports the same findings without writing; a template that
 * does not list a check does not apply it.
 *
 * Judgment is switched off for the whole corpus (`judgment_required_types: []`), so every refusal below is the template's
 * cross-field check and nothing else (the checks do not depend on the judge, BR-1369).
 *
 * False greens guarded by an assertion:
 *   - a check that never fires: each violating case fails its own check id (exact finding set);
 *   - running the checks at create: the spec is created with its violations, THEN the criterion is added, THEN promote
 *     succeeds once corrected (create, ac add, promote).
 *
 * @spec_ref spec-every-document-is-stored-as-structured-fields-validated-by
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asyncLoreRunnerFor, ensureLiveRuleViaAsyncCli } from "../../helpers/cli-live-rule.js";
import { patchLoreConfig } from "../../helpers/patch-lore-config.js";
import { ensureRequirementsDocSlugAsync } from "../../helpers/parented-create.js";
import { createStructuredRig, installTemplate, removeSeededTemplates, writeFieldsFile, type StructuredRig } from "../../helpers/structured-corpus.js";

const AC = "AC-1";
let rig: StructuredRig;
let ruleId = "";
let counter = 0;

const ALL_CHECKS = ["refs-resolve", "refusal-has-ac", "rule-change-has-ac", "decision-has-rejected", "out-of-scope-not-in-scope", "goal-has-measure"];

function crossFieldTemplate(kind: string, checks: string[]): Record<string, unknown> {
  return {
    doc_type: "spec",
    kind,
    version: 1,
    fields: {
      type: "object",
      required: ["summary"],
      properties: {
        summary: { type: "string", minLength: 1 },
        refs: { type: "array", items: { type: "string" }, "x-ref-list": true },
        refusals: {
          type: "array",
          "x-refusal-list": true,
          items: { type: "object", properties: { id: { type: "string" }, message: { type: "string" }, acs: { type: "array", items: { type: "string" } } } },
        },
        rule_changes: { type: "array", "x-rule-change-list": true, items: { type: "object", properties: { id: { type: "string" } } } },
        decisions: {
          type: "array",
          "x-decision-list": true,
          items: { type: "object", properties: { decision: { type: "string" }, rejected: {}, why: { type: "string" } } },
        },
        scope: { type: "array", items: { type: "string" }, "x-scope-list": true },
        out_of_scope: { type: "array", items: { type: "string" }, "x-out-of-scope-list": true },
        goal: { type: "object", "x-goal": true, properties: { statement: { type: "string" }, measure: { type: "string" } } },
      },
    },
    dimensions: [{ id: "edge-cases", question: "Which edge cases does it handle?" }],
    checks,
    render: [
      { heading: "Summary", fields: ["summary"] },
      { heading: "References", fields: ["refs", "refusals", "rule_changes", "decisions"] },
      { heading: "Scope", fields: ["scope", "out_of_scope", "goal"] },
    ],
  };
}

/** A fields object satisfying every check once criterion AC-1 exists and cites the live rule. */
function cleanFields(): Record<string, unknown> {
  return {
    summary: "A spec with every cross-field field filled in",
    refs: [AC],
    refusals: [{ id: "R-1", message: "refused", acs: [AC] }],
    rule_changes: [{ id: ruleId }],
    decisions: [{ decision: "D1", rejected: ["the other option"], why: "it is simpler" }],
    scope: ["inside"],
    out_of_scope: ["outside"],
    goal: { statement: "faster", measure: "p95 under 200 ms" },
  };
}

async function must(args: string[]): Promise<string> {
  const r = await rig.lore(args);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${String(r.exitCode)}): ${r.stderr}${r.stdout}`);
  return r.stdout;
}

/** Creates a spec of `kind` from `fields` (no criterion yet) and returns its slug. */
async function createSpec(kind: string, fields: Record<string, unknown>): Promise<string> {
  counter += 1;
  const file = writeFieldsFile(rig, `fields-${String(counter)}.yaml`, {
    fields,
    dimensions: [{ id: "edge-cases", status: "na", answer: "no edge case: the fixture is a pure value", refs: [] }],
  });
  const out = JSON.parse(await must(["create", "spec", "--kind", kind, "--title", `Cross field ${String(counter)}`, "--fields-file", file, "--json"])) as { data: { slug: string } };
  return out.data.slug;
}

async function addCriterion(slug: string, cite: boolean): Promise<void> {
  await must(["ac", "add", slug, AC, "--statement", "the parser round-trips every fixture file", "--mode", "script", "--oracle", "test", "--command", "true"]);
  if (cite) await must(["ac", "cite", slug, AC, ruleId]);
}

async function statusOf(slug: string): Promise<string> {
  return (JSON.parse(await must(["get", slug, "--json"])) as { data: { doc: { status: string } } }).data.doc.status;
}

async function findingsOf(slug: string): Promise<{ check: string; entry: string }[]> {
  const r = await rig.lore(["template", "check", slug, "--json"]);
  return (JSON.parse(r.stdout) as { data: { findings: { check: string; entry: string }[] } }).data.findings;
}

beforeAll(async () => {
  // reason: the live-rule fixture creates its baseline tree from the SHIPPED templates, so it runs before they are removed
  rig = await createStructuredRig("lore-cross-field");
  patchLoreConfig(rig.dir, { workflow: { review: { judgment_required_types: [] } } });
  const runner = asyncLoreRunnerFor((args) => rig.lore(args), rig.dir);
  const prd = await ensureRequirementsDocSlugAsync(async (args) => await rig.lore(args));
  ruleId = await ensureLiveRuleViaAsyncCli(runner, rig.dir, prd);
  await removeSeededTemplates(rig);
  await installTemplate(rig, "Cross field tech template", crossFieldTemplate("tech", ALL_CHECKS));
  await installTemplate(rig, "Cross field design template", crossFieldTemplate("design", []));
}, 420_000);

afterAll(() => rig.cleanup());

const VIOLATIONS: { check: string; override: Record<string, unknown>; entry: string }[] = [
  { check: "refs-resolve", override: { refs: ["AC-GHOST"] }, entry: "refs: AC-GHOST" },
  { check: "refusal-has-ac", override: { refusals: [{ id: "R-9", message: "refused", acs: ["AC-GHOST"] }] }, entry: "refusals: R-9" },
  { check: "rule-change-has-ac", override: { rule_changes: [{ id: "BR-424242" }] }, entry: "rule_changes: BR-424242" },
  { check: "decision-has-rejected", override: { decisions: [{ decision: "D9", rejected: [], why: "because" }] }, entry: "decisions: D9" },
  { check: "out-of-scope-not-in-scope", override: { out_of_scope: ["inside"] }, entry: "out_of_scope: inside" },
  { check: "goal-has-measure", override: { goal: { statement: "faster", measure: "" } }, entry: "goal" },
];

describe("spec-every-document-is-stored-as-structured-fields-validated-by#AC-ST-3 each library check refuses its violation at promote", () => {
  for (const violation of VIOLATIONS) {
    it(`${violation.check}: the draft is created, template check reports exactly this finding, approve and set --status approved exit 4 naming the check and entry, the document stays draft`, async () => {
      const slug = await createSpec("tech", { ...cleanFields(), ...violation.override });
      await addCriterion(slug, true);

      const findings = await findingsOf(slug);
      expect(findings.map((f) => `${f.check} ${f.entry}`)).toEqual([`${violation.check} ${violation.entry}`]);
      const before = await must(["get", slug, "--json"]);

      const approve = await rig.lore(["approve", slug]);
      expect(approve.exitCode, approve.stderr).toBe(4);
      expect(approve.stderr).toContain(violation.check);
      expect(approve.stderr).toContain(violation.entry);

      const viaSet = await rig.lore(["set", slug, "--status", "approved"]);
      expect(viaSet.exitCode, viaSet.stderr).toBe(4);
      expect(viaSet.stderr).toContain(violation.check);

      expect(await statusOf(slug)).toBe("draft");
      expect(await must(["get", slug, "--json"])).toBe(before);
    }, 120_000);
  }

  it("every violation at once: one refusal names every check and every entry", async () => {
    const slug = await createSpec("tech", {
      ...cleanFields(),
      ...Object.assign({}, ...VIOLATIONS.map((v) => v.override)),
    });
    await addCriterion(slug, true);
    const approve = await rig.lore(["approve", slug]);
    expect(approve.exitCode, approve.stderr).toBe(4);
    for (const violation of VIOLATIONS) {
      expect(approve.stderr, violation.check).toContain(violation.check);
      expect(approve.stderr, violation.entry).toContain(violation.entry);
    }
  }, 120_000);
});

describe("spec-every-document-is-stored-as-structured-fields-validated-by#AC-ST-3 create, then ac add, then promote", () => {
  it("a spec whose refs name a criterion that does not exist yet is created, gets the criterion, is corrected and promotes", async () => {
    // created BEFORE AC-1 exists, with a violating field set: running the checks at create would refuse this
    const slug = await createSpec("tech", { ...cleanFields(), refs: [AC, "AC-GHOST"], goal: { statement: "faster", measure: "" } });
    expect(await statusOf(slug)).toBe("draft");

    await addCriterion(slug, true);
    const refused = await rig.lore(["approve", slug]);
    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain("refs-resolve");
    expect(refused.stderr).toContain("goal-has-measure");

    const fix = writeFieldsFile(rig, "fix.yaml", { fields: { refs: [AC], goal: { statement: "faster", measure: "p95 under 200 ms" } } });
    await must(["set", slug, "--fields-file", fix]);
    expect(await findingsOf(slug)).toEqual([]);
    expect((await rig.lore(["template", "check", slug])).exitCode).toBe(0);

    const approved = await rig.lore(["approve", slug]);
    expect(approved.exitCode, approved.stderr).toBe(0);
    expect(await statusOf(slug)).toBe("approved");
  }, 180_000);

  it("template check writes nothing: the version is unchanged after reporting findings", async () => {
    const slug = await createSpec("tech", { ...cleanFields(), refs: ["AC-GHOST"] });
    const before = JSON.parse(await must(["get", slug, "--json"])) as { data: { doc: { version: number } } };
    const report = await rig.lore(["template", "check", slug]);
    expect(report.exitCode).toBe(4);
    expect(report.stdout).toContain("refs-resolve");
    const after = JSON.parse(await must(["get", slug, "--json"])) as { data: { doc: { version: number } } };
    expect(after.data.doc.version).toBe(before.data.doc.version);
  }, 120_000);
});

describe("spec-every-document-is-stored-as-structured-fields-validated-by#AC-ST-3 a check the template does not list does not apply", () => {
  it("the design template lists no checks: the same violations produce no finding and no check refusal", async () => {
    const slug = await createSpec("design", {
      ...cleanFields(),
      ...Object.assign({}, ...VIOLATIONS.map((v) => v.override)),
    });
    await addCriterion(slug, true);
    expect(await findingsOf(slug)).toEqual([]);
    expect((await rig.lore(["template", "check", slug])).exitCode).toBe(0);
    const approve = await rig.lore(["approve", slug]);
    // reason: a design spec may still be refused by its own spec-promote gates (oracle coverage); what this asserts is
    // that no cross-field check id appears in whatever it says.
    for (const check of ALL_CHECKS) expect(approve.stderr).not.toContain(`[${check}]`);
  }, 120_000);
});
