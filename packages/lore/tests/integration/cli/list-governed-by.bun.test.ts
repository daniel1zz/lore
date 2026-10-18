/**
 * @spec_ref IoC vertical-slice tech-spec §4.1 P4 (lore list --governed-by)
 *
 * `lore list --governed-by <skill-id-or-slug>` — CLI tests for the reverse-query
 * short-circuit branch added to list.ts's run handler. Follows the same idiom as
 * pending-judgment-badges.bun.test.ts / assess-ai.bun.test.ts: bun:test only (real
 * SQLiteStore via createApp — requires bun:sqlite), seeds data by calling
 * app.corpusService directly (which exercises the REAL production writeProvenanceLink
 * auto-write on create()), then imports the command module and calls its run()
 * handler directly rather than spawning a subprocess.
 *
 * Six-dimension coverage:
 *   HAPPY:      --governed-by <skillId> and --governed-by <skillSlug> both print the
 *               governed doc (table mode: title appears; --json: docs[] contains it)
 *   NEGATIVE:   a skill scoped to a different applies_to governs nothing -> "No
 *               documents governed by ..." message, not an error
 *   BOUNDARY:   --governed-by combined with any other filter flag fails loud (exit 2,
 *               naming the conflicting flag) instead of silently ignoring it
 *   ERROR:      unresolvable skill id/slug -> nonzero exit, stderr populated
 *   STATE:      n/a beyond HAPPY — the "second create doesn't duplicate" invariant is
 *               a store-level guarantee already covered at the service-unit level
 *               (corpus-service-provenance.test.ts); this file is adapter-level only
 *   REGRESSION: n/a — new flag, no prior behavior to regress
 *
 * @spec_ref IoC vertical-slice tech-spec §4.1 P4
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { createApp } from "../../../src/app.js";
import type { CreateDocInput } from "@lore/core";
import { LIST_GOVERNED_BY_CONFLICT } from "../../../src/adapters/cli/cli-refusal-messages.js";
import { liveInvocation, liveAmbient, liveWriteContext, runHandlerForExit } from "../../live-invocation.js";

/** The exit code the most recent command call ended with (commands return it; none sets `process.exitCode`). */
let lastExitCode = 0;
import type { Invocation } from "@lore/core";

// ─── Command type + output capture (mirrors pending-judgment-badges.bun.test.ts) ──

type RunnableCommand = { run: (ctx: { args: Record<string, unknown>; inv?: Invocation }) => Promise<void> };

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

async function importListCommand(): Promise<RunnableCommand> {
  const mod = await import("../../../src/adapters/cli/commands/list.js");
  const cmd = (mod as { default?: { run?: RunnableCommand["run"] } }).default;
  if (!cmd?.run) throw new Error("list command not exported");
  return cmd as RunnableCommand;
}

// ─── Project setup ────────────────────────────────────────────────────────────

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = resolve(mkdtempSync(join(tmpdir(), "lore-cli-list-governed-by-test-")));
  const loreDir = join(tmpDir, ".lore");
  mkdirSync(loreDir, { recursive: true });

  const app = createApp(join(loreDir, "lore.db"), undefined, liveAmbient(), liveWriteContext());
  app.close();

  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

/** Seed an approved knowledge/skill doc scoped to `appliesTo`, returning id + slug. */
async function seedApprovedSkill(
  loreDir: string,
  opts: { title: string; appliesTo: string },
): Promise<{ id: string; slug: string }> {
  const app = createApp(join(loreDir, "lore.db"), undefined, liveAmbient(), liveWriteContext());
  try {
    const created = await app.corpusService.create({
      type: "knowledge",
      title: opts.title,
      content: "## Rule\n\nBody.",
      extra: { sub_type: "skill", skill: { applies_to: opts.appliesTo } },
    } as CreateDocInput);
    if (!created.ok) throw new Error(`create skill failed: ${JSON.stringify(created.error)}`);
    const approved = await app.corpusService.set(created.value.id, { status: "approved" });
    if (!approved.ok) throw new Error(`approve skill failed: ${JSON.stringify(approved.error)}`);
    return { id: created.value.id, slug: approved.value.slug };
  } finally {
    app.close();
  }
}

/** Create a prd -> spec pair, exercising the real writeProvenanceLink auto-write. */
async function seedGovernedSpec(loreDir: string, specTitle: string): Promise<{ specId: string; specSlug: string }> {
  const app = createApp(join(loreDir, "lore.db"), undefined, liveAmbient(), liveWriteContext());
  try {
    const prd = await app.corpusService.create({ type: "prd", title: "Root PRD" } as CreateDocInput);
    if (!prd.ok) throw new Error(`create prd failed: ${JSON.stringify(prd.error)}`);
    const spec = await app.corpusService.create({
      type: "spec",
      title: specTitle,
      // reason: spec-create's GateEnforcer checkpoint (retro follow-up item 8) requires
      // a `## ` skeleton heading — this file predates that gate and used bare "body".
      content: "## Overview\n\nbody",
    } as CreateDocInput);
    if (!spec.ok) throw new Error(`create spec failed: ${JSON.stringify(spec.error)}`);
    return { specId: spec.value.id, specSlug: spec.value.slug };
  } finally {
    app.close();
  }
}

// ─── HAPPY ─────────────────────────────────────────────────────────────────────

describe("lore list --governed-by — HAPPY", () => {
  it("--json prints the governed doc when queried by skill id", async () => {
    const loreDir = join(tmpDir, ".lore");
    const skill = await seedApprovedSkill(loreDir, { title: "Write-spec rules", appliesTo: "spec" });
    const { specId } = await seedGovernedSpec(loreDir, "Governed Spec One");

    const cmd = await importListCommand();
    const output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { "governed-by": skill.id, json: true }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(0);
    const parsed = JSON.parse(output.stdout.join("\n")) as {
      ok: boolean;
      data: { docs: Array<{ id: string }>; total: number };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.data.total).toBe(1);
    expect(parsed.data.docs.some((d) => d.id === specId)).toBe(true);
  });

  it("table mode (no --json) prints the governed doc's title, queried by skill slug", async () => {
    const loreDir = join(tmpDir, ".lore");
    const skill = await seedApprovedSkill(loreDir, { title: "Write-spec rules", appliesTo: "spec" });
    await seedGovernedSpec(loreDir, "Governed Spec By Slug");

    const cmd = await importListCommand();
    const output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { "governed-by": skill.slug }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    const text = output.stdout.join("\n");
    expect(text).toContain("Governed Spec By Slug");
    expect(text).toContain("governed-by");
  });
});

// ─── NEGATIVE ──────────────────────────────────────────────────────────────────

describe("lore list --governed-by — NEGATIVE", () => {
  it("a skill scoped to a different applies_to governs nothing -> informative empty message", async () => {
    const loreDir = join(tmpDir, ".lore");
    const skill = await seedApprovedSkill(loreDir, { title: "Task rules", appliesTo: "task" });
    // No spec created that this skill would govern.

    const cmd = await importListCommand();
    const output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { "governed-by": skill.id }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(output.stdout.join("\n")).toContain("No documents governed by");
  });
});

// ─── BOUNDARY ──────────────────────────────────────────────────────────────────

describe("lore list --governed-by — BOUNDARY", () => {
  it("fails loud (exit 2) when combined with --type instead of silently ignoring it", async () => {
    const loreDir = join(tmpDir, ".lore");
    const skill = await seedApprovedSkill(loreDir, { title: "Write-spec rules", appliesTo: "spec" });
    await seedGovernedSpec(loreDir, "Governed Spec Conflicting Filters");

    const cmd = await importListCommand();
    const output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { "governed-by": skill.id, type: "task", json: true }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(2);
    expect(output.stdout.join("\n")).toBe(""); // no silent success output
    const stderr = output.stderr.join("\n");
    expect(stderr).toContain(LIST_GOVERNED_BY_CONFLICT);
    expect(stderr).toContain("--type");
  });

  it("fails loud (exit 2) when combined with multiple other filters, naming all of them", async () => {
    const loreDir = join(tmpDir, ".lore");
    const skill = await seedApprovedSkill(loreDir, { title: "Write-spec rules", appliesTo: "spec" });

    const cmd = await importListCommand();
    const output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { "governed-by": skill.id, status: "active", tag: "foo" }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(2);
    const stderr = output.stderr.join("\n");
    expect(stderr).toContain("--status");
    expect(stderr).toContain("--tag");
  });

  it("--json alongside --governed-by alone is NOT a conflict (json is output format, not a filter)", async () => {
    const loreDir = join(tmpDir, ".lore");
    const skill = await seedApprovedSkill(loreDir, { title: "Write-spec rules", appliesTo: "spec" });
    const { specId } = await seedGovernedSpec(loreDir, "Governed Spec Alone With Json");

    const cmd = await importListCommand();
    const output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { "governed-by": skill.id, json: true }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(0);
    const parsed = JSON.parse(output.stdout.join("\n")) as { data: { docs: Array<{ id: string }> } };
    expect(parsed.data.docs.some((d) => d.id === specId)).toBe(true);
  });
});

// ─── ERROR ─────────────────────────────────────────────────────────────────────

describe("lore list --governed-by — ERROR", () => {
  it("an unresolvable skill id/slug -> nonzero exit code, stderr populated", async () => {
    const cmd = await importListCommand();
    const output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { "governed-by": "knowledge-totally-nonexistent-slug" }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(lastExitCode).not.toBe(0);
    expect(output.stderr.join("\n").length).toBeGreaterThan(0);
  });
});

// ─── REGRESSION ────────────────────────────────────────────────────────────────
// Plain filters with no --governed-by present must remain entirely unaffected by
// the conflict check added to the --governed-by branch — it never runs when
// --governed-by is absent.

describe("lore list — REGRESSION (no --governed-by)", () => {
  it("plain --type task (no --governed-by) still lists normally, exit 0", async () => {
    const cmd = await importListCommand();
    const output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { type: "task", json: true }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(0);
    const parsed = JSON.parse(output.stdout.join("\n")) as { data: { docs: unknown[]; total: number } };
    expect(parsed.data.total).toBe(0); // no tasks seeded in this corpus
  });
});
