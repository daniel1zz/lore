// @spawns-external sleep a short-lived child process whose liveness the real probe observes, then kills
// @spawns-external ps the real process probe (production code under test) reads a pid's start time with `ps -o lstart=`
/**
 * @spec_ref spec-a-review-lease-whose-holder-process-is-gone-on-this (AC-DL-1, BR-1514, BR-1511)
 *
 * A review lease whose holder is a process of THIS machine that no longer exists is taken over at once, not at expiry.
 * Every case drives two `ReviewLeases` over ONE real SQLite store (a throwaway file, never the repo's `.lore/`) with an
 * injected clock, an injected local identity and an injected process probe (pid -> {alive, startTime} | error); nothing
 * spawns a process.
 *
 * Dimensions: HAPPY (dead pid taken over, one audit row), NEGATIVE (live / other machine / old form / probe error stay busy),
 * BOUNDARY (pid reused with another start time), ERROR (probe error is live), STATE (two racers, one winner),
 * REGRESSION (the taken-over holder's renewal reports lost).
 */

import { Database } from "bun:sqlite";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "@lore/core";
import { ReviewLeases, REVIEW_LEASE_EXPIRY_MS, type LeaseOutcome } from "../../src/service/review-batch-lease.js";
import { formatHolder, isHolderProvablyDead, parseHolder, probeLocalProcess, resolveLocalIdentity, type LocalProcessIdentity, type ProcessProbe } from "../../src/service/review-lease-liveness.js";
import { SQLiteStore } from "../../src/store/sqlite-store.js";

const T0 = Date.parse("2026-10-31T12:00:00.000Z");
const KEY = "plan:plan-x";
const START_A = "2026-10-31T08:00:00.000Z";
const START_B = "2026-10-31T09:30:00.000Z";

const identityOf = (machineId: string, pid: number, startIso: string): LocalProcessIdentity => ({ machineId, pid, startIso });

class World {
  readonly dir = mkdtempSync(join(tmpdir(), "lore-dead-holder-"));
  readonly dbPath = join(this.dir, "corpus.db");
  readonly store = new SQLiteStore(this.dbPath);
  /** pid -> what the probe answers; a pid absent from the map is "no such process". */
  readonly processes = new Map<number, { startTime: string } | "probe-error">();
  readonly probe: ProcessProbe = async (pid) => {
    const entry = this.processes.get(pid);
    if (entry === undefined) return ok({ alive: false, startTime: null });
    if (entry === "probe-error") return err({ code: "STORE_ERROR", message: "ps unavailable" });
    return ok({ alive: true, startTime: entry.startTime });
  };

  /** A `ReviewLeases` for one process identity (`null` = old form: this process carries no machine id). */
  leasesFor(identity: LocalProcessIdentity | null, base = "app"): ReviewLeases {
    return new ReviewLeases(this.store, base, () => T0, () => () => undefined, async () => undefined, { identity: async () => identity, probe: this.probe });
  }

  auditRows(): { action: string; details: Record<string, unknown> }[] {
    const db = new Database(this.dbPath, { readonly: true });
    try {
      const rows = db.query("SELECT action, details FROM audit WHERE action = 'review_lease_takeover'").all() as { action: string; details: string }[];
      return rows.map((r) => ({ action: r.action, details: JSON.parse(r.details) as Record<string, unknown> }));
    } finally {
      db.close();
    }
  }

  close(): void {
    this.store.close();
    rmSync(this.dir, { recursive: true, force: true });
  }
}

const worlds: World[] = [];
function world(): World {
  const w = new World();
  worlds.push(w);
  return w;
}
afterEach(() => {
  for (const w of worlds.splice(0)) w.close();
});

async function acquired(leases: ReviewLeases, key = KEY): Promise<Extract<LeaseOutcome, { state: "held" }>> {
  const outcome = await leases.acquire(key);
  if (!outcome.ok || outcome.value.state !== "held") throw new Error(`expected held, got ${JSON.stringify(outcome)}`);
  return outcome.value;
}
async function outcomeOf(leases: ReviewLeases, key = KEY): Promise<LeaseOutcome> {
  const outcome = await leases.acquire(key);
  if (!outcome.ok) throw new Error(`acquire failed: ${JSON.stringify(outcome.error)}`);
  return outcome.value;
}

describe("AC-DL-1: holder name carries machine, pid and start time", () => {
  it("round-trips through formatHolder / parseHolder, base containing colons and at-signs", () => {
    const name = formatHolder("app:12@x", identityOf("m1", 4242, START_A), "ab12cd34");
    expect(parseHolder(name)).toEqual({ base: "app:12@x", machineId: "m1", pid: 4242, startIso: START_A, suffix: "ab12cd34" });
  });
  it("an old-form name (no machine/pid/start) parses to null", () => {
    expect(parseHolder("app:4242#ab12cd34")).toBeNull();
    expect(formatHolder("app", null, "ab12cd34")).toBe("app#ab12cd34");
    expect(parseHolder(formatHolder("app", null, "ab12cd34"))).toBeNull();
  });
});

describe("AC-DL-1: a dead local holder is taken over at once", () => {
  it("pid absent: acquired at once (tookOver), one takeover audit row naming key, dead holder and new holder", async () => {
    const w = world();
    const dead = await acquired(w.leasesFor(identityOf("m1", 111, START_A)));
    const deadHolder = (await w.store.readLease(KEY)) as { ok: true; value: { holder: string } };
    const taker = await acquired(w.leasesFor(identityOf("m1", 222, START_B)));
    expect(taker.tookOver).toBe(true);
    const now = await w.store.readLease(KEY);
    if (!now.ok || now.value === null) throw new Error("lease row missing");
    expect(now.value.holder).not.toBe(deadHolder.value.holder);
    const rows = w.auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.details).toMatchObject({ key: KEY, dead_holder: deadHolder.value.holder, new_holder: now.value.holder });
    expect(dead.handle.lost()).toBe(false);
  });

  it("pid reused (alive, different start time): taken over the same way", async () => {
    const w = world();
    await acquired(w.leasesFor(identityOf("m1", 111, START_A)));
    w.processes.set(111, { startTime: START_B });
    const taker = await outcomeOf(w.leasesFor(identityOf("m1", 222, START_B)));
    expect(taker.state).toBe("held");
    expect(w.auditRows()).toHaveLength(1);
  });

  it("the taken-over holder's next renewal reports lost", async () => {
    const w = world();
    const old = await acquired(w.leasesFor(identityOf("m1", 111, START_A)));
    await acquired(w.leasesFor(identityOf("m1", 222, START_B)));
    const renewed = await old.handle.renewNow();
    expect(renewed.ok && renewed.value).toBe(false);
    expect(old.handle.lost()).toBe(true);
  });
});

describe("AC-DL-1: every other holder stays busy until expiry", () => {
  it("alive with the same start time: busy, no audit row", async () => {
    const w = world();
    await acquired(w.leasesFor(identityOf("m1", 111, START_A)));
    w.processes.set(111, { startTime: START_A });
    const second = await outcomeOf(w.leasesFor(identityOf("m1", 222, START_B)));
    expect(second.state).toBe("busy");
    expect(w.auditRows()).toHaveLength(0);
  });

  it("another machine id: busy even though the pid does not exist here", async () => {
    const w = world();
    await acquired(w.leasesFor(identityOf("other-machine", 111, START_A)));
    const second = await outcomeOf(w.leasesFor(identityOf("m1", 222, START_B)));
    expect(second.state).toBe("busy");
    expect(w.auditRows()).toHaveLength(0);
  });

  it("old-form holder name: busy", async () => {
    const w = world();
    await acquired(w.leasesFor(null));
    const second = await outcomeOf(w.leasesFor(identityOf("m1", 222, START_B)));
    expect(second.state).toBe("busy");
  });

  it("this process without an identity never takes over: busy even when the holder's pid is gone", async () => {
    const w = world();
    await acquired(w.leasesFor(identityOf("m1", 111, START_A)));
    const second = await outcomeOf(w.leasesFor(null));
    expect(second.state).toBe("busy");
  });

  it("probe error: busy (an error is never read as dead)", async () => {
    const w = world();
    await acquired(w.leasesFor(identityOf("m1", 111, START_A)));
    w.processes.set(111, "probe-error");
    const second = await outcomeOf(w.leasesFor(identityOf("m1", 222, START_B)));
    expect(second.state).toBe("busy");
    expect(w.auditRows()).toHaveLength(0);
  });

  it("an expired lease is still taken over by the plain path with no takeover audit row", async () => {
    const w = world();
    await acquired(w.leasesFor(identityOf("other-machine", 111, START_A)));
    const later = new ReviewLeases(w.store, "app", () => T0 + REVIEW_LEASE_EXPIRY_MS + 1, () => () => undefined, async () => undefined, { identity: async () => identityOf("m1", 222, START_B), probe: w.probe });
    const outcome = await outcomeOf(later);
    expect(outcome.state).toBe("held");
    expect(w.auditRows()).toHaveLength(0);
  });
});

describe("AC-DL-1: compare-and-set between two takers", () => {
  it("two concurrent takers of one dead holder's lease: exactly one is held, the other busy naming the winner", async () => {
    const w = world();
    await acquired(w.leasesFor(identityOf("m1", 111, START_A)));
    const [x, y] = await Promise.all([outcomeOf(w.leasesFor(identityOf("m1", 222, START_B))), outcomeOf(w.leasesFor(identityOf("m1", 333, START_B)))]);
    const held = [x, y].filter((o) => o.state === "held");
    const busy = [x, y].filter((o): o is Extract<LeaseOutcome, { state: "busy" }> => o.state === "busy");
    expect(held).toHaveLength(1);
    expect(busy).toHaveLength(1);
    const stored = await w.store.readLease(KEY);
    if (!stored.ok || stored.value === null) throw new Error("lease row missing");
    expect(busy[0]?.holder).toBe(stored.value.holder);
    expect(w.auditRows()).toHaveLength(1);
  });

  it("store.takeOverLease is conditional on the expected holder: a stale expectation takes nothing", async () => {
    const w = world();
    await acquired(w.leasesFor(identityOf("m1", 111, START_A)));
    const result = await w.store.takeOverLease(KEY, "not-the-holder", "me#1", new Date(T0 + REVIEW_LEASE_EXPIRY_MS).toISOString());
    expect(result.ok && result.value.acquired).toBe(false);
    const stored = await w.store.readLease(KEY);
    expect(stored.ok && stored.value?.holder).not.toBe("me#1");
  });
});

describe("AC-DL-1: the real process probe and identity (production code, no injection)", () => {
  async function observe(pid: number): Promise<{ alive: boolean; startTime: string | null }> {
    const result = await probeLocalProcess(pid);
    if (!result.ok) throw new Error(`probe failed: ${JSON.stringify(result.error)}`);
    return result.value;
  }

  it("a live child is alive with a start time; after it is killed and has exited, the probe says dead", async () => {
    const child = spawn("sleep", ["30"], { stdio: "ignore" });
    const pid = child.pid;
    if (pid === undefined) throw new Error("sleep did not start");
    try {
      const alive = await observe(pid);
      expect(alive.alive).toBe(true);
      expect(alive.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.kill("SIGKILL");
      await exited;
      expect(await observe(pid)).toEqual({ alive: false, startTime: null });
      // the dead child's holder name is dead to the real probe, and live when the recorded start time is its own
      const holder = formatHolder("app", identityOf("m1", pid, alive.startTime ?? START_A), "ab12cd34");
      expect(await isHolderProvablyDead(holder, identityOf("m1", process.pid, START_B), probeLocalProcess)).toBe(true);
    } finally {
      child.kill("SIGKILL");
    }
  });

  it("this process: alive, with the same start time on two probes", async () => {
    const first = await observe(process.pid);
    const second = await observe(process.pid);
    expect(first.alive).toBe(true);
    expect(first.startTime).not.toBeNull();
    expect(second).toEqual(first);
  });

  it("resolveLocalIdentity is stable across two calls and across a fresh module load, writing only under LORE_HOME", async () => {
    const home = mkdtempSync(join(tmpdir(), "lore-home-"));
    const before = process.env["LORE_HOME"];
    process.env["LORE_HOME"] = home;
    try {
      vi.resetModules();
      const fresh = await import("../../src/service/review-lease-liveness.js");
      const a = await fresh.resolveLocalIdentity();
      const b = await fresh.resolveLocalIdentity();
      if (a === null) throw new Error("this machine yields no identity (boot id or stored id unreadable)");
      expect(b).toEqual(a);
      expect(a.machineId).toMatch(/^[0-9a-f]{16}$/);
      expect(a.pid).toBe(process.pid);
      expect(existsSync(join(home, "machine-id"))).toBe(true);
      // a second module load re-derives the id from the stored file: same machine id
      vi.resetModules();
      const again = await (await import("../../src/service/review-lease-liveness.js")).resolveLocalIdentity();
      expect(again?.machineId).toBe(a.machineId);
    } finally {
      if (before === undefined) delete process.env["LORE_HOME"];
      else process.env["LORE_HOME"] = before;
      rmSync(home, { recursive: true, force: true });
    }
    // the statically imported copy is the same function the app wires; it is only referenced here, never run against HOME
    expect(typeof resolveLocalIdentity).toBe("function");
  });
});
