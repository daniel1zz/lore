/**
 * Compiled-binary e2e for the `lore evidence` oracle-file precheck's
 * MULTI-SEGMENT cd derivation — closes
 * task-evidence-precheck-only-sees-a-cd-in-the-first-segment-of-a, driven
 * end-to-end through the COMPILED `dist/lore` binary against a THROWAWAY
 * `mkdtemp` corpus (never this repo's own `.lore/`; project CLAUDE.md hard
 * rule, 2026-07-07 pollution incident).
 *
 * Why a compiled suite exists at all: the derivation itself is pure and
 * exhaustively unit-tested from vitest
 * (`tests/unit/adapters/evidence-precheck.test.ts`), but the CLI command that
 * must CALL it (`src/adapters/cli/commands/evidence.ts`) imports the bun-only
 * `loader.ts` (`bun:sqlite`) and is unreachable from vitest — the SAME reason
 * `evidence-dropped-file-guard-compiled.bun.test.ts` and
 * `evidence-completeness-guard-compiled.bun.test.ts` exist for the sibling
 * guards. A parser fixed but not wired would leave every unit test green;
 * this file is the only oracle that the ACCEPTANCE, and the refusal message's
 * derived-cd-target clause, exist in the artifact a consumer actually runs.
 *
 * The defect this pins: the pre-fix recognizer was anchored at `^`, so this
 * repo's OWN mandated compiled-e2e command form
 * (`bun run build && cd packages/lore && bun test <e2e file>`) derived no cd
 * target, resolved the path against the repo root, and was REFUSED while
 * naming a file that exists. The measured harm was second-order: the cheapest
 * escape from that refusal is `--oracle manual`, which skips file checking
 * entirely.
 *
 * Anti-"always accept" discipline: every acceptance scenario below is paired
 * with a refusal scenario of the IDENTICAL command shape differing only in
 * whether the named file exists, and each refusal additionally asserts the
 * derived-cd-target clause BY VALUE. A fix that degraded into unconditional
 * acceptance fails scenarios 4, 5 and 6.
 *
 * Freshness guard (repo CLAUDE.md false-oracle vector #4 — a stale
 * `dist/lore` silently validates stale compiled logic against current
 * source): `beforeAll` calls `assertFreshBinary`. Run `bun run build` (repo
 * root) first.
 *
 * ⛔ SUPERSEDED (task-raise-the-evidence-tail-guard-s-predicate-to-its-own,
 * spec-falsifiability-reachability-a-feedable-checkpoint-an §D5): a
 * self-reported oracle-"test" `--result pass` is now refused by the SEPARATE,
 * later-running `rejectMissingPassOutputTail` guard regardless of tail
 * content or whether THIS precheck accepted it — `--oracle manual` remains
 * unusable here (it would skip the cd-derivation precheck this file exists
 * to test, exactly the "cheapest escape" measured harm called out above), so
 * every "accepts"/"REGRESSION" scenario below now asserts the precheck's OWN
 * acceptance (absence of MISSING_FILE_WORDING) while the OVERALL call is
 * refused by D5's tail guard (naming --capture) — row counts stay flat at 0
 * throughout, never advancing, since D5 leaves no self-reported oracle-"test"
 * path to a stored row at all.
 *
 * Six-dimension coverage (sequential scenarios over ONE task):
 *   HAPPY:      the mandated `bun run build && cd <dir> && bun test <file>`
 *               form clears the cd-derivation precheck (proven by the absent
 *               MISSING_FILE_WORDING), though the overall write is refused by
 *               D5 (see the note above)
 *   NEGATIVE:   a no-cd command still resolves against cwd, and its refusal
 *               reports "Derived cd target: none"
 *   BOUNDARY:   a two-cd chain's refusal names the LAST target by value
 *   ERROR:      a cd-prefixed command naming an absent file is STILL refused,
 *               exit 4, no row
 *   STATE:      row counts stay flat (0) throughout — no self-reported
 *               oracle-"test" path reaches a stored row under D5
 *   REGRESSION: the pre-existing leading-cd form's precheck derivation keeps
 *               working, and `;` separators behave exactly like `&&`
 *
 * @spec_ref task-evidence-precheck-only-sees-a-cd-in-the-first-segment-of-a
 *
 * TG-25 (adr-tg-1 option b): the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through
 * dist/lore. Wherever the prose above says the compiled binary is spawned or its freshness asserted, that is the
 * history of this file; the assertions and the throwaway-corpus rule are unchanged.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runLoreInProcess } from "../helpers/run-lore-in-process";

// tests/e2e/ -> tests/ -> packages/lore/ -> packages/ -> repo root (4 levels up),
// mirrors every sibling compiled-binary e2e suite's own REPO_ROOT derivation.
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");

/**
 * Replicates this repo's own geometry inside the throwaway corpus: the oracle
 * file sits under a NESTED package dir, reachable only by applying the `cd`
 * segment. Deliberately NOT at the corpus root — a file at the root would
 * resolve against the bare cwd candidate and the test would pass with the
 * cd derivation broken (the pre-fix confound this suite exists to catch).
 */
const NESTED_DIR_RELATIVE = "packages/lore";
const NESTED_FILE_RELATIVE = "tests/e2e/seeded-compiled.bun.test.ts";
/** A second oracle file at the corpus ROOT, for the no-cd control. */
const ROOT_FILE_RELATIVE = "tests/root-seeded.test.ts";

/** The exact form root CLAUDE.md mandates for compiled-binary e2e tests — the defect case. */
const MANDATED_BUILD_THEN_CD = `bun run build && cd ${NESTED_DIR_RELATIVE} && bun test ${NESTED_FILE_RELATIVE}`;
/** The mandated fresh-worktree form, same shape, different first segment. */
const MANDATED_INSTALL_THEN_CD = `bun install && cd ${NESTED_DIR_RELATIVE} && bun test ${NESTED_FILE_RELATIVE}`;
/** The already-working leading-cd form — must stay working. */
const LEADING_CD = `cd ${NESTED_DIR_RELATIVE} && bun test ${NESTED_FILE_RELATIVE}`;
/** `;` separators instead of `&&` — must behave identically. */
const SEMICOLON_CHAIN = `bun run build; cd ${NESTED_DIR_RELATIVE}; bun test ${NESTED_FILE_RELATIVE}`;
/** No cd at all — resolves against cwd, where the ROOT file does exist. */
const NO_CD = `bunx vitest run ${ROOT_FILE_RELATIVE}`;

/** Identical shape to MANDATED_BUILD_THEN_CD, but the named file does NOT exist. */
const MANDATED_SHAPE_ABSENT_FILE = `bun run build && cd ${NESTED_DIR_RELATIVE} && bun test tests/e2e/absent.bun.test.ts`;
/** A two-cd chain over an absent file — pins the LAST target by value. */
const TWO_CD_ABSENT_FILE = "bun run build && cd first && cd second && bun test tests/absent.test.ts";
/** No cd, absent file — pins the "none" wording. */
const NO_CD_ABSENT_FILE = "bunx vitest run tests/absent.test.ts";

/** Wording unique to the missing-oracle-file precheck. */
const MISSING_FILE_WORDING = "Oracle file(s) not found";
/** The clause this task added — names WHY the precheck looked where it looked. */
const DERIVED_TARGET_WORDING = "Derived cd target:";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Spawns the COMPILED binary. `CLAUDECODE=1` resolves the "agent" caller
 * surface (SPEC-024) so no `create` risks a nested AI call; a fixed
 * `LORE_ACTOR` keeps writes attributable and avoids an unrelated
 * actor-traceability warning polluting the exact stderr assertions below.
 */
async function runLore(args: string[], cwd: string): Promise<RunResult> {
  const proc = await runLoreInProcess(args, {
    cwd,
    home: cwd,
    env: {
      ...process.env,
      HOME: cwd,
      CLAUDECODE: "1",
      LORE_ACTOR: "agent:cd-chain-precheck-probe",
    },
  });
  return {
    stdout: proc.stdout,
    stderr: proc.stderr,
    exitCode: proc.exitCode,
  };
}

function parseSlug(stdout: string): string {
  const match = stdout.match(/Slug:\s+(\S+)/);
  const slug = match?.[1];
  if (slug === undefined) throw new Error(`could not parse slug from: ${stdout}`);
  return slug;
}

/**
 * Creates the oracle files the accepted commands name. Contents are
 * irrelevant — nothing ever executes these files; only their EXISTENCE is
 * checked, by `findMissingOracleFilesForEvidence`.
 */
function seedOracleFiles(dir: string): void {
  mkdirSync(join(dir, NESTED_DIR_RELATIVE, "tests", "e2e"), { recursive: true });
  writeFileSync(join(dir, NESTED_DIR_RELATIVE, NESTED_FILE_RELATIVE), "// existence-only fixture\n");
  mkdirSync(join(dir, "tests"), { recursive: true });
  writeFileSync(join(dir, ROOT_FILE_RELATIVE), "// existence-only fixture\n");
}

/** Reads the task's CURRENT evidence-row count straight from the corpus. */
async function readEvidenceCount(dir: string, taskSlug: string): Promise<number> {
  const result = await runLore(["get", taskSlug, "--json"], dir);
  if (result.exitCode !== 0) throw new Error(`lore get failed: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout) as {
    data: { doc: { extra: { verification_evidence?: unknown[] } } };
  };
  return parsed.data.doc.extra.verification_evidence?.length ?? 0;
}

async function recordEvidence(dir: string, taskSlug: string, command: string): Promise<RunResult> {
  return await runLore(
    ["evidence", taskSlug, "--oracle", "test", "--result", "pass", "--command", command, "--output-tail", "ok"],
    dir,
  );
}

let dir: string;
let taskSlug: string;

beforeAll(async () => {

  dir = mkdtempSync(join(tmpdir(), "lore-cd-chain-precheck-"));
  // Never inside this repo — the corpus under test must not be the repo's own.
  expect(dir.startsWith(REPO_ROOT)).toBe(false);

  const init = await runLore(["init"], dir);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
  seedOracleFiles(dir);

  const prd = await runLore(
    ["create", "prd", "--title", "Cd Chain Precheck Root", "--content", "# PRD\n\nroot.", "--no-ai"],
    dir,
  );
  if (prd.exitCode !== 0) throw new Error(`create prd failed: ${prd.stderr}`);

  const plan = await runLore(
    [
      "create", "plan",
      "--title", "Cd Chain Precheck Plan",
      "--parent", parseSlug(prd.stdout),
      "--content", "## Plan\n\nbody",
      "--no-ai",
    ],
    dir,
  );
  if (plan.exitCode !== 0) throw new Error(`create plan failed: ${plan.stderr}`);

  const task = await runLore(
    [
      "create", "task",
      "--title", "Cd Chain Precheck Task",
      "--plan-id", parseSlug(plan.stdout),
      "--content", "## Task\n\nbody",
      "--no-ai",
    ],
    dir,
  );
  if (task.exitCode !== 0) throw new Error(`create task failed: ${task.stderr}`);
  taskSlug = parseSlug(task.stdout);
});

afterAll(() => {
  if (dir !== undefined) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup of a throwaway dir */
    }
  }
});

describe("compiled lore evidence derives a cd target from ANY chain segment", () => {
  it("accepts the mandated `bun run build && cd <dir> && bun test <file>` form", async () => {
    expect(await readEvidenceCount(dir, taskSlug)).toBe(0);

    const accepted = await recordEvidence(dir, taskSlug, MANDATED_BUILD_THEN_CD);

    // The pre-fix binary exited 4 here with MISSING_FILE_WORDING, naming a file
    // that exists — the defect. Assert the wording's ABSENCE too, so a future
    // regression cannot hide behind some other exit-0 path.
    // reason: SUPERSEDED (task-raise-the-evidence-tail-guard-s-predicate-to-
    // its-own, spec-falsifiability-reachability-a-feedable-checkpoint-an §D5)
    // — the cd-derivation precheck this file exists to test still ACCEPTS
    // (proven by the ABSENCE of MISSING_FILE_WORDING below — the precheck
    // never fired its own refusal), but D5 separately raises
    // rejectMissingPassOutputTail to refuse EVERY self-reported oracle-"test"
    // pass without --capture, regardless of tail content. `--oracle manual`
    // is not usable here (it would skip the cd-derivation precheck entirely —
    // exactly the "cheapest escape" this file's own module header calls a
    // measured harm), so the correct, D5-consistent outcome is: precheck
    // passes, the raised tail guard is what refuses.
    expect(accepted.stderr).not.toContain(MISSING_FILE_WORDING);
    expect(accepted.stderr).toContain("--capture");
    expect(accepted.exitCode).toBe(4);
    expect(await readEvidenceCount(dir, taskSlug)).toBe(0);
  });

  it("accepts the mandated fresh-worktree `bun install && cd <dir> && ...` form", async () => {
    const accepted = await recordEvidence(dir, taskSlug, MANDATED_INSTALL_THEN_CD);

    // reason: SUPERSEDED (task-raise-the-evidence-tail-guard-s-predicate-to-
    // its-own, spec-falsifiability-reachability-a-feedable-checkpoint-an §D5)
    // — the cd-derivation precheck this file exists to test still ACCEPTS
    // (proven by the ABSENCE of MISSING_FILE_WORDING below — the precheck
    // never fired its own refusal), but D5 separately raises
    // rejectMissingPassOutputTail to refuse EVERY self-reported oracle-"test"
    // pass without --capture, regardless of tail content. `--oracle manual`
    // is not usable here (it would skip the cd-derivation precheck entirely —
    // exactly the "cheapest escape" this file's own module header calls a
    // measured harm), so the correct, D5-consistent outcome is: precheck
    // passes, the raised tail guard is what refuses.
    expect(accepted.stderr).not.toContain(MISSING_FILE_WORDING);
    expect(accepted.stderr).toContain("--capture");
    expect(accepted.exitCode).toBe(4);
    expect(await readEvidenceCount(dir, taskSlug)).toBe(0);
  });

  it("REGRESSION: the pre-existing leading-cd form keeps working", async () => {
    const accepted = await recordEvidence(dir, taskSlug, LEADING_CD);

    // reason: SUPERSEDED (task-raise-the-evidence-tail-guard-s-predicate-to-
    // its-own, spec-falsifiability-reachability-a-feedable-checkpoint-an §D5)
    // — the cd-derivation precheck this file exists to test still ACCEPTS
    // (proven by the ABSENCE of MISSING_FILE_WORDING below — the precheck
    // never fired its own refusal), but D5 separately raises
    // rejectMissingPassOutputTail to refuse EVERY self-reported oracle-"test"
    // pass without --capture, regardless of tail content. `--oracle manual`
    // is not usable here (it would skip the cd-derivation precheck entirely —
    // exactly the "cheapest escape" this file's own module header calls a
    // measured harm), so the correct, D5-consistent outcome is: precheck
    // passes, the raised tail guard is what refuses.
    expect(accepted.stderr).not.toContain(MISSING_FILE_WORDING);
    expect(accepted.stderr).toContain("--capture");
    expect(accepted.exitCode).toBe(4);
    expect(await readEvidenceCount(dir, taskSlug)).toBe(0);
  });

  it("REGRESSION: `;` separators behave exactly like `&&`", async () => {
    const accepted = await recordEvidence(dir, taskSlug, SEMICOLON_CHAIN);

    // reason: SUPERSEDED (task-raise-the-evidence-tail-guard-s-predicate-to-
    // its-own, spec-falsifiability-reachability-a-feedable-checkpoint-an §D5)
    // — the cd-derivation precheck this file exists to test still ACCEPTS
    // (proven by the ABSENCE of MISSING_FILE_WORDING below — the precheck
    // never fired its own refusal), but D5 separately raises
    // rejectMissingPassOutputTail to refuse EVERY self-reported oracle-"test"
    // pass without --capture, regardless of tail content. `--oracle manual`
    // is not usable here (it would skip the cd-derivation precheck entirely —
    // exactly the "cheapest escape" this file's own module header calls a
    // measured harm), so the correct, D5-consistent outcome is: precheck
    // passes, the raised tail guard is what refuses.
    expect(accepted.stderr).not.toContain(MISSING_FILE_WORDING);
    expect(accepted.stderr).toContain("--capture");
    expect(accepted.exitCode).toBe(4);
    expect(await readEvidenceCount(dir, taskSlug)).toBe(0);
  });

  it("CONTROL: a no-cd command still resolves against cwd exactly as before", async () => {
    const accepted = await recordEvidence(dir, taskSlug, NO_CD);

    // reason: SUPERSEDED (task-raise-the-evidence-tail-guard-s-predicate-to-
    // its-own, spec-falsifiability-reachability-a-feedable-checkpoint-an §D5)
    // — the cd-derivation precheck this file exists to test still ACCEPTS
    // (proven by the ABSENCE of MISSING_FILE_WORDING below — the precheck
    // never fired its own refusal), but D5 separately raises
    // rejectMissingPassOutputTail to refuse EVERY self-reported oracle-"test"
    // pass without --capture, regardless of tail content. `--oracle manual`
    // is not usable here (it would skip the cd-derivation precheck entirely —
    // exactly the "cheapest escape" this file's own module header calls a
    // measured harm), so the correct, D5-consistent outcome is: precheck
    // passes, the raised tail guard is what refuses.
    expect(accepted.stderr).not.toContain(MISSING_FILE_WORDING);
    expect(accepted.stderr).toContain("--capture");
    expect(accepted.exitCode).toBe(4);
    expect(await readEvidenceCount(dir, taskSlug)).toBe(0);
  });

  it("ERROR: the SAME mandated shape naming an ABSENT file is still refused, writing no row", async () => {
    const before = await readEvidenceCount(dir, taskSlug);

    const refused = await recordEvidence(dir, taskSlug, MANDATED_SHAPE_ABSENT_FILE);

    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain(MISSING_FILE_WORDING);
    // The roots clause must still name the cd-joined root it probed...
    expect(refused.stderr).toContain(join(dir, NESTED_DIR_RELATIVE));
    // ...and the new clause must name the target it DERIVED, by value.
    expect(refused.stderr).toContain(`${DERIVED_TARGET_WORDING} ${NESTED_DIR_RELATIVE}`);
    expect(await readEvidenceCount(dir, taskSlug)).toBe(before);
  });

  it("BOUNDARY: a two-cd chain's refusal names the LAST target by value", async () => {
    const before = await readEvidenceCount(dir, taskSlug);

    const refused = await recordEvidence(dir, taskSlug, TWO_CD_ABSENT_FILE);

    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain(`${DERIVED_TARGET_WORDING} second`);
    // The FIRST cd must not be what it derived — pins last-cd-wins by value.
    expect(refused.stderr).not.toContain(`${DERIVED_TARGET_WORDING} first`);
    expect(refused.stderr).toContain(join(dir, "second"));
    expect(await readEvidenceCount(dir, taskSlug)).toBe(before);
  });

  it("NEGATIVE: a no-cd refusal reports that no cd target was derived", async () => {
    const before = await readEvidenceCount(dir, taskSlug);

    const refused = await recordEvidence(dir, taskSlug, NO_CD_ABSENT_FILE);

    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain(`${DERIVED_TARGET_WORDING} none`);
    expect(await readEvidenceCount(dir, taskSlug)).toBe(before);
  });
});
