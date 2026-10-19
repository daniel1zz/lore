// @layer service-issue-resolution AC-ICL-10
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
 *   AC-ICL-11 (this file, since TG-11B: its cross-corpus oracle left with the
 *   SQLite transport in 8b3845b1 and the criterion was corrected to the
 *   pure-function layer); the cases below assert the precedence at that
 *   layer, each precedence step independently rather than inferred from one
 *   combined fixture.
 *
 * @spec_ref spec-issue-closure-loop-computed-resolution-agent-reachable AC-ICL-1, AC-ICL-2, AC-ICL-10, AC-ICL-11
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import {
  computeIssueResolution,
  isDanglingAdoption,
  type ResolutionSourceDocLike,
  type ResolvesInEdgeLike,
} from "../../../src/service/issue-resolution.js";
import {
  linkTypeSchema,
  ISSUE_RESOLUTION_MEMBERS,
  type CreateDocInput,
  type DocRecord,
  type DocStatus,
} from "@lore/core";
import { actedStore } from "../../live-invocation.js";

// ─── Test helpers ───────────────────────────────────────────────────────────

function makeService() {
  const store = actedStore(new InMemoryStore());
  return { service: new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined))), store };
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
    content: "# Overview/Goal\nfix\n## Scope\nn/a\n## Acceptance Criteria\nn/a",
  } as CreateDocInput);
}

/** An ad-hoc task with NO extra.issue_report — a valid task. */
async function createPlainTask(cs: CorpusService, title = "Ordinary task"): Promise<DocRecord> {
  return mustCreate(cs, {
    type: "task",
    title,
    content: `# ${title}`,
    extra: { adhoc: true },
  } as CreateDocInput);
}

// ─── AC-ICL-1 (retired): the `resolves` link type is refused ────────────────
// reason: spec-github-owns-issue-report-state-no-mirror-task-work-carries D1 retired `resolves` (the carrier is
// extra.issues). The former AC-ICL-1 HAPPY/NEGATIVE/BOUNDARY/ERROR/STATE cases asserted the write-time target
// check that no longer exists; the one surviving contract is that no `resolves` edge can be created at all
// (full refusal matrix: tests/unit/service/issue-carrier-schema.test.ts).

describe("AC-ICL-1 (retired by the carrier schema): resolves link type", () => {
  it("AC-ICL-1 NEGATIVE: linkTypeSchema no longer lists 'resolves'; CorpusService.link refuses it whatever the target", async () => {
    expect(linkTypeSchema.safeParse("resolves").success).toBe(false);

    const { service, store } = makeService();
    const rootPrd = await createRootPrd(service);
    const fixingSpec = await createFixingSpec(service, rootPrd.id);
    const plainTask = await createPlainTask(service);

    for (const target of [plainTask.id, rootPrd.id]) {
      const linkResult = await service.link(fixingSpec.id, target, "resolves");
      expect(linkResult.ok).toBe(false);
      if (linkResult.ok) return;
      expect(linkResult.error.code).toBe("VALIDATION_ERROR");
    }
    const findResult = await store.findLinks(fixingSpec.id, "out");
    expect(findResult.ok && findResult.value.length).toBe(0);
  });

  it("AC-ICL-1 REGRESSION: non-resolves link types are unaffected", async () => {
    const { service } = makeService();
    const rootPrd = await createRootPrd(service);
    const fixingSpec = await createFixingSpec(service, rootPrd.id);

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

describe("AC-ICL-11 (P2): computeIssueResolution — recorded review rejection (hasRecordedReviewRejection)", () => {
  it("AC-ICL-11 NEGATIVE: a rejected state carrying a recorded reason is never computed 'open' (no self-contradicting row)", () => {
    const withReason = { extra: { issue_report: { resolution: { state: "rejected", reason: "not reproducible" } } } };
    expect(computeIssueResolution(withReason, [], [])).toBe("rejected");
    expect(computeIssueResolution(withReason, [], [], true)).toBe("rejected");
    expect(computeIssueResolution(withReason, [], [])).not.toBe("open");
  });

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

// ─── §M7: `adopted` — a non-terminal exit that REQUIRES an owner            ──
// ─── (spec-the-defect-channel-cannot-be-honestly-maintained-an §M7,        ──
// ─── AC-DC-15, AC-DC-16)                                                   ──
//
// ⛔ The cap-narrowing behavioural cases that used to live here (AC-DC-14 —
// "adoption frees open-report cap quota") are RETIRED: spec-the-defect-
// channel-reaches-no-machine-but-its-own-github P1 deletes the open-report
// rate cap outright, along with its six named implementation symbols
// (enumerated in that spec's Scope section, deliberately not repeated here as
// literal identifiers — AC-GI-9's oracle is a case-sensitive scan for exactly
// those six strings across `packages/**`, this file included). There is no
// quota left for `adopted` to free. `isDanglingAdoption` below is a pure
// function unrelated to the cap and is unaffected.

// ⛔ AC-DC-15 (the owner pointer of `adopted` must resolve to a live plan or task) is RETIRED with its subject:
// the pointer check and `lore issue resolve --state adopted --adopted-by` were deleted by
// spec-github-owns-issue-report-state-no-mirror-task-work-carries (GS-T6). Ownership is now a carrier task
// (`lore issue adopt`, AC-GS-7); the `adopted` display status is derived, never written.

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
