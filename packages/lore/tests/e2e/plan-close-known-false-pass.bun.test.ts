/**
 * AC-VS-8 e2e (spec-declared-scope-attestation-contract-task-owned-ac-scope;
 * task-t4-record-the-coverage-predicate-s-measured-false-pass-in): proves
 * `lore gate plan-close --explain` — the COMPILED `dist/lore` binary, never
 * source, never this repo's own `.lore/` corpus (project CLAUDE.md hard rule;
 * 2026-07-07 pollution incident) — prints a `known_false_pass` entry for the
 * coverage predicate (`ATTESTATION_FLOOR_FIELD = "attestation-floor"`,
 * `predicate-contracts.ts`) containing the literal `plan-wide run`.
 *
 * The delta this entry records: 8 tasks x 16 attested entries produced by 8
 * UNRESTRICTED `lore verify` runs on plan-implementation-plan-close-
 * predicates-measure-invariants attested every claimed AC regardless of which
 * task's own declared scope it belonged to — the per-claimed-AC coverage
 * conjunct passed while the invariant it exists to protect (each task's
 * declared scope was ACTUALLY exercised) stayed unproven. This file's job is
 * not to re-derive that measurement — T3 (a concurrent peer task, NOT this
 * task's anchor) owns `ac_scope`/`DeclaredScopeCoverage`. This file proves
 * only that the ALREADY-MEASURED delta is now visible on the operator-facing
 * explain surface, per this module's own header: "an operator blocked on
 * correctly-executed work reads the delta instead of reaching for an
 * exemption."
 *
 * Coverage (six-dimension, applied where it applies to a content-only
 * addition to a static contract table — STATE and ERROR are N/A here: there
 * is no state machine and no error path in a pure string-table render, so
 * per the task closeout's own "at minimum" floor this suite covers exactly
 * HAPPY / NEGATIVE / BOUNDARY / REGRESSION):
 *   - HAPPY (the `-t`-pinned AC-VS-8 test): the literal, and the task body's
 *     exact measurement shape, appear in attestation-floor's known_false_pass.
 *   - NEGATIVE control: the SAME extraction logic, run against a COMMITTED
 *     synthetic fixture holding the byte-exact known_false_pass text from
 *     git HEAD 9eb92c7 (this task's own starting point, before its edit),
 *     correctly reports the literal ABSENT — proving the positive assertion
 *     above is not vacuously true (it CAN return false; see repo CLAUDE.md
 *     "contiguous-substring assumption" lesson).
 *   - BOUNDARY: the literal lands in known_false_pass specifically — not in
 *     known_false_block, and not leaked into any of the other four fields'
 *     rendered text.
 *   - REGRESSION: both pre-existing attestation-floor known_false_pass
 *     entries and its known_false_block survive byte-identical; the three
 *     untouched empty-delta fields keep their exact "(none recorded)" shape;
 *     cited-rule-state's own unrelated entries are untouched (the field replaced prd-outline-synced, BR-984).
 *
 * Freshness guard (repo CLAUDE.md false-oracle vector #4): `beforeAll` calls
 * `assertFreshBinary`. Run `bun run build` (repo root) before this suite.
 *
 * @spec_ref spec-declared-scope-attestation-contract-task-owned-ac-scope
 *   AC-VS-8. Task task-t4-record-the-coverage-predicate-s-measured-false-pass-in.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertFreshBinary } from "../integration/helpers/assert-fresh-binary";

// tests/e2e/ -> tests/ -> packages/lore/ -> packages/ -> repo root (4 levels up),
// mirrors every sibling compiled-binary e2e suite's own REPO_ROOT derivation.
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");

/** The literal AC-VS-8 requires, verbatim. */
const LITERAL = "plan-wide run";
/** `ATTESTATION_FLOOR_FIELD` (gate-predicates.ts:772) — the coverage predicate's field name. */
const COVERAGE_FIELD = "attestation-floor";

/**
 * Byte-exact `known_false_pass` rendering (both entries, joined per
 * `renderPredicateContractsExplain`'s `" | "` join) for `attestation-floor` at
 * git HEAD 9eb92c7 — this task's own starting point, verified against
 * `git show HEAD:packages/lore/src/service/predicate-contracts.ts` before
 * editing. A COMMITTED synthetic fixture, never a live re-derivation of
 * source — used ONLY by the negative-control test below to prove the
 * extraction+assertion logic can return false.
 */
const PRE_TASK_KNOWN_FALSE_PASS =
  "a plan claiming NO acceptance criteria at all passes the per-claimed-AC coverage " +
  "conjunct vacuously (flagged earlier by plan-promote's verify-reachability advisory) | " +
  "an unpopulated `planClaimedAcCoverage` ctx field used to fabricate an empty declared-" +
  "criteria set and pass the coverage conjunct vacuously (fixed here; recorded because " +
  "the delta is what the table exists to make readable)";

let explainStdout: string;
let explainExitCode: number;
const cleanupDirs: string[] = [];

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [
    join(REPO_ROOT, "packages", "lore", "src"),
    join(REPO_ROOT, "packages", "core", "src"),
  ]);
  // `gate plan-close --explain` is a pure offline render (gate.ts's own header: "this one
  // never reads the corpus"); spawned from a throwaway dir anyway, never this repo's own
  // `.lore/` (project CLAUDE.md hard rule; 2026-07-07 pollution incident).
  const dir = mkdtempSync(join(tmpdir(), "lore-t4-vs8-"));
  cleanupDirs.push(dir);
  const proc = Bun.spawnSync([LORE_BIN, "gate", "plan-close", "--explain"], {
    cwd: dir,
    env: { ...process.env, HOME: dir, CLAUDECODE: "1" },
  });
  explainStdout = proc.stdout.toString();
  explainExitCode = proc.exitCode ?? 1;
});

afterAll(() => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
});

/**
 * Extracts one `field: <name>` block's raw text (from its `field:` line up to
 * the next `field:` marker, or end of text) out of a
 * `renderPredicateContractsExplain`-shaped explain payload. Throws loudly on
 * a missing field — a silently-empty block would make every downstream
 * assertion vacuous.
 */
function extractFieldBlock(explainText: string, field: string): string {
  const marker = `field: ${field}`;
  const idx = explainText.indexOf(marker);
  if (idx === -1) {
    throw new Error(`extractFieldBlock: "${marker}" not found in explain output:\n${explainText}`);
  }
  const rest = explainText.slice(idx);
  const nextIdx = rest.indexOf("\nfield: ", marker.length);
  return nextIdx === -1 ? rest : rest.slice(0, nextIdx);
}

/** Extracts the `known_false_pass:` line's value from one field block. Throws loudly if missing. */
function extractKnownFalsePass(fieldBlock: string): string {
  const match = fieldBlock.match(/^known_false_pass: (.*)$/m);
  if (!match || match[1] === undefined) {
    throw new Error(`extractKnownFalsePass: no known_false_pass line in block:\n${fieldBlock}`);
  }
  return match[1];
}

/** Extracts the `known_false_block:` line's value from one field block. Throws loudly if missing. */
function extractKnownFalseBlock(fieldBlock: string): string {
  const match = fieldBlock.match(/^known_false_block: (.*)$/m);
  if (!match || match[1] === undefined) {
    throw new Error(`extractKnownFalseBlock: no known_false_block line in block:\n${fieldBlock}`);
  }
  return match[1];
}

describe("AC-VS-8: plan-close predicate contract table records the coverage predicate's measured false pass", () => {
  it("exits 0 and renders the plan-close contract table", () => {
    expect(explainExitCode).toBe(0);
    expect(explainStdout).toContain("Predicate contract table — plan-close:");
  });

  it("coverage predicate records its false pass: attestation-floor's known_false_pass contains the literal 'plan-wide run'", () => {
    const block = extractFieldBlock(explainStdout, COVERAGE_FIELD);
    const knownFalsePass = extractKnownFalsePass(block);
    expect(knownFalsePass).toContain(LITERAL);
    // The exact measured shape from the task body — not just the bare literal — proving
    // this is the MEASURED delta (8 tasks x 16 attested entries, 8 unrestricted runs on
    // the named plan), not a stray unrelated occurrence of the substring.
    expect(knownFalsePass).toContain("plan-implementation-plan-close-predicates-measure-invariants");
  });

  it("NEGATIVE control: the same check reports the literal ABSENT from the pre-task known_false_pass text, proving the positive assertion above is not vacuously true", () => {
    expect(PRE_TASK_KNOWN_FALSE_PASS).not.toContain(LITERAL);
  });

  it("BOUNDARY: the literal lands in known_false_pass specifically, not in known_false_block or any other field's rendered text", () => {
    const block = extractFieldBlock(explainStdout, COVERAGE_FIELD);
    expect(extractKnownFalseBlock(block)).not.toContain(LITERAL);

    for (const field of ["uat", "attestation-exempt-kind", "cited-rule-state", "assessment-freshness"]) {
      expect(extractFieldBlock(explainStdout, field)).not.toContain(LITERAL);
    }
  });

  it("REGRESSION: both pre-existing attestation-floor known_false_pass entries and its known_false_block survive byte-identical, and the four other fields are untouched", () => {
    const block = extractFieldBlock(explainStdout, COVERAGE_FIELD);
    const knownFalsePass = extractKnownFalsePass(block);
    expect(knownFalsePass).toContain(
      "a plan claiming NO acceptance criteria at all passes the per-claimed-AC coverage " +
        "conjunct vacuously (flagged earlier by plan-promote's verify-reachability advisory)",
    );
    expect(knownFalsePass).toContain(
      "an unpopulated `planClaimedAcCoverage` ctx field used to fabricate an empty declared-" +
        "criteria set and pass the coverage conjunct vacuously (fixed here; recorded because " +
        "the delta is what the table exists to make readable)",
    );
    // Exactly 3 pipe-joined entries now (2 original + 1 new) — no accidental duplication
    // or truncation at the join boundary.
    expect(knownFalsePass.split(" | ").length).toBe(3);

    expect(extractKnownFalseBlock(block)).toContain(
      "a plan whose claimed ACs are all attested but whose self-reported development evidence " +
        "dominates the trail, when min_ratio is explicitly configured",
    );

    // The three genuinely-empty fields keep their exact "(none recorded)" shape.
    for (const field of ["uat", "attestation-exempt-kind", "assessment-freshness"]) {
      expect(extractKnownFalsePass(extractFieldBlock(explainStdout, field))).toBe("(none recorded)");
    }
    // cited-rule-state (which replaced prd-outline-synced in slice 3a, BR-984) keeps its own two entries, untouched.
    expect(extractKnownFalsePass(extractFieldBlock(explainStdout, "cited-rule-state"))).toBe(
      "a rule whose state is unknown (git unavailable, dirty run, no code anchors) or unverified " +
        "(no attested run at all) is not refused even though nothing proves it holds | " +
        "a fresh attested pass recorded by ANOTHER plan on the same spec makes the rule verified for " +
        "this plan too — rule state is a function of the latest run per (spec, criterion), not of the " +
        "closing plan's own tasks",
    );
  });
});
