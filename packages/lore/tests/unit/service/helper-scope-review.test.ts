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

async function review(trail: SessionTrail, byAgent: Claims) {
  const r = await reviewHelperScope({ trail, claimedTasks: claims(byAgent), projectRoot: "/proj", realpath: (p) => p });
  if (!r.ok) throw new Error("review failed");
  return r.value;
}

const FILES = ["src/a.ts", "src/b.ts", "tests/a.test.ts"];
const PARENT_CLAIM: Claims = { parent: [{ slug: "task-x", anchors: ["src/", "tests/"] }] };

describe("AC-ST-8 nested helper in a claiming run's working copy", () => {
  it("AC-ST-8 yields no finding for the parent's files on a harness-internal zero-duration helper", async () => {
    const out = await review(trailOf([helper("parent", { files: FILES }), helper("inner", { files: FILES })]), PARENT_CLAIM);
    expect(out.findings).toEqual([]);
  });

  it("AC-ST-8 still judges the claiming run itself: files outside its anchors are one outside-anchors finding", async () => {
    const files = [...FILES, "docs/x.md"];
    const out = await review(trailOf([helper("parent", { files }), helper("inner", { files })]), PARENT_CLAIM);
    expect(out.findings.map((f) => [f.kind, f.helper, f.files])).toEqual([["outside-anchors", "parent", ["docs/x.md"]]]);
  });

  it("AC-ST-8 a shared working copy where nobody claimed a task yields ONE no-claimed-task finding, not one per helper", async () => {
    const out = await review(trailOf([helper("one", { files: FILES }), helper("two", { files: FILES })]), {});
    expect(out.findings.map((f) => [f.kind, f.helper])).toEqual([["no-claimed-task", "one"]]);
  });

  it("AC-ST-8 judges the nested helper when the claiming run's end was already judged", async () => {
    const out = await review(trailOf([helper("parent", { files: FILES, judged: 1 }), helper("inner", { files: FILES })]), PARENT_CLAIM);
    expect(out.findings).toEqual([]);
    expect(out.helpers.map((h) => h.agent_id)).toEqual(["inner"]);
  });

  it("AC-ST-8 control: a nested helper's OWN edit outside the group's anchors is still outside-anchors", async () => {
    const trail = trailOf([helper("parent", { files: FILES }), helper("inner", { files: FILES })], [{ agent: "inner", file: "/wt/agent-parent/docs/own.md" }]);
    const out = await review(trail, PARENT_CLAIM);
    expect(out.findings.map((f) => [f.kind, f.helper, f.files])).toEqual([["outside-anchors", "inner", ["docs/own.md"]]]);
  });

  it("AC-ST-8 control: helpers in different working copies stay independent", async () => {
    const trail = trailOf([helper("parent", { files: FILES }), helper("other", { files: FILES, workingCopy: "/wt/agent-other" })]);
    const out = await review(trail, PARENT_CLAIM);
    expect(out.findings.map((f) => [f.kind, f.helper])).toEqual([["no-claimed-task", "other"]]);
  });
});

describe("AC-ST-8 session scratchpad", () => {
  const scratch = `/private/tmp/claude-501/-Users-x-proj/${SESSION}/scratchpad`;

  it("AC-ST-8 a write into this session's scratchpad is not outside-working-copy", async () => {
    const trail = trailOf([helper("parent", { files: [] })], [{ agent: "parent", file: `${scratch}/notes.txt` }]);
    const out = await review(trail, PARENT_CLAIM);
    expect(out.findings).toEqual([]);
  });

  it("AC-ST-8 control: another session's scratchpad, a plain /tmp path and a lookalike dir are still outside-working-copy", async () => {
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
    expect(out.findings.map((f) => [f.kind, f.files])).toEqual([["outside-working-copy", [other, "/tmp/elsewhere.txt", `${scratch}-not/b.txt`]]]);
  });
});
