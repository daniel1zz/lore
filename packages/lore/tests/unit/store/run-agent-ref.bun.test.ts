/**
 * @spec_ref spec-worktree-removal-is-decided-by-who-is-inside-not-by-how (D1; spec-worktree-removal-is-decided-by-who-is-inside-not-by-how#AC-WL-1 store half)
 *
 * `StoreInterface.listRunsByAgentRef` across ALL THREE stores (SQLite, Turso local file, InMemory) with one
 * shared contract, so a store that drifts fails here rather than in the occupancy read.
 *
 * Coverage: HAPPY (matching runs, newest first) / NEGATIVE (other agent, main run, unknown ref -> empty) /
 * BOUNDARY (same registered_at -> id ASC) / REGRESSION (read does not alter end state or records).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunId, RunRecord } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import type { StoreInterface } from "../../../src/store/store-interface.js";
import { TursoStore } from "../../../src/store/turso-store.js";
import { actedStore } from "../../live-invocation.js";

function subagent(session: string, agent: string, registeredAt: string): RunRecord {
  return {
    id: `cc:${session}:${agent}` as RunId,
    kind: "subagent",
    harness: "claude-code",
    sessionRef: session,
    agentRef: agent,
    agentType: "t",
    parentRunId: `cc:${session}` as RunId,
    branch: null,
    composition: { schemaVersion: 1, fragments: [] },
    registeredAt,
    messageAddress: null,
  };
}

const MAIN: RunRecord = {
  id: "cc:s1" as RunId,
  kind: "main",
  harness: "claude-code",
  sessionRef: "s1",
  agentRef: null,
  agentType: null,
  parentRunId: null,
  branch: null,
  composition: { schemaVersion: 1, fragments: [] },
  registeredAt: "2026-10-12T05:00:00.000Z",
  messageAddress: null,
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lore-run-agent-ref-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const STORE_CASES: ReadonlyArray<{ name: string; open: () => Promise<{ store: StoreInterface; close: () => void }> }> = [
  {
    name: "SQLiteStore",
    open: async () => {
      const store = actedStore(new SQLiteStore(join(dir, "sqlite.db")));
      return { store, close: () => store.close() };
    },
  },
  {
    name: "TursoStore (local file)",
    open: async () => {
      const store = actedStore(new TursoStore({ localPath: join(dir, "turso.db") }));
      return { store, close: () => void store.close() };
    },
  },
  { name: "InMemoryStore", open: async () => ({ store: actedStore(new InMemoryStore()), close: () => undefined }) },
];

describe.each([...STORE_CASES])("listRunsByAgentRef store contract — $name", (storeCase) => {
  it("HAPPY: every run of the agent, newest registered_at first", async () => {
    const { store, close } = await storeCase.open();
    const older = subagent("s1", "x1", "2026-10-12T05:00:00.000Z");
    const newer = subagent("s2", "x1", "2026-10-12T06:00:00.000Z");
    await store.insertRun(older);
    await store.insertRun(newer);

    const r = await store.listRunsByAgentRef("x1");

    expect(r).toEqual({ ok: true, value: [newer, older] });
    close();
  });

  it("NEGATIVE: another agent's run, a main run and an unknown ref are not returned", async () => {
    const { store, close } = await storeCase.open();
    await store.insertRun(MAIN);
    await store.insertRun(subagent("s1", "other", "2026-10-12T05:00:00.000Z"));

    expect(await store.listRunsByAgentRef("x1")).toEqual({ ok: true, value: [] });
    expect(await store.listRunsByAgentRef("")).toEqual({ ok: true, value: [] });
    close();
  });

  it("BOUNDARY: runs registered at the same instant order by id ascending", async () => {
    const { store, close } = await storeCase.open();
    const at = "2026-10-12T05:00:00.000Z";
    const b = subagent("sb", "x1", at);
    const a = subagent("sa", "x1", at);
    await store.insertRun(b);
    await store.insertRun(a);

    expect(await store.listRunsByAgentRef("x1")).toEqual({ ok: true, value: [a, b] });
    close();
  });

  it("REGRESSION: the read leaves end state and records untouched", async () => {
    const { store, close } = await storeCase.open();
    const run = subagent("s1", "x1", "2026-10-12T05:00:00.000Z");
    await store.insertRun(run);
    await store.endRun(run.id, "2026-10-12T05:30:00.000Z", "done");

    await store.listRunsByAgentRef("x1");

    expect(await store.getRunEnd(run.id)).toEqual({
      ok: true,
      value: { endedAt: "2026-10-12T05:30:00.000Z", endReason: "done" },
    });
    expect(await store.getRun(run.id)).toEqual({ ok: true, value: run });
    close();
  });
});
