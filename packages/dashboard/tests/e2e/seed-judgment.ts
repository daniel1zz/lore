/**
 * Fixture-only helper — seeds a `review_judgments` row (plus the matching `judge`
 * audit entry) directly into the e2e throwaway corpus's SQLite file, bypassing the
 * HTTP/CLI/MCP surfaces entirely.
 *
 * Why this exists: no dashboard UI creates a review judgment (SPEC-034's `lore review`
 * is a CLI/MCP-only AI-judge invocation — the dashboard only ever READS judgments via
 * `apiGetJudgments`/`apiGetPendingReview` and WRITES calibration as a byproduct of
 * approve/reject). The triage/calibration/audit e2e scenarios need a judgment to
 * already exist before the page loads, so this script opens the SAME SQLite file the
 * running `lore serve` process has open (via `SQLiteStore`, the exact class the server
 * uses — `packages/lore/src/store/sqlite-store.ts`) and calls `insertJudgment` +
 * `appendAuditEntry` directly, mirroring exactly what `JudgmentService.record()` does
 * (`packages/lore/src/service/judgment-service.ts` — `insertJudgment` is documented
 * there as intentionally usable standalone for fixtures/tests). Run as a separate `bun`
 * process (not imported into the Playwright test process) so its `bun:sqlite` handle is
 * opened, used, and closed before the calling test proceeds — no shared-handle races
 * with the server process, which reopens the file on each statement via WAL mode.
 *
 * Usage: bun seed-judgment.ts <dbPath> <jsonPayload>
 *   jsonPayload: { docId, docVersion, decision, confidence, blockingQuestions,
 *                  reasons?, provider?, model?, promptVersion? }
 * Prints the inserted judgment's `id` to stdout on success (last line, for the caller
 * to capture); exits non-zero with the error on stdout as JSON on failure.
 */
import { ulid } from "ulidx";
import { SQLiteStore } from "../../../lore/src/store/sqlite-store.js";
import type { ReviewJudgment } from "@lore/core";
import { formatJudgeActor } from "@lore/core";

interface SeedJudgmentPayload {
  docId: string;
  docVersion: number;
  decision: "approve" | "reject" | "escalate";
  confidence: number;
  blockingQuestions: string[];
  reasons?: Array<{ dimension: string; finding: string }>;
  provider?: string;
  model?: string;
  promptVersion?: string;
}

async function main(): Promise<void> {
  const dbPath = process.argv[2];
  const payloadRaw = process.argv[3];
  if (dbPath === undefined || payloadRaw === undefined) {
    throw new Error("Usage: bun seed-judgment.ts <dbPath> <jsonPayload>");
  }
  const payload = JSON.parse(payloadRaw) as SeedJudgmentPayload;

  const judge = {
    provider: payload.provider ?? "e2e",
    model: payload.model ?? "e2e",
    prompt_version: payload.promptVersion ?? "v1",
  };

  const judgment: ReviewJudgment = {
    id: ulid(),
    doc_id: payload.docId,
    doc_version: payload.docVersion,
    decision: payload.decision,
    confidence: payload.confidence,
    reasons: payload.reasons ?? [{ dimension: "completeness", finding: "e2e-seeded judgment" }],
    checks: [{ check: "schema", outcome: "pass" }],
    blocking_questions: payload.blockingQuestions,
    judge,
    created_at: new Date().toISOString(),
    created_by: formatJudgeActor(judge),
  };

  const store = new SQLiteStore(dbPath);

  const insertResult = await store.insertJudgment(judgment);
  if (!insertResult.ok) {
    throw new Error(`insertJudgment failed: ${JSON.stringify(insertResult.error)}`);
  }

  // Mirror JudgmentService._recordImpl's audit entry exactly (action "judge",
  // details.judgment_ref + details.version) so AuditTab's judge-identity badge +
  // "View judgment" expand affordance have something real to render against.
  const auditResult = await store.appendAuditEntry({
    timestamp: judgment.created_at,
    actor: judgment.created_by,
    session_id: `judge-${judgment.doc_id}`,
    action: "judge",
    doc_id: judgment.doc_id,
    details: { judgment_ref: judgment.id, version: judgment.doc_version },
  });
  if (!auditResult.ok) {
    throw new Error(`appendAuditEntry failed: ${JSON.stringify(auditResult.error)}`);
  }

  console.log(judgment.id);
}

main().catch((err: unknown) => {
  console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  process.exit(1);
});
