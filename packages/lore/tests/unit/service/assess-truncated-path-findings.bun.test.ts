/**
 * AC-CRIT-3 (spec-close-the-eight-verified-critical-defects-no-judge-listing, F2) — a
 * finding on a file the judge NEVER saw (wholly omitted from the diff by file-boundary
 * truncation) is unverifiable, not scored: it moves to `unverifiable_findings[]` with
 * reason `not-shown-to-judge`, is counted in `paths_verified.not_shown` (NOT in
 * `paths_verified.unverifiable`, which keeps meaning "absent at the commit"), and is absent
 * from `typed_gaps`. A finding on a shown file, or on the head-truncated file (partially
 * shown), stays scored. Drives `AIProviderService.assessPlan` end-to-end against a real
 * throwaway repository.
 *
 * Six-dimension coverage: HAPPY (omitted-file finding withdrawn, shown-file finding kept),
 * STATE (no diffSource: still withdrawn), BOUNDARY (head-truncated file counts as shown),
 * REGRESSION (no truncation: nothing moved, not_shown 0), NEGATIVE (head-truncated and shown
 * findings never land in unverifiable_findings), ERROR (not applicable: no new failure mode
 * is introduced; commit-resolution failure is covered by assess-path-verification).
 *
 * @spec_ref AC-CRIT-3
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { AIProviderService } from "../../../src/service/ai-provider-service.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { InMemoryAIProvider } from "../../../src/ai/in-memory-provider.js";
import type { AIProvider, CreateDocInput, PlanBundle, Telemetry, TelemetryEvent } from "@lore/core";

const WIDE_BUDGETS = { max_plan_chars: 8000, max_spec_chars: 12000, max_task_chars: 4000, max_diff_chars: 24000 };
const NARROW_BUDGETS = { max_plan_chars: 8000, max_spec_chars: 12000, max_task_chars: 4000, max_diff_chars: 700 };

function makeService(
  provider: InMemoryAIProvider,
  budgets: typeof WIDE_BUDGETS,
): AIProviderService {
  const telemetry: Telemetry = { record: (_e: TelemetryEvent) => {}, emit: () => {}, close: () => {} };
  const providers = new Map([[provider.name, provider]]) as unknown as ReadonlyMap<string, AIProvider>;
  return new AIProviderService(providers, provider.name, {}, telemetry, false, 8000, budgets);
}

async function makeBundle(store: InMemoryStore): Promise<PlanBundle> {
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const planResult = await corpusService.create({
    type: "plan",
    title: "Not Shown Plan",
    content: "Plan goals.",
  } as CreateDocInput);
  if (!planResult.ok) throw new Error("plan create failed");
  const taskResult = await corpusService.create({
    type: "task",
    title: "Not Shown Task",
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

function runGit(cwd: string, args: string): string {
  return execSync(`git ${args}`, { cwd, encoding: "utf8" }).trim();
}

function diffChunk(path: string, lines: number): string {
  const body = Array.from({ length: lines }, (_, i) => `+line ${i} of ${path}`).join("\n");
  return `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines} @@\n${body}\n`;
}

function finding(path: string, statement: string): Record<string, unknown> {
  return { dimension: "outcome", severity: "major", statement, paths: [path] };
}

let repoRoot: string;
let commit1: string;
let commit2: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "lore-not-shown-test-"));
  runGit(repoRoot, "init -q");
  runGit(repoRoot, "config user.email test@example.com");
  runGit(repoRoot, "config user.name Test");
  runGit(repoRoot, "config commit.gpgsign false");
  mkdirSync(join(repoRoot, "src"));
  writeFileSync(join(repoRoot, "README.md"), "r\n");
  runGit(repoRoot, "add README.md");
  runGit(repoRoot, "commit -q -m c1");
  commit1 = runGit(repoRoot, "rev-parse HEAD");
  for (const f of ["src/shown.ts", "src/a.ts", "src/b.ts"]) writeFileSync(join(repoRoot, f), "x\n");
  runGit(repoRoot, "add src");
  runGit(repoRoot, "commit -q -m c2");
  commit2 = runGit(repoRoot, "rev-parse HEAD");
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe("AC-CRIT-3: findings on files the judge never saw are unverifiable, not scored", () => {
  // src/shown.ts (small) fits the 700-char budget; src/a.ts and src/b.ts (larger) are dropped whole.
  const diffText = diffChunk("src/shown.ts", 3) + diffChunk("src/a.ts", 40) + diffChunk("src/b.ts", 40);

  it("HAPPY: finding on an omitted file moves to unverifiable_findings (not-shown-to-judge), counted in not_shown, absent from typed_gaps; shown-file finding stays scored", async () => {
    const bundle = await makeBundle(new InMemoryStore());
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "sequence",
      responses: [
        {
          kind: "ok",
          content: judgeResponseWithGaps(64, [
            finding("src/a.ts", "a.ts lacks error handling."),
            finding("src/shown.ts", "shown.ts has a naming issue."),
          ]),
        },
      ],
    });
    const result = await makeService(provider, NARROW_BUDGETS).assessPlan(bundle, {
      commitDerivationUnverifiable: false,
      diffText,
      diffSource: { mode: "explicit_diff", range: `${commit1}..${commit2}` },
      repoRoot,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.judgment?.truncated).toContain("diff:src/a.ts");

    expect(result.value.unverifiable_findings).toHaveLength(1);
    expect(result.value.unverifiable_findings?.[0]?.statement).toBe("a.ts lacks error handling.");
    expect(result.value.unverifiable_findings?.[0]?.reason).toBe("not-shown-to-judge");
    expect(result.value.typed_gaps?.map((g) => g.statement)).toEqual(["shown.ts has a naming issue."]);
    expect(result.value.paths_verified?.not_shown).toBe(1);
    // src/a.ts EXISTS at the commit, so it must NOT be tallied as absent.
    expect(result.value.paths_verified?.unverifiable).toBe(0);
    expect(result.value.overall_score).toBe(64);
  });

  it("STATE: withdrawal applies even with NO diffSource (paths unchecked) — judge visibility needs no git referent", async () => {
    const bundle = await makeBundle(new InMemoryStore());
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "sequence",
      responses: [{ kind: "ok", content: judgeResponseWithGaps(50, [finding("src/b.ts", "b.ts is wrong.")]) }],
    });
    const result = await makeService(provider, NARROW_BUDGETS).assessPlan(bundle, { repoRoot: process.cwd(),
      commitDerivationUnverifiable: false,
      diffText,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.unverifiable_findings?.[0]?.reason).toBe("not-shown-to-judge");
    expect(result.value.typed_gaps ?? []).toHaveLength(0);
    expect(result.value.paths_verified?.not_shown).toBe(1);
  });

  it("BOUNDARY: the head-truncated file counts as shown — its finding stays in typed_gaps", async () => {
    const bundle = await makeBundle(new InMemoryStore());
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "sequence",
      responses: [{ kind: "ok", content: judgeResponseWithGaps(70, [finding("src/big.ts", "big.ts is wrong.")]) }],
    });
    const result = await makeService(provider, NARROW_BUDGETS).assessPlan(bundle, { repoRoot: process.cwd(),
      commitDerivationUnverifiable: false,
      diffText: diffChunk("src/big.ts", 200),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.judgment?.truncated).toContain("diff:src/big.ts");
    expect(result.value.typed_gaps?.map((g) => g.statement)).toEqual(["big.ts is wrong."]);
    expect(result.value.unverifiable_findings).toBeUndefined();
    expect(result.value.paths_verified?.not_shown).toBeUndefined();
  });

  it("REGRESSION: no truncation at all — nothing is moved, not_shown is 0", async () => {
    const bundle = await makeBundle(new InMemoryStore());
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "sequence",
      responses: [{ kind: "ok", content: judgeResponseWithGaps(70, [finding("src/a.ts", "a.ts is wrong.")]) }],
    });
    const result = await makeService(provider, WIDE_BUDGETS).assessPlan(bundle, { repoRoot: process.cwd(),
      commitDerivationUnverifiable: false,
      diffText: diffChunk("src/a.ts", 3),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.typed_gaps).toHaveLength(1);
    expect(result.value.paths_verified?.not_shown).toBeUndefined();
  });
});
