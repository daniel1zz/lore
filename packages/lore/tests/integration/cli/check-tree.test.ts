// @spawns packages/lore/src/index.ts
// @reads lore.tree.yaml
/**
 * Integration tests for `lore status --check-tree` (SPEC-032 T2) — proves the
 * repo-root `lore.tree.yaml` blueprint actually arms the check-tree mechanism
 * end-to-end through the real CLI (subprocess), not just at the service layer.
 *
 * Runs the real CLI via subprocess against an isolated temp SQLite DB, mirroring
 * the pattern in tests/integration/cli/assess.test.ts. The blueprint file used
 * in each fixture's cwd is a byte-for-byte copy of the actual repo-root
 * lore.tree.yaml — NOT a hand-rolled stand-in — so a regression in the checked-in
 * file (e.g. loosening spec's `min: 1` to `min: 0`) would silently break the
 * HAPPY/BOUNDARY assertions below rather than being caught only by the unit
 * tests in tree-blueprint-armed.test.ts.
 *
 * Six dimensions:
 *   HAPPY:      conformant fixture corpus → exit 0
 *   NEGATIVE:   n/a at CLI level (create/link hard-gate parent-type violations
 *               before they ever reach the store — see AC-2.NEG in
 *               tree-blueprint-armed.test.ts for the service-level oracle that
 *               proves misplaced docs ARE caught once they exist)
 *   BOUNDARY:   prd with zero specs (min:1 unmet) → `missing` drift, exit 3
 *   ERROR:      lore.tree.yaml absent from cwd → exit 4, no crash
 *   STATE:      --json envelope shape matches TreeReport (consistent + drifts[])
 *   REGRESSION: --check-tree on a corpus that's ALREADY conformant twice in a
 *               row still exits 0 (check-only path has no side effects)
 *
 * @spec_ref AC-2 (SPEC-032 T2)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdirSync, rmSync, copyFileSync, existsSync } from "fs";
import { patchLoreConfig } from "../../helpers/patch-lore-config.js";
import { makeCleanTreeRepo } from "../../helpers/clean-tree-repo.js";
import { join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { templatedFieldsArgs } from "../../helpers/templated-create.js";

// ─── Path setup ───────────────────────────────────────────────────────────────

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const REPO_ROOT = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "..",
);
const REPO_BLUEPRINT_PATH = join(REPO_ROOT, "lore.tree.yaml");

// ─── RunResult type ───────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Spawn `bun run <INDEX_TS> ...args` in `cwd` with an isolated HOME dir.
 * MOCK RISK: none — spawns the real CLI. `CLAUDECODE=1` puts the surface into
 * "agent" mode (AI default off) so fixture creation via `lore create` never
 * triggers an AI call; `status --check-tree` itself is not AI-intent.
 */
function runLore(args: string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: {
      ...process.env,
      HOME: cwd,
      EDITOR: "true",
      CLAUDECODE: "1",
    },
    encoding: "utf8",
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

/**
 * Disables all four `lore gate` service-layer checkpoints for this fixture's corpus
 * (retro follow-up item 8 test-fallout reconciliation — GateEnforcer is now wired ON
 * by default in every production `createApp`, which every subprocess-spawned `lore`
 * command in this file goes through). None of this file's ACs exercise spec-create/
 * spec-promote/plan-promote/task-claim gating — its fixtures use placeholder content
 * ("body") purely to populate a tree shape for `lore status --check-tree` to walk.
 * Mirrors the config shape `tests/integration/gate-config-disable.bun.test.ts`
 * establishes (`workflow.gates.<checkpoint>.enabled`, `@lore/core::resolveGateEnabled`).
 */
function disableAllGates(dir: string): void {
  patchLoreConfig(
    dir,
    [
      "workflow:",
      "  gates:",
      "    spec-create:",
      "      enabled: false",
      "    spec-promote:",
      "      enabled: false",
      "    plan-promote:",
      "      enabled: false",
      "    task-claim:",
      "      enabled: false",
      // reason: `lore set <task> --status approved` compiles the task's done contract at a commit (AC-DCS1-1), which needs these commands
      "  done_contract:",
      '    install: "echo install-ok"',
      '    typecheck: "echo typecheck-ok"',
      '    test_file: "echo Ran 1 tests in {file}"',
      "",
    ].join("\n"),
  );
}

// ─── Fixture helpers ──────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `lore-check-tree-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  // reason: approving a task compiles its done contract at a commit of the repository, so the corpus lives in one (main, one commit)
  makeCleanTreeRepo(tmpDir);

  const init = runLore(["init"], tmpDir);
  if (init.exitCode !== 0) {
    throw new Error(`lore init failed: ${init.stderr}`);
  }
  disableAllGates(tmpDir);
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore cleanup errors */
  }
});

/** Copy the ACTUAL repo-root lore.tree.yaml into the fixture's cwd. */
function armBlueprint(): void {
  expect(existsSync(REPO_BLUEPRINT_PATH)).toBe(true);
  copyFileSync(REPO_BLUEPRINT_PATH, join(tmpDir, "lore.tree.yaml"));
}

function createDoc(type: string, extraArgs: string[]): string {
  // The template kind rides on the flag that selects it: spec `--kind`, knowledge `--sub-type`.
  const kindFlag = type === "knowledge" ? "--sub-type" : type === "spec" ? "--kind" : undefined;
  const kind = kindFlag === undefined ? undefined : extraArgs[extraArgs.indexOf(kindFlag) + 1];
  const r = runLore(
    ["create", type, "--title", `${type} fixture`, "--no-ai", ...templatedFieldsArgs(type, { kind }), ...(type === "task" ? ["--kind", "code"] : []), ...extraArgs],
    tmpDir,
  );
  if (r.exitCode !== 0) throw new Error(`create ${type} failed: ${r.stderr}`);
  const m = r.stdout.match(/Slug:\s+(\S+)/);
  const slug = m?.[1];
  if (!slug) throw new Error(`Could not extract ${type} slug from: ${r.stdout}`);
  return slug;
}

/** Build a minimally-conformant corpus: prd -> spec (satisfies the spec min:1 slot). */
function buildConformantCorpus(): { prd: string; spec: string } {
  const prd = createDoc("prd", []);
  const spec = createDoc("spec", ["--kind", "feature"]);
  return { prd, spec };
}

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("lore status --check-tree — HAPPY", () => {
  it("AC-2.CLI.H1: minimal conformant corpus (prd + one spec) exits 0", () => {
    armBlueprint();
    buildConformantCorpus();

    const result = runLore(["status", "--check-tree"], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("consistent");
  });

  it("AC-2.CLI.H2: deeply-nested conformant corpus (prd/spec/plan/task/knowledge/adr) exits 0 — different shape than H1 (defeats a hardcoded exit(0))", () => {
    armBlueprint();
    const { spec } = buildConformantCorpus();
    const plan = createDoc("plan", ["--parent", spec]);
    createDoc("task", ["--parent", plan, "--plan-id", plan]);
    createDoc("knowledge", ["--parent", plan, "--sub-type", "retro"]);
    const adr = createDoc("adr", ["--parent", spec, "--decision-status", "accepted"]);
    createDoc("knowledge", ["--parent", adr, "--sub-type", "reference"]);

    const result = runLore(["status", "--check-tree"], tmpDir);
    expect(result.exitCode).toBe(0);
  });
});

// ─── BOUNDARY (missing) ─────────────────────────────────────────────────────

describe("lore status --check-tree — BOUNDARY (missing)", () => {
  it("AC-2.CLI.B1: prd with ZERO specs → non-zero exit, `missing` drift reported", () => {
    armBlueprint();
    createDoc("prd", []); // no spec created — spec's min:1 slot is unmet

    const result = runLore(["status", "--check-tree"], tmpDir);
    expect(result.exitCode).toBe(3);
    expect(result.stdout).toContain("missing");
  });

  it("AC-2.CLI.B2: --json envelope on the missing-spec corpus reports drifts[0].kind === 'missing' and type 'spec'", () => {
    armBlueprint();
    createDoc("prd", []);

    const result = runLore(["status", "--check-tree", "--json"], tmpDir);
    expect(result.exitCode).toBe(3);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.consistent).toBe(false);
    const missing = parsed.data.drifts.filter((d: { kind: string }) => d.kind === "missing");
    expect(missing.length).toBeGreaterThanOrEqual(1);
    expect(missing[0].expected.type).toBe("spec");
    expect(missing[0].expected.min).toBe(1);
  });
});

// ─── ERROR ───────────────────────────────────────────────────────────────────

describe("lore status --check-tree — ERROR (blueprint absent)", () => {
  it("AC-2.CLI.E1: no lore.tree.yaml in cwd → exit 4, no crash", () => {
    // Deliberately do NOT call armBlueprint().
    createDoc("prd", []);

    const result = runLore(["status", "--check-tree"], tmpDir);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("lore.tree.yaml");
  });
});

// ─── STATE ───────────────────────────────────────────────────────────────────

describe("lore status --check-tree — STATE (--json shape)", () => {
  it("AC-2.CLI.S1: --json on a consistent corpus reports { consistent: true, drifts: [] }", () => {
    armBlueprint();
    buildConformantCorpus();

    const result = runLore(["status", "--check-tree", "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.consistent).toBe(true);
    expect(parsed.data.drifts).toEqual([]);
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("lore status --check-tree — REGRESSION (check-only has no side effects)", () => {
  it("AC-2.CLI.R1: running --check-tree twice in a row on a conformant corpus exits 0 both times", () => {
    armBlueprint();
    buildConformantCorpus();

    const first = runLore(["status", "--check-tree"], tmpDir);
    const second = runLore(["status", "--check-tree"], tmpDir);
    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
  });
});

// ─── PLAN-TERMINALITY (AC-CLOSURE-2, spec-plan-closure-must-be-loud-terminality-divergence-silent DD-1) ──
//
// `lore verify` marked AC-CLOSURE-2 INCONCLUSIVE because its oracle command
// (`bunx vitest run check-tree.test.ts -t "plan-terminality"`) matched ZERO
// tests — the detector's unit behavior was covered (tree-check-service.bun.test.ts)
// but the CLI-surface contract this AC actually asserts was not. These two
// scenarios are that missing CLI-surface coverage.

/**
 * Build a corpus with a plan-terminality drift: prd -> spec -> plan -> task,
 * where the task is archived (`draft -> archived` is a sanctioned direct edge
 * for `task` docs — DRAFT_TO_ARCHIVED_ALLOWED_TYPES, packages/core/src/schemas.ts)
 * but the plan itself is left in `draft` — every child task terminal, the plan
 * is not. Mirrors the deeply-nested shape AC-2.CLI.H2 already exercises.
 */
function buildPlanTerminalityDriftCorpus(): { plan: string; task: string } {
  const { spec } = buildConformantCorpus();
  const plan = createDoc("plan", ["--parent", spec]);
  const task = createDoc("task", ["--parent", plan, "--plan-id", plan]);

  // reason: DCL-1 (b) — `set --status archived` now applies the `lore done` floors, and a non-git fixture corpus
  // can never hold a state-bound attested pass. `deprecated` is the other terminal status (same plan-terminality
  // reading) and is not floor-gated, so the fixture reaches "every child task terminal" through it.
  for (const status of ["approved", "deprecated"]) {
    const stepResult = runLore(["set", task, "--status", status], tmpDir);
    if (stepResult.exitCode !== 0) {
      throw new Error(`making fixture task terminal failed at ${status}: ${stepResult.stderr}`);
    }
  }

  return { plan, task };
}

/** Read a doc's `status`/`version` via `lore get <id> --json`. */
function getDocStatusAndVersion(idOrSlug: string): { status: string; version: number } {
  const r = runLore(["get", idOrSlug, "--json"], tmpDir);
  if (r.exitCode !== 0) throw new Error(`get ${idOrSlug} failed: ${r.stderr}`);
  const parsed = JSON.parse(r.stdout);
  return { status: parsed.data.doc.status, version: parsed.data.doc.version };
}

describe("lore status --check-tree — plan-terminality drift", () => {
  it("AC-CLOSURE-2.plan-terminality.check: nonzero exit, output names the plan slug AND the literal remediation command", () => {
    armBlueprint();
    const { plan } = buildPlanTerminalityDriftCorpus();

    const result = runLore(["status", "--check-tree"], tmpDir);

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toContain(plan);
    expect(result.stdout).toContain(`lore set ${plan} --status archived`);
  });

  it("AC-CLOSURE-2.plan-terminality.fix: --fix still reports the drift afterwards and leaves the plan doc's status and version unchanged (Invariant 1 — --fix must never fire plan-close)", () => {
    armBlueprint();
    const { plan } = buildPlanTerminalityDriftCorpus();

    const before = getDocStatusAndVersion(plan);

    const result = runLore(["status", "--check-tree", "--fix"], tmpDir);

    // The drift must still be reported after --fix — plan-terminality is
    // deliberately excluded from the fixable-kind filter (tree-check-service.ts
    // fix()) because auto-transitioning a plan would fire the plan-close
    // governance gate from inside a repair command.
    expect(result.stdout).toContain("plan-terminality");
    expect(result.stdout).toContain(plan);

    const after = getDocStatusAndVersion(plan);
    expect(after.status).toBe(before.status);
    expect(after.version).toBe(before.version);
  });
});
