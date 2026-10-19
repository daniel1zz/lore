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
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { reviewHelperScope, spawnGitCheckIgnore, spawnGitCheckIgnoreAtRoot, spawnGitLanding, type IgnoreProbeFn } from "../../../src/service/helper-scope-review.js";
import type { RunClaimedTask } from "../../../src/service/run-service.js";

const SESSION = "s-t19";
const WC = "/wt/agent-parent";
const BASE = "b".repeat(40);

type Claims = Record<string, Array<{ slug: string; anchors: string[] }>>;

function helper(agent: string, over: { files?: string[]; workingCopy?: string; judged?: number; base?: string } = {}): TrailHelper {
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
      value: { base: over.base ?? BASE, files: (over.files ?? []).map((path) => ({ path, status: "M" as const, lines: 1, source: { kind: "run" as const, run } })) },
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

describe("AU-T27 a file a co_change rule requires is covered by the anchor that triggered the rule", () => {
  const MANIFEST = "packages/lore/src/generated/assets-manifest.ts";
  const RULES = [{ name: "assets-manifest", when: ["assets/**"], require: [MANIFEST] }];
  const matches = (pattern: string, path: string): boolean => (pattern.endsWith("/**") ? path.startsWith(pattern.slice(0, -2)) : pattern === path);
  const reviewWith = async (files: string[], anchors: string[]) => {
    const r = await reviewHelperScope({
      trail: trailOf([helper("parent", { files })]),
      claimedTasks: claims({ parent: [{ slug: "task-x", anchors }] }),
      openClaimsOfWorkingCopy: openClaimsOf({}),
      projectRoot: "/proj",
      realpath: (p) => p,
      coChange: { rules: RULES, matches },
    });
    if (!r.ok) throw new Error("review failed");
    return r.value;
  };

  it("AU-T27 anchored assets/x.md + changed manifest yields no outside-anchors finding", async () => {
    const out = await reviewWith(["assets/x.md", MANIFEST], ["assets/x.md"]);
    expect(out.findings).toEqual([]);
  });

  it("AU-T27 control: manifest changed with no anchored file matching a when glob is still outside-anchors", async () => {
    const out = await reviewWith(["src/a.ts", MANIFEST], ["src/a.ts"]);
    expect(out.findings.map((f) => [f.kind, f.files])).toEqual([["outside-anchors", [MANIFEST]]]);
  });

  it("AU-T27 control: an assets file that is itself outside the anchors does not unlock the manifest", async () => {
    const out = await reviewWith(["assets/y.md", MANIFEST], ["src/a.ts"]);
    expect(out.findings.map((f) => [f.kind, f.files])).toEqual([["outside-anchors", ["assets/y.md", MANIFEST]]]);
  });
});

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

describe("gitignored paths are not judged against anchors (task-skill-fix-turn-end-helper-review-judges-only-repository)", () => {
  const repo = mkdtempSync(join(tmpdir(), "hsr-ignore-"));
  const git = (...args: string[]) => {
    const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  };
  mkdirSync(join(repo, "src"), { recursive: true });
  mkdirSync(join(repo, "other"), { recursive: true });
  writeFileSync(join(repo, ".gitignore"), ".scratch/\n");
  writeFileSync(join(repo, "other/tracked.ts"), "x\n");
  git("init", "-q");
  git("add", ".gitignore", "other/tracked.ts");
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  const claim: Claims = { parent: [{ slug: "task-x", anchors: ["src/"] }] };
  const run = (files: string[], ignoreProbe: IgnoreProbeFn | undefined) =>
    reviewHelperScope({
      trail: trailOf([helper("parent", { files, workingCopy: repo })]),
      claimedTasks: claims(claim),
      openClaimsOfWorkingCopy: openClaimsOf({}),
      projectRoot: repo,
      realpath: (p) => p,
      ...(ignoreProbe === undefined ? {} : { ignoreProbe }),
    }).then((r) => {
      if (!r.ok) throw new Error("review failed");
      return r.value;
    });

  it("AC-1 an edit under an ignored dir is not a finding", async () => {
    const out = await run([".scratch/tmp.json", "src/a.ts"], spawnGitCheckIgnore);
    expect(out.findings).toEqual([]);
    expect(out.not_measured).toEqual([]);
  });

  it("AC-2 a tracked or untracked-unignored path outside the anchors is still a finding, with the exact wording", async () => {
    const out = await run([".scratch/tmp.json", "other/tracked.ts", "other/new.ts"], spawnGitCheckIgnore);
    expect(out.findings.map((f) => [f.kind, f.files])).toEqual([["outside-anchors", ["other/new.ts", "other/tracked.ts"]]]);
    expect(out.findings[0]?.message).toBe(
      `Helper parent (cc:${SESSION}:parent) changed files outside the anchors of its task task-x: other/new.ts, other/tracked.ts`,
    );
  });

  it("AC-3 a failing ignore probe is reported as not measured naming the path, and the path stays judged", async () => {
    const out = await run([".scratch/tmp.json"], () => ({ status: 128, stdout: "" }));
    expect(out.not_measured.join("\n")).toContain(".scratch/tmp.json");
    expect(out.findings.map((f) => f.kind)).toEqual(["outside-anchors"]);
  });

  it("AC-3 a status-0 run with empty stdout (cannot account for every path) is not measured, never ignored", async () => {
    const out = await run([".scratch/tmp.json"], () => ({ status: 0, stdout: "" }));
    expect(out.not_measured.join("\n")).toContain(".scratch/tmp.json");
    expect(out.findings.map((f) => f.kind)).toEqual(["outside-anchors"]);
  });

  it("AC-3 a probe that throws is not measured", async () => {
    const out = await run([".scratch/tmp.json"], () => {
      throw new Error("spawn git ENOENT");
    });
    expect(out.not_measured.join("\n")).toContain(".scratch/tmp.json");
  });
});

describe("SendMessage-resumed helper: a second run of one working copy on a newer base", () => {
  // Measured 2026-10-19 (session c1ffea04): a9e0ca47 (base 7e52699) claimed+released a task; its SendMessage resume
  // was recorded as a9c10a59 in the SAME working copy on base ce70361, so the base-keyed group split them.
  const NEW_BASE = "c".repeat(40);
  const trail = () => trailOf([helper("original", { files: FILES, judged: 1 }), helper("resumed", { files: FILES, base: NEW_BASE })]);

  it("SENDMSG-1 a resumed run of a copy whose original run held the claim yields no finding", async () => {
    const out = await review(trail(), { original: [{ slug: "task-x", anchors: ["src/", "tests/"] }] });
    expect(out.findings).toEqual([]);
  });

  it("SENDMSG-2 the same trail with no claim in that working copy still reports claimed no task", async () => {
    const out = await review(trail(), {});
    expect(out.findings.map((f) => [f.kind, f.helper])).toEqual([["no-claimed-task", "resumed"]]);
  });

  it("SENDMSG-3 control: a claim held in ANOTHER working copy does not cover the resumed run", async () => {
    const other = helper("elsewhere", { files: [], workingCopy: "/wt/agent-other" });
    const out = await review(trailOf([other, helper("resumed", { files: FILES, base: NEW_BASE })]), { elsewhere: [{ slug: "task-x", anchors: ["src/", "tests/"] }] });
    expect(out.findings.map((f) => f.kind)).toEqual(["no-claimed-task"]);
  });

  it("SENDMSG-4 the claim's anchors still bind: a resumed-run file outside them is outside-anchors", async () => {
    const out = await review(trailOf([helper("original", { files: [], judged: 1 }), helper("resumed", { files: [...FILES, "docs/x.md"], base: NEW_BASE })]), {
      original: [{ slug: "task-x", anchors: ["src/", "tests/"] }],
    });
    expect(out.findings.map((f) => [f.kind, f.files])).toEqual([["outside-anchors", ["docs/x.md"]]]);
  });
});

describe("a helper whose working copy was removed after landing (task-skill-fix-turn-end-helper-review-handles-a-helper-whose)", () => {
  const repo = mkdtempSync(join(tmpdir(), "hsr-removed-"));
  const sh = (...args: string[]) => {
    const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  };
  const MERGED = "worktree-agent-merged1";
  const UNMERGED = "worktree-agent-unmerged1";
  mkdirSync(join(repo, "src"), { recursive: true });
  mkdirSync(join(repo, "other"), { recursive: true });
  writeFileSync(join(repo, ".gitignore"), ".scratch/\n");
  writeFileSync(join(repo, "other/tracked.ts"), "x\n");
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "t@example.com");
  sh("config", "user.name", "t");
  sh("add", ".");
  sh("commit", "-q", "-m", "base");
  sh("checkout", "-q", "-b", MERGED);
  writeFileSync(join(repo, "src/a.ts"), "a\n");
  sh("add", ".");
  sh("commit", "-q", "-m", "work");
  sh("checkout", "-q", "main");
  sh("merge", "-q", "--no-ff", MERGED, "-m", `merge(${MERGED})`);
  sh("branch", "-d", MERGED);
  sh("checkout", "-q", "-b", UNMERGED);
  writeFileSync(join(repo, "src/b.ts"), "b\n");
  sh("add", ".");
  sh("commit", "-q", "-m", "unlanded");
  sh("checkout", "-q", "main");
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  const claim: Claims = { parent: [{ slug: "task-x", anchors: ["src/"] }] };
  const run = (agentDir: string, files: string[]) =>
    reviewHelperScope({
      trail: trailOf([helper("parent", { files, workingCopy: join(repo, "..", agentDir) })]),
      claimedTasks: claims(claim),
      openClaimsOfWorkingCopy: openClaimsOf({}),
      projectRoot: repo,
      realpath: (p) => {
        if (/\/agent-[a-z0-9]+(\/|$)/.test(p)) throw new Error("ENOENT");
        return p;
      },
      ignoreProbe: spawnGitCheckIgnore,
      ignoreProbeAtRoot: spawnGitCheckIgnoreAtRoot(repo),
      landing: spawnGitLanding(repo),
    }).then((r) => {
      if (!r.ok) throw new Error("review failed");
      return r.value;
    });

  it("AC-1 removed copy, branch merged: an ignored .scratch edit is no finding, a tracked out-of-anchor edit still is", async () => {
    const out = await run("agent-merged1", [".scratch/patch.py", "src/a.ts", "other/tracked.ts"]);
    expect(out.not_measured).toEqual([]);
    expect(out.findings.map((f) => [f.kind, f.files])).toEqual([["outside-anchors", ["other/tracked.ts"]]]);
    expect(out.notes.join("\n")).toContain("after landing");
  });

  it("AC-1 control: a tracked path matching an ignore rule is still judged (never treated as ignored)", async () => {
    writeFileSync(join(repo, ".gitignore"), ".scratch/\nother/\n");
    try {
      const out = await run("agent-merged1", ["other/tracked.ts"]);
      expect(out.findings.map((f) => f.files)).toEqual([["other/tracked.ts"]]);
    } finally {
      writeFileSync(join(repo, ".gitignore"), ".scratch/\n");
    }
  });

  it("AC-2 removed copy, branch unmerged: ONE not-measured line per helper naming \"working copy removed\", paths stay judged", async () => {
    const out = await run("agent-unmerged1", [".scratch/patch.py", "other/x.ts"]);
    expect(out.not_measured).toHaveLength(1);
    expect(out.not_measured[0]).toContain("working copy removed");
    expect(out.not_measured[0]).not.toContain("undefined");
    expect(out.findings.map((f) => f.files)).toEqual([[".scratch/patch.py", "other/x.ts"]]);
  });

  it("AC-2 a removed copy with no branch at all cannot show landing: not measured, never assumed landed", async () => {
    const out = await run("agent-neverexisted", [".scratch/patch.py"]);
    expect(out.not_measured).toHaveLength(1);
    expect(out.not_measured[0]).toContain("working copy removed");
    expect(out.findings.map((f) => f.kind)).toEqual(["outside-anchors"]);
  });

  it("AC-3 a spawn error's message appears verbatim, never undefined (missing cwd)", async () => {
    const gone = join(repo, "..", "hsr-no-such-dir-xyz");
    const probed = spawnGitCheckIgnore(gone, ["a.ts"]);
    expect(probed.error).toContain("ENOENT");
    const out = await reviewHelperScope({
      trail: trailOf([helper("parent", { files: ["a.ts"], workingCopy: gone })]),
      claimedTasks: claims(claim),
      openClaimsOfWorkingCopy: openClaimsOf({}),
      projectRoot: repo,
      realpath: (p) => p,
      ignoreProbe: spawnGitCheckIgnore,
    }).then((r) => {
      if (!r.ok) throw new Error("review failed");
      return r.value;
    });
    expect(out.not_measured.join("\n")).toContain("ENOENT");
    expect(out.not_measured.join("\n")).not.toContain("undefined");
  });

  it("AC-3 a fake probe's reported error is carried verbatim", async () => {
    const out = await reviewHelperScope({
      trail: trailOf([helper("parent", { files: ["a.ts"], workingCopy: repo })]),
      claimedTasks: claims(claim),
      openClaimsOfWorkingCopy: openClaimsOf({}),
      projectRoot: repo,
      realpath: (p) => p,
      ignoreProbe: () => ({ status: null, stdout: "", error: "spawn git ENOENT" }),
    }).then((r) => {
      if (!r.ok) throw new Error("review failed");
      return r.value;
    });
    expect(out.not_measured.join("\n")).toContain("spawn git ENOENT");
  });
});
