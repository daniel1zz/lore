/**
 * @spec_ref IoC vertical-slice tech-spec §4.1/§11, P1 — end-to-end proof of the "asset
 * discovery + feeding" closed loop: a user-authored `knowledge/skill` doc (created
 * through the public `CorpusService.create` API, NOT a seed script and NOT a hardcoded
 * title) is discovered by `lore gate spec-create` via `extra.skill.applies_to` and fed
 * into the violation output verbatim. This is the P1 capstone task — it does not add
 * new production code, it proves the mechanism `findFeedingSkill` (P1-T3, 59db71e) +
 * `extra.skill.applies_to` (P1-T1, 1d5e05d) already ships is generic, not a special
 * case wired only to `scripts/seed-write-spec-rule.ts`'s one seeded doc.
 *
 * bun test (not vitest): drives the real `gate.ts` command module in-process against a
 * real `SQLiteStore` (`createApp()`) — same in-process idiom as
 * `gate-feeding-skill-discovery.bun.test.ts` and `spec-loop-e2e.bun.test.ts` (chdir into
 * a throwaway temp corpus, import the command module directly, call its `run()`,
 * capture stdout/exitCode).
 *
 * ⛔ Never touches the repo's own `.lore/` corpus (project CLAUDE.md hard rule) — every
 * test operates inside its own `mkdtempSync` directory; `git status --short .lore` is
 * asserted empty before and after the suite runs (belt-and-suspenders on top of the
 * chdir isolation every other gate test already relies on).
 *
 * Single narrative test (not per-dimension `it` blocks) because the five steps are
 * causally chained — each step's assertion depends on state built by the previous one
 * (the self-authored skill must exist before the violating gate call; the plan-scoped
 * skill must exist before the isolation check; the prd parent must exist before the
 * compliant call) — splitting into independent `it`s would force either duplicated
 * setup or brittle `beforeAll` ordering assumptions.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { createApp, type App } from "../../src/app.js";
import type { CreateDocInput } from "@lore/core";
import { liveInvocation, liveAmbient, liveWriteContext } from "../live-invocation.js";
import type { Invocation } from "@lore/core";

// ─── Command type + importer (mirrors gate-feeding-skill-discovery.bun.test.ts) ────

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
  const origConsoleLog = console.log.bind(console);
  console.log = (...args: unknown[]) => {
    stdout.push(args.join(" "));
  };
  return {
    stdout,
    restore: () => {
      console.log = origConsoleLog;
    },
  };
}

async function runGateSpecCreate(payload: Record<string, unknown>) {
  const cmd = await importGateSpecCreate();
  const output = captureOutput();
  try {
    await cmd.run({ args: { "input-json": JSON.stringify(payload) }, inv: liveInvocation() });
  } finally {
    output.restore();
  }
  return { exitCode: process.exitCode, stdout: output.stdout.join("\n") };
}

// ─── Repo `.lore` pollution guard (project CLAUDE.md hard rule) ───────────────────

const REPO_ROOT = resolve(__dirname, "../../../..");

function repoLoreGitStatus(): string {
  return execFileSync("git", ["status", "--short", ".lore"], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
  }).trim();
}

// ─── Project setup ──────────────────────────────────────────────────────────────

let tmpDir: string;
let dbPath: string;
let originalCwd: string;
let statusBefore: string;

beforeAll(() => {
  statusBefore = repoLoreGitStatus();

  process.exitCode = 0;
  tmpDir = resolve(mkdtempSync(join(tmpdir(), "lore-p1-asset-loop-test-")));
  const loreDir = join(tmpDir, ".lore");
  mkdirSync(loreDir, { recursive: true });
  dbPath = join(loreDir, "lore.db");

  const bootstrap = createApp(dbPath, undefined, liveAmbient(), liveWriteContext());
  bootstrap.close();

  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterAll(() => {
  process.exitCode = 0;
  process.chdir(originalCwd);
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }

  const statusAfter = repoLoreGitStatus();
  expect(statusAfter).toBe(statusBefore);
});

async function withApp<T>(fn: (app: App) => Promise<T>): Promise<T> {
  const app = createApp(dbPath, undefined, liveAmbient(), liveWriteContext());
  try {
    return await fn(app);
  } finally {
    app.close();
  }
}

// ─── Narrative ─────────────────────────────────────────────────────────────────

describe("P1 asset-discovery + feeding closed loop (e2e, no seed script)", () => {
  let selfAuthoredSpecSkillSlug: string;
  let planSkillSlug: string;
  let prdSlug: string;

  it("step 1 — a user self-authors a knowledge/skill doc (applies_to=spec) via the plain create API, not a seed script", async () => {
    const created = await withApp(async (app) => {
      const createResult = await app.corpusService.create({
        type: "knowledge",
        title: "My custom spec-writing skill",
        content: "## Overview\n\nThese are my own custom rules for writing specs — not seeded.",
        extra: { sub_type: "skill", skill: { applies_to: "spec" } },
      } as CreateDocInput);
      if (!createResult.ok) {
        throw new Error(`self-authored skill create failed: ${JSON.stringify(createResult.error)}`);
      }
      // draft -> approved is a valid direct (fast-track) transition (SPEC-002 §3).
      const approveResult = await app.corpusService.set(createResult.value.id, { status: "approved" });
      if (!approveResult.ok) {
        throw new Error(`self-authored skill approve failed: ${JSON.stringify(approveResult.error)}`);
      }
      return approveResult.value;
    });

    expect(created.status).toBe("approved");
    expect(created.type).toBe("knowledge");
    selfAuthoredSpecSkillSlug = created.slug;
  });

  it("step 2 — a legal prd parent exists for the later compliant gate call", async () => {
    const created = await withApp(async (app) => {
      const createResult = await app.corpusService.create({
        type: "prd",
        title: "Host PRD for the P1 asset loop e2e",
        content: "## Overview\n\nHost PRD, used only as a legal spec parent in this test.",
      } as CreateDocInput);
      if (!createResult.ok) {
        throw new Error(`prd create failed: ${JSON.stringify(createResult.error)}`);
      }
      const approveResult = await app.corpusService.set(createResult.value.id, { status: "approved" });
      if (!approveResult.ok) {
        throw new Error(`prd approve failed: ${JSON.stringify(approveResult.error)}`);
      }
      return approveResult.value;
    });

    expect(created.status).toBe("approved");
    prdSlug = created.slug;
  });

  it("step 3 — a violating spec-create (no parent) is fed by the self-authored skill's slug + custom content", async () => {
    const result = await runGateSpecCreate({
      type: "spec",
      title: "A spec missing its parent",
      content: "just some prose, no headings at all",
    });

    expect(result.exitCode).toBe(4);
    expect(result.stdout).toContain(`[source: ${selfAuthoredSpecSkillSlug}`);
    expect(result.stdout).toContain("custom rules");
    // Not the seed-script placeholder / seeded doc — proves discovery is generic, not
    // hardwired to `scripts/seed-write-spec-rule.ts`'s one specific title.
    expect(result.stdout.toLowerCase()).not.toContain("seed-write-spec-rule");
  });

  it("step 4 — applies_to isolation: a plan-scoped skill never leaks into the spec gate's feeding pack", async () => {
    const created = await withApp(async (app) => {
      const createResult = await app.corpusService.create({
        type: "knowledge",
        title: "A plan-writing skill, not spec-scoped",
        content: "## Overview\n\nPlan-only marker content — must never leak into spec-create.",
        extra: { sub_type: "skill", skill: { applies_to: "plan" } },
      } as CreateDocInput);
      if (!createResult.ok) {
        throw new Error(`plan skill create failed: ${JSON.stringify(createResult.error)}`);
      }
      const approveResult = await app.corpusService.set(createResult.value.id, { status: "approved" });
      if (!approveResult.ok) {
        throw new Error(`plan skill approve failed: ${JSON.stringify(approveResult.error)}`);
      }
      return approveResult.value;
    });
    planSkillSlug = created.slug;

    const result = await runGateSpecCreate({
      type: "spec",
      title: "Another spec missing its parent",
      content: "still no headings",
    });

    expect(result.exitCode).toBe(4);
    // Still the spec-scoped self-authored skill, not the newly-created plan-scoped one.
    expect(result.stdout).toContain(`[source: ${selfAuthoredSpecSkillSlug}`);
    expect(result.stdout).not.toContain(`[source: ${planSkillSlug}`);
    expect(result.stdout).not.toContain("Plan-only marker content");
  });

  it("step 5 — a compliant spec-create (legal prd parent + valid spec_kind + skeleton) passes", async () => {
    const result = await runGateSpecCreate({
      type: "spec",
      title: "A fully compliant spec",
      extra: { spec_kind: "tech" },
      content: "## Overview\n\nA properly-structured spec body.",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("gate: pass");
  });
});
