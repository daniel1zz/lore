/**
 * A milestone-review stale refresh REPLACES its own previous evidence row for the same criterion instead of growing
 * the task's evidence log (task q2, resolves #393). Bazel action-cache shape: one current entry per action key.
 *
 * Dimension mapping:
 *   HAPPY:      a refresh at the 50-row cap replaces the criterion's previous refresh row; the count does not grow
 *   NEGATIVE:   a non-refresh append at the cap is still refused with the existing "full" error
 *   BOUNDARY:   a refresh at the cap with NO previous refresh row of that criterion is refused (nothing to replace)
 *   ERROR:      a refresh row without an `ac_ref` is refused loud, nothing written
 *   STATE:      repeated refreshes below the cap keep exactly one refresh row; another criterion's refresh row and
 *               a same-criterion non-refresh row are never replaced
 *   REGRESSION: the newest verdict is the last row of the criterion (what latest-verdict readers see), and the
 *               replacement is recorded in the audit row
 *
 * reason: the refresh marker is attached through a structural cast so this file loads before the field exists.
 */

import { describe, it, expect } from "vitest";
import type { CreateDocInput, DocRecord } from "@lore/core";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { AcService } from "../../../src/service/ac-service.js";
import { TaskWorkflowService, type VerifiedEvidenceInput } from "../../../src/service/task-workflow-service.js";
import { actedStore } from "../../live-invocation.js";

const AC_A = "AC-ZQ-1";
const AC_B = "AC-ZQ-2";
const FULL = /Evidence log is full/;

async function make() {
  const store = actedStore(new InMemoryStore());
  const lock = new RecordLockService(store, new GateEnforcer(undefined));
  const corpus = new CorpusService(store, lock);
  const ac = new AcService(store, lock);
  const tws = new TaskWorkflowService(
    store,
    undefined,
    { claimTtlMinutes: 120 },
    corpus.resolveDeclaredAcIds.bind(corpus),
    undefined,
    undefined,
    undefined,
    corpus.resolveDeclaredAcCriteria.bind(corpus),
  );
  const mk = async (input: CreateDocInput): Promise<string> => {
    const r = await corpus.create(input);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.value.id;
  };
  await mk({ type: "prd", title: "Refresh PRD", content: "root" } as CreateDocInput);
  const specId = await mk({ type: "spec", title: "Refresh Spec", content: "body" } as CreateDocInput);
  const planId = await mk({ type: "plan", title: "Refresh Plan", parent_id: specId, content: "body" } as CreateDocInput);
  const taskId = await mk({
    type: "task",
    title: "Refresh Task",
    parent_id: planId,
    content: "body",
    extra: { plan_id: planId },
  } as CreateDocInput);
  for (const id of [AC_A, AC_B]) {
    const added = await ac.addCriterion(specId, {
      id,
      statement: `criterion ${id}`,
      verify: { mode: "script", oracle: "test", command: "true" },
    });
    if (!added.ok) throw new Error(JSON.stringify(added.error));
  }
  return { store, tws, taskId };
}

type Fx = Awaited<ReturnType<typeof make>>;

function row(opts: { ac?: string; refresh: boolean; result?: "pass" | "fail"; tag: string }): VerifiedEvidenceInput {
  return {
    oracle: "test",
    command: `echo ${opts.tag}`,
    result: opts.result ?? "pass",
    recorded_by: "agent:refresh-test",
    capture_source: "runner",
    output_tail: opts.tag,
    ...(opts.ac !== undefined ? { ac_ref: opts.ac } : {}),
    ...(opts.refresh ? { milestone_refresh: true } : {}),
    attestation: { runner: "lore-cli", exit_code: opts.result === "fail" ? 1 : 0, duration_ms: 1, timed_out: false },
  } as unknown as VerifiedEvidenceInput;
}

async function write(fx: Fx, entry: VerifiedEvidenceInput, at: string) {
  return fx.tws.recordVerifiedEvidence(fx.taskId, entry, at);
}

async function rows(fx: Fx): Promise<Array<Record<string, unknown>>> {
  const found = await fx.store.find(fx.taskId);
  if (!found.ok || found.value === null) throw new Error("task fetch failed");
  const raw = (found.value as DocRecord).extra["verification_evidence"];
  return Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
}

/** Fills the log to exactly `total` rows: plain rows first, then the given refresh row last. */
async function fillTo(fx: Fx, total: number, refresh: Array<{ ac: string; tag: string }>) {
  const plain = total - refresh.length;
  for (let i = 0; i < plain; i++) {
    const r = await write(fx, row({ refresh: false, tag: `plain-${i}` }), `2026-10-01T00:00:${String(i).padStart(2, "0")}.000Z`);
    expect(r.ok).toBe(true);
  }
  for (const [i, item] of refresh.entries()) {
    const r = await write(fx, row({ ac: item.ac, refresh: true, tag: item.tag }), `2026-10-02T00:00:0${i}.000Z`);
    expect(r.ok).toBe(true);
  }
  expect((await rows(fx)).length).toBe(total);
}

describe("milestone refresh evidence replaces its own row", () => {
  it("HAPPY: at 50 rows a refresh of the same criterion replaces the previous refresh row, count stays 50", async () => {
    const fx = await make();
    await fillTo(fx, 50, [{ ac: AC_A, tag: "old-refresh" }]);
    const r = await write(fx, row({ ac: AC_A, refresh: true, result: "fail", tag: "new-refresh" }), "2026-10-03T00:00:00.000Z");
    expect(r.ok).toBe(true);
    const after = await rows(fx);
    expect(after.length).toBe(50);
    expect(after.some((e) => e["output_tail"] === "old-refresh")).toBe(false);
    const last = after.filter((e) => e["ac_ref"] === AC_A).at(-1);
    expect(last?.["output_tail"]).toBe("new-refresh");
    expect(last?.["result"]).toBe("fail");
  });

  it("NEGATIVE: a non-refresh append at 50 rows is still refused with the existing error", async () => {
    const fx = await make();
    await fillTo(fx, 50, [{ ac: AC_A, tag: "old-refresh" }]);
    const r = await write(fx, row({ ac: AC_A, refresh: false, tag: "plain-extra" }), "2026-10-03T00:00:00.000Z");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(FULL);
    expect((await rows(fx)).length).toBe(50);
  });

  it("BOUNDARY: a refresh at 50 rows with no previous refresh row of that criterion is refused", async () => {
    const fx = await make();
    await fillTo(fx, 50, [{ ac: AC_B, tag: "other-refresh" }]);
    const r = await write(fx, row({ ac: AC_A, refresh: true, tag: "first-refresh" }), "2026-10-03T00:00:00.000Z");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(FULL);
    expect((await rows(fx)).length).toBe(50);
  });

  it("ERROR: a refresh row without ac_ref is refused loud and writes nothing", async () => {
    const fx = await make();
    const r = await write(fx, row({ refresh: true, tag: "no-ref" }), "2026-10-03T00:00:00.000Z");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION_ERROR");
    expect((await rows(fx)).length).toBe(0);
  });

  it("STATE: repeated refreshes below the cap keep one refresh row per criterion; others are untouched", async () => {
    const fx = await make();
    await write(fx, row({ ac: AC_A, refresh: false, tag: "plain-a" }), "2026-10-01T00:00:00.000Z");
    await write(fx, row({ ac: AC_B, refresh: true, tag: "refresh-b" }), "2026-10-01T00:00:01.000Z");
    for (const n of [1, 2, 3]) {
      const r = await write(fx, row({ ac: AC_A, refresh: true, tag: `refresh-a-${n}` }), `2026-10-02T00:00:0${n}.000Z`);
      expect(r.ok).toBe(true);
    }
    const after = await rows(fx);
    expect(after.map((e) => e["output_tail"])).toEqual(["plain-a", "refresh-b", "refresh-a-3"]);
  });

  it("REGRESSION: the replacement is recorded in the audit row", async () => {
    const fx = await make();
    await write(fx, row({ ac: AC_A, refresh: true, tag: "old" }), "2026-10-01T00:00:00.000Z");
    await write(fx, row({ ac: AC_A, refresh: true, tag: "new" }), "2026-10-02T00:00:00.000Z");
    const audit = await fx.store.queryAudit({ doc_id: fx.taskId });
    expect(audit.ok).toBe(true);
    if (!audit.ok) return;
    const evidenceRows = audit.value.filter((a) => a.action === "evidence");
    const details = evidenceRows.map((a) => JSON.stringify(a.details ?? {}));
    expect(details.some((d) => d.includes("refresh_replaced"))).toBe(true);
  });
});
