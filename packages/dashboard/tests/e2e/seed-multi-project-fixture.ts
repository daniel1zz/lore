/**
 * Fixture-only helper — seeds distinguishable, gate-conformant content directly into
 * TWO throwaway corpora (project-a, project-b) for the SPEC-078 T11 multi-project e2e
 * suite. Mirrors `seed-execution-fixture.ts`'s pattern: a separate `bun` process opening
 * each SQLite file directly via `CorpusService` (bare constructor — no `GateEnforcer`,
 * per this codebase's "Optional DI: bare `new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)))` test constructions
 * stay ungated" convention), so seeding never has to satisfy the spec-create gate itself
 * (that gate is exercised for REAL through the running server in
 * `multi-project-writes.spec.ts`, which POSTs through the HTTP layer instead).
 *
 * Each project gets:
 *   - a root PRD (legal parent for a future spec-create call against that project)
 *   - a "marker" task with content unique to that project (isolation/cache assertions
 *     grep for this exact string and must NEVER find the other project's marker)
 *   - (project A only) a DRAFT spec with a gate-conformant skeleton, ready to be
 *     approved + edited through the dashboard UI (AC-078-6's "approve + doc edit
 *     addressed to A" scenario needs an existing draft doc to act on)
 *
 * Usage: bun seed-multi-project-fixture.ts <dbPathA> <dbPathB> <runId>
 * Prints one JSON line: {a: {...}, b: {...}}.
 */
import { RecordLockService } from "../../../lore/src/service/record-lock-service.js";
import { GateEnforcer } from "../../../lore/src/service/gate-enforcer.js";
import { SQLiteStore } from "../../../lore/src/store/sqlite-store.js";
import { CorpusService } from "../../../lore/src/service/corpus-service.js";
import { formatJudgeActor, type CreateDocInput, type LoreError, type Result, type ReviewJudgment } from "@lore/core";
import { ulid } from "ulidx";

async function unwrap<T>(promise: Promise<Result<T, LoreError>>, label: string): Promise<T> {
  const result = await promise;
  if (!result.ok) {
    throw new Error(`${label} failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

interface ProjectSeed {
  prdId: string;
  prdTitle: string;
  markerTaskId: string;
  markerTaskTitle: string;
  markerContent: string;
}

interface ProjectASeed extends ProjectSeed {
  draftSpecId: string;
  draftSpecTitle: string;
}

async function seedProject(dbPath: string, label: "A" | "B", runId: string): Promise<ProjectSeed> {
  const store = new SQLiteStore(dbPath);
  const corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));

  const prdTitle = `E2E Multi-Project Root PRD ${label} ${runId}`;
  const prd = await unwrap(
    corpus.create({
      type: "prd",
      title: prdTitle,
      content: `## Overview\n\nSPEC-078 T11 fixture root PRD for project ${label}.\n`,
    } as CreateDocInput),
    `create PRD ${label}`,
  );

  const markerContent = `PROJECT-${label}-ONLY-CONTENT-${runId}`;
  const markerTaskTitle = `PROJECT-${label}-MARKER-DOC-${runId}`;
  // reason: `knowledge` (not `task` — a `task` requires a `plan` parent per
  // `PARENT_TYPE_CONTRACT`, `@lore/core`) is the marker doc's type — a PRD is a legal
  // parent for `knowledge` and it needs no extra scaffolding beyond `extra.sub_type`.
  const markerTask = await unwrap(
    corpus.create({
      type: "knowledge",
      title: markerTaskTitle,
      parent_id: prd.id,
      content: `## Marker\n\n${markerContent}\n`,
      extra: { sub_type: "reference" },
    } as CreateDocInput),
    `create marker doc ${label}`,
  );

  return {
    prdId: prd.id,
    prdTitle,
    markerTaskId: markerTask.id,
    markerTaskTitle,
    markerContent,
  };
}

async function main(): Promise<void> {
  const dbPathA = process.argv[2];
  const dbPathB = process.argv[3];
  const runId = process.argv[4];
  if (dbPathA === undefined || dbPathB === undefined || runId === undefined) {
    throw new Error("Usage: bun seed-multi-project-fixture.ts <dbPathA> <dbPathB> <runId>");
  }

  const seedA = await seedProject(dbPathA, "A", runId);
  const seedB = await seedProject(dbPathB, "B", runId);

  // Project A ONLY: a draft spec ready for the "approve + edit lands in A, B
  // byte-unchanged" isolation scenario (AC-078-6). Content already satisfies the
  // spec-create gate's `hasSkeleton` predicate (real `## ` headings) so the later
  // approve transition (a lifecycle move, not a gated create) never needs to worry
  // about skeleton content — only `lore gate spec-create`/`CorpusService._createImpl`'s
  // create-time gate reads `hasSkeleton`, and this doc is inserted directly via the
  // ungated bare CorpusService construction (see this file's header), so no gate ever
  // runs against it here; it exists purely for the UI-driven approve+edit exercise.
  const storeA = new SQLiteStore(dbPathA);
  const corpusA = new CorpusService(storeA, new RecordLockService(storeA, new GateEnforcer(undefined)));
  const draftSpecTitle = `E2E Approve Target A ${runId}`;
  const draftSpec = await unwrap(
    corpusA.create({
      type: "spec",
      title: draftSpecTitle,
      parent_id: seedA.prdId,
      content:
        "## Overview\n\nE2E multi-project isolation fixture spec (project A).\n\n## Scope\n\nApprove + edit isolation only.\n\n## Acceptance Criteria\n\n- N/A (fixture doc, not a real spec).\n",
      // reason: `ReviewService.approve`'s `spec-promote` gate (defense-in-depth,
      // enforced whenever the running App is gate-wired — which the real HTTP server
      // this fixture boots always is) requires >=1 declared `acceptance_criteria`
      // before a spec can transition draft -> approved. A script-mode AC never blocks
      // the AC-quantifiability lint (SPEC-052), so this is the simplest always-passing
      // declaration; oracle-coverage floors vacuously pass since a fresh `lore init`
      // corpus has no `workflow.verification_profiles` configured.
      extra: {
        acceptance_criteria: [
          {
            id: "AC-1",
            statement: "fixture doc — always-passing placeholder criterion",
            verify: { mode: "script", oracle: "test", command: "true" },
          },
        ],
      },
    } as CreateDocInput),
    "create draft spec A",
  );

  // BR-281: approving a spec requires an independent approve-judgment pinned to the
  // spec's CURRENT version (gate `review-judgment`). The dashboard has no UI that
  // produces one (`lore review` is CLI/MCP-only), so the fixture seeds it exactly as
  // `seed-judgment.ts` does for the single-project adjudication suite. Without it the
  // real server correctly answers 422 NO_JUDGMENT — a single project would too.
  const judge = { provider: "e2e", model: "e2e", prompt_version: "v1" };
  const judgment: ReviewJudgment = {
    id: ulid(),
    doc_id: draftSpec.id,
    doc_version: draftSpec.version,
    decision: "approve",
    confidence: 0.9,
    reasons: [{ dimension: "completeness", finding: "e2e-seeded judgment" }],
    checks: [{ check: "schema", outcome: "pass" }],
    blocking_questions: [],
    judge,
    created_at: new Date().toISOString(),
    created_by: formatJudgeActor(judge),
  };
  const inserted = await storeA.insertJudgment(judgment);
  if (!inserted.ok) throw new Error(`insertJudgment failed: ${JSON.stringify(inserted.error)}`);
  const audited = await storeA.appendAuditEntry({
    timestamp: judgment.created_at,
    actor: judgment.created_by,
    session_id: `judge-${judgment.doc_id}`,
    action: "judge",
    doc_id: judgment.doc_id,
    details: { judgment_ref: judgment.id, version: judgment.doc_version },
  });
  if (!audited.ok) throw new Error(`appendAuditEntry failed: ${JSON.stringify(audited.error)}`);

  const seedAFull: ProjectASeed = {
    ...seedA,
    draftSpecId: draftSpec.id,
    draftSpecTitle,
  };

  console.log(JSON.stringify({ a: seedAFull, b: seedB }));
}

main().catch((err: unknown) => {
  console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  process.exit(1);
});
