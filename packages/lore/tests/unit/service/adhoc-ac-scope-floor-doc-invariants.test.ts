// @reads assets/project/lore-config-template.yaml
// @reads packages/core/src/config.ts
// @reads packages/core/src/issue-report.ts
// @reads packages/lore/src/service/gate-predicates.ts
// @reads packages/lore/src/service/task-workflow-service.ts
/**
 * adhoc-ac-scope-floor-doc-invariants.test.ts —
 * task-the-ac-scope-re-keying-left-the-red-first-floor-unarmed (faces 1, 2, 3.2,
 * 3.3, 4).
 *
 * Four of this task's deliverables are DECISIONS whose only shipped artifact is
 * the written record at the site a future session will read. A decision recorded
 * nowhere is indistinguishable from an oversight — which is exactly how the
 * headline defect happened: `acScopeRequiredAtCreate`'s JSDoc truthfully said the
 * predicate "simply never fires" for an `--adhoc` task, and a reader concluded
 * the ad-hoc branch was unconstrained, because the JSDoc did not name the
 * CLI-layer sibling that DOES bind it.
 *
 * So this suite is a grep oracle over the source of record, and — per
 * adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the — every prose
 * assertion is PAIRED with the real property it describes wherever one exists:
 *   - the "the key ships via the Zod schema, not the config template" decision is
 *     asserted by RESOLVING the key through the schema and by READING the
 *     template, not by trusting the sentence that says so;
 *   - the retired `length === 0` short-circuit is asserted absent from the
 *     predicate's own body, with the surviving `undefined` guard asserted
 *     present, so a future "simplification" that merges them fails here as well
 *     as in the behavioural suite.
 *
 * ⛔ Every positive match is bounded to ONE extracted JSDoc/function region and
 * paired with an INVERSE control proving the extraction is not vacuously
 * matching the whole file (this repo's mirror-face lesson: a marker census over
 * a corpus that documents its own markers over-matches — anchor structurally and
 * require a second independent condition).
 *
 * ⛔ Structural assertions read source files from disk, so they are invisible to
 * import-graph selection on their own — this file additionally IMPORTS every
 * module it judges, so `bun run test:changed` re-selects it through the
 * reverse-dependency rule whenever any of them changes. Do not "clean up" those
 * imports as unused.
 *
 * Coverage: HAPPY (each decision is recorded where a reader will look) /
 * NEGATIVE (the inverse controls: the extractor can and does return false) /
 * BOUNDARY (the extracted region is strictly smaller than its file) / ERROR (a
 * missing anchor fails loud rather than silently matching nothing) / STATE (the
 * template's real content agrees with the decision recorded about it) /
 * REGRESSION (the schema still resolves the key for every consumer, and the
 * retired short-circuit stays retired).
 *
 * @spec_ref task-the-ac-scope-re-keying-left-the-red-first-floor-unarmed
 * @spec_ref adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the
 * @spec_ref knowledge-the-substring-matcher-lesson-has-a-mirror-face-over
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LoreConfigSchema, resolveCaptureTimeoutMs, buildIssueReportExtra } from "@lore/core";
// reason: these three imports create the import-graph edges described in the
//   module header (test:changed reverse-dep selection) as well as backing the
//   behavioural assertions below — do not remove as "unused".
import { acScopeRequiredAtCreate } from "../../../src/service/gate-predicates.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import { isAdhocAcScopeDeclarationMissing } from "../../../src/adapters/cli/create-task-validation.js";

// ─── Source-tree helpers ─────────────────────────────────────────────────────

/** Repo root, derived from this file's known location (packages/lore/tests/unit/service/). */
const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..");

const GATE_PREDICATES = "packages/lore/src/service/gate-predicates.ts";
const TASK_WORKFLOW_SERVICE = "packages/lore/src/service/task-workflow-service.ts";
const ISSUE_REPORT = "packages/core/src/issue-report.ts";
const CORE_CONFIG = "packages/core/src/config.ts";
const CONFIG_TEMPLATE = "assets/project/lore-config-template.yaml";

function readSource(repoRelativePath: string): string {
  return readFileSync(join(REPO_ROOT, repoRelativePath), "utf8");
}

/**
 * The `/** … *\/` JSDoc block immediately preceding the first line matching
 * `anchor`. Fails LOUD when the anchor is missing or carries no JSDoc — a
 * silently-empty region would make every `toContain` below vacuously false and
 * every `not.toContain` vacuously true, which is the exact failure mode this
 * suite exists to prevent.
 */
function jsdocBlockAbove(source: string, anchor: RegExp): string {
  const lines = source.split("\n");
  const anchorIndex = lines.findIndex((line) => anchor.test(line));
  if (anchorIndex === -1) {
    throw new Error(`anchor ${String(anchor)} not found — the source moved, fix this oracle`);
  }
  let end = anchorIndex - 1;
  while (end >= 0 && lines[end]?.trim() === "") end--;
  if (lines[end]?.trim() !== "*/") {
    throw new Error(`no JSDoc block directly above ${String(anchor)}`);
  }
  let start = end;
  while (start >= 0 && !(lines[start] ?? "").trimStart().startsWith("/**")) start--;
  if (start < 0) throw new Error(`unterminated JSDoc above ${String(anchor)}`);
  return lines.slice(start, end + 1).join("\n");
}

// ─── Face 4 — the gate predicate's JSDoc names the CLI-layer sibling ─────────

describe("face 4: acScopeRequiredAtCreate's JSDoc names the mechanism that DOES bind the ad-hoc branch", () => {
  it("HAPPY: the vacuity paragraph names the sibling predicate AND the file it lives in", () => {
    const block = jsdocBlockAbove(readSource(GATE_PREDICATES), /^export function acScopeRequiredAtCreate\(/);
    // Two INDEPENDENT lone tokens — a symbol name and a path — rather than one
    // remembered sentence that any rewording would silently un-match.
    expect(block).toContain("isAdhocAcScopeDeclarationMissing");
    expect(block).toContain("create-task-validation.ts");
  });

  it("NEGATIVE (inverse control): the extracted block is this predicate's own JSDoc, not the whole file", () => {
    const source = readSource(GATE_PREDICATES);
    const block = jsdocBlockAbove(source, /^export function acScopeRequiredAtCreate\(/);
    // A token that certainly exists in the FILE but must not be inside THIS
    // block — proving the extractor bounds its region. Without this control a
    // whole-file grep would pass the assertions above for free.
    expect(source).toContain("AC_SCOPE_REQUIRED_FIELD =");
    expect(block).not.toContain("AC_SCOPE_REQUIRED_FIELD =");
  });

  it("BOUNDARY: the block is strictly smaller than its file and non-trivially sized", () => {
    const source = readSource(GATE_PREDICATES);
    const block = jsdocBlockAbove(source, /^export function acScopeRequiredAtCreate\(/);
    expect(block.length).toBeGreaterThan(200);
    expect(block.length).toBeLessThan(source.length);
  });

  it("ERROR: a missing anchor throws instead of returning an empty region", () => {
    expect(() => jsdocBlockAbove(readSource(GATE_PREDICATES), /^export function noSuchPredicate\(/)).toThrow(
      /not found/,
    );
  });

  it("REGRESSION: the predicate itself is unchanged — an ad-hoc creation still vacuous-passes the gate", () => {
    // The JSDoc edit must not have been accompanied by a behaviour change: the
    // gate still never fires without a spec-tier ancestor, and the CLI sibling
    // is what refuses the ad-hoc branch one layer earlier.
    expect(acScopeRequiredAtCreate(false, undefined, undefined)).toStrictEqual({ ok: true });
    expect(acScopeRequiredAtCreate(true, 2, false).ok).toBe(false);
    expect(isAdhocAcScopeDeclarationMissing({ adhoc: true } as never, false)).toBe(true);
    expect(isAdhocAcScopeDeclarationMissing({ adhoc: true } as never, true)).toBe(false);
  });
});

// ─── Face 1 — RETIRED with the no-new-tests floor ────────────────────────────
//
// Face 1 recorded the keying decision of `requiresNoNewTestsDeclaration` (the no-new-tests floor armed by the PRESENCE of a
// declared ac_scope) and pinned its short-circuit. The floor, the predicate and `lore done --declare-no-new-tests` are removed
// (spec-done-contract-compiled-at-approve-task-kinds-write-sets, AC-DCS1-6): "this task adds no new test" is now declared once, at
// approve, as the contract's red waiver (`lore approve --red-waiver "<reason>"`, AC-DCS1-5), and `lore done` judges only the
// stored contract (AC-DCS1-7). The removal of the surface is observed through the compiled command in
// tests/e2e/done-contract-done-floors-compiled.bun.test.ts (AC-DCS1-6). Only this one assertion of the face stays here:
// the service that owned the floor is still the one exporting done().
describe("face 1 (retired): the service that owned the no-new-tests floor still exports done() and the retired predicate is gone", () => {
  it("STATE: done() is exported and requiresNoNewTestsDeclaration no longer exists in the service source", () => {
    expect(typeof TaskWorkflowService.prototype.done).toBe("function");
    expect(readSource(TASK_WORKFLOW_SERVICE)).not.toContain("requiresNoNewTestsDeclaration");
  });
});

// ─── Face 2 — the report-issue write site carries its rationale ──────────────

describe("face 2: buildIssueReportExtra's JSDoc records WHY the scope is empty rather than absent or derived", () => {
  it("HAPPY: the block names the field and the CLI flag whose requiredness this write site bypasses", () => {
    const block = jsdocBlockAbove(readSource(ISSUE_REPORT), /^export function buildIssueReportExtra\(/);
    expect(block).toContain("ac_scope");
    expect(block).toContain("--adhoc");
  });

  it("NEGATIVE (inverse control): the block is buildIssueReportExtra's own, not matchRootPrd's", () => {
    // reason: the ORIGINAL witness here was a rate-cap candidate-selection
    // predicate, deleted by spec-the-defect-channel-reaches-no-machine-but-
    // its-own-github P1 (cap removal — that spec's own Scope section
    // enumerates the six retired symbol names; not repeated here, since
    // AC-GI-9's oracle is a case-sensitive scan for exactly those six strings
    // across `packages/**`, this file included). `matchRootPrd` is a
    // still-existing sibling export in the same file, preserving the exact
    // same isolation check — the extractor must grab buildIssueReportExtra's
    // OWN jsdoc block, never a neighbour's.
    const source = readSource(ISSUE_REPORT);
    const block = jsdocBlockAbove(source, /^export function buildIssueReportExtra\(/);
    expect(source).toContain("export function matchRootPrd(");
    expect(block).not.toContain("matchRootPrd");
  });

  it("STATE: the documented behaviour is the ACTUAL behaviour — the built extra really carries an empty array", () => {
    const extra = buildIssueReportExtra({
      reporter_project: "p",
      reporter_actor: "a",
      lore_version: "0.5.0",
      expected: "e",
      actual: "a",
      reported_at: "2026-08-06T00:00:00.000Z",
      possible_duplicates: [],
    });
    expect(extra["ac_scope"]).toStrictEqual([]);
  });
});

// ─── Faces 3.2 / 3.3 — the two capture-window residuals, scoped IN WRITING ──

describe("faces 3.2/3.3: resolveCaptureTimeoutMs records both deliberately-unfixed residuals", () => {
  it("HAPPY (3.2): the malformed-config degradation is named as a config-loader-WIDE decision, with its pinning test", () => {
    const block = jsdocBlockAbove(readSource(CORE_CONFIG), /^export function resolveCaptureTimeoutMs\(/);
    // Two independent lone tokens: the loader that degrades, and the test id
    // that pins the degradation so a future fix flips a failing test.
    expect(block).toContain("loadProjectConfig");
    expect(block).toContain("CAPCLI-E1");
  });

  it("HAPPY (3.3): the config-template decision is recorded together with the manifest obligation a future slice inherits", () => {
    const block = jsdocBlockAbove(readSource(CORE_CONFIG), /^export function resolveCaptureTimeoutMs\(/);
    expect(block).toContain("lore-config-template.yaml");
    expect(block).toContain("manifest");
  });

  it("NEGATIVE (inverse control): the block is this resolver's own, not a sibling resolver's", () => {
    const source = readSource(CORE_CONFIG);
    const block = jsdocBlockAbove(source, /^export function resolveCaptureTimeoutMs\(/);
    expect(source).toContain("export function resolveTraceRetentionDays(");
    expect(block).not.toContain("resolveTraceRetentionDays");
  });

  it("STATE (3.3): the template's REAL content agrees with the decision recorded about it — key absent, file genuinely read", () => {
    const template = readSource(CONFIG_TEMPLATE);
    // The property itself, not the sentence describing it.
    expect(template).not.toContain("capture_timeout_ms");
    // Inverse control: the file really was read and really is the template —
    // otherwise the absence above would be satisfied by an empty string. Two
    // independent conditions: it carries a `workflow:` section (the same section
    // the capture knob lives under, so "the key could have been seeded here" is
    // established, not assumed) and the block it actually ships.
    expect(template.length).toBeGreaterThan(100);
    expect(template).toContain("workflow:");
    expect(template).toContain("verification_profiles:");
  });

  it("REGRESSION (3.3): the key still ships to every consumer through the Zod schema, template or no template", () => {
    // Raised 600_000 -> 1_200_000, 2026-08-11 (task-raise-capture-timeout-ms-and-max-diff-
    // chars-to-the-values) — see config.ts evidence.capture_timeout_ms JSDoc.
    expect(resolveCaptureTimeoutMs(undefined)).toBe(1_200_000);
    const configured = LoreConfigSchema.parse({
      project: { name: "n", author: "a" },
      workflow: { evidence: { capture_timeout_ms: 1_234 } },
    });
    expect(resolveCaptureTimeoutMs(configured)).toBe(1_234);
  });

  it("BOUNDARY (3.2): a config parsed WITHOUT the evidence section resolves to the default rather than throwing", () => {
    const partial = LoreConfigSchema.parse({
      project: { name: "n", author: "a" },
      workflow: { claim_ttl_minutes: 30 },
    });
    expect(resolveCaptureTimeoutMs(partial)).toBe(1_200_000);
  });
});
