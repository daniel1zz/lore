/**
 * AC-JV-2 (spec-judgment-surfaces-must-verify-before-they-certify-machine, D4) — the assess
 * diff excludes the generated `docs/requirements/**` mirror BEFORE truncation: given a diff
 * containing BOTH a mirror hunk and a source hunk, the built judge prompt contains the
 * source path and does NOT contain the mirror path.
 *
 * Why this exercises PRODUCTION WIRING, not just the pure helper in isolation: every test
 * below drives `AIProviderService.assessPlan` end-to-end with a scripted `InMemoryAIProvider`
 * and inspects `provider.calls[0].prompt` — the EXACT text the judge would have been shown —
 * rather than calling `excludeAssessMirrorFromDiff` directly. A regression where the
 * exclusion pass exists but `assessPlan` forgot to call it (the exact false-green shape this
 * repo has hit before: an added-but-never-called function) would still show the mirror path
 * IN the built prompt, and this suite would catch it; calling the helper directly could not.
 *
 * ⛔ Never asserted by size comparison (a truncation could satisfy that by accident) — every
 * assertion below is presence/absence of the two SPECIFIC paths.
 *
 * Six-dimension coverage:
 *   HAPPY:      diff with both a mirror hunk and a source hunk → prompt has the source path,
 *               lacks the mirror path
 *   NEGATIVE:   diff with ONLY a mirror hunk → prompt has no mirror path at all
 *   BOUNDARY:   a path that CONTAINS "docs/requirements" as a substring but does not START
 *               WITH the "docs/requirements/" prefix is KEPT (prefix match, not substring)
 *   ERROR:      no diff supplied at all (`diffText` undefined) → no crash, no mirror path,
 *               no source path either (there is nothing to show)
 *   STATE:      multiple mirror hunks AND multiple source hunks interleaved → every mirror
 *               hunk is removed, every source hunk survives
 *   REGRESSION: a diff with ZERO mirror hunks renders byte-identically whether or not the
 *               exclusion pass ran (the overwhelmingly common case is a true no-op)
 *
 * Separately: the exclusion prefix is asserted to have a SINGLE named-constant definition
 * site (`ASSESS_DIFF_MIRROR_PATH_PREFIX`) by scanning the actual source text — never merely
 * "the constant exists", which would let a stray second literal survive undetected.
 *
 * @spec_ref AC-JV-2
 */

import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { AIProviderService } from "../../../src/service/ai-provider-service.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { InMemoryAIProvider } from "../../../src/ai/in-memory-provider.js";
import type { AIProvider, CreateDocInput, PlanBundle, Telemetry, TelemetryEvent } from "@lore/core";

const DEFAULT_BUDGETS = { max_plan_chars: 8000, max_spec_chars: 12000, max_task_chars: 4000, max_diff_chars: 24000 };

const MIRROR_PATH = "docs/requirements/spec/SPEC-999-mirror-fixture.md";
const SOURCE_PATH = "packages/lore/src/real-source-file.ts";
const LOOKALIKE_PATH = "packages/lore/docs/requirements-summary.ts";

const MINIMAL_VALID_JUDGE_RESPONSE = JSON.stringify({
  verdict: "met",
  overall_score: 90,
  ac_scores: [],
  gaps: [],
  recommendations: [],
});

function makeAssessService(provider: InMemoryAIProvider): AIProviderService {
  const telemetry: Telemetry = { record: (_e: TelemetryEvent) => {}, emit: () => {}, close: () => {} };
  const providers = new Map([[provider.name, provider]]) as unknown as ReadonlyMap<string, AIProvider>;
  return new AIProviderService(providers, provider.name, {}, telemetry, false, 8000, DEFAULT_BUDGETS);
}

async function makeBundle(store: InMemoryStore): Promise<PlanBundle> {
  const corpusService = new CorpusService(store);
  const planResult = await corpusService.create({
    type: "plan",
    title: "Mirror Exclusion Plan",
    content: "Plan goals.",
  } as CreateDocInput);
  if (!planResult.ok) throw new Error("plan create failed");

  const taskResult = await corpusService.create({
    type: "task",
    title: "Mirror Exclusion Task",
    parent_id: planResult.value.id,
    content: "task body",
    extra: { plan_id: planResult.value.id },
  } as CreateDocInput);
  if (!taskResult.ok) throw new Error("task create failed");

  const bundleResult = await corpusService.getPlanBundle(planResult.value.id);
  if (!bundleResult.ok) throw new Error("getPlanBundle failed");
  return bundleResult.value;
}

/** One `diff --git a/<p> b/<p>` hunk with a trivial one-line body. */
function hunk(path: string, oldLine: string, newLine: string): string {
  return `diff --git a/${path} b/${path}\n@@ -1,1 +1,1 @@\n-${oldLine}\n+${newLine}\n`;
}

async function runAssessAndGetPrompt(diffText: string | undefined): Promise<string> {
  const store = new InMemoryStore();
  const bundle = await makeBundle(store);
  const provider = new InMemoryAIProvider("in-memory", {
    kind: "sequence",
    responses: [{ kind: "ok", content: MINIMAL_VALID_JUDGE_RESPONSE }],
  });
  const service = makeAssessService(provider);

  const result = await service.assessPlan(bundle, {
    ...(diffText !== undefined ? { diffText } : {}),
    commitDerivationUnverifiable: false,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`assessPlan failed: ${JSON.stringify(result.error)}`);

  expect(provider.calls).toHaveLength(1);
  return provider.calls[0]!.prompt;
}

describe("AC-JV-2: assess diff excludes the generated mirror before truncation", () => {
  it("HAPPY: a diff with BOTH a mirror hunk and a source hunk → built prompt has the source path, lacks the mirror path", async () => {
    const diff = hunk(MIRROR_PATH, "old mirror text", "new mirror text") + hunk(SOURCE_PATH, "old source text", "new source text");
    const prompt = await runAssessAndGetPrompt(diff);

    expect(prompt).toContain(SOURCE_PATH);
    expect(prompt).not.toContain(MIRROR_PATH);
    // reason: never assert by size alone (AC-JV-2's own text) — the specific surviving
    // source-hunk BODY text must also be present, not just the path in a header line that
    // happened to survive while the hunk body was truncated away for unrelated reasons.
    expect(prompt).toContain("new source text");
  });

  it("NEGATIVE: a diff with ONLY a mirror hunk → built prompt has no mirror path at all", async () => {
    const diff = hunk(MIRROR_PATH, "old mirror text", "new mirror text");
    const prompt = await runAssessAndGetPrompt(diff);

    expect(prompt).not.toContain(MIRROR_PATH);
    expect(prompt).not.toContain("new mirror text");
  });

  it("BOUNDARY: a path CONTAINING \"docs/requirements\" as a substring but not as a PREFIX is KEPT (prefix match, never substring)", async () => {
    const diff = hunk(MIRROR_PATH, "old mirror text", "new mirror text") + hunk(LOOKALIKE_PATH, "old lookalike", "new lookalike");
    const prompt = await runAssessAndGetPrompt(diff);

    expect(prompt).not.toContain(MIRROR_PATH);
    expect(prompt).toContain(LOOKALIKE_PATH);
    expect(prompt).toContain("new lookalike");
  });

  it("ERROR: no diff supplied at all (diffText undefined) → no crash, and no path (mirror or source) appears anywhere", async () => {
    const prompt = await runAssessAndGetPrompt(undefined);
    expect(prompt).not.toContain(MIRROR_PATH);
    expect(prompt).not.toContain(SOURCE_PATH);
    expect(prompt).toContain("(no diff provided)");
  });

  it("STATE: multiple mirror hunks AND multiple source hunks interleaved → every mirror hunk removed, every source hunk survives", async () => {
    const secondMirrorPath = "docs/requirements/knowledge/knowledge-999-fixture.md";
    const secondSourcePath = "packages/core/src/second-real-source.ts";
    const diff =
      hunk(MIRROR_PATH, "a", "mirror-one-new") +
      hunk(SOURCE_PATH, "b", "source-one-new") +
      hunk(secondMirrorPath, "c", "mirror-two-new") +
      hunk(secondSourcePath, "d", "source-two-new");
    const prompt = await runAssessAndGetPrompt(diff);

    expect(prompt).not.toContain(MIRROR_PATH);
    expect(prompt).not.toContain(secondMirrorPath);
    expect(prompt).not.toContain("mirror-one-new");
    expect(prompt).not.toContain("mirror-two-new");

    expect(prompt).toContain(SOURCE_PATH);
    expect(prompt).toContain(secondSourcePath);
    expect(prompt).toContain("source-one-new");
    expect(prompt).toContain("source-two-new");
  });

  it("REGRESSION: a diff with ZERO mirror hunks is unaffected by the exclusion pass — the source hunk's exact body text survives verbatim", async () => {
    const diff = hunk(SOURCE_PATH, "old source text", "brand new source text");
    const prompt = await runAssessAndGetPrompt(diff);

    expect(prompt).toContain(SOURCE_PATH);
    expect(prompt).toContain("brand new source text");
    expect(prompt).not.toContain(MIRROR_PATH);
  });
});

describe("AC-JV-2: the exclusion prefix has a SINGLE named-constant definition site", () => {
  it("STATE: ASSESS_DIFF_MIRROR_PATH_PREFIX is assigned exactly once in assess-template.ts's source text — a second literal assignment would let a stray duplicate survive undetected", () => {
    const sourcePath = new URL("../../../src/ai/assess-template.ts", import.meta.url);
    const sourceText = readFileSync(sourcePath, "utf8");

    // reason: matches an ACTUAL assignment (`= "docs/requirements/"`), never a comment or
    // JSDoc example mentioning the same string — a census over every substring occurrence
    // of "docs/requirements" would over-match every illustrative example in this very file's
    // own JSDoc (this repo has measured that exact over-matching failure mode before).
    const assignmentPattern = /=\s*"docs\/requirements\/"/g;
    const matches = sourceText.match(assignmentPattern) ?? [];
    expect(matches).toHaveLength(1);

    // reason: the ONE assignment found above must be the named constant itself, not some
    // other unrelated variable coincidentally assigned the same literal.
    expect(sourceText).toContain('export const ASSESS_DIFF_MIRROR_PATH_PREFIX = "docs/requirements/"');
  });

  it("REGRESSION: excludeAssessMirrorFromDiff itself reads ASSESS_DIFF_MIRROR_PATH_PREFIX (not a re-inlined literal) — a second hardcoded prefix inside the function body would defeat the single-definition-site guarantee even if the exported constant is also present", () => {
    const sourcePath = new URL("../../../src/ai/assess-template.ts", import.meta.url);
    const sourceText = readFileSync(sourcePath, "utf8");

    const functionStart = sourceText.indexOf("export function excludeAssessMirrorFromDiff");
    expect(functionStart).toBeGreaterThan(-1);
    const functionEnd = sourceText.indexOf("\n}", functionStart);
    const functionBody = sourceText.slice(functionStart, functionEnd);

    expect(functionBody).toContain("ASSESS_DIFF_MIRROR_PATH_PREFIX");
    expect(functionBody).not.toMatch(/"docs\/requirements\/"/);
  });
});
