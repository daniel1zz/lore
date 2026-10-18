/**
 * AU-T16 oracle — `lore pending` lists only OPEN decisions: an escalation whose subject was re-measured on a newer
 * version, or whose subject no longer exists, is CLOSED by an appended marker row (never an edit or delete).
 * Control: an escalation with the subject present and no newer version stays pending.
 *
 */
import { describe, expect, it } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { DecisionService } from "../../../src/service/decision-service.js";
import { createSubjectExistenceProbes, type SubjectProbePorts } from "../../../src/service/decision-subject-probes.js";
import type { SubjectExistence, SubjectExistenceProbes } from "../../../src/service/pending-decisions.js";
import { verifyDecisionChain } from "../../../src/store/decision-log.js";

const CLASS_ID = "stash-drop";
/** Facts that make stash-drop escalate (weak evidence, mirrors autonomy-human-channel.test.ts). */
const ESCALATING = { recoverability: "loss-free-by-proof", blast: "calling-session", evidence: "none" } as const;
/** Facts that make stash-drop decide `auto` (same as the escalating ones with strong evidence); C is computed by DecisionService (AU-T8), never supplied. */
const AUTO_FACTS = { recoverability: "loss-free-by-proof", blast: "calling-session", evidence: "lore-evaluated" } as const;

function serviceWith(subjectProbes?: SubjectExistenceProbes) {
  const store = new InMemoryStore();
  let tick = 0;
  const service = new DecisionService({
    store,
    executorRun: null,
    now: () => `2026-10-18T00:00:${String(tick++).padStart(2, "0")}.000Z`,
    ...(subjectProbes !== undefined ? { subjectProbes } : {}),
  });
  return { store, service };
}

function fakePorts(overrides: Partial<SubjectProbePorts>): SubjectProbePorts {
  return {
    listWorktreePaths: () => [],
    realPath: (p) => p,
    listStashShas: () => [],
    inspectProcess: async () => null,
    runEnded: async () => null,
    ...overrides,
  };
}

describe("AU-T16 pending closes stale escalations", () => {
  it("control: escalate with the subject present and no newer version stays pending", async () => {
    const { service } = serviceWith({ [CLASS_ID]: async () => "present" });
    const first = await service.decide(CLASS_ID, { id: "wt-1", version: "v1" }, ESCALATING);
    expect(first.ok && first.value.decision.verdict).toBe("escalate");
    const pending = await service.listPending();
    expect(pending.ok && pending.value.map((p) => [p.class, p.subject_id, p.subject_version])).toEqual([[CLASS_ID, "wt-1", "v1"]]);
  });

  it("escalate v1 then a decision under v2 -> v1 is no longer pending, closed by ONE appended marker", async () => {
    const { store, service } = serviceWith();
    await service.decide(CLASS_ID, { id: "wt-1", version: "v1" }, ESCALATING);
    const v2 = await service.decide(CLASS_ID, { id: "wt-1", version: "v2" }, AUTO_FACTS);
    expect(v2.ok && v2.value.effective.verdict).toBe("auto");
    const before = await store.listDecisionLog();
    const rowsBefore = before.ok ? before.value.length : -1;

    const pending = await service.listPending();
    expect(pending.ok && pending.value).toEqual([]);

    const after = await store.listDecisionLog();
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.length).toBe(rowsBefore + 1);
    const marker = after.value[after.value.length - 1];
    expect(marker?.subject_version).toBe("v1");
    expect(marker?.channel).toBe("machine");
    expect(marker?.verdict).toBe("superseded");
    // a marker is not an auto decision: nothing that selects verdict = 'auto' sees it
    expect(after.value.filter((r) => r.verdict === "auto").map((r) => r.subject_version)).toEqual(["v2"]);
    expect(JSON.parse(marker?.facts ?? "{}")).toEqual({
      superseded: { pending_id: 1, cause: "newer-version", detail: expect.stringContaining("version v2") },
    });
    expect(verifyDecisionChain(after.value)).toEqual({ clean: true, checked: rowsBefore + 1 });
    // the original escalate row is untouched
    expect(after.value[0]?.verdict).toBe("escalate");
  });

  it("subject removed (probe absent) -> no longer pending, marker cause subject-gone", async () => {
    let existence: SubjectExistence = "present";
    const { store, service } = serviceWith({ [CLASS_ID]: async () => existence });
    await service.decide(CLASS_ID, { id: "wt-1", version: "v1" }, ESCALATING);
    expect((await service.listPending()).ok && (await service.listPending()).ok).toBe(true);
    const stillThere = await service.listPending();
    expect(stillThere.ok && stillThere.value.length).toBe(1);

    existence = "absent";
    const gone = await service.listPending();
    expect(gone.ok && gone.value).toEqual([]);
    const rows = await store.listDecisionLog();
    const last = rows.ok ? rows.value[rows.value.length - 1] : undefined;
    expect(JSON.parse(last?.facts ?? "{}").superseded.cause).toBe("subject-gone");
  });

  it("unknown existence never closes (fail safe)", async () => {
    const { service } = serviceWith({ [CLASS_ID]: async () => "unknown" });
    await service.decide(CLASS_ID, { id: "wt-1", version: "v1" }, ESCALATING);
    const pending = await service.listPending();
    expect(pending.ok && pending.value.length).toBe(1);
  });

  it("two listers produce no double count: pending stays empty and a third list appends nothing", async () => {
    const { store, service } = serviceWith({ [CLASS_ID]: async () => "absent" });
    await service.decide(CLASS_ID, { id: "wt-1", version: "v1" }, ESCALATING);
    const [a, b] = await Promise.all([service.listPending(), service.listPending()]);
    expect(a.ok && a.value).toEqual([]);
    expect(b.ok && b.value).toEqual([]);
    const afterBoth = await store.listDecisionLog();
    const count = afterBoth.ok ? afterBoth.value.length : -1;
    expect(count).toBeGreaterThanOrEqual(2);
    expect(count).toBeLessThanOrEqual(3);
    await service.listPending();
    const afterThird = await store.listDecisionLog();
    expect(afterThird.ok && afterThird.value.length).toBe(count);
  });

  it("a re-escalation appended after a closing marker reopens the decision", async () => {
    let existence: SubjectExistence = "absent";
    const { service } = serviceWith({ [CLASS_ID]: async () => existence });
    await service.decide(CLASS_ID, { id: "wt-1", version: "v1" }, ESCALATING);
    await service.listPending();
    existence = "present";
    await service.decide(CLASS_ID, { id: "wt-1", version: "v1" }, ESCALATING);
    const pending = await service.listPending();
    expect(pending.ok && pending.value.length).toBe(1);
  });

  it("a marker is ignored by the effective verdict (the key stays escalate)", async () => {
    const { service } = serviceWith({ [CLASS_ID]: async () => "absent" });
    await service.decide(CLASS_ID, { id: "wt-1", version: "v1" }, ESCALATING);
    await service.listPending();
    const effective = await service.effectiveVerdict(CLASS_ID, { id: "wt-1", version: "v1" });
    expect(effective.ok && effective.value?.verdict).toBe("escalate");
  });
});

describe("AU-T16 human-answer-only classes", () => {
  it("a threshold-integrity escalation stays pending despite a newer version and an absent probe", async () => {
    const { store, service } = serviceWith({ "threshold-integrity": async () => "absent" });
    const base = { ts: "2026-10-18T01:00:00.000Z", factors: "{}", score: 0, threshold: null, reasons: "[]", executor_run: null, channel: "machine" as const };
    await store.appendDecisionRecord({ ...base, class: "threshold-integrity", subject_id: "thresholds", subject_version: "h1", facts: "{}", verdict: "escalate" });
    await store.appendDecisionRecord({ ...base, class: "threshold-integrity", subject_id: "thresholds", subject_version: "h2", facts: "{}", verdict: "auto" });
    await store.appendDecisionRecord({ ...base, class: "autonomy-threshold-write", subject_id: "thresholds", subject_version: "h3", facts: "{}", verdict: "auto" });
    const pending = await service.listPending();
    expect(pending.ok && pending.value.map((p) => [p.class, p.subject_version])).toEqual([["threshold-integrity", "h1"]]);
    const rows = await store.listDecisionLog();
    expect(rows.ok && rows.value.some((r) => r.verdict === "superseded")).toBe(false);
  });
});

describe("AU-T16 class existence probes", () => {
  const subject = (id: string, version = "v") => ({ id, version });

  it("worktree-remove: absent from the worktree list; present when listed; unknown when the listing failed", async () => {
    const gone = createSubjectExistenceProbes(fakePorts({ listWorktreePaths: () => ["/repo", "/repo/wt-other"] }));
    expect(await gone["worktree-remove"]?.(subject("/repo/wt-a"))).toBe("absent");
    const here = createSubjectExistenceProbes(fakePorts({ listWorktreePaths: () => ["/repo", "/repo/wt-a"] }));
    expect(await here["worktree-remove"]?.(subject("/repo/wt-a"))).toBe("present");
    const failed = createSubjectExistenceProbes(fakePorts({ listWorktreePaths: () => null }));
    expect(await failed["worktree-remove"]?.(subject("/repo/wt-a"))).toBe("unknown");
  });

  it("stash-drop: sha missing from the stash list is absent, listed is present, failed listing is unknown", async () => {
    expect(await createSubjectExistenceProbes(fakePorts({ listStashShas: () => ["abc"] }))["stash-drop"]?.(subject("def"))).toBe("absent");
    expect(await createSubjectExistenceProbes(fakePorts({ listStashShas: () => ["abc"] }))["stash-drop"]?.(subject("abc"))).toBe("present");
    expect(await createSubjectExistenceProbes(fakePorts({ listStashShas: () => null }))["stash-drop"]?.(subject("abc"))).toBe("unknown");
  });

  it("process-reap: gone pid, zombie and reused pid are absent; same start time is present", async () => {
    const probe = (inspected: { zombie: boolean; startTime: string | null } | null) =>
      createSubjectExistenceProbes(fakePorts({ inspectProcess: async () => inspected }))["process-reap"];
    expect(await probe(null)?.(subject("pid:42", "T1"))).toBe("absent");
    expect(await probe({ zombie: true, startTime: "T1" })?.(subject("pid:42", "T1"))).toBe("absent");
    expect(await probe({ zombie: false, startTime: "T2" })?.(subject("pid:42", "T1"))).toBe("absent");
    expect(await probe({ zombie: false, startTime: "T1" })?.(subject("pid:42", "T1"))).toBe("present");
    expect(await probe({ zombie: false, startTime: "T1" })?.(subject("not-a-pid", "T1"))).toBe("unknown");
  });

  it("run-end-stale: ended run is absent, open run present, unknown run unknown", async () => {
    const probe = (ended: boolean | null) => createSubjectExistenceProbes(fakePorts({ runEnded: async () => ended }))["run-end-stale"];
    expect(await probe(true)?.(subject("run-1"))).toBe("absent");
    expect(await probe(false)?.(subject("run-1"))).toBe("present");
    expect(await probe(null)?.(subject("run-1"))).toBe("unknown");
  });
});
