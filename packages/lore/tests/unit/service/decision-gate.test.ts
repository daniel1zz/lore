// @layer service-decision-gate AC-DR-2 AC-DR-6
/**
 * @spec_ref spec-a-decision-carrying-write-records-its-decision-on-its ("Which writes carry a decision", "Refusal", D2, D9)
 *
 * The decision gate's own decisions, with a fake git port (no process is spawned): which writes carry a decision, what a
 * refusal names, and how a file premise is quoted and pinned. The end-to-end refusals (CLI, MCP, bulk) live in the
 * integration suites; this file pins the pure rules so a failure there points at the right layer.
 *
 * Dimensions: HAPPY (complete decision stored, quote and HEAD stamped), NEGATIVE (each missing part, D/E-only premises,
 * dirty file, absent lines, absent file, outside path), BOUNDARY (last line of a file, a one-line range, sha given on a
 * dirty file), STATE (an unrequired but supplied decision is validated), REGRESSION (a human or draft write is exempt).
 */

import { describe, expect, it } from "vitest";
import {
  DecisionGate,
  isAgentWriterSource,
  writeCarriesDecision,
  type DecisionDraft,
  type DecisionGitPort,
  type GitAnswer,
} from "../../../src/service/decision-gate.js";

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);

/** A fake repository: `files` are the files at HEAD; `atSha` maps `<sha>:<path>` to lines; `dirty` is the dirty path set. */
function fakeGit(opts: { files?: Record<string, string[]>; atSha?: Record<string, string[]>; dirty?: string[]; headFails?: boolean } = {}): DecisionGitPort & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    headSha(): GitAnswer<string> {
      asked.push("head");
      return opts.headFails === true ? { ok: false, reason: "no repository" } : { ok: true, value: HEAD };
    },
    hasUncommittedChanges(path: string): GitAnswer<boolean> {
      asked.push(`dirty:${path}`);
      return { ok: true, value: (opts.dirty ?? []).includes(path) };
    },
    readLinesAt(sha: string, path: string): GitAnswer<readonly string[] | null> {
      asked.push(`show:${sha}:${path}`);
      const lines = sha === HEAD ? opts.files?.[path] : opts.atSha?.[`${sha}:${path}`];
      return { ok: true, value: lines ?? null };
    },
  };
}

const ISSUE_PREMISE = { claim: "the defect is real", tier: "A", source: { kind: "issue", number: 12 } } as const;
const ALTERNATIVE = { option: "leave as is", why_rejected: "the text is wrong" };
const COMPLETE: DecisionDraft = { reason: "fix the wrong number", premises: [ISSUE_PREMISE], alternatives: [ALTERNATIVE] };

function refusalOf(result: ReturnType<DecisionGate["judge"]>): { field?: string; message: string } {
  if (result.ok) throw new Error("expected a refusal");
  const error = result.error as { code: string; field?: string; message: string };
  expect(error.code).toBe("VALIDATION_ERROR");
  return error;
}

describe("writeCarriesDecision / isAgentWriterSource (AC-DR-2)", () => {
  it("only an agent run, writing a non-draft target, changing more than status, carries a decision", () => {
    expect(writeCarriesDecision({ writerSource: "run", targetIsDraft: false, changesMoreThanStatus: true })).toBe(true);
  });

  it.each([
    ["a human session", { writerSource: "human", targetIsDraft: false, changesMoreThanStatus: true }],
    ["a dashboard login", { writerSource: "dashboard", targetIsDraft: false, changesMoreThanStatus: true }],
    ["an HTTP key", { writerSource: "api-key", targetIsDraft: false, changesMoreThanStatus: true }],
    ["no known source", { writerSource: undefined, targetIsDraft: false, changesMoreThanStatus: true }],
    ["a draft target", { writerSource: "run", targetIsDraft: true, changesMoreThanStatus: true }],
    ["a status-only write", { writerSource: "run", targetIsDraft: false, changesMoreThanStatus: false }],
  ])("%s carries none", (_label, facts) => {
    expect(writeCarriesDecision(facts)).toBe(false);
  });

  it("isAgentWriterSource is true for exactly `run`", () => {
    expect(["run", "human", "api-key", "dashboard", null, undefined].map(isAgentWriterSource)).toEqual([true, false, false, false, false, false]);
  });
});

describe("DecisionGate.judge: refusal (AC-DR-2)", () => {
  const gate = new DecisionGate(fakeGit());

  it("a required decision that was not supplied names reason, premise and alternative, field `decision`", () => {
    const error = refusalOf(gate.judge({ required: true, draft: undefined }));
    expect(error.field).toBe("decision");
    expect(error.message).toContain("reason");
    expect(error.message).toContain("premise of tier S..C");
    expect(error.message).toContain("alternative");
    expect(error.message).toContain("Nothing was written");
  });

  it("names ONLY the missing part when one part is missing", () => {
    const noReason = refusalOf(gate.judge({ required: true, draft: { ...COMPLETE, reason: "  " } }));
    expect(noReason.message).toContain("reason");
    expect(noReason.message).not.toContain("premise of tier");
    expect(noReason.message).not.toContain("alternative (");

    const noAlt = refusalOf(gate.judge({ required: true, draft: { ...COMPLETE, alternatives: [] } }));
    expect(noAlt.message).toContain("alternative");
    expect(noAlt.message).not.toContain("reason (");
  });

  it("premises of tier D and E alone are not a premise of tier S..C", () => {
    const weak: DecisionDraft = { ...COMPLETE, premises: [{ ...ISSUE_PREMISE, tier: "D" }, { ...ISSUE_PREMISE, tier: "E" }] };
    expect(refusalOf(gate.judge({ required: true, draft: weak })).message).toContain("premise of tier S..C");
  });

  it("a decision that was supplied but is incomplete is refused even when none was required", () => {
    const error = refusalOf(gate.judge({ required: false, draft: { reason: "only a reason" } }));
    expect(error.message).toContain("premise of tier S..C");
    expect(error.message).toContain("alternative");
  });

  it("nothing required and nothing supplied is ok(undefined), as is an all-empty draft", () => {
    expect(gate.judge({ required: false, draft: undefined })).toEqual({ ok: true, value: undefined });
    expect(gate.judge({ required: false, draft: { reason: " ", premises: [], alternatives: [] } })).toEqual({ ok: true, value: undefined });
  });
});

describe("DecisionGate.judge: the stored record (AC-DR-2)", () => {
  it("a complete decision is stored as given, with optional parts passed through", () => {
    const result = new DecisionGate(fakeGit()).judge({
      required: true,
      draft: {
        ...COMPLETE,
        gates: [{ id: "meaning-unchanged", verdict: "pass", evidence: "same words", computed: false }],
        refs: [{ practice: "ITIL standard change", difference: "no CAB" }],
      },
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value?.reason).toBe("fix the wrong number");
    expect(result.value?.premises).toEqual([{ claim: ISSUE_PREMISE.claim, tier: "A", source: ISSUE_PREMISE.source }]);
    expect(result.value?.alternatives).toEqual([ALTERNATIVE]);
    expect(result.value?.gates).toHaveLength(1);
    expect(result.value?.refs).toHaveLength(1);
    expect(result.value?.scores).toBeUndefined();
  });
});

describe("DecisionGate.judge: file premises (AC-DR-6)", () => {
  const lines = ["alpha", "beta", "gamma", "delta"];
  const filePremise = (spec: { path?: string; lines: [number, number]; sha?: string }) =>
    ({ claim: "the constant is 180000", tier: "S", source: { kind: "file", path: spec.path ?? "src/registry.ts", lines: spec.lines, ...(spec.sha !== undefined ? { sha: spec.sha } : {}) } }) as const;
  const draftWith = (premise: ReturnType<typeof filePremise>): DecisionDraft => ({ ...COMPLETE, premises: [premise] });

  it("stores the named lines' text as `quote` and stamps HEAD when no @sha was given", () => {
    const git = fakeGit({ files: { "src/registry.ts": lines } });
    const result = new DecisionGate(git).judge({ required: true, draft: draftWith(filePremise({ lines: [2, 3] })) });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value?.premises[0]?.source).toEqual({ kind: "file", path: "src/registry.ts", lines: [2, 3], sha: HEAD, quote: "beta\ngamma" });
    expect(git.asked).toContain("dirty:src/registry.ts");
  });

  it("quotes at the named commit, not HEAD, and does not ask whether the file is dirty (the sha pins it)", () => {
    const git = fakeGit({ atSha: { [`${OLD}:src/registry.ts`]: ["old one", "old two"] }, files: { "src/registry.ts": lines }, dirty: ["src/registry.ts"] });
    const result = new DecisionGate(git).judge({ required: true, draft: draftWith(filePremise({ lines: [1, 1], sha: OLD })) });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value?.premises[0]?.source).toMatchObject({ sha: OLD, quote: "old one" });
    expect(git.asked.some((q) => q.startsWith("dirty:"))).toBe(false);
  });

  it("BOUNDARY: the last line of the file is quotable; one line past it is refused", () => {
    const git = fakeGit({ files: { "src/registry.ts": lines } });
    const last = new DecisionGate(git).judge({ required: true, draft: draftWith(filePremise({ lines: [4, 4] })) });
    expect(last.ok && last.value?.premises[0]?.source).toMatchObject({ quote: "delta" });
    const past = refusalOf(new DecisionGate(git).judge({ required: true, draft: draftWith(filePremise({ lines: [4, 5] })) }));
    expect(past.field).toBe("decision");
    expect(past.message).toContain("absent");
  });

  it("a file with uncommitted changes and no @sha is refused, naming the file and the way out", () => {
    const git = fakeGit({ files: { "src/registry.ts": lines }, dirty: ["src/registry.ts"] });
    const error = refusalOf(new DecisionGate(git).judge({ required: true, draft: draftWith(filePremise({ lines: [1, 1] })) }));
    expect(error.message).toContain("uncommitted");
    expect(error.message).toContain("src/registry.ts");
    expect(error.message).toContain("@<sha>");
  });

  it("a file absent at the commit is refused", () => {
    const git = fakeGit({});
    const error = refusalOf(new DecisionGate(git).judge({ required: true, draft: draftWith(filePremise({ lines: [1, 1] })) }));
    expect(error.message).toContain("does not exist");
  });

  it("an unreadable HEAD is refused, never guessed", () => {
    const git = fakeGit({ files: { "src/registry.ts": lines }, headFails: true });
    const error = refusalOf(new DecisionGate(git).judge({ required: true, draft: draftWith(filePremise({ lines: [1, 1] })) }));
    expect(error.message).toContain("HEAD could not be read");
  });

  it.each(["../outside.ts", "/etc/passwd", ""])("a path outside the repository (%j) is refused", (path) => {
    const error = refusalOf(new DecisionGate(fakeGit()).judge({ required: true, draft: draftWith(filePremise({ path, lines: [1, 1] })) }));
    expect(error.message).toContain("inside the repository");
  });

  describe("gate and score evidence that is a file source", () => {
    const git = () => fakeGit({ files: { "src/registry.ts": lines }, dirty: ["src/dirty.ts"] });
    const gateWith = (evidence: string) => ({ id: "meaning-unchanged", verdict: "pass", evidence, computed: false }) as const;
    const scoreWith = (evidence: string) => ({ option: "A", dimension: "cost", value: 1, evidence }) as const;

    it("a gate's file evidence is quoted and pinned like a premise; the typed text is kept", () => {
      const result = new DecisionGate(git()).judge({ required: true, draft: { ...COMPLETE, gates: [gateWith("file:src/registry.ts:2-3")] } });
      if (!result.ok) throw new Error(JSON.stringify(result.error));
      expect(result.value?.gates?.[0]?.evidence).toBe("file:src/registry.ts:2-3");
      expect(result.value?.gates?.[0]?.evidence_source).toEqual({ kind: "file", path: "src/registry.ts", lines: [2, 3], sha: HEAD, quote: "beta\ngamma" });
    });

    it("a score's file evidence is quoted and pinned at the named commit", () => {
      const pinned = fakeGit({ atSha: { [`${OLD}:src/registry.ts`]: ["old"] } });
      const result = new DecisionGate(pinned).judge({ required: true, draft: { ...COMPLETE, scores: [scoreWith(`file:src/registry.ts:1@${OLD}`)] } });
      if (!result.ok) throw new Error(JSON.stringify(result.error));
      expect(result.value?.scores?.[0]?.evidence_source).toMatchObject({ sha: OLD, quote: "old" });
    });

    it("plain-prose evidence stays unquoted and asks git nothing", () => {
      const fake = git();
      const result = new DecisionGate(fake).judge({ required: true, draft: { ...COMPLETE, gates: [gateWith("the sentence says the same")], scores: [scoreWith("measured by hand")] } });
      if (!result.ok) throw new Error(JSON.stringify(result.error));
      expect(result.value?.gates?.[0]?.evidence_source).toBeUndefined();
      expect(result.value?.scores?.[0]?.evidence_source).toBeUndefined();
      expect(fake.asked).toEqual([]);
    });

    it("a dirty file and no sha, or lines absent, refuse the write naming the gate evidence", () => {
      const dirty = refusalOf(new DecisionGate(git()).judge({ required: true, draft: { ...COMPLETE, gates: [gateWith("file:src/dirty.ts:1")] } }));
      expect(dirty.message).toContain("gate \"meaning-unchanged\" evidence");
      expect(dirty.message).toContain("uncommitted");
      const absent = refusalOf(new DecisionGate(git()).judge({ required: true, draft: { ...COMPLETE, scores: [scoreWith("file:src/registry.ts:9")] } }));
      expect(absent.message).toContain("absent");
    });
  });

  it("a leading ./ is dropped so the same file is asked for under one name", () => {
    const git = fakeGit({ files: { "src/registry.ts": lines } });
    const result = new DecisionGate(git).judge({ required: true, draft: draftWith(filePremise({ path: "./src/registry.ts", lines: [1, 1] })) });
    expect(result.ok && result.value?.premises[0]?.source).toMatchObject({ path: "src/registry.ts", quote: "alpha" });
  });
});
