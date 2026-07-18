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
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { createApp } from "../../src/app.js";
import { saveConfig } from "@lore/core/node";
import type { CreateDocInput } from "@lore/core";

// ─── Command type (mirrors assess-ai.bun.test.ts) ────────────────────────────

type RunnableCommand = { run: (ctx: { args: Record<string, unknown> }) => Promise<void> };

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

beforeEach(() => {
  process.exitCode = 0;
  originalEnv = process.env["LORE_GATE_BYPASS"];
  delete process.env["LORE_GATE_BYPASS"];
  tmpDir = resolve(mkdtempSync(join(tmpdir(), "lore-gate-spec-promote-test-")));
  const loreDir = join(tmpDir, ".lore");
  mkdirSync(loreDir, { recursive: true });

  const app = createApp(join(loreDir, "lore.db"));
  app.close();

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
  const app = createApp(join(tmpDir, ".lore", "lore.db"));
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
      parent_id: prdResult.value.id,
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
  const app = createApp(join(tmpDir, ".lore", "lore.db"));
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

/** Add one structured acceptance criterion (verify.mode=human — simplest valid shape). */
async function addAcceptanceCriterion(specId: string, id = "AC-PROMO-1"): Promise<void> {
  const app = createApp(join(tmpDir, ".lore", "lore.db"));
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
 * Directly patches a spec's `extra.acceptance_criteria` via `CorpusService.set`
 * (no status transition) — bypasses BOTH `AcService.addCriterion`'s immediate
 * lint AND the spec-create gate (the spec already exists), the exact "predates
 * the gate" scenario `acQuantifiable`'s spec-promote wiring is the BACKSTOP for.
 * Mirrors `ac-quantifiable-gate.test.ts`'s `insertRawSpec` helper, but goes
 * through the public `CorpusService.set` API (available here) rather than a
 * bare `store.insert` (not available through this file's `createApp()` shape).
 */
async function setAcceptanceCriteriaDirectly(specId: string, criteria: unknown[]): Promise<void> {
  const app = createApp(join(tmpDir, ".lore", "lore.db"));
  try {
    const getResult = await app.corpusService.get(specId);
    if (!getResult.ok) throw new Error(`get failed: ${JSON.stringify(getResult.error)}`);
    const setResult = await app.corpusService.set(specId, {
      extra: { ...getResult.value.doc.extra, acceptance_criteria: criteria },
    });
    if (!setResult.ok) throw new Error(`set failed: ${JSON.stringify(setResult.error)}`);
  } finally {
    app.close();
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
      await cmd.run({ args: { spec: specSlug } });
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
      await cmd.run({ args: { spec: specSlug } });
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
      await cmd.run({ args: { spec: specSlug } });
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
      await cmd.run({ args: { spec: specSlug } });
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
      await cmd.run({ args: { spec: specSlug } });
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
      await cmd.run({ args: { spec: specSlug } });
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
      await cmd.run({ args: { spec: specSlug } });
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
      await cmd.run({ args: { spec: specSlug } });
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
      await cmd.run({ args: { spec: specSlug } });
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
    await setAcceptanceCriteriaDirectly(specId, [UNQUANTIFIED_AC]);
    writeAcQuantifiableDisabledConfig();

    const cmd = await importGateSpecPromoteCommand();
    const output = captureOutput();
    try {
      await cmd.run({ args: { spec: specSlug } });
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
      await cmd.run({ args: { spec: specSlug } });
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
      await cmd.run({ args: { spec: "does-not-exist-slug" } });
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
      await cmd.run({ args: { spec: prdSlug } });
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
      await cmd.run({ args: { spec: specSlug } });
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
      await cmd.run({ args: { spec: "totally-nonexistent" } });
    } finally {
      output.restore();
      delete process.env["LORE_GATE_BYPASS"];
    }

    expect(process.exitCode).toBe(0);
  });
});
