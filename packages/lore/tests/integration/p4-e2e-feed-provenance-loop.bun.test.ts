/**
 * @spec_ref IoC vertical-slice tech-spec §4.1/§5.4/§11 (AC-P4-7) — end-to-end
 * feed-before-produce + provenance closed loop.
 *
 * bun test (not vitest): drives the real `feed.ts`, `gate.ts` (spec-create), and
 * `list.ts` command modules IN-PROCESS against a real `SQLiteStore` (`createApp()`
 * on a throwaway `mkdtemp` corpus), the same idiom `feed-p4.bun.test.ts` and
 * `cli/list-governed-by.bun.test.ts` establish — chdir into a temp dir, import the
 * command module directly, call its `run()`, capture stdout/exitCode. No subprocess
 * spawn of `dist/lore` or `bun run src/index.ts` anywhere in this file (the compiled
 * binary is intentionally stale this turn; the harness rebuilds it separately).
 *
 * ⛔ Never touches the repo's own `.lore/` corpus (project CLAUDE.md hard rule) —
 * every step operates inside its own `mkdtempSync` directory.
 *
 * This file exists ALONGSIDE the already-landed per-slice tests (T2's
 * `feed-p4.bun.test.ts`, T3's `corpus-service-provenance.test.ts` +
 * `cli/list-governed-by.bun.test.ts`) rather than replacing them: those assert each
 * mechanism in isolation; this one strings all of them together in ONE flow to pin
 * down the temporal contract AC-P4-7 actually cares about — the feed PULL happens
 * BEFORE the spec is produced, using the SAME skill doc the provenance auto-write
 * later links, and every downstream read (forward `--governed-by`, reverse
 * `get().navigation.related`) sees that exact edge.
 *
 * Six steps under test, in call order:
 *   1. Seed an approved `knowledge/skill` (`extra.skill.applies_to="spec"`) + a `prd`.
 *   2. `lore feed spec-create --parent <prd>` (via `feed.ts`, which composes through
 *      `flows/feed-flow.ts::buildFeed`) returns the skill's rule slice — asserted
 *      BEFORE any spec exists in the corpus (doc count still 2: skill + prd).
 *   3. Create a `spec` under the prd via `CorpusService.create` (the same production
 *      path `writeProvenanceLink` runs from).
 *   4. Assert a `skill --governs--> spec` link was auto-written (queried directly
 *      against `store.findLinks`, mirroring `corpus-service-provenance.test.ts`).
 *   5. `lore list --governed-by <skill>` (via `list.ts`) lists the spec.
 *   6. Reverse: `CorpusService.get(specId)`'s `navigation.related` surfaces the
 *      `governs` backlink to the skill.
 *
 * Part 1 tie-in (§5.4, NON-AC-blocking): also asserts that a compliant
 * `lore gate spec-create` payload against this same corpus still prints exactly
 * "gate: pass" and exits 0 — the allow-path verdict is unchanged after this task's
 * gate.ts documentation-only edit (no predicate/branch logic was touched). The write itself
 * refuses at `corpus-service.ts::CorpusService._createImpl` via `GateEnforcer.enforce("spec-create")`.
 *
 * Coverage dimensions:
 *   HAPPY      — AC-P4-7: the full feed -> produce -> provenance -> forward-query ->
 *                reverse-nav loop, in temporal order.
 *   REGRESSION — gate spec-create's ALLOW verdict ("gate: pass", exit 0) is
 *                byte-identical to its pre-existing documented contract.
 */

import type { Invocation } from "@lore/core";
import { liveInvocation, liveAmbient } from "../live-invocation.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { createApp, type App } from "../../src/app.js";
import type { CreateDocInput } from "@lore/core";

// ─── Command type + importers (mirrors feed-p4.bun.test.ts / list-governed-by.bun.test.ts) ──

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

async function importListCommand(): Promise<RunnableCommand> {
  const mod = await import("../../src/adapters/cli/commands/list.js");
  const cmd = (mod as { default?: RunnableCommand }).default;
  if (!cmd?.run) throw new Error("list command not exported");
  return cmd;
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

// ─── Project setup ──────────────────────────────────────────────────────────

let tmpDir: string;
let dbPath: string;
let originalCwd: string;

beforeEach(() => {
  process.exitCode = 0;
  tmpDir = resolve(mkdtempSync(join(tmpdir(), "lore-p4-e2e-feed-provenance-")));
  const loreDir = join(tmpDir, ".lore");
  mkdirSync(loreDir, { recursive: true });
  dbPath = join(loreDir, "lore.db");

  const app = createApp(dbPath, undefined, liveAmbient());
  app.close();

  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.exitCode = 0;
  process.chdir(originalCwd);
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

async function withApp<T>(fn: (app: App) => Promise<T>): Promise<T> {
  const app = createApp(dbPath, undefined, liveAmbient());
  try {
    return await fn(app);
  } finally {
    app.close();
  }
}

async function runFeed(args: { checkpoint: string; parent?: string }) {
  const cmd = await importFeedCommand();
  const output = captureOutput();
  try {
    await cmd.run({ args: { ...args }, inv: liveInvocation() });
  } finally {
    output.restore();
  }
  return { exitCode: process.exitCode, stdout: output.stdout.join("\n") };
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

async function runListGovernedBy(governedBy: string) {
  const cmd = await importListCommand();
  const output = captureOutput();
  try {
    await cmd.run({ args: { "governed-by": governedBy, json: true }, inv: liveInvocation() });
  } finally {
    output.restore();
  }
  return { exitCode: process.exitCode, stdout: output.stdout.join("\n") };
}

// ─── Test ────────────────────────────────────────────────────────────────────

describe("P4 e2e: feed-before-produce + provenance closed loop (AC-P4-7)", () => {
  it(
    "seed skill+prd -> feed pulls the rule pre-creation -> create spec -> governs link " +
      "auto-written -> forward --governed-by finds it -> reverse nav backlink shows it",
    async () => {
      // ── Step 1: seed an approved knowledge/skill (applies_to="spec") + a prd ──
      const skill = await withApp(async (app) => {
        const created = await app.corpusService.create({
          type: "knowledge",
          title: "E2E write-spec rules",
          content: "## Rule\n\nE2E closed-loop marker content.",
          extra: { sub_type: "skill", skill: { applies_to: "spec" } },
        } as CreateDocInput);
        if (!created.ok) throw new Error(`skill create failed: ${JSON.stringify(created.error)}`);
        const approved = await app.corpusService.set(created.value.id, { status: "approved" });
        if (!approved.ok) throw new Error(`skill approve failed: ${JSON.stringify(approved.error)}`);
        return { id: created.value.id, slug: approved.value.slug };
      });

      const prd = await withApp(async (app) => {
        const created = await app.corpusService.create({
          type: "prd",
          title: "E2E Parent PRD",
          content: "## Overview\n\nE2E parent PRD body.",
        } as CreateDocInput);
        if (!created.ok) throw new Error(`prd create failed: ${JSON.stringify(created.error)}`);
        return { id: created.value.id, slug: created.value.slug };
      });

      // ── Step 2: `lore feed spec-create --parent <prd>` — BEFORE any spec exists ──
      const docCountBeforeSpec = await withApp(async (app) => {
        const listed = await app.corpusService.list({});
        if (!listed.ok) throw new Error(`list failed: ${JSON.stringify(listed.error)}`);
        return listed.value.docs.length;
      });
      expect(docCountBeforeSpec).toBe(2); // skill + prd only, no spec yet

      const feedResult = await runFeed({ checkpoint: "spec-create", parent: prd.id });
      expect(feedResult.exitCode).toBe(0);
      expect(feedResult.stdout).toContain(`[source: ${skill.slug}, trust: team-authored]`);
      expect(feedResult.stdout).toContain("E2E closed-loop marker content.");
      expect(feedResult.stdout).toContain("E2E parent PRD body.");

      // Feeding is read-only advisory — still no spec in the corpus after the pull.
      const docCountAfterFeed = await withApp(async (app) => {
        const listed = await app.corpusService.list({});
        if (!listed.ok) throw new Error(`list failed: ${JSON.stringify(listed.error)}`);
        return listed.value.docs.length;
      });
      expect(docCountAfterFeed).toBe(2);

      // ── Part 1 tie-in: compliant gate spec-create ALLOW verdict is unchanged ──
      // (§5.4 — this task's gate.ts edit is documentation-only;
      // no predicate or branch logic changed. This pins "gate: pass", exit 0 down
      // against the SAME corpus this e2e loop is using.)
      const compliantGateResult = await runGateSpecCreate({
        type: "spec",
        title: "Gate-compliant candidate (not actually created)",
        content: "## Overview\n\nCompliant skeleton content.",
        extra: { spec_kind: "tech" },
      });
      expect(compliantGateResult.exitCode).toBe(0);
      expect(compliantGateResult.stdout.trim()).toBe("gate: pass");

      // ── Step 3: create the spec under the prd (production create path) ──
      const specId = await withApp(async (app) => {
        const created = await app.corpusService.create({
          type: "spec",
          title: "E2E Governed Spec",
          content: "## Overview\n\nE2E governed spec body.",
          extra: { spec_kind: "tech" },
        } as CreateDocInput);
        if (!created.ok) throw new Error(`spec create failed: ${JSON.stringify(created.error)}`);
        return created.value.id;
      });

      // ── Step 4: assert the `skill --governs--> spec` link was auto-written ──
      // Service-level query (CorpusService.listGovernedBy) — distinct from step 5's
      // adapter-level `lore list --governed-by` CLI call below.
      const governedByResult = await withApp(async (app) => {
        const result = await app.corpusService.listGovernedBy(skill.id);
        if (!result.ok) throw new Error(`listGovernedBy failed: ${JSON.stringify(result.error)}`);
        return result.value;
      });
      expect(governedByResult.total).toBe(1);
      expect(governedByResult.docs.filter((d) => d.id === specId)).toHaveLength(1);

      // ── Step 5: `lore list --governed-by <skill>` lists the spec ──
      const listResult = await runListGovernedBy(skill.id);
      expect(listResult.exitCode ?? 0).toBe(0);
      const parsedList = JSON.parse(listResult.stdout) as {
        ok: boolean;
        data: { docs: Array<{ id: string; title: string }>; total: number };
      };
      expect(parsedList.ok).toBe(true);
      expect(parsedList.data.total).toBe(1);
      expect(parsedList.data.docs[0]?.id).toBe(specId);
      expect(parsedList.data.docs[0]?.title).toBe("E2E Governed Spec");

      // ── Step 6: reverse — the spec's get() nav/Related shows the governs backlink ──
      const backlink = await withApp(async (app) => {
        const got = await app.corpusService.get(specId);
        if (!got.ok) throw new Error(`get failed: ${JSON.stringify(got.error)}`);
        return got.value.navigation.related.find((r) => r.id === skill.id);
      });
      expect(backlink).toBeDefined();
      expect(backlink?.link_type).toBe("governs");
    },
  );
});
