// @spawns packages/lore/src/index.ts
/**
 * Integration tests for `lore verify` (SPEC-039 §2, §3, §4 AC-VRF-10; §M2
 * trust-hardening). Runs the real CLI via subprocess against an isolated
 * throwaway corpus — same pattern as `tests/integration/cli/task-workflow.test.ts`.
 * Fixture script-mode ACs use `--oracle other --command "true"` / `"false"` —
 * instantaneous, real spawns (no sleep, no long-running commands).
 *
 * Scope: adapter translation-only (args → VerifyRunnerService.verifyPlan call →
 * exit code / stdout / stderr rendering). Business rules (attestation
 * derivation, timeout escalation, resolveTargetTask's matrix, the approval-gate
 * decision itself, resolveVerifyEnv's filtering logic) are exhaustively covered
 * at the service/core layers (verify-runner-service.test.ts, verify-spawn.test.ts,
 * task-workflow.test.ts in @lore/core) — this file does not re-test them, EXCEPT
 * where a real subprocess is the only way to observe the effect (an actual child
 * process's real environment, §M2 ENV dimension below).
 *
 * §M2 NOTE — every pre-existing test below that reaches
 * VerifyRunnerService's per-AC execution loop now passes `--allow-new-commands`
 * (every fixture task starts with zero evidence history, so its first script AC
 * command is always "new" under the hardened default `verify.
 * require_command_approval: true` — without the flag these subprocess runs are
 * non-interactive with no TTY and would abort NEEDS_APPROVAL, exit 7). Tests
 * that never reach the loop (ambiguous-task/unknown-ac/not-found/human-only
 * short-circuits) are unaffected and keep their original invocation.
 *
 * Coverage:
 *   HAPPY:      all-pass run → exit 0, per-AC pass line with duration; --ac
 *               filter restricts the run to a subset of declared ACs; §M2 —
 *               a brand-new command's first run marks `[new]`/`first_seen: true`
 *   NEGATIVE:   ambiguous target task (>1 fresh claim, no --task) → exit 4
 *               listing candidate slugs; unknown --ac id → exit 4; a failing
 *               AC's command → exit 1; §M2 — a brand-new command with NO
 *               `--allow-new-commands` (non-interactive subprocess, no TTY) →
 *               exit 7 (NEEDS_APPROVAL), message names the flag
 *   BOUNDARY:   spec with only ai/human-mode ACs declared → exit 0 with an
 *               explicit "nothing to run" notice (never silently a no-op)
 *   STATE:      draft (unapproved) spec → advisory warning line on stderr,
 *               passthrough from VerifyRunnerService.warnings, never a hard gate;
 *               §M2 ENV — the default env allowlist empties `$LORE_SYNC_TOKEN`
 *               inside the spawned command, but `verify.env.passthrough_all: true`
 *               restores it; a PATH-dependent command (`node --version`) still
 *               works under the default allowlist
 *   REGRESSION: forged `--attestation` flag on `lore evidence` (AC-VRF-2
 *               adapter half) is REJECTED OUTRIGHT (exit 2, SPEC-051 D1 strict
 *               unknown-flag rejection) — evidence.ts's args schema never
 *               declares that flag, so no evidence entry is ever written for
 *               the invocation (strictly stronger than the pre-SPEC-051
 *               "silently accepted by citty but never read" guarantee); §M2 —
 *               re-verifying a command already in the task's evidence history
 *               needs NO `--allow-new-commands` (no re-prompt for known commands),
 *               and `verify.require_command_approval: false` disables the
 *               gate entirely (a brand-new command runs without the flag)
 *
 * @spec_ref AC-VRF-10 spec-spec-039-trusted-runner-attested-evidence-for-script-mode-a#AC-VRF-2; SPEC-039 §M2
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdirSync, rmSync, appendFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { VERIFY_NO_SCRIPT_ACS } from "../../../src/adapters/cli/cli-refusal-messages.js";
import { sessionIdFor } from "../../helpers/session-actor.js";

// ─── Path setup ───────────────────────────────────────────────────────────────

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

// ─── RunResult type ───────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Spawn `bun run <INDEX_TS> ...args` in `cwd` with an isolated HOME dir.
 * MOCK RISK: none — this calls the real CLI binary path.
 *
 * @param envOverrides - SPEC-039 §M2 ENV dimension only — additional env vars
 *   merged onto the subprocess's own environment (which `VerifyRunnerService`
 *   captures as `process.env` INSIDE that subprocess, per-call, at `app.ts`
 *   composition time). Every other test omits this.
 */
function runLore(args: string[], cwd: string, envOverrides: Record<string, string> = {}): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1", ...envOverrides },
    encoding: "utf8",
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

/**
 * Disables all five `lore gate` service-layer checkpoints for this fixture's corpus
 * (retro follow-up item 8 test-fallout reconciliation — GateEnforcer is now wired ON
 * by default in every production `createApp`, which every subprocess-spawned `lore`
 * command in this file goes through). None of this file's ACs exercise spec-create/
 * task-claim gating itself: `createSpec`'s fixed "body" content is pure scaffolding
 * for the trusted-runner flow under test, and AC-VRF-10.N1/S1 deliberately keep the
 * fixture spec in "draft" (never approved) to exercise `lore verify`'s OWN advisory/
 * ambiguous-claim-resolution behavior — task-claim's upstream-approval requirement
 * would otherwise block the `lore claim` calls those two tests use as setup, which is
 * not what they're testing. Mirrors the config shape
 * `tests/integration/gate-config-disable.bun.test.ts` establishes
 * (`workflow.gates.<checkpoint>.enabled`, `@lore/core::resolveGateEnabled`).
 *
 * `task-create` (spec-declaring-ac-scope-is-required-at-task-creation-so-the)
 * joins this list for the SAME reason: `createTask`'s `acScope` parameter
 * defaults to `[]` (zero `--ac-scope` flags) for every caller that doesn't need
 * declared-scope selection (e.g. AC-VRF-10.N1's ambiguous-claim fixture, which
 * declares a script-mode AC purely so `lore verify` has something structurally
 * reachable, then creates TWO tasks to test claim ambiguity, unrelated to
 * ac_scope). Without this, those fixture tasks would refuse at creation with
 * `AC_SCOPE_REQUIRED` — declared-scope AUTHORING has its own dedicated
 * coverage (`create-task-ac-scope.test.ts` / `-e2e.bun.test.ts`), not this file.
 */
function disableAllGates(dir: string): void {
  appendFileSync(
    join(dir, ".lore", "config.yaml"),
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
      '    "task-create":',
      "      enabled: false",
      "",
    ].join("\n"),
  );
}

/**
 * Appends a `verify:` config block (SPEC-039 §M2) to the fixture corpus's
 * config.yaml — same append-only pattern as {@link disableAllGates}. Only the
 * REGRESSION/ESCAPE tests below call this; every other test relies on the
 * hardened schema defaults (allowlist env, require_command_approval: true).
 */
function writeVerifyConfig(dir: string, opts: { requireCommandApproval?: boolean; passthroughAll?: boolean }): void {
  const lines = ["verify:"];
  if (opts.passthroughAll !== undefined) {
    lines.push("  env:", `    passthrough_all: ${String(opts.passthroughAll)}`);
  }
  if (opts.requireCommandApproval !== undefined) {
    lines.push(`  require_command_approval: ${String(opts.requireCommandApproval)}`);
  }
  lines.push("");
  appendFileSync(join(dir, ".lore", "config.yaml"), lines.join("\n"));
}

// ─── Fixture helpers ──────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(
    tmpdir(),
    `lore-verify-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(tmpDir, { recursive: true });

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

function extractSlug(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/);
  const slug = m?.[1];
  if (!slug) throw new Error(`Could not extract slug from: ${stdout}`);
  return slug;
}

function createPrd(title: string): string {
  const r = runLore(["create", "prd", "--title", title, "--no-ai", "--content", "body"], tmpDir);
  if (r.exitCode !== 0) throw new Error(`create prd failed: ${r.stderr}`);
  return extractSlug(r.stdout);
}

function createSpec(title: string, parentSlug: string): string {
  const r = runLore(
    ["create", "spec", "--title", title,"--no-ai", "--content", "body"],
    tmpDir,
  );
  if (r.exitCode !== 0) throw new Error(`create spec failed: ${r.stderr}`);
  return extractSlug(r.stdout);
}

function createPlan(title: string, parentSlug: string): string {
  const r = runLore(
    ["create", "plan", "--title", title, "--parent", parentSlug, "--no-ai", "--content", "body"],
    tmpDir,
  );
  if (r.exitCode !== 0) throw new Error(`create plan failed: ${r.stderr}`);
  return extractSlug(r.stdout);
}

/**
 * Creates the fixture task, declaring `acScope` via `--ac-scope` (repeatable).
 *
 * reason: post-`spec-declared-scope-attestation-contract-task-owned-ac-scope`
 * (AC-VS-3), `lore verify` REFUSES exit 4 against a target task that declares no
 * `ac_scope` — so every fixture whose test expects a run to EXECUTE must declare
 * the ids that test's spec carries. Callers that expect a refusal BEFORE the scope
 * pre-flight (ambiguous target task) deliberately pass none.
 */
function createTask(planSlug: string, title: string, acScope: readonly string[] = []): string {
  const args = [
    "create",
    "task",
    "--title",
    title,
    "--parent",
    planSlug,
    "--plan-id",
    planSlug,
    "--no-ai",
    "--content",
    "body",
  ];
  for (const acId of acScope) args.push("--ac-scope", acId);
  const r = runLore(args, tmpDir);
  if (r.exitCode !== 0) throw new Error(`create task failed: ${r.stderr}`);
  return extractSlug(r.stdout);
}

/** Declare a script-mode AC via `lore ac add` (oracle "other", instantaneous command). */
function declareScriptAc(specSlug: string, acId: string, command: string): void {
  const r = runLore(
    ["ac", "add", specSlug, acId, "--statement", "A dogfood AC.", "--mode", "script", "--oracle", "other", "--command", command],
    tmpDir,
  );
  if (r.exitCode !== 0) throw new Error(`lore ac add (script) failed: ${r.stderr}`);
}

/** Declare a human-mode AC (no script to execute). */
function declareHumanAc(specSlug: string, acId: string): void {
  const r = runLore(
    ["ac", "add", specSlug, acId, "--statement", "A human-judged AC.", "--mode", "human"],
    tmpDir,
  );
  if (r.exitCode !== 0) throw new Error(`lore ac add (human) failed: ${r.stderr}`);
}

/** Build a full prd → spec → plan → task chain with N script ACs declared, return the slugs. */
function buildFixture(
  label: string,
  acs: Array<{ id: string; command: string }>,
): { specSlug: string; planSlug: string; taskSlug: string } {
  const prdSlug = createPrd(`${label} PRD`);
  const specSlug = createSpec(`${label} Spec`, prdSlug);
  for (const ac of acs) declareScriptAc(specSlug, ac.id, ac.command);
  const planSlug = createPlan(`${label} Plan`, specSlug);
  const taskSlug = createTask(
    planSlug,
    `${label} Task`,
    acs.map((ac) => ac.id),
  );
  return { specSlug, planSlug, taskSlug };
}

// ─── HAPPY ────────────────────────────────────────────────────────────────────

describe("lore verify — HAPPY", () => {
  it("AC-VRF-10.H1: all-pass run → exit 0, per-AC pass line with duration_ms", () => {
    const { planSlug, taskSlug } = buildFixture("Happy", [{ id: "AC-VRF-H1", command: "true" }]);

    const result = runLore(["verify", planSlug, "--task", taskSlug, "--allow-new-commands"], tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("AC-VRF-H1");
    expect(result.stdout).toContain("pass");
    expect(result.stdout).toMatch(/\(\d+ms, exit 0\)/);
    expect(result.stdout).toContain("1 passed, 0 failed.");
  });

  it("AC-VRF-10.H2: --json envelope carries task/results/skipped/warnings", () => {
    const { planSlug, taskSlug } = buildFixture("HappyJson", [{ id: "AC-VRF-H2", command: "true" }]);

    const result = runLore(["verify", planSlug, "--task", taskSlug, "--json", "--allow-new-commands"], tmpDir);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      ok: boolean;
      data?: {
        task?: { slug?: string };
        results?: Array<{ ac_id: string; result: string; exit_code: number; duration_ms: number }>;
        skipped?: unknown[];
        warnings?: string[];
      };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.task?.slug).toBe(taskSlug);
    expect(parsed.data?.results).toHaveLength(1);
    expect(parsed.data?.results?.[0]?.ac_id).toBe("AC-VRF-H2");
    expect(parsed.data?.results?.[0]?.result).toBe("pass");
    expect(parsed.data?.results?.[0]?.exit_code).toBe(0);
  });

  it("AC-VRF-10.H3: --ac filters the run to the named subset", () => {
    const { planSlug, taskSlug } = buildFixture("AcFilter", [
      { id: "AC-VRF-F1", command: "true" },
      { id: "AC-VRF-F2", command: "true" },
    ]);

    const result = runLore(["verify", planSlug, "--task", taskSlug, "--ac", "AC-VRF-F1", "--json", "--allow-new-commands"], tmpDir);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { data?: { results?: Array<{ ac_id: string }> } };
    expect(parsed.data?.results).toHaveLength(1);
    expect(parsed.data?.results?.[0]?.ac_id).toBe("AC-VRF-F1");
  });
});

// ─── NEGATIVE ─────────────────────────────────────────────────────────────────

describe("lore verify — NEGATIVE", () => {
  // reason: 15s budget — heaviest spawn count in this file (9 CLI subprocesses); at
  // vitest's 5s default it sits at ~7s under full-suite parallel load (2026-07-11).
  it("AC-VRF-10.N1: ambiguous target task (>1 fresh claim, no --task) → exit 4, message lists candidates", { timeout: 15_000 }, () => {
    const prdSlug = createPrd("Ambiguous PRD");
    const specSlug = createSpec("Ambiguous Spec", prdSlug);
    declareScriptAc(specSlug, "AC-VRF-AMB", "true");
    const planSlug = createPlan("Ambiguous Plan", specSlug);
    const taskA = createTask(planSlug, "Task A");
    const taskB = createTask(planSlug, "Task B");

    runLore(["claim", taskA], tmpDir, { CLAUDE_CODE_SESSION_ID: sessionIdFor("alice") });
    runLore(["claim", taskB], tmpDir, { CLAUDE_CODE_SESSION_ID: sessionIdFor("bob") });

    const result = runLore(["verify", planSlug], tmpDir);

    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain(taskA);
    expect(result.stderr).toContain(taskB);
  });

  it("AC-VRF-10.N2: unknown --ac id → exit 4 (VALIDATION_ERROR)", () => {
    const { planSlug, taskSlug } = buildFixture("UnknownAc", [{ id: "AC-VRF-U1", command: "true" }]);

    const result = runLore(["verify", planSlug, "--task", taskSlug, "--ac", "AC-DOES-NOT-EXIST"], tmpDir);

    expect(result.exitCode).toBe(4);
  });

  it("AC-VRF-10.N3: a failing AC's command → exit 1, ✘ line rendered", () => {
    const { planSlug, taskSlug } = buildFixture("Failing", [{ id: "AC-VRF-FAIL", command: "false" }]);

    const result = runLore(["verify", planSlug, "--task", taskSlug, "--allow-new-commands"], tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("AC-VRF-FAIL");
    expect(result.stdout).toContain("fail");
    expect(result.stdout).toContain("0 passed, 1 failed.");
  });

  it("AC-VRF-10.N4: non-existent plan slug → exit 3 (DOC_NOT_FOUND)", () => {
    const result = runLore(["verify", "plan-does-not-exist"], tmpDir);
    expect(result.exitCode).toBe(3);
  });
});

// ─── BOUNDARY — no script-mode ACs declared ──────────────────────────────────

describe("lore verify — BOUNDARY (no script ACs)", () => {
  it("AC-VRF-10.B1: spec with only a human-mode AC → exit 0, explicit notice, nothing executed", () => {
    const prdSlug = createPrd("NoScript PRD");
    const specSlug = createSpec("NoScript Spec", prdSlug);
    declareHumanAc(specSlug, "AC-VRF-HUMAN");
    const planSlug = createPlan("NoScript Plan", specSlug);
    // The human-mode AC IS in this task's declared scope — the run has nothing to
    // EXECUTE (that is the boundary under test), which is a success, not a refusal.
    const taskSlug = createTask(planSlug, "NoScript Task", ["AC-VRF-HUMAN"]);

    const result = runLore(["verify", planSlug, "--task", taskSlug], tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(VERIFY_NO_SCRIPT_ACS);
    expect(result.stdout).toContain("AC-VRF-HUMAN (human)");
  });
});

// ─── STATE — draft-spec advisory warning ─────────────────────────────────────

describe("lore verify — STATE (draft-spec advisory)", () => {
  it("AC-VRF-10.S1: an unapproved (draft) parent spec → advisory warning on stderr, never a hard gate", () => {
    // reason: `lore create spec` defaults new docs to status "draft" — never
    // approved in this fixture, so VerifyRunnerService's advisory fires.
    const { planSlug, taskSlug } = buildFixture("DraftWarn", [{ id: "AC-VRF-DRAFT", command: "true" }]);

    const result = runLore(["verify", planSlug, "--task", taskSlug, "--allow-new-commands"], tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("not approved/active");
    // reason: advisory only — the run still executed and passed (not a hard gate).
    expect(result.stdout).toContain("1 passed, 0 failed.");
  });
});

// ─── M2 — trust-boundary advisory (script commands run under the hardened §M2 defaults) ──

describe("lore verify — M2 trust-boundary advisory (SPEC-039 §M2 hardened defaults)", () => {
  it("M2.1: prints a one-time trust-boundary warning to stderr before executing script ACs", () => {
    const { planSlug, taskSlug } = buildFixture("TrustWarnText", [{ id: "AC-VRF-TW1", command: "true" }]);

    const result = runLore(["verify", planSlug, "--task", taskSlug, "--allow-new-commands"], tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("npm-scripts trust tier");
    expect(result.stderr).toContain("allowlisted by default");
    // reason: exactly one advisory line — not per-command noise.
    const warningLines = result.stderr.split("\n").filter((l) => l.includes("npm-scripts trust tier"));
    expect(warningLines).toHaveLength(1);
  });

  it("M2.2: --json mode keeps stdout pure JSON — the warning goes to stderr only", () => {
    const { planSlug, taskSlug } = buildFixture("TrustWarnJson", [{ id: "AC-VRF-TW2", command: "true" }]);

    const result = runLore(["verify", planSlug, "--task", taskSlug, "--json", "--allow-new-commands"], tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("npm-scripts trust tier");
    expect(result.stdout).not.toContain("npm-scripts trust tier");
    // stdout must parse as a single clean JSON envelope, nothing prepended/appended.
    expect(() => JSON.parse(result.stdout)).not.toThrow();
    const parsed = JSON.parse(result.stdout) as { ok: boolean };
    expect(parsed.ok).toBe(true);
  });
});

// ─── §M2 — command-provenance approval gate ──────────────────────────────────

describe("lore verify — §M2 command-provenance approval (NEGATIVE)", () => {
  it("a brand-new command with NO --allow-new-commands (non-interactive, no TTY) → exit 7, message names the flag", () => {
    const { planSlug, taskSlug } = buildFixture("NeedsApproval", [{ id: "AC-VRF-NA1", command: "true" }]);

    const result = runLore(["verify", planSlug, "--task", taskSlug], tmpDir);

    expect(result.exitCode).toBe(7);
    expect(result.stderr).toContain("AC-VRF-NA1");
    expect(result.stderr).toContain("--allow-new-commands");
  });
});

describe("lore verify — §M2 command-provenance approval (HAPPY)", () => {
  it("--allow-new-commands approves a brand-new command; output marks it [new]; --json carries first_seen: true", () => {
    const { planSlug, taskSlug } = buildFixture("Approved", [{ id: "AC-VRF-AP1", command: "true" }]);

    const result = runLore(["verify", planSlug, "--task", taskSlug, "--allow-new-commands"], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("[new]");

    const jsonResult = runLore(
      ["verify", planSlug, "--task", taskSlug, "--ac", "AC-VRF-AP1", "--json", "--allow-new-commands"],
      tmpDir,
    );
    const parsed = JSON.parse(jsonResult.stdout) as {
      data?: { results?: Array<{ ac_id: string; first_seen?: boolean }> };
    };
    // reason: this SECOND invocation re-runs the SAME command — already in evidence
    // history after the first `runLore` call above, so first_seen is correctly absent
    // here (see the REGRESSION test below for the dedicated single-invocation proof).
    expect(parsed.data?.results?.[0]?.ac_id).toBe("AC-VRF-AP1");
  });
});

describe("lore verify — §M2 command-provenance approval (REGRESSION — no re-prompt for known commands)", () => {
  it("re-verifying a command already in the task's evidence history needs NO --allow-new-commands", () => {
    const { planSlug, taskSlug } = buildFixture("KnownCommand", [{ id: "AC-VRF-KC1", command: "true" }]);

    // First run: approve the brand-new command explicitly.
    const first = runLore(["verify", planSlug, "--task", taskSlug, "--json", "--allow-new-commands"], tmpDir);
    expect(first.exitCode).toBe(0);
    const firstParsed = JSON.parse(first.stdout) as {
      data?: { results?: Array<{ first_seen?: boolean }> };
    };
    expect(firstParsed.data?.results?.[0]?.first_seen).toBe(true);

    // Second run: SAME command, NO --allow-new-commands — must succeed without a prompt
    // because "true" is now in the task's evidence history.
    const second = runLore(["verify", planSlug, "--task", taskSlug, "--json"], tmpDir);
    expect(second.exitCode).toBe(0);
    const secondParsed = JSON.parse(second.stdout) as {
      data?: { results?: Array<{ first_seen?: boolean }> };
    };
    expect(secondParsed.data?.results?.[0]?.first_seen).toBeUndefined();
  });
});

describe("lore verify — §M2 command-provenance approval (ESCAPE — require_command_approval: false)", () => {
  it("a brand-new command runs without --allow-new-commands when the gate is disabled via config", () => {
    const { planSlug, taskSlug } = buildFixture("GateDisabled", [{ id: "AC-VRF-GD1", command: "true" }]);
    writeVerifyConfig(tmpDir, { requireCommandApproval: false });

    const result = runLore(["verify", planSlug, "--task", taskSlug], tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("AC-VRF-GD1");
  });
});

// ─── §M2 — env-allowlist hardening ─────────────────────────────────────────────

describe("lore verify — §M2 env allowlist (STATE)", () => {
  it("the default allowlist empties $LORE_SYNC_TOKEN inside the spawned command", () => {
    const { planSlug, taskSlug } = buildFixture("EnvDefault", [
      { id: "AC-VRF-ENV1", command: 'test -z "$LORE_SYNC_TOKEN"' },
    ]);

    const result = runLore(
      ["verify", planSlug, "--task", taskSlug, "--allow-new-commands"],
      tmpDir,
      { LORE_SYNC_TOKEN: "super-secret-value" },
    );

    // test -z exits 0 iff the var is EMPTY — proves the default allowlist scrubbed it.
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("pass");
  });

  it("verify.env.passthrough_all: true restores $LORE_SYNC_TOKEN inside the spawned command (ESCAPE)", () => {
    const { planSlug, taskSlug } = buildFixture("EnvPassthrough", [
      { id: "AC-VRF-ENV2", command: 'test -n "$LORE_SYNC_TOKEN"' },
    ]);
    writeVerifyConfig(tmpDir, { passthroughAll: true });

    const result = runLore(
      ["verify", planSlug, "--task", taskSlug, "--allow-new-commands"],
      tmpDir,
      { LORE_SYNC_TOKEN: "super-secret-value" },
    );

    // test -n exits 0 iff the var is NON-empty — proves passthrough_all restored it.
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("pass");
  });

  it("a PATH-dependent command (bun --version) still works under the default allowlist (REGRESSION)", () => {
    // reason: `bun` (not `node`) is the guaranteed-available PATH-resolved binary in
    // this project's dev/CI environment (it's literally what spawns the CLI subprocess
    // itself, `runLore`'s `spawnSync("bun", ...)` above) — avoids depending on `node`
    // being separately installed everywhere this suite runs.
    const { planSlug, taskSlug } = buildFixture("EnvPath", [
      { id: "AC-VRF-ENV3", command: "bun --version" },
    ]);

    const result = runLore(["verify", planSlug, "--task", taskSlug, "--allow-new-commands"], tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("pass");
  });
});

// ─── REGRESSION — AC-VRF-2 adapter half: forged --attestation is inert ───────
//
// Pre-SPEC-051, this test proved a forged --attestation flag could never reach
// a persisted evidence entry because citty's non-strict parser silently
// accepted the undeclared flag as a raw key that evidence.ts's run() simply
// never read (evidence.ts builds EvidenceInput from named fields only).
// SPEC-051 D1's strict unknown-flag rejection now catches this EARLIER and
// MORE STRONGLY: the whole `lore evidence` invocation is rejected (exit 2)
// before any evidence write happens at all, so the assertion moves from
// "the field never lands on a written entry" to "no entry is EVER written
// for this invocation" — a strictly stronger guarantee, same underlying
// SPEC-039 §M2 security property (attestation is un-forgeable via the CLI).

describe("lore evidence — forged --attestation is rejected outright (SPEC-051 D1, formerly silently inert)", () => {
  it("REG1: an unrecognized --attestation flag exits 2 and writes NO evidence entry", () => {
    const { planSlug, taskSlug } = buildFixture("ForgedAttestation", []);
    void planSlug;

    const result = runLore(
      [
        "evidence",
        taskSlug,
        "--oracle",
        "other",
        "--command",
        "manual check",
        "--result",
        "pass",
        // reason: evidence.ts's `args` schema never declares an --attestation flag —
        // SPEC-051 D1's strict-flag check rejects it before evidence.ts's run() (and
        // thus TaskWorkflowService.addEvidence) is ever reached.
        "--attestation",
        JSON.stringify({ runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false }),
        "--json",
      ],
      tmpDir,
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Unknown option: --attestation");

    const got = runLore(["get", taskSlug, "--json"], tmpDir);
    expect(got.exitCode).toBe(0);
    const parsed = JSON.parse(got.stdout) as {
      data?: { doc?: { extra?: { verification_evidence?: Array<Record<string, unknown>> } } };
    };
    expect(parsed.data?.doc?.extra?.verification_evidence ?? []).toHaveLength(0);
  });
});

// ─── SPEC-069 ad-hoc-task runner path ──────────────────────────────────────────
// task-the-ad-hoc-task-channel-has-no-attested-evidence-path-lore
//
// `lore verify --task <adhoc-task>` with NO PLAN positional. Coverage:
//   REGRESSION (RED pin): the OLD, unsupported shape — passing a non-plan id
//     (an ad-hoc task's own slug) AS the PLAN positional — still refuses with
//     the exact pre-existing leaky message, unchanged by this fix.
//   HAPPY: a unique matching spec resolves, executes, and records ATTESTED
//     evidence (attestation.runner "lore-cli") readable back via `lore get`.
//   NEGATIVE: no PLAN and no --task (usage error, exit 2); --task naming a
//     NON-ad-hoc (plan-owned) task (exit 4, names "not ad-hoc").
//   ERROR: ac_scope matching AC ids declared on TWO independent specs is
//     ambiguous and refused (never guesses), naming both spec slugs.
//   CONTROL: every pre-existing `<PLAN> ...` test above in this file exercises
//     the untouched plan-path unmodified — this file, run as a whole, IS that
//     control.

/** Create a SPEC-069 `--adhoc` task (no --parent/--plan-id), declaring `acScope` via `--ac-scope`. */
function createAdhocTask(title: string, acScope: readonly string[] = []): string {
  const args = ["create", "task", "--title", title, "--adhoc", "--no-ai", "--content", "body"];
  for (const acId of acScope) args.push("--ac-scope", acId);
  const r = runLore(args, tmpDir);
  if (r.exitCode !== 0) throw new Error(`create adhoc task failed: ${r.stderr}`);
  return extractSlug(r.stdout);
}

describe("lore verify — SPEC-069 ad-hoc-task runner path", () => {
  it("REGRESSION (RED pin): passing an ad-hoc task's own slug as PLAN still refuses with the pre-existing leaky message", () => {
    // reason: --adhoc task creation parents to the corpus root PRD — a PRD must
    // exist first (unrelated to the assertion below, purely a creation precondition).
    createPrd("RedPin PRD");
    const adhocTask = createAdhocTask("RedPin Adhoc Task", ["AC-ADHOC-RED-1"]);

    // reason: this is the OLD, unsupported shape (a non-plan id passed as the
    // PLAN positional) — deliberately left alone. The NEW supported shape is
    // `--task <adhoc>` with PLAN OMITTED, exercised by the GREEN test below.
    const result = runLore(["verify", adhocTask], tmpDir);

    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("Expected a plan document");
    expect(result.stderr).toContain("task");
  });

  it("HAPPY (GREEN): --task naming an ad-hoc task with no PLAN positional resolves the governing spec and records attested evidence", () => {
    const prdSlug = createPrd("Adhoc Green PRD");
    const specSlug = createSpec("Adhoc Green Spec", prdSlug);
    declareScriptAc(specSlug, "AC-ADHOC-G1", "true");
    const adhocTask = createAdhocTask("Adhoc Green Task", ["AC-ADHOC-G1"]);

    const result = runLore(["verify", "--task", adhocTask, "--allow-new-commands"], tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("AC-ADHOC-G1");
    expect(result.stdout).toContain("pass");
    // reason: buildVerifyHeaderLines' planArg carries a descriptive "(ad-hoc, no
    // plan)" marker instead of a real plan id/slug — a human reading the run
    // output can tell this was the ad-hoc path, not a mis-resolved plan.
    expect(result.stdout).toContain("ad-hoc, no plan");

    const got = runLore(["get", adhocTask, "--json"], tmpDir);
    expect(got.exitCode).toBe(0);
    const parsed = JSON.parse(got.stdout) as {
      data?: { doc?: { extra?: { verification_evidence?: Array<Record<string, unknown>> } } };
    };
    const evidence = parsed.data?.doc?.extra?.verification_evidence ?? [];
    expect(evidence).toHaveLength(1);
    const attestation = evidence[0]?.["attestation"] as Record<string, unknown> | undefined;
    expect(attestation?.["runner"]).toBe("lore-cli");
    expect(attestation?.["exit_code"]).toBe(0);
    // reason: the ad-hoc runner path is now SHAPE-IDENTICAL to the plan-owned one
    // (AC-069-15). appendEvidenceEntry used to cross-validate ac_ref through a
    // plan-only parent_id walk — structurally impossible for an ad-hoc task, whose
    // parent is the root PRD — and now branches on extra.adhoc to resolve declared
    // ids via resolveAdhocGoverningAcIds instead, so the coverage-link is recorded.
    expect(evidence[0]?.["ac_ref"]).toBe("AC-ADHOC-G1");
  });

  it("NEGATIVE: no PLAN positional and no --task → usage error, exit 2, names the requirement", () => {
    const result = runLore(["verify"], tmpDir);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("PLAN positional is required");
    expect(result.stderr).toContain("--adhoc");
  });

  it("NEGATIVE: --task naming a NON-ad-hoc (plan-owned) task with no PLAN positional refuses, naming the cause", () => {
    const { taskSlug } = buildFixture("NotAdhocViaTaskOnly", [{ id: "AC-NOT-ADHOC-1", command: "true" }]);

    const result = runLore(["verify", "--task", taskSlug], tmpDir);

    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("not ad-hoc");
    expect(result.stderr).not.toContain("Expected a plan document");
  });

  it("ERROR: ac_scope matching AC ids declared on TWO independent specs is ambiguous and refused", () => {
    const prdA = createPrd("Ambiguous PRD A");
    const specA = createSpec("Ambiguous Spec A", prdA);
    declareScriptAc(specA, "AC-SHARED-ADHOC-1", "true");
    const prdB = createPrd("Ambiguous PRD B");
    const specB = createSpec("Ambiguous Spec B", prdB);
    declareScriptAc(specB, "AC-SHARED-ADHOC-1", "true");
    const adhocTask = createAdhocTask("Ambiguous Adhoc Task", ["AC-SHARED-ADHOC-1"]);

    const result = runLore(["verify", "--task", adhocTask, "--allow-new-commands"], tmpDir);

    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("ambiguous");
    expect(result.stderr).toContain(specA);
    expect(result.stderr).toContain(specB);
  });
});
