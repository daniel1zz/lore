/**
 * `SessionService.seatClaims` (spec-session-start-injection-carries-only-the-session-s-own,
 * AC-SI-10, D3, D11, D12) — InMemoryStore + an injected realpath port; the real
 * filesystem is never touched.
 *
 * HAPPY:      branch-name match; path match; symlink-recorded vs real seat path and the reverse
 * NEGATIVE:   other branch, other worktree path, no-worktree claim, relative claim ('.', 'foo'), empty claim
 * BOUNDARY:   trailing slash; ENOENT port falls back to path.resolve; archived/deprecated excluded
 * STATE:      stale claim flagged; claimed_at ascending order
 * REGRESSION: read-only (store write spy count 0)
 */

import { describe, it, expect } from "vitest";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { SessionService } from "../../../src/service/session-service.js";
import type { CreateDocInput, DocRecord } from "@lore/core";

/** Fake realpath: `links` maps symlink -> real target; anything else not in `existing` throws ENOENT. */
function fakeRealpath(links: Record<string, string>, existing: string[]) {
  return (p: string): string => {
    const linked = links[p];
    if (linked !== undefined) return linked;
    if (existing.includes(p)) return p;
    const e = new Error(`ENOENT: no such file or directory, realpath '${p}'`) as NodeJS.ErrnoException;
    e.code = "ENOENT";
    throw e;
  };
}

const REAL = "/private/tmp/seat-x";
const LINK = "/tmp/seat-x";
const PORT = fakeRealpath({ [LINK]: REAL, "/tmp/seat-x/": REAL }, [REAL, "/other/dir"]);

async function setup(realpath = PORT) {
  const store = new InMemoryStore();
  const corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const service = new SessionService(
    store,
    {
      claimTtlMinutes: 120,
      handoffTtlMinutes: 10080,
      createHandoffDoc: corpus.createHandoffDoc.bind(corpus),
    },
    undefined,
    undefined,
    undefined,
    realpath,
  );
  const plan = await corpus.create({ type: "plan", title: "Plan A", content: "# A" } as CreateDocInput);
  if (!plan.ok) throw new Error(JSON.stringify(plan.error));
  const planDoc: DocRecord = plan.value;
  let n = 0;
  async function task(
    claim: { worktree?: string; at?: string } | null,
    status: DocRecord["status"] = "approved",
  ): Promise<DocRecord> {
    n += 1;
    const created = await corpus.create({
      type: "task",
      title: `Task ${n}`,
      parent_id: planDoc.id,
      content: "# T",
      extra: { plan_id: planDoc.id },
    } as CreateDocInput);
    if (!created.ok) throw new Error(JSON.stringify(created.error));
    const extra: Record<string, unknown> = { plan_id: planDoc.id };
    if (claim !== null) {
      extra["claim"] = {
        by: "agent:x",
        at: claim.at ?? new Date().toISOString(),
        ...(claim.worktree === undefined ? {} : { worktree: claim.worktree }),
      };
    }
    const patched = await store.update(created.value.id, { extra, status });
    if (!patched.ok) throw new Error(JSON.stringify(patched.error));
    return patched.value;
  }
  return { store, service, task, plan: planDoc };
}

async function slugs(service: SessionService, seat: { branch: string; worktree: string }): Promise<string[]> {
  const r = await service.seatClaims(seat);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value.map((c) => c.task_slug);
}

describe("AC-SI-10 SessionService.seatClaims", () => {
  it("HAPPY: matches a claim recorded with the seat branch name", async () => {
    const { service, task } = await setup();
    const t = await task({ worktree: "feat-x" });
    expect(await slugs(service, { branch: "feat-x", worktree: REAL })).toEqual([t.slug]);
  });

  it("HAPPY: returns the {task_slug, plan_slug, claimed_at, stale} shape", async () => {
    const { service, task, plan } = await setup();
    const t = await task({ worktree: "feat-x", at: new Date().toISOString() });
    const r = await service.seatClaims({ branch: "feat-x", worktree: REAL });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toHaveLength(1);
    expect(r.value[0]).toMatchObject({ task_slug: t.slug, plan_slug: plan.slug, stale: false });
    expect(Object.keys(r.value[0] ?? {}).sort()).toEqual(["claimed_at", "plan_slug", "stale", "task_slug"]);
  });

  it("HAPPY: claim recorded as a symlink path matches the real seat path", async () => {
    const { service, task } = await setup();
    const t = await task({ worktree: LINK });
    expect(await slugs(service, { branch: "other", worktree: REAL })).toEqual([t.slug]);
  });

  it("HAPPY: claim recorded as the real path matches a symlinked seat path (the reverse)", async () => {
    const { service, task } = await setup();
    const t = await task({ worktree: REAL });
    expect(await slugs(service, { branch: "other", worktree: LINK })).toEqual([t.slug]);
  });

  it("BOUNDARY: a trailing-slash claim path matches", async () => {
    const { service, task } = await setup();
    const t = await task({ worktree: "/tmp/seat-x/" });
    expect(await slugs(service, { branch: "other", worktree: REAL })).toEqual([t.slug]);
  });

  it("BOUNDARY: a port that throws ENOENT falls back to path.resolve and matches the identical string", async () => {
    const { service, task } = await setup();
    const t = await task({ worktree: "/gone/dir/../dir" });
    expect(await slugs(service, { branch: "other", worktree: "/gone/dir" })).toEqual([t.slug]);
  });

  it("ERROR: a realpath failure that is NOT ENOENT is surfaced, never swallowed", async () => {
    const boom = (p: string): string => {
      const e = new Error(`EACCES: '${p}'`) as NodeJS.ErrnoException;
      e.code = "EACCES";
      throw e;
    };
    const { service, task } = await setup(boom);
    await task({ worktree: "/abs/path" });
    const r = await service.seatClaims({ branch: "other", worktree: "/abs/seat" });
    expect(r.ok).toBe(false);
  });

  it("NEGATIVE: excludes another branch, another worktree path, and claims with no worktree", async () => {
    const { service, task } = await setup();
    await task({ worktree: "feat-y" });
    await task({ worktree: "/other/dir" });
    await task({});
    await task(null);
    expect(await slugs(service, { branch: "feat-x", worktree: REAL })).toEqual([]);
  });

  it("NEGATIVE: a relative claim ('.', 'foo') is compared only as a branch, never as a path", async () => {
    const { service, task } = await setup();
    const dot = await task({ worktree: "." });
    const foo = await task({ worktree: "foo" });
    // seat worktree resolves from cwd would equal "."; must NOT match as a path
    expect(await slugs(service, { branch: "other", worktree: process.cwd() })).toEqual([]);
    expect(await slugs(service, { branch: "foo", worktree: REAL })).toEqual([foo.slug]);
    expect(await slugs(service, { branch: ".", worktree: REAL })).toEqual([dot.slug]);
  });

  it("NEGATIVE: an empty claim.worktree matches nothing, even an empty seat branch", async () => {
    const { service, task } = await setup();
    await task({ worktree: "" });
    expect(await slugs(service, { branch: "", worktree: REAL })).toEqual([]);
    expect(await slugs(service, { branch: "feat-x", worktree: REAL })).toEqual([]);
  });

  it("BOUNDARY: excludes archived and deprecated tasks", async () => {
    const { service, task } = await setup();
    const live = await task({ worktree: "feat-x" });
    await task({ worktree: "feat-x" }, "archived");
    await task({ worktree: "feat-x" }, "deprecated");
    expect(await slugs(service, { branch: "feat-x", worktree: REAL })).toEqual([live.slug]);
  });

  it("STATE: a claim older than claimTtlMinutes is stale:true; a fresh one stale:false", async () => {
    const { service, task } = await setup();
    const old = new Date(Date.now() - 121 * 60_000).toISOString();
    const stale = await task({ worktree: "feat-x", at: old });
    const fresh = await task({ worktree: "feat-x" });
    const r = await service.seatClaims({ branch: "feat-x", worktree: REAL });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const bySlug = new Map(r.value.map((c) => [c.task_slug, c.stale]));
    expect(bySlug.get(stale.slug)).toBe(true);
    expect(bySlug.get(fresh.slug)).toBe(false);
  });

  it("STATE: sorted claimed_at ascending", async () => {
    const { service, task } = await setup();
    const c = await task({ worktree: "feat-x", at: "2026-10-11T03:00:00.000Z" });
    const a = await task({ worktree: "feat-x", at: "2026-10-11T01:00:00.000Z" });
    const b = await task({ worktree: "feat-x", at: "2026-10-11T02:00:00.000Z" });
    expect(await slugs(service, { branch: "feat-x", worktree: REAL })).toEqual([a.slug, b.slug, c.slug]);
  });

  it("REGRESSION: writes nothing (store write spy count 0)", async () => {
    const { store, service, task } = await setup();
    await task({ worktree: "feat-x" });
    let writes = 0;
    for (const method of ["create", "update", "delete", "createMany", "updateMany"] as const) {
      const original = (store as unknown as Record<string, unknown>)[method];
      if (typeof original !== "function") continue;
      (store as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
        writes += 1;
        return (original as (...a: unknown[]) => unknown).apply(store, args);
      };
    }
    await service.seatClaims({ branch: "feat-x", worktree: REAL });
    expect(writes).toBe(0);
  });
});
