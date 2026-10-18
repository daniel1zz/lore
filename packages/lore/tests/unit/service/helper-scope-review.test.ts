/**
 * AU-T19: helper-scope review charges a helper only with what it owns (spec session-trail AC-ST-8).
 *
 * Fixture trails are built by hand (pure unit: ports injected, no spawn). The shape of the RED case is the
 * measured one from session c1ffea04: a claiming implementer and a harness-internal zero-duration helper
 * share one working copy and one base, so both records carry the SAME measured diff.
 *
 * Coverage: REGRESSION (nested helper charged with the parent's files) / HAPPY (parent still judged) /
 * NEGATIVE (outside-anchors, outside-working-copy, no-claimed-task controls) / BOUNDARY (separate working
 * copies, another session's scratchpad) / STATE (judged parent, unjudged nested helper).
 */
import { ok } from "@lore/core";
import type { SessionTrail, TrailHelper } from "@lore/core/node";
import { describe, expect, it } from "vitest";
import { reviewHelperScope } from "../../../src/service/helper-scope-review.js";
import type { RunClaimedTask } from "../../../src/service/run-service.js";

const SESSION = "s-t19";
const WC = "/wt/agent-parent";
const BASE = "b".repeat(40);

type Claims = Record<string, Array<{ slug: string; anchors: string[] }>>;

function helper(agent: string, over: { files?: string[]; workingCopy?: string; judged?: number } = {}): TrailHelper {
  const run = `cc:${SESSION}:${agent}`;
  return {
    agent_id: agent,
    run,
    started_at: "2026-10-18T13:54:06.647Z",
    ended_at: "2026-10-18T13:54:06.647Z",
    end_count: 1,
    judged_end_count: over.judged ?? 0,
    working_copy: over.workingCopy ?? WC,
    isolated: true,
    changes: {
      measured: true,
      value: { base: BASE, files: (over.files ?? []).map((path) => ({ path, status: "M" as const, lines: 1, source: { kind: "run" as const, run } })) },
    },
  } as TrailHelper;
}

function trailOf(helpers: TrailHelper[], edits: Array<{ agent: string; file: string }> = []): SessionTrail {
  return {
    session: SESSION,
    started_at: null,
    removed: null,
    helpers,
    turns: [
      {
        turn: "turn-1",
        opened_at: null,
        edits: { measured: true, value: edits.map((e) => ({ file: e.file, run: `cc:${SESSION}:${e.agent}`, ts: 1 })) },
        at: null,
        shared_working_copy: null,
        changes: { measured: false, reason: "n/a" },
      },
    ],
  } as unknown as SessionTrail;
}

const claims = (byAgent: Claims) => async (run: string) =>
  ok((byAgent[run.split(":").pop() ?? ""] ?? []).map((t) => ({ slug: t.slug, file_anchors: t.anchors }) as unknown as RunClaimedTask));

/** Open claims by the working copy their recorded worktree names (what `RunService.openClaimsOfWorkingCopy` reads). */
type OpenClaims = Record<string, Array<{ slug: string; anchors: string[] }>>;

const openClaimsOf = (byCopy: OpenClaims, notMeasured: string[] = []) => async (workingCopy: string) =>
  ok({
    tasks: (byCopy[workingCopy] ?? []).map((t) => ({ slug: t.slug, file_anchors: t.anchors }) as unknown as RunClaimedTask),
    not_measured: notMeasured,
  });

async function review(trail: SessionTrail, byAgent: Claims, byCopy: OpenClaims = {}) {
  const r = await reviewHelperScope({
    trail,
    claimedTasks: claims(byAgent),
    openClaimsOfWorkingCopy: openClaimsOf(byCopy),
    projectRoot: "/proj",
    realpath: (p) => p,
  });
  if (!r.ok) throw new Error("review failed");
  return r.value;
}

const FILES = ["src/a.ts", "src/b.ts", "tests/a.test.ts"];
const PARENT_CLAIM: Claims = { parent: [{ slug: "task-x", anchors: ["src/", "tests/"] }] };

describe("AU-T19 nested helper in a claiming run's working copy", () => {
  it("AU-T19 yields no finding for the parent's files on a harness-internal zero-duration helper", async () => {
    const out = await review(trailOf([helper("parent", { files: FILES }), helper("inner", { files: FILES })]), PARENT_CLAIM);
    expect(out.findings).toEqual([]);
  });

  it("AU-T19 still judges the claiming run itself: files outside its anchors are one outside-anchors finding", async () => {
    const files = [...FILES, "docs/x.md"];
    const out = await review(trailOf([helper("parent", { files }), helper("inner", { files })]), PARENT_CLAIM);
    expect(out.findings.map((f) => [f.kind, f.helper, f.files])).toEqual([["outside-anchors", "parent", ["docs/x.md"]]]);
  });

  it("AU-T19 a shared working copy where nobody claimed a task yields ONE no-claimed-task finding, not one per helper", async () => {
    const out = await review(trailOf([helper("one", { files: FILES }), helper("two", { files: FILES })]), {});
    expect(out.findings.map((f) => [f.kind, f.helper])).toEqual([["no-claimed-task", "one"]]);
  });

  it("AU-T19 judges the nested helper when the claiming run's end was already judged", async () => {
    const out = await review(trailOf([helper("parent", { files: FILES, judged: 1 }), helper("inner", { files: FILES })]), PARENT_CLAIM);
    expect(out.findings).toEqual([]);
    expect(out.helpers.map((h) => h.agent_id)).toEqual(["inner"]);
  });

  it("AU-T19 control: a nested helper's OWN edit outside the group's anchors is still outside-anchors", async () => {
    const trail = trailOf([helper("parent", { files: FILES }), helper("inner", { files: FILES })], [{ agent: "inner", file: "/wt/agent-parent/docs/own.md" }]);
    const out = await review(trail, PARENT_CLAIM);
    expect(out.findings.map((f) => [f.kind, f.helper, f.files])).toEqual([["outside-anchors", "inner", ["docs/own.md"]]]);
  });

  it("AU-T19 control: helpers in different working copies stay independent", async () => {
    const trail = trailOf([helper("parent", { files: FILES }), helper("other", { files: FILES, workingCopy: "/wt/agent-other" })]);
    const out = await review(trail, PARENT_CLAIM);
    expect(out.findings.map((f) => [f.kind, f.helper])).toEqual([["no-claimed-task", "other"]]);
  });
});

describe("AU-T19 session scratchpad", () => {
  const scratch = `/private/tmp/claude-501/-Users-x-proj/${SESSION}/scratchpad`;

  it("AU-T19 a write into this session's scratchpad is not outside-working-copy", async () => {
    const trail = trailOf([helper("parent", { files: [] })], [{ agent: "parent", file: `${scratch}/notes.txt` }]);
    const out = await review(trail, PARENT_CLAIM);
    expect(out.findings).toEqual([]);
  });

  it("AU-T19 control: another session's scratchpad, a plain /tmp path and a lookalike dir are still outside-working-copy", async () => {
    const other = "/private/tmp/claude-501/-Users-x-proj/other-session/scratchpad/a.txt";
    const trail = trailOf(
      [helper("parent", { files: [] })],
      [
        { agent: "parent", file: other },
        { agent: "parent", file: "/tmp/elsewhere.txt" },
        { agent: "parent", file: `${scratch}-not/b.txt` },
      ],
    );
    const out = await review(trail, PARENT_CLAIM);
    expect(out.findings.map((f) => [f.kind, f.files])).toEqual([["outside-working-copy", [other, `${scratch}-not/b.txt`, "/tmp/elsewhere.txt"]]]);
  });
});

describe("AU-T22 open claim whose recorded worktree is the group's working copy", () => {
  const OPEN: OpenClaims = { [WC]: [{ slug: "task-open", anchors: ["src/", "tests/"] }] };

  it("AU-T22 a zero-duration helper in a working copy named by an open claim (no end record for the claiming run) yields no finding", async () => {
    const out = await review(trailOf([helper("inner", { files: FILES })]), {}, OPEN);
    expect(out.findings).toEqual([]);
  });

  it("AU-T22 control: a helper in a working copy no open claim names is still no-claimed-task", async () => {
    const out = await review(trailOf([helper("inner", { files: FILES })]), {}, { "/wt/agent-other": OPEN[WC] ?? [] });
    expect(out.findings.map((f) => [f.kind, f.helper])).toEqual([["no-claimed-task", "inner"]]);
  });

  it("AU-T23 a not-measured claim resolution from the open-claim port surfaces in not_measured", async () => {
    const r = await reviewHelperScope({
      trail: trailOf([helper("inner", { files: FILES })]),
      claimedTasks: claims({}),
      openClaimsOfWorkingCopy: openClaimsOf({}, ["open claim of task-x: worktree b not resolved (git failed)"]),
      projectRoot: "/proj",
      realpath: (p) => p,
    });
    if (!r.ok) throw new Error("review failed");
    expect(r.value.not_measured).toEqual(["open claim of task-x: worktree b not resolved (git failed)"]);
  });

  it("AU-T22 the open claim's anchors still bound the helper: a file outside them is outside-anchors", async () => {
    const out = await review(trailOf([helper("inner", { files: [...FILES, "docs/x.md"] })]), {}, OPEN);
    expect(out.findings.map((f) => [f.kind, f.files])).toEqual([["outside-anchors", ["docs/x.md"]]]);
  });
});

describe("AU-T25 an edit already covered by a judged end is not charged again", () => {
  const OUTSIDE_OLD = "/private/tmp/claude-501/-Users-apple/Projects/zz/lore/placeholder";
  const OUTSIDE_NEW = "/tmp/second-probe.txt";
  const CLAIM_A1: Claims = { A1: [{ slug: "task-y", anchors: ["src/"] }] };

  /** A helper on its 2nd end whose end 1 was judged at `judgedAt`; edits at the given timestamps. */
  function twiceEnded(judgedAt: number | undefined, edits: Array<{ file: string; ts: number }>): SessionTrail {
    const h = { ...helper("A1", { files: [], judged: 1 }), end_count: 2, ...(judgedAt === undefined ? {} : { judged_at_ms: judgedAt }) } as TrailHelper;
    const trail = trailOf([h]);
    return {
      ...trail,
      turns: [{ ...trail.turns[0], edits: { measured: true, value: edits.map((e) => ({ file: e.file, run: h.run, ts: e.ts })) } }],
    } as unknown as SessionTrail;
  }

  it("AU-T25 an outside edit recorded at or before the helper's judged_at_ms yields no finding on its next end", async () => {
    const out = await review(twiceEnded(1000, [{ file: OUTSIDE_OLD, ts: 900 }]), CLAIM_A1);
    expect(out.findings).toEqual([]);
  });

  it("AU-T25 control: an outside edit recorded after judged_at_ms is still outside-working-copy", async () => {
    const out = await review(twiceEnded(1000, [{ file: OUTSIDE_OLD, ts: 900 }, { file: OUTSIDE_NEW, ts: 1001 }]), CLAIM_A1);
    expect(out.findings.map((f) => [f.kind, f.files])).toEqual([["outside-working-copy", [OUTSIDE_NEW]]]);
  });

  it("AU-T25 control: a judged file without judged_at_ms (legacy) keeps the old behaviour and judges every edit", async () => {
    const out = await review(twiceEnded(undefined, [{ file: OUTSIDE_OLD, ts: 900 }]), CLAIM_A1);
    expect(out.findings.map((f) => f.kind)).toEqual(["outside-working-copy"]);
  });
});
