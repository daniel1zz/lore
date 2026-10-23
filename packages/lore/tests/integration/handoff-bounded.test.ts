/**
 * AC-LG-10 / BR-1371: a handoff is bounded. A session that touched 1500 files across 40 runs yields
 * 150 one-line files (path + run count, no run id), one line per top-level directory for the rest,
 * one line per trail-gap kind with a count, a body of at most 16384 bytes, and an `extra` that holds
 * no copy of the rendered body.
 *
 * Writes through the real SessionService.writeHandoff with a fixture trail (no CLI, no real corpus).
 * Coverage: HAPPY (the bounded shape) / BOUNDARY (exactly 150 files, 151 files) / REGRESSION (small
 * handoff keeps every file and its run).
 */

import { describe, expect, it } from "vitest";
import { RecordLockService } from "../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../src/service/gate-enforcer.js";
import { InMemoryStore } from "../../src/store/in-memory-store.js";
import { CorpusService as Corpus } from "../../src/service/corpus-service.js";
import { SessionService } from "../../src/service/session-service.js";
import { actedStore } from "../live-invocation.js";
import type { ReadHandoffTrail } from "../../src/service/session-service.js";
type SessionTrail = NonNullable<ReturnType<ReadHandoffTrail>>;

const RUNS = 40;
const DIRS = ["packages", "docs", "scripts", "assets", "tests"];

function trailOf(fileCount: number, unmeasuredTurns: number): SessionTrail {
  const changes = Array.from({ length: fileCount }, (_, i) => ({
    path: `${DIRS[i % DIRS.length]}/mod${i % 37}/file-${i}.ts`,
    status: "M" as const,
    lines: 1,
    source: { kind: "run" as const, run: `cc:big-session:agent${i % RUNS}` },
  }));
  // every file is also touched by several other runs: the old renderer printed all of them
  const extra = changes.flatMap((c) =>
    [1, 2, 3].map((k) => ({ ...c, source: { kind: "run" as const, run: `cc:big-session:agent${(Number(c.path.length) + k) % RUNS}` } })),
  );
  const turns = [
    {
      turn: "turn-ok",
      opened_at: null,
      edits: { measured: true as const, value: [] },
      at: null,
      shared_working_copy: false,
      changes: { measured: true as const, value: [...changes, ...extra] },
    },
    ...Array.from({ length: unmeasuredTurns }, (_, i) => ({
      turn: `turn-gap-${i}`,
      opened_at: null,
      edits: { measured: true as const, value: [] },
      at: null,
      shared_working_copy: null,
      changes: { measured: false as const, reason: "changes.json absent" },
    })),
  ];
  return { session: "big-session", started_at: null, removed: null, turns, helpers: [] } as unknown as SessionTrail;
}

function makeService(trail: SessionTrail) {
  const store = actedStore(new InMemoryStore());
  const corpus = new Corpus(store, new RecordLockService(store, new GateEnforcer(undefined)));
  return new SessionService(store, {
    claimTtlMinutes: 120,
    handoffTtlMinutes: 10080,
    createHandoffDoc: corpus.createHandoffDoc.bind(corpus),
    readTrail: () => trail,
  });
}

async function write(fileCount: number, unmeasuredTurns = 0) {
  const svc = makeService(trailOf(fileCount, unmeasuredTurns));
  const r = await svc.writeHandoff(
    { by: "claude", task_refs: [], modified_files: [], key_decisions: [], next_steps: ["merge it"] },
    undefined,
    { run: "cc:big-session" },
  );
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

describe("bounded handoff", () => {
  it("bounded handoff: 1500 files, 40 runs, 700 gaps -> 150 file lines, dir groups, one gap line, <=16 KiB, no body copy", async () => {
    const doc = await write(1500, 700);
    const body = doc.content;
    expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(16384);

    const fileLines = body.split("\n").filter((l) => /^- \S+\.ts \(/.test(l));
    expect(fileLines).toHaveLength(150);
    for (const l of fileLines) {
      expect(l).toMatch(/\(\d+ runs?\)$/);
      expect(l).not.toMatch(/cc:|agent\d/);
    }

    const groupLines = body.split("\n").filter((l) => /^- [\w(). -]+\/ \(\d+ files\)$/.test(l));
    expect(groupLines.length).toBeGreaterThan(0);
    expect(groupLines.length).toBeLessThanOrEqual(DIRS.length);
    const grouped = groupLines.reduce((n, l) => n + Number(/\((\d+) files\)/.exec(l)![1]), 0);
    expect(grouped).toBe(1350);

    const gapLines = body.split("\n").filter((l) => l.startsWith("- not measured:"));
    expect(gapLines).toHaveLength(1);
    expect(gapLines[0]).toContain("700");
    expect(body).not.toMatch(/run cc:/);

    const handoff = (doc.extra as { handoff: Record<string, unknown> }).handoff;
    expect(JSON.stringify(doc.extra)).not.toContain(body.slice(0, 200));
    expect(Object.values(handoff).some((v) => v === body)).toBe(false);
    expect(JSON.stringify(doc.extra).length).toBeLessThan(65536);
    // stored detail keeps at most one representative run per file plus the count; the rest is in the audit trail
    for (const f of handoff["changed_files"] as Array<{ sources: Array<{ kind: string }> }>) {
      expect(f.sources.filter((s) => s.kind === "run").length).toBeLessThanOrEqual(1);
    }
  });

  it("bounded handoff: exactly 150 files list all, no group; 151 files group the one extra", async () => {
    const at150 = await write(150);
    expect(at150.content).not.toContain("grouped by top-level directory");
    const at151 = await write(151);
    expect(at151.content).toContain("1 more files, grouped by top-level directory");
  });

  it("bounded handoff: a small session keeps its files with a run count", async () => {
    const doc = await write(3);
    const lines = doc.content.split("\n").filter((l) => /^- \S+\.ts \(/.test(l));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/\(\d+ runs?\)/);
  });
});
