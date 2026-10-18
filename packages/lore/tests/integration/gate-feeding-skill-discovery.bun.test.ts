/**
 * @spec_ref IoC vertical-slice tech-spec §4.1/§11, P1 slice-2 — `lore gate spec-create`'s
 * "active feeding" rule-doc lookup discovers its source by `extra.skill.applies_to`
 * (via `CorpusService.findFeedingSkill`) instead of a hardcoded title literal.
 *
 * bun test (not vitest): drives the real `gate.ts` command module in-process against a
 * real `SQLiteStore` (`createApp()`), the same in-process idiom
 * `spec-loop-e2e.bun.test.ts` establishes (chdir into a throwaway temp corpus, import
 * the command module directly, call its `run()`, capture stdout/exitCode) — chosen so
 * assertions can inspect the exact skill-doc slug/content that surfaces in the feeding
 * pack, which a subprocess-spawn harness cannot do without re-parsing stdout twice.
 *
 * ⛔ Never touches the repo's own `.lore/` corpus (project CLAUDE.md hard rule) — every
 * test operates inside its own `mkdtempSync` directory.
 *
 * Coverage dimensions:
 *   HAPPY      — one approved knowledge/skill doc with applies_to="spec" is discovered;
 *                its slug + content surface in the feeding pack.
 *   NEGATIVE   — a second approved skill doc with a DIFFERENT applies_to ("task") never
 *                surfaces in the spec-create feeding pack.
 *   BOUNDARY   — two approved skill docs both applies_to="spec" → the most-recently
 *                updated one wins (findFeedingSkill's "latest" tie-break).
 *   ERROR      — no approved knowledge/skill doc exists at all → placeholder fallback
 *                (backward-compat with the pre-discovery hardcoded-title behaviour).
 *   STATE      — a DRAFT (not yet approved) skill doc with a matching applies_to is
 *                invisible to discovery, same as if it didn't exist.
 *   REGRESSION — discovery never mutates the corpus (doc count unchanged across calls).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { createApp, type App } from "../../src/app.js";
import type { CreateDocInput } from "@lore/core";
import { liveInvocation, liveAmbient, liveWriteContext, runHandlerForExit } from "../live-invocation.js";

/** The exit code the most recent command call ended with (commands return it; none sets `process.exitCode`). */
let lastExitCode = 0;
import type { Invocation } from "@lore/core";

// ─── Command type + importer (mirrors spec-loop-e2e.bun.test.ts) ────────────

type RunnableCommand = { run: (ctx: { args: Record<string, unknown>; inv?: Invocation }) => Promise<void> };

async function importGateSpecCreate(): Promise<RunnableCommand> {
  const mod = await import("../../src/adapters/cli/commands/gate.js");
  const group = (mod as { default?: { subCommands?: Record<string, unknown> } }).default;
  const cmd = group?.subCommands?.["spec-create"] as { run?: RunnableCommand["run"] } | undefined;
  if (!cmd?.run) throw new Error("gate spec-create command not exported");
  return cmd as RunnableCommand;
}

function captureOutput() {
  const stdout: string[] = [];
  const origConsoleLog = process.stdout.write;
  process.stdout.write = (((chunk: unknown) => {
    const args: unknown[] = [String(chunk).replace(/\n$/, "")];
    stdout.push(args.join(" "));
  
    return true;
  }) as typeof process.stdout.write);
  return {
    stdout,
    restore: () => {
      process.stdout.write = origConsoleLog;
    },
  };
}

// ─── Project setup ──────────────────────────────────────────────────────────

let tmpDir: string;
let dbPath: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = resolve(mkdtempSync(join(tmpdir(), "lore-gate-skill-discovery-test-")));
  const loreDir = join(tmpDir, ".lore");
  mkdirSync(loreDir, { recursive: true });
  dbPath = join(loreDir, "lore.db");

  const app = createApp(dbPath, undefined, liveAmbient(), liveWriteContext());
  app.close();

  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

// ─── Fixture helpers ─────────────────────────────────────────────────────────

const NO_PARENT_PAYLOAD: Record<string, unknown> = {
  type: "spec",
  title: "A spec missing its parent",
  content: "just some prose, no headings at all",
};

async function withApp<T>(fn: (app: App) => Promise<T>): Promise<T> {
  const app = createApp(dbPath, undefined, liveAmbient(), liveWriteContext());
  try {
    return await fn(app);
  } finally {
    app.close();
  }
}

/** Creates an approved `knowledge/skill` doc with the given `applies_to` scope. */
async function createApprovedSkillDoc(opts: {
  title: string;
  appliesTo: string;
  content: string;
}): Promise<{ id: string; slug: string }> {
  return withApp(async (app) => {
    const createResult = await app.corpusService.create({
      type: "knowledge",
      title: opts.title,
      content: opts.content,
      extra: { sub_type: "skill", skill: { applies_to: opts.appliesTo } },
    } as CreateDocInput);
    if (!createResult.ok) throw new Error(`skill doc create failed: ${JSON.stringify(createResult.error)}`);

    // draft -> approved is a valid direct (fast-track) transition (SPEC-002 §3).
    const approveResult = await app.corpusService.set(createResult.value.id, { status: "approved" });
    if (!approveResult.ok) throw new Error(`skill doc approve failed: ${JSON.stringify(approveResult.error)}`);

    return { id: createResult.value.id, slug: approveResult.value.slug };
  });
}

/** Creates a DRAFT (never approved) `knowledge/skill` doc — invisible to discovery. */
async function createDraftSkillDoc(opts: {
  title: string;
  appliesTo: string;
  content: string;
}): Promise<{ id: string; slug: string }> {
  return withApp(async (app) => {
    const createResult = await app.corpusService.create({
      type: "knowledge",
      title: opts.title,
      content: opts.content,
      extra: { sub_type: "skill", skill: { applies_to: opts.appliesTo } },
    } as CreateDocInput);
    if (!createResult.ok) throw new Error(`skill doc create failed: ${JSON.stringify(createResult.error)}`);
    return { id: createResult.value.id, slug: createResult.value.slug };
  });
}

/** Bumps a doc's `updated_at` forward by re-approving it (a no-op status re-assert still writes). */
async function touchDoc(id: string): Promise<void> {
  return withApp(async (app) => {
    const result = await app.corpusService.set(id, { status: "approved" });
    if (!result.ok) throw new Error(`touch failed: ${JSON.stringify(result.error)}`);
  });
}

async function runGateSpecCreate(payload: Record<string, unknown>) {
  const cmd = await importGateSpecCreate();
  const output = captureOutput();
  try {
    lastExitCode = await runHandlerForExit(() => cmd.run({ args: { "input-json": JSON.stringify(payload) }, inv: liveInvocation() }));
  } finally {
    output.restore();
  }
  return { exitCode: lastExitCode, stdout: output.stdout.join("\n") };
}

async function countDocs(): Promise<number> {
  return withApp(async (app) => {
    const result = await app.corpusService.list({ type: "knowledge" });
    if (!result.ok) throw new Error(`list failed: ${JSON.stringify(result.error)}`);
    return result.value.docs.length;
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("lore gate spec-create — feeding skill discovery by applies_to", () => {
  // HAPPY
  it("discovers an approved knowledge/skill doc scoped applies_to=spec and feeds its slug + content", async () => {
    const skill = await createApprovedSkillDoc({
      title: "Custom write-spec rules",
      appliesTo: "spec",
      content: "## Rule\n\nDiscoverable-by-applies-to marker content.",
    });

    const result = await runGateSpecCreate(NO_PARENT_PAYLOAD);

    expect(result.exitCode).toBe(4);
    expect(result.stdout).toContain(`[source: ${skill.slug}`);
    expect(result.stdout).toContain("Discoverable-by-applies-to marker content.");
  });

  // NEGATIVE
  it("ignores an approved skill doc scoped to a different applies_to (task, not spec)", async () => {
    await createApprovedSkillDoc({
      title: "Task-scoped rules",
      appliesTo: "task",
      content: "## Rule\n\nTask-only marker content — must never leak into spec-create.",
    });
    const specSkill = await createApprovedSkillDoc({
      title: "Spec-scoped rules",
      appliesTo: "spec",
      content: "## Rule\n\nSpec-only marker content.",
    });

    const result = await runGateSpecCreate(NO_PARENT_PAYLOAD);

    expect(result.exitCode).toBe(4);
    expect(result.stdout).toContain(`[source: ${specSkill.slug}`);
    expect(result.stdout).toContain("Spec-only marker content.");
    expect(result.stdout).not.toContain("Task-only marker content");
  });

  // BOUNDARY
  it("picks the most-recently-updated skill doc when two both declare applies_to=spec", async () => {
    await createApprovedSkillDoc({
      title: "Older spec rules",
      appliesTo: "spec",
      content: "## Rule\n\nOlder marker content.",
    });
    // reason: guarantee a strictly-later `updated_at` millisecond tick on `newer` — two
    // sequential in-process writes can otherwise land within the same JS-clock
    // millisecond on a fast machine, making the "latest wins" assertion below flaky.
    await new Promise((r) => setTimeout(r, 5));
    const newer = await createApprovedSkillDoc({
      title: "Newer spec rules",
      appliesTo: "spec",
      content: "## Rule\n\nNewer marker content.",
    });
    await touchDoc(newer.id);

    const result = await runGateSpecCreate(NO_PARENT_PAYLOAD);

    expect(result.exitCode).toBe(4);
    expect(result.stdout).toContain(`[source: ${newer.slug}`);
    expect(result.stdout).toContain("Newer marker content.");
    expect(result.stdout).not.toContain("Older marker content");
  });

  // ERROR — backward-compat placeholder when nothing is discoverable.
  it("degrades to the missing-rule-doc placeholder when no approved skill doc exists", async () => {
    const result = await runGateSpecCreate(NO_PARENT_PAYLOAD);

    expect(result.exitCode).toBe(4);
    expect(result.stdout).toContain("[source: applies_to:spec");
    expect(result.stdout.toLowerCase()).toContain("seed-write-spec-rule");
  });

  // STATE — a draft (unapproved) skill doc is invisible to discovery.
  it("does not discover a DRAFT skill doc even when its applies_to matches", async () => {
    await createDraftSkillDoc({
      title: "Not yet approved rules",
      appliesTo: "spec",
      content: "## Rule\n\nDraft marker content — must never surface.",
    });

    const result = await runGateSpecCreate(NO_PARENT_PAYLOAD);

    expect(result.exitCode).toBe(4);
    expect(result.stdout).toContain("[source: applies_to:spec");
    expect(result.stdout).not.toContain("Draft marker content");
  });

  // REGRESSION — discovery is read-only; it never creates/mutates corpus documents.
  it("does not create or mutate any corpus documents while discovering", async () => {
    await createApprovedSkillDoc({
      title: "Read-only check rules",
      appliesTo: "spec",
      content: "## Rule\n\nRead-only marker content.",
    });
    const before = await countDocs();

    await runGateSpecCreate(NO_PARENT_PAYLOAD);
    await runGateSpecCreate(NO_PARENT_PAYLOAD);

    const after = await countDocs();
    expect(after).toBe(before);
  });
});
