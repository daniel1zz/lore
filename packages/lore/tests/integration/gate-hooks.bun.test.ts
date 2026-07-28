/**
 * @spec_ref IoC vertical-slice tech-spec §4.1/§11 — Claude Code PreToolUse hook bridge for
 * `lore gate spec-create` / `lore gate spec-promote` (`hooks/g1-spec-create.sh` +
 * `hooks/g2-spec-promote.sh`).
 *
 * bun test (not vitest): every scenario spawns the real shim scripts (`Bun.spawnSync`) with a
 * mocked PreToolUse hook payload piped to stdin, against a throwaway corpus (mkdtemp'd temp
 * dir + `dist/lore init`), mirroring `gate-spec-create.bun.test.ts`'s harness. ⛔ Never touches
 * the repo's own `.lore/` corpus (project CLAUDE.md hard rule).
 *
 * Scenarios under test:
 *   G1 — Bash `lore create spec` with no parent → shim denies, reason carries `[source:`.
 *   G1 — Bash `lore create spec` fully compliant → shim allows.
 *   G1 — unrelated Bash command → allowed (fail-open scope: not a spec-creation call).
 *   G2 — Bash `lore approve <spec-with-no-AC>` → shim denies.
 *   G2 — unrelated Bash command → allowed.
 *   G3 — MCP `lore_approve` / `lore_set` on a plan whose ancestor spec is unapproved →
 *        shim denies (adversarial-review FIX 2: MCP is the SPEC-024 DEFAULT agent
 *        surface, so g3 must gate it exactly like the Bash `lore approve`/`lore set
 *        --status` shapes — a Bash-only shim would let an MCP-driven agent bypass
 *        plan-promote entirely).
 *   G3 — MCP `lore_approve` on the same plan once its ancestor spec is approved with
 *        ≥1 declared AC → shim allows.
 *   G3 — MCP `lore_set` without a `status` field, or targeting a non-plan doc → out of
 *        scope, allowed.
 *   Parse/gate anomalies (malformed stdin, missing binary) → allow, never throw.
 *   `.claude/settings.json` parses as valid JSON, retains `env.CLAUDE_AC_TRACE_BYPASS`, and
 *   declares both PreToolUse hook entries (including the new MCP `lore_approve`/`lore_set`
 *   matchers wired to g2 + g3).
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 */

import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { assertFreshBinary } from "./helpers/assert-fresh-binary";
import { saveConfig } from "@lore/core/node";

// ─── Paths ──────────────────────────────────────────────────────────────────

// tests/integration/ → packages/lore/ → packages/ → repo root (4 levels up).
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");
const G1_SHIM = join(REPO_ROOT, "hooks", "g1-spec-create.sh");
const G2_SHIM = join(REPO_ROOT, "hooks", "g2-spec-promote.sh");
const G3_SHIM = join(REPO_ROOT, "hooks", "g3-plan-promote.sh");
const SEED_SCRIPT = join(REPO_ROOT, "scripts", "seed-write-spec-rule.ts");
const SETTINGS_JSON = join(REPO_ROOT, ".claude", "settings.json");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

interface HookPayload {
  readonly tool_name: string;
  readonly tool_input: Record<string, unknown>;
  readonly cwd: string;
  readonly hook_event_name?: string;
}

/** Run the compiled `dist/lore` binary directly (mirrors what the shims themselves invoke). */
function runLore(args: string[], cwd: string, extraEnv: Record<string, string> = {}): RunResult {
  const proc = Bun.spawnSync([LORE_BIN, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, ...extraEnv },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

/** Spawn a shim script with a mocked hook payload piped to stdin. */
function runShim(
  shimPath: string,
  payload: HookPayload,
  extraEnv: Record<string, string> = {},
): RunResult {
  const proc = Bun.spawnSync([shimPath], {
    stdin: Buffer.from(JSON.stringify(payload)),
    env: { ...process.env, HOME: payload.cwd, CLAUDE_PROJECT_DIR: REPO_ROOT, ...extraEnv },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

function makeTempDir(label: string): string {
  const dir = join(
    tmpdir(),
    `lore-gate-hooks-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

function initCorpus(tmpDir: string): void {
  const result = runLore(["init"], tmpDir);
  if (result.exitCode !== 0) {
    throw new Error(`lore init failed: ${result.stderr}`);
  }
}

function seedRuleDoc(tmpDir: string): void {
  const proc = Bun.spawnSync(["bun", "run", SEED_SCRIPT], {
    cwd: tmpDir,
    env: { ...process.env, HOME: tmpDir },
  });
  if (proc.exitCode !== 0) {
    throw new Error(`seed-write-spec-rule failed: ${proc.stderr.toString()}`);
  }
}

function createPrd(tmpDir: string, title: string): string {
  const result = runLore(["create", "prd", "--title", title, "--no-ai"], tmpDir);
  const match = result.stdout.match(/Slug:\s+(\S+)/);
  const slug = match?.[1];
  if (slug === undefined) {
    throw new Error(`could not parse PRD slug from create output: ${result.stdout}`);
  }
  return slug;
}

const COMPLIANT_CONTENT =
  "## Overview\n\nSome text.\n\n## Scope\n\nIn scope.\n\n## Acceptance Criteria\n\n- AC1\n";

/** Create a compliant spec (legal parent, spec_kind, skeleton) and return its slug. */
function createSpec(tmpDir: string, parentSlug: string, title: string): string {
  const result = runLore(
    [
      "create",
      "spec",
      "--title",
      title,
      "--parent",
      parentSlug,
      "--kind",
      "tech",
      "--content",
      COMPLIANT_CONTENT,
      "--no-ai",
    ],
    tmpDir,
  );
  const match = result.stdout.match(/Slug:\s+(\S+)/);
  const slug = match?.[1];
  if (slug === undefined) {
    throw new Error(`could not parse spec slug from create output: ${result.stdout}`);
  }
  return slug;
}

function addAcceptanceCriterion(tmpDir: string, specSlug: string, id: string): void {
  const result = runLore(
    ["ac", "add", specSlug, id, "--statement", "It works.", "--mode", "human"],
    tmpDir,
  );
  if (result.exitCode !== 0) {
    throw new Error(`ac add failed: ${result.stderr}`);
  }
}

/** Create a plan parented under `parentSlug` (a spec or PRD) and return its slug. */
function createPlan(tmpDir: string, parentSlug: string, title: string): string {
  const result = runLore(
    ["create", "plan", "--title", title, "--parent", parentSlug, "--content", "Plan body.", "--no-ai"],
    tmpDir,
  );
  const match = result.stdout.match(/Slug:\s+(\S+)/);
  const slug = match?.[1];
  if (slug === undefined) {
    throw new Error(`could not parse plan slug from create output: ${result.stdout}`);
  }
  return slug;
}

/** Fast-tracks a doc from draft straight to approved via the real CLI (not the shim). */
function approveViaCli(tmpDir: string, idOrSlug: string): void {
  const result = runLore(["approve", idOrSlug], tmpDir);
  if (result.exitCode !== 0) {
    throw new Error(`approve failed: ${result.stderr}`);
  }
}

function parseHookOutput(stdout: string): { permissionDecision: string; permissionDecisionReason?: string } {
  const parsed = JSON.parse(stdout.trim()) as {
    hookSpecificOutput: { permissionDecision: string; permissionDecisionReason?: string };
  };
  return parsed.hookSpecificOutput;
}

// ─── Suite: binaries exist AND are fresh ────────────────────────────────────

// Fails loud (throws) if dist/lore is missing OR older than the newest .ts source under
// packages/{lore,core}/src — this suite spawns the COMPILED binary directly via `runLore`
// (and the shim scripts under test invoke it too), so a stale artifact would otherwise let
// the test silently validate old logic against new source. Computed once for the whole
// suite, not per-test.
beforeAll(() => {
  assertFreshBinary(LORE_BIN, [
    join(REPO_ROOT, "packages", "lore", "src"),
    join(REPO_ROOT, "packages", "core", "src"),
  ]);
});

// ─── Suite: G1 (spec-create) ────────────────────────────────────────────────

describe("hooks/g1-spec-create.sh", () => {
  let tmpDir: string;
  let prdSlug: string;

  beforeAll(() => {
    tmpDir = makeTempDir("g1");
    initCorpus(tmpDir);
    seedRuleDoc(tmpDir);
    prdSlug = createPrd(tmpDir, "g1-prd");
  });

  afterAll(() => cleanupDir(tmpDir));

  // NEGATIVE — non-compliant Bash spec-create (no parent) → deny with feeding pack.
  it("denies a non-compliant `lore create spec` Bash command, reason carries [source:", () => {
    const result = runShim(G1_SHIM, {
      tool_name: "Bash",
      tool_input: { command: `${LORE_BIN} create spec --title "Bad Spec"` },
      cwd: tmpDir,
    });
    expect(result.exitCode).toBe(0); // the shim itself always exits 0 — verdict is in the JSON
    const hook = parseHookOutput(result.stdout);
    expect(hook.permissionDecision).toBe("deny");
    expect(hook.permissionDecisionReason ?? "").toContain("[source:");
    expect(hook.permissionDecisionReason ?? "").toContain("PARENT_REQUIRED");
  });

  // HAPPY — fully compliant Bash spec-create → allow.
  it("allows a compliant `lore create spec` Bash command", () => {
    const command =
      `${LORE_BIN} create spec --title "Good Spec" --parent ${prdSlug} --kind tech ` +
      `--content "${COMPLIANT_CONTENT.replace(/\n/g, "\\n")}"`;
    const result = runShim(G1_SHIM, {
      tool_name: "Bash",
      tool_input: { command },
      cwd: tmpDir,
    });
    const hook = parseHookOutput(result.stdout);
    expect(hook.permissionDecision).toBe("allow");
  });

  // NEGATIVE — non-compliant MCP lore_create call (type=spec) → deny.
  it("denies a non-compliant MCP lore_create call for type=spec", () => {
    const result = runShim(G1_SHIM, {
      tool_name: "mcp__lore__lore_create",
      tool_input: { type: "spec", title: "MCP bad spec", content: "no headings at all" },
      cwd: tmpDir,
    });
    const hook = parseHookOutput(result.stdout);
    expect(hook.permissionDecision).toBe("deny");
    expect(hook.permissionDecisionReason ?? "").toContain("MISSING_SKELETON");
  });

  // NEGATIVE — MCP lore_create call for a non-spec type → out of scope, allow untouched.
  it("allows an MCP lore_create call whose type is not spec", () => {
    const result = runShim(G1_SHIM, {
      tool_name: "mcp__lore__lore_create",
      tool_input: { type: "knowledge", title: "Some note", extra: { sub_type: "reference" } },
      cwd: tmpDir,
    });
    const hook = parseHookOutput(result.stdout);
    expect(hook.permissionDecision).toBe("allow");
  });

  // BOUNDARY / fail-open scope — unrelated Bash command → allow without any gate invocation.
  it("allows an unrelated Bash command (fail-open scope: not a spec-creation call)", () => {
    const result = runShim(G1_SHIM, {
      tool_name: "Bash",
      tool_input: { command: "ls -la" },
      cwd: tmpDir,
    });
    const hook = parseHookOutput(result.stdout);
    expect(hook.permissionDecision).toBe("allow");
  });

  // STATE — LORE_GATE_BYPASS=1 short-circuits even a non-compliant candidate.
  it("STATE: LORE_GATE_BYPASS=1 allows even a non-compliant candidate", () => {
    const result = runShim(
      G1_SHIM,
      {
        tool_name: "Bash",
        tool_input: { command: `${LORE_BIN} create spec --title "Bad Spec"` },
        cwd: tmpDir,
      },
      { LORE_GATE_BYPASS: "1" },
    );
    const hook = parseHookOutput(result.stdout);
    expect(hook.permissionDecision).toBe("allow");
  });

  // ERROR — malformed stdin JSON → fail open, never throws / never crashes.
  it("ERROR: malformed stdin JSON fails open (allow) without throwing", () => {
    const proc = Bun.spawnSync([G1_SHIM], {
      stdin: Buffer.from("{not valid json"),
      env: { ...process.env, CLAUDE_PROJECT_DIR: REPO_ROOT },
    });
    expect(proc.exitCode).toBe(0);
    const hook = parseHookOutput(proc.stdout.toString());
    expect(hook.permissionDecision).toBe("allow");
  });

  // ERROR — missing/non-executable lore binary → fail open.
  it("ERROR: missing lore binary fails open (allow) without throwing", () => {
    const bogusRoot = makeTempDir("g1-no-binary");
    try {
      const result = runShim(
        G1_SHIM,
        {
          tool_name: "Bash",
          tool_input: { command: `${LORE_BIN} create spec --title "Bad Spec"` },
          cwd: tmpDir,
        },
        { CLAUDE_PROJECT_DIR: bogusRoot },
      );
      expect(result.exitCode).toBe(0);
      const hook = parseHookOutput(result.stdout);
      expect(hook.permissionDecision).toBe("allow");
    } finally {
      cleanupDir(bogusRoot);
    }
  });

  // REGRESSION — the shim is read-only: it must never create/mutate corpus documents.
  it("REGRESSION: never creates any corpus documents, allow or deny path", () => {
    const before = runLore(["status", "--json"], tmpDir);
    const beforeTotal = (JSON.parse(before.stdout) as { data: { total_docs: number } }).data
      .total_docs;

    runShim(G1_SHIM, {
      tool_name: "Bash",
      tool_input: { command: `${LORE_BIN} create spec --title "Bad Spec"` },
      cwd: tmpDir,
    });
    runShim(G1_SHIM, {
      tool_name: "Bash",
      tool_input: {
        command: `${LORE_BIN} create spec --title "Good Spec 2" --parent ${prdSlug} --kind tech --content "${COMPLIANT_CONTENT.replace(/\n/g, "\\n")}"`,
      },
      cwd: tmpDir,
    });

    const after = runLore(["status", "--json"], tmpDir);
    const afterTotal = (JSON.parse(after.stdout) as { data: { total_docs: number } }).data
      .total_docs;
    expect(afterTotal).toBe(beforeTotal);
  });
});

// ─── Suite: G2 (spec-promote) ───────────────────────────────────────────────

describe("hooks/g2-spec-promote.sh", () => {
  let tmpDir: string;
  let prdSlug: string;
  let noAcSpecSlug: string;
  let withAcSpecSlug: string;

  beforeAll(() => {
    tmpDir = makeTempDir("g2");
    initCorpus(tmpDir);
    prdSlug = createPrd(tmpDir, "g2-prd");
    noAcSpecSlug = createSpec(tmpDir, prdSlug, "No AC Spec");
    withAcSpecSlug = createSpec(tmpDir, prdSlug, "With AC Spec");
    addAcceptanceCriterion(tmpDir, withAcSpecSlug, "AC-1");
  });

  afterAll(() => cleanupDir(tmpDir));

  // NEGATIVE — approving a spec with 0 declared ACs → deny. REGRESSION pin
  // (task-gate-hook-denies-the-whole-chained-bash-command-when-any AC2): a
  // single-command deny must stay byte-identical to the raw `lore gate
  // spec-promote` output — no chain-block banner prefix — since there is no
  // chain to explain.
  it("denies `lore approve <spec-with-no-AC>` — single-command deny is byte-identical to the raw gate output", () => {
    const rawGate = runLore(["gate", "spec-promote", "--spec", noAcSpecSlug], tmpDir);
    const result = runShim(G2_SHIM, {
      tool_name: "Bash",
      tool_input: { command: `${LORE_BIN} approve ${noAcSpecSlug}` },
      cwd: tmpDir,
    });
    const hook = parseHookOutput(result.stdout);
    expect(hook.permissionDecision).toBe("deny");
    expect(hook.permissionDecisionReason ?? "").toContain("no structured acceptance criteria");
    expect(hook.permissionDecisionReason).toBe(rawGate.stderr.trim());
    expect(hook.permissionDecisionReason ?? "").not.toContain("CHAINED COMMAND BLOCKED");
  });

  // NEGATIVE / BOUNDARY — chained `A && B` where only B (`lore approve`) matches
  // this checkpoint's armed trigger (task-gate-hook-denies-the-whole-chained-bash-
  // command-when-any AC1): PreToolUse hooks are all-or-nothing per Bash tool call,
  // so denying B necessarily blocks the WHOLE command including A, which never
  // executes. Before this fix, the deny reason described only B's gate verdict —
  // a caller reasonably (and wrongly) concluded A itself had failed (observed
  // live 2026-07-25: three wasted round-trips + a false "gate non-determinism"
  // hypothesis). The deny reason must now START with a banner naming B verbatim
  // and stating the whole chain — including A, named — was blocked because A did
  // not run; the feeding pack (gate verdict) follows after.
  it("CHAIN: denies a chained `A && B` command with a banner naming B verbatim and stating A did not run", () => {
    const segmentA = `${LORE_BIN} set ${noAcSpecSlug} --content-file /tmp/does-not-matter.md`;
    const segmentB = `${LORE_BIN} approve ${noAcSpecSlug}`;
    const result = runShim(G2_SHIM, {
      tool_name: "Bash",
      tool_input: { command: `${segmentA} && ${segmentB}` },
      cwd: tmpDir,
    });
    const hook = parseHookOutput(result.stdout);
    expect(hook.permissionDecision).toBe("deny");
    const reason = hook.permissionDecisionReason ?? "";
    expect(reason.startsWith("⛔ CHAINED COMMAND BLOCKED")).toBe(true);
    expect(reason).toContain(segmentB);
    expect(reason).toContain(segmentA);
    expect(reason).toContain("did NOT run");
    expect(reason).toContain("no structured acceptance criteria"); // feeding pack still follows
  });

  // BOUNDARY — chained command where NO segment matches this checkpoint's trigger
  // (task-gate-hook-denies-the-whole-chained-bash-command-when-any AC3): allowed,
  // no gate invocation, no banner — regression pin for the multi-segment fail-open
  // path (single-segment fail-open is covered by the "unrelated Bash command" test
  // below).
  it("CHAIN: allows a chained command where no segment matches (regression)", () => {
    const result = runShim(G2_SHIM, {
      tool_name: "Bash",
      tool_input: { command: "git status && ls -la" },
      cwd: tmpDir,
    });
    const hook = parseHookOutput(result.stdout);
    expect(hook.permissionDecision).toBe("allow");
  });

  // HAPPY — approving a spec with ≥1 declared AC → allow.
  it("allows `lore approve <spec-with-AC>`", () => {
    const result = runShim(G2_SHIM, {
      tool_name: "Bash",
      tool_input: { command: `${LORE_BIN} approve ${withAcSpecSlug}` },
      cwd: tmpDir,
    });
    const hook = parseHookOutput(result.stdout);
    expect(hook.permissionDecision).toBe("allow");
  });

  // NEGATIVE — `lore set <spec> --status approved` on a 0-AC spec → deny.
  it("denies `lore set <spec-with-no-AC> --status approved`", () => {
    const result = runShim(G2_SHIM, {
      tool_name: "Bash",
      tool_input: { command: `${LORE_BIN} set ${noAcSpecSlug} --status approved` },
      cwd: tmpDir,
    });
    const hook = parseHookOutput(result.stdout);
    expect(hook.permissionDecision).toBe("deny");
  });

  // BOUNDARY — approving a non-spec doc (PRD) → out of scope, allow (no false-positive block).
  it("allows `lore approve <prd>` — non-spec docs are out of this gate's scope", () => {
    const result = runShim(G2_SHIM, {
      tool_name: "Bash",
      tool_input: { command: `${LORE_BIN} approve ${prdSlug}` },
      cwd: tmpDir,
    });
    const hook = parseHookOutput(result.stdout);
    expect(hook.permissionDecision).toBe("allow");
  });

  // BOUNDARY / fail-open scope — unrelated Bash command → allow.
  it("allows an unrelated Bash command", () => {
    const result = runShim(G2_SHIM, {
      tool_name: "Bash",
      tool_input: { command: "git status" },
      cwd: tmpDir,
    });
    const hook = parseHookOutput(result.stdout);
    expect(hook.permissionDecision).toBe("allow");
  });

  // STATE — LORE_GATE_BYPASS=1 short-circuits a 0-AC spec approve.
  it("STATE: LORE_GATE_BYPASS=1 allows approving a 0-AC spec", () => {
    const result = runShim(
      G2_SHIM,
      {
        tool_name: "Bash",
        tool_input: { command: `${LORE_BIN} approve ${noAcSpecSlug}` },
        cwd: tmpDir,
      },
      { LORE_GATE_BYPASS: "1" },
    );
    const hook = parseHookOutput(result.stdout);
    expect(hook.permissionDecision).toBe("allow");
  });

  // ERROR — malformed stdin JSON → fail open, never throws.
  it("ERROR: malformed stdin JSON fails open (allow) without throwing", () => {
    const proc = Bun.spawnSync([G2_SHIM], {
      stdin: Buffer.from("not json at all {{{"),
      env: { ...process.env, CLAUDE_PROJECT_DIR: REPO_ROOT },
    });
    expect(proc.exitCode).toBe(0);
    const hook = parseHookOutput(proc.stdout.toString());
    expect(hook.permissionDecision).toBe("allow");
  });

  // ERROR — approve targeting a doc id that does not resolve → fail open (lore get fails).
  it("ERROR: unresolvable doc id fails open (allow)", () => {
    const result = runShim(G2_SHIM, {
      tool_name: "Bash",
      tool_input: { command: `${LORE_BIN} approve does-not-exist-slug` },
      cwd: tmpDir,
    });
    const hook = parseHookOutput(result.stdout);
    expect(hook.permissionDecision).toBe("allow");
  });

  // REGRESSION — the shim is read-only: it must never mutate the target doc's status.
  it("REGRESSION: never changes doc status, allow or deny path", () => {
    const before = runLore(["get", noAcSpecSlug, "--json"], tmpDir);
    const beforeStatus = (JSON.parse(before.stdout) as { data: { doc: { status: string } } }).data
      .doc.status;

    runShim(G2_SHIM, {
      tool_name: "Bash",
      tool_input: { command: `${LORE_BIN} approve ${noAcSpecSlug}` },
      cwd: tmpDir,
    });

    const after = runLore(["get", noAcSpecSlug, "--json"], tmpDir);
    const afterStatus = (JSON.parse(after.stdout) as { data: { doc: { status: string } } }).data
      .doc.status;
    expect(afterStatus).toBe(beforeStatus);
  });
});

// ─── Suite: G3 (plan-promote) — adversarial-review FIX 2 (MCP bypass) ───────

describe("hooks/g3-plan-promote.sh", () => {
  let tmpDir: string;
  let prdSlug: string;
  let specSlug: string;
  let planSlug: string;

  beforeAll(() => {
    tmpDir = makeTempDir("g3");
    initCorpus(tmpDir);
    // SPEC-103 §Mechanisms M2 — `review-judgment` is a SEPARATE, ADDITIVE checkpoint on
    // `ReviewService.approve` for spec/adr docs (default `judgment_required_types:
    // ["spec","adr"]`) this fixture predates. This block's HAPPY/REGRESSION cases below
    // approve `specSlug` via the real CLI (`approveViaCli`) purely to exercise g3's OWN
    // concern (plan-promote gating on ancestor-spec approval), so disable M2 here —
    // mirrors `gate-spec-promote.bun.test.ts`'s `judgment_required_types: []` precedent.
    saveConfig(tmpDir, {
      project: { name: "gate-hooks-g3-test", author: "tester" },
      workflow: { review: { judgment_required_types: [] } },
    } as never);
    prdSlug = createPrd(tmpDir, "g3-prd");
    specSlug = createSpec(tmpDir, prdSlug, "G3 Target Spec");
    planSlug = createPlan(tmpDir, specSlug, "G3 Plan");
  });

  afterAll(() => cleanupDir(tmpDir));

  // NEGATIVE — MCP lore_approve on a plan whose ancestor spec is still draft → deny.
  // This is the exact gap FIX 2 closes: before the fix, g3 only had a "Bash" matcher
  // and `[ "$TOOL_NAME" != "Bash" ]` short-circuited every MCP call straight to allow.
  it("MCP: denies lore_approve on a plan whose ancestor spec is draft (unapproved)", () => {
    const result = runShim(G3_SHIM, {
      tool_name: "mcp__lore__lore_approve",
      tool_input: { id_or_slug: planSlug },
      cwd: tmpDir,
    });
    const hook = parseHookOutput(result.stdout);
    expect(hook.permissionDecision).toBe("deny");
    expect(hook.permissionDecisionReason ?? "").toContain("UPSTREAM_NOT_APPROVED");
  });

  // NEGATIVE — MCP lore_set with status=approved on the same plan → deny (mirrors the
  // Bash `--status (in-review|approved)` filter).
  it("MCP: denies lore_set with status=approved on a plan whose ancestor spec is draft", () => {
    const result = runShim(G3_SHIM, {
      tool_name: "mcp__lore__lore_set",
      tool_input: { id_or_slug: planSlug, status: "approved" },
      cwd: tmpDir,
    });
    const hook = parseHookOutput(result.stdout);
    expect(hook.permissionDecision).toBe("deny");
  });

  // BOUNDARY — MCP lore_set with no `status` field at all → out of scope (not a
  // status-changing call), allowed without invoking the gate.
  it("MCP: allows lore_set on the same plan when status is omitted (not a status-changing call)", () => {
    const result = runShim(G3_SHIM, {
      tool_name: "mcp__lore__lore_set",
      tool_input: { id_or_slug: planSlug, title: "Renamed via MCP" },
      cwd: tmpDir,
    });
    const hook = parseHookOutput(result.stdout);
    expect(hook.permissionDecision).toBe("allow");
  });

  // BOUNDARY — MCP lore_approve targeting a non-plan doc (the spec itself) → out of
  // scope, allowed (mirrors the Bash doc-type pre-check).
  it("MCP: allows lore_approve on a non-plan doc (the spec itself) — out of scope", () => {
    const result = runShim(G3_SHIM, {
      tool_name: "mcp__lore__lore_approve",
      tool_input: { id_or_slug: specSlug },
      cwd: tmpDir,
    });
    const hook = parseHookOutput(result.stdout);
    expect(hook.permissionDecision).toBe("allow");
  });

  // BOUNDARY / fail-open scope — an unrelated MCP tool call → allowed.
  it("MCP: allows an unrelated MCP tool call (fail-open scope)", () => {
    const result = runShim(G3_SHIM, {
      tool_name: "mcp__lore__lore_get",
      tool_input: { id_or_slug: planSlug },
      cwd: tmpDir,
    });
    const hook = parseHookOutput(result.stdout);
    expect(hook.permissionDecision).toBe("allow");
  });

  // HAPPY — once the ancestor spec is approved with ≥1 declared AC, MCP lore_approve
  // on the plan allows. This deliberately mutates shared fixture state (approves
  // `specSlug` via the real CLI, not the shim) — every test AFTER this one in this
  // describe block runs against the now-approved spec.
  it("MCP: allows lore_approve on the plan once its ancestor spec is approved with ≥1 AC", () => {
    addAcceptanceCriterion(tmpDir, specSlug, "AC-G3-1");
    approveViaCli(tmpDir, specSlug);

    const result = runShim(G3_SHIM, {
      tool_name: "mcp__lore__lore_approve",
      tool_input: { id_or_slug: planSlug },
      cwd: tmpDir,
    });
    const hook = parseHookOutput(result.stdout);
    expect(hook.permissionDecision).toBe("allow");
  });

  // REGRESSION — the pre-existing Bash `lore approve <plan>` shape still works after
  // the MCP-branch refactor (the ancestor spec is approved+AC from the test above).
  it("Bash: still handles the pre-existing Bash `lore approve <plan>` shape after the MCP-branch refactor", () => {
    const result = runShim(G3_SHIM, {
      tool_name: "Bash",
      tool_input: { command: `${LORE_BIN} approve ${planSlug}` },
      cwd: tmpDir,
    });
    const hook = parseHookOutput(result.stdout);
    expect(hook.permissionDecision).toBe("allow");
  });
});

// ─── Suite: .claude/settings.json wiring ────────────────────────────────────

describe(".claude/settings.json PreToolUse hook wiring", () => {
  it("parses as valid JSON, keeps env.CLAUDE_AC_TRACE_BYPASS, and declares both hooks", () => {
    const raw = readFileSync(SETTINGS_JSON, "utf-8");
    const settings = JSON.parse(raw) as {
      env?: Record<string, string>;
      hooks?: { PreToolUse?: Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }> };
    };

    expect(settings.env?.["CLAUDE_AC_TRACE_BYPASS"]).toBe("1");

    const preToolUse = settings.hooks?.PreToolUse ?? [];
    expect(preToolUse.length).toBeGreaterThan(0);

    const allCommands = preToolUse.flatMap((entry) => entry.hooks.map((h) => h.command));
    expect(allCommands.some((c) => c.includes("g1-spec-create.sh"))).toBe(true);
    expect(allCommands.some((c) => c.includes("g2-spec-promote.sh"))).toBe(true);
    expect(allCommands.some((c) => c.includes("g3-plan-promote.sh"))).toBe(true);

    // FIX 2 (adversarial-review) — MCP lore_approve/lore_set matchers must exist and
    // must fan out to BOTH g2 and g3 (mirroring the pre-existing Bash matcher, which
    // always ran both).
    const mcpApproveEntry = preToolUse.find((entry) => entry.matcher.includes("lore_approve"));
    const mcpSetEntry = preToolUse.find(
      (entry) => entry.matcher.includes("lore_set") && !entry.matcher.includes("lore_settings"),
    );
    expect(mcpApproveEntry).toBeDefined();
    expect(mcpSetEntry).toBeDefined();
    const approveCommands = mcpApproveEntry?.hooks.map((h) => h.command) ?? [];
    const setCommands = mcpSetEntry?.hooks.map((h) => h.command) ?? [];
    expect(approveCommands.some((c) => c.includes("g2-spec-promote.sh"))).toBe(true);
    expect(approveCommands.some((c) => c.includes("g3-plan-promote.sh"))).toBe(true);
    expect(setCommands.some((c) => c.includes("g2-spec-promote.sh"))).toBe(true);
    expect(setCommands.some((c) => c.includes("g3-plan-promote.sh"))).toBe(true);
  });
});
