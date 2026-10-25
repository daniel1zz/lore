/**
 * Internal writers keep their code-set identities when the run is the only caller identity.
 *
 * @spec_ref spec-run-only-write-identity-and-run-end-claim-release#AC-ROI-9
 *   spec-run-only-write-identity-and-run-end-claim-release Scope 2 ("lore's internal writer identities");
 *   BR-1032 (`baseline-attribute-work-to-a-run`).
 *
 * Both identities are set in code and are not caller input:
 *   - the AI judge records `ai:<provider>:<model>:<prompt_version>` (`formatJudgeActor`, via `JudgmentService.record`);
 *   - a write with no invoking actor records the literal `system` (`PhaseService.writePhases`).
 * Each is written through a store wrapped by `withWriteContext` whose invocation identity names a DIFFERENT
 * caller and carries a registered run, so a regression that let the invocation identity overwrite the
 * internal identity would surface as that caller's name. The judge is a scripted `InMemoryAIProvider`;
 * no real model is called. Real SQLite store in an mkdtemp dir (never the repo's `.lore/`).
 *
 * Coverage: HAPPY (judge row, system row) / NEGATIVE (caller name never leaks into either row) /
 * STATE (run still stamped on the row while the actor stays internal) / REGRESSION (internal rows carry no
 * `name_source`, so they never read as a caller identity source).
 */

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NoOpTelemetry, runDeterministicChecks } from "@lore/core";
import type { AIProvider, CreateDocInput, DocRecord } from "@lore/core";
import { InMemoryAIProvider } from "../../src/ai/in-memory-provider.js";
import { AIProviderService } from "../../src/service/ai-provider-service.js";
import { CorpusService } from "../../src/service/corpus-service.js";
import { GateEnforcer } from "../../src/service/gate-enforcer.js";
import { JudgmentService } from "../../src/service/judgment-service.js";
import { PhaseService } from "../../src/service/phase-service.js";
import { RecordLockService } from "../../src/service/record-lock-service.js";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import type { StoreInterface } from "../../src/store/store-interface.js";
import { withWriteContext } from "../../src/store/write-context-store.js";
import { actedStore } from "../live-invocation.js";

const CALLER = "agent:caller-not-internal";
const RUN = "cc:internal-writers-run";
const JUDGE_JSON = JSON.stringify({
  decision: "approve",
  confidence: 0.9,
  reasons: [{ dimension: "completeness", finding: "ok" }],
  blocking_questions: [],
});

const scratch: string[] = [];
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

interface Fixture {
  readonly store: StoreInterface;
  readonly corpus: CorpusService;
  readonly lock: RecordLockService;
}

/** A real SQLite store in a temp dir, wrapped so every write carries CALLER's invocation identity and RUN. */
function openFixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "run-only-internal-"));
  scratch.push(dir);
  const raw = actedStore(new SQLiteStore(join(dir, "lore.db")));
  const store = withWriteContext(raw, { identity: { harnessRun: RUN as never, claimed: CALLER, claimedSource: "session" } });
  const lock = new RecordLockService(store, new GateEnforcer(undefined));
  return { store, corpus: new CorpusService(store, lock), lock };
}

async function createDoc(corpus: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const r = await corpus.create(input);
  if (!r.ok) throw new Error(`fixture create ${input.type} failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

describe("spec-run-only-write-identity-and-run-end-claim-release#AC-ROI-9 internal writers keep their code-set identities", () => {
  it("HAPPY: an AI-judge review row records ai:claude-cli:* and its audit row names the judge, not the caller", async () => {
    const { store, corpus } = openFixture();
    await createDoc(corpus, { type: "prd", title: "Root", content: "root" } as CreateDocInput);
    const spec = await createDoc(corpus, { type: "spec", title: "Spec", content: "## Acceptance Criteria\n\nx\n" } as CreateDocInput);
    const bundle = await corpus.getReviewBundle(spec.id);
    if (!bundle.ok) throw new Error("getReviewBundle failed");

    const provider = new InMemoryAIProvider("claude-cli", { kind: "ok", content: JUDGE_JSON });
    const providers = new Map([[provider.name, provider]]) as unknown as ReadonlyMap<string, AIProvider>;
    const ai = new AIProviderService(providers, provider.name, {}, new NoOpTelemetry(), false, 8000, {
      max_diff_chars: 24000,
    });
    const judged = await ai.judgeDoc(bundle.value, runDeterministicChecks(bundle.value), {});
    if (!judged.ok) throw new Error(`stub judge failed: ${JSON.stringify(judged.error)}`);

    const recorded = await new JudgmentService(store, new NoOpTelemetry()).record(judged.value);
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;

    expect(recorded.value.created_by).toMatch(/^ai:claude-cli:/);
    expect(recorded.value.created_by).not.toContain(CALLER);
    const audit = await store.queryAudit({ doc_id: spec.id, action: "judge" });
    if (!audit.ok) throw new Error("queryAudit failed");
    expect(audit.value).toHaveLength(1);
    const row = audit.value[0]!;
    expect(row.actor).toBe(recorded.value.created_by);
    expect(row.actor).toMatch(/^ai:claude-cli:/);
    // STATE: the invocation's run is still stamped on the row; only the actor stays internal.
    expect(row.harness_run).toBe(RUN);
    // REGRESSION: an internal identity is not a caller identity source.
    expect(row.details?.["name_source"]).toBeUndefined();
  });

  it("HAPPY: a write with no invoking actor records the literal `system` in version and audit rows", async () => {
    const { store, corpus, lock } = openFixture();
    await createDoc(corpus, { type: "prd", title: "Root", content: "root" } as CreateDocInput);
    const plan = await createDoc(corpus, { type: "plan", title: "Plan", content: "plan" } as CreateDocInput);

    const added = await new PhaseService(store, lock).addPhase(plan.id, "build");
    expect(added.ok).toBe(true);

    const versions = await store.findVersions(plan.id, { limit: 5 });
    if (!versions.ok) throw new Error("findVersions failed");
    const phaseVersion = versions.value.find((v) => v.created_by === "system");
    expect(phaseVersion).toBeDefined();
    expect(phaseVersion?.harness_run).toBe(RUN);

    const audit = await store.queryAudit({ doc_id: plan.id, action: "update" });
    if (!audit.ok) throw new Error("queryAudit failed");
    const systemRows = audit.value.filter((a) => a.actor === "system");
    expect(systemRows).toHaveLength(1);
    expect(systemRows[0]!.actor).not.toBe(CALLER);
    expect(systemRows[0]!.details?.["name_source"]).toBeUndefined();
  });
});
