// @spawns packages/lore/src/index.ts
/**
 * @spec_ref IoC vertical-slice tech-spec §9 AC6 — end-to-end closed-loop proof that the
 * spec-production inversion-of-control slice actually works together: a non-compliant
 * spec-creation candidate is intercepted BEFORE creation (`lore gate spec-create`), a
 * corrected candidate passes and is actually created, the resulting spec is blocked from
 * promotion until it carries a structured acceptance criterion (`lore gate spec-promote`),
 * and adding one AC flips the promotion gate to pass.
 *
 * bun test (not vitest): drives the real `gate.ts` command module in-process against a
 * real `SQLiteStore` (`createApp()`), the SAME in-process idiom
 * `gate-spec-promote.bun.test.ts` establishes (chdir into a throwaway temp corpus, import
 * the command module directly, call its `run()`, capture stdout/stderr/exitCode) — chosen
 * over subprocess spawn for speed and determinism, exactly as that file's header explains.
 *
 * ⛔ Never touches the repo's own `.lore/` corpus (project CLAUDE.md hard rule) — every
 * test operates inside its own `mkdtempSync` directory, and the outer suite asserts
 * `git status --short .lore docs/requirements` is empty both before and after the
 * full run (SPEC-OX D3): the widened scope covers mirror-content dirt under
 * `docs/requirements/**`, which a `.lore`-only invocation could never see. The
 * decision logic lives in the pure predicate `checkRepoPollution`
 * (`../../src/repo-pollution-guard.ts`) — this file is only the wiring that feeds it
 * real `git status` output and prints the offending paths on rejection.
 *
 * Closed loop under test (tech-spec §9 AC6), six steps:
 *   1. gate spec-create on a candidate that names a parent → exit 4, feeding pack (BR-2).
 *   2. gate spec-create on the corrected (parentless) one  → exit 0 (BR-1).
 *   3. actually create that spec via CorpusService.create  → specId obtained.
 *   4. gate spec-promote on the fresh spec (0 AC)          → exit 4.
 *   5. add one structured AC via AcService.addCriterion.
 *   5b. gate spec-promote again (1 AC, uncited)             → exit 4 naming `lore ac cite` (BR-1007,
 *       issue #137: the gate agrees with the approval that would refuse it), then `lore ac cite`.
 *   6. gate spec-promote again (1 AC, cited)               → exit 0.
 *
 * Coverage dimensions: HAPPY (steps 2/3/5/6, the compliant path) / NEGATIVE (steps 1/4,
 * two independent blocks) / BOUNDARY (step 6 — exactly one AC is enough) / ERROR (no
 * seeded rule doc still reports "Missing:" reasons) / STATE (create's before/after effect
 * on the promote gate) / REGRESSION (LORE_GATE_BYPASS=1 skips the entire chain).
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join, resolve, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { createApp, type App } from "../../src/app.js";
import { saveConfig } from "@lore/core/node";
import { checkRepoPollution } from "../../src/repo-pollution-guard.js";
import { citeSpecViaCli, type LoreRunner } from "../helpers/cli-live-rule.js";
import type { CreateDocInput } from "@lore/core";

/**
 * `scripts/` lives outside `packages/lore/tsconfig.tests.json`'s `rootDir` (scoped to
 * the `@lore/lore` workspace package), so a static `import` of the seed script would
 * fail `tsc --noEmit` with TS6059 even though bun's runtime resolver handles the
 * relative path fine. Building the specifier as a runtime `string` (not a string-literal
 * syntax form) makes TypeScript treat the dynamic `import()` as `Promise<any>` and skip
 * static module resolution — the same escape hatch
 * `tests/unit/service/seed-write-spec-rule.bun.test.ts` documents and uses.
 */
const SEED_SCRIPT_PATH: string = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "scripts",
  "seed-write-spec-rule.ts",
);

interface SeedWriteSpecRuleModule {
  seedWriteSpecRule: (app: App) => Promise<{ slug: string; created: boolean }>;
}

const { seedWriteSpecRule } = (await import(SEED_SCRIPT_PATH)) as unknown as SeedWriteSpecRuleModule;

// ─── Command type + importer (mirrors gate-spec-promote.bun.test.ts) ─────────

type RunnableCommand = { run: (ctx: { args: Record<string, unknown> }) => Promise<void> };

async function importGateCommand(
  sub: "spec-create" | "spec-promote",
): Promise<RunnableCommand> {
  const mod = await import("../../src/adapters/cli/commands/gate.js");
  const group = (mod as { default?: { subCommands?: Record<string, unknown> } }).default;
  const cmd = group?.subCommands?.[sub] as { run?: RunnableCommand["run"] } | undefined;
  if (!cmd?.run) throw new Error(`gate ${sub} command not exported`);
  return cmd as RunnableCommand;
}

// ─── Output / exit capture (mirrors gate-spec-promote.bun.test.ts) ───────────

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

// Repo root (two levels above packages/lore) — where the team's real `.lore/` corpus
// lives; the pollution guard below checks THIS path, not packages/lore's own root.
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");

/**
 * Repo-corpus pollution guard wiring (SPEC-OX D3, AC-OX-2): run the real, widened
 * `git status --short` invocation against the repo root and feed its output to the
 * pure predicate in `repo-pollution-guard.ts`. On rejection, PRINTS the offending
 * paths (via `console.error`) before throwing — a bare boolean would reproduce the
 * attribution cost this spec exists to remove, since the predicate already computed
 * exactly which paths are dirty.
 *
 * Wired below as file-scope `beforeAll`/`afterAll` (NOT nested inside any
 * `describe`), so it genuinely wraps the WHOLE file's test run — both the IoC
 * closed-loop suite above and this file's own pollution-guard tests — rather than
 * only whichever describe block happens to contain it. That is what makes "before
 * AND after" real: a run cannot pass by dirtying the tree only at the end.
 *
 * @param phase which side of the suite this invocation is guarding, used only for
 *   the printed report.
 * @throws if the scoped `git status --short` output is non-empty.
 */
function assertRepoCorpusClean(phase: "before" | "after"): void {
  const output = execSync("git status --short .lore docs/requirements", { cwd: REPO_ROOT }).toString();
  const verdict = checkRepoPollution(output);
  if (verdict.clean) return;
  const report = [
    `repo-pollution-guard: repo corpus is dirty ${phase} this suite ran.`,
    "Offending paths (git status --short .lore docs/requirements):",
    ...verdict.offendingPaths.map((path) => `  - ${path}`),
  ].join("\n");
  console.error(report);
  throw new Error(report);
}

beforeAll(() => {
  assertRepoCorpusClean("before");
});

afterAll(() => {
  assertRepoCorpusClean("after");
});

let tmpDir: string;
let dbPath: string;
let originalCwd: string;
let originalEnv: string | undefined;

beforeEach(() => {
  process.exitCode = 0;
  originalEnv = process.env["LORE_GATE_BYPASS"];
  delete process.env["LORE_GATE_BYPASS"];

  tmpDir = resolve(mkdtempSync(join(tmpdir(), "lore-spec-loop-e2e-test-")));
  const loreDir = join(tmpDir, ".lore");
  mkdirSync(loreDir, { recursive: true });
  dbPath = join(loreDir, "lore.db");

  const app = createApp(dbPath);
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

const COMPLIANT_CONTENT =
  "## Overview\n\nSome text.\n\n## Scope\n\nIn scope.\n\n## Acceptance Criteria\n\n- AC1\n";

/** Create a PRD (legal spec parent), returning its slug. */
async function createPrd(title: string): Promise<string> {
  const app = createApp(dbPath);
  try {
    const result = await app.corpusService.create({
      type: "prd",
      title,
      content: "PRD body for spec-loop e2e test.",
    } as CreateDocInput);
    if (!result.ok) throw new Error(`prd create failed: ${JSON.stringify(result.error)}`);
    return result.value.slug;
  } finally {
    app.close();
  }
}

/** A candidate the gate must refuse: a spec takes no parent (BR-2), so naming one is the violation. */
function parentedPayload(parentSlug: string): Record<string, unknown> {
  return {
    type: "spec",
    title: "A well-formed spec",
    parent_id: parentSlug,
    content: COMPLIANT_CONTENT,
    extra: { spec_kind: "tech" },
  };
}

// reason: BR-1 - the corrected candidate carries no parent; the argument is kept so callers read the same.
function compliantPayload(_parentSlug: string): Record<string, unknown> {
  return {
    type: "spec",
    title: "A well-formed spec",
    content: COMPLIANT_CONTENT,
    extra: { spec_kind: "tech" },
  };
}

async function runGateSpecCreate(payload: Record<string, unknown>) {
  const cmd = await importGateCommand("spec-create");
  const output = captureOutput();
  try {
    await cmd.run({ args: { "input-json": JSON.stringify(payload) } });
  } finally {
    output.restore();
  }
  return { exitCode: process.exitCode, stdout: output.stdout.join("\n"), stderr: output.stderr.join("") };
}

async function runGateSpecPromote(specIdOrSlug: string) {
  const cmd = await importGateCommand("spec-promote");
  const output = captureOutput();
  try {
    await cmd.run({ args: { spec: specIdOrSlug } });
  } finally {
    output.restore();
  }
  return { exitCode: process.exitCode, stdout: output.stdout.join("\n"), stderr: output.stderr.join("") };
}

/** Actually create the spec (step 3 of the loop — not a gate call, the real creation). */
async function createSpec(parentSlug: string): Promise<{ specId: string; specSlug: string }> {
  const app = createApp(dbPath);
  try {
    const result = await app.corpusService.create(compliantPayload(parentSlug) as CreateDocInput);
    if (!result.ok) throw new Error(`spec create failed: ${JSON.stringify(result.error)}`);
    return { specId: result.value.id, specSlug: result.value.slug };
  } finally {
    app.close();
  }
}

/**
 * Cites the criterion at a live rule through the real CLI (BR-1007) — shared fixture, see
 * helpers/cli-live-rule.ts. Runs as subprocesses against this test's throwaway corpus, after the
 * in-process apps have released the database.
 */
function citeLiveRule(prdSlug: string, specId: string, acId: string): void {
  const entry = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "index.ts");
  const env: Record<string, string | undefined> = { ...process.env, HOME: tmpDir, CLAUDECODE: "1", LORE_ACTOR: "agent:spec-loop-e2e-test" };
  delete env["LORE_GATE_BYPASS"];
  const lore: LoreRunner = (args) => {
    const proc = Bun.spawnSync(["bun", "run", entry, ...args], { cwd: tmpDir, env });
    if ((proc.exitCode ?? 1) !== 0) {
      throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${proc.exitCode}): ${proc.stderr.toString()}${proc.stdout.toString()}`);
    }
    return proc.stdout.toString();
  };
  citeSpecViaCli(lore, tmpDir, prdSlug, specId, acId);
}

async function addAcceptanceCriterion(specId: string): Promise<void> {
  const app = createApp(dbPath);
  try {
    if (app.acService === undefined) throw new Error("AcService not wired");
    const result = await app.acService.addCriterion(specId, {
      id: "AC-LOOP-1",
      statement: "The closed loop actually completes end to end.",
      verify: { mode: "human" },
    });
    if (!result.ok) throw new Error(`addCriterion failed: ${JSON.stringify(result.error)}`);
  } finally {
    app.close();
  }
}

/**
 * Points `ai.provider` at a definitely-nonexistent binary so `gate spec-promote`'s
 * best-effort judge advisory (INV2, disposable and stderr-only) fails fast with a
 * deterministic ENOENT instead of hanging on a real `claude` binary that might be
 * reachable on this sandbox's $PATH and block waiting on stdin — the same AC-AI-5
 * idiom `gate-spec-promote.bun.test.ts` documents and relies on.
 */
function suppressJudgeAdvisory(): void {
  saveConfig(tmpDir, {
    project: { name: "spec-loop-e2e-test", author: "tester" },
    ai: {
      provider: "claude-cli",
      providers: { "claude-cli": { command: "ghost-ai-binary-not-installed-xyz", args: [], timeout_ms: 5000 } },
      templates: {},
      telemetry: false,
    },
  } as never);
}

async function countDocs(): Promise<number> {
  const app = createApp(dbPath);
  try {
    const result = await app.corpusService.list({ type: "spec" });
    if (!result.ok) throw new Error(`list failed: ${JSON.stringify(result.error)}`);
    return result.value.docs.length;
  } finally {
    app.close();
  }
}

// ─── The closed loop (AC6) ─────────────────────────────────────────────────────

describe("spec-production IoC closed loop (tech-spec §9 AC6)", () => {
  it("gate-blocked create -> corrected create -> gate-blocked promote -> AC added -> gate-passed promote", async () => {
    // ── setup: seed the write-spec rule doc + a legal PRD parent ──
    const app = createApp(dbPath);
    await seedWriteSpecRule(app);
    app.close();
    const prdSlug = await createPrd("spec-loop-e2e PRD");
    suppressJudgeAdvisory();

    // ── STATE: before any spec exists, corpus has zero specs ──
    expect(await countDocs()).toBe(0);

    // ── step 1 (NEGATIVE): a candidate naming a parent is intercepted, never reaches creation ──
    const step1 = await runGateSpecCreate(parentedPayload(prdSlug));
    expect(step1.exitCode).toBe(4);
    expect(step1.stdout).toContain("[source:");
    expect(step1.stdout).toContain("Missing:");
    expect(step1.stdout).toContain("a spec takes no parent");

    // ── step 2 (HAPPY): corrected candidate (no parent) passes the pre-flight gate ──
    const step2 = await runGateSpecCreate(compliantPayload(prdSlug));
    expect(step2.exitCode).toBe(0);
    expect(step2.stdout).toContain("gate: pass");

    // ── step 3 (HAPPY / STATE): actually create the spec now that the gate passed ──
    const { specId, specSlug } = await createSpec(prdSlug);
    expect(specId).toBeTruthy();
    expect(await countDocs()).toBe(1); // STATE: create() changed corpus state

    // ── step 4 (NEGATIVE): promotion is blocked — the fresh spec carries zero ACs ──
    const step4 = await runGateSpecPromote(specSlug);
    expect(step4.exitCode).toBe(4);
    expect(step4.stderr).toContain("no structured acceptance criteria");
    expect(step4.stderr).toContain("lore ac add");

    // ── step 5: add exactly one structured AC (BOUNDARY setup — one is the minimum) ──
    await addAcceptanceCriterion(specId);

    // ── step 5b (NEGATIVE, BR-1007): one declared AC is not enough — it must cite a live rule ──
    const step5b = await runGateSpecPromote(specSlug);
    expect(step5b.exitCode).toBe(4);
    expect(step5b.stderr).toContain("lore ac cite");
    citeLiveRule(prdSlug, specId, "AC-LOOP-1");

    // ── step 6 (HAPPY / BOUNDARY): one cited AC is enough to flip the promotion gate to pass ──
    const step6 = await runGateSpecPromote(specSlug);
    expect(step6.exitCode).toBe(0);
    expect(step6.stdout).toContain("gate: pass");
    expect(step6.stdout).toContain("1 acceptance criteria");
  });

  // ── ERROR: feeding pack still reports Missing: reasons even with no seeded rule doc ──
  it("ERROR: gate spec-create still exits 4 with Missing: reasons when the rule doc was never seeded", async () => {
    // Deliberately skip seedWriteSpecRule — the candidate names a parent, so the deterministic
    // gate has no way to pass regardless of the rule doc's presence.
    const result = await runGateSpecCreate(parentedPayload("some-parent"));
    expect(result.exitCode).toBe(4);
    expect(result.stdout).toContain("Missing:");
    expect(result.stdout).toContain("a spec takes no parent");
    expect(result.stdout.toLowerCase()).toContain("seed-write-spec-rule");
  });

  // ── REGRESSION: LORE_GATE_BYPASS=1 short-circuits every step of the chain ──
  it("REGRESSION: LORE_GATE_BYPASS=1 skips both gates entirely, even for maximally non-compliant input", async () => {
    process.env["LORE_GATE_BYPASS"] = "1";

    const createGateResult = await runGateSpecCreate(parentedPayload("some-parent"));
    expect(createGateResult.exitCode).toBe(0);

    const promoteGateResult = await runGateSpecPromote("totally-nonexistent-spec-slug");
    expect(promoteGateResult.exitCode).toBe(0);
  });
});

// ─── Zero-pollution guard on the repo's own .lore/ and docs/requirements/ ─────
//
// The actual assertions run as the file-scope `beforeAll`/`afterAll` hooks declared
// above `assertRepoCorpusClean` (NOT nested in a `describe`), so they wrap this
// ENTIRE file's test run — including the IoC closed-loop describe above — rather
// than only whichever describe block would otherwise contain them. A single `it()`
// placed at the tail of the file, by contrast, would only ever run AFTER every test
// preceding it in file order, never genuinely "before the suite".

describe("spec-loop-e2e.bun.test.ts: repo corpus pollution guard", () => {
  it("is wired via file-scope beforeAll/afterAll hooks feeding checkRepoPollution (see assertRepoCorpusClean above)", () => {
    // A named, addressable result for the wiring's presence — the guarding
    // assertions themselves already ran (before) and will run again (after) as
    // beforeAll/afterAll around the whole file, not around this it() alone.
    expect(typeof assertRepoCorpusClean).toBe("function");
    expect(typeof checkRepoPollution).toBe("function");
  });
});
