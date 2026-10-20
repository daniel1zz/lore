// @spawns dist/lore
// @reads hooks/pre-push
// @reads assets/project/pre-push -- the shipped copy this guard drives (embedded in dist/lore, run by its setup)
// @reads packages/lore/tests/integration/pre-push-binary-provenance-*.bun.test.ts -- AC-BFI-11 checks the pre-rename file is gone (the old name itself may not appear in this file)
/**
 * Behavioural trip tests for the pre-push gate's two newest steps —
 * `spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor` AC-BFI-3
 * (binary provenance, step 1) and AC-BFI-9 (the anchor-coverage ratchet, the
 * LAST step). Two `describe` blocks, one per criterion.
 *
 * ⚠️ FILENAME vs CONTENTS: this file is named for AC-BFI-3 alone because it was
 * created for that criterion; AC-BFI-9's suite joined it rather than taking a
 * new path, because the AC-BFI-9 task's declared `file_anchors` set is exactly
 * five paths and a sixth would have been an unanchored edit. Read this file as
 * "the pre-push behavioural trip suite", not as provenance-only. Anything added
 * here must still be a test that DRIVES `assets/project/pre-push`.
 *
 * WHY THIS EXISTS ON TOP OF THE TWO DECLARED ORACLES. Both criteria declare a
 * command of the shape `diff <the two copies> && grep -c <token>
 * hooks/pre-push` — and a line reading `# <token>: TODO` satisfies BOTH
 * segments. The criteria whose entire purpose is proving the checks RUN are
 * therefore satisfiable by a comment (recorded as G6 in
 * `knowledge-five-governance-gaps-measured-while-landing-the`). These suites
 * close that gap by DRIVING the hook and asserting on what it did.
 *
 * ⛔ EXIT CODE ALONE IS NOT EVIDENCE HERE, and this was measured, not assumed:
 * on 2026-08-17 the PRE-CHANGE hook, run against the very same dev-stale
 * binary, ALSO exited 1 — from the pre-existing tree-drift check, having never
 * mentioned provenance. So every assertion below pairs the exit code with the
 * output, and the dev-stale case additionally asserts the ABSENCE of the
 * corpus check's own failure line: the provenance step must have blocked
 * BEFORE any other check could contribute an exit code.
 *
 * bun test (not vitest): spawns subprocesses and the real `sh` hook.
 * ⛔ Never touches the repo's own `.lore/` corpus — every fixture lives under
 * its own `mkdtempSync` directory, and the binary under test is COPIED out of
 * `dist/` so a co-scheduled rebuild cannot swap the artifact mid-suite (the
 * same precaution `binary-provenance-check.test.ts` documents).
 *
 * Coverage dimensions (AC-BFI-3 suite):
 *   HAPPY:      a consumer-shaped repo (build commit unknown to it) passes the
 *               provenance step — output carries the literal `skipped` and NO
 *               provenance-failure line, so an `npm i -g lore` user is never
 *               blocked by this step.
 *   NEGATIVE:   dev-stale (build commit is a commit in this repo but not HEAD)
 *               → hook exits 1, names the provenance failure and its exit 3,
 *               names the `bun run build` remedy, and never reaches the corpus
 *               check.
 *   BOUNDARY:   the fail-open preamble still wins — no `.lore/` directory means
 *               exit 0 with no output at all, even in the dev-stale fixture.
 *   ERROR:      a `lore` whose provenance check exits 4 (a compiled binary
 *               carrying no build commit) gets BUILD-DEFECT advice, textually
 *               distinct from the stale advice — the two failure modes must not
 *               collapse into one message.
 *   STATE:      REVERSE CONTROL — the SAME dev-stale fixture with a `lore`
 *               whose provenance check exits 0 runs on past the provenance
 *               step, proving the block above is attributable to the verdict
 *               and not to anything else about the fixture.
 *   REGRESSION: the two on-disk copies stay byte-identical and both carry the
 *               invocation, re-asserted here against the copy this suite
 *               actually executes (`assets/project/pre-push`, the one that
 *               ships) rather than only the repo-local one.
 *
 * Coverage dimensions (AC-BFI-9 suite) — see that `describe`'s own preamble for
 * the single-variable fixture design that makes each case attributable:
 *   HAPPY:      the offending spec dispositioned in the ledger → the hook runs
 *               the ratchet and exits 0. This is the paired reverse control for
 *               the NEGATIVE case, not a separate scenario.
 *   NEGATIVE:   an unanchored, unledgered live spec → hook exits 1, names the
 *               ratchet failure AND the offending slug AND the finding class.
 *   BOUNDARY:   consumer shape — no `scripts/check-anchor-coverage.ts` at the
 *               repo root → the step is SKIPPED and the hook still exits 0,
 *               with the five `lore` steps demonstrably run.
 *   ERROR:      a scan failure (exit 2, unparseable ledger) gets advice that is
 *               textually DISTINCT from the exit-1 violation advice.
 *   STATE:      the reverse ratchet direction — a ledger row whose spec now
 *               declares anchors → hook blocks naming `debt_paid`.
 *   REGRESSION: both copies stay byte-identical and both carry the invocation;
 *               the fail-open preamble still precedes the new last step.
 *
 * @spec_ref spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor#AC-BFI-3
 * @spec_ref spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor#AC-BFI-9
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { assertFreshBinary } from "./helpers/assert-fresh-binary";
import { createApp } from "../../src/app.js";
import { liveAmbient, liveWriteContext } from "../live-invocation.js";

// ─── Paths ──────────────────────────────────────────────────────────────────

// tests/integration/ → packages/lore/ → packages/ → repo root (4 levels up).
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const DIST_BINARY = join(REPO_ROOT, "dist", "lore");
/** The SHIPPING copy — the one `lore setup --project` installs. Driving this
 *  one (not `hooks/pre-push`) is what makes the test consumer-relevant. */
const HOOK_PATH = join(REPO_ROOT, "assets", "project", "pre-push");
const REPO_HOOK_PATH = join(REPO_ROOT, "hooks", "pre-push");

interface RunResult {
  readonly exitCode: number;
  readonly combined: string;
}

let tempRoot = "";
/** Directory placed first on PATH so the hook's bare `lore` resolves here. */
let realBinDir = "";
let staleRepo = "";
let consumerRepo = "";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/**
 * Runs the real hook script with `cwd` inside a fixture and `PATH` prepended
 * with `binDir`. Fails loud on a signal kill rather than coercing to a number —
 * a signal death has no exit code to assert against.
 */
function runHook(cwd: string, binDir: string, extraEnv: Record<string, string> = {}): RunResult {
  const run = spawnSync("sh", [HOOK_PATH], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...extraEnv, HOME: cwd, PATH: `${binDir}:${process.env["PATH"] ?? ""}` },
  });
  if (run.status === null) {
    throw new Error(`the hook was killed by signal ${String(run.signal)} — no exit code to assert`);
  }
  return { exitCode: run.status, combined: `${run.stdout ?? ""}${run.stderr ?? ""}` };
}

/**
 * Writes a `lore` shim that exits with `code` for the provenance flag. Used
 * ONLY for the ERROR and STATE cases, where the point is the HOOK's own
 * dispatch on an exit code the real binary cannot be coerced into producing on
 * demand. The NEGATIVE and HAPPY cases below drive the REAL binary.
 */
function makeShimBinDir(label: string, code: number): string {
  const dir = join(tempRoot, `shim-${label}`);
  mkdirSync(dir, { recursive: true });
  const shim = join(dir, "lore");
  writeFileSync(shim, `#!/bin/sh\necho "shim: provenance verdict for this fixture"\nexit ${String(code)}\n`, "utf8");
  chmodSync(shim, 0o755);
  return dir;
}

beforeAll(() => {
  if (!existsSync(join(REPO_ROOT, "scripts", "build.ts"))) {
    throw new Error(
      `pre-push-trip: REPO_ROOT resolved to "${REPO_ROOT}", which has no scripts/build.ts — ` +
        `the up-level count in this file's REPO_ROOT is wrong.`,
    );
  }
  // This suite spawns the COMPILED binary through the hook; a stale artifact
  // would silently validate old logic against new source.
  assertFreshBinary(DIST_BINARY, [join(REPO_ROOT, "packages", "lore", "src"), join(REPO_ROOT, "packages", "core", "src")]);

  tempRoot = mkdtempSync(join(tmpdir(), "lore-bfi3-hook-"));

  // Copy the artifact aside immediately — a co-scheduled test may rebuild dist/.
  realBinDir = join(tempRoot, "real-bin");
  mkdirSync(realBinDir, { recursive: true });
  copyFileSync(DIST_BINARY, join(realBinDir, "lore"));
  chmodSync(join(realBinDir, "lore"), 0o755);
  // reason: a compiled `lore init` reads the config template from `<binary dir>/../assets` (DC2-5),
  // as an installed package ships it beside the binary; the copy sits in a temp dir, so the repo's assets are linked in.
  symlinkSync(join(REPO_ROOT, "assets"), join(tempRoot, "assets"));

  // ── dev-stale fixture: a clone whose HEAD has moved past the build commit ──
  staleRepo = join(tempRoot, "stale-clone");
  execFileSync("git", ["clone", "--local", "--no-hardlinks", REPO_ROOT, staleRepo], { encoding: "utf8" });
  git(staleRepo, "-c", "user.email=t@t.t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "advance HEAD past the build commit");
  // The hook's fail-open preamble needs a `.lore/` directory to exist; a bare
  // dir is enough because the provenance step is expected to block before any
  // corpus-reading check runs.
  mkdirSync(join(staleRepo, ".lore"), { recursive: true });

  // ── consumer fixture: a repo with its own history, unknown to the binary ──
  consumerRepo = join(tempRoot, "consumer-repo");
  mkdirSync(consumerRepo, { recursive: true });
  git(consumerRepo, "init");
  writeFileSync(join(consumerRepo, "README.md"), "a project that merely has lore installed\n", "utf8");
  git(consumerRepo, "add", "README.md");
  git(consumerRepo, "-c", "user.email=t@t.t", "-c", "user.name=t", "commit", "-m", "consumer's own first commit");
  mkdirSync(join(consumerRepo, ".lore"), { recursive: true });
}, 300_000);

afterAll(() => {
  if (tempRoot.length > 0) rmSync(tempRoot, { recursive: true, force: true });
});

describe("spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor#AC-BFI-3: the pre-push hook actually RUNS the binary-provenance check", () => {
  it("NEGATIVE: a dev-stale binary blocks the push — exit 1, the output names the provenance failure and its exit 3, and the corpus check never runs", () => {
    const result = runHook(staleRepo, realBinDir);

    // (a) the hook's own failure convention
    expect(result.exitCode).toBe(1);
    // (b) the output names THIS failure — an exit code alone is not evidence,
    //     because the pre-change hook also exited 1 on the same fixture.
    expect(result.combined).toContain("pre-push: binary provenance check failed (exit 3)");
    // (c) the remedy is named, the way the hook's other failure messages name theirs
    expect(result.combined).toContain("bun run build");
    // (d) it blocked BEFORE anything else could contribute an exit code
    expect(result.combined).not.toContain("pre-push: lore corpus check failed");
  });

  it("HAPPY: a consumer whose repo does not know the build commit is NOT blocked by this step — `skipped`, and no provenance-failure line", () => {
    const result = runHook(consumerRepo, realBinDir);

    expect(result.combined).toContain("skipped");
    expect(result.combined).not.toContain("pre-push: binary provenance check failed");
    // Execution continued past the provenance step into the pre-existing checks.
    expect(result.combined).toMatch(/lore\.tree\.yaml|Tree is consistent|No Lore database/);
  });

  it("BOUNDARY: the fail-open preamble still wins — the dev-stale fixture with no .lore/ directory exits 0 and prints nothing", () => {
    const noCorpus = join(tempRoot, "stale-no-corpus");
    execFileSync("git", ["clone", "--local", "--no-hardlinks", REPO_ROOT, noCorpus], { encoding: "utf8" });
    git(noCorpus, "-c", "user.email=t@t.t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "advance HEAD");
    rmSync(join(noCorpus, ".lore"), { recursive: true, force: true });

    const result = runHook(noCorpus, realBinDir);

    expect(result.exitCode).toBe(0);
    expect(result.combined.trim()).toBe("");
  }, 120_000);

  it("ERROR: exit 4 (a compiled binary carrying no build commit) gets BUILD-DEFECT advice, textually distinct from the stale advice", () => {
    const result = runHook(staleRepo, makeShimBinDir("defect", 4));

    expect(result.exitCode).toBe(1);
    expect(result.combined).toContain("pre-push: binary provenance check failed (exit 4)");
    expect(result.combined).toContain("build defect");
    // ⛔ the two failure modes must not produce identical advice
    expect(result.combined).not.toContain("built from a different commit");
  });

  it("STATE (reverse control): the SAME dev-stale fixture with a provenance check that exits 0 runs on past the step — the block above is attributable to the verdict, not the fixture", () => {
    const result = runHook(staleRepo, makeShimBinDir("pass", 0));

    expect(result.combined).not.toContain("pre-push: binary provenance check failed");
  });

  it("REGRESSION: the copy this suite executes is byte-identical to the repo's own hook and both carry the invocation", () => {
    const shipped = readFileSync(HOOK_PATH, "utf8");
    const repoLocal = readFileSync(REPO_HOOK_PATH, "utf8");

    expect(shipped).toBe(repoLocal);
    expect(shipped).toContain("lore status --check-binary-provenance");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-BFI-9 — the anchor-coverage ratchet, driven THROUGH the hook
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Absolute path of the shim's invocation log, injected into the hook's env so a
 * plain `#!/bin/sh` shim can record what the hook asked it to do. This is the
 * POSITIVE trace of execution the "earlier checks did not swallow the run"
 * assertion needs: an absent failure message is equally consistent with a check
 * that passed and a check that never ran, and only one of those is the claim.
 */
const SHIM_LOG_ENV = "LORE_TRIP_SHIM_LOG";

/** The five `lore` invocations the hook must make, in order, BEFORE the ratchet. */
const EXPECTED_LORE_STEPS: readonly string[] = [
  "status --check-binary-provenance",
  "status --check-tree --check-drift",
  "audit --verify",
  "status --check-prd-budget",
  "status --check-claude-md",
];

/**
 * The `lore` invocations the hook makes AFTER the ratchet and the prose-pin guard (AU-T9, AC-AU-9). A run the ratchet
 * blocks exits before them, so only a run that reaches the end of the hook shows all of ALL_LORE_STEPS.
 */
const POST_RATCHET_LORE_STEPS: readonly string[] = [
  "status --check-autonomy-thresholds",
  "autonomy verify-pushed-heads --record",
];

/** Every `lore` call of a hook run that is not stopped by the ratchet, in order. */
const ALL_LORE_STEPS: readonly string[] = [...EXPECTED_LORE_STEPS, ...POST_RATCHET_LORE_STEPS];

/** Every `pre-push:` failure line the five earlier steps can emit — none may appear. */
const EARLIER_STEP_FAILURE_LINES: readonly string[] = [
  "pre-push: binary provenance check failed",
  "pre-push: lore corpus check failed",
  "pre-push: audit chain verification failed",
  "pre-push: PRD outline budget check failed",
  "pre-push: CLAUDE.md budget check failed",
];

interface RatchetRun extends RunResult {
  /** One entry per `lore` invocation the hook made, in call order. */
  readonly loreCalls: readonly string[];
}

describe("spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor#AC-BFI-9: the pre-push hook actually RUNS the anchor-coverage ratchet", () => {
  // ── Single-variable fixture design ────────────────────────────────────────
  // ONE throwaway corpus is built once, holding exactly two live specs:
  //   specA — declares NO code_anchors
  //   specB — declares code_anchors
  // Every case below then varies ONLY the ledger the checker reads (through
  // `LORE_ANCHOR_COVERAGE_REPO_ROOT`, the seam check-anchor-coverage.ts's own
  // header designates for exactly this — pointing a spawned run at a mutated
  // COPY so a RED case never edits the shipped ledger). Because the corpus is
  // held constant, a red is attributable to the ledger and nothing else, and
  // the NEGATIVE→HAPPY pair is a genuine paired transition rather than two
  // independently-constructed scenarios.
  //
  // ⛔ The repo's OWN `.lore/` is never read: `check-anchor-coverage.ts`
  // resolves its corpus from the spawned process's cwd, which is this fixture.
  // ⛔ The five `lore` steps run against a SHIM that exits 0 and logs its argv.
  // That is deliberate and is not what is under test here — the point is the
  // SIXTH step, and an all-pass shim is the only way to reach it deterministically
  // (the real binary reports dev-stale against a synthetic fixture repo and
  // blocks at step 1, which is precisely what the AC-BFI-3 suite above asserts).
  //
  // ── MEASURED RED CONTROLS (2026-08-17, this worktree) ─────────────────────
  // Every case below was observed FAILING under a deliberate degradation, so
  // none of them is a green that would stay green with the wiring gone:
  //   (A) both hook copies' ratchet block replaced by the bare comment
  //       `# check-anchor-coverage: TODO` — the DECLARED AC-BFI-9 oracle
  //       (`diff … && grep -c check-anchor-coverage hooks/pre-push`) still
  //       exited 0 and printed its PASS line (G6, reproduced), while NEGATIVE,
  //       HAPPY, STATE, ERROR and REGRESSION here went red. That contrast is
  //       the entire reason this suite exists.
  //   (B) the `[ -f "$anchor_coverage_checker" ]` presence guard removed —
  //       BOUNDARY went red (consumer exit 1 instead of 0), proving that case
  //       measures the fail-open contract and not merely "nothing happened".
  //   (C) the `lore audit --verify` step deleted from the hook — the
  //       attribution case went red on the step LIST, proving its positive
  //       trace discriminates a skipped earlier step from a passing one.
  let ratchetRoot = "";
  let corpusRepo = "";
  let ratchetConsumerRepo = "";
  let shimBinDir = "";
  let shimLogPath = "";
  let unanchoredSlug = "";
  let anchoredSlug = "";

  /** Writes a ledger file under its own root dir and returns that root. */
  function writeLedgerRoot(label: string, body: string): string {
    const root = join(ratchetRoot, `ledger-${label}`);
    mkdirSync(join(root, "scripts"), { recursive: true });
    writeFileSync(join(root, "scripts", "anchor-coverage-ledger.json"), body, "utf8");
    return root;
  }

  /** A ledger row for `slug`; `reason` must clear the checker's >=20-char, non-placeholder predicate. */
  function ledgerRow(slug: string): Record<string, string> {
    return {
      slug,
      cohort: "debt",
      reason: `Fixture row written by the AC-BFI-9 pre-push trip test to disposition ${slug}.`,
    };
  }

  /** Truncates the shim log, runs the hook against `cwd`, returns exit + output + the shim's call list. */
  function runRatchetHook(cwd: string, ledgerRoot: string): RatchetRun {
    writeFileSync(shimLogPath, "", "utf8");
    const result = runHook(cwd, shimBinDir, {
      [SHIM_LOG_ENV]: shimLogPath,
      LORE_ANCHOR_COVERAGE_REPO_ROOT: ledgerRoot,
    });
    const loreCalls = readFileSync(shimLogPath, "utf8")
      .split("\n")
      .filter((line) => line.length > 0);
    return { ...result, loreCalls };
  }

  beforeAll(async () => {
    ratchetRoot = join(tempRoot, "ratchet");
    mkdirSync(ratchetRoot, { recursive: true });

    // A `lore` shim that passes every check and records what it was asked to do.
    shimBinDir = join(ratchetRoot, "shim-bin");
    mkdirSync(shimBinDir, { recursive: true });
    shimLogPath = join(ratchetRoot, "shim-calls.log");
    writeFileSync(
      join(shimBinDir, "lore"),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "$${SHIM_LOG_ENV}"\necho "shim-lore: ok ($*)"\nexit 0\n`,
      "utf8",
    );
    chmodSync(join(shimBinDir, "lore"), 0o755);
    writeFileSync(shimLogPath, "", "utf8");

    // ── The dev-repo-shaped fixture: its own git repo, its own throwaway corpus,
    // and a SYMLINK to this checkout's real `scripts/`, so the hook's
    // `$(git rev-parse --show-toplevel)/scripts/check-anchor-coverage.ts` guard
    // resolves and the REAL checker (not a copy that could drift) is executed.
    corpusRepo = join(ratchetRoot, "dev-repo");
    mkdirSync(corpusRepo, { recursive: true });
    execFileSync("git", ["init", "-q", "."], { cwd: corpusRepo, encoding: "utf8" });
    symlinkSync(join(REPO_ROOT, "scripts"), join(corpusRepo, "scripts"));
    // reason: the hook's prose-pin step (scripts/check-prose-pins.ts, AC-TG-4) runs with cwd = this
    // fixture and reads the shipped ledger through the `scripts` symlink; every ledger row names a
    // consumer under packages/ and the prose it pins under assets/ + docs/. Without these links the
    // fixture looks like a dev repo that lost those files, so every row reads as a stale entry and
    // the hook exits 1 — turning the "dispositioned ratchet is green" control red for an unrelated
    // reason (measured on main after TG-6). Linking them models what the hook assumes: a dev checkout.
    for (const dir of ["packages", "assets", "docs"]) symlinkSync(join(REPO_ROOT, dir), join(corpusRepo, dir));
    execFileSync(join(realBinDir, "lore"), ["init", "--name", "bfi9-ratchet-fixture"], {
      cwd: corpusRepo,
      encoding: "utf8",
      env: { ...process.env, CLAUDECODE: "1" },
    });

    const app = createApp(join(corpusRepo, ".lore", "lore.db"), undefined, liveAmbient(), liveWriteContext());
    try {
      const prd = await app.corpusService.create({
        type: "prd",
        title: "BFI9 Ratchet Fixture Root",
        content: "Throwaway root PRD for the AC-BFI-9 pre-push trip fixture.",
      });
      if (!prd.ok) throw new Error(`fixture PRD create failed: ${JSON.stringify(prd.error)}`);

      const skeleton = (extra: string): string =>
        [
          "## Overview",
          "A throwaway spec that exists only to drive the anchor-coverage ratchet.",
          "## Scope",
          extra,
          "## Acceptance Criteria",
          "- AC-1: `bun scripts/check-anchor-coverage.ts` exits exactly 1 and names this spec's slug.",
        ].join("\n\n");

      const specA = await app.corpusService.create({
        type: "spec",
        title: "BFI9 Fixture Spec Alpha Unanchored",
        content: skeleton("Declares no code anchors."),
        extra: { spec_kind: "tech" },
      });
      if (!specA.ok) throw new Error(`fixture unanchored spec create failed: ${JSON.stringify(specA.error)}`);
      unanchoredSlug = specA.value.slug;

      const specB = await app.corpusService.create({
        type: "spec",
        title: "BFI9 Fixture Spec Beta Anchored",
        content: skeleton("Declares one code anchor."),
        extra: { spec_kind: "tech", code_anchors: ["packages/lore/src/app.ts#createApp"] },
      });
      if (!specB.ok) throw new Error(`fixture anchored spec create failed: ${JSON.stringify(specB.error)}`);
      anchoredSlug = specB.value.slug;
    } finally {
      app.close();
    }

    // ── The consumer-shaped fixture: a project that installed this hook via
    // `lore setup --project` and therefore has NO scripts/check-anchor-coverage.ts.
    ratchetConsumerRepo = join(ratchetRoot, "consumer-repo");
    mkdirSync(join(ratchetConsumerRepo, ".lore"), { recursive: true });
    execFileSync("git", ["init", "-q", "."], { cwd: ratchetConsumerRepo, encoding: "utf8" });
  }, 300_000);

  it("NEGATIVE: an unanchored, unledgered live spec blocks the push — exit 1, and the output names the ratchet failure, the slug, and the finding class", () => {
    const emptyLedger = writeLedgerRoot("empty", JSON.stringify({ entries: [] }));

    const result = runRatchetHook(corpusRepo, emptyLedger);

    // (a) the hook's own failure convention
    expect(result.exitCode).toBe(1);
    // (b) the hook's step-specific message, with the checker's EXACT code — not
    //     "non-zero": exit 2 has different advice and must not satisfy this.
    expect(result.combined).toContain("pre-push: anchor-coverage ratchet failed (exit 1)");
    // (c) the checker actually RAN and reported: its census line, its verdict
    //     line naming the finding class, and the offending slug. An exit code
    //     alone is not evidence — the AC-BFI-3 suite above measured the hook
    //     exiting 1 from an entirely unrelated step.
    expect(result.combined).toContain("check-anchor-coverage: scanned 2 live spec(s)");
    expect(result.combined).toContain("FAILED — 1 finding(s) in 1 class(es): missing_disposition.");
    expect(result.combined).toContain(unanchoredSlug);
    // (d) the anchored spec is NOT indicted — the checker discriminated between
    //     the two specs rather than failing the whole population.
    expect(result.combined).not.toContain(anchoredSlug);
    // (e) the exit-2 scan-failure advice is NOT what was printed
    expect(result.combined).not.toContain("could not complete its scan");
  }, 120_000);

  it("NEGATIVE (attribution): the five earlier steps all RAN, in order, and none of them contributed the exit code", () => {
    const emptyLedger = writeLedgerRoot("empty-attribution", JSON.stringify({ entries: [] }));

    const result = runRatchetHook(corpusRepo, emptyLedger);

    // Positive trace: the shim recorded all five `lore` steps, in hook order.
    // ⛔ Asserting only the ABSENCE of their failure lines would pass equally on
    // a hook that skipped them entirely.
    expect(result.loreCalls).toEqual([...EXPECTED_LORE_STEPS]);
    // And none of them failed, so the exit 1 above is the ratchet's alone.
    for (const line of EARLIER_STEP_FAILURE_LINES) {
      expect(result.combined).not.toContain(line);
    }
  }, 120_000);

  it("HAPPY (paired reverse control): dispositioning that same spec in the ledger turns the identical run green — exit 0, the ratchet ran and passed", () => {
    const dispositioned = writeLedgerRoot("with-row", JSON.stringify({ entries: [ledgerRow(unanchoredSlug)] }));

    const result = runRatchetHook(corpusRepo, dispositioned);

    expect(result.exitCode).toBe(0);
    // The step was reached and passed — not skipped. Its OK verdict is the proof.
    expect(result.combined).toContain("check-anchor-coverage: OK —");
    expect(result.combined).not.toContain("pre-push: anchor-coverage ratchet");
    expect(result.loreCalls).toEqual([...ALL_LORE_STEPS]);
  }, 120_000);

  it("STATE: the reverse ratchet direction also blocks — a ledger row whose spec now declares anchors is named as debt_paid", () => {
    const staleRow = writeLedgerRoot(
      "stale-exemption",
      JSON.stringify({ entries: [ledgerRow(unanchoredSlug), ledgerRow(anchoredSlug)] }),
    );

    const result = runRatchetHook(corpusRepo, staleRow);

    expect(result.exitCode).toBe(1);
    expect(result.combined).toContain("pre-push: anchor-coverage ratchet failed (exit 1)");
    expect(result.combined).toContain("FAILED — 1 finding(s) in 1 class(es): debt_paid.");
    expect(result.combined).toContain(anchoredSlug);
  }, 120_000);

  it("ERROR: a scan failure (exit 2, unparseable ledger) gets advice textually DISTINCT from the exit-1 violation advice", () => {
    const brokenLedger = writeLedgerRoot("broken", "{ this is not JSON");

    const result = runRatchetHook(corpusRepo, brokenLedger);

    expect(result.exitCode).toBe(1);
    expect(result.combined).toContain("pre-push: anchor-coverage ratchet could not complete its scan (exit 2)");
    // ⛔ the two failure modes must not collapse into one message
    expect(result.combined).not.toContain("pre-push: anchor-coverage ratchet failed");
    expect(result.combined).toContain("checker/ledger defect, not unanchored specs");
  }, 120_000);

  it("BOUNDARY: a consumer repo with no scripts/check-anchor-coverage.ts is NOT blocked — the step is skipped and the hook still exits 0", () => {
    const emptyLedger = writeLedgerRoot("consumer", JSON.stringify({ entries: [] }));

    const result = runRatchetHook(ratchetConsumerRepo, emptyLedger);

    expect(result.exitCode).toBe(0);
    // Skipped, not run: no checker output at all, and no ratchet failure line.
    expect(result.combined).not.toContain("check-anchor-coverage:");
    expect(result.combined).not.toContain("pre-push: anchor-coverage ratchet");
    // ⛔ and skipping it did NOT short-circuit the hook: the five real steps ran.
    expect(result.loreCalls).toEqual([...ALL_LORE_STEPS]);
  }, 120_000);

  it("REGRESSION: both copies carry the ratchet invocation, stay byte-identical, and keep it AFTER the fail-open preamble", () => {
    const shipped = readFileSync(HOOK_PATH, "utf8");
    const repoLocal = readFileSync(REPO_HOOK_PATH, "utf8");

    expect(shipped).toBe(repoLocal);
    for (const content of [shipped, repoLocal]) {
      expect(content).toContain("check-anchor-coverage");
      const preambleIdx = content.indexOf("command -v lore");
      const ratchetIdx = content.indexOf("check-anchor-coverage.ts");
      expect(preambleIdx).toBeGreaterThanOrEqual(0);
      expect(ratchetIdx).toBeGreaterThan(preambleIdx);
    }
  });
});

describe("AC-BFI-11: the rename and every record of the old name are one acceptance unit", () => {
  // ⛔ The needle is built from two fragments, joined at runtime, so THIS
  // FILE's own source never contains the pre-rename literal as one
  // contiguous run. If it did, case (a)'s repo-wide grep below would match
  // this very file and be red forever (or worse, get "fixed" by narrowing
  // the search to exclude this file — a silent weakening of the check it
  // exists to run). See the CONTROL case immediately below for proof the
  // two fragments concatenate to the intended literal.
  const OLD_BASENAME_FRAGMENT_1 = "pre-push-binary";
  const OLD_BASENAME_FRAGMENT_2 = "-provenance-trip";
  const OLD_BASENAME_LITERAL = OLD_BASENAME_FRAGMENT_1 + OLD_BASENAME_FRAGMENT_2;
  const OLD_TEST_FILE_PATH = join(
    REPO_ROOT,
    "packages",
    "lore",
    "tests",
    "integration",
    `${OLD_BASENAME_LITERAL}.bun.test.ts`,
  );
  const THIS_FILE_PATH = new URL(import.meta.url).pathname;

  it("CONTROL: the old-basename needle concatenates correctly and actually detects the shape it targets", () => {
    // Cross-check via a DIFFERENT split point than the one used to build
    // OLD_BASENAME_LITERAL above — a typo in either split would make the two
    // disagree, so this is not just re-asserting the same construction.
    const crossCheckSplit = "pre-push-binary-prov" + "enance-trip";
    expect(OLD_BASENAME_LITERAL).toBe(crossCheckSplit);
    // ⛔ Deliberately NOT a `.toBe(OLD_BASENAME_FRAGMENT_1 + OLD_BASENAME_FRAGMENT_2
    // spelled out again as one quoted literal)` here — that would put the
    // pre-rename basename into THIS file's own source as one contiguous run,
    // making case (a)'s repo-wide grep below self-defeating (measured: it
    // did, on the first attempt at this test — see git history of this file).
    expect(OLD_BASENAME_LITERAL.length).toBe(31);
    expect(OLD_BASENAME_LITERAL.startsWith("pre-push-binary")).toBe(true);
    expect(OLD_BASENAME_LITERAL.endsWith("provenance-trip")).toBe(true);

    // Proves the needle actually matches the literal shape it targets, using
    // plain string search (no git) — the "it detects what it claims to
    // detect" control that case (a)'s git grep depends on.
    const fixtureWithNeedle = `see ${OLD_BASENAME_LITERAL}.bun.test.ts for the old name`;
    const fixtureWithoutNeedle = "see pre-push-trip.bun.test.ts for the current name";
    expect(fixtureWithNeedle.includes(OLD_BASENAME_LITERAL)).toBe(true);
    expect(fixtureWithoutNeedle.includes(OLD_BASENAME_LITERAL)).toBe(false);
  });

  it("(a) no tracked file outside docs/requirements contains the pre-rename literal — offenders are NAMED, not just booleaned", () => {
    const run = spawnSync("git", ["grep", "-n", "-I", OLD_BASENAME_LITERAL, "--", ":(exclude)docs/requirements"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    if (run.status === null) {
      throw new Error(`git grep was killed by signal ${String(run.signal)} — no exit code to assert`);
    }
    // git grep: 0 = match found, 1 = no match, >1 = a real error (bad
    // revision, bad pathspec, etc.) — never coerced into a boolean.
    if (run.status === 0) {
      throw new Error(
        `found the pre-rename literal "${OLD_BASENAME_LITERAL}" outside docs/requirements — ` +
          `every offending location below must be re-converged:\n${run.stdout}`,
      );
    }
    if (run.status !== 1) {
      throw new Error(
        `git grep exited ${String(run.status)} (expected 0 or 1) — stderr: ${run.stderr}`,
      );
    }
    expect(run.status).toBe(1);
  });

  it("(b) the pre-rename path does not exist on disk", () => {
    expect(existsSync(OLD_TEST_FILE_PATH)).toBe(false);
  });

  it("(c) this file's own diagnostic prefix is the new basename, never the old one", () => {
    const ownSource = readFileSync(THIS_FILE_PATH, "utf8");
    expect(ownSource.includes("pre-push-trip:")).toBe(true);
    expect(ownSource.includes(`${OLD_BASENAME_LITERAL}:`)).toBe(false);
  });

  // (d) — `lore status --check-drift` exits 0 AND the spec's stored anchor value NAMES the renamed
  // file — read THIS repo's own live corpus, which LORE_TEST_SANDBOX (AC-TG-2) refuses inside a
  // test. It moved to `scripts/check-live-corpus-detectors.ts` (check:live-repo-state); the
  // AC-BFI-15 suite below proves the same assertion path, forced red, on a throwaway corpus.
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-BFI-15 — AC-BFI-13's red, machine-measured against a throwaway corpus
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-BFI-15 fixture-forced-anchor-red: the anchor-value assertion is forced red inside a throwaway corpus that owns its own spec and anchor", () => {
  // ── Why a fixture, not this repo's own corpus ─────────────────────────────
  // AC-BFI-11 case (d) above (line 632) reads THIS repo's own spec's
  // code_anchors through DIST_BINARY. Forcing THAT assertion red would mean
  // repointing a live corpus anchor — a destructive edit to the team's
  // knowledge base (project CLAUDE.md `.lore/` discipline). So AC-BFI-13
  // could only ARGUE its discriminating power from the assertion's shape,
  // never MEASURE a real failure. This suite closes that gap: a throwaway
  // corpus that owns its own spec and its own anchor, so repointing it is
  // free.
  //
  // ── Fixture design ─────────────────────────────────────────────────────
  // ONE throwaway corpus (mkdtemp + `lore init`, never this repo's `.lore/`),
  // holding TWO specs and TWO real on-disk files:
  //   greenSpecSlug — anchors ANCHOR_FILE_A, never mutated (the GREEN case).
  //   redSpecSlug   — starts anchoring ANCHOR_FILE_A too, then its own case
  //                   repoints it to ANCHOR_FILE_B (the RED case).
  // Two independent specs (rather than one spec mutated in place) so the two
  // `it` blocks below have no execution-order dependency on each other.
  // Both fixture files exist on disk throughout, so `--check-drift` reports
  // the SAME "consistent" verdict whichever one a spec's anchor names — that
  // pairing (drift clean + assertion red) is the whole discriminator AC-BFI-13
  // was written to prove and could not measure; asserting drift-clean alone
  // is consistent with the anchor having been repointed to ANY existing file.
  let fixtureRoot = "";
  let fixtureCorpusDir = "";
  let fixtureDb = "";
  let greenSpecSlug = "";
  let redSpecSlug = "";
  const ANCHOR_FILE_A = "anchor-target-a.ts";
  const ANCHOR_FILE_B = "anchor-target-b.ts";

  /** Runs `lore status --check-drift` via DIST_BINARY, cwd inside the fixture corpus. */
  function checkDriftExitCode(cwd: string): number {
    const run = spawnSync(DIST_BINARY, ["status", "--check-drift"], { cwd, encoding: "utf8" });
    if (run.status === null) {
      throw new Error(`lore status --check-drift was killed by signal ${String(run.signal)} — no exit code to assert`);
    }
    return run.status;
  }

  /**
   * THE SAME assertion path AC-BFI-11's case (d) drives against this repo's
   * own corpus (lines 632-665 above), generalized to a fixture cwd / spec /
   * expected basename so this suite can force it both green and red off ONE
   * shared function — the AC-BFI-12 "happy case and its falsifier call one
   * shared assertion function" discipline applied to this sibling case.
   * Throws (never returns a boolean) so `expect(() => ...).not.toThrow()` /
   * `.toThrow(/pattern/)` drive both directions, and the thrown message NAMES
   * every anchor it actually found — never a bare "assertion failed".
   */
  function assertAnchorValueNames(cwd: string, specSlug: string, expectedBasename: string): void {
    const getRun = spawnSync(DIST_BINARY, ["get", specSlug, "--json"], { cwd, encoding: "utf8" });
    if (getRun.status === null) {
      throw new Error(`lore get ${specSlug} was killed by signal ${String(getRun.signal)} — no exit code to assert`);
    }
    if (getRun.status !== 0) {
      throw new Error(`lore get ${specSlug} --json exited ${String(getRun.status)}: ${getRun.stdout}${getRun.stderr}`);
    }
    const parsed = JSON.parse(getRun.stdout) as {
      readonly data?: { readonly doc?: { readonly extra?: { readonly code_anchors?: readonly string[] } } };
    };
    const codeAnchors = parsed.data?.doc?.extra?.code_anchors ?? [];
    const found = codeAnchors.some((anchor) => anchor.endsWith(expectedBasename));
    if (!found) {
      throw new Error(
        `expected ${specSlug}'s code_anchors to name a path ending with "${expectedBasename}", ` +
          `but found: ${JSON.stringify(codeAnchors)}`,
      );
    }
  }

  beforeAll(async () => {
    fixtureRoot = mkdtempSync(join(tmpdir(), "lore-bfi15-anchor-red-"));
    fixtureCorpusDir = fixtureRoot;

    // Two real files this fixture owns — the "different existing file" the RED
    // direction repoints to must actually exist, or drift would report it
    // missing and the exit-0/exit-0 pairing (the whole discriminator) would
    // never arise.
    writeFileSync(join(fixtureCorpusDir, ANCHOR_FILE_A), "export const anchorTargetA = true;\n", "utf8");
    writeFileSync(join(fixtureCorpusDir, ANCHOR_FILE_B), "export const anchorTargetB = true;\n", "utf8");

    const initRun = spawnSync(DIST_BINARY, ["init", "--name", "bfi15-anchor-red-fixture"], {
      cwd: fixtureCorpusDir,
      encoding: "utf8",
      env: { ...process.env, CLAUDECODE: "1" },
    });
    if (initRun.status !== 0) {
      throw new Error(`lore init failed in the AC-BFI-15 fixture corpus: ${initRun.stdout}${initRun.stderr}`);
    }

    // Never this repo's own `.lore/` — a fresh db file inside the throwaway
    // corpus this suite just initialized.
    fixtureDb = join(fixtureCorpusDir, ".lore", "lore.db");
    const app = createApp(fixtureDb, undefined, liveAmbient(), liveWriteContext());
    try {
      const prd = await app.corpusService.create({
        type: "prd",
        title: "BFI15 Anchor Red Fixture Root",
        content: "Throwaway root PRD for the AC-BFI-15 fixture-forced-anchor-red suite.",
      });
      if (!prd.ok) throw new Error(`fixture PRD create failed: ${JSON.stringify(prd.error)}`);

      const skeleton = (label: string): string =>
        [
          "## Overview",
          `A throwaway spec (${label}) that exists only to own a code_anchors entry this suite reads.`,
          "## Scope",
          "Anchors a single fixture file this suite created on disk.",
          "## Acceptance Criteria",
          "- AC-1: this spec's code_anchors names the fixture file this suite created.",
        ].join("\n\n");

      const greenSpec = await app.corpusService.create({
        type: "spec",
        title: "BFI15 Anchor Red Fixture Spec Green",
        content: skeleton("green — never repointed"),
        extra: { spec_kind: "tech", code_anchors: [ANCHOR_FILE_A] },
      });
      if (!greenSpec.ok) throw new Error(`fixture green-spec create failed: ${JSON.stringify(greenSpec.error)}`);
      greenSpecSlug = greenSpec.value.slug;

      const redSpec = await app.corpusService.create({
        type: "spec",
        title: "BFI15 Anchor Red Fixture Spec Red",
        content: skeleton("red — repointed by its own case below"),
        extra: { spec_kind: "tech", code_anchors: [ANCHOR_FILE_A] },
      });
      if (!redSpec.ok) throw new Error(`fixture red-spec create failed: ${JSON.stringify(redSpec.error)}`);
      redSpecSlug = redSpec.value.slug;
    } finally {
      app.close();
    }
  }, 300_000);

  afterAll(() => {
    if (fixtureRoot.length > 0) rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it("GREEN: the fixture spec's stored anchor names the expected file, and --check-drift exits 0", () => {
    expect(checkDriftExitCode(fixtureCorpusDir)).toBe(0);
    expect(() => assertAnchorValueNames(fixtureCorpusDir, greenSpecSlug, ANCHOR_FILE_A)).not.toThrow();
  });

  it("RED: repointing the fixture spec's anchor to a different existing file makes the IDENTICAL assertion path fail, naming the anchor it actually found, WHILE --check-drift still exits 0", async () => {
    // Repoint via `DriftCheckService.setCodeAnchors` — the sanctioned RMW
    // writer for `code_anchors` (the same seam `lore anchor set` uses),
    // never a hand-rolled `corpusService.set({ extra: ... })` wholesale
    // replace.
    const app = createApp(fixtureDb, undefined, liveAmbient(), liveWriteContext());
    let anchorsAfterRepoint: readonly string[];
    try {
      if (app.driftCheckService === undefined) {
        throw new Error("driftCheckService is not wired on this App — cannot repoint the fixture anchor");
      }
      const repointed = await app.driftCheckService.setCodeAnchors(redSpecSlug, [ANCHOR_FILE_B]);
      if (!repointed.ok) throw new Error(`repoint failed: ${JSON.stringify(repointed.error)}`);
      anchorsAfterRepoint = repointed.value;
    } finally {
      app.close();
    }
    // Sanity on the write itself, independent of the two assertions below.
    expect(anchorsAfterRepoint.some((anchor) => anchor.endsWith(ANCHOR_FILE_B))).toBe(true);

    // The discriminator's first half: drift stays clean — ANCHOR_FILE_B exists
    // too — so a clean drift alone would say nothing went wrong.
    expect(checkDriftExitCode(fixtureCorpusDir)).toBe(0);
    // The discriminator's second half: the SAME function the GREEN case just
    // proved passing must now throw, because the stored anchor no longer names
    // ANCHOR_FILE_A, and its message NAMES what it actually found (B) rather
    // than a bare "assertion failed".
    expect(() => assertAnchorValueNames(fixtureCorpusDir, redSpecSlug, ANCHOR_FILE_A)).toThrow(
      new RegExp(ANCHOR_FILE_B.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  });
});
