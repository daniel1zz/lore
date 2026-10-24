/**
 * @spec_ref spec-lean-governance-batch-verbs-judgment-only-at-milestones  AC-LG-12 (stale cited evidence is re-verified
 *   once per batch through the trusted runner, also for a criterion no task declares); business rule BR-1372.
 * @layer integration-stale-refresh-wiring AC-LG-12 (the REAL wiring `lore assess` uses, over a real in-process App)
 *
 * Throwaway corpus (mkdtemp + createApp), real `VerifyRunnerService`, real `CorpusService`: the refresher built by
 * `createAppStaleRefresher` (the function `assess.ts` calls) re-verifies an AC that NO task of the plan declares on a
 * reusable ad-hoc task, and the evidence is runner-attested and carries `ac_ref`.
 *
 * Coverage dimensions:
 *   HAPPY:      an AC no task declares is run through the runner; an ad-hoc task scoped to exactly it holds attested evidence
 *   STATE:      a second refresh reuses the same ad-hoc task (no second task is created)
 *   REGRESSION: a declaring task already at the 50-row evidence cap no longer blocks the refresh: the row lands on the
 *               ad-hoc task and the attested-run reader (rule state / landing evidence) sees it (#393)
 *   NEGATIVE:   an AC the governing spec does not declare is refused and no evidence is written for it
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractEvidence, type CreateDocInput, type DocRecord } from "@lore/core";
import { indexLatestAttestedRuns, attestedRunKey } from "../../src/service/attested-ac-runs.js";
import { createApp, type App } from "../../src/app.js";
import { createAppStaleRefresher } from "../../src/adapters/cli/assess-stale-refresh.js";
import { liveAmbient, liveWriteContext } from "../live-invocation.js";

let dir: string;
let app: App;
let planSlug: string;
let planId: string;
let specId: string;

async function must<T>(result: Promise<{ ok: true; value: T } | { ok: false; error: unknown }>, what: string): Promise<T> {
  const done = await result;
  if (!done.ok) throw new Error(`${what}: ${JSON.stringify(done.error)}`);
  return done.value;
}

beforeEach(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "lore-stale-refresh-wiring-")));
  mkdirSync(join(dir, ".lore"), { recursive: true });
  app = createApp(join(dir, ".lore", "lore.db"), undefined, liveAmbient(), liveWriteContext());
  const prd = await must(app.corpusService.create({ type: "prd", title: "Refresh PRD", content: "root" } as CreateDocInput), "prd");
  void prd;
  const spec = await must(app.corpusService.create({ type: "spec", title: "Refresh spec", content: "## Overview/Goal\n\nRefresh.\n\n## Scope\n\nOne criterion.\n\n## Acceptance Criteria\n\nAC-RF-1." } as CreateDocInput), "spec");
  if (app.acService === undefined) throw new Error("acService is not wired");
  await must(
    app.acService.addCriterion(spec.slug, {
      id: "AC-RF-1",
      statement: "refreshes",
      verify: { mode: "script", oracle: "other", command: "echo refreshed && echo 'AC-RF-1 PASS'" },
    }),
    "ac",
  );
  const plan = await must(app.corpusService.create({ type: "plan", title: "Refresh plan", parent_id: spec.id, content: "plan" } as CreateDocInput), "plan");
  planSlug = plan.slug;
  planId = plan.id;
  specId = spec.id;
  // a task of the plan that declares NO ac_scope: AC-RF-1 is declared by no task
  await must(
    app.corpusService.create({ type: "task", title: "Unscoped work", parent_id: plan.id, content: "x", extra: { plan_id: plan.id, ac_scope: [] } } as CreateDocInput),
    "task",
  );
});

afterEach(() => {
  app.close();
  rmSync(dir, { recursive: true, force: true });
});

async function adhocTasks(): Promise<DocRecord[]> {
  const listed = await must(app.corpusService.listFull({ type: "task" }), "list tasks");
  return listed.docs.filter((task) => task.extra["adhoc"] === true);
}

function refresher() {
  const verify = app.verifyRunnerService;
  if (verify === undefined) throw new Error("verifyRunnerService is not wired");
  return createAppStaleRefresher(app, verify, { executionRoot: dir, by: "agent:stale-refresh-test", nowIso: () => new Date().toISOString() });
}

describe("stale refresh wiring — an AC no task declares is re-verified end to end (AC-LG-12)", () => {
  it("HAPPY: the criterion runs through the trusted runner on an ad-hoc task scoped to it, with attested evidence carrying ac_ref", async () => {
    const out = await refresher().runAcs(planSlug, ["AC-RF-1"]);
    expect(out, JSON.stringify(out)).toMatchObject({ ok: true });
    const adhoc = await adhocTasks();
    expect(adhoc).toHaveLength(1);
    expect(adhoc[0]?.extra["ac_scope"]).toEqual(["AC-RF-1"]);
    const evidence = extractEvidence(adhoc[0] as DocRecord);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({ result: "pass", ac_ref: "AC-RF-1" });
    expect(evidence[0]?.attestation).toBeDefined();
  }, 60_000);

  it("STATE: a second refresh reuses the same ad-hoc task", async () => {
    expect((await refresher().runAcs(planSlug, ["AC-RF-1"])).ok).toBe(true);
    expect((await refresher().runAcs(planSlug, ["AC-RF-1"])).ok).toBe(true);
    const adhoc = await adhocTasks();
    expect(adhoc).toHaveLength(1);
    expect(extractEvidence(adhoc[0] as DocRecord).length).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it("NEGATIVE: a criterion the governing spec does not declare is refused and writes no evidence for it", async () => {
    const out = await refresher().runAcs(planSlug, ["AC-NOPE-9"]);
    expect(out.ok).toBe(false);
    for (const task of await adhocTasks()) expect(extractEvidence(task)).toEqual([]);
  }, 60_000);

  it("REGRESSION: a declaring task at 50 rows does not block the refresh; the refresh row lands on the ad-hoc task and the latest-attested-run reader sees it (#393)", async () => {
    const declaring = await must(
      app.corpusService.create({ type: "task", title: "Declares the criterion", parent_id: planId, content: "x", extra: { plan_id: planId, ac_scope: ["AC-RF-1"] } } as CreateDocInput),
      "declaring task",
    );
    for (let i = 0; i < 50; i++) {
      await must(
        app.taskWorkflowService.addEvidence(declaring.id, { oracle: "manual", command: `echo filler-${i}`, result: "pass", recorded_by: "agent:stale-refresh-test", capture_source: "self-report", output_tail: `filler row ${i} of the cap fixture` }),
        `filler ${i}`,
      );
    }
    for (let round = 0; round < 2; round++) {
      const out = await refresher().runAcs(planSlug, ["AC-RF-1"]);
      expect(out, JSON.stringify(out)).toMatchObject({ ok: true });
    }
    const all = (await must(app.corpusService.listFull({ type: "task" }), "list tasks")).docs;
    const declaringAfter = all.find((t) => t.id === declaring.id) as DocRecord;
    expect(extractEvidence(declaringAfter)).toHaveLength(50);
    const adhoc = all.filter((t) => t.extra["adhoc"] === true);
    expect(adhoc).toHaveLength(1);
    const rows = extractEvidence(adhoc[0] as DocRecord).filter((r) => r.ac_ref === "AC-RF-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ result: "pass", milestone_refresh: true });
    const plans = (await must(app.corpusService.listFull({ type: "plan" }), "list plans")).docs;
    const index = indexLatestAttestedRuns({ specs: [{ id: specId, acIds: ["AC-RF-1"] }], plans, tasks: all });
    expect(index.latest.get(attestedRunKey(specId, "AC-RF-1"))?.result).toBe("pass");
    expect(index.originTasks.get(attestedRunKey(specId, "AC-RF-1"))?.id).toBe(adhoc[0]?.id);
  }, 120_000);
});
