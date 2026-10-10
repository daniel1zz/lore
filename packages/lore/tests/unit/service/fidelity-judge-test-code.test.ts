/**
 * AC-BLC-8 (issue #117, AS-17): the `lore baseline fidelity` judge sees the source of each test file the
 * sampled criterion's command names; a criterion whose named test file cannot be read is counted and
 * named as `not_seen` and is never reported faithful.
 *
 * @spec_ref AC-BLC-8
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ok } from "@lore/core";
import type { AIProvider, CreateDocInput, DocRecord, GenerateInput } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { RuleService } from "../../../src/service/rule-service.js";
import { AcService } from "../../../src/service/ac-service.js";
import { runFidelity, TEST_SOURCE_MAX_CHARS } from "../../../src/service/fidelity-sample.js";

const SEEN_SOURCE = "it('SEEN-MARKER the rule holds', () => { expect(rule()).toBe(true); });";
const SEEN_PATH = "tests/seen.test.ts";
const MISSING_PATH = "tests/missing.test.ts";
const BIG_PATH = "tests/big.test.ts";

let repoRoot: string;

beforeAll(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "fidelity-test-code-"));
  mkdirSync(join(repoRoot, "tests"));
  writeFileSync(join(repoRoot, SEEN_PATH), SEEN_SOURCE);
  writeFileSync(join(repoRoot, BIG_PATH), "x".repeat(TEST_SOURCE_MAX_CHARS + 500));
});
afterAll(() => rmSync(repoRoot, { recursive: true, force: true }));

async function mustCreate(corpus: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const r = await corpus.create(input);
  if (!r.ok) throw new Error(`fixture create failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

/** One live rule, one criterion per command (AC-F-<i+1>), each citing the rule. */
async function world(commands: string[]): Promise<InMemoryStore> {
  const store = new InMemoryStore();
  const corpus = new CorpusService(store);
  const rules = new RuleService(store);
  const ac = new AcService(store);
  const prd = await mustCreate(corpus, { type: "prd", title: "P", content: "root" } as CreateDocInput);
  const root = await mustCreate(corpus, { type: "baseline", title: "R", content: "r", parent_id: prd.id, extra: { node: "root", label: "Root" } } as CreateDocInput);
  const branch = await mustCreate(corpus, { type: "baseline", title: "B", content: "b", parent_id: root.id, extra: { node: "branch", label: "Branch" } } as CreateDocInput);
  const leaf = await mustCreate(corpus, { type: "baseline", title: "L", content: "l", parent_id: branch.id, extra: { node: "leaf", label: "Leaf" } } as CreateDocInput);
  const added = await rules.addRule(leaf.id, { statement: "the rule claim", confidence: "established", enforced_by: "guaranteed", examples: ["ex"] }, { by: "fixture" });
  if (!added.ok) throw new Error(`addRule failed: ${JSON.stringify(added.error)}`);
  const spec = await mustCreate(corpus, { type: "spec", title: "S", content: "body" } as CreateDocInput);
  for (let i = 0; i < commands.length; i += 1) {
    const r = await ac.addCriterion(spec.id, {
      id: `AC-F-${i + 1}`,
      statement: `criterion ${i + 1}`,
      verify: { mode: "script", oracle: "test", command: commands[i] },
      cites: [added.value.ruleId],
    } as never);
    if (!r.ok) throw new Error(`addCriterion failed: ${JSON.stringify(r.error)}`);
  }
  return store;
}

/** Fake judge: records every prompt, answers `faithful` for every `### Item n` the prompt carries. */
function fakeJudge(): AIProvider & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    name: "fake-judge",
    prompts,
    async generate(input: GenerateInput) {
      prompts.push(input.prompt);
      const ns = [...input.prompt.matchAll(/### Item (\d+)/g)].map((m) => Number(m[1]));
      return ok({ content: JSON.stringify(ns.map((n) => ({ n, verdict: "faithful", reason: "ok" }))) } as never);
    },
  };
}

const run = (store: InMemoryStore, ai: AIProvider, size: number) =>
  runFidelity({ store, ai, size, seed: 1, judges: 1, exclusions: false, nonce: "N0NCE", repoRoot });

describe("AC-BLC-8: the fidelity judge sees the cited test code", () => {
  it("HAPPY: the prompt carries the source of the test file the command names, inside the data fence", async () => {
    const store = await world([`bunx vitest run ${SEEN_PATH}`]);
    const ai = fakeJudge();
    const r = await run(store, ai, 1);
    expect(r.ok).toBe(true);
    expect(ai.prompts).toHaveLength(1);
    const prompt = ai.prompts[0] as string;
    expect(prompt).toContain("SEEN-MARKER the rule holds");
    expect(prompt).toContain(SEEN_PATH);
    expect(prompt.indexOf("SEEN-MARKER")).toBeGreaterThan(prompt.lastIndexOf("<<DATA-N0NCE>>"));
    expect(prompt.indexOf("SEEN-MARKER")).toBeLessThan(prompt.lastIndexOf("<<END-N0NCE>>"));
    if (r.ok) {
      expect(r.value.not_seen).toBe(0);
      expect(r.value.verdicts[0]?.verdict).toBe("faithful");
    }
  });

  it("NEGATIVE: an unreadable test file is not_seen, names the path, is never judged and never faithful", async () => {
    const store = await world([`bunx vitest run ${MISSING_PATH}`]);
    const ai = fakeJudge();
    const r = await run(store, ai, 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(ai.prompts).toHaveLength(0);
    expect(r.value.verdicts).toHaveLength(1);
    expect(r.value.verdicts[0]?.verdict).toBe("not_seen");
    expect(r.value.verdicts[0]?.unseen_paths).toEqual([MISSING_PATH]);
    expect(r.value.verdicts[0]?.reason).toContain(MISSING_PATH);
    expect(r.value.not_seen).toBe(1);
    expect(r.value.faithful_share).toBe(0);
  });

  it("STATE: a mixed sample counts the seen one as faithful and the unseen one separately; the unseen item is not in the prompt", async () => {
    const store = await world([`bunx vitest run ${SEEN_PATH}`, `bunx vitest run ${MISSING_PATH}`]);
    const ai = fakeJudge();
    const r = await run(store, ai, 2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(ai.prompts).toHaveLength(1);
    expect(ai.prompts[0]).not.toContain(MISSING_PATH);
    const byVerdict = r.value.verdicts.map((v) => v.verdict).sort();
    expect(byVerdict).toEqual(["faithful", "not_seen"]);
    expect(r.value.not_seen).toBe(1);
    expect(r.value.faithful_share).toBe(0.5);
  });

  it("STATE: a criterion naming one readable and one unreadable file is not_seen as a whole, naming only the unreadable path", async () => {
    const store = await world([`bunx vitest run ${SEEN_PATH} ${MISSING_PATH}`]);
    const ai = fakeJudge();
    const r = await run(store, ai, 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.verdicts[0]?.verdict).toBe("not_seen");
    expect(r.value.verdicts[0]?.unseen_paths).toEqual([MISSING_PATH]);
    expect(ai.prompts).toHaveLength(0);
  });

  it("STATE: with two judges an unseen item reaches neither judge nor the adjudicator and stays not_seen", async () => {
    const store = await world([`bunx vitest run ${SEEN_PATH}`, `bunx vitest run ${MISSING_PATH}`]);
    const ai = fakeJudge();
    const r = await runFidelity({ store, ai, size: 2, seed: 1, judges: 2, exclusions: false, nonce: "N0NCE", repoRoot });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(ai.prompts).toHaveLength(2); // judge A + judge B agree, so no adjudicator
    for (const prompt of ai.prompts) expect(prompt).not.toContain(MISSING_PATH);
    expect(r.value.verdicts.map((v) => v.verdict).sort()).toEqual(["faithful", "not_seen"]);
    expect(r.value.not_seen).toBe(1);
    expect(r.value.disagreements).toEqual([]);
  });

  it("BOUNDARY: a file over the cap is cut with a counted truncation note", async () => {
    const store = await world([`bunx vitest run ${BIG_PATH}`]);
    const ai = fakeJudge();
    const r = await run(store, ai, 1);
    expect(r.ok).toBe(true);
    const prompt = ai.prompts[0] as string;
    expect(prompt).toContain(`truncated: showing ${TEST_SOURCE_MAX_CHARS} of ${TEST_SOURCE_MAX_CHARS + 500} characters`);
    expect(prompt).not.toContain("x".repeat(TEST_SOURCE_MAX_CHARS + 1));
  });

  it("REGRESSION: a command naming no test file renders no test-source section and counts nothing unseen", async () => {
    const store = await world(["bun run typecheck"]);
    const ai = fakeJudge();
    const r = await run(store, ai, 1);
    expect(r.ok).toBe(true);
    expect(ai.prompts[0]).not.toContain("Test source");
    if (r.ok) expect(r.value.not_seen).toBe(0);
  });
});
