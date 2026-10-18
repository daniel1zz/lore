/**
 * AC-JV-1 (spec-judgment-surfaces-must-verify-before-they-certify-machine, D1/D2/D3) — assess
 * findings are path-verified against the ASSESSED commit resolved from `extra.diff_source`,
 * with all three outcomes exercised in this one oracle file:
 *   (a) a finding declaring a path ABSENT at the assessed commit moves to
 *       `unverifiable_findings[]` carrying the failing path and the commit checked against,
 *       is counted in `paths_verified.unverifiable`, and is EXCLUDED from the scored set;
 *   (b) a finding whose declared path EXISTS at the assessed commit but NOT in the worktree
 *       is KEPT — the assessed commit is the referent, never `HEAD`/the worktree;
 *   (c) the stored `overall_score` is left BYTE-IDENTICAL to what the judge emitted, never
 *       recomputed from the surviving finding count.
 * A missing/unresolvable commit fails LOUD, naming the commit, rather than being silently
 * read as "every declared path is absent".
 *
 * Why this exercises PRODUCTION WIRING, not a helper in isolation: every test drives
 * `AIProviderService.assessPlan` end-to-end (the exact method `commands/assess.ts`/MCP
 * `tools.ts` call) with a scripted `InMemoryAIProvider`, a REAL throwaway git repository
 * (never a mocked/faked git), and inspects the RETURNED `AssessmentResult` — never calling
 * the internal `verifyFindingPaths` function directly. A regression where the verification
 * function exists but `assessPlan`/`_finalizeAssessment` forgot to call it (an
 * added-but-never-called function — the exact false-green shape this repo has measured four
 * times before) would leave `typed_gaps`/`unverifiable_findings`/`paths_verified` exactly as
 * the raw judge output, and every test below would catch that.
 *
 * Clause (b) is the DISCRIMINATING case: `kept.ts` is committed at `commit2`, then physically
 * DELETED from the throwaway repo's working directory (never committed as a deletion) before
 * the assertion runs. `git cat-file -e <commit>:<path>` still finds it (content-addressed,
 * immutable, unaffected by working-tree state); a WRONG implementation checking
 * `fs.existsSync(path.join(repoRoot, path))` against the worktree instead would report it
 * absent and wrongly withdraw the finding. Only a genuine git-object-store check passes.
 *
 * Six-dimension coverage:
 *   HAPPY:      one oracle run asserting (a), (b), and (c) together — the literal "all three
 *               outcomes in one oracle" AC-JV-1 demands
 *   NEGATIVE:   an unresolvable assessed commit (bogus SHA) fails LOUD, `result.ok === false`,
 *               naming the commit — never silently treated as an absent path
 *   BOUNDARY:   a finding declaring TWO paths (one absent, one present) is withdrawn
 *               WHOLESALE; `failing_path` is the FIRST absent path in encounter order; BOTH
 *               paths are tallied individually in `paths_verified`
 *   ERROR:      `paths: []` (a finding naming no file path at all) is always kept and
 *               contributes nothing to any tally
 *   STATE:      no `diffSource` supplied at all — TODAY's actual production state (neither
 *               `commands/assess.ts` nor MCP `tools.ts` thread it through yet) — every
 *               declared path is recorded `unchecked`, NEVER silently "verified", and no
 *               finding is withdrawn
 *   REGRESSION: `overall_score` survives byte-identical across TWO withdrawn-plus-kept
 *               findings with an unmistakable, non-default score value
 *
 * @spec_ref AC-JV-1
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, unlinkSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { AIProviderService } from "../../../src/service/ai-provider-service.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { InMemoryAIProvider } from "../../../src/ai/in-memory-provider.js";
import type { AIProvider, CreateDocInput, PlanBundle, Telemetry, TelemetryEvent } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

const DEFAULT_BUDGETS = { max_plan_chars: 8000, max_spec_chars: 12000, max_task_chars: 4000, max_diff_chars: 24000 };

function makeAssessService(provider: InMemoryAIProvider): AIProviderService {
  const telemetry: Telemetry = { record: (_e: TelemetryEvent) => {}, emit: () => {}, close: () => {} };
  const providers = new Map([[provider.name, provider]]) as unknown as ReadonlyMap<string, AIProvider>;
  return new AIProviderService(providers, provider.name, {}, telemetry, false, 8000, DEFAULT_BUDGETS);
}

async function makeBundle(store: InMemoryStore): Promise<PlanBundle> {
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const planResult = await corpusService.create({
    type: "plan",
    title: "Path Verification Plan",
    content: "Plan goals.",
  } as CreateDocInput);
  if (!planResult.ok) throw new Error("plan create failed");

  const taskResult = await corpusService.create({
    type: "task",
    title: "Path Verification Task",
    parent_id: planResult.value.id,
    content: "task body",
    extra: { plan_id: planResult.value.id },
  } as CreateDocInput);
  if (!taskResult.ok) throw new Error("task create failed");

  const bundleResult = await corpusService.getPlanBundle(planResult.value.id);
  if (!bundleResult.ok) throw new Error("getPlanBundle failed");
  return bundleResult.value;
}

function judgeResponseWithGaps(overallScore: number, typedGaps: unknown[]): string {
  return JSON.stringify({
    verdict: "partially_met",
    overall_score: overallScore,
    ac_scores: [],
    gaps: [],
    recommendations: [],
    typed_gaps: typedGaps,
  });
}

function git(cwd: string, args: string): string {
  return execSync(`git ${args}`, { cwd, encoding: "utf8" }).trim();
}

// ─── Real throwaway git repo fixture ───────────────────────────────────────────
//
// commit1: "kept.ts" created with content "v1".
// commit2: "kept.ts" modified to "v2" (the assessed commit's TIP for every "explicit_diff"
//   diffSource below). "never-existed.ts" is never committed at either commit.

let repoRoot: string;
let commit1: string;
let commit2: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "lore-path-verify-test-"));
  git(repoRoot, "init -q");
  git(repoRoot, "config user.email test@example.com");
  git(repoRoot, "config user.name Test");
  git(repoRoot, "config commit.gpgsign false");

  writeFileSync(join(repoRoot, "kept.ts"), "v1\n");
  git(repoRoot, "add kept.ts");
  git(repoRoot, "commit -q -m c1");
  commit1 = git(repoRoot, "rev-parse HEAD");

  writeFileSync(join(repoRoot, "kept.ts"), "v2\n");
  git(repoRoot, "add kept.ts");
  git(repoRoot, "commit -q -m c2");
  commit2 = git(repoRoot, "rev-parse HEAD");
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe("AC-JV-1: assess findings are path-verified against the ASSESSED commit", () => {
  it("HAPPY: all three outcomes in ONE oracle run — (a) an absent-at-commit path is withdrawn and recorded, (b) a path present at the commit but deleted from the worktree is KEPT, (c) overall_score is untouched", async () => {
    // (b)'s setup — kept.ts exists at commit2's tree but is deleted from the actual
    // worktree BEFORE assessPlan ever runs. Never committed as a deletion.
    unlinkSync(join(repoRoot, "kept.ts"));

    const store = actedStore(new InMemoryStore());
    const bundle = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "sequence",
      responses: [
        {
          kind: "ok",
          content: judgeResponseWithGaps(77, [
            {
              dimension: "outcome",
              severity: "major",
              statement: "never-existed.ts is missing test coverage.",
              paths: ["never-existed.ts"],
            },
            {
              dimension: "scope_fidelity",
              severity: "minor",
              statement: "kept.ts has a subtle formatting issue.",
              paths: ["kept.ts"],
            },
          ]),
        },
      ],
    });
    const service = makeAssessService(provider);

    const result = await service.assessPlan(bundle, {
      commitDerivationUnverifiable: false,
      diffSource: { mode: "explicit_diff", range: `${commit1}..${commit2}` },
      repoRoot,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // (a): the absent-path finding is withdrawn, not scored, and recorded verbatim.
    expect(result.value.unverifiable_findings).toHaveLength(1);
    expect(result.value.unverifiable_findings?.[0]?.statement).toBe("never-existed.ts is missing test coverage.");
    expect(result.value.unverifiable_findings?.[0]?.failing_path).toBe("never-existed.ts");
    expect(result.value.unverifiable_findings?.[0]?.checked_against_commit).toBe(commit2);

    // (b): the present-at-commit-but-deleted-from-worktree finding is KEPT.
    expect(result.value.typed_gaps).toHaveLength(1);
    expect(result.value.typed_gaps?.[0]?.statement).toBe("kept.ts has a subtle formatting issue.");

    expect(result.value.paths_verified).toEqual({ checked: 1, unverifiable: 1, unchecked: 0 });

    // (c): overall_score is exactly what the judge emitted.
    expect(result.value.overall_score).toBe(77);
  });

  it("NEGATIVE: an unresolvable assessed commit fails LOUD naming the commit — never silently read as an absent path", async () => {
    const bogusCommit = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    const store = actedStore(new InMemoryStore());
    const bundle = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "sequence",
      responses: [
        {
          kind: "ok",
          content: judgeResponseWithGaps(50, [
            { dimension: "outcome", severity: "major", statement: "some finding.", paths: ["kept.ts"] },
          ]),
        },
      ],
    });
    const service = makeAssessService(provider);

    const result = await service.assessPlan(bundle, {
      commitDerivationUnverifiable: false,
      diffSource: { mode: "explicit_diff", range: `${commit1}..${bogusCommit}` },
      repoRoot,
    });

    // reason: the discriminating assertion is `result.ok === false` — a broken
    // implementation that conflated "commit unresolvable" with "path absent" would return
    // `ok: true` with the finding silently withdrawn instead of failing the whole call.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    const message = "message" in result.error ? result.error.message : "";
    expect(message).toContain(bogusCommit);
    expect(message.toLowerCase()).toContain("could not be resolved");
  });

  it("BOUNDARY: a finding declaring TWO paths (one absent, one present at the commit) is withdrawn WHOLESALE; failing_path is the FIRST absent path in encounter order; both paths are tallied individually", async () => {
    const store = actedStore(new InMemoryStore());
    const bundle = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "sequence",
      responses: [
        {
          kind: "ok",
          content: judgeResponseWithGaps(60, [
            {
              dimension: "outcome",
              severity: "major",
              statement: "mixed finding naming two paths.",
              paths: ["never-existed.ts", "kept.ts"],
            },
          ]),
        },
      ],
    });
    const service = makeAssessService(provider);

    const result = await service.assessPlan(bundle, {
      commitDerivationUnverifiable: false,
      diffSource: { mode: "explicit_diff", range: `${commit1}..${commit2}` },
      repoRoot,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.typed_gaps ?? []).toHaveLength(0);
    expect(result.value.unverifiable_findings).toHaveLength(1);
    expect(result.value.unverifiable_findings?.[0]?.failing_path).toBe("never-existed.ts");
    // reason: BOTH paths are tallied — 1 checked (kept.ts existed) AND 1 unverifiable
    // (never-existed.ts did not) — even though the finding itself is withdrawn wholesale.
    expect(result.value.paths_verified).toEqual({ checked: 1, unverifiable: 1, unchecked: 0 });
  });

  it("ERROR: a finding declaring NO path at all (paths: []) is always kept and contributes nothing to any tally", async () => {
    const store = actedStore(new InMemoryStore());
    const bundle = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "sequence",
      responses: [
        {
          kind: "ok",
          content: judgeResponseWithGaps(65, [
            { dimension: "outcome", severity: "minor", statement: "no file path named here.", paths: [] },
          ]),
        },
      ],
    });
    const service = makeAssessService(provider);

    const result = await service.assessPlan(bundle, {
      commitDerivationUnverifiable: false,
      diffSource: { mode: "explicit_diff", range: `${commit1}..${commit2}` },
      repoRoot,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.typed_gaps).toHaveLength(1);
    expect(result.value.unverifiable_findings ?? []).toHaveLength(0);
    expect(result.value.paths_verified).toEqual({ checked: 0, unverifiable: 0, unchecked: 0 });
  });

  it("STATE: no diffSource supplied at all — TODAY's actual production wiring (neither commands/assess.ts nor MCP tools.ts thread it through yet) — every declared path is recorded 'unchecked', never silently 'verified', and nothing is withdrawn", async () => {
    const store = actedStore(new InMemoryStore());
    const bundle = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "sequence",
      responses: [
        {
          kind: "ok",
          content: judgeResponseWithGaps(42, [
            { dimension: "outcome", severity: "minor", statement: "some finding.", paths: ["never-existed.ts"] },
          ]),
        },
      ],
    });
    const service = makeAssessService(provider);

    // reason: opts.diffSource is deliberately OMITTED — mirrors every real `lore assess`
    // call today (see ai-provider-service.ts's own JSDoc on opts.diffSource).
    const result = await service.assessPlan(bundle, { repoRoot: process.cwd(), commitDerivationUnverifiable: false });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.typed_gaps).toHaveLength(1);
    expect(result.value.unverifiable_findings ?? []).toHaveLength(0);
    expect(result.value.paths_verified).toEqual({ checked: 0, unverifiable: 0, unchecked: 1 });
    expect(result.value.overall_score).toBe(42);
  });

  it("REGRESSION (clause c, restated with an unmistakable score value): overall_score survives BYTE-IDENTICAL across two withdrawn-plus-kept findings — never recomputed from the surviving count", async () => {
    const store = actedStore(new InMemoryStore());
    const bundle = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "sequence",
      responses: [
        {
          kind: "ok",
          content: judgeResponseWithGaps(13, [
            { dimension: "outcome", severity: "blocker", statement: "withdrawn one.", paths: ["never-existed.ts"] },
            { dimension: "scope_fidelity", severity: "minor", statement: "kept one.", paths: ["kept.ts"] },
          ]),
        },
      ],
    });
    const service = makeAssessService(provider);

    const result = await service.assessPlan(bundle, {
      commitDerivationUnverifiable: false,
      diffSource: { mode: "explicit_diff", range: `${commit1}..${commit2}` },
      repoRoot,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // reason: 13 is not derivable from any plausible "recompute over surviving findings"
    // formula (1 kept out of 2, 50%, etc.) — a re-derivation bug would produce a DIFFERENT
    // number, not coincidentally also land on 13.
    expect(result.value.overall_score).toBe(13);
    expect(result.value.unverifiable_findings).toHaveLength(1);
    expect(result.value.typed_gaps).toHaveLength(1);
  });
});
