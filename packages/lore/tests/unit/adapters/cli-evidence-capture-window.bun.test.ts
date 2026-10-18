/**
 * Tests for `lore evidence --capture`'s CONFIG-OWNED capture window, end to end
 * through the real command against a throwaway corpus.
 *
 * Defect (task-lore-evidence-capture-has-a-hard-coded-600s-window-that-a): the window
 * was the module constant `CAPTURE_TIMEOUT_MS` (600s), so a legitimately-scoped oracle
 * that outgrew it — measured: `bun run test:changed <base>`, this repo's OWN mandated
 * worktree oracle, at ~624s on a `@lore/core` edit selecting 482 files — could not be
 * captured at all. Since `--capture` is the ONLY producer of a `capture_source:
 * "runner"` row and `lore done`'s attested-pass floor accepts nothing weaker, the
 * disciplined path terminated in a `"self-report"` row reached via `--output-tail-file`.
 *
 * The sibling file `evidence-capture-window.test.ts` (vitest) covers the pure
 * `captureOracleCommand` outcome logic. THIS file covers the two things only the CLI
 * surface can prove:
 *   1. the config key is actually WIRED — `workflow.evidence.capture_timeout_ms` in a
 *      real `.lore/config.yaml` changes real behavior, in BOTH directions (a knob
 *      verified one way is indistinguishable from an inert one —
 *      knowledge-retro-a-silently-inert-cli-flag-is-the-fifth-false), and
 *   2. a timed-out capture writes NO EVIDENCE ROW AT ALL. Asserted as the ABSENCE of
 *      any row in `extra.verification_evidence`, not merely as the presence of an
 *      error message — the whole point of the defect is that the weaker
 *      `capture_source: "self-report"` class must not quietly absorb a failed capture.
 *
 * Uses bun:test (not vitest): `commands/evidence.ts` imports `loadLoreApp`/
 * `loadProjectConfig` from `../loader.js`, which imports `bun:sqlite` transitively via
 * `app.ts` — mirrors this directory's other `.bun.test.ts` files, whose fixture setup
 * this file reuses.
 *
 * ⛔ Throwaway corpus only (`mkdtemp` + `createApp`, cwd inside it) — never this repo's
 * own `.lore/`.
 *
 * Six-dimension coverage:
 *   HAPPY      — a command inside a configured window records a `capture_source:
 *                "runner"` row
 *   NEGATIVE   — a command exceeding the configured window exits 4, names the window /
 *                elapsed / knob, and writes NOTHING
 *   BOUNDARY   — both directions of the key on the SAME command; and a corpus with NO
 *                config key keeps the 600s default (a 1s command is not refused)
 *   ERROR      — a malformed `capture_timeout_ms` degrades to the default window
 *                (loader.ts's documented pre-existing non-`ai` fallback), asserted as
 *                MEASURED behavior and named as a residual rather than claimed fixed
 *   STATE      — evidence count is 0 before AND after a timed-out attempt, then
 *                exactly 1 after a successful one against the SAME task
 *   REGRESSION — a fast command's row is unchanged: `capture_source: "runner"`, real
 *                exit code cross-checked, `output_tail` still truncated at 4000
 *
 * @spec_ref task-lore-evidence-capture-has-a-hard-coded-600s-window-that-a
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
const spyOn = vi.spyOn.bind(vi);
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { createApp } from "../../../src/app.js";
import {
  loadConfigFromString,
  resolveCaptureTimeoutMs,
  type CreateDocInput,
  type EvidenceEntry,
} from "@lore/core";
import { liveInvocation, liveAmbient, liveWriteContext, runHandlerForExit } from "../../live-invocation.js";
import type { Invocation } from "@lore/core";

type RunnableCommand = {
  run: (ctx: { args: Record<string, unknown>; inv?: Invocation }) => Promise<void>;
};

async function importEvidenceCommand(): Promise<RunnableCommand> {
  const mod = await import("../../../src/adapters/cli/commands/evidence.js");
  const cmd = (mod as { default?: { run?: RunnableCommand["run"] } }).default;
  if (!cmd?.run) throw new Error("evidence command not exported");
  return cmd as RunnableCommand;
}

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = resolve(mkdtempSync(join(tmpdir(), "lore-cli-capture-window-test-")));
  mkdirSync(join(tmpDir, ".lore"), { recursive: true });
  const app = createApp(join(tmpDir, ".lore", "lore.db"), undefined, liveAmbient(), liveWriteContext());
  app.close();
  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

/**
 * Writes `.lore/config.yaml` with the given capture window. `rawValue` is interpolated
 * unquoted so malformed values (`0`, `"abc"`) are testable.
 *
 * ⛔ The `project:` block is REQUIRED by `LoreConfigSchema` (`name` + `author`, both
 * non-optional). An earlier draft of this helper emitted only the `workflow:` section;
 * the config then failed to parse, `loadProjectConfig()` degraded to `undefined`, and
 * EVERY test in this file silently exercised the 600s default instead of the window it
 * meant to set — the timeout tests failed and the pass tests passed for the wrong
 * reason. A config fixture that does not round-trip through the real schema measures
 * nothing, so {@link configRoundTrips} asserts parseability directly.
 */
function writeCaptureWindowConfig(rawValue: string): void {
  writeFileSync(
    join(tmpDir, ".lore", "config.yaml"),
    "project:\n" +
      "  name: capture-window-fixture\n" +
      "  author: tester\n" +
      "workflow:\n" +
      "  evidence:\n" +
      `    capture_timeout_ms: ${rawValue}\n`,
    "utf8",
  );
}

/** True when the on-disk fixture config parses AND resolves to `expectedMs`. */
function configRoundTrips(expectedMs: number): boolean {
  const parsed = loadConfigFromString(
    readFileSync(join(tmpDir, ".lore", "config.yaml"), "utf8"),
  );
  return parsed.ok && resolveCaptureTimeoutMs(parsed.value) === expectedMs;
}

async function seedTask(): Promise<string> {
  const app = createApp(join(tmpDir, ".lore", "lore.db"), undefined, liveAmbient(), liveWriteContext());
  try {
    const plan = await app.corpusService.create({
      type: "plan",
      title: "Capture Window Test Plan",
      content: "body",
    } as CreateDocInput);
    if (!plan.ok) throw new Error(`seed plan failed: ${JSON.stringify(plan.error)}`);

    const task = await app.corpusService.create({
      type: "task",
      title: "Capture Window Test Task",
      parent_id: plan.value.id,
      content: "body",
      extra: { plan_id: plan.value.id },
    } as CreateDocInput);
    if (!task.ok) throw new Error(`seed task failed: ${JSON.stringify(task.error)}`);
    return task.value.slug;
  } finally {
    app.close();
  }
}

/**
 * Reads the task's evidence array straight from the store — the absence assertion's
 * oracle.
 *
 * ⛔ Fails LOUD when the doc or its `extra` is missing, rather than `?? []`-ing to an
 * empty array. An earlier draft of this helper defaulted, and a shape mismatch
 * (`CorpusService.get` returns `DocWithNavigation`, so the record is `value.doc`, not
 * `value`) then read as "0 evidence rows" — which is exactly the assertion every
 * absence test here makes, so the whole file would have passed vacuously while
 * measuring nothing. A silent default in an ABSENCE oracle is indistinguishable from
 * the property under test.
 */
async function readEvidence(taskSlug: string): Promise<EvidenceEntry[]> {
  const app = createApp(join(tmpDir, ".lore", "lore.db"), undefined, liveAmbient(), liveWriteContext());
  try {
    const got = await app.corpusService.get(taskSlug);
    if (!got.ok) throw new Error(`read task failed: ${JSON.stringify(got.error)}`);
    const doc = got.value.doc;
    if (doc === undefined) throw new Error("CorpusService.get returned no `doc` — shape changed");
    const extra = doc.extra as { verification_evidence?: EvidenceEntry[] } | undefined;
    if (extra === undefined) return [];
    const rows = extra.verification_evidence;
    if (rows === undefined) return [];
    if (!Array.isArray(rows)) throw new Error(`verification_evidence is not an array: ${typeof rows}`);
    return rows;
  } finally {
    app.close();
  }
}

/** Captures everything written to stderr (where every refusal is rendered). */
function captureStderr(): { text: () => string; restore: () => void } {
  const chunks: string[] = [];
  const spy = spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  });
  return { text: () => chunks.join(""), restore: () => spy.mockRestore() };
}

async function runCapture(
  taskSlug: string,
  command: string,
  result = "pass",
): Promise<{ stderr: string; stdout: string; exitCode: number }> {
  const cmd = await importEvidenceCommand();
  const stderr = captureStderr();
  const logLines: string[] = [];
  const logSpy = spyOn(process.stdout, "write").mockImplementation((((chunk: unknown) => {
    const args: unknown[] = [String(chunk).replace(/\n$/, "")];
    logLines.push(String(args[0]));
  
    return true;
  }) as never));
  try {
    const exitCode = await runHandlerForExit(() => cmd.run({
      args: { task: taskSlug, oracle: "tsc", command, result, capture: true },
 inv: liveInvocation(),
    }));
    return { stderr: stderr.text(), stdout: logLines.join("\n"), exitCode };
  } finally {
    logSpy.mockRestore();
    stderr.restore();
  }
}

/** Records evidence WITHOUT `--capture` — the control for the success-line shape. */
// reason: SUPERSEDED oracle (task-raise-the-evidence-tail-guard-s-predicate-
// to-its-own) — "tsc" self-report is now refused regardless of tail content;
// "manual" is the one oracle that still lets a genuinely non-empty
// self-reported tail succeed. This helper's caller asserts on the rendered
// success line's SHAPE (no capture-margin suffix leaking onto self-report),
// not on the "tsc" oracle name specifically — the call site below updates its
// expected substring to match.
async function runSelfReport(taskSlug: string): Promise<string> {
  const cmd = await importEvidenceCommand();
  const logLines: string[] = [];
  const logSpy = spyOn(process.stdout, "write").mockImplementation((((chunk: unknown) => {
    const args: unknown[] = [String(chunk).replace(/\n$/, "")];
    logLines.push(String(args[0]));
  
    return true;
  }) as never));
  try {
    await runHandlerForExit(() => cmd.run({
      args: {
        task: taskSlug,
        oracle: "manual",
        command: "bun run typecheck",
        result: "pass",
        "output-tail": "0 errors",
      },
 inv: liveInvocation(),
    }));
    return logLines.join("\n");
  } finally {
    logSpy.mockRestore();
  }
}

// ─── HAPPY ───────────────────────────────────────────────────────────────────

describe("lore evidence --capture window — HAPPY", () => {
  it("CAPCLI-H1: a command inside the CONFIGURED window records one capture_source=runner row", async () => {
    writeCaptureWindowConfig("30000");
    const taskSlug = await seedTask();

    const { exitCode } = await runCapture(taskSlug, "echo inside-window");

    expect(exitCode).toBe(0);
    const evidence = await readEvidence(taskSlug);
    expect(evidence.length).toBe(1);
    expect(evidence[0]?.capture_source).toBe("runner");
  });
});

// ─── NEGATIVE ────────────────────────────────────────────────────────────────

describe("lore evidence --capture window — NEGATIVE", () => {
  it("CAPCLI-N1: exceeding the configured window exits 4 and writes NO evidence row (absence asserted, not just the message)", async () => {
    writeCaptureWindowConfig("300");
    // guard: prove the fixture is a REAL config the schema accepts, so a refusal
    // below cannot be credited to an unparseable file falling back to the default
    expect(configRoundTrips(300)).toBe(true);
    const taskSlug = await seedTask();

    const { exitCode } = await runCapture(taskSlug, "sleep 5");

    expect(exitCode).toBe(4);
    const evidence = await readEvidence(taskSlug);
    expect(evidence.length).toBe(0);
  });

  it("CAPCLI-N2: no row of ANY capture_source is written — least of all the weaker self-report class this defect degraded into", async () => {
    writeCaptureWindowConfig("300");
    const taskSlug = await seedTask();

    await runCapture(taskSlug, "sleep 5");

    const evidence = await readEvidence(taskSlug);
    expect(evidence.map((e) => e.capture_source)).not.toContain("self-report");
    expect(evidence.map((e) => e.capture_source)).not.toContain("runner");
    expect(evidence).toEqual([]);
  });

  it("CAPCLI-N3: the refusal names the timeout, the configured window, the elapsed time and the config knob — with no hedging", async () => {
    writeCaptureWindowConfig("300");
    const taskSlug = await seedTask();

    const { stderr } = await runCapture(taskSlug, "sleep 5");

    expect(stderr.toLowerCase()).toContain("timed out");
    expect(stderr).toContain("300");
    expect(stderr).toContain("workflow.evidence.capture_timeout_ms");
    expect(stderr).toMatch(/\d+ms/);
    for (const hedge of ["possibly", "maybe", "perhaps"]) {
      expect(stderr.toLowerCase()).not.toContain(hedge);
    }
    // and it is NOT the misleading pre-fix wording
    expect(stderr).not.toContain("failed to spawn");
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────────────

describe("lore evidence --capture window — BOUNDARY", () => {
  it("CAPCLI-B1: BOTH directions of the config key on the SAME command — 300ms refuses and records nothing, 30000ms captures one row", async () => {
    // direction 1: window too small
    writeCaptureWindowConfig("300");
    expect(configRoundTrips(300)).toBe(true);
    const refusedTask = await seedTask();
    const refused = await runCapture(refusedTask, "sleep 1");
    expect(refused.exitCode).toBe(4);
    expect(await readEvidence(refusedTask)).toEqual([]);

    // direction 2: same command, generous window — proves the key is not merely
    // "always refuse" (an inert knob passes a one-directional test either way)
    writeCaptureWindowConfig("30000");
    expect(configRoundTrips(30_000)).toBe(true);
    const allowedTask = await seedTask();
    const allowed = await runCapture(allowedTask, "sleep 1");
    expect(allowed.exitCode).toBe(0);
    const evidence = await readEvidence(allowedTask);
    expect(evidence.length).toBe(1);
    expect(evidence[0]?.capture_source).toBe("runner");
  });

  it("CAPCLI-B2: a corpus with NO config file keeps the 600s default — a 1s command is captured, not refused (upgrade preserves behavior)", async () => {
    // deliberately no writeCaptureWindowConfig() call at all
    const taskSlug = await seedTask();

    const { exitCode } = await runCapture(taskSlug, "sleep 1");

    expect(exitCode).toBe(0);
    expect((await readEvidence(taskSlug)).length).toBe(1);
  });
});

// ─── ERROR ───────────────────────────────────────────────────────────────────

describe("lore evidence --capture window — ERROR", () => {
  it("CAPCLI-E1: a malformed capture_timeout_ms degrades to the DEFAULT window (loader.ts's documented pre-existing non-`ai` fallback) — measured, not claimed fixed", async () => {
    // 0 violates the schema's .positive(), so the whole config fails to parse and
    // `loadProjectConfig()` returns undefined. This is loader.ts's long-standing
    // silent fallback for every non-`ai` section (an explicit SPEC-030 non-goal),
    // NOT something this change introduced — and NOT something it fixes. Pinning the
    // real behavior here so a future loader-level fix has a failing test to flip
    // rather than a silent semantics change.
    writeCaptureWindowConfig("0");
    // the degradation is MEASURED, not assumed: this config genuinely does not parse
    const parsed = loadConfigFromString(readFileSync(join(tmpDir, ".lore", "config.yaml"), "utf8"));
    expect(parsed.ok).toBe(false);
    const taskSlug = await seedTask();

    const { exitCode } = await runCapture(taskSlug, "sleep 1");

    // the 600s default applied, so a 1s command still captured
    expect(exitCode).toBe(0);
    expect((await readEvidence(taskSlug)).length).toBe(1);
  });
});

// ─── STATE ───────────────────────────────────────────────────────────────────

describe("lore evidence --capture window — STATE", () => {
  it("CAPCLI-S1: the SAME task goes 0 rows → (timed-out attempt) → still 0 rows → (successful capture) → exactly 1 row", async () => {
    writeCaptureWindowConfig("300");
    expect(configRoundTrips(300)).toBe(true);
    const taskSlug = await seedTask();
    expect(await readEvidence(taskSlug)).toEqual([]);

    await runCapture(taskSlug, "sleep 5");
    expect(await readEvidence(taskSlug)).toEqual([]);
    writeCaptureWindowConfig("30000");
    const ok = await runCapture(taskSlug, "echo now-it-fits");
    expect(ok.exitCode).toBe(0);
    const evidence = await readEvidence(taskSlug);
    expect(evidence.length).toBe(1);
    expect(evidence[0]?.capture_source).toBe("runner");
  });
});

// ─── REGRESSION ──────────────────────────────────────────────────────────────

describe("lore evidence --capture window — REGRESSION", () => {
  it("CAPCLI-R1: a fast command's row is unchanged — capture_source runner, real output captured into output_tail", async () => {
    writeCaptureWindowConfig("30000");
    const taskSlug = await seedTask();

    const { exitCode } = await runCapture(taskSlug, "echo regression-marker-abc");

    expect(exitCode).toBe(0);
    const evidence = await readEvidence(taskSlug);
    expect(evidence.length).toBe(1);
    expect(evidence[0]?.capture_source).toBe("runner");
    expect(evidence[0]?.output_tail).toContain("regression-marker-abc");
    expect(evidence[0]?.result).toBe("pass");
  });

  it("CAPCLI-R2: output_tail is still truncated at exactly 4000 chars under a configured window", async () => {
    writeCaptureWindowConfig("30000");
    const taskSlug = await seedTask();

    const { exitCode } = await runCapture(taskSlug, "printf 'x%.0s' $(seq 1 5000)");

    expect(exitCode).toBe(0);
    const evidence = await readEvidence(taskSlug);
    expect(evidence[0]?.output_tail?.length).toBe(4000);
  });

  it("CAPCLI-R4: a successful capture's success line reports elapsed-vs-window, making the margin visible before the run that crosses it", async () => {
    writeCaptureWindowConfig("30000");
    const taskSlug = await seedTask();

    const { stdout } = await runCapture(taskSlug, "echo margin-check");

    expect(stdout).toContain("Recorded");
    expect(stdout).toMatch(/captured in \d+ms of a 30000ms window/);
  });

  it("CAPCLI-R5: a NON-capture write's success line is unchanged — no margin suffix leaks onto the self-report path", async () => {
    writeCaptureWindowConfig("30000");
    const taskSlug = await seedTask();

    const line = await runSelfReport(taskSlug);

    expect(line).toContain("Recorded manual evidence (pass)");
    // ⛔ Key on the SUFFIX MARKER, not on the bare word "window": the fixture task's
    // own slug is `task-capture-window-test-task`, so a `not.toContain("window")`
    // assertion fails against the doc's own name — a false positive manufactured by
    // the fixture, the mirror image of this repo's contiguous-substring lesson.
    expect(line).not.toMatch(/captured in \d+ms of a \d+ms window/);
    expect(line).not.toContain("captured in");
    // the margin suffix is bracketed; an unchanged line carries no bracket at all
    expect(line).not.toContain("[");
  });

  it("CAPCLI-R3: a declared/observed exit-code mismatch inside the window still refuses on `result` and records nothing — distinct from a timeout", async () => {
    writeCaptureWindowConfig("30000");
    const taskSlug = await seedTask();

    const { stderr, exitCode } = await runCapture(taskSlug, "exit 3", "pass");

    expect(exitCode).toBe(4);
    expect(stderr).toContain("observed exit code 3");
    expect(stderr.toLowerCase()).not.toContain("timed out");
    expect(await readEvidence(taskSlug)).toEqual([]);
  });
});
