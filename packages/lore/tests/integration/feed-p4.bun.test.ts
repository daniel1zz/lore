/**
 * @spec_ref IoC vertical-slice tech-spec §4.1/§11, P4 slice — `lore feed <checkpoint>`,
 * the deterministic feed-before-produce PULL surface.
 *
 * bun test (not vitest): drives the real `feed.ts` and `gate.ts` command modules
 * in-process against a real `SQLiteStore` (`createApp()`), the same in-process idiom
 * `gate-feeding-skill-discovery.bun.test.ts` establishes (chdir into a throwaway temp
 * corpus, import the command module directly, call its `run()`, capture stdout/exitCode).
 *
 * ⛔ Never touches the repo's own `.lore/` corpus (project CLAUDE.md hard rule) — every
 * test operates inside its own `mkdtempSync` directory.
 *
 * SSOT check (AC-P4-1): `lore feed spec-create --parent <prd>` and `lore gate
 * spec-create` (fed a payload whose ONLY violation is `MISSING_SKELETON`, same skill
 * doc, same `--parent`/`parent_id`) both go through `flows/feed-flow.ts`'s shared
 * `renderDocMarkdown` + `buildFeedingPack`/`renderFeedingPack` pipeline. The gate's
 * output additionally carries a "Missing:" block (feed's pack is always built with
 * `missing: []` — there is no violation to report in a PULL). `stripMissingBlock`
 * removes exactly that inserted block (verified against `renderFeedingPack`'s known
 * line-assembly shape — see `gate-feeding.ts`), and the two texts are asserted
 * byte-identical everywhere else: same header, same rule slice, same parent slice.
 *
 * Coverage dimensions:
 *   HAPPY      — AC-P4-1: approved skill + --parent → rule slice + parent summary +
 *                header in stdout, exit 0; SSOT-equal (modulo Missing block) to the
 *                gate's violation output for the same corpus.
 *   NEGATIVE   — AC-P4-2: no approved skill → "no approved governing skill for spec"
 *                note, exit 0 (never an error).
 *   BOUNDARY   — an UNREGISTERED checkpoint name (absent from BOTH
 *                `CHECKPOINT_PRODUCED_TYPE` and `checkpointRegistry`) exits
 *                EXACTLY 2, never a crash and never 0 (AC-FR-1,
 *                task-derive-lore-feed-s-checkpoint-set-from-the-registry-make
 *                — before that task this exited 0 with a one-line note,
 *                letting a script proceed as though a pack had been
 *                delivered; `buildFeed` ITSELF still never fails — this is a
 *                CLI-dispatch-level refusal in `commands/feed.ts`, checked
 *                BEFORE `buildFeed` is ever called).
 *   ERROR      — n/a (feed's OWN advisory composition has no failure mode by
 *                design; every REGISTERED-checkpoint scenario asserts exit 0).
 *   STATE      — a DRAFT (unapproved) skill doc is invisible, same as no skill at all.
 *   REGRESSION — `--json` output matches the FeedOutcome shape; feed never mutates the corpus.
 */

import type { Invocation } from "@lore/core";
import { liveInvocation, liveAmbient, liveWriteContext, runHandlerForExit } from "../live-invocation.js";

/** The exit code the most recent command call ended with (commands return it; none sets `process.exitCode`). */
let lastExitCode = 0;
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { createApp, type App } from "../../src/app.js";
import type { CreateDocInput } from "@lore/core";

import { ensureRequirementsDocId } from "../helpers/parented-create.js";
// ─── Command type + importers (mirrors gate-feeding-skill-discovery.bun.test.ts) ──

type RunnableCommand = { run: (ctx: { args: Record<string, unknown>; inv?: Invocation }) => Promise<void> };

async function importFeedCommand(): Promise<RunnableCommand> {
  const mod = await import("../../src/adapters/cli/commands/feed.js");
  const cmd = (mod as { default?: RunnableCommand }).default;
  if (!cmd?.run) throw new Error("feed command not exported");
  return cmd;
}

async function importGateSpecCreate(): Promise<RunnableCommand> {
  const mod = await import("../../src/adapters/cli/commands/gate.js");
  const group = (mod as { default?: { subCommands?: Record<string, unknown> } }).default;
  const cmd = group?.subCommands?.["spec-create"] as { run?: RunnableCommand["run"] } | undefined;
  if (!cmd?.run) throw new Error("gate spec-create command not exported");
  return cmd as RunnableCommand;
}

function captureOutput() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const origConsoleLog = process.stdout.write;
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = (((chunk: unknown) => {
    const args: unknown[] = [String(chunk).replace(/\n$/, "")];
    stdout.push(args.join(" "));
  
    return true;
  }) as typeof process.stdout.write);
  // reason: AC-FR-1's unregistered-checkpoint refusal (commands/feed.ts) writes
  // directly to `process.stderr`, never through `console.log` — this capture
  // must intercept BOTH channels or a stderr-only refusal reads as silent.
  process.stderr.write = ((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  return {
    stdout,
    stderr,
    restore: () => {
      process.stdout.write = origConsoleLog;
      process.stderr.write = origStderrWrite;
    },
  };
}

/**
 * Strips the "Missing:" block `renderFeedingPack` (`../../src/service/gate-feeding.ts`)
 * inserts right after the provenance header when `pack.missing` is non-empty — i.e.
 * turns a gate-violation feeding pack (missing populated) into the SAME text a
 * `missing: []` pack (feed's shape) would render, so the SSOT assertion can compare
 * them directly. Mirrors `renderFeedingPack`'s own line assembly exactly:
 * `[header]\n\nMissing:\n(- reason\n)+\n## Rule...` → `[header]\n\n## Rule...`.
 */
function stripMissingBlock(text: string): string {
  return text.replace(/Missing:\n(?:- .+\n)+\n/, "");
}

// ─── Project setup ──────────────────────────────────────────────────────────

let tmpDir: string;
let dbPath: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = resolve(mkdtempSync(join(tmpdir(), "lore-feed-p4-test-")));
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

async function withApp<T>(fn: (app: App) => Promise<T>): Promise<T> {
  const app = createApp(dbPath, undefined, liveAmbient(), liveWriteContext());
  try {
    return await fn(app);
  } finally {
    app.close();
  }
}

async function createApprovedSkillDoc(opts: {
  title: string;
  appliesTo: string;
  content: string;
}): Promise<{ id: string; slug: string }> {
  return withApp(async (app) => {
    const createResult = await app.corpusService.create({
      parent_id: await ensureRequirementsDocId(app.corpusService), type: "knowledge",
      title: opts.title,
      content: opts.content,
      extra: { sub_type: "skill", skill: { applies_to: opts.appliesTo } },
    } as CreateDocInput);
    if (!createResult.ok) throw new Error(`skill doc create failed: ${JSON.stringify(createResult.error)}`);

    const approveResult = await app.corpusService.set(createResult.value.id, { status: "approved" });
    if (!approveResult.ok) throw new Error(`skill doc approve failed: ${JSON.stringify(approveResult.error)}`);

    return { id: createResult.value.id, slug: approveResult.value.slug };
  });
}

async function createDraftSkillDoc(opts: {
  title: string;
  appliesTo: string;
  content: string;
}): Promise<{ id: string; slug: string }> {
  return withApp(async (app) => {
    const createResult = await app.corpusService.create({
      parent_id: await ensureRequirementsDocId(app.corpusService), type: "knowledge",
      title: opts.title,
      content: opts.content,
      extra: { sub_type: "skill", skill: { applies_to: opts.appliesTo } },
    } as CreateDocInput);
    if (!createResult.ok) throw new Error(`skill doc create failed: ${JSON.stringify(createResult.error)}`);
    return { id: createResult.value.id, slug: createResult.value.slug };
  });
}

async function createPrd(title: string): Promise<{ id: string; slug: string }> {
  return withApp(async (app) => {
    const createResult = await app.corpusService.create({
      type: "prd",
      title,
      content: "## Overview\n\nSome PRD content for the SSOT check.",
    } as CreateDocInput);
    if (!createResult.ok) throw new Error(`prd create failed: ${JSON.stringify(createResult.error)}`);
    return { id: createResult.value.id, slug: createResult.value.slug };
  });
}

async function countDocs(): Promise<number> {
  return withApp(async (app) => {
    const result = await app.corpusService.list({});
    if (!result.ok) throw new Error(`list failed: ${JSON.stringify(result.error)}`);
    return result.value.docs.length;
  });
}

async function runFeed(args: { checkpoint: string; parent?: string; json?: boolean }) {
  const cmd = await importFeedCommand();
  const output = captureOutput();
  try {
    lastExitCode = await runHandlerForExit(() => cmd.run({ args: { ...args }, inv: liveInvocation() }));
  } finally {
    output.restore();
  }
  return {
    exitCode: lastExitCode,
    stdout: output.stdout.join("\n"),
    stderr: output.stderr.join("\n"),
  };
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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("lore feed <checkpoint> — feed-before-produce PULL (P4)", () => {
  // HAPPY — AC-P4-1, incl. SSOT-equality against `lore gate spec-create`'s violation output.
  it("prints the skill's rule slice + parent summary + provenance header, exit 0 — SSOT-equal to gate's violation pack", async () => {
    const skill = await createApprovedSkillDoc({
      title: "Custom write-spec rules",
      appliesTo: "spec",
      content: "## Rule\n\nSSOT marker content shared by feed and gate.",
    });
    const prd = await createPrd("SSOT Parent PRD");

    const feedResult = await runFeed({ checkpoint: "spec-create", parent: prd.id });

    expect(feedResult.exitCode).toBe(0);
    expect(feedResult.stdout).toContain(`[source: ${skill.slug}, trust: team-authored]`);
    expect(feedResult.stdout).toContain("SSOT marker content shared by feed and gate.");
    expect(feedResult.stdout).toContain("Some PRD content for the SSOT check.");
    expect(feedResult.stdout).toContain("## Parent");

    // Gate payload: names the same parent (BR-2 refuses ANY spec parent, so `parentLegal` fails) and
    // its content lacks a `## ` heading (MISSING_SKELETON). Same skill doc, same parent doc => same
    // rule/parent slices via the shared flows/feed-flow.ts helpers; the only textual delta is the
    // inserted "Missing:" block, which lists both reasons.
    const violatingPayload = {
      type: "spec",
      title: "A spec missing its skeleton",
      parent_id: prd.id,
      content: "just some prose, no headings at all",
    };
    const gateResult = await runGateSpecCreate(violatingPayload);

    expect(gateResult.exitCode).toBe(4);
    expect(gateResult.stdout).toContain("MISSING_SKELETON");

    const gateStrippedOfMissing = stripMissingBlock(gateResult.stdout);
    expect(gateStrippedOfMissing).toBe(feedResult.stdout);
  });

  it("omitting --parent produces a feed with no '## Parent' section", async () => {
    await createApprovedSkillDoc({
      title: "Custom write-spec rules",
      appliesTo: "spec",
      content: "## Rule\n\nNo-parent marker content.",
    });

    const result = await runFeed({ checkpoint: "spec-create" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No-parent marker content.");
    expect(result.stdout).not.toContain("## Parent");
  });

  // NEGATIVE — AC-P4-2.
  it("no approved governing skill → clear one-line note, exit 0 (never an error)", async () => {
    const result = await runFeed({ checkpoint: "spec-create" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("no approved governing skill for spec");
  });

  // BOUNDARY — AC-FR-1 (task-derive-lore-feed-s-checkpoint-set-from-the-
  // registry-make): an UNREGISTERED checkpoint name exits EXACTLY 2, never a
  // crash and never the pre-fix silent-success 0. Before that task this
  // exited 0 with a one-line note, so `lore feed <typo> && <next step>`
  // proceeded as though a pack had actually been delivered.
  it("unregistered checkpoint → exit 2, naming the checkpoint on stderr, never a silent-success 0", async () => {
    const result = await runFeed({ checkpoint: "totally-unknown-checkpoint" });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("totally-unknown-checkpoint");
  });

  // STATE — a draft (unapproved) skill doc is invisible to discovery.
  it("does not discover a DRAFT skill doc even when its applies_to matches", async () => {
    await createDraftSkillDoc({
      title: "Not yet approved rules",
      appliesTo: "spec",
      content: "## Rule\n\nDraft marker content — must never surface.",
    });

    const result = await runFeed({ checkpoint: "spec-create" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("no approved governing skill for spec");
    expect(result.stdout).not.toContain("Draft marker content");
  });

  // REGRESSION — --json shape + no corpus mutation.
  it("--json prints { checkpoint, type, skill, feed } matching FeedOutcome", async () => {
    const skill = await createApprovedSkillDoc({
      title: "JSON-shape rules",
      appliesTo: "spec",
      content: "## Rule\n\nJSON marker content.",
    });

    const result = await runFeed({ checkpoint: "spec-create", json: true });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      checkpoint: string;
      type: string | null;
      skill: { slug: string; title: string } | null;
      feed: string;
    };
    expect(parsed.checkpoint).toBe("spec-create");
    expect(parsed.type).toBe("spec");
    expect(parsed.skill).toEqual({ slug: skill.slug, title: "JSON-shape rules" });
    expect(parsed.feed).toContain("JSON marker content.");
  });

  it("does not create or mutate any corpus documents while feeding", async () => {
    await createApprovedSkillDoc({
      title: "Read-only check rules",
      appliesTo: "spec",
      content: "## Rule\n\nRead-only marker content.",
    });
    const before = await countDocs();

    await runFeed({ checkpoint: "spec-create" });
    await runFeed({ checkpoint: "spec-create" });

    const after = await countDocs();
    expect(after).toBe(before);
  });
});
