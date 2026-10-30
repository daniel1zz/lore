/**
 * @spec_ref spec-a-plan-s-tests-and-criteria-are-measured-once-at-its (BR-1379, "Fingerprint" re-review triggers)
 *
 * The files a failing criterion's verify command names are the kept-open plan's re-review triggers (`failing_files`).
 *
 * Dimensions: HAPPY (a failing criterion names its test file), NEGATIVE (a passing or not-measured criterion names none),
 * BOUNDARY (flags, shell operators, quotes and duplicates; a command naming no file), STATE (several failing criteria merge sorted).
 */

import { describe, expect, it } from "vitest";
import { criteriaRunRecordSchema, ok } from "@lore/core";
import {
  filesNamedByCommand,
  measureCriteriaAtHead,
  type AttestationRow,
  type CriterionScope,
  type HeadCriteriaRunnerPort,
} from "../../../src/service/milestone-attestation-facts.js";

const HEAD = "h".repeat(40);

const scope = (ac: string, command: string): CriterionScope => ({
  doc_slug: "spec-one",
  ac_id: ac,
  mode: "script",
  command,
  holders: [{ task_slug: "task-one" }],
});

/** A runner whose every criterion ran and attested the given verdict at head. */
function measure(scopes: CriterionScope[], verdicts: Record<string, "pass" | "fail">) {
  const rows: AttestationRow[] = [];
  const runner: HeadCriteriaRunnerPort = {
    attestAtHead: async (request) => {
      for (const c of request.criteria) {
        const at = `2026-10-29T10:00:0${String(rows.length)}.000Z`;
        rows.push({ id: `t@${at}`, doc_slug: c.doc_slug, ac_id: c.ac_id, result: verdicts[c.ac_id] ?? "pass", head_sha: request.commit, recorded_at: at });
      }
      return ok(request.criteria.map((c) => ({ ...c, ran: true as const })));
    },
  };
  return measureCriteriaAtHead({ scopes, headCommit: HEAD, runner, readRows: async () => ok(rows) });
}

describe("filesNamedByCommand", () => {
  it("HAPPY: names the test file of a runner command", () => {
    expect(filesNamedByCommand("bun run test:file packages/lore/tests/unit/a.test.ts && echo 'X PASS: y'")).toEqual(["packages/lore/tests/unit/a.test.ts"]);
  });

  it("BOUNDARY: ignores flags, words and the echo text; strips quotes; deduplicates", () => {
    expect(filesNamedByCommand(`bunx vitest run --reporter=dot "a/b.test.ts" a/b.test.ts -t name && echo done`)).toEqual(["a/b.test.ts"]);
  });

  it("BOUNDARY: a command naming no file yields none", () => {
    expect(filesNamedByCommand("bun run typecheck")).toEqual([]);
  });
});

describe("the criteria worktree record (loud fallback)", () => {
  it("HAPPY: a worktree of their own is recorded with the reason the suite worktree was not used", () => {
    expect(criteriaRunRecordSchema.parse({ worktree: "own", reason: "the head's suite result was already stored" })).toEqual({
      worktree: "own",
      reason: "the head's suite result was already stored",
    });
    expect(criteriaRunRecordSchema.parse({ worktree: "suite" })).toEqual({ worktree: "suite" });
  });

  it("NEGATIVE: an unknown worktree kind or an empty reason is refused", () => {
    expect(criteriaRunRecordSchema.safeParse({ worktree: "elsewhere" }).success).toBe(false);
    expect(criteriaRunRecordSchema.safeParse({ worktree: "own", reason: "" }).success).toBe(false);
  });
});

describe("failing_files of the criteria facts", () => {
  it("HAPPY: a failing criterion contributes the files its command names", async () => {
    const facts = await measure([scope("AC-1", "bun run test:file packages/x/a.test.ts")], { "AC-1": "fail" });
    expect(facts.failing_files).toEqual(["packages/x/a.test.ts"]);
  });

  it("NEGATIVE: a passing criterion contributes none", async () => {
    const facts = await measure([scope("AC-1", "bun run test:file packages/x/a.test.ts")], { "AC-1": "pass" });
    expect(facts.failing_files).toEqual([]);
  });

  it("STATE: only the failing criteria contribute, merged and sorted", async () => {
    const facts = await measure(
      [scope("AC-1", "bun run test:file z/z.test.ts"), scope("AC-2", "bun run test:file a/a.test.ts"), scope("AC-3", "bun run test:file m/m.test.ts")],
      { "AC-1": "fail", "AC-2": "fail", "AC-3": "pass" },
    );
    expect(facts.failing_files).toEqual(["a/a.test.ts", "z/z.test.ts"]);
  });
});
