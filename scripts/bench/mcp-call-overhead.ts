/**
 * Per-call overhead of the MCP write scope (spec-run-identity-slice-1 risk R6; task
 * task-skill-implement-mcp-harness-run-argument-optional-by-per).
 *
 * Measures N sequential `lore_get`-equivalent reads (`corpusService.get`) against a throwaway corpus, two ways:
 *   - without: straight on the long-lived App (what a non-attested tool costs);
 *   - with:    inside `McpCallScope.run` — build the call identity, open the call-scoped App (a second store
 *              connection wrapped for the identity), verify the run, run, close.
 * Prints the p95 of each in milliseconds and the difference; exits 1 when the difference is >= --max-delta-ms.
 *
 * Usage: bun scripts/bench/mcp-call-overhead.ts [--calls 100] [--max-delta-ms 20]
 * Side effects: creates and removes one temp corpus directory (never the repo's own `.lore/`).
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CreateDocInput } from "@lore/core";
import { ambientOfInvocation, createApp } from "../../packages/lore/src/app.js";
import { resolveEntryInvocation } from "../../packages/lore/src/adapters/cli/run-cli.js";
import { McpCallScope } from "../../packages/lore/src/adapters/mcp/call-scope.js";
import { SQLiteStore } from "../../packages/lore/src/store/sqlite-store.js";

function flagNumber(name: string, fallback: number): number {
  const at = process.argv.indexOf(name);
  if (at === -1) return fallback;
  const value = Number(process.argv[at + 1]);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} needs a positive number, got ${process.argv[at + 1]}`);
  return value;
}

function p95(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] as number;
}

const calls = flagNumber("--calls", 100);
const maxDeltaMs = flagNumber("--max-delta-ms", 20);
const RUN = "cc:bench-session";

const inv = await resolveEntryInvocation(process.argv.slice(2));
const root = mkdtempSync(join(tmpdir(), "lore-mcp-overhead-"));
try {
  mkdirSync(join(root, ".lore"), { recursive: true });
  const dbPath = join(root, ".lore", "lore.db");
  const app = createApp(dbPath, undefined, ambientOfInvocation(inv));
  const created = await app.corpusService.create({ type: "plan", title: "Bench Plan", content: "# Plan" } as CreateDocInput);
  if (!created.ok) throw new Error(`seed doc: ${JSON.stringify(created.error)}`);
  const slug = created.value.slug;

  const seeder = new SQLiteStore(dbPath);
  try {
    const inserted = await seeder.insertRun({
      id: RUN,
      kind: "main",
      harness: "claude-code",
      sessionRef: "bench-session",
      agentRef: null,
      agentType: null,
      parentRunId: null,
      branch: "main",
      composition: { schemaVersion: 1, fragments: [] },
      registeredAt: new Date().toISOString(),
    } as unknown as Parameters<SQLiteStore["insertRun"]>[0]);
    if (!inserted.ok) throw new Error(`seed run: ${JSON.stringify(inserted.error)}`);
  } finally {
    seeder.close();
  }

  const scope = new McpCallScope(app, inv, (line) => {
    throw new Error(`unexpected warning during bench: ${line}`);
  });

  async function timed(fn: () => Promise<unknown>): Promise<number> {
    const start = performance.now();
    await fn();
    return performance.now() - start;
  }

  // Warm both paths once so first-use costs (module init, page cache) are in neither sample.
  await app.corpusService.get(slug);
  await scope.run({ harness_run: RUN }, async (context) => {
    await context.app.corpusService.get(slug);
    return { content: [] };
  });

  const without: number[] = [];
  const withScope: number[] = [];
  for (let i = 0; i < calls; i++) {
    without.push(
      await timed(async () => {
        const r = await app.corpusService.get(slug);
        if (!r.ok) throw new Error(`get failed: ${JSON.stringify(r.error)}`);
      }),
    );
  }
  for (let i = 0; i < calls; i++) {
    withScope.push(
      await timed(async () => {
        const result = await scope.run({ harness_run: RUN }, async (context) => {
          const r = await context.app.corpusService.get(slug);
          if (!r.ok) throw new Error(`get failed: ${JSON.stringify(r.error)}`);
          return { content: [] };
        });
        if (result.isError) throw new Error(`scoped call failed: ${JSON.stringify(result.content)}`);
      }),
    );
  }

  const base = p95(without);
  const scoped = p95(withScope);
  const delta = scoped - base;
  console.log(`calls: ${calls}`); // bench output
  console.log(`p95 without per-call write context: ${base.toFixed(2)} ms`); // bench output
  console.log(`p95 with    per-call write context: ${scoped.toFixed(2)} ms`); // bench output
  console.log(`p95 delta: ${delta.toFixed(2)} ms (limit ${maxDeltaMs} ms) ${delta < maxDeltaMs ? "PASS" : "FAIL"}`); // bench output
  app.close();
  if (delta >= maxDeltaMs) process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
