/**
 * @spec_ref spec-one-worktree-removal-test-for-the-guard-lore-done-and-a (AC-WS-1; D1, D2, D5; BR-1070, BR-1079)
 * @task task-single-worktree-removal-test-used-by-the-hook-lore-done
 *
 * The single removal test, pure over injected facts. Facts carry NO time value (D5): the facts type has no reflog /
 * commit / claim age, so "a commit 60 seconds old" is not even expressible — case (a) proves the verdict does not
 * depend on it by asserting the whole fact set is time-free.
 *
 * HAPPY:      (a) own stopped agent, clean, merged -> removable; (c) another session's agent whose session ended
 * NEGATIVE:   (b) foreign live session, (d) run not ended, (e) process inside, (f) dirty / unmerged / locked / main checkout
 * ERROR:      (g) any unmeasurable fact -> not-measured, never removable
 * STATE:      (h) unknown caller session never counts as owner
 * BOUNDARY:   (i) no clause reads a time value
 * REGRESSION: keep outranks not-measured (a proven keep is never softened); owner-session unregistered is not-measured
 */

import { describe, expect, it } from "vitest";
import {
  decideWorktreeRemoval,
  type Measured,
  type OwnerFact,
  type WorktreeRemovalFacts,
} from "../../../src/service/worktree-removal-test.js";

const ok = <T>(value: T): Measured<T> => ({ ok: true, value });
const miss = <T>(reason: string): Measured<T> => ({ ok: false, reason });

const owner = (over: Partial<OwnerFact> = {}): OwnerFact => ({
  run_id: "cc:S1:abc",
  session: "S1",
  mine: true,
  session_ended: false,
  ...over,
});

/** A removable worktree: linked, clean, merged, nobody inside, own stopped agent. */
const removable = (over: Partial<WorktreeRemovalFacts> = {}): WorktreeRemovalFacts => ({
  linked: ok(true),
  callerInside: ok(false),
  dirty: ok(false),
  unmerged: ok(false),
  locked: ok(false),
  agentRunLive: ok(false),
  openClaims: ok([]),
  processesInside: ok([]),
  owner: ok(owner()),
  ...over,
});

describe("decideWorktreeRemoval — the single removal test", () => {
  it("(a) own stopped agent, clean, merged -> removable with no reasons", () => {
    expect(decideWorktreeRemoval(removable())).toEqual({ verdict: "removable", reasons: [] });
  });

  it("(a) a hand-made worktree with no owning run -> removable", () => {
    expect(decideWorktreeRemoval(removable({ owner: ok(null) })).verdict).toBe("removable");
  });

  it("(b) another session's stopped agent while that session's main run is not ended -> keep foreign-live-session", () => {
    const d = decideWorktreeRemoval(removable({ owner: ok(owner({ mine: false, session: "S2", session_ended: false })) }));
    expect(d).toEqual({ verdict: "keep", reasons: ["foreign-live-session"] });
  });

  it("(c) the same with that session ended -> removable", () => {
    const d = decideWorktreeRemoval(removable({ owner: ok(owner({ mine: false, session: "S2", session_ended: true })) }));
    expect(d.verdict).toBe("removable");
  });

  it("(d) the owning run has no end -> keep run-not-ended; an open claim -> keep open-claim", () => {
    expect(decideWorktreeRemoval(removable({ agentRunLive: ok(true) }))).toEqual({ verdict: "keep", reasons: ["run-not-ended"] });
    const claim = decideWorktreeRemoval(removable({ openClaims: ok([{ task_slug: "task-x", run_id: null }]) }));
    expect(claim).toEqual({ verdict: "keep", reasons: ["open-claim"] });
  });

  it("(e) a process inside -> keep process-inside", () => {
    const d = decideWorktreeRemoval(removable({ processesInside: ok([{ pid: 4242, command: "sleep" }]) }));
    expect(d).toEqual({ verdict: "keep", reasons: ["process-inside"] });
  });

  it.each([
    ["dirty", { dirty: ok(true) }, "uncommitted-changes"],
    ["unmerged", { unmerged: ok(true) }, "unmerged-commits"],
    ["locked", { locked: ok(true) }, "locked"],
    ["main checkout", { linked: ok(false) }, "main-checkout"],
    ["caller inside", { callerInside: ok(true) }, "caller-inside"],
  ] as const)("(f) %s -> keep with its token", (_name, over, token) => {
    expect(decideWorktreeRemoval(removable(over))).toEqual({ verdict: "keep", reasons: [token] });
  });

  it("(f) every failing clause is listed in the fixed order", () => {
    const d = decideWorktreeRemoval(
      removable({ dirty: ok(true), locked: ok(true), agentRunLive: ok(true), processesInside: ok([{ pid: 1, command: "x" }]) }),
    );
    expect(d.reasons).toEqual(["uncommitted-changes", "locked", "run-not-ended", "process-inside"]);
  });

  it.each([
    ["linked", { linked: miss<boolean>("git failed") }],
    ["callerInside", { callerInside: miss<boolean>("no cwd") }],
    ["dirty", { dirty: miss<boolean>("status failed") }],
    ["unmerged", { unmerged: miss<boolean>("no main") }],
    ["locked", { locked: miss<boolean>("list failed") }],
    ["agentRunLive", { agentRunLive: miss<boolean>("store down") }],
    ["openClaims", { openClaims: miss<never[]>("store down") }],
    ["processesInside", { processesInside: miss<never[]>("lsof and /proc unavailable") }],
    ["owner", { owner: miss<OwnerFact | null>("run not registered") }],
  ] as const)("(g) an unmeasurable %s -> not-measured, never removable", (_name, over) => {
    const d = decideWorktreeRemoval(removable(over as Partial<WorktreeRemovalFacts>));
    expect(d.verdict).toBe("not-measured");
    expect(d.reasons).toHaveLength(1);
    expect(d.reasons[0]).toContain("-not-measured: ");
  });

  it("(g) the foreign owner's session main run being unregistered (session_ended null) is not-measured", () => {
    const d = decideWorktreeRemoval(removable({ owner: ok(owner({ mine: false, session: "S2", session_ended: null })) }));
    expect(d.verdict).toBe("not-measured");
    expect(d.reasons[0]).toContain("S2");
  });

  it("(g) a proven keep outranks an unmeasurable clause, and the miss is still listed", () => {
    const d = decideWorktreeRemoval(removable({ dirty: ok(true), processesInside: miss("no lsof") }));
    expect(d.verdict).toBe("keep");
    expect(d.reasons[0]).toBe("uncommitted-changes");
    expect(d.reasons[1]).toContain("processes-not-measured");
  });

  it("(h) an unknown caller session (mine=false) is not the owner: a foreign live owner keeps it", () => {
    // reason: the service maps a null caller session to mine=false; the test below is the pure half of that rule —
    // `mine:false` + live owner session must keep, whatever the session string looks like.
    const d = decideWorktreeRemoval(removable({ owner: ok(owner({ mine: false, session: "", session_ended: false })) }));
    expect(d.verdict).toBe("keep");
    expect(d.reasons).toContain("foreign-live-session");
  });

  it("(h) mine=true is the only thing that waives the live-session clause", () => {
    expect(decideWorktreeRemoval(removable({ owner: ok(owner({ mine: true, session_ended: false })) })).verdict).toBe("removable");
    expect(decideWorktreeRemoval(removable({ owner: ok(owner({ mine: false, session_ended: false })) })).verdict).toBe("keep");
  });

  it("(i) the facts carry no time value anywhere: no key or nested key looks like an age, epoch or timestamp", () => {
    const keys: string[] = [];
    const walk = (value: unknown): void => {
      if (value === null || typeof value !== "object") return;
      for (const [key, inner] of Object.entries(value)) {
        keys.push(key);
        walk(inner);
      }
    };
    walk(removable({ openClaims: ok([{ task_slug: "t", run_id: "r" }]), processesInside: ok([{ pid: 1, command: "c" }]) }));
    expect(keys.filter((key) => /reflog|epoch|minute|second|stamp|quiet|recent|(^|_)age(_|$)|_at$|^time|Time/i.test(key))).toEqual([]);
  });

  it("(i) the verdict is a pure function of the facts: same facts, same decision, no clock", () => {
    const facts = removable({ agentRunLive: ok(true) });
    expect(decideWorktreeRemoval(facts)).toEqual(decideWorktreeRemoval(facts));
  });
});
