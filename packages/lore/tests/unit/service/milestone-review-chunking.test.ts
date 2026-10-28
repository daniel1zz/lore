/**
 * AC-AF-5 / BR-1499: no silent truncation. A diff over the per-call budget is judged in file chunks for security and
 * concurrency_safety (worst verdict wins) and in one summary call for the rest; files no call shows are listed as not
 * seen and make the gates not-measured, never pass; calls, tokens and duration are recorded.
 *
 * Dimensions: HAPPY (chunk calls, call count, records), NEGATIVE (unseen file never passes), BOUNDARY (diff within
 * budget is one call; a file exactly fills a chunk), ERROR (a chunk answer without cites is retried), STATE (chunks
 * are a partition: every file in exactly one), REGRESSION (no chunk text exceeds the budget).
 */

import { describe, expect, it } from "vitest";
import { chunkDiffByFile } from "../../../src/ai/diff-chunking.js";
import { answerJson, buildJudgmentFixture } from "../../helpers/milestone-judgment-fixture.js";

function fileDiff(path: string, lines: number): string {
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${"+line\n".repeat(lines)}`.trimEnd();
}

const pass = { verdict: "pass" };
const full = { spec_conformance: pass, design_necessity: pass, concurrency_safety: pass, security: pass };
const chunkPass = { concurrency_safety: pass, security: pass };
const summaryPass = { spec_conformance: pass, design_necessity: pass };

function isChunkPrompt(prompt: string): boolean {
  return prompt.includes("# Diff chunk");
}

const diff = [fileDiff("src/a.ts", 20), fileDiff("src/b.ts", 20), fileDiff("src/c.ts", 20)].join("\n");
const oneFile = fileDiff("src/a.ts", 20).length;
// reason: a budget that holds one file but not two forces one chunk per file
const budget = oneFile + 10;

describe("AC-AF-5 no silent truncation", () => {
  it("AC-AF-5 HAPPY: a budget smaller than the diff makes one security and concurrency call per file chunk, plus one summary call", async () => {
    const fx = buildJudgmentFixture((p) => ({
      text: isChunkPrompt(p) ? answerJson(chunkPass) : answerJson(summaryPass),
      duration_ms: 10,
      tokens_in: 100,
      tokens_out: 20,
    }));
    const result = await fx.review({ diffText: diff, maxDiffChars: budget });
    expect(result.ok).toBe(true);
    const chunkCalls = fx.prompts.filter(isChunkPrompt);
    expect(chunkCalls).toHaveLength(3);
    expect(fx.prompts).toHaveLength(4);
    // each chunk call carries only its own file
    expect(chunkCalls[0]).toContain("src/a.ts");
    expect(chunkCalls[0]).not.toContain("src/b.ts");
    // the summary call carries the full file list and the chunk summaries, not the diff text
    const summary = fx.prompts.find((p) => !isChunkPrompt(p))!;
    expect(summary).toContain("All files (3): src/a.ts, src/b.ts, src/c.ts");
    expect(summary).toContain("chunk 1: src/a.ts (+20 -0)");
    expect(summary).not.toContain("+line");
    const j = fx.stored()!.judgment!;
    expect(j.calls).toBe(4);
    expect(j.tokens_in).toBe(400);
    expect(j.tokens_out).toBe(80);
    expect(j.duration_ms).toBe(40);
    expect(j.unseen_files).toEqual([]);
    expect(j.files_total).toBe(3);
    expect(fx.stored()!.dimensions.security.verdict).toBe("pass");
  });

  it("AC-AF-5 HAPPY: the worst chunk verdict wins and its cites are kept", async () => {
    const fx = buildJudgmentFixture((p) => {
      if (!isChunkPrompt(p)) return answerJson(summaryPass);
      if (p.includes("src/b.ts")) return answerJson({ concurrency_safety: pass, security: { verdict: "fail", reason: "sql built from input", cites: ["src/b.ts"] } });
      return answerJson(chunkPass);
    });
    await fx.review({ diffText: diff, maxDiffChars: budget });
    const sec = fx.stored()!.dimensions.security;
    expect(sec.verdict).toBe("fail");
    expect(sec.cites).toEqual(["src/b.ts"]);
    expect(fx.stored()!.dimensions.concurrency_safety.verdict).toBe("pass");
  });

  it("AC-AF-5 BOUNDARY: a diff within the budget is judged in one call", async () => {
    const fx = buildJudgmentFixture(() => ({ text: answerJson(full), duration_ms: 7 }));
    await fx.review({ diffText: diff, maxDiffChars: diff.length });
    expect(fx.prompts).toHaveLength(1);
    expect(fx.prompts[0]).toContain("+line");
    const j = fx.stored()!.judgment!;
    expect(j.calls).toBe(1);
    expect(j.duration_ms).toBe(7);
    expect(j.tokens_in).toBeUndefined();
    expect(j.unseen_files).toEqual([]);
  });

  it("AC-AF-5 NEGATIVE: a file alone over the budget is listed as not seen and security is not-measured, never pass", async () => {
    const huge = fileDiff("src/huge.ts", 400);
    const fx = buildJudgmentFixture((p) => (isChunkPrompt(p) ? answerJson(chunkPass) : answerJson(summaryPass)));
    const result = await fx.review({ diffText: [fileDiff("src/a.ts", 20), huge].join("\n"), maxDiffChars: budget });
    expect(result.ok).toBe(true);
    const review = fx.stored()!;
    expect(review.judgment!.unseen_files).toEqual(["src/huge.ts"]);
    expect(review.dimensions.security.verdict).toBe("not-measured");
    expect(review.dimensions.security.reason).toContain("src/huge.ts");
    expect(review.dimensions.concurrency_safety.verdict).toBe("not-measured");
    // the judge is told which file it did not get
    expect(fx.prompts.every((p) => p.includes("NOT shown to any call"))).toBe(true);
    // spec_conformance is still judged
    expect(review.dimensions.spec_conformance.verdict).toBe("pass");
  });

  it("AC-AF-5 NEGATIVE: an unseen file does not hide a seen chunk's failure", async () => {
    const fx = buildJudgmentFixture((p) => (isChunkPrompt(p) ? answerJson({ concurrency_safety: pass, security: { verdict: "fail", cites: ["src/a.ts"] } }) : answerJson(summaryPass)));
    await fx.review({ diffText: [fileDiff("src/a.ts", 20), fileDiff("src/huge.ts", 400)].join("\n"), maxDiffChars: budget });
    expect(fx.stored()!.dimensions.security.verdict).toBe("fail");
  });

  it("AC-AF-5 NEGATIVE: an AI-mode criterion whose rubric names an unseen file is not-measured", async () => {
    const fx = buildJudgmentFixture(
      (p) => (isChunkPrompt(p) ? answerJson(chunkPass) : answerJson(summaryPass, { criteria: [{ spec: "spec-one", ac: "AC-X-9", verdict: "pass", reason: "fine" }] })),
      { facts: { ai_criteria: [{ spec: "spec-one", ac: "AC-X-9", rubric: "src/huge.ts validates its input" }] } },
    );
    await fx.review({ diffText: [fileDiff("src/a.ts", 20), fileDiff("src/huge.ts", 400)].join("\n"), maxDiffChars: budget });
    const review = fx.stored()!;
    expect(review.judgment!.ai_criteria[0]?.verdict).toBe("not-measured");
    expect(review.dimensions.correctness_vs_acs.verdict).toBe("not-measured");
  });

  it("AC-AF-5 ERROR: a chunk answer that fails without cites is retried once", async () => {
    let first = true;
    const fx = buildJudgmentFixture((p) => {
      if (!isChunkPrompt(p)) return answerJson(summaryPass);
      if (first) {
        first = false;
        return answerJson({ concurrency_safety: pass, security: { verdict: "fail" } });
      }
      return answerJson(chunkPass);
    });
    const result = await fx.review({ diffText: diff, maxDiffChars: budget });
    expect(result.ok).toBe(true);
    expect(fx.stored()!.judgment!.calls).toBe(5);
  });

  it("AC-AF-5 STATE: chunks partition the files and none exceeds the budget", () => {
    const chunking = chunkDiffByFile(diff, oneFile * 2 + 5);
    const files = chunking.chunks.flatMap((c) => c.files.map((f) => f.path));
    expect(files).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(chunking.chunks).toHaveLength(2);
    for (const c of chunking.chunks) expect(c.text.length).toBeLessThanOrEqual(oneFile * 2 + 5);
    expect(chunking.unseen).toEqual([]);
  });

  it("AC-AF-5 BOUNDARY: no diff at all is one call and lists nothing unseen", async () => {
    const fx = buildJudgmentFixture(() => answerJson(full));
    await fx.review({ maxDiffChars: 10 });
    expect(fx.prompts).toHaveLength(1);
    expect(fx.stored()!.judgment!.files_total).toBe(0);
  });
});
