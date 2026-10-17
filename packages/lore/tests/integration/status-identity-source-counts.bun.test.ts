// @spawns packages/lore/src/index.ts
/**
 * `lore status --json` reports a count per identity source and the `orphaned_dirty` claims.
 *
 * @spec_ref AC-ROI-10
 *   spec-run-only-write-identity-and-run-end-claim-release Scope 8; BR-1039 (`baseline-attribute-work-to-a-run`).
 *
 * Shape under test: `data.identity_sources { window_days, run, session, worktree, os, other }` and
 * `data.orphaned_dirty { count, oldest_age_minutes }`.
 *   - `run`      = the write carries an attested `harness_run` (it wins over the claimed name's source);
 *   - `session` / `worktree` / `os` = an unattested write whose audit row recorded that `details.name_source`;
 *   - `other`    = an unattested write with no recorded source (internal writers, pre-source rows) or a retired one.
 *
 * Method: the corpus is built by the REAL CLI (`lore init`, claims, `lore run end` on dirty worktrees), so it
 * already holds audit rows of its own. The test therefore reads the report BEFORE seeding and asserts the DELTA
 * the seeded rows cause. Seeded rows go through `withWriteContext` (the production stamping path) with each
 * source's invocation identity; one run-attested row and one row per source sit OUTSIDE the window and must not
 * count. `orphaned_dirty` claims are produced by `lore run end` on a dirty worktree, then aged by rewriting
 * `orphaned_dirty.at`. mkdtemp corpus only; the repo's own `.lore/` is never touched.
 *
 * Coverage: HAPPY (each source counted) / NEGATIVE (outside-window rows, released/clean claims never counted) /
 * BOUNDARY (no orphaned claims -> count 0, oldest null) / REGRESSION (harness_run_attribution intact).
 * Not covered: a claim whose worktree later went clean (that transition is AC-ROI-5's), the text-mode status lines.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { join } from "node:path";
import type { AuditEntry } from "@lore/core";
import { RunSeeder, type SeedIdentity } from "./cli/fixtures/run-seeder.js";
import { createCorpus, getClaim, registerRun, runLore, seedClaim, type Corpus } from "./cli/support/claim-run-fixture.js";
import { claimAs, cleanupWorktrees, endRun, makeWorktree } from "./support/run-end-fixture.js";

setDefaultTimeout(300_000);

interface IdentitySources {
  window_days: number;
  run: number;
  session: number;
  worktree: number;
  os: number;
  other: number;
}
interface OrphanedDirty {
  count: number;
  oldest_age_minutes: number | null;
}
interface StatusData {
  identity_sources?: IdentitySources;
  orphaned_dirty?: OrphanedDirty;
  harness_run_attribution?: { window_days: number };
}

const MINUTE = 60_000;
const DAY = 86_400_000;

let corpus: Corpus;
beforeAll(async () => {
  corpus = await createCorpus();
});
afterAll(() => {
  corpus.cleanup();
  cleanupWorktrees();
});

function statusData(): StatusData {
  const r = runLore(["status", "--json"], corpus.dir);
  expect(r.exitCode).toBe(0);
  return (JSON.parse(r.stdout) as { data: StatusData }).data;
}

function sourcesOf(data: StatusData): IdentitySources {
  if (data.identity_sources === undefined) throw new Error("MISSING BEHAVIOUR: `lore status --json` has no data.identity_sources");
  return data.identity_sources;
}
function orphanedOf(data: StatusData): OrphanedDirty {
  if (data.orphaned_dirty === undefined) throw new Error("MISSING BEHAVIOUR: `lore status --json` has no data.orphaned_dirty");
  return data.orphaned_dirty;
}

/** One audit row written as `identity` (stamped by the production write-context decorator) at `atMs`. */
async function seedWrites(rows: readonly { identity: SeedIdentity; atMs: number }[]): Promise<void> {
  const seeder = await RunSeeder.open(join(corpus.dir, ".lore", "lore.db"));
  try {
    let n = 0;
    for (const { identity, atMs } of rows) {
      n += 1;
      const entry: AuditEntry = {
        timestamp: new Date(atMs).toISOString(),
        actor: identity.claimed,
        session_id: `s-identity-source-${n}`,
        action: "update",
        details: { surface: "agent", seeded: n },
      };
      const written = await seeder.as(identity).appendAuditEntry(entry);
      if (!written.ok) throw new Error(`seed audit failed: ${JSON.stringify(written.error)}`);
    }
  } finally {
    seeder.finish();
  }
}

const ident = (claimedSource: string, harnessRun: string | null = null): SeedIdentity => ({
  harnessRun,
  claimed: `agent:seed-${claimedSource}`,
  claimedSource,
});

describe("AC-ROI-10 lore status identity sources and orphaned_dirty claims", () => {
  it("HAPPY: reports a count per identity source (run, session, worktree, os) for writes in the window", async () => {
    const before = sourcesOf(statusData());
    const now = Date.now();
    await seedWrites([
      // run: attested rows win over the claimed name's source (a `session`-named write that carries a run is `run`).
      { identity: ident("session", "cc:src-run-a"), atMs: now - 1 * DAY },
      { identity: ident("os", "cc:src-run-b"), atMs: now - 2 * DAY },
      // session x3, worktree x1, os x4 — distinct counts so a swapped bucket fails.
      ...[1, 2, 3].map((i) => ({ identity: ident("session"), atMs: now - i * 3_600_000 })),
      { identity: ident("worktree"), atMs: now - 5 * 3_600_000 },
      ...[1, 2, 3, 4].map((i) => ({ identity: ident("os"), atMs: now - i * 7_200_000 })),
      // outside the 14-day window: never counted, whatever the source.
      { identity: ident("session", "cc:src-run-old"), atMs: now - 15 * DAY },
      { identity: ident("os"), atMs: now - 20 * DAY },
    ]);

    const after = sourcesOf(statusData());

    expect(after.window_days).toBe(14);
    expect(after.run - before.run).toBe(2);
    expect(after.session - before.session).toBe(3);
    expect(after.worktree - before.worktree).toBe(1);
    expect(after.os - before.os).toBe(4);
    expect(after.other - before.other).toBe(0);
  });

  it("NEGATIVE: an unattested row with no recorded source lands in `other`, never in a named source", async () => {
    const before = sourcesOf(statusData());
    const seeder = await RunSeeder.open(join(corpus.dir, ".lore", "lore.db"));
    try {
      const bare = await seeder.as(null).appendAuditEntry({
        timestamp: new Date().toISOString(),
        actor: "system",
        session_id: "s-no-source",
        action: "update",
        details: {},
      });
      if (!bare.ok) throw new Error(`seed failed: ${JSON.stringify(bare.error)}`);
    } finally {
      seeder.finish();
    }

    const after = sourcesOf(statusData());

    expect(after.other - before.other).toBe(1);
    expect(after.run - before.run).toBe(0);
    expect(after.session - before.session).toBe(0);
    expect(after.worktree - before.worktree).toBe(0);
    expect(after.os - before.os).toBe(0);
  });

  it("BOUNDARY: with no orphaned_dirty claim the report is count 0 and oldest_age_minutes null", () => {
    expect(orphanedOf(statusData())).toEqual({ count: 0, oldest_age_minutes: null });
  });

  it("HAPPY: orphaned_dirty claims produced by `lore run end` on dirty worktrees are counted with the oldest age", async () => {
    const runA = "cc:orphan-status-a";
    const runB = "cc:orphan-status-b";
    const runClean = "cc:orphan-status-clean";
    for (const r of [runA, runB, runClean]) registerRun(corpus.dir, r);
    const taskA = await corpus.newTarget("task");
    const taskB = await corpus.newTarget("task");
    const taskClean = await corpus.newTarget("task");
    expect(claimAs(corpus.dir, taskA, runA, { worktree: makeWorktree({ dirty: true }) }).exitCode).toBe(0);
    expect(claimAs(corpus.dir, taskB, runB, { worktree: makeWorktree({ dirty: true }) }).exitCode).toBe(0);
    expect(claimAs(corpus.dir, taskClean, runClean, { worktree: makeWorktree({ dirty: false }) }).exitCode).toBe(0);
    for (const r of [runA, runB, runClean]) expect(endRun(corpus.dir, r).exitCode).toBe(0);

    // run end produced the claims; age ONE of them (rewrite orphaned_dirty.at) so oldest != newest.
    const claimA = getClaim(corpus.dir, taskA);
    expect(claimA?.["orphaned_dirty"]).toBeDefined();
    expect(getClaim(corpus.dir, taskB)?.["orphaned_dirty"]).toBeDefined();
    expect(getClaim(corpus.dir, taskClean)).toBeUndefined();
    const orphan = claimA?.["orphaned_dirty"] as { worktree: string; at: string };
    seedClaim(corpus.dir, taskA, { ...claimA, orphaned_dirty: { ...orphan, at: new Date(Date.now() - 180 * MINUTE).toISOString() } });

    const report = orphanedOf(statusData());

    expect(report.count).toBe(2);
    expect(report.oldest_age_minutes).not.toBeNull();
    expect(report.oldest_age_minutes as number).toBeGreaterThanOrEqual(180);
    expect(report.oldest_age_minutes as number).toBeLessThan(190);
  });

  it("REGRESSION: harness_run_attribution is still reported next to the new fields", () => {
    expect(statusData().harness_run_attribution?.window_days).toBe(14);
  });
});
