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
 *   BOUNDARY:   --governed-by ignores other filters passed alongside it (short-circuit)
 *   ERROR:      unresolvable skill id/slug -> nonzero exit, stderr populated
 *   STATE:      n/a beyond HAPPY — the "second create doesn't duplicate" invariant is
 *               a store-level guarantee already covered at the service-unit level
 *               (corpus-service-provenance.test.ts); this file is adapter-level only
 *   REGRESSION: n/a — new flag, no prior behavior to regress
 *
 * @spec_ref IoC vertical-slice tech-spec §4.1 P4
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { createApp } from "../../../src/app.js";
import type { CreateDocInput } from "@lore/core";

// ─── Command type + output capture (mirrors pending-judgment-badges.bun.test.ts) ──

type RunnableCommand = { run: (ctx: { args: Record<string, unknown> }) => Promise<void> };

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
let originalExitCode: number | undefined;

beforeEach(() => {
  process.exitCode = 0;
  tmpDir = resolve(mkdtempSync(join(tmpdir(), "lore-cli-list-governed-by-test-")));
  const loreDir = join(tmpDir, ".lore");
  mkdirSync(loreDir, { recursive: true });

  const app = createApp(join(loreDir, "lore.db"));
  app.close();

  originalCwd = process.cwd();
  originalExitCode = process.exitCode;
  process.chdir(tmpDir);
});

afterEach(() => {
  process.exitCode = originalExitCode ?? 0;
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
  const app = createApp(join(loreDir, "lore.db"));
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
  const app = createApp(join(loreDir, "lore.db"));
  try {
    const prd = await app.corpusService.create({ type: "prd", title: "Root PRD" } as CreateDocInput);
    if (!prd.ok) throw new Error(`create prd failed: ${JSON.stringify(prd.error)}`);
    const spec = await app.corpusService.create({
      type: "spec",
      title: specTitle,
      parent_id: prd.value.id,
      content: "body",
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
      await cmd.run({ args: { "governed-by": skill.id, json: true } });
    } finally {
      output.restore();
    }

    expect(process.exitCode === 0 || process.exitCode === undefined).toBe(true);
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
      await cmd.run({ args: { "governed-by": skill.slug } });
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
      await cmd.run({ args: { "governed-by": skill.id } });
    } finally {
      output.restore();
    }

    expect(output.stdout.join("\n")).toContain("No documents governed by");
  });
});

// ─── BOUNDARY ──────────────────────────────────────────────────────────────────

describe("lore list --governed-by — BOUNDARY", () => {
  it("short-circuits: an unrelated --type filter passed alongside --governed-by is ignored", async () => {
    const loreDir = join(tmpDir, ".lore");
    const skill = await seedApprovedSkill(loreDir, { title: "Write-spec rules", appliesTo: "spec" });
    const { specId } = await seedGovernedSpec(loreDir, "Governed Spec Ignoring Filters");

    const cmd = await importListCommand();
    const output = captureOutput();
    try {
      // --type task would normally filter to zero results under the standard path;
      // --governed-by must short-circuit before that filter is ever consulted.
      await cmd.run({ args: { "governed-by": skill.id, type: "task", json: true } });
    } finally {
      output.restore();
    }

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
      await cmd.run({ args: { "governed-by": "knowledge-totally-nonexistent-slug" } });
    } finally {
      output.restore();
    }

    expect(process.exitCode).not.toBe(0);
    expect(output.stderr.join("\n").length).toBeGreaterThan(0);
  });
});
