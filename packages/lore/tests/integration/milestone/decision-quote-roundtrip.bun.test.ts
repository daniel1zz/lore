// @spawns-external git builds a throwaway git repository the test runs against
/**
 * @spec_ref spec-a-decision-carrying-write-records-its-decision-on-its
 *
 * Issue #498: the write-time quote (DecisionGate over the real git port) and the milestone re-check read the same pinned
 * lines through ONE shared extractor, so an unchanged file never reads as wrong-when-written. The trigger in the corpus:
 * a cited range that ends in a blank line after a long box-drawing comment (the re-check used to drop the quote's
 * trailing empty line, so the two sides differed at the tail).
 *
 * Coverage: HAPPY (round trip, no finding) / BOUNDARY (blank tail line, CRLF file, multi-byte long line) /
 * REGRESSION (a legacy stored quote still judges correctly) / NEGATIVE (a genuinely changed line stays wrong-when-written).
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { err, type DecisionRecord } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { DecisionGate } from "../../../src/service/decision-gate.js";
import { SpawnDecisionGitPort } from "../../../src/service/decision-git-port.js";
import { SpawnGitPort } from "../../../src/service/rule-state-git-port.js";
import { recheckDecision } from "../../../src/service/decision-recheck.js";

let repo: string;
let sha: string;

function git(...args: string[]): string {
  const run = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`);
  return run.stdout.trim();
}

const RULE = `// ─── REGRESSION — the lifecycle half of the SAME context object ${"─".repeat(12)}`;
const LF_FILE = ["describe('x', () => {", "  it('y', () => {});", "});", "", RULE, "", "describe('z', () => {", "});"];

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "lore-quote-roundtrip-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(repo, "lf.ts"), `${LF_FILE.join("\n")}\n`);
  writeFileSync(join(repo, "crlf.ts"), `${LF_FILE.join("\r\n")}\r\n`);
  git("add", "-A");
  git("commit", "-q", "-m", "A");
  sha = git("rev-parse", "HEAD");
});
afterAll(() => rmSync(repo, { recursive: true, force: true }));

/** Quote `path:from-to@sha` exactly as a write does, then re-check the stored record. */
async function roundTrip(path: string, from: number, to: number, mutate?: (quote: string) => string) {
  const judged = new DecisionGate(new SpawnDecisionGitPort(repo)).judge({
    required: true,
    draft: {
      reason: "r",
      premises: [{ claim: "c", tier: "S", source: { kind: "file", path, lines: [from, to], sha } }],
      alternatives: [{ option: "o", why_rejected: "w" }],
    },
  });
  if (!judged.ok || judged.value === undefined) throw new Error(JSON.stringify(judged));
  const record: DecisionRecord = judged.value;
  const first = record.premises[0];
  const source = first?.source;
  if (first === undefined || source?.kind !== "file") throw new Error("not a file source");
  const stored: DecisionRecord = mutate === undefined ? record : { ...record, premises: [{ ...first, source: { ...source, quote: mutate(source.quote) } }] };
  const findings = await recheckDecision(
    { store: new InMemoryStore(), git: new SpawnGitPort(repo), runner: { run: async () => err({ code: "STORE_ERROR", message: "none" }) } },
    { address: "spec-x@1", record: stored },
  );
  return { findings, quote: source.quote };
}

describe("write-time quote and re-check share one normalisation (#498)", () => {
  it("a range ending in a blank line after a long box-drawing comment is no finding", async () => {
    const { findings, quote } = await roundTrip("lf.ts", 4, 6);
    expect(quote.endsWith("\n")).toBe(true);
    expect(findings).toEqual([]);
  });

  it("a range ending on the long multi-byte comment line is no finding", async () => {
    expect((await roundTrip("lf.ts", 4, 5)).findings).toEqual([]);
  });

  it("a CRLF file round-trips without a finding", async () => {
    expect((await roundTrip("crlf.ts", 1, 6)).findings).toEqual([]);
  });

  it("a legacy stored quote (CRLF kept by the old writer) is still judged correctly", async () => {
    expect((await roundTrip("lf.ts", 4, 6, (q) => q.replace(/\n/g, "\r\n"))).findings).toEqual([]);
  });

  it("a genuinely changed line is still wrong-when-written", async () => {
    const { findings } = await roundTrip("lf.ts", 4, 6, (q) => q.replace("lifecycle", "lifecyc1e"));
    expect(findings.map((f) => f.kind)).toEqual(["wrong-when-written"]);
  });

  it("a quote missing its trailing blank line is wrong-when-written (the range is 3 lines)", async () => {
    const { findings } = await roundTrip("lf.ts", 4, 6, (q) => q.replace(/\n$/, ""));
    expect(findings.map((f) => f.kind)).toEqual(["wrong-when-written"]);
  });
});
