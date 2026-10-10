/**
 * AC-DC-13 — the injected declared-AC port carries the full acceptance CRITERION
 * (not just its id), and the duplicate task→plan→spec traversal
 * `TaskWorkflowService.resolveAcOracleGeneration` used to carry on its own
 * (task-widen-the-declared-ac-port-to-carry-criteria-so-the) is entirely gone —
 * both the method and the doc comment that recorded the gap.
 *
 * Two halves in ONE file, per the AC:
 *
 *   (a) BEHAVIOUR — the discriminator. Inject a declared-AC port whose criterion's
 *       `oracle_generation` DIFFERS from what a real store walk over the SAME task
 *       would find, and assert the evidence stamp follows the PORT. A surviving
 *       private traversal would ignore the injected port and stamp whatever the
 *       store itself says instead — a mere "does the new method exist" check could
 *       never detect that; only disagreeing the two sources can. Covers both the
 *       plan-owned task path (`resolveDeclaredAcCriteria`) and the `--adhoc` task
 *       path (`resolveAdhocGoverningAcCriteria`).
 *
 *   (b) CENSUS — in this SAME file. A search over `packages/lore/src` and
 *       `packages/core/src` finds ZERO occurrences of the deleted method's
 *       identifier and ZERO occurrences of the residual note that used to record
 *       the gap. Both needles are built by string concatenation — never written
 *       as a contiguous literal anywhere in THIS file — and the scan roots are
 *       `src/` trees that structurally exclude this file (which lives under
 *       `packages/lore/tests/`, never under either scanned `src/` tree). Belt AND
 *       suspenders against the self-matching trap a naive census falls into: a
 *       census that matches itself can never go green, and one that scans nothing
 *       can never go red (guarded below by a positive files-scanned trace).
 *
 * @spec_ref AC-DC-13
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ok } from "@lore/core";
import type { AcceptanceCriterion, CreateDocInput, DocRecord, LoreError, Result } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";

// ─── (a) BEHAVIOUR fixtures ─────────────────────────────────────────────────

const AC_ID = "AC-PORT-1";
/** The generation a REAL store walk over the fixture would find. */
const STORE_GENERATION = 3;
/** The generation the injected port claims instead — deliberately DIFFERENT. */
const PORT_GENERATION = 97;

async function createDoc(cs: CorpusService, input: CreateDocInput): Promise<string> {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`fixture create failed: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

/** A well-formed criterion carrying the given generation — never `AC_ID`'s real, stored one. */
function criterionWithGeneration(generation: number): AcceptanceCriterion {
  return {
    id: AC_ID,
    statement: "criterion object returned by the injected port under test",
    verify: { mode: "script", oracle: "test", command: "true" },
    oracle_generation: generation,
  };
}

/** Always resolves the SAME mismatched-generation criterion, ignoring which plan/task it's asked about. */
function makeMismatchedPlanPort(): (
  planId: string,
) => Promise<Result<AcceptanceCriterion[] | null, LoreError>> {
  return async () => ok([criterionWithGeneration(PORT_GENERATION)]);
}

/** Ad-hoc sibling of {@link makeMismatchedPlanPort} — same mismatched criterion, adhoc-shaped port signature. */
function makeMismatchedAdhocPort(): (
  task: DocRecord,
) => Promise<Result<AcceptanceCriterion[], LoreError>> {
  return async () => ok([criterionWithGeneration(PORT_GENERATION)]);
}

async function readEvidenceRows(store: InMemoryStore, taskId: string): Promise<Record<string, unknown>[]> {
  const found = await store.find(taskId);
  if (!found.ok || found.value === null) throw new Error("task fetch failed");
  const raw = found.value.extra["verification_evidence"];
  return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
}

describe("AC-DC-13 · the injected declared-AC port carries criteria", () => {
  describe("(a) behaviour: the evidence stamp follows the PORT, never a store walk", () => {
    it("plan-owned task: a port criterion whose oracle_generation DIFFERS from the store's wins", async () => {
      const store = new InMemoryStore();
      const corpusService = new CorpusService(store);

      const prdId = await createDoc(corpusService, {
        type: "prd",
        title: "Port Carries Criteria PRD",
        content: "root",
      } as CreateDocInput);
      const specId = await createDoc(corpusService, {
        type: "spec",
        title: "Port Carries Criteria Spec",
        content: "spec body",
        extra: { acceptance_criteria: [criterionWithGeneration(STORE_GENERATION)] },
      } as CreateDocInput);
      const planId = await createDoc(corpusService, {
        type: "plan",
        title: "Port Carries Criteria Plan",
        parent_id: specId,
        content: "plan body",
      } as CreateDocInput);
      const taskId = await createDoc(corpusService, {
        type: "task",
        title: "Port Carries Criteria Task",
        parent_id: planId,
        content: "task body",
        extra: { plan_id: planId },
      } as CreateDocInput);

      // Sanity: confirm a REAL store walk (via the very port under test, called
      // through CorpusService directly with no mock in front) finds STORE_GENERATION —
      // proving the two numbers genuinely differ, not just by assumption.
      const storeWalk = await corpusService.resolveDeclaredAcCriteria(planId);
      if (!storeWalk.ok || storeWalk.value === null) throw new Error("fixture: no declared criteria");
      const storeCriterion = storeWalk.value.find((c) => c.id === AC_ID);
      expect(storeCriterion?.oracle_generation).toBe(STORE_GENERATION);
      expect(STORE_GENERATION).not.toBe(PORT_GENERATION);

      // The existence-check port (`resolveDeclaredAcIds`) stays REAL — it must still
      // find AC_ID declared for the write to reach the generation stamp at all. Only
      // the generation-carrying port (`resolveDeclaredAcCriteria`) is mocked.
      const taskWorkflowService = new TaskWorkflowService(
        store,
        undefined,
        { claimTtlMinutes: 120 },
        corpusService.resolveDeclaredAcIds.bind(corpusService),
        undefined,
        undefined,
        undefined,
        makeMismatchedPlanPort(),
      );

      const evidenceResult = await taskWorkflowService.addEvidence(taskId, {
        oracle: "test",
        command: "true",
        result: "expected-fail",
        recorded_by: "agent:ac-port-carries-criteria-test",
        capture_source: "self-report",
        output_tail: "red-first fixture row",
        ac_ref: AC_ID,
      });
      if (!evidenceResult.ok) {
        throw new Error(`addEvidence failed: ${JSON.stringify(evidenceResult.error)}`);
      }

      const rows = await readEvidenceRows(store, taskId);
      expect(rows).toHaveLength(1);
      // THE DISCRIMINATOR: the stamp is the PORT's generation, never the store's.
      expect(rows[0]?.["ac_oracle_generation"]).toBe(PORT_GENERATION);
      expect(rows[0]?.["ac_oracle_generation"]).not.toBe(STORE_GENERATION);
    });

    it("--adhoc task: a port criterion whose oracle_generation DIFFERS from the store's wins", async () => {
      const store = new InMemoryStore();
      const corpusService = new CorpusService(store);

      const prdId = await createDoc(corpusService, {
        type: "prd",
        title: "Port Carries Criteria Adhoc PRD",
        content: "root",
      } as CreateDocInput);
      const specId = await createDoc(corpusService, {
        type: "spec",
        title: "Port Carries Criteria Adhoc Spec",
        content: "spec body",
        extra: { acceptance_criteria: [criterionWithGeneration(STORE_GENERATION)] },
      } as CreateDocInput);
      const taskId = await createDoc(corpusService, {
        type: "task",
        title: "Port Carries Criteria Adhoc Task",
        content: "found mid-plan",
        extra: { adhoc: true, ac_scope: [AC_ID] },
      } as CreateDocInput);

      const taskFound = await store.find(taskId);
      if (!taskFound.ok || taskFound.value === null) throw new Error("fixture: adhoc task fetch failed");
      const task = taskFound.value;

      // Sanity: confirm a REAL store walk finds STORE_GENERATION for this ad-hoc task.
      const storeWalk = await corpusService.resolveDeclaredAcCriteriaForAdhocTask(task);
      if (!storeWalk.ok) throw new Error("fixture: adhoc governing criteria resolution failed");
      const storeCriterion = storeWalk.value.find((c) => c.id === AC_ID);
      expect(storeCriterion?.oracle_generation).toBe(STORE_GENERATION);
      void specId; // spec is reached only via ac_scope search, never referenced by id directly

      const taskWorkflowService = new TaskWorkflowService(
        store,
        undefined,
        { claimTtlMinutes: 120 },
        undefined,
        undefined,
        // existence-check port stays REAL for the same reason as the plan-owned case above.
        corpusService.resolveDeclaredAcIdsForAdhocTask.bind(corpusService),
        undefined,
        undefined,
        makeMismatchedAdhocPort(),
      );

      const evidenceResult = await taskWorkflowService.addEvidence(taskId, {
        oracle: "test",
        command: "true",
        result: "expected-fail",
        recorded_by: "agent:ac-port-carries-criteria-test",
        capture_source: "self-report",
        output_tail: "red-first fixture row (adhoc)",
        ac_ref: AC_ID,
      });
      if (!evidenceResult.ok) {
        throw new Error(`addEvidence failed: ${JSON.stringify(evidenceResult.error)}`);
      }

      const rows = await readEvidenceRows(store, taskId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.["ac_oracle_generation"]).toBe(PORT_GENERATION);
      expect(rows[0]?.["ac_oracle_generation"]).not.toBe(STORE_GENERATION);
    });
  });

  describe("(b) census: the deleted traversal, and the note that recorded it, are both gone", () => {
    it("packages/lore/src and packages/core/src contain neither the deleted method's identifier nor its residual note", () => {
      // reason: built by concatenation so the exact identifier/phrase never appears
      // as a contiguous literal in THIS file's own source text — see this file's
      // header comment for why that matters for a census that scans a tree.
      const deletedMethodIdentifier = "findGoverningAcceptance" + "Criteria";
      const residualNotePhrase = "BOUNDED second" + " traversal";

      const testFileDir = dirname(fileURLToPath(import.meta.url));
      // packages/lore/tests/unit/service -> repo root is FIVE levels up.
      const repoRoot = join(testFileDir, "..", "..", "..", "..", "..");
      const scanRoots = [join(repoRoot, "packages", "lore", "src"), join(repoRoot, "packages", "core", "src")];

      function walkTsFiles(dir: string): string[] {
        const found: string[] = [];
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const entryPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            found.push(...walkTsFiles(entryPath));
          } else if (entry.isFile() && entry.name.endsWith(".ts")) {
            found.push(entryPath);
          }
        }
        return found;
      }

      const scannedFiles = scanRoots.flatMap((root) => walkTsFiles(root));
      const methodHits: string[] = [];
      const noteHits: string[] = [];
      for (const filePath of scannedFiles) {
        const content = readFileSync(filePath, "utf8");
        if (content.includes(deletedMethodIdentifier)) methodHits.push(filePath);
        if (content.includes(residualNotePhrase)) noteHits.push(filePath);
      }

      // Positive trace: the walk actually visited a substantial, real tree (measured
      // at ~320 files at authoring time) — a scan silently visiting zero files would
      // vacuously satisfy both assertions below without ever having looked at anything.
      expect(scannedFiles.length).toBeGreaterThan(50);
      // Structural exclusion double-check: THIS file must never be among what a
      // correctly-scoped scan visits (it lives under packages/lore/tests/, not
      // under either src/ root) — if it ever were, the census-self-match trap
      // this file's header warns about would be live, not merely theoretical.
      expect(scannedFiles).not.toContain(fileURLToPath(import.meta.url));

      expect(methodHits).toEqual([]);
      expect(noteHits).toEqual([]);
    });
  });
});
