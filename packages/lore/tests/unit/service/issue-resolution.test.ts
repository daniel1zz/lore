/**
 * Unit tests for the `resolves` link type (D1) and `computeIssueResolution`
 * (D2) — spec-issue-closure-loop-computed-resolution-agent-reachable.
 *
 * AC-ICL-1: `linkTypeSchema` accepts `resolves`; `CorpusService.link`'s
 *   write-time validation (the shared link write path, D1b) rejects a
 *   `resolves` edge whose target isn't an issue task. Uses `InMemoryStore` —
 *   no file I/O, no SQLite dependency, mirrors corpus-service.test.ts's harness.
 * AC-ICL-2: `computeIssueResolution` — pure, store-free (`issue-resolution.ts`).
 *
 * Six-dimension coverage (HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE /
 * REGRESSION) applied across both ACs.
 *
 * P2 extension (task-p2-computed-closed-state-for-archived-issues-without-a):
 *   `computeIssueResolution` gained the `closed` state and the
 *   `hasRecordedReviewRejection` parameter (D2's full precedence — explicit
 *   terminal state > resolves-edge computation > recorded review rejection >
 *   archived doc status > open). The e2e/cross-corpus oracles for this
 *   extension are AC-ICL-10 (`tests/e2e/issue-closed-state.bun.test.ts`) and
 *   AC-ICL-11 (`tests/unit/service/issue-report-cross-corpus.bun.test.ts`);
 *   the cases below cross-check the SAME precedence at the pure-function
 *   layer, each precedence step asserted independently rather than inferred
 *   from one combined fixture.
 *
 * @spec_ref spec-issue-closure-loop-computed-resolution-agent-reachable AC-ICL-1, AC-ICL-2, AC-ICL-10, AC-ICL-11
 */

import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import {
  computeIssueResolution,
  hasIssueReport,
  checkResolutionPointer,
  isDanglingAdoption,
  ADOPTED_RESOLUTION_POINTER,
  QUOTA_FREEING_RESOLUTIONS,
  TERMINAL_ISSUE_RESOLUTIONS,
  type ResolutionSourceDocLike,
  type ResolvesInEdgeLike,
} from "../../../src/service/issue-resolution.js";
import { IssueReportService } from "../../../src/service/issue-report-service.js";
import { ReceiptLog } from "../../../src/service/receipt-log.js";
import {
  linkTypeSchema,
  buildIssueReportExtra,
  ok,
  ISSUE_RESOLUTION_MEMBERS,
  type CreateDocInput,
  type DocRecord,
  type DocStatus,
  type IssueResolution,
  type LoreConfig,
} from "@lore/core";
import type { UpstreamPort } from "../../../src/flows/upstream-context-flow.js";

// ─── Test helpers ───────────────────────────────────────────────────────────

function makeService() {
  const store = new InMemoryStore();
  return { service: new CorpusService(store), store };
}

async function mustCreate(cs: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

/** SPEC-069 — a root PRD is required before any --adhoc task can auto-parent. */
async function createRootPrd(cs: CorpusService): Promise<DocRecord> {
  return mustCreate(cs, { type: "prd", title: "Root PRD", content: "# PRD" } as CreateDocInput);
}

/** A "fixing" doc for the `from` side of a `resolves` edge — a spec parented to the root PRD. */
async function createFixingSpec(cs: CorpusService, rootPrdId: string): Promise<DocRecord> {
  return mustCreate(cs, {
    type: "spec",
    title: "Fix for the defect",
    parent_id: rootPrdId,
    content: "# Overview/Goal\nfix\n## Scope\nn/a\n## Acceptance Criteria\nn/a",
  } as CreateDocInput);
}

/** An ad-hoc issue task carrying extra.issue_report — a valid `resolves` target. */
async function createIssueTask(
  cs: CorpusService,
  title = "Filed defect",
  issueReport: unknown = { reporter_project: "consumer-a", expected: "exit 0", actual: "exit 4" },
): Promise<DocRecord> {
  return mustCreate(cs, {
    type: "task",
    title,
    content: `# ${title}`,
    extra: { adhoc: true, issue_report: issueReport },
  } as CreateDocInput);
}

/** An ad-hoc task with NO extra.issue_report — a valid task, but an invalid `resolves` target. */
async function createPlainTask(cs: CorpusService, title = "Ordinary task"): Promise<DocRecord> {
  return mustCreate(cs, {
    type: "task",
    title,
    content: `# ${title}`,
    extra: { adhoc: true },
  } as CreateDocInput);
}

// ─── AC-ICL-1: resolves link type + write-time validation ──────────────────

describe("AC-ICL-1: resolves link type", () => {
  it("AC-ICL-1 HAPPY: linkTypeSchema accepts 'resolves'; CorpusService.link creates the edge to an issue task", async () => {
    expect(linkTypeSchema.safeParse("resolves").success).toBe(true);

    const { service } = makeService();
    const rootPrd = await createRootPrd(service);
    const fixingSpec = await createFixingSpec(service, rootPrd.id);
    const issueTask = await createIssueTask(service);

    const linkResult = await service.link(fixingSpec.id, issueTask.id, "resolves");
    expect(linkResult.ok).toBe(true);
    if (!linkResult.ok) return;
    expect(linkResult.value.link_type).toBe("resolves");
    expect(linkResult.value.from_id).toBe(fixingSpec.id);
    expect(linkResult.value.to_id).toBe(issueTask.id);
  });

  it("AC-ICL-1 NEGATIVE: resolves edge to a task lacking extra.issue_report is rejected with a named VALIDATION_ERROR", async () => {
    const { service } = makeService();
    const rootPrd = await createRootPrd(service);
    const fixingSpec = await createFixingSpec(service, rootPrd.id);
    const plainTask = await createPlainTask(service);

    const linkResult = await service.link(fixingSpec.id, plainTask.id, "resolves");
    expect(linkResult.ok).toBe(false);
    if (linkResult.ok) return;
    expect(linkResult.error.code).toBe("VALIDATION_ERROR");
  });

  it("AC-ICL-1 BOUNDARY: resolves edge to a non-task doc is rejected (type check fires independently of the issue_report check)", async () => {
    const { service } = makeService();
    const rootPrd = await createRootPrd(service);
    const fixingSpec = await createFixingSpec(service, rootPrd.id);
    // The root PRD itself: not a task at all, so hasIssueReport is irrelevant here —
    // this isolates the `toDoc.type !== "task"` half of the write-time check.
    const linkResult = await service.link(fixingSpec.id, rootPrd.id, "resolves");
    expect(linkResult.ok).toBe(false);
    if (linkResult.ok) return;
    expect(linkResult.error.code).toBe("VALIDATION_ERROR");
  });

  it("AC-ICL-1 ERROR: a task whose extra.issue_report is malformed (a string, not an object) is rejected as if absent", async () => {
    const { service } = makeService();
    const rootPrd = await createRootPrd(service);
    const fixingSpec = await createFixingSpec(service, rootPrd.id);
    const malformedTask = await createIssueTask(service, "Malformed", "not-an-object");

    // Confirms the defensive predicate itself classifies this as absent...
    expect(hasIssueReport(malformedTask.extra)).toBe(false);

    // ...and that CorpusService.link's write-time check agrees, never throwing.
    const linkResult = await service.link(fixingSpec.id, malformedTask.id, "resolves");
    expect(linkResult.ok).toBe(false);
    if (linkResult.ok) return;
    expect(linkResult.error.code).toBe("VALIDATION_ERROR");
  });

  it("AC-ICL-1 STATE: after a successful resolves link, findLinks reflects exactly one resolves edge", async () => {
    const { service, store } = makeService();
    const rootPrd = await createRootPrd(service);
    const fixingSpec = await createFixingSpec(service, rootPrd.id);
    const issueTask = await createIssueTask(service);

    await service.link(fixingSpec.id, issueTask.id, "resolves");

    const findResult = await store.findLinks(fixingSpec.id, "out");
    expect(findResult.ok).toBe(true);
    if (!findResult.ok) return;
    expect(findResult.value.length).toBe(1);
    expect(findResult.value[0]?.to_id).toBe(issueTask.id);
    expect(findResult.value[0]?.link_type).toBe("resolves");
  });

  it("AC-ICL-1 REGRESSION: non-resolves link types are unaffected by the new validation", async () => {
    const { service } = makeService();
    const rootPrd = await createRootPrd(service);
    const fixingSpec = await createFixingSpec(service, rootPrd.id);

    // A "relates-to" link to the root PRD (not a task, no issue_report) must
    // still succeed — the D1b check is scoped to type === "resolves" only.
    const linkResult = await service.link(fixingSpec.id, rootPrd.id, "relates-to");
    expect(linkResult.ok).toBe(true);
    if (!linkResult.ok) return;
    expect(linkResult.value.link_type).toBe("relates-to");
  });
});

// ─── AC-ICL-2: computeIssueResolution ───────────────────────────────────────

/** Module-scoped fixture builders — shared by AC-ICL-2's describe block AND
 * the P2 precedence-extension blocks below (`closed`/`hasRecordedReviewRejection`). */
const edge = (fromId: string): ResolvesInEdgeLike => ({ from_id: fromId });
const doc = (id: string, status: DocStatus): ResolutionSourceDocLike => ({ id, status });

describe("AC-ICL-2: computeIssueResolution", () => {

  it("AC-ICL-2 HAPPY: a resolves in-edge whose source is 'archived' computes 'fixed'", () => {
    const result = computeIssueResolution({ extra: {} }, [edge("spec-1")], [doc("spec-1", "archived")]);
    expect(result).toBe("fixed");
  });

  it("AC-ICL-2 NEGATIVE: no resolves in-edges and no explicit resolution computes 'open'", () => {
    const result = computeIssueResolution({ extra: {} }, [], []);
    expect(result).toBe("open");
  });

  it("AC-ICL-2 BOUNDARY: sweeps every DocStatus — only 'active'/'archived' cross into 'fixed', the rest stay 'resolving'", () => {
    const statuses: DocStatus[] = ["draft", "in-review", "approved", "active", "archived", "deprecated"];
    const terminal = new Set<DocStatus>(["active", "archived"]);

    for (const status of statuses) {
      const result = computeIssueResolution({ extra: {} }, [edge("spec-1")], [doc("spec-1", status)]);
      expect(result).toBe(terminal.has(status) ? "fixed" : "resolving");
    }
  });

  it("AC-ICL-2 ERROR: malformed/partial input never throws and degrades to a safe non-terminal read", () => {
    // extra is a bare string, not an object — readExplicitResolutionState must
    // degrade to "no signal" rather than throwing.
    expect(() =>
      computeIssueResolution(
        { extra: "not-an-object" as unknown },
        [edge("spec-1")],
        [doc("spec-1", "draft")],
      ),
    ).not.toThrow();
    expect(
      computeIssueResolution({ extra: "not-an-object" as unknown }, [edge("spec-1")], [doc("spec-1", "draft")]),
    ).toBe("resolving");

    // A resolves in-edge whose from_id has NO matching sourceDocs entry (partial
    // list) must degrade to non-terminal, never crash on a Map miss.
    expect(computeIssueResolution({ extra: {} }, [edge("spec-missing")], [])).toBe("resolving");
  });

  it("AC-ICL-2 STATE: an explicit terminal state wins over edge computation even when a source is terminal", () => {
    const issueWithExplicitWontfix = {
      extra: { issue_report: { resolution: { state: "wontfix", reason: "not a bug" } } },
    };
    const result = computeIssueResolution(
      issueWithExplicitWontfix,
      [edge("spec-1")],
      [doc("spec-1", "archived")], // terminal source — would compute "fixed" absent the explicit state
    );
    expect(result).toBe("wontfix");

    const issueWithExplicitRejected = {
      extra: { issue_report: { resolution: { state: "rejected", reason: "dup" } } },
    };
    expect(
      computeIssueResolution(issueWithExplicitRejected, [edge("spec-1")], [doc("spec-1", "active")]),
    ).toBe("rejected");
  });

  it("AC-ICL-2 REGRESSION: multiple in-edges, only one terminal, still computes 'fixed' (not gated on the FIRST edge or ALL edges)", () => {
    const result = computeIssueResolution(
      { extra: {} },
      [edge("spec-1"), edge("spec-2")],
      [
        { id: "spec-1", status: "draft" }, // non-terminal, listed first
        { id: "spec-2", status: "active" }, // terminal, listed second
      ],
    );
    expect(result).toBe("fixed");
  });
});

// ─── P2: computeIssueResolution's 'closed' state + recorded review        ──
// ─── rejection — D2's full 5-level precedence, each step its OWN case     ──
// ─── (task-p2-computed-closed-state-for-archived-issues-without-a)         ──

describe("P2: computeIssueResolution — 'closed' state (archived issue, no edge, no explicit terminal)", () => {
  it("HAPPY: issue's OWN status archived, no resolves in-edge, no explicit terminal state computes 'closed'", () => {
    const result = computeIssueResolution({ extra: {}, status: "archived" }, [], []);
    expect(result).toBe("closed");
  });

  it("NEGATIVE: a non-archived status with no edges stays 'open' — 'closed' is gated on status === 'archived' specifically", () => {
    const result = computeIssueResolution({ extra: {}, status: "approved" }, [], []);
    expect(result).toBe("open");
  });

  it("BOUNDARY: sweeps every DocStatus with no edges/no rejection — only 'archived' crosses into 'closed'", () => {
    const statuses: DocStatus[] = ["draft", "in-review", "approved", "active", "archived", "deprecated"];
    for (const status of statuses) {
      const result = computeIssueResolution({ extra: {}, status }, [], []);
      expect(result).toBe(status === "archived" ? "closed" : "open");
    }
  });

  it("ERROR: `status` field omitted entirely never throws and degrades to 'open' (not 'closed')", () => {
    expect(() => computeIssueResolution({ extra: {} }, [], [])).not.toThrow();
    expect(computeIssueResolution({ extra: {} }, [], [])).toBe("open");
  });

  it("STATE: an explicit terminal state wins over 'closed' even when the issue is archived", () => {
    const result = computeIssueResolution(
      { extra: { issue_report: { resolution: { state: "wontfix", reason: "stale" } } }, status: "archived" },
      [],
      [],
    );
    expect(result).toBe("wontfix");
  });

  it("REGRESSION: a resolves-edge computation (even non-terminal 'resolving') wins over 'closed' when the issue is archived", () => {
    const resolving = computeIssueResolution(
      { extra: {}, status: "archived" },
      [edge("spec-1")],
      [doc("spec-1", "draft")],
    );
    expect(resolving).toBe("resolving");

    const fixed = computeIssueResolution(
      { extra: {}, status: "archived" },
      [edge("spec-1")],
      [doc("spec-1", "active")],
    );
    expect(fixed).toBe("fixed");
  });
});

describe("P2: computeIssueResolution — recorded review rejection (hasRecordedReviewRejection)", () => {
  it("HAPPY: no resolves in-edge + hasRecordedReviewRejection=true computes 'rejected' with no explicit write at all", () => {
    const result = computeIssueResolution({ extra: {} }, [], [], true);
    expect(result).toBe("rejected");
  });

  it("NEGATIVE: hasRecordedReviewRejection=false (the default) never produces 'rejected' by itself", () => {
    expect(computeIssueResolution({ extra: {} }, [], [], false)).toBe("open");
    expect(computeIssueResolution({ extra: {} }, [], [])).toBe("open");
  });

  it("BOUNDARY: hasRecordedReviewRejection=true wins over 'closed' — an archived issue with a recorded rejection is 'rejected', not 'closed'", () => {
    const result = computeIssueResolution({ extra: {}, status: "archived" }, [], [], true);
    expect(result).toBe("rejected");
  });

  it("ERROR: hasRecordedReviewRejection=true alongside a malformed extra never throws", () => {
    expect(() =>
      computeIssueResolution({ extra: "not-an-object" as unknown }, [], [], true),
    ).not.toThrow();
    expect(computeIssueResolution({ extra: "not-an-object" as unknown }, [], [], true)).toBe("rejected");
  });

  it("STATE: precedence is fully ordered — explicit state > resolves-edge > recorded rejection > archived > open, each demonstrated independently", () => {
    // explicit state wins over a recorded rejection
    expect(
      computeIssueResolution(
        { extra: { issue_report: { resolution: { state: "wontfix", reason: "n/a" } } } },
        [],
        [],
        true,
      ),
    ).toBe("wontfix");

    // a resolves-edge (even non-terminal) wins over a recorded rejection
    expect(
      computeIssueResolution({ extra: {} }, [edge("spec-1")], [doc("spec-1", "draft")], true),
    ).toBe("resolving");

    // a recorded rejection wins over archived-doc-status ('closed')
    expect(computeIssueResolution({ extra: {}, status: "archived" }, [], [], true)).toBe("rejected");
  });

  it("REGRESSION: the 4th parameter defaults to false — every pre-existing 3-arg call site is unaffected", () => {
    // Same fixtures as the pre-existing AC-ICL-2 HAPPY/NEGATIVE cases, called
    // WITHOUT the new 4th argument — must resolve identically to before.
    expect(computeIssueResolution({ extra: {} }, [edge("spec-1")], [doc("spec-1", "archived")])).toBe("fixed");
    expect(computeIssueResolution({ extra: {} }, [], [])).toBe("open");
  });
});

// ─── §M7: `adopted` — a non-terminal, quota-freeing exit that REQUIRES an   ──
// ─── owner (spec-the-defect-channel-cannot-be-honestly-maintained-an §M7,  ──
// ─── AC-DC-14, AC-DC-15, AC-DC-16)                                         ──

const TMP_ROOT = tmpdir();
const fixturesToClean: string[] = [];
afterAll(() => {
  for (const path of fixturesToClean) {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      // reason: best-effort cleanup, mirrors every sibling integration
      // suite's afterAll (e.g. issue-cap-refusal-message.bun.test.ts).
    }
  }
});

/** A REAL `ReceiptLog` over a throwaway file — `IssueReportDeps.receipts` carries a private field, so a structural fake needs a cast; a real instance over a throwaway path avoids that entirely. */
function makeThrowawayReceiptLog(): ReceiptLog {
  const dir = mkdtempSync(join(TMP_ROOT, "lore-dc14-receipts-"));
  fixturesToClean.push(dir);
  return new ReceiptLog(join(dir, "issue-receipts.jsonl"));
}

const NOW_ISO = "2026-08-21T00:00:00.000Z";

interface CandidateSpec {
  readonly id: string;
  /** The computed resolution `getResolution` reports for this candidate. */
  readonly resolution: IssueResolution;
}

/** Builds a fake `UpstreamPort` over `candidates` — mirrors the fake-port shape `issue-cap-refusal-message.bun.test.ts` establishes, adapted for this vitest file (no compiled-binary spawn needed at this layer). */
function makeFakeUpstreamForCap(candidates: readonly CandidateSpec[]): UpstreamPort {
  const byId = new Map(candidates.map((c) => [c.id, c.resolution]));
  return {
    async resolveRootDoc() {
      return ok({ id: "01ROOTPRD", slug: "prd-lore" });
    },
    async listOpenAdhocDrafts() {
      return ok(
        candidates.map((candidate) => ({
          id: candidate.id,
          status: "draft",
          extra: buildIssueReportExtra({
            reporter_project: "consumer-a",
            reporter_actor: "agent:consumer-a",
            lore_version: "0.9.0",
            expected: "e",
            actual: "a",
            reported_at: NOW_ISO,
            possible_duplicates: [],
          }),
        })),
      );
    },
    async searchDuplicates() {
      return ok([]);
    },
    async createDraft(input) {
      return ok({ id: `01NEWDOC-${input.title.length}` });
    },
    async getResolution(id) {
      const resolution = byId.get(id);
      if (resolution === undefined) return ok(null);
      return ok({ status: "draft" as DocStatus, resolution });
    },
    async listIssueReports() {
      return ok([]);
    },
    close() {
      /* no connection to close in the fake */
    },
  };
}

/** Constructs an `IssueReportService` over `port`, with the upstream's own `feedback.inbound.open_report_cap` set to `cap` — AC-DC-3's own configurable-ceiling seam, reused here to keep this test's fixtures small (cap 3, not the shipped default 10). */
function makeServiceWithCap(port: UpstreamPort, cap: number): IssueReportService {
  return new IssueReportService({
    loadUpstreamConfig: () => ok({ feedback: { inbound: { open_report_cap: cap } } } as LoreConfig),
    probe: () => ok({ user_version: 7 }),
    expectedSchemaVersion: 7,
    openUpstream: () => ok(port),
    receipts: makeThrowawayReceiptLog(),
    loreVersion: "0.9.0",
    reporterProject: "consumer-a",
    writeWaitMs: 1234,
    now: () => NOW_ISO,
  });
}

const CAP = 3;
const BASE_INPUT = {
  title: "m7 adoption probe",
  description: "desc",
  expected: "exit 0",
  actual: "exit 4",
};
const BASE_CFG = { corpus_path: "/tmp/upstream-corpus-does-not-need-to-exist", root_prd: "prd-lore" };

describe("AC-DC-14: adopted-frees-quota — adoption frees quota without retiring the claim", () => {
  it("adopted-frees-quota HAPPY: a cap filled by N open reports refuses the N+1th; adopting ONE (--state adopted) admits it", async () => {
    // Baseline: CAP candidates, all still "open" (blocking) — filing refused.
    const openCandidates: CandidateSpec[] = Array.from({ length: CAP }, (_, i) => ({
      id: `01OPENCAND${i}`,
      resolution: "open",
    }));
    const refusedResult = await makeServiceWithCap(makeFakeUpstreamForCap(openCandidates), CAP).report(
      BASE_INPUT,
      BASE_CFG,
    );
    expect(refusedResult.ok).toBe(false);

    // Adopt ONE of the CAP candidates — its computed resolution is now
    // "adopted" instead of "open". The exact refused-then-admitted sequence
    // AC-DC-1 pins for M1/M3's terminal states, replayed here for M7's
    // non-terminal exit.
    const adoptedCandidates: CandidateSpec[] = openCandidates.map((c, i) =>
      i === 0 ? { ...c, resolution: "adopted" as IssueResolution } : c,
    );
    const admittedResult = await makeServiceWithCap(makeFakeUpstreamForCap(adoptedCandidates), CAP).report(
      BASE_INPUT,
      BASE_CFG,
    );
    expect(admittedResult.ok).toBe(true);
  });

  it("adopted-frees-quota control (a): adopted is NOT a member of TERMINAL_ISSUE_RESOLUTIONS — --resolved's complement keeps showing it as unfinished", () => {
    expect(TERMINAL_ISSUE_RESOLUTIONS.has("adopted")).toBe(false);
    // Reverse control: every OTHER member of QUOTA_FREEING_RESOLUTIONS besides
    // "adopted" IS terminal — this isolates that the exclusion is specific to
    // "adopted", not a broken membership test that would pass for anything.
    for (const state of QUOTA_FREEING_RESOLUTIONS) {
      if (state === "adopted") continue;
      expect(TERMINAL_ISSUE_RESOLUTIONS.has(state)).toBe(true);
    }
  });

  it("adopted-frees-quota control (b): quota occupancy is decided through ONE seam, compared AS A SET against TERMINAL_ISSUE_RESOLUTIONS plus adopted — never a remembered literal list", async () => {
    // The seam itself, as a SET comparison against the two live production
    // exports — never a literal list typed into this test.
    const expectedSeam = new Set<string>([...TERMINAL_ISSUE_RESOLUTIONS, "adopted"]);
    expect(new Set(QUOTA_FREEING_RESOLUTIONS)).toEqual(expectedSeam);

    // The REAL production narrowing, driven end-to-end for EVERY resolution
    // in the whole vocabulary (not just "adopted") — a candidate's admission
    // must agree with QUOTA_FREEING_RESOLUTIONS.has(state) in every case, so
    // this is a full membership isomorphism check against the seam, not a
    // spot check on one value.
    for (const state of ISSUE_RESOLUTION_MEMBERS) {
      const candidates: CandidateSpec[] = [
        ...Array.from({ length: CAP - 1 }, (_, i) => ({ id: `01FILLER${i}`, resolution: "open" as IssueResolution })),
        { id: "01SPECIAL", resolution: state },
      ];
      const result = await makeServiceWithCap(makeFakeUpstreamForCap(candidates), CAP).report(BASE_INPUT, BASE_CFG);
      expect(result.ok, `state "${state}": expected ok=${QUOTA_FREEING_RESOLUTIONS.has(state)}`).toBe(
        QUOTA_FREEING_RESOLUTIONS.has(state),
      );
    }
  });

  it("adopted-frees-quota NEGATIVE/REGRESSION: a candidate that is NOT freed still blocks — the seam does not over-admit", async () => {
    // All CAP candidates "resolving" (a fix in flight, non-terminal, NOT in
    // QUOTA_FREEING_RESOLUTIONS) — filing must still be refused. Isolates
    // that the seam is not vacuously permissive.
    const stillBlocking: CandidateSpec[] = Array.from({ length: CAP }, (_, i) => ({
      id: `01RESOLVING${i}`,
      resolution: "resolving",
    }));
    const result = await makeServiceWithCap(makeFakeUpstreamForCap(stillBlocking), CAP).report(BASE_INPUT, BASE_CFG);
    expect(result.ok).toBe(false);
  });
});

describe("AC-DC-15: adopted-pointer-required — the owner pointer is required and must resolve to a live plan or task", () => {
  const ISSUE_DOC_ID = "01ISSUEDOC0000000000000000";

  it("adopted-pointer-required HAPPY: a pointer resolving to a live plan or task is accepted", () => {
    expect(
      checkResolutionPointer(ADOPTED_RESOLUTION_POINTER, "plan-x", { id: "01PLANX", type: "plan" }, ISSUE_DOC_ID),
    ).toEqual({ ok: true });
    expect(
      checkResolutionPointer(ADOPTED_RESOLUTION_POINTER, "task-x", { id: "01TASKX", type: "task" }, ISSUE_DOC_ID),
    ).toEqual({ ok: true });
  });

  it("adopted-pointer-required NEGATIVE (a): an ABSENT --adopted-by is refused as missing", () => {
    expect(checkResolutionPointer(ADOPTED_RESOLUTION_POINTER, "", undefined, ISSUE_DOC_ID)).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("adopted-pointer-required NEGATIVE (b): a --adopted-by that does not resolve to an existing doc is refused as unresolvable", () => {
    expect(checkResolutionPointer(ADOPTED_RESOLUTION_POINTER, "no-such-doc", undefined, ISSUE_DOC_ID)).toEqual({
      ok: false,
      reason: "unresolvable",
    });
  });

  it("adopted-pointer-required NEGATIVE (c): a --adopted-by resolving to a doc whose type is neither plan nor task is refused as wrong-type", () => {
    for (const type of ["spec", "adr", "knowledge", "prd"]) {
      expect(
        checkResolutionPointer(ADOPTED_RESOLUTION_POINTER, "some-doc", { id: "01SOMEDOC", type }, ISSUE_DOC_ID),
        `type "${type}" must be refused as wrong-type`,
      ).toEqual({ ok: false, reason: "wrong-type" });
    }
  });

  it("adopted-pointer-required BOUNDARY: a --adopted-by naming the report ITSELF is refused as self-reference, even though the type would otherwise be allowed", () => {
    expect(
      checkResolutionPointer(
        ADOPTED_RESOLUTION_POINTER,
        ISSUE_DOC_ID,
        { id: ISSUE_DOC_ID, type: "task" },
        ISSUE_DOC_ID,
      ),
    ).toEqual({ ok: false, reason: "self-reference" });
  });

  it("adopted-pointer-required STATE: refusal precedence is fixed — missing beats every other reason, unresolvable beats self-reference/wrong-type", () => {
    // An empty pointerValue is refused as "missing" regardless of what
    // resolvedTarget claims — a caller cannot skip the argv-level check by
    // fabricating a resolved doc.
    expect(
      checkResolutionPointer(ADOPTED_RESOLUTION_POINTER, "", { id: ISSUE_DOC_ID, type: "task" }, ISSUE_DOC_ID),
    ).toEqual({ ok: false, reason: "missing" });
  });

  it("adopted-pointer-required REGRESSION: superseded/duplicate pointers (§M3, no type constraint) still accept any doc type — M7's wrong-type check does not leak onto them", () => {
    const supersededByPointer = { flag: "--superseded-by", extra_key: "superseded_by", names: "the doc that supersedes this report" };
    for (const type of ["spec", "adr", "knowledge", "prd", "plan", "task"]) {
      expect(
        checkResolutionPointer(supersededByPointer, "some-doc", { id: "01SOMEDOC", type }, ISSUE_DOC_ID),
        `M3 pointer must accept type "${type}"`,
      ).toEqual({ ok: true });
    }
  });
});

describe("AC-DC-16: adopted-abandonment-count — a dangling adopted claim is counted, and the count names its members", () => {
  it("adopted-abandonment-count RED SEED (a): adopted + archived owner + no terminal resolution MUST be counted", () => {
    expect(isDanglingAdoption({ computedResolution: "adopted", ownerStatus: "archived" })).toBe(true);
    expect(isDanglingAdoption({ computedResolution: "adopted", ownerStatus: "deprecated" })).toBe(true);
  });

  it("adopted-abandonment-count RED SEED (b): adopted + LIVE owner must NOT be counted — stops degeneration into 'every adopted report'", () => {
    const liveStatuses: DocStatus[] = ["draft", "in-review", "approved", "active"];
    for (const ownerStatus of liveStatuses) {
      expect(
        isDanglingAdoption({ computedResolution: "adopted", ownerStatus }),
        `owner status "${ownerStatus}" must NOT be counted as abandoned`,
      ).toBe(false);
    }
  });

  it("adopted-abandonment-count RED SEED (c): adopted stored state whose COMPUTED resolution is no longer adopted (a resolves edge landed) must NOT be counted, even with an archived owner", () => {
    // The report's stored extra still literally says "adopted" (nobody
    // re-resolved it), but computeIssueResolution has already promoted it to
    // "fixed" because a resolves edge to an archived fixer doc landed —
    // isDanglingAdoption is fed the COMPUTED value, never the raw stored one.
    const computedAfterRealFix = computeIssueResolution(
      { extra: { issue_report: { resolution: { state: "adopted", adopted_by: "01OWNERPLAN" } } } },
      [{ from_id: "01FIXERSPEC" }],
      [{ id: "01FIXERSPEC", status: "archived" }],
    );
    expect(computedAfterRealFix).toBe("fixed");
    expect(isDanglingAdoption({ computedResolution: computedAfterRealFix, ownerStatus: "archived" })).toBe(false);
  });

  it("adopted-abandonment-count NEGATIVE: an owner that no longer resolves (deleted) is excluded, not counted as abandoned", () => {
    expect(isDanglingAdoption({ computedResolution: "adopted", ownerStatus: undefined })).toBe(false);
  });

  it("adopted-abandonment-count BOUNDARY: sweeps every DocStatus for the owner — only archived/deprecated count, every other status (including one this predicate has never seen) excludes", () => {
    const allStatuses: DocStatus[] = ["draft", "in-review", "approved", "active", "archived", "deprecated"];
    for (const ownerStatus of allStatuses) {
      const expected = ownerStatus === "archived" || ownerStatus === "deprecated";
      expect(isDanglingAdoption({ computedResolution: "adopted", ownerStatus }), `status "${ownerStatus}"`).toBe(
        expected,
      );
    }
  });

  it("adopted-abandonment-count REGRESSION: a non-adopted computed resolution is never counted, regardless of owner status — the predicate is gated on conjunct 1 first", () => {
    for (const resolution of ISSUE_RESOLUTION_MEMBERS) {
      if (resolution === "adopted") continue;
      expect(
        isDanglingAdoption({ computedResolution: resolution, ownerStatus: "archived" }),
        `resolution "${resolution}" with an archived owner must not be counted`,
      ).toBe(false);
    }
  });
});
