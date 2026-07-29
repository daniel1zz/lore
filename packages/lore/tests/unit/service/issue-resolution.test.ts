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

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import {
  computeIssueResolution,
  hasIssueReport,
  type ResolutionSourceDocLike,
  type ResolvesInEdgeLike,
} from "../../../src/service/issue-resolution.js";
import { linkTypeSchema, type CreateDocInput, type DocRecord, type DocStatus } from "@lore/core";

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
