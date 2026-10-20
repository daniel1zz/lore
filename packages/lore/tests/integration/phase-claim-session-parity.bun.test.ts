/**
 * @spec_ref task-phaseworkflowservice-claim-captures-no-session-id-so-every
 *   §Required fix 1-4, §Acceptance criteria AC-1..AC-4;
 *   task-two-concurrent-orchestrators-both-resolve-to-agent-main §Required fix 1;
 *   SPEC-042 §Design Decisions D1/D5; SPEC-056 D2/D7.
 *
 * TWO oracles the unit suite structurally cannot reach:
 *
 *  1. DISTRIBUTION. `PhaseWorkflowService` defaults its `processEnv` to `{}` (so unit
 *     constructions stay deterministic instead of depending on whether the test process
 *     runs under a Claude Code session), which means EVERY shipped phase surface depends
 *     on ONE argument in `adapters/cli/phase-wiring.ts::buildPhaseServices` passing
 *     `process.env`. Dropping it fails SILENT — phase claims would simply record no
 *     `session_id` and the anchor mutex would degrade to the retired same-actor proxy
 *     while every unit test stayed green. These cases run the REAL `createApp`
 *     composition root over a REAL SQLite corpus, so that argument going missing turns
 *     red here.
 *
 *  2. PRE-FLIGHT PARITY (AC-4). `lore gate phase-claim` is a DIFFERENT code path
 *     (`commands/gate.ts::runPhaseClaimGate`) from `PhaseWorkflowService.claim`, and it
 *     builds its own gate context. If only one of the two threads the captured session,
 *     the dry-run and the command it previews disagree: the pre-flight would print an
 *     `ANCHOR_OVERLAP_SESSION_UNMEASURED` refusal for a claim that actually succeeds
 *     (or vice versa). Every case below asserts BOTH surfaces on the SAME corpus state.
 *
 * bun test (not vitest): `createApp` and the gate command pull in `bun:sqlite`.
 *
 * ⛔ Never touches the repo's own `.lore/` corpus — every case runs inside its own
 * `mkdtempSync` directory (project CLAUDE.md hard rule), and the session env vars are
 * saved/restored around every case (the ambient value of `$CLAUDE_CODE_SESSION_ID` must
 * never decide a verdict here).
 *
 * Coverage dimensions:
 *   HAPPY      — a phase claim through the wired app records `extra.claim.session_id`
 *                (the sanitized 8-char discriminator), and the pre-flight passes
 *   STATE      — ONE actor, ONE checkout, ONE session, two overlapping phases: the
 *                second claim is PERMITTED and the pre-flight agrees (exit 0)
 *   NEGATIVE   — ONE actor, TWO sessions: the overlapping claim is REFUSED and the
 *                pre-flight agrees (exit 4, ANCHOR_OVERLAP, not the not-measured reason)
 *   REGRESSION — NO session env: still refused with the explicit not-measured marker on
 *                BOTH surfaces (the fail-safe survives the fix)
 *   BOUNDARY   — $CLAUDE_SESSION_ID is honored as the fallback variable name
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { createApp } from "../../src/app.js";
import type { App } from "../../src/app.js";
import type { CreateDocInput, DocRecord, TaskClaim } from "@lore/core";
import { resolveActor } from "../../src/adapters/cli/utils.js";
import { liveInvocation, liveAmbient, liveWriteContext, runHandlerForExit, liveIo } from "../live-invocation.js";
import type { Invocation } from "@lore/core";

/**
 * The name the CURRENT process environment resolves to (session tier, else the fallback tiers). No surface takes a
 * `--by`, so the claim holder and the pre-flight candidate must both be this resolved name — evaluated AFTER each
 * test sets its session env, never captured at module load.
 */
function currentActor(): string {
  return resolveActor(liveInvocation());
}
const SHARED_ANCHOR = "packages/core/src/session.ts";
const SESSION_ENV_VARS = ["CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID"] as const;

let tmpDir: string;
let originalCwd: string;
const originalSessionEnv = new Map<string, string | undefined>();
let originalBypass: string | undefined;

beforeEach(() => {
  originalBypass = process.env["LORE_GATE_BYPASS"];
  delete process.env["LORE_GATE_BYPASS"];
  for (const name of SESSION_ENV_VARS) originalSessionEnv.set(name, process.env[name]);
  tmpDir = resolve(mkdtempSync(join(tmpdir(), "lore-phase-claim-session-parity-")));
  mkdirSync(join(tmpDir, ".lore"), { recursive: true });
  const app = createApp(dbPath(), undefined, liveAmbient(), liveWriteContext()) as App;
  app.close();
  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  if (originalBypass === undefined) delete process.env["LORE_GATE_BYPASS"];
  else process.env["LORE_GATE_BYPASS"] = originalBypass;
  for (const name of SESSION_ENV_VARS) {
    const original = originalSessionEnv.get(name);
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
  process.chdir(originalCwd);
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

function dbPath(): string {
  return join(tmpDir, ".lore", "lore.db");
}

function setSessionEnv(variable: (typeof SESSION_ENV_VARS)[number] | null, value?: string): void {
  for (const name of SESSION_ENV_VARS) delete process.env[name];
  if (variable !== null && value !== undefined) process.env[variable] = value;
}

/**
 * One "session": a freshly-constructed app, which re-reads `process.env` through
 * `phase-wiring.ts`'s wiring — exactly how two concurrently-live orchestrator
 * processes in ONE checkout differ from each other.
 */
async function withApp<T>(fn: (app: App) => Promise<T>): Promise<T> {
  // reason: `createApp(dbPath)` with no config always returns a bare `App` (the
  // `Result<App>` arm exists only for the sync-enabled TursoStore path, D-007).
  const app = createApp(dbPath(), undefined, liveAmbient(), liveWriteContext()) as App;
  try {
    return await fn(app);
  } finally {
    app.close();
  }
}

/** Creates a plan with N `phase` children, each declaring the given anchors. */
async function createPlanWithPhases(anchorsPerPhase: string[][]): Promise<{ phaseSlugs: string[] }> {
  return withApp(async (app) => {
    const plan = await app.corpusService.create({
      type: "plan",
      title: "Phase Session Parity Plan",
      content: "# Plan",
    } as CreateDocInput);
    if (!plan.ok) throw new Error(`plan create failed: ${JSON.stringify(plan.error)}`);

    const phaseSlugs: string[] = [];
    for (const [index, anchors] of anchorsPerPhase.entries()) {
      const phase = await app.corpusService.create({
        type: "phase",
        title: `Parity Phase ${index + 1}`,
        parent_id: plan.value.id,
        content: "## Phase",
        extra: { plan_id: plan.value.id, file_anchors: anchors },
      } as unknown as CreateDocInput);
      if (!phase.ok) throw new Error(`phase create failed: ${JSON.stringify(phase.error)}`);
      phaseSlugs.push(phase.value.slug);
    }
    return { phaseSlugs };
  });
}

function readClaim(doc: DocRecord): TaskClaim | undefined {
  return doc.extra["claim"] as TaskClaim | undefined;
}

async function fetchDoc(idOrSlug: string): Promise<DocRecord> {
  return withApp(async (app) => {
    const result = await app.corpusService.get(idOrSlug);
    if (!result.ok) throw new Error(`get failed: ${JSON.stringify(result.error)}`);
    return result.value.doc;
  });
}

// ─── `lore gate phase-claim` invocation (mirrors gate-p2-cross-tier.bun.test.ts) ──

type RunnableCommand = { run: (ctx: { args: Record<string, unknown>; inv?: Invocation }) => Promise<void> };

async function importPhaseClaimGate(): Promise<RunnableCommand> {
  const mod = await import("../../src/adapters/cli/commands/gate.js");
  const group = (mod as { default?: { subCommands?: Record<string, unknown> } }).default;
  const cmd = group?.subCommands?.["phase-claim"] as { run?: RunnableCommand["run"] } | undefined;
  if (!cmd?.run) throw new Error("gate phase-claim command not exported");
  return cmd as RunnableCommand;
}

function captureOutput() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  const origConsoleLog = process.stdout.write;

  (process.stderr as unknown as { write: (chunk: unknown) => boolean }).write = (chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  };
  process.stdout.write = (((chunk: unknown) => {
    const args: unknown[] = [String(chunk).replace(/\n$/, "")];
    stdout.push(args.join(" "));
  
    return true;
  }) as typeof process.stdout.write);

  return {
    stdout,
    stderr,
    restore: () => {
      (process.stderr as unknown as { write: typeof origStderrWrite }).write = origStderrWrite;
      process.stdout.write = origConsoleLog;
    },
  };
}

/** Runs `lore gate phase-claim <phase>` as the current environment's identity, returning its exit code + stdout. */
async function runPreflight(phaseSlug: string): Promise<{ exitCode: number; stdout: string }> {
  const cmd = await importPhaseClaimGate();
  const output = captureOutput();
  let code: number;
  try {
    code = await runHandlerForExit(() => cmd.run({ args: { phase: phaseSlug }, inv: liveInvocation() }));
  } finally {
    output.restore();
  }
  return { exitCode: code, stdout: output.stdout.join("\n") };
}

// ─── Cases ───────────────────────────────────────────────────────────────────

describe("phase claim session capture — createApp wiring + `lore gate phase-claim` parity", () => {
  it("HAPPY: a phase claim through the wired app records the sanitized session discriminator, and the pre-flight passes", async () => {
    const { phaseSlugs } = await createPlanWithPhases([[SHARED_ANCHOR]]);
    setSessionEnv("CLAUDE_CODE_SESSION_ID", "3DE02220-5d69-4b5a-ac23-d66e14c0261b");

    const preflight = await runPreflight(phaseSlugs[0]!);
    expect(preflight.exitCode).toBe(0);
    expect(preflight.stdout).toContain("gate: pass");

    const claimed = await withApp(async (app) => {
      const service = app.phaseWorkflowService;
      if (service === undefined) throw new Error("phaseWorkflowService not wired on App");
      return service.claim(phaseSlugs[0]!, { by: currentActor() });
    });
    expect(claimed.ok).toBe(true);

    const claim = readClaim(await fetchDoc(phaseSlugs[0]!));
    expect(claim?.by).toBe(currentActor());
    expect(claim?.session_id).toBe("3de02220");
  });

  it("BOUNDARY: $CLAUDE_SESSION_ID is honored when $CLAUDE_CODE_SESSION_ID is unset", async () => {
    const { phaseSlugs } = await createPlanWithPhases([[SHARED_ANCHOR]]);
    setSessionEnv("CLAUDE_SESSION_ID", "7ab19c04-fallback");

    const claimed = await withApp(async (app) => {
      const service = app.phaseWorkflowService;
      if (service === undefined) throw new Error("phaseWorkflowService not wired on App");
      return service.claim(phaseSlugs[0]!, { by: currentActor() });
    });
    expect(claimed.ok).toBe(true);
    expect(readClaim(await fetchDoc(phaseSlugs[0]!))?.session_id).toBe("7ab19c04");
  });

  it("STATE: ONE actor in ONE session holds TWO overlapping phases — claim PERMITS and the pre-flight agrees", async () => {
    const { phaseSlugs } = await createPlanWithPhases([[SHARED_ANCHOR], [SHARED_ANCHOR]]);
    setSessionEnv("CLAUDE_CODE_SESSION_ID", "3de02220-one-session");

    const first = await withApp(async (app) => {
      const service = app.phaseWorkflowService;
      if (service === undefined) throw new Error("phaseWorkflowService not wired on App");
      return service.claim(phaseSlugs[0]!, { by: currentActor() });
    });
    expect(first.ok).toBe(true);

    // PRE-FLIGHT first, on the exact state the real claim is about to see.
    const preflight = await runPreflight(phaseSlugs[1]!);
    expect(preflight.exitCode).toBe(0);
    expect(preflight.stdout).toContain("gate: pass");

    const second = await withApp(async (app) => {
      const service = app.phaseWorkflowService;
      if (service === undefined) throw new Error("phaseWorkflowService not wired on App");
      return service.claim(phaseSlugs[1]!, { by: currentActor() });
    });
    expect(second.ok).toBe(true);
    expect(readClaim(await fetchDoc(phaseSlugs[1]!))?.session_id).toBe("3de02220");
  });

  it("NEGATIVE: ONE actor, TWO sessions — claim REFUSES as foreign and the pre-flight agrees (exit 4)", async () => {
    const { phaseSlugs } = await createPlanWithPhases([[SHARED_ANCHOR], [SHARED_ANCHOR]]);

    setSessionEnv("CLAUDE_CODE_SESSION_ID", "3de02220-first");
    const first = await withApp(async (app) => {
      const service = app.phaseWorkflowService;
      if (service === undefined) throw new Error("phaseWorkflowService not wired on App");
      return service.claim(phaseSlugs[0]!, { by: currentActor() });
    });
    expect(first.ok).toBe(true);

    // A SECOND live orchestrator: identical actor string, identical checkout, its own
    // session id — the exact topology the anchor mutex must still refuse.
    setSessionEnv("CLAUDE_CODE_SESSION_ID", "7ab19c04-second");
    const preflight = await runPreflight(phaseSlugs[1]!);
    expect(preflight.exitCode).toBe(4);
    expect(preflight.stdout).toContain("ANCHOR_OVERLAP");
    expect(preflight.stdout).not.toContain("ANCHOR_OVERLAP_SESSION_UNMEASURED");

    const second = await withApp(async (app) => {
      const service = app.phaseWorkflowService;
      if (service === undefined) throw new Error("phaseWorkflowService not wired on App");
      return service.claim(phaseSlugs[1]!, { by: currentActor() });
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect((second.error as { field?: string }).field).toBe("gate:phase-claim:anchor-overlap");
      expect(JSON.stringify(second.error)).not.toContain("ANCHOR_OVERLAP_SESSION_UNMEASURED");
    }
    expect(readClaim(await fetchDoc(phaseSlugs[1]!))).toBeUndefined();
  });

  it("REGRESSION: with NO session env, BOTH surfaces refuse with the explicit not-measured marker", async () => {
    const { phaseSlugs } = await createPlanWithPhases([[SHARED_ANCHOR], [SHARED_ANCHOR]]);
    setSessionEnv(null);

    const first = await withApp(async (app) => {
      const service = app.phaseWorkflowService;
      if (service === undefined) throw new Error("phaseWorkflowService not wired on App");
      return service.claim(phaseSlugs[0]!, { by: currentActor() });
    });
    expect(first.ok).toBe(true);
    expect(readClaim(await fetchDoc(phaseSlugs[0]!))?.session_id).toBeUndefined();

    const preflight = await runPreflight(phaseSlugs[1]!);
    expect(preflight.exitCode).toBe(4);
    expect(preflight.stdout).toContain("ANCHOR_OVERLAP_SESSION_UNMEASURED");

    const second = await withApp(async (app) => {
      const service = app.phaseWorkflowService;
      if (service === undefined) throw new Error("phaseWorkflowService not wired on App");
      return service.claim(phaseSlugs[1]!, { by: currentActor() });
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(JSON.stringify(second.error)).toContain("ANCHOR_OVERLAP_SESSION_UNMEASURED");
    }
  });
});
