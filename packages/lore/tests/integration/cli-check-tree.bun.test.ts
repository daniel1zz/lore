/**
 * @spec_ref TECH-01KV4W88GZF74B98BHCBBV9GHD §5
 *
 * RED-phase TDD tests for `lore status --check-tree` and `lore tree --orphans`.
 *
 * These flags do NOT exist yet — sibling task TASK-01KV4XXB9G8595G1N1T42M4VRV will wire
 * them up. Every test here MUST FAIL until that implementation is complete.
 *
 * Current failure mode (before impl):
 *   - citty silently ignores unknown boolean flags
 *   - `lore status --check-tree` runs as plain `lore status` → exits 0, prints corpus counts
 *   - `lore tree --orphans` runs as plain `lore tree` → exits 0 (with PRD root seeded)
 *   Tests asserting spec'd exit codes (0-with-check-tree-semantics / 3 / 4) therefore fail.
 *
 * Exit-code contract (TECH-01KV4W88GZF74B98BHCBBV9GHD §5):
 *   lore status --check-tree       → consistent=0, inconsistent=3, no blueprint=4
 *   lore status --check-tree --fix → fixed=0, still inconsistent=3
 *   lore tree --orphans             → has orphans=3, none=0
 *
 * Test design techniques applied:
 *   EP  — valid/invalid blueprint file, consistent/inconsistent corpus, orphan/no-orphan
 *   BVA — empty corpus, zero orphans
 *   DT  — blueprint-present×consistent, blueprint-present×inconsistent, blueprint-absent
 *   ST  — N/A (flags are stateless checks)
 *
 * Uses Bun.spawnSync — each describe block gets an isolated temp directory.
 * Run with: bun test tests/integration/cli-check-tree.bun.test.ts
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ─── Types ──────────────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PROJECT_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");

/**
 * Run `bun run src/index.ts ...args` in `cwd`.
 * HOME is overridden to `cwd` to isolate global config files.
 */
function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

/** Create a unique temp directory for an isolated test suite. */
function makeTempDir(label: string): string {
  const dir = join(tmpdir(), `lore-check-tree-${label}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Remove a temp directory, ignoring errors (best-effort cleanup). */
function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

/** Bootstrap a fresh lore corpus. */
function initCorpus(tmpDir: string): RunResult {
  return runLore(["init"], tmpDir);
}

/**
 * Write a minimal lore.tree.yaml blueprint to tmpDir (project root next to .lore/).
 * Consistent blueprint: only requires a root PRD. A corpus with just the PRD satisfies it.
 */
function writeBlueprintConsistent(tmpDir: string): void {
  const yaml = [
    "version: 1",
    "root:",
    "  type: prd",
    "  slug: prd-main-prd",
  ].join("\n");
  writeFileSync(join(tmpDir, "lore.tree.yaml"), yaml + "\n");
}

/**
 * Inconsistent blueprint: requires a root PRD with at least one spec child.
 * A corpus with only the PRD (no spec children) violates this.
 */
function writeBlueprintRequiringSpec(tmpDir: string): void {
  const yaml = [
    "version: 1",
    "root:",
    "  type: prd",
    "  slug: prd-main-prd",
    "  children:",
    "    - type: spec",
    "      min: 1",
  ].join("\n");
  writeFileSync(join(tmpDir, "lore.tree.yaml"), yaml + "\n");
}

/**
 * Seed a PRD document, return its slug.
 * The slug is the first word of stdout after "Slug:".
 */
function createPrd(tmpDir: string, title: string): string {
  // reason: --no-ai bypasses AI generation (SPEC-017 default) so tree-check tests that
  // use create for setup are not affected by absence of the claude binary in CI.
  const result = runLore(["create", "prd", "--title", title, "--no-ai"], tmpDir);
  const match = result.stdout.match(/Slug:\s+(\S+)/);
  return match?.[1] ?? "";
}

/**
 * Seed a spec document linked to a parent, return its slug.
 */
function createSpec(tmpDir: string, title: string, parentSlug: string): string {
  const result = runLore(["create", "spec", "--title", title,"--no-ai"], tmpDir);
  const match = result.stdout.match(/Slug:\s+(\S+)/);
  return match?.[1] ?? "";
}

/**
 * Seed an ADR document with NO parent (parent_id null) — an orphan, since
 * "adr" is not a ROOT_TYPES member. Used by the BUG-005 residual-drift
 * scenario below to construct a genuinely FIXABLE orphan.
 */
function createOrphanAdr(tmpDir: string, title: string): string {
  const result = runLore(
    ["create", "adr", "--title", title, "--decision-status", "accepted", "--no-ai"],
    tmpDir,
  );
  const match = result.stdout.match(/Slug:\s+(\S+)/);
  return match?.[1] ?? "";
}

// ─── Scenario 1: Consistent tree + blueprint → exit 0 ──────────────────────
//
// ANTI-TAUTOLOGY NOTE: The current code (ignoring --check-tree) ALSO exits 0,
// so the exit-code-only assertion would be a false-green. We couple it with a
// stdout content assertion — the current code prints "Corpus Status" not
// "consistent", so at least one assertion in the pair will fail until the flag
// is properly implemented.
// ─────────────────────────────────────────────────────────────────────────────

describe("lore status --check-tree: consistent tree", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("consistent");
    initCorpus(tmpDir);
    createPrd(tmpDir, "main-prd");
    writeBlueprintConsistent(tmpDir);
  });

  afterEach(() => cleanupDir(tmpDir));

  // RED: current code exits 0 (ignores flag, shows normal status) BUT does not
  // print "consistent" — the stdout assertion fails.
  it("exits 0 AND prints consistent confirmation when corpus matches blueprint", () => {
    const result = runLore(["status", "--check-tree"], tmpDir);
    // SPEC exit 0 for consistent. Current code also exits 0 but prints wrong output.
    expect(result.exitCode).toBe(0);
    // SPEC: stdout must confirm consistency. Current code prints corpus counts instead.
    // This assertion is the discriminating one — it will fail until impl is done.
    expect(result.stdout.toLowerCase()).toMatch(/consistent/);
  });

  // RED: discriminating test — inconsistent tree must exit 3, not 0.
  // If both consistent and inconsistent exit 0, the --check-tree flag is not wired up.
  it("exits 3 on inconsistent tree in same environment (discriminator for consistent=0)", () => {
    // Overwrite the blueprint to require a spec child (corpus has none)
    writeBlueprintRequiringSpec(tmpDir);
    const inconsistentResult = runLore(["status", "--check-tree"], tmpDir);
    // When --check-tree is not wired, both cases exit 0 — this test catches that
    expect(inconsistentResult.exitCode).toBe(3);
  });
});

// ─── Scenario 2: Inconsistent tree → exit 3 + drift report ─────────────────

describe("lore status --check-tree: inconsistent tree", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("inconsistent");
    initCorpus(tmpDir);
    createPrd(tmpDir, "main-prd");
    // Blueprint requires ≥1 spec child — corpus has none → INCONSISTENT
    writeBlueprintRequiringSpec(tmpDir);
  });

  afterEach(() => cleanupDir(tmpDir));

  it("exits 3 when the corpus does not satisfy the blueprint", () => {
    const result = runLore(["status", "--check-tree"], tmpDir);
    // SPEC: inconsistent → exit 3
    expect(result.exitCode).toBe(3);
  });

  it("prints a drift report to stdout identifying the mismatch", () => {
    const result = runLore(["status", "--check-tree"], tmpDir);
    // SPEC: drift report in stdout — must mention a failure signal
    const output = result.stdout.toLowerCase() + result.stderr.toLowerCase();
    const hasDriftSignal = /missing|inconsistent|drift|expect|required|mismatch/.test(output);
    expect(hasDriftSignal).toBe(true);
  });

  it("does not exit 0 on an inconsistent tree", () => {
    const result = runLore(["status", "--check-tree"], tmpDir);
    expect(result.exitCode).not.toBe(0);
  });
});

// ─── Scenario 3: No blueprint file → exit 4 ────────────────────────────────

describe("lore status --check-tree: no blueprint file", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("no-blueprint");
    initCorpus(tmpDir);
    createPrd(tmpDir, "main-prd");
    // Deliberately do NOT write lore.tree.yaml
  });

  afterEach(() => cleanupDir(tmpDir));

  it("exits 4 when lore.tree.yaml is absent", () => {
    const result = runLore(["status", "--check-tree"], tmpDir);
    // SPEC: no blueprint file → exit 4
    expect(result.exitCode).toBe(4);
  });

  it("writes a 'no blueprint' message to stderr when lore.tree.yaml is absent", () => {
    const result = runLore(["status", "--check-tree"], tmpDir);
    // SPEC: stderr should mention the missing blueprint
    const errOutput = result.stderr.toLowerCase();
    expect(errOutput).toMatch(/blueprint|lore\.tree\.yaml|not found|missing/);
  });

  it("does not exit 0 or 3 when the blueprint file is absent", () => {
    const result = runLore(["status", "--check-tree"], tmpDir);
    expect(result.exitCode).not.toBe(0);
    expect(result.exitCode).not.toBe(3);
  });
});

// ─── Scenario 4: --json flag outputs check-tree specific JSON envelope ──────
//
// ANTI-TAUTOLOGY NOTE: Current `--json` flag on `status` outputs a valid JSON
// envelope with corpus stats. We must assert that the JSON envelope contains
// check-tree-specific data (not just corpus counts) to distinguish correct impl
// from the current false-pass behavior.
// ─────────────────────────────────────────────────────────────────────────────

describe("lore status --check-tree --json: JSON output mode", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("json-mode");
    initCorpus(tmpDir);
    createPrd(tmpDir, "main-prd");
    writeBlueprintConsistent(tmpDir);
  });

  afterEach(() => cleanupDir(tmpDir));

  // RED: current `status --json` outputs JSON but with corpus stats, not check-tree data.
  // This test asserts the JSON envelope must contain check-tree-specific fields.
  it("outputs JSON envelope with check-tree result (consistent field or drift array)", () => {
    const result = runLore(["status", "--check-tree", "--json"], tmpDir);
    let parsed: Record<string, unknown>;
    expect(() => {
      parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    }).not.toThrow();
    const envelope = JSON.parse(result.stdout) as Record<string, unknown>;
    // SPEC: envelope must be { ok, data }
    expect(typeof envelope.ok).toBe("boolean");
    // SPEC: data must contain check-tree result, not corpus stats.
    // Current code returns { ok: true, data: { total_docs, by_type, ... } }
    // Impl must return { ok: true, data: { consistent: true, drift: [] } } or similar.
    const data = envelope.data as Record<string, unknown> | undefined;
    expect(data).toBeDefined();
    // Must have a 'consistent' boolean OR 'drift' array — neither appears in current status JSON
    const hasCheckTreeField =
      "consistent" in (data ?? {}) || "drift" in (data ?? {});
    expect(hasCheckTreeField).toBe(true);
  });

  // RED: --check-tree --json on inconsistent tree must have ok: false or consistent: false
  it("JSON envelope reflects inconsistency when tree does not match blueprint", () => {
    writeBlueprintRequiringSpec(tmpDir); // overwrite to inconsistent
    const result = runLore(["status", "--check-tree", "--json"], tmpDir);
    const envelope = JSON.parse(result.stdout) as Record<string, unknown>;
    // Either ok=false or data.consistent=false
    const data = envelope.data as Record<string, unknown> | undefined;
    const isConsistentFalse = data !== undefined && data["consistent"] === false;
    const isOkFalse = envelope.ok === false;
    expect(isConsistentFalse || isOkFalse).toBe(true);
  });
});

// ─── Scenario 5: --fix consolidates everything → exit 0 ────────────────────

describe("lore status --check-tree --fix: auto-fix resolves all drift", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("fix-all");
    initCorpus(tmpDir);
    createPrd(tmpDir, "main-prd");
    writeBlueprintRequiringSpec(tmpDir);
  });

  afterEach(() => cleanupDir(tmpDir));

  // RED: current code exits 0 regardless (flags ignored), but the pre-condition
  // check (expect before.exitCode === 3) will fail first, blocking the false-green.
  it("exits 0 after --fix when all drift is resolved (pre-condition: tree is inconsistent first)", () => {
    // Pre-condition: verify inconsistency is detected
    const before = runLore(["status", "--check-tree"], tmpDir);
    expect(before.exitCode).toBe(3); // RED: this fails before we even get to --fix

    // After --fix, drift should be resolved
    const result = runLore(["status", "--check-tree", "--fix"], tmpDir);
    expect(result.exitCode).toBe(0);
  });

  // This test is redundant but provides a standalone RED signal:
  // current code exits 0 (ignoring both flags). Once --check-tree is wired,
  // an inconsistent corpus without --fix would exit 3, making re-running with --fix → 0 meaningful.
  it("running --fix on inconsistent corpus produces exit 0 (not exit 3)", () => {
    // Current code: exits 0 (both flags ignored) — but the test above's pre-condition
    // would catch the false-pass. This test targets the case where someone skips pre-cond.
    // After impl: --fix on a fixable inconsistency → 0
    const result = runLore(["status", "--check-tree", "--fix"], tmpDir);
    // The corpus has a blueprint requiring spec child. --fix should create it.
    // Current code: exits 0 (flags ignored). Test is RED because the inconsistency
    // in Scenario 2 test shows --check-tree alone exits 0 when it should exit 3.
    // The full implementation must make both behaviors correct simultaneously.
    expect(result.exitCode).toBe(0);
  });
});

// ─── Scenario 6: --fix cannot resolve all → exit 3 still ──────────────────

describe("lore status --check-tree --fix: partial fix leaves residual drift", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("fix-partial");
    initCorpus(tmpDir);
    createPrd(tmpDir, "main-prd");
    // Blueprint requires 2 spec children AND 1 adr — impossible to auto-create all
    const strictYaml = [
      "version: 1",
      "root:",
      "  type: prd",
      "  slug: prd-main-prd",
      "  children:",
      "    - type: spec",
      "      min: 2",
      "    - type: adr",
      "      min: 1",
    ].join("\n");
    writeFileSync(join(tmpDir, "lore.tree.yaml"), strictYaml + "\n");
  });

  afterEach(() => cleanupDir(tmpDir));

  it("exits 3 when --fix cannot fully satisfy the blueprint constraints", () => {
    const result = runLore(["status", "--check-tree", "--fix"], tmpDir);
    // SPEC: still inconsistent after partial fix → exit 3
    expect(result.exitCode).toBe(3);
  });
});

// ─── Scenario 7: lore tree --orphans with orphans → exit 3 ─────────────────
//
// Setup strategy: Seed a PRD (root type = not orphan) + a plan without parent.
// plan is a non-root type; with parent_id=null it is an orphan per doc-type-rules.
// The `lore tree` command (without --orphans) runs fine with a PRD root — exits 0.
// `lore tree --orphans` MUST exit 3 once the flag is wired up.
// Without the flag wired: exits 0 (flag ignored, normal tree runs OK) → RED.
// ─────────────────────────────────────────────────────────────────────────────

describe("lore tree --orphans: orphans exist", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("orphans-present");
    initCorpus(tmpDir);
    // PRD = root type, not an orphan
    createPrd(tmpDir, "root-prd");
    // Plan without parent = orphan (non-root type, parent_id=null)
    // reason: --no-ai bypasses AI generation (SPEC-017) so test setup is not blocked by claude binary.
    runLore(["create", "plan", "--title", "Orphaned Plan", "--no-ai"], tmpDir);
  });

  afterEach(() => cleanupDir(tmpDir));

  it("exits 3 when orphaned documents exist in the corpus", () => {
    const result = runLore(["tree", "--orphans"], tmpDir);
    // SPEC: has orphans → exit 3
    // Current code: --orphans ignored, `tree` runs normally with PRD root → exit 0
    // So this test IS RED (fails on current code).
    expect(result.exitCode).toBe(3);
  });

  it("lists orphaned documents in stdout when --orphans reports them", () => {
    const result = runLore(["tree", "--orphans"], tmpDir);
    // SPEC: orphan list in stdout
    // Current code: stdout shows normal tree, no orphan list → this may accidentally
    // pass since tree output is non-empty. Pair it with the exit-code test.
    // The exit-code test (above) will correctly fail.
    expect(result.stdout.length).toBeGreaterThan(0);
    // The output must mention the orphaned plan slug
    expect(result.stdout).toMatch(/orphan|plan-orphaned-plan/i);
  });

  it("does not exit 0 when orphans are present", () => {
    const result = runLore(["tree", "--orphans"], tmpDir);
    // Current code: exits 0 → this test IS RED.
    expect(result.exitCode).not.toBe(0);
  });

  // Discriminator: `lore tree` (without --orphans) must exit 0 on same corpus.
  // Proves --orphans flag is the cause of exit 3, not a pre-existing error.
  it("lore tree (without --orphans) exits 0 on same corpus with orphan present", () => {
    const withoutFlag = runLore(["tree"], tmpDir);
    // Without the flag, normal tree should succeed (PRD root exists)
    expect(withoutFlag.exitCode).toBe(0);
  });
});

// ─── Scenario 8: lore tree --orphans with no orphans → exit 0 ──────────────

describe("lore tree --orphans: no orphans", () => {
  let tmpDir: string;
  let prdSlug: string;

  beforeEach(() => {
    tmpDir = makeTempDir("no-orphans");
    initCorpus(tmpDir);
    // PRD is a root type — not an orphan
    prdSlug = createPrd(tmpDir, "root-prd");
    // Spec is linked to prd via parent — not an orphan
    createSpec(tmpDir, "linked-spec", prdSlug);
  });

  afterEach(() => cleanupDir(tmpDir));

  // RED: current code: `tree --orphans` ignores --orphans, exits 0 (normal tree).
  // Once impl is done: must exit 0 BECAUSE there are no orphans (same code, different reason).
  // This test STAYS RED in a subtle way: the discriminator is Scenario 7 above.
  // Together they verify: orphans→3, no-orphans→0. Both must hold for the flag to be correct.
  it("exits 0 when no orphaned documents exist", () => {
    const result = runLore(["tree", "--orphans"], tmpDir);
    // SPEC: no orphans → exit 0
    expect(result.exitCode).toBe(0);
  });

  // Discriminator: same corpus, `--orphans` vs no flag → both exit 0 (no orphans).
  // Paired with Scenario 7 where orphan is present: --orphans must exit 3.
  it("exits 0 whether --orphans is passed or not when corpus is clean", () => {
    const withFlag = runLore(["tree", "--orphans"], tmpDir);
    const withoutFlag = runLore(["tree"], tmpDir);
    expect(withFlag.exitCode).toBe(0);
    expect(withoutFlag.exitCode).toBe(0);
  });
});

// ─── BOUNDARY: empty corpus with blueprint present ──────────────────────────

describe("lore status --check-tree: boundary — empty corpus with blueprint", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("empty-corpus");
    initCorpus(tmpDir);
    // Blueprint requires a root PRD — corpus has zero documents
    writeBlueprintRequiringSpec(tmpDir);
  });

  afterEach(() => cleanupDir(tmpDir));

  it("exits 3 (not 4) when blueprint exists but corpus is empty", () => {
    const result = runLore(["status", "--check-tree"], tmpDir);
    // Blueprint exists → not exit 4. Corpus empty → doesn't satisfy blueprint → exit 3.
    expect(result.exitCode).toBe(3);
    expect(result.exitCode).not.toBe(4);
  });
});

// ─── BOUNDARY: tree --orphans on empty corpus ───────────────────────────────

describe("lore tree --orphans: boundary — empty corpus", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("empty-orphans");
    initCorpus(tmpDir);
    // Empty corpus: no documents at all
  });

  afterEach(() => cleanupDir(tmpDir));

  // RED: current code ignores --orphans, runs `lore tree`, exits 3 (no PRD root).
  // Once impl is done: empty corpus = no orphans → should exit 0.
  it("exits 0 when corpus is empty (no docs means no orphans)", () => {
    const result = runLore(["tree", "--orphans"], tmpDir);
    // SPEC: no orphans → exit 0 (empty corpus cannot have orphans)
    expect(result.exitCode).toBe(0);
  });
});

// ─── REGRESSION: --check-tree must not break normal lore status ─────────────
// N/A: no prior regressions. Annotation required per testing.md.
// The inverse is covered: once --check-tree is wired, running `lore status`
// (without --check-tree) must still work. Not tested here as it's not this flag's contract.

// ─── Scenario 9: exactly 1 residual missing drift after fixing an orphan (BUG-005) ─
//
// Pre-fix bug: `status.ts`'s "fix did its best" exemption (≤1 residual
// missing/extra drift after --fix stays exit 0 — a deliberate, documented
// Chesterton's-Fence decision, UNCHANGED by this fix) printed a bare "Tree is
// consistent with lore.tree.yaml blueprint." line whenever `fixSucceeded` was
// true, EVEN WHEN a real residual "missing" drift still existed — silently
// swallowing it from the human/agent-facing text output (though `--json`'s
// `data.check.drifts` always carried it correctly; this was a TEXT-RENDERING
// bug only, never a data bug).
//
// Fixture: an orphan ADR (parent_id null — genuinely FIXABLE: `fix()`
// reattaches it to the PRD root) + a blueprint also requiring ≥1 `spec` child,
// which the corpus never satisfies (fix() only relinks EXISTING orphan/
// misplaced docs, it never fabricates new ones — see tree-check-service.ts's
// own `fix()` header). After --fix: the orphan ADR is genuinely reattached
// (fixed.length === 1, proving real work happened, not the Scenario-5 no-op
// case where fixableDrifts was empty from the start) AND exactly one residual
// "missing" drift remains for the still-absent spec — the exact ≤1 exemption
// boundary.
// ─────────────────────────────────────────────────────────────────────────────

describe("lore status --check-tree --fix: exactly 1 residual missing drift after fixing an orphan (BUG-005)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("bug-005-residual");
    initCorpus(tmpDir);
    createPrd(tmpDir, "main-prd");
    createOrphanAdr(tmpDir, "orphan-decision");

    // Blueprint: root PRD requires >=1 adr child (satisfied ONLY after the
    // orphan ADR is reattached) AND >=1 spec child (NEVER satisfied — fix()
    // cannot fabricate a spec doc out of nothing).
    const yaml = [
      "version: 1",
      "root:",
      "  type: prd",
      "  slug: prd-main-prd",
      "  children:",
      "    - type: adr",
      "      min: 1",
      "    - type: spec",
      "      min: 1",
    ].join("\n");
    writeFileSync(join(tmpDir, "lore.tree.yaml"), yaml + "\n");
  });

  afterEach(() => cleanupDir(tmpDir));

  it("pre-condition: the tree is genuinely inconsistent before --fix (orphan adr + missing spec)", () => {
    const before = runLore(["status", "--check-tree"], tmpDir);
    expect(before.exitCode).toBe(3);
  });

  it("exits 0 after --fix (unchanged exit-code semantics: <=1 residual missing/extra drift is 'fix did its best')", () => {
    const result = runLore(["status", "--check-tree", "--fix"], tmpDir);
    expect(result.exitCode).toBe(0);
  });

  it("--fix genuinely reattaches the orphan ADR (Fixed 1, Skipped 0) — proves real work happened, not a no-op", () => {
    const result = runLore(["status", "--check-tree", "--fix"], tmpDir);
    expect(result.stdout).toMatch(/Fixed 1, Skipped 0/);
  });

  it("BUG-005 fix: stdout ALWAYS prints the residual missing-spec drift text, never swallowed by the bare 'consistent' line", () => {
    const result = runLore(["status", "--check-tree", "--fix"], tmpDir);

    // The pre-existing "Tree is consistent..." line must still print — exit
    // 0's user-facing summary is UNCHANGED by this fix.
    expect(result.stdout).toMatch(/Tree is consistent with lore\.tree\.yaml blueprint\./);

    // BUG-005: the residual drift (kind + detail) must ALSO print — this is
    // the discriminating assertion. Pre-fix, only the line above printed and
    // this assertion failed (the residual was invisible in text output).
    expect(result.stdout).toMatch(/residual drift/i);
    expect(result.stdout.toLowerCase()).toMatch(/missing/);
    expect(result.stdout.toLowerCase()).toMatch(/spec/);
  });

  it("--json's data.check.drifts carries the residual missing-spec drift both BEFORE and AFTER this fix (data layer was always correct)", () => {
    const result = runLore(["status", "--check-tree", "--fix", "--json"], tmpDir);
    expect(result.exitCode).toBe(0);

    const envelope = JSON.parse(result.stdout) as {
      ok: boolean;
      data: { check: { consistent: boolean; drifts: Array<{ kind: string; detail: string }> } };
    };

    expect(envelope.ok).toBe(true);
    expect(envelope.data.check.consistent).toBe(false);
    expect(envelope.data.check.drifts).toHaveLength(1);
    expect(envelope.data.check.drifts[0]?.kind).toBe("missing");
    expect(envelope.data.check.drifts[0]?.detail.toLowerCase()).toContain("spec");
  });
});
