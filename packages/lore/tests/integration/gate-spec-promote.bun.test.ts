// @spawns packages/lore/src/index.ts
/**
 * @spec_ref IoC vertical-slice tech-spec §4.1/§11 — `lore gate spec-promote`
 * (deterministic AC-count gate + INV2 probabilistic-zone judge advisory)
 *
 * bun test (not vitest) — uses a real SQLiteStore via `createApp()`, same in-process
 * pattern as `tests/integration/cli/assess-ai.bun.test.ts`: chdir into a throwaway temp
 * corpus, import the gate command module directly, and call its `spec-promote`
 * subcommand's `run()` in the SAME process (no subprocess spawn needed for the
 * deterministic-only scenarios; a fake AI-provider shell script — the same hermetic
 * idiom `assess-ai.bun.test.ts` documents, since `InMemoryAIProvider` is not
 * config-selectable — covers the judge-advisory scenarios).
 *
 * ⛔ Never touches the repo's own `.lore/` corpus (project CLAUDE.md hard rule) — every
 * test operates inside its own `mkdtempSync` directory.
 *
 * Acceptance criteria under test (task AC3 / AC4 + task's six-dimension list):
 *   AC3 — spec with 0 declared acceptance criteria → exit 4.
 *   AC4 — spec with ≥1 declared acceptance criterion → exit 0; with a scripted AI
 *         provider, the judge advisory appears on STDERR and exit code stays 0.
 *   LORE_GATE_BYPASS=1 → exit 0 even for a 0-AC spec (STATE).
 *   Non-spec doc type / nonexistent doc → 4 / 3 respectively (ERROR/NEGATIVE).
 *   Judge unavailable (no configured provider) never flips the exit code (REGRESSION).
 *
 * Also covers the AC-Quantifiability Gate spec's CLI-preflight parity fix (task
 * `task-hook-parity-g1-g2-ai-advisory-on-review`): `lore gate spec-promote` threads
 * the spec's declared `extra.acceptance_criteria` (via `AcService.listCriteria`, the
 * same SSOT `lore ac list` reads) into the SAME `GateContext` the service-layer
 * `GateEnforcer` already lints on a draft→approved transition (`CorpusService.set` /
 * `ReviewService.approve`) — see "AC-Quantifiability Gate CLI parity" below.
 *
 * BR-1007 / issue #137 (re-baseline): the pre-flight also refuses a spec none of whose criteria
 * cites a LIVE business or architecture rule — the same refusal `approve` gives. Every scenario
 * that must PASS therefore cites a live rule (`seedLiveRule`, real CLI subprocess against this
 * file's throwaway corpus); the "pass" fixtures are otherwise unchanged. See the BR-1007 suite
 * at the end of this file for the parity assertions themselves.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loosenOverrideClasses } from "./fixtures/autonomy-override-helpers.js";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { createApp } from "../../src/app.js";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import type { App } from "../../src/app.js";
import { saveConfig } from "@lore/core/node";
import { execFileSync } from "node:child_process";
import { UNCITED_SPEC_RULE } from "../../src/service/spec-approval-citation.js";
import { ensureLiveRuleViaCli } from "../helpers/cli-live-rule.js";
import type { CreateDocInput, DocId, LoreConfig } from "@lore/core";
import { liveInvocation, liveAmbient } from "../live-invocation.js";
import type { Invocation } from "@lore/core";

// ─── Command type (mirrors assess-ai.bun.test.ts) ────────────────────────────

type RunnableCommand = { run: (ctx: { args: Record<string, unknown>; inv?: Invocation }) => Promise<void> };

async function importGateSpecPromoteCommand(): Promise<RunnableCommand> {
  const mod = await import("../../src/adapters/cli/commands/gate.js");
  const group = (mod as { default?: { subCommands?: Record<string, unknown> } }).default;
  const cmd = group?.subCommands?.["spec-promote"] as { run?: RunnableCommand["run"] } | undefined;
  if (!cmd?.run) throw new Error("gate spec-promote command not exported");
  return cmd as RunnableCommand;
}

// ─── Output / exit capture (mirrors assess-ai.bun.test.ts) ───────────────────

function captureOutput() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  const origConsoleLog = console.log.bind(console);

  (process.stderr as unknown as { write: (chunk: unknown) => boolean }).write = (chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  };
  console.log = (...args: unknown[]) => {
    stdout.push(args.join(" "));
  };

  return {
    stdout,
    stderr,
    restore: () => {
      (process.stderr as unknown as { write: typeof origStderrWrite }).write = origStderrWrite;
      console.log = origConsoleLog;
    },
  };
}

// ─── Project setup ────────────────────────────────────────────────────────────

let tmpDir: string;
let originalCwd: string;
let originalEnv: string | undefined;
/** The live rule seeded into this test's corpus by {@link seedLiveRule}; reset per test. */
let seededRuleId: string | undefined;

const LORE_ENTRY = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "src", "index.ts");

/** Runs the real `lore` CLI against this test's throwaway corpus; throws on a non-zero exit. */
function loreCli(args: string[]): string {
  const env: Record<string, string | undefined> = { ...process.env, HOME: tmpDir, CLAUDECODE: "1", LORE_ACTOR: "agent:gate-spec-promote-test" };
  delete env["LORE_GATE_BYPASS"];
  const proc = Bun.spawnSync(["bun", "run", LORE_ENTRY, ...args], { cwd: tmpDir, env });
  if ((proc.exitCode ?? 1) !== 0) {
    throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${proc.exitCode}): ${proc.stderr.toString()}${proc.stdout.toString()}`);
  }
  return proc.stdout.toString();
}

/** Seeds (once per test) one live rule in this test's corpus — shared fixture, see helpers/cli-live-rule.ts. */
function seedLiveRule(): string {
  if (seededRuleId === undefined) {
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: tmpDir });
    seededRuleId = ensureLiveRuleViaCli(loreCli, tmpDir);
  }
  return seededRuleId;
}

beforeEach(async () => {
  seededRuleId = undefined;
  process.exitCode = 0;
  originalEnv = process.env["LORE_GATE_BYPASS"];
  delete process.env["LORE_GATE_BYPASS"];
  tmpDir = resolve(mkdtempSync(join(tmpdir(), "lore-gate-spec-promote-test-")));
  const loreDir = join(tmpDir, ".lore");
  mkdirSync(loreDir, { recursive: true });

  const app = createApp(join(loreDir, "lore.db"), undefined, liveAmbient());
  app.close();
  // AU-T7: `approve --override-no-judgment` is decided; this suite's subject is not the override, so the class is
  // loosened the documented way (a human-tty governance decision on a throwaway corpus), never by a bypass in product code.
  await loosenOverrideClasses(tmpDir, ["override-judgment"]);

  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.exitCode = 0;
  if (originalEnv === undefined) delete process.env["LORE_GATE_BYPASS"];
  else process.env["LORE_GATE_BYPASS"] = originalEnv;
  process.chdir(originalCwd);
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

// ─── Fixture helpers ──────────────────────────────────────────────────────────

/** Create a PRD + child spec (no AC declared). Returns the spec's slug and id. */
async function createSpec(): Promise<{ specId: string; specSlug: string }> {
  const app = createApp(join(tmpDir, ".lore", "lore.db"), undefined, liveAmbient());
  try {
    const prdResult = await app.corpusService.create({
      type: "prd",
      title: "Gate Spec-Promote PRD",
      content: "PRD body for gate spec-promote tests.",
    } as CreateDocInput);
    if (!prdResult.ok) throw new Error(`prd create failed: ${JSON.stringify(prdResult.error)}`);

    const specResult = await app.corpusService.create({
      type: "spec",
      title: "Gate Spec-Promote Target Spec",
      content: "## Overview\n\nSpec body for gate spec-promote tests.\n",
    } as CreateDocInput);
    if (!specResult.ok) throw new Error(`spec create failed: ${JSON.stringify(specResult.error)}`);

    return { specId: specResult.value.id, specSlug: specResult.value.slug };
  } finally {
    app.close();
  }
}

/** Create a PRD (non-spec doc), returning its slug for the "not a spec" scenario. */
async function createPrdOnly(): Promise<{ prdSlug: string }> {
  const app = createApp(join(tmpDir, ".lore", "lore.db"), undefined, liveAmbient());
  try {
    const prdResult = await app.corpusService.create({
      type: "prd",
      title: "Gate Spec-Promote Non-Spec PRD",
      content: "PRD body.",
    } as CreateDocInput);
    if (!prdResult.ok) throw new Error(`prd create failed: ${JSON.stringify(prdResult.error)}`);
    return { prdSlug: prdResult.value.slug };
  } finally {
    app.close();
  }
}

/**
 * Create a PRD + child spec declaring `extra.spec_kind = kind` (task-lore-gate-spec-
 * promote-cli-pre-flight-is-not-spec-kind AC2 fixture — the CLI must resolve THIS
 * declared kind, not always fall back to the "feature" default `createSpec` above
 * implicitly exercises).
 */
async function createSpecWithKind(kind: string): Promise<{ specId: string; specSlug: string }> {
  const app = createApp(join(tmpDir, ".lore", "lore.db"), undefined, liveAmbient());
  try {
    const prdResult = await app.corpusService.create({
      type: "prd",
      title: `Gate Spec-Promote ${kind} PRD`,
      content: "PRD body for gate spec-promote spec_kind parity tests.",
    } as CreateDocInput);
    if (!prdResult.ok) throw new Error(`prd create failed: ${JSON.stringify(prdResult.error)}`);

    const specResult = await app.corpusService.create({
      type: "spec",
      title: `Gate Spec-Promote ${kind} Target Spec`,
      content: "## Overview\n\nSpec body for gate spec-promote spec_kind parity tests.\n",
      extra: { spec_kind: kind },
    } as CreateDocInput);
    if (!specResult.ok) throw new Error(`spec create failed: ${JSON.stringify(specResult.error)}`);

    return { specId: specResult.value.id, specSlug: specResult.value.slug };
  } finally {
    app.close();
  }
}

/** Add one structured acceptance criterion (verify.mode=human — simplest valid shape). */
async function addAcceptanceCriterion(specId: string, id = "AC-PROMO-1", cite = true): Promise<void> {
  const app = createApp(join(tmpDir, ".lore", "lore.db"), undefined, liveAmbient());
  try {
    if (app.acService === undefined) throw new Error("AcService not wired");
    const result = await app.acService.addCriterion(specId, {
      id,
      statement: "The gated behaviour works as declared.",
      verify: { mode: "human" },
    });
    if (!result.ok) throw new Error(`addCriterion failed: ${JSON.stringify(result.error)}`);
  } finally {
    app.close();
  }
  // BR-1007 — a spec that is to PASS the pre-flight must cite a live rule; the criterion is cited
  // through the real `lore ac cite` after the in-process add has released the database.
  if (cite) loreCli(["ac", "cite", specId, id, seedLiveRule()]);
}

/** Write a fake "AI provider" shell script emitting a FIXED valid review-judgment JSON. */
function writeFixedJudgeProviderScript(decision: "approve" | "reject" | "escalate" = "approve"): string {
  const scriptPath = join(tmpDir, "fake-judge-provider.sh");
  const body =
    decision === "escalate"
      ? {
          decision: "escalate",
          confidence: 0.4,
          reasons: [{ dimension: "completeness", finding: "Ambiguous scope." }],
          blocking_questions: ["Is section 3 in scope?"],
        }
      : {
          decision,
          confidence: 0.91,
          reasons: [{ dimension: "completeness", finding: "Looks complete." }],
          blocking_questions: [],
        };
  writeFileSync(
    scriptPath,
    `#!/bin/sh\ncat > /dev/null\ncat <<'JSONEOF'\n${JSON.stringify(body)}\nJSONEOF\n`,
    { mode: 0o755 },
  );
  return scriptPath;
}

/** Write a fake provider script that always fails (nonzero exit, no output). */
function writeFailingProviderScript(): string {
  const scriptPath = join(tmpDir, "fake-judge-provider-fail.sh");
  writeFileSync(scriptPath, `#!/bin/sh\ncat > /dev/null\necho "boom" >&2\nexit 1\n`, { mode: 0o755 });
  return scriptPath;
}

/** Point config.yaml's ai.provider at the given shell command. */
function writeAiConfig(command: string) {
  saveConfig(tmpDir, {
    project: { name: "gate-spec-promote-test", author: "tester" },
    ai: {
      provider: "claude-cli",
      providers: { "claude-cli": { command, args: [], timeout_ms: 5000 } },
      templates: {},
      telemetry: false,
    },
  } as never);
}

/**
 * Write config.yaml disabling spec-promote's ac_quantifiable sub-predicate, ALSO
 * pointing ai.provider at a definitely-nonexistent binary (same "ghost binary"
 * idiom the AC4 suite uses) so the post-pass judge-advisory attempt fails fast
 * instead of hanging on a real reachable `claude` binary. A single `saveConfig`
 * call — `saveConfig` REPLACES the whole file, so `workflow` and `ai` must be
 * set together here rather than via two sequential helper calls.
 */
function writeAcQuantifiableDisabledConfig() {
  saveConfig(tmpDir, {
    project: { name: "gate-spec-promote-test", author: "tester" },
    workflow: { gates: { "spec-promote": { ac_quantifiable: { enabled: false } } } },
    ai: {
      provider: "claude-cli",
      providers: {
        "claude-cli": { command: "ghost-ai-binary-not-installed-xyz", args: [], timeout_ms: 5000 },
      },
      templates: {},
      telemetry: false,
    },
  } as never);
}

/**
 * Write config.yaml declaring the `domain-overview` verification profile's
 * `min_acs: 0` (SPEC-058, the same entry `lore setup --project`'s template seeds —
 * task-lore-gate-spec-promote-cli-pre-flight-is-not-spec-kind AC2), ALSO pointing
 * `ai.provider` at a nonexistent binary (same "ghost binary" idiom as the other
 * config-writing helpers above) so the post-pass judge-advisory attempt fails fast.
 */
function writeDomainOverviewProfileConfig() {
  saveConfig(tmpDir, {
    project: { name: "gate-spec-promote-test", author: "tester" },
    workflow: { verification_profiles: { "domain-overview": { min_acs: 0 } } },
    ai: {
      provider: "claude-cli",
      providers: {
        "claude-cli": { command: "ghost-ai-binary-not-installed-xyz", args: [], timeout_ms: 5000 },
      },
      templates: {},
      telemetry: false,
    },
  } as never);
}

/**
 * The SAME `domain-overview: {min_acs: 0}` profile as {@link writeDomainOverviewProfileConfig}'s
 * on-disk config, as a typed `LoreConfig` object — used to open a SECOND, service-layer
 * gate-enforced `App` (via `createApp(dbPath, config)`, mirroring
 * `gate-enforcer-service-layer.bun.test.ts`'s `openApp` idiom) so a test can assert the
 * CLI pre-flight and `CorpusService.set`'s spec-promote gate reach the IDENTICAL verdict
 * for the same spec — the parity this task's fix establishes.
 */
const DOMAIN_OVERVIEW_PROFILE_CONFIG = {
  project: { name: "gate-spec-promote-test", author: "tester" },
  workflow: {
    verification_profiles: { "domain-overview": { min_acs: 0 } },
    // SPEC-103 §Mechanisms M2 — `review-judgment` is a SEPARATE, ADDITIVE checkpoint
    // (default `judgment_required_types: ["spec","adr"]`) this fixture predates;
    // disabled here so this file's `reviewService.approve()` calls stay scoped to
    // the verification-profile/spec-promote parity concern this file actually tests.
    review: { judgment_required_types: [] },
  },
} as unknown as LoreConfig;

/**
 * Directly patches a spec's `extra.acceptance_criteria` via `CorpusService.set`
 * (no status transition) — bypasses BOTH `AcService.addCriterion`'s immediate
 * lint AND the spec-create gate (the spec already exists), the exact "predates
 * the gate" scenario `acQuantifiable`'s spec-promote wiring is the BACKSTOP for.
 * Mirrors `ac-quantifiable-gate.test.ts`'s `insertRawSpec` helper, but goes
 * through the public `CorpusService.set` API (available here) rather than a
 * bare `store.insert` (not available through this file's `createApp()` shape).
 */
async function setAcceptanceCriteriaDirectly(specId: string, criteria: unknown[]): Promise<void> {
  // The AC write chokepoint (spec-baseline-slice-2 §C3) now refuses a wholesale
  // `CorpusService.set` that changes the criteria, so this fixture plants the legacy
  // "predates the gate" state straight through the store — the only remaining way to
  // simulate it.
  const store = new SQLiteStore(join(tmpDir, ".lore", "lore.db"));
  try {
    const found = await store.find(specId as DocId);
    if (!found.ok || found.value === null) throw new Error(`find failed: ${specId}`);
    const updated = await store.update(found.value.id, {
      extra: { ...found.value.extra, acceptance_criteria: criteria },
    });
    if (!updated.ok) throw new Error(`update failed: ${JSON.stringify(updated.error)}`);
  } finally {
    store.close();
  }
}

/** An AC whose statement carries an abstract-quality word with no measurable anchor. */
const UNQUANTIFIED_AC = {
  id: "AC-BAD-1",
  statement: "the dashboard loads fast",
  verify: { mode: "human" as const },
};

// ─── AC3 (NEGATIVE): 0 declared AC → exit 4 ──────────────────────────────────

describe("lore gate spec-promote — AC3: no acceptance criteria (deterministic gate)", () => {
  it("exits 4 with a 'no acceptance criteria' message when the spec declares zero AC", async () => {
    const { specSlug } = await createSpec();

    const cmd = await importGateSpecPromoteCommand();
    const output = captureOutput();
    try {
      await cmd.run({ args: { spec: specSlug }, inv: liveInvocation() });
    } finally {
      output.restore();
    }

    expect(process.exitCode).toBe(4);
    const stderrText = output.stderr.join("");
    expect(stderrText).toContain("no structured acceptance criteria");
    expect(stderrText).toContain("lore ac add");
  });
});

// ─── AC4 (HAPPY): ≥1 declared AC → exit 0, judge advisory on stderr ──────────

describe("lore gate spec-promote — AC4: acceptance criteria present (exit 0) + judge advisory", () => {
  it("exits 0 and prints 'gate: pass' when ≥1 AC is declared, with no AI provider reachable", async () => {
    const { specSlug, specId } = await createSpec();
    await addAcceptanceCriterion(specId);
    // reason: explicitly point at a definitely-nonexistent binary rather than relying on
    // the untouched default config — this sandbox may have a real, reachable `claude`
    // binary on $PATH that hangs waiting on stdin rather than failing fast (observed:
    // bun test's 5s per-test timeout fired and left a dangling process). AC-AI-5's
    // "missing binary" idiom (ai-stub-binary.bun.test.ts) gives a fast, deterministic
    // ENOENT instead.
    writeAiConfig("ghost-ai-binary-not-installed-xyz");

    const cmd = await importGateSpecPromoteCommand();
    const output = captureOutput();
    try {
      await cmd.run({ args: { spec: specSlug }, inv: liveInvocation() });
    } finally {
      output.restore();
    }

    expect(process.exitCode).toBe(0);
    const stdoutText = output.stdout.join("\n");
    expect(stdoutText).toContain("gate: pass");
  });

  it("BOUNDARY: exactly one AC is enough to pass the deterministic gate", async () => {
    const { specSlug, specId } = await createSpec();
    await addAcceptanceCriterion(specId, "AC-PROMO-ONLY");
    writeAiConfig("ghost-ai-binary-not-installed-xyz"); // reason: see prior test's comment

    const cmd = await importGateSpecPromoteCommand();
    const output = captureOutput();
    try {
      await cmd.run({ args: { spec: specSlug }, inv: liveInvocation() });
    } finally {
      output.restore();
    }

    expect(process.exitCode).toBe(0);
  });

  it("prints the AI judge's decision/confidence advisory to stderr, and exit stays 0 (INV2)", async () => {
    const { specSlug, specId } = await createSpec();
    await addAcceptanceCriterion(specId);
    writeAiConfig(writeFixedJudgeProviderScript("approve"));

    const cmd = await importGateSpecPromoteCommand();
    const output = captureOutput();
    try {
      await cmd.run({ args: { spec: specSlug }, inv: liveInvocation() });
    } finally {
      output.restore();
    }

    // ── The load-bearing assertion: judge advisory lands on stderr, exit is unchanged. ──
    expect(process.exitCode).toBe(0);
    const stderrText = output.stderr.join("");
    expect(stderrText).toContain("gate: judge advisory");
    expect(stderrText).toContain("decision=approve");
    expect(stderrText).toContain("confidence=0.91");

    // stdout stays the deterministic-gate pass line only — judge output never leaks there.
    const stdoutText = output.stdout.join("\n");
    expect(stdoutText).toContain("gate: pass");
    expect(stdoutText).not.toContain("decision=approve");
  });

  it("prints blocking questions on stderr when the judge escalates, and exit STILL stays 0 (INV2)", async () => {
    const { specSlug, specId } = await createSpec();
    await addAcceptanceCriterion(specId);
    writeAiConfig(writeFixedJudgeProviderScript("escalate"));

    const cmd = await importGateSpecPromoteCommand();
    const output = captureOutput();
    try {
      await cmd.run({ args: { spec: specSlug }, inv: liveInvocation() });
    } finally {
      output.restore();
    }

    expect(process.exitCode).toBe(0);
    const stderrText = output.stderr.join("");
    expect(stderrText).toContain("decision=escalate");
    expect(stderrText).toContain("Is section 3 in scope?");
  });

  it("REGRESSION: a judge-provider failure degrades to an advisory note on stderr, exit code unaffected", async () => {
    const { specSlug, specId } = await createSpec();
    await addAcceptanceCriterion(specId);
    writeAiConfig(writeFailingProviderScript());

    const cmd = await importGateSpecPromoteCommand();
    const output = captureOutput();
    try {
      await cmd.run({ args: { spec: specSlug }, inv: liveInvocation() });
    } finally {
      output.restore();
    }

    expect(process.exitCode).toBe(0);
    const stderrText = output.stderr.join("");
    expect(stderrText).toContain("judge advisory unavailable");
  });

  it("REGRESSION: an unreachable AI provider binary still exits 0 with a graceful advisory note", async () => {
    const { specSlug, specId } = await createSpec();
    await addAcceptanceCriterion(specId);
    writeAiConfig("ghost-ai-binary-not-installed-xyz"); // AC-AI-5 idiom — fast, deterministic ENOENT

    const cmd = await importGateSpecPromoteCommand();
    const output = captureOutput();
    try {
      await cmd.run({ args: { spec: specSlug }, inv: liveInvocation() });
    } finally {
      output.restore();
    }

    expect(process.exitCode).toBe(0);
    const stderrText = output.stderr.join("");
    expect(stderrText).toContain("gate: judge advisory unavailable");
  });
});

// ─── AC-Quantifiability Gate CLI parity (task-hook-parity-g1-g2) ────────────

describe("lore gate spec-promote — AC-Quantifiability Gate CLI parity", () => {
  // NEGATIVE — an unquantified AC that predates the gate (patched in directly, bypassing
  // AcService.addCriterion's own immediate lint) blocks spec-promote, naming the AC id + word.
  it("NEGATIVE: exits 4 and names the offending AC id + word for an unquantified declared AC", async () => {
    const { specSlug, specId } = await createSpec();
    await setAcceptanceCriteriaDirectly(specId, [UNQUANTIFIED_AC]);

    const cmd = await importGateSpecPromoteCommand();
    const output = captureOutput();
    try {
      await cmd.run({ args: { spec: specSlug }, inv: liveInvocation() });
    } finally {
      output.restore();
    }

    expect(process.exitCode).toBe(4);
    const stderrText = output.stderr.join("");
    expect(stderrText).toContain("unquantified acceptance criterion");
    expect(stderrText).toContain("AC-BAD-1");
    expect(stderrText).toContain("fast");
  });

  // HAPPY — every declared AC is quantified (via the normal AcService.addCriterion path) → exit 0.
  it("HAPPY: exits 0 with no AC_NOT_QUANTIFIABLE mention when every declared AC is quantified", async () => {
    const { specSlug, specId } = await createSpec();
    await addAcceptanceCriterion(specId, "AC-GOOD-1");
    writeAiConfig("ghost-ai-binary-not-installed-xyz"); // reason: see AC4 suite's identical comment

    const cmd = await importGateSpecPromoteCommand();
    const output = captureOutput();
    try {
      await cmd.run({ args: { spec: specSlug }, inv: liveInvocation() });
    } finally {
      output.restore();
    }

    expect(process.exitCode).toBe(0);
    const stdoutText = output.stdout.join("\n");
    expect(stdoutText).toContain("gate: pass");
    expect(stdoutText).not.toContain("AC_NOT_QUANTIFIABLE");
  });

  // STATE — config escape: workflow.gates.spec-promote.ac_quantifiable.enabled=false lets
  // an unquantified-AC spec approve.
  it("STATE: workflow.gates.spec-promote.ac_quantifiable.enabled=false lets an unquantified-AC spec pass", async () => {
    const { specSlug, specId } = await createSpec();
    await setAcceptanceCriteriaDirectly(specId, [{ ...UNQUANTIFIED_AC, cites: [seedLiveRule()] }]);
    writeAcQuantifiableDisabledConfig();

    const cmd = await importGateSpecPromoteCommand();
    const output = captureOutput();
    try {
      await cmd.run({ args: { spec: specSlug }, inv: liveInvocation() });
    } finally {
      output.restore();
    }

    expect(process.exitCode).toBe(0);
    const stdoutText = output.stdout.join("\n");
    expect(stdoutText).toContain("gate: pass");
  });

  // REGRESSION — LORE_GATE_BYPASS=1 still short-circuits an unquantified-AC spec.
  it("REGRESSION: LORE_GATE_BYPASS=1 exits 0 even for an unquantified-AC spec", async () => {
    const { specSlug, specId } = await createSpec();
    await setAcceptanceCriteriaDirectly(specId, [UNQUANTIFIED_AC]);
    process.env["LORE_GATE_BYPASS"] = "1";

    const cmd = await importGateSpecPromoteCommand();
    const output = captureOutput();
    try {
      await cmd.run({ args: { spec: specSlug }, inv: liveInvocation() });
    } finally {
      output.restore();
      delete process.env["LORE_GATE_BYPASS"];
    }

    expect(process.exitCode).toBe(0);
  });
});

// ─── ERROR / NEGATIVE: doc resolution failures ───────────────────────────────

describe("lore gate spec-promote — doc resolution failures", () => {
  it("ERROR: exits 3 (DOC_NOT_FOUND) when the spec does not resolve", async () => {
    await createSpec(); // ensure the corpus isn't empty, unrelated to the lookup below

    const cmd = await importGateSpecPromoteCommand();
    const output = captureOutput();
    try {
      await cmd.run({ args: { spec: "does-not-exist-slug" }, inv: liveInvocation() });
    } finally {
      output.restore();
    }

    expect(process.exitCode).toBe(3);
  });

  it("NEGATIVE: exits 4 (VALIDATION_ERROR) when the target doc is not a spec", async () => {
    const { prdSlug } = await createPrdOnly();

    const cmd = await importGateSpecPromoteCommand();
    const output = captureOutput();
    try {
      await cmd.run({ args: { spec: prdSlug }, inv: liveInvocation() });
    } finally {
      output.restore();
    }

    expect(process.exitCode).toBe(4);
  });
});

// ─── STATE: LORE_GATE_BYPASS=1 ────────────────────────────────────────────────

describe("lore gate spec-promote — STATE: LORE_GATE_BYPASS=1", () => {
  it("exits 0 even for a spec with zero acceptance criteria when bypassed", async () => {
    const { specSlug } = await createSpec();
    process.env["LORE_GATE_BYPASS"] = "1";

    const cmd = await importGateSpecPromoteCommand();
    const output = captureOutput();
    try {
      await cmd.run({ args: { spec: specSlug }, inv: liveInvocation() });
    } finally {
      output.restore();
      delete process.env["LORE_GATE_BYPASS"];
    }

    expect(process.exitCode).toBe(0);
  });

  it("exits 0 even when the spec does not exist at all, when bypassed", async () => {
    process.env["LORE_GATE_BYPASS"] = "1";

    const cmd = await importGateSpecPromoteCommand();
    const output = captureOutput();
    try {
      await cmd.run({ args: { spec: "totally-nonexistent" }, inv: liveInvocation() });
    } finally {
      output.restore();
      delete process.env["LORE_GATE_BYPASS"];
    }

    expect(process.exitCode).toBe(0);
  });
});

// ─── AC2 (parity fix): CLI resolves specKind + verificationProfile ──────────
// task-lore-gate-spec-promote-cli-pre-flight-is-not-spec-kind — before this fix,
// `runSpecPromoteGate` never populated `ctx.specKind`/`ctx.verificationProfile`, so a
// domain-overview spec with `min_acs: 0` (SPEC-058) that already promotes cleanly
// through `CorpusService.set`/`ReviewService.approve` was still denied by `lore gate
// spec-promote` with the spec_kind-agnostic default floor-1 message. Each case below
// asserts the CLI outcome AND, in the same test, the service-layer outcome for the
// identical spec/config — proving they now agree.

describe("lore gate spec-promote — AC2 (parity fix): CLI resolves specKind + verificationProfile", () => {
  it("HAPPY: domain-overview spec with 0 ACs + min_acs:0 profile clears the AC-count floor on the CLI; only BR-1007 (nothing to cite) refuses it — the same refusal as the service layer", async () => {
    const { specId, specSlug } = await createSpecWithKind("domain-overview");
    writeDomainOverviewProfileConfig();

    const cmd = await importGateSpecPromoteCommand();
    const output = captureOutput();
    try {
      await cmd.run({ args: { spec: specSlug }, inv: liveInvocation() });
    } finally {
      output.restore();
    }

    // re-baseline (BR-1007, issue #137): this used to pass — the CLI never measured citations, so it said
    // "pass" for a spec the approval then refused. The waived floor is still honoured (no "needs >= N"
    // text); the refusal is the citation one, naming `lore ac cite`.
    expect(process.exitCode).toBe(4);
    const refusal = output.stderr.join("");
    expect(refusal).not.toContain("needs >=");
    expect(refusal).toContain("lore ac cite");

    // ── Service-layer parity: the SAME draft→approved transition through
    // CorpusService.set (the sibling gated write path ReviewService.approve also
    // uses) must reach the IDENTICAL verdict against the SAME config profile.
    // reason: BR-1007 - the AC-count floor is waived by the profile, but a spec with no criterion has
    // nothing to cite, so the service refuses it for THAT reason (field `acceptance_criteria`), never on
    // the spec-promote floor: the floor-level verdict still matches the CLI's.
    const gatedApp = createApp(join(tmpDir, ".lore", "lore.db"), DOMAIN_OVERVIEW_PROFILE_CONFIG, liveAmbient()) as App;
    try {
      const setResult = await gatedApp.corpusService.set(specId, { status: "approved" });
      expect(setResult.ok).toBe(false);
      if (!setResult.ok) expect((setResult.error as { field?: string }).field).toBe("acceptance_criteria");
    } finally {
      gatedApp.close();
    }
  });

  it('NEGATIVE: feature-kind spec with 0 ACs is denied, message names floor 1 and kind "feature" — matching the service layer', async () => {
    const { specId, specSlug } = await createSpecWithKind("feature");
    // reason: the domain-overview profile entry must NOT leak a waived floor onto an
    // unrelated spec_kind — feature has no entry of its own, so it keeps the default
    // floor of 1 (acCountMeetsFloor's DEFAULT_MIN_ACS).
    writeDomainOverviewProfileConfig();

    const cmd = await importGateSpecPromoteCommand();
    const output = captureOutput();
    try {
      await cmd.run({ args: { spec: specSlug }, inv: liveInvocation() });
    } finally {
      output.restore();
    }

    expect(process.exitCode).toBe(4);
    const stderrText = output.stderr.join("");
    expect(stderrText).toContain("needs >= 1");
    expect(stderrText).toContain('spec_kind "feature"');

    // ── Service-layer parity: the SAME 0-AC feature spec is ALSO denied by
    // CorpusService.set's spec-promote gate against the SAME config.
    const gatedApp = createApp(join(tmpDir, ".lore", "lore.db"), DOMAIN_OVERVIEW_PROFILE_CONFIG, liveAmbient()) as App;
    try {
      const setResult = await gatedApp.corpusService.set(specId, { status: "approved" });
      expect(setResult.ok).toBe(false);
      if (!setResult.ok) {
        expect(setResult.error.code).toBe("VALIDATION_ERROR");
      }
    } finally {
      gatedApp.close();
    }
  });

  it("BOUNDARY: domain-overview spec with exactly 1 AC still passes (min_acs:0 is a floor waiver, not a cap)", async () => {
    const { specId, specSlug } = await createSpecWithKind("domain-overview");
    await addAcceptanceCriterion(specId, "AC-DOMAIN-1");
    writeDomainOverviewProfileConfig();

    const cmd = await importGateSpecPromoteCommand();
    const output = captureOutput();
    try {
      await cmd.run({ args: { spec: specSlug }, inv: liveInvocation() });
    } finally {
      output.restore();
    }

    expect(process.exitCode).toBe(0);
  });

  it("REGRESSION: with no verification_profiles config at all, a feature-kind spec with 0 ACs is still denied with the pre-existing message", async () => {
    const { specSlug } = await createSpecWithKind("feature");
    writeAiConfig("ghost-ai-binary-not-installed-xyz"); // reason: see AC4 suite's identical comment

    const cmd = await importGateSpecPromoteCommand();
    const output = captureOutput();
    try {
      await cmd.run({ args: { spec: specSlug }, inv: liveInvocation() });
    } finally {
      output.restore();
    }

    expect(process.exitCode).toBe(4);
    const stderrText = output.stderr.join("");
    expect(stderrText).toContain("no structured acceptance criteria");
    expect(stderrText).toContain('spec_kind "feature"');
  });
});

// ─── BR-1007 parity (issue #137): the pre-flight and `approve` reach the same verdict ──────────────

describe("lore gate spec-promote — BR-1007 parity with `lore approve` (issue #137)", () => {
  it("NEGATIVE: a spec with a quantified criterion but no citation is refused by the gate (exit 4, naming `lore ac cite`) exactly as approve refuses it", async () => {
    const { specSlug, specId } = await createSpec();
    await addAcceptanceCriterion(specId, "AC-PARITY-1", false); // declared, NOT cited
    writeAiConfig("ghost-ai-binary-not-installed-xyz");

    const cmd = await importGateSpecPromoteCommand();
    const output = captureOutput();
    try {
      await cmd.run({ args: { spec: specSlug }, inv: liveInvocation() });
    } finally {
      output.restore();
    }
    expect(process.exitCode).toBe(4);
    const gateRefusal = output.stderr.join("");
    expect(gateRefusal).toContain("lore ac cite");
    expect(gateRefusal).toContain(specSlug);
    expect(output.stdout.join("\n")).not.toContain("gate: pass");

    // The approval the gate is a pre-flight for refuses the SAME spec with the SAME wording.
    const env: Record<string, string | undefined> = { ...process.env, HOME: tmpDir, CLAUDECODE: "1", LORE_ACTOR: "agent:gate-spec-promote-test" };
    delete env["LORE_GATE_BYPASS"];
    const approve = Bun.spawnSync(["bun", "run", LORE_ENTRY, "approve", specSlug, "--override-no-judgment"], { cwd: tmpDir, env });
    expect(approve.exitCode).toBe(4);
    expect(`${approve.stderr.toString()}${approve.stdout.toString()}`).toContain(UNCITED_SPEC_RULE);
    expect(gateRefusal).toContain(UNCITED_SPEC_RULE);
  });

  it("HAPPY: after `lore ac cite` the gate passes and the same approve succeeds", async () => {
    const { specSlug, specId } = await createSpec();
    await addAcceptanceCriterion(specId, "AC-PARITY-2", false);
    loreCli(["ac", "cite", specId, "AC-PARITY-2", seedLiveRule()]);
    writeAiConfig("ghost-ai-binary-not-installed-xyz");

    const cmd = await importGateSpecPromoteCommand();
    const output = captureOutput();
    try {
      await cmd.run({ args: { spec: specSlug }, inv: liveInvocation() });
    } finally {
      output.restore();
    }
    expect(process.exitCode).toBe(0);
    expect(output.stdout.join("\n")).toContain("gate: pass");
    expect(loreCli(["approve", specSlug, "--override-no-judgment"])).toContain("approved");
  }, 30_000);

  it("NEGATIVE: a criterion citing only a RETIRED rule does not satisfy the gate either (same measure as approve)", async () => {
    const { specSlug, specId } = await createSpec();
    await addAcceptanceCriterion(specId, "AC-PARITY-3", false);
    const rule = seedLiveRule();
    loreCli(["ac", "cite", specId, "AC-PARITY-3", rule]);
    loreCli(["rule", "set", rule, "--lifecycle", "retired", "--note", "superseded for the test"]);
    writeAiConfig("ghost-ai-binary-not-installed-xyz");

    const cmd = await importGateSpecPromoteCommand();
    const output = captureOutput();
    try {
      await cmd.run({ args: { spec: specSlug }, inv: liveInvocation() });
    } finally {
      output.restore();
    }
    expect(process.exitCode).toBe(4);
    expect(output.stderr.join("")).toContain("lore ac cite");
  }, 30_000);

  it("REGRESSION: with an unquantified AND uncited criterion the gate names BOTH the AC id and the citation refusal", async () => {
    const { specSlug, specId } = await createSpec();
    await setAcceptanceCriteriaDirectly(specId, [UNQUANTIFIED_AC]);
    writeAiConfig("ghost-ai-binary-not-installed-xyz");

    const cmd = await importGateSpecPromoteCommand();
    const output = captureOutput();
    try {
      await cmd.run({ args: { spec: specSlug }, inv: liveInvocation() });
    } finally {
      output.restore();
    }
    expect(process.exitCode).toBe(4);
    const text = output.stderr.join("");
    expect(text).toContain("AC-BAD-1");
    expect(text).toContain("lore ac cite");
  });
});
