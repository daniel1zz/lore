/**
 * `lore red-first <task>` — the CLI author→trip end-to-end oracle for
 * task-red-first-discipline-is-asked-for-in-prose-but-never. Proves the
 * dedicated writer verb actually reaches the COMPILED binary (not just the
 * service layer, already covered by task-workflow-service.test.ts's
 * "red-first discipline floor" suite) and that `lore done` enforces the new
 * floor end to end through real CLI verbs.
 *
 * Spawns the COMPILED `dist/lore` binary (Bun.spawnSync) against a THROWAWAY
 * corpus (mkdtemp + `lore init`) — never touches the repo's own `.lore/`
 * corpus (project CLAUDE.md hard rule). Requires `bun run build` first;
 * `assertFreshBinary` fails loud before any test runs if `dist/lore` is
 * missing or older than the newest `.ts` source under
 * `packages/{lore,core}/src`.
 *
 * Fixture: a single `--adhoc` task (SPEC-069 D2) — deliberately sidesteps the
 * plan→spec→ac-scope chain entirely (this suite's subject is the red-first
 * writer + done()'s new floor, not the task-create/task-claim gates, which
 * have their own dedicated coverage elsewhere).
 *
 * Coverage:
 *   HAPPY:      `red-first` declares the flag (--json round-trips
 *               extra.red_first: true); a red_first task carrying both a
 *               pass AND an expected-fail row archives via `lore done`
 *   NEGATIVE:   a red_first task with ONLY a pass row is refused by `lore
 *               done` (exit 4), naming the task slug and the missing row
 *   BOUNDARY:   declaring red-first twice is idempotent (still true, exit 0
 *               both times)
 *   ERROR:      `lore red-first` on a nonexistent task → exit 3
 *   STATE:      a plain task's `lore done` (no red-first declared) is
 *               UNAFFECTED by red_first itself (AC3 control), and — added by
 *               task-the-ac-scope-re-keying-left-the-red-first-floor-unarmed —
 *               an `--ac-scope ""` task with no red row is REFUSED (exit 4)
 *               while the identical shape archives under the audited
 *               `--declare-no-new-tests` declaration: the author→trip oracle
 *               for the opt-OUT floor, asserted in BOTH directions
 *   REGRESSION: `lore set --red-first` is refused at the strict-flag seam
 *               (exit 2) — there is deliberately no such flag
 *
 * @spec_ref task-red-first-discipline-is-asked-for-in-prose-but-never
 * @spec_ref task-the-ac-scope-re-keying-left-the-red-first-floor-unarmed
 */

import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach, setDefaultTimeout } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { assertFreshBinary } from "../../integration/helpers/assert-fresh-binary";

setDefaultTimeout(60_000);

// tests/unit/adapters/ → tests/unit/ → tests/ → packages/lore/ → packages/ → repo root (5 levels up).
const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync([LORE_BIN, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true" },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

// reason: SUPERSEDED oracle (task-raise-the-evidence-tail-guard-s-predicate-
// to-its-own) - every fixture "evidence" call below now uses --oracle manual
// instead of "test"/"tsc": that raise refuses a self-reported --result pass
// for any other oracle regardless of tail content, and none of these fixture
// rows care about oracle-kind semantics - only the red-first/attestation
// floors this suite actually tests.
function mustRun(args: string[], cwd: string): RunResult {
  const result = runLore(args, cwd);
  if (result.exitCode !== 0) {
    throw new Error(`fixture command \`lore ${args.join(" ")}\` failed (${result.exitCode}): ${result.stderr}`);
  }
  return result;
}

interface DocJson {
  readonly slug: string;
  /** Read by the empty-scope floor probe below — a refusal must leave it `draft`. */
  readonly status: string;
  readonly extra: Record<string, unknown>;
}

function getDoc(slug: string, cwd: string): DocJson {
  const result = mustRun(["get", slug, "--json"], cwd);
  return (JSON.parse(result.stdout) as { data: { doc: DocJson } }).data.doc;
}

/**
 * Creates a planless (`--adhoc`) task and returns its slug.
 *
 * `--ac-scope ""` is REQUIRED on the ad-hoc branch (task-an-ad-hoc-task-can-
 * never-reach-the-attestation-path-that) — an ad-hoc creation without it now
 * exits 4. The EMPTY form is the right one for this fixture: it preserves the
 * "no declared AC" shape every assertion below depends on, while making the
 * claim explicit.
 *
 * ⛔ That explicit-empty declaration ARMS `requiresNoNewTestsDeclaration`
 * (task-the-ac-scope-re-keying-left-the-red-first-floor-unarmed — the floor keys
 * on the declaration's PRESENCE, not the array's length). It is therefore
 * INVISIBLE for every `red_first`-declaring fixture below (that flag short-
 * circuits the floor, which is the mutual exclusion the two floors are built on)
 * and VISIBLE for the plain-task STATE case, which now carries
 * `--declare-no-new-tests` — see that test's own comment.
 */
function createAdhocTask(cwd: string, title: string): string {
  const created = mustRun(
    ["create", "task", "--title", title, "--adhoc", "--ac-scope", "", "--content", "body", "--no-ai", "--json"],
    cwd,
  );
  return (JSON.parse(created.stdout) as { data: { slug: string } }).data.slug;
}

let tmpDir: string;

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [
    join(REPO_ROOT, "packages", "lore", "src"),
    join(REPO_ROOT, "packages", "core", "src"),
  ]);
});

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-cli-red-first-"));
  mustRun(["init"], tmpDir);
  // An --adhoc task parents to the corpus root PRD (CorpusService._createImpl) —
  // one must exist first, mirroring every other --adhoc fixture in this repo.
  mustRun(["create", "prd", "--title", "Red First Root", "--content", "## Overview\nroot", "--no-ai"], tmpDir);
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

describe("HAPPY — lore red-first declares the flag and lore done accepts a proven red_first task", () => {
  it("red-first --json round-trips extra.red_first: true", () => {
    const slug = createAdhocTask(tmpDir, "Declare Target");

    const result = mustRun(["red-first", slug, "--json"], tmpDir);
    const parsed = JSON.parse(result.stdout) as { data: { extra: Record<string, unknown> } };
    expect(parsed.data.extra["red_first"]).toBe(true);
    expect(getDoc(slug, tmpDir).extra["red_first"]).toBe(true);
  });

  it("a red_first task with a pass AND an expected-fail row archives via lore done", () => {
    const slug = createAdhocTask(tmpDir, "Proven Red First");
    mustRun(["red-first", slug], tmpDir);
    mustRun(
      [
        "evidence",
        slug,
        "--oracle",
        "test",
        "--command",
        "bunx vitest run --grep new-feature",
        "--result",
        "expected-fail",
        "--output-tail",
        "AssertionError: expected 1 to equal 2",
      ],
      tmpDir,
    );
    mustRun(
      ["evidence", slug, "--oracle", "manual", "--command", "bunx vitest run --grep new-feature-again", "--result", "pass", "--output-tail", "ok"],
      tmpDir,
    );

    // reason: adr-lore-done-requires-a-runner-attested-pass-the-sixth-false — this
    // fixture's evidence is self-reported (`lore evidence`, never `lore verify`,
    // exactly the --adhoc/no-declared-AC shape the ADR calls out as structurally
    // unattestable) so the audited escape hatch is required to reach exit 0. This
    // suite's subject is the red-first floor, not the attestation floor.
    const result = runLore(["done", slug, "--override-attestation", "red-first-writer fixture: self-reported only"], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(getDoc(slug, tmpDir).extra["red_first"]).toBe(true);
  });
});

describe("NEGATIVE — lore done refuses a red_first task holding only a pass row", () => {
  it("exit 4, naming the task slug and the missing expected-fail/fail row", () => {
    const slug = createAdhocTask(tmpDir, "Unproven Red First");
    mustRun(["red-first", slug], tmpDir);
    mustRun(["evidence", slug, "--oracle", "manual", "--command", "bun run typecheck", "--result", "pass", "--output-tail", "ok"], tmpDir);

    // reason: adr-lore-done-requires-a-runner-attested-pass-the-sixth-false — the
    // escape hatch clears the ATTESTATION floor (this fixture's evidence is
    // self-reported only, structurally unattestable for a --adhoc/no-declared-AC
    // task) so the RED-FIRST floor underneath — this suite's actual subject — is
    // what fires and is what this assertion proves.
    const result = runLore(
      ["done", slug, "--override-attestation", "red-first-writer fixture: self-reported only"],
      tmpDir,
    );
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain(slug);
    expect(result.stderr).toMatch(/expected-fail|"fail"/);
  });
});

describe("BOUNDARY — declaring red-first twice is idempotent", () => {
  it("both calls exit 0, flag stays true", () => {
    const slug = createAdhocTask(tmpDir, "Double Declare");

    const first = runLore(["red-first", slug], tmpDir);
    const second = runLore(["red-first", slug], tmpDir);
    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(getDoc(slug, tmpDir).extra["red_first"]).toBe(true);
  });
});

describe("ERROR — lore red-first on a nonexistent task", () => {
  it("exit 3 (DOC_NOT_FOUND)", () => {
    const result = runLore(["red-first", "task-does-not-exist"], tmpDir);
    expect(result.exitCode).toBe(3);
  });
});

describe("STATE — a plain task (no red-first declared) is unaffected by THIS feature", () => {
  it("lore done archives a plain task exactly as before red-first existed, once the (unrelated) attestation and no-new-tests floors are satisfied", () => {
    const slug = createAdhocTask(tmpDir, "Plain Task");
    mustRun(["evidence", slug, "--oracle", "manual", "--command", "bun run typecheck", "--result", "pass", "--output-tail", "ok"], tmpDir);

    // reason: adr-lore-done-requires-a-runner-attested-pass-the-sixth-false — a
    // self-reported pass alone no longer suffices for ANY task, red-first or not
    // (a separate, independent floor from red-first's own). The escape hatch is
    // the only way this --adhoc/no-declared-AC fixture can reach exit 0 at all;
    // the assertion this test actually cares about is red_first staying
    // undefined/unaffected, not the attestation floor itself.
    //
    // reason: --declare-no-new-tests is the SECOND escape this fixture now needs
    // (task-the-ac-scope-re-keying-left-the-red-first-floor-unarmed): its
    // `--ac-scope ""` declaration arms the opt-OUT no-new-tests floor precisely
    // because this task never declared red_first. That is this file's own
    // demonstration of the two floors' mutual exclusion from the other side.
    const result = runLore(
      [
        "done",
        slug,
        "--override-attestation",
        "red-first-writer fixture: self-reported only",
        "--declare-no-new-tests",
        "red-first-writer fixture: plain-task control, no new test",
      ],
      tmpDir,
    );
    expect(result.exitCode).toBe(0);
    expect(getDoc(slug, tmpDir).extra["red_first"]).toBeUndefined();
  });

  // ─── task-the-ac-scope-re-keying-left-the-red-first-floor-unarmed ──────────
  // The author→trip end-to-end oracle for the newly-armed floor, through the
  // COMPILED binary: an `--ac-scope ""` ad-hoc task (the dominant shape the
  // re-keying created) can no longer archive silently, and BOTH outcomes are
  // asserted — the refusal AND, on the very same fixture shape, the archival
  // under the audited declaration. Asserting only one direction would pass
  // against the pre-fix silent behaviour.
  it("an --ac-scope \"\" task with NO red row is REFUSED (exit 4) and stays draft; the same shape archives once the declaration is supplied", () => {
    const refusedSlug = createAdhocTask(tmpDir, "Empty Scope Unarmed Probe");
    mustRun(
      ["evidence", refusedSlug, "--oracle", "manual", "--command", "bun run typecheck", "--result", "pass", "--output-tail", "ok"],
      tmpDir,
    );

    // --override-attestation clears the FIRST floor, so what fires here is the
    // no-new-tests floor — the one that used to be inapplicable for `[]`.
    const refusal = runLore(
      ["done", refusedSlug, "--override-attestation", "red-first-writer fixture: self-reported only"],
      tmpDir,
    );
    expect(refusal.exitCode).toBe(4);
    // Two INDEPENDENT lone tokens rather than one remembered sentence.
    expect(refusal.stderr).toContain("ac_scope");
    expect(refusal.stderr).toContain("--declare-no-new-tests");
    expect(getDoc(refusedSlug, tmpDir).status).toBe("draft");

    // The OTHER branch on the identical fixture shape: with the audited
    // declaration the same task archives, and the reason is on the audit rows.
    const declaredSlug = createAdhocTask(tmpDir, "Empty Scope Declared Probe");
    mustRun(
      ["evidence", declaredSlug, "--oracle", "manual", "--command", "bun run typecheck", "--result", "pass", "--output-tail", "ok"],
      tmpDir,
    );
    const declaredReason = "empty-scope probe: docs-only, covered by a grep oracle";
    const archived = runLore(
      [
        "done",
        declaredSlug,
        "--override-attestation",
        "red-first-writer fixture: self-reported only",
        "--declare-no-new-tests",
        declaredReason,
      ],
      tmpDir,
    );
    expect(archived.exitCode).toBe(0);
    expect(getDoc(declaredSlug, tmpDir).status).toBe("archived");
  });
});

describe("REGRESSION — lore set gains no --red-first flag", () => {
  it("lore set --red-first exits 2 at the strict-flag seam", () => {
    const slug = createAdhocTask(tmpDir, "Set Rejection Task");

    const result = runLore(["set", slug, "--red-first", "true"], tmpDir);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Unknown option: --red-first");
  });
});
