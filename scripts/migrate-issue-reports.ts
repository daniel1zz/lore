#!/usr/bin/env bun
/**
 * ONE-TIME (but idempotent and re-runnable) migration: create-then-PATCHes
 * the corpus's already-filed issue reports into GitHub (spec-the-defect-
 * channel-reaches-no-machine-but-its-own-github, Migration Plan P3;
 * task-skill-implement-migrate-the-12-filed-reports-with-a; AC-GI-11).
 *
 * WHY create-then-PATCH, never a single call: GitHub's REST "create an
 * issue" endpoint cannot set `state`/`state_reason` at creation time (only
 * `open` is possible) — a terminal-resolution report is filed open, then
 * immediately PATCHed closed with a `state_reason` in a second call.
 *
 * Corpus records are KEPT, never deleted or replaced: each migrated task
 * gains `extra.issue_report.github = {repo, number}` and a migration-time-
 * minted `extra.issue_report.idempotency_key`, merged into its EXISTING
 * `extra` (a read-modify-write — see `mergeIssueReportExtra` — never a
 * wholesale `extra` replace, which would silently drop `severity`/
 * `category`/`tags`/`plan_id`/etc. already stored there — CLAUDE.md's "改
 * 共享字段前先读回现值" warning).
 *
 * Public surface:
 *   - `runMigration(options)` — the ONE entry point this file's paired RED
 *     test (`packages/lore/tests/integration/cli/issue-migration.bun.test.ts`)
 *     dynamically imports and calls. Dry-run (`options.dryRun === true`)
 *     touches NEITHER `options.ghRunner` NOR `options.app` NOR
 *     `options.receiptLogPath` at all — it only counts `options.candidates`
 *     — so "zero network calls" and "no receipt-log file created" hold by
 *     construction, not by a check that could be bypassed.
 *   - `MigrationCandidate` / `RunMigrationOptions` / `DryRunPlan` /
 *     `MigrationRunResult` / `MigratedReportOutcome` / `ReconciliationEntry`
 *     — the shapes the paired RED test's own file declares independently
 *     (this file's export surface must satisfy that contract structurally;
 *     see that test's own header for why it cannot import these directly).
 *
 * Invariants:
 *   - Two-phase receipt per candidate (Risk R4, mirrors `GitHubIntakePort`):
 *     `appendIntent` BEFORE the create call; `appendOutcome` only after
 *     EVERY step for that candidate has succeeded (create, the close-PATCH
 *     when terminal, AND the corpus write-back). A candidate whose sequence
 *     fails ANYWHERE after intent is a `ReconciliationEntry`, NEVER counted
 *     in `migrated[]` — an intent with no paired outcome for the same
 *     `idempotency_key` is the reconcile signal (Risk PR-5). This is a
 *     DELIBERATE difference from `GitHubIntakePort.fileIssue` (which appends
 *     its outcome right after create, before any close): here "outcome"
 *     means "this candidate's FULL migration completed", not "the issue was
 *     created".
 *   - Exactly two `gh` calls per candidate whose `resolution` is a member of
 *     `TERMINAL_ISSUE_RESOLUTION_MEMBERS` (create + close-PATCH), exactly
 *     one for every other candidate (create only) — never a `verifyTarget`/
 *     `searchDuplicates`/`listIssues` call in the migration path itself
 *     (those are `GitHubIntakePort` ops for the live single-report filing
 *     path; reusing them here would add calls this file's own paired test
 *     counts exactly).
 *   - `gh` is invoked ONLY via the injected `GhRunner.run(...)` — this file
 *     imports zero `node:child_process` (AC-GI-7).
 *   - Concurrency-bounded (`options.concurrency`, plan default 4): a small
 *     local worker-pool (`mapWithConcurrency`), not `Promise.all` over the
 *     whole candidate list — the spec measures ~24 calls at ~4s under
 *     concurrency 4, and Scope-Alt explicitly allows concurrency 1 (serial)
 *     without blocking the plan.
 *   - The CLI entry (`import.meta.main`) resolves the migration target from
 *     `feedback.upstream.repo` (via `report-issue-wiring.ts`'s existing
 *     config-read functions) — it NEVER hardcodes a repo string (plan
 *     Invariant 5: this project's OWN tracker must never be the accidental
 *     target of code that also has test fixtures naming a dedicated
 *     `lore-e2e-target` repo).
 *
 * Side-effect class: IO (subprocess via the injected `GhRunner`; local
 * receipt-file append via `ReceiptLogV2`; corpus reads/writes via the
 * injected `App`). `runMigration` itself performs no IO of its own kind not
 * already described by those three collaborators.
 *
 * Usage:
 *   bun scripts/migrate-issue-reports.ts           # dry run (default, safe)
 *   bun scripts/migrate-issue-reports.ts --live     # performs the real migration
 *
 * Source: spec-the-defect-channel-reaches-no-machine-but-its-own-github,
 *   Migration Plan P3, Risk PR-5, AC-GI-11.
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";

import {
  assembleIssueBody,
  isIssueSeverity,
  ok,
  TERMINAL_ISSUE_RESOLUTION_MEMBERS,
  type IssueFrontMatterFields,
  type IssueResolution,
  type IssueSeverity,
  type LoreError,
  type Result,
} from "@lore/core";
import { loadConfig } from "@lore/core/node";

import { createApp, type App } from "../packages/lore/src/app.js";
import {
  isGithubUpstreamCfg,
  resolveConsumerCorpusRoot,
  resolveFeedbackUpstreamCfg,
} from "../packages/lore/src/adapters/cli/report-issue-wiring.js";
import { createNodeGhExecFile, GhRunner } from "../packages/lore/src/service/gh-runner.js";
import { ReceiptLogV2 } from "../packages/lore/src/service/receipt-log-v2.js";
import { computeIssueResolution, hasIssueReport } from "../packages/lore/src/service/issue-resolution.js";

// ─── The contract this file's paired RED test specifies ────────────────────

/** One already-filed report as migration consumes it. See this file's header. */
export interface MigrationCandidate {
  /** The corpus task doc's real id. */
  readonly taskId: string;
  /** Free-form text passed as `assembleIssueBody`'s `description` argument. */
  readonly description: string;
  readonly severity: IssueSeverity;
  readonly category: string;
  readonly tags: readonly string[];
  readonly reporterCorpus: string;
  readonly reporterRootPrd: string;
  /** Pre-computed (via `computeIssueResolution`) — this module does no resolution logic of its own. */
  readonly resolution: IssueResolution;
}

/** One report whose create-then-PATCH sequence, AND corpus write-back, all completed. */
export interface MigratedReportOutcome {
  readonly taskId: string;
  readonly idempotencyKey: string;
  readonly githubNumber: number;
  readonly closed: boolean;
  readonly stateReason?: string;
}

/** One report whose sequence did NOT fully complete — Risk PR-5's reconcile signal. */
export interface ReconciliationEntry {
  readonly taskId: string;
  readonly idempotencyKey: string;
  readonly reason: string;
}

export interface DryRunPlan {
  readonly dryRun: true;
  readonly plannedCreations: number;
  readonly plannedClosures: number;
}

export interface MigrationRunResult {
  readonly dryRun: false;
  readonly migrated: MigratedReportOutcome[];
  readonly needsReconciliation: ReconciliationEntry[];
}

export interface RunMigrationOptions {
  readonly app: App;
  readonly candidates: readonly MigrationCandidate[];
  readonly targetRepo: string;
  readonly concurrency: number;
  readonly dryRun: boolean;
  readonly ghRunner: GhRunner;
  readonly receiptLogPath: string;
}

// ─── gh api response shapes (boundary data — Zod-validated, never cast) ────

/** `gh api repos/<repo>/issues -X POST`'s response shape — only the two fields this module persists. */
const CreatedIssueSchema = z.object({ number: z.number(), html_url: z.string() }).passthrough();

/** Defensive `JSON.parse` — `gh api`'s stdout is untrusted external text. Malformed input degrades to `undefined`, never throws. */
function parseJsonSafely(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Stringifies a `LoreError` for a human-readable reconciliation/log message — mirrors `github-intake-port.ts`'s own `"message" in error` idiom. */
function describeLoreError(error: LoreError): string {
  return "message" in error ? error.message : error.code;
}

/**
 * GitHub's `state_reason` on close accepts `"completed"` or `"not_planned"`
 * (REST docs — `reopened` only applies when re-opening, not closing).
 * `fixed` is a genuine completion; every other terminal resolution
 * (`rejected`/`wontfix`/`superseded`/`duplicate`/`closed`) means "not being
 * shipped as a fix", which `not_planned` represents.
 */
function stateReasonFor(resolution: IssueResolution): string {
  return resolution === "fixed" ? "completed" : "not_planned";
}

/** `true` iff `resolution` is one of the six terminal states — the ones migration files AND immediately closes. */
function isTerminalResolution(resolution: IssueResolution): boolean {
  return (TERMINAL_ISSUE_RESOLUTION_MEMBERS as readonly string[]).includes(resolution);
}

// ─── Bounded-concurrency worker pool ────────────────────────────────────────

/**
 * Runs `worker` over `items` with at most `limit` in flight at once,
 * returning results in the SAME order as `items` (each result is written to
 * its own index regardless of completion order). A local, single-use pool
 * rather than a dependency — this repo has no `p-limit`-shaped dependency
 * today (checked before writing this), and the shape needed here is small
 * enough that adding one would be the premature-abstraction call, not this.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const boundedLimit = Math.max(1, Math.min(limit, items.length));
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runOneWorker(): Promise<void> {
    for (;;) {
      const current = nextIndex++;
      if (current >= items.length) return;
      const item = items[current] as T;
      results[current] = await worker(item, current);
    }
  }

  await Promise.all(Array.from({ length: boundedLimit }, () => runOneWorker()));
  return results;
}

// ─── Per-candidate migration ─────────────────────────────────────────────────

type CandidateOutcome =
  | { readonly kind: "migrated"; readonly outcome: MigratedReportOutcome }
  | { readonly kind: "needs_reconciliation"; readonly entry: ReconciliationEntry };

function reconciled(taskId: string, idempotencyKey: string, reason: string): CandidateOutcome {
  return { kind: "needs_reconciliation", entry: { taskId, idempotencyKey, reason } };
}

/**
 * Merges the migration's two new fields into a task's EXISTING
 * `extra.issue_report`, preserving every other key already there (and every
 * other top-level `extra` key, e.g. `plan_id`) — a read-modify-write, never
 * a wholesale replace (`CorpusService.set`'s own doc comment: "`docPatch.extra`
 * REPLACES `existing.extra` WHOLESALE").
 */
function mergeIssueReportExtra(
  existingExtra: Record<string, unknown>,
  targetRepo: string,
  githubNumber: number,
  idempotencyKey: string,
): Record<string, unknown> {
  const rawIssueReport = existingExtra["issue_report"];
  const existingIssueReport: Record<string, unknown> =
    rawIssueReport !== null && typeof rawIssueReport === "object" && !Array.isArray(rawIssueReport)
      ? (rawIssueReport as Record<string, unknown>)
      : {};

  return {
    ...existingExtra,
    issue_report: {
      ...existingIssueReport,
      github: { repo: targetRepo, number: githubNumber },
      idempotency_key: idempotencyKey,
    },
  };
}

/**
 * Runs one candidate's full sequence: mint key -> intent receipt -> create
 * issue -> close-PATCH (iff terminal) -> corpus write-back -> outcome
 * receipt. Returns a `migrated` outcome only when ALL of those succeeded;
 * any failure at any step (after the key is minted) returns a
 * `needs_reconciliation` entry instead — never throws, never leaves the
 * caller to guess which step failed (`reason` names it).
 */
async function migrateOneCandidate(
  candidate: MigrationCandidate,
  options: RunMigrationOptions,
  receipts: ReceiptLogV2,
  now: () => string,
): Promise<CandidateOutcome> {
  const idempotencyKey = randomUUID();

  const docResult = await options.app.corpusService.get(candidate.taskId);
  if (!docResult.ok) {
    return reconciled(candidate.taskId, idempotencyKey, `corpus doc unreadable before migration attempt: ${describeLoreError(docResult.error)}`);
  }
  const title = docResult.value.doc.title;

  const intentResult = receipts.appendIntent({ idempotency_key: idempotencyKey, title, at: now() });
  if (!intentResult.ok) {
    return reconciled(candidate.taskId, idempotencyKey, `local intent receipt failed BEFORE any network call: ${describeLoreError(intentResult.error)}`);
  }

  const fields: IssueFrontMatterFields = {
    severity: candidate.severity,
    category: candidate.category,
    tags: [...candidate.tags],
    reporter_corpus: candidate.reporterCorpus,
    reporter_root_prd: candidate.reporterRootPrd,
    idempotency_key: idempotencyKey,
  };
  const body = assembleIssueBody(fields, candidate.description);

  const createResult = await options.ghRunner.run([
    "api",
    `repos/${options.targetRepo}/issues`,
    "-X",
    "POST",
    "-f",
    `title=${title}`,
    "-f",
    `body=${body}`,
  ]);
  if (!createResult.ok) {
    return reconciled(candidate.taskId, idempotencyKey, `issue creation failed: ${describeLoreError(createResult.error)}`);
  }

  const createdParsed = CreatedIssueSchema.safeParse(parseJsonSafely(createResult.value.stdout));
  if (!createdParsed.success) {
    return reconciled(candidate.taskId, idempotencyKey, `issue creation returned an unparsable payload: ${createdParsed.error.message}`);
  }
  const githubNumber = createdParsed.data.number;
  const url = createdParsed.data.html_url;

  const terminal = isTerminalResolution(candidate.resolution);
  let closed = false;
  let stateReason: string | undefined;

  if (terminal) {
    stateReason = stateReasonFor(candidate.resolution);
    const closeResult = await options.ghRunner.run([
      "api",
      `repos/${options.targetRepo}/issues/${githubNumber}`,
      "-X",
      "PATCH",
      "-f",
      "state=closed",
      "-f",
      `state_reason=${stateReason}`,
    ]);
    if (!closeResult.ok) {
      return reconciled(
        candidate.taskId,
        idempotencyKey,
        `issue #${githubNumber} created but the closing PATCH failed: ${describeLoreError(closeResult.error)}`,
      );
    }
    closed = true;
  }

  const mergedExtra = mergeIssueReportExtra(docResult.value.doc.extra, options.targetRepo, githubNumber, idempotencyKey);
  const setResult = await options.app.corpusService.set(candidate.taskId, { extra: mergedExtra });
  if (!setResult.ok) {
    return reconciled(
      candidate.taskId,
      idempotencyKey,
      `issue #${githubNumber} created${closed ? " and closed" : ""} but the corpus write-back failed: ${describeLoreError(setResult.error)}`,
    );
  }

  const outcomeResult = receipts.appendOutcome({ idempotency_key: idempotencyKey, number: githubNumber, url, at: now() });
  if (!outcomeResult.ok) {
    return reconciled(
      candidate.taskId,
      idempotencyKey,
      `issue #${githubNumber} created${closed ? " and closed" : ""} and corpus updated, but the local outcome receipt failed: ${describeLoreError(outcomeResult.error)}`,
    );
  }

  return {
    kind: "migrated",
    outcome: {
      taskId: candidate.taskId,
      idempotencyKey,
      githubNumber,
      closed,
      ...(stateReason !== undefined ? { stateReason } : {}),
    },
  };
}

// ─── The one entry point the paired RED test dynamically imports ───────────

/**
 * Dry-run (`options.dryRun === true`) touches neither `options.ghRunner` nor
 * `options.app` nor `options.receiptLogPath` — it only counts
 * `options.candidates` — so "zero network calls" and "no receipt-log file
 * created" hold structurally. A live run migrates every candidate under a
 * bounded worker pool and partitions the results into `migrated` /
 * `needsReconciliation` — see `migrateOneCandidate` for the per-candidate
 * sequence and failure semantics.
 */
export async function runMigration(options: RunMigrationOptions): Promise<DryRunPlan | MigrationRunResult> {
  if (options.dryRun) {
    const plannedCreations = options.candidates.length;
    const plannedClosures = options.candidates.filter((c) => isTerminalResolution(c.resolution)).length;
    return { dryRun: true, plannedCreations, plannedClosures };
  }

  const receipts = new ReceiptLogV2(options.receiptLogPath);
  const now = (): string => new Date().toISOString();

  const outcomes = await mapWithConcurrency(options.candidates, options.concurrency, (candidate) =>
    migrateOneCandidate(candidate, options, receipts, now),
  );

  const migrated: MigratedReportOutcome[] = [];
  const needsReconciliation: ReconciliationEntry[] = [];
  for (const outcome of outcomes) {
    if (outcome.kind === "migrated") {
      migrated.push(outcome.outcome);
    } else {
      needsReconciliation.push(outcome.entry);
    }
  }

  return { dryRun: false, migrated, needsReconciliation };
}

// ─── CLI entry: gathers REAL candidates from the corpus, defaults to dry-run ─

/** Filename for this migration's OWN receipt log — distinct from the live single-report filing path's `issue-receipts-v2.jsonl`, so a migration run's receipts never interleave with day-to-day `lore report-issue` filings. */
const MIGRATION_RECEIPT_LOG_FILENAME = "issue-migration-receipts-v2.jsonl";

/** Plan-declared default (spec's Migration Plan P3: "concurrency 4"). */
const MIGRATION_CONCURRENCY = 4;

interface SkippedCandidate {
  readonly taskId: string;
  readonly reason: string;
}

/**
 * Gathers every corpus task that already carries `extra.issue_report` and
 * has NOT yet been migrated (`extra.issue_report.github` absent) into a
 * `MigrationCandidate`. FAILS LOUD per-candidate rather than fabricating: a
 * report missing one of the four fields `assembleIssueBody` requires
 * (`severity`/`category`/`tags`/`reporter_corpus`/`reporter_root_prd`) is
 * excluded and named in `skipped`, never defaulted — a legacy-shaped report
 * filed before `frontMatterCodec` existed may lack these, and guessing a
 * value would assert a fact nobody declared.
 *
 * Mirrors `commands/issues.ts::readLocalRows`'s established read pattern
 * (`listFull` for the candidate scan, one `get()` per candidate for its
 * `resolves` in-edges) rather than inventing a second one.
 */
async function gatherMigrationCandidates(
  app: App,
): Promise<Result<{ candidates: MigrationCandidate[]; skipped: SkippedCandidate[] }, string>> {
  const listResult = await app.corpusService.listFull({ type: "task" });
  if (!listResult.ok) {
    return { ok: false, error: `could not list corpus tasks: ${describeLoreError(listResult.error)}` };
  }

  const candidates: MigrationCandidate[] = [];
  const skipped: SkippedCandidate[] = [];

  for (const summary of listResult.value.docs) {
    if (!hasIssueReport(summary.extra)) continue;
    const issueReport = summary.extra["issue_report"] as Record<string, unknown>;
    if (issueReport["github"] !== undefined) continue; // already migrated — idempotent re-run

    const getResult = await app.corpusService.get(summary.id);
    if (!getResult.ok) {
      skipped.push({ taskId: summary.id, reason: `corpus doc unreadable during candidate scan: ${describeLoreError(getResult.error)}` });
      continue;
    }
    const doc = getResult.value.doc;
    const report = (doc.extra["issue_report"] ?? {}) as Record<string, unknown>;

    const severity = report["severity"];
    const category = report["category"];
    const reporterCorpus = report["reporter_corpus"];
    const reporterRootPrd = report["reporter_root_prd"];
    const rawTags = report["tags"];
    const tags = Array.isArray(rawTags) && rawTags.every((t) => typeof t === "string") ? (rawTags as string[]) : undefined;

    const missing: string[] = [];
    if (typeof severity !== "string" || !isIssueSeverity(severity)) missing.push("severity");
    if (typeof category !== "string" || category.length === 0) missing.push("category");
    if (typeof reporterCorpus !== "string" || reporterCorpus.length === 0) missing.push("reporter_corpus");
    if (typeof reporterRootPrd !== "string" || reporterRootPrd.length === 0) missing.push("reporter_root_prd");
    if (tags === undefined) missing.push("tags");

    if (missing.length > 0) {
      skipped.push({
        taskId: doc.id,
        reason: `extra.issue_report is missing/malformed required field(s) for migration: ${missing.join(", ")}`,
      });
      continue;
    }

    const resolvesInEdges = getResult.value.navigation.related.filter((r) => r.link_type === "resolves");
    const resolution = computeIssueResolution(
      doc,
      resolvesInEdges.map((r) => ({ from_id: r.id })),
      resolvesInEdges.map((r) => ({ id: r.id, status: r.status })),
    );

    candidates.push({
      taskId: doc.id,
      description: doc.content,
      severity: severity as IssueSeverity,
      category: category as string,
      tags: tags as string[],
      reporterCorpus: reporterCorpus as string,
      reporterRootPrd: reporterRootPrd as string,
      resolution,
    });
  }

  return ok({ candidates, skipped });
}

/**
 * Resolves config, gathers real candidates, runs the migration (dry-run
 * unless `--live` is passed), prints the result as JSON, and returns the
 * process exit code — 1 on any refusal or on a live run leaving
 * reconciliation entries, 0 otherwise. Never invoked by the paired RED test
 * (which imports `runMigration` directly) — this is the production path the
 * orchestrator invokes once this task's tool is landed.
 */
async function runCli(): Promise<number> {
  const live = process.argv.includes("--live");
  const corpusRoot = resolveConsumerCorpusRoot({ cwd: process.cwd(), env: process.env });

  const configResult = loadConfig(corpusRoot);
  if (!configResult.ok) {
    process.stderr.write(`migrate-issue-reports: failed to load config at ${corpusRoot}: ${describeLoreError(configResult.error)}\n`); // CLI surface
    return 1;
  }

  const upstreamCfg = resolveFeedbackUpstreamCfg(configResult.value);
  if (upstreamCfg === undefined || !isGithubUpstreamCfg(upstreamCfg)) {
    process.stderr.write(
      "migrate-issue-reports: feedback.upstream is not configured with a GitHub 'repo' — refusing to guess a migration target.\n",
    ); // CLI surface
    return 1;
  }
  const targetRepo = upstreamCfg.repo;

  const app = createApp(join(corpusRoot, ".lore", "lore.db"));
  try {
    const gathered = await gatherMigrationCandidates(app);
    if (!gathered.ok) {
      process.stderr.write(`migrate-issue-reports: ${gathered.error}\n`); // CLI surface
      return 1;
    }
    for (const s of gathered.value.skipped) {
      process.stderr.write(`migrate-issue-reports: skipping ${s.taskId} — ${s.reason}\n`); // CLI surface
    }

    const receiptLogPath = join(corpusRoot, ".lore", MIGRATION_RECEIPT_LOG_FILENAME);
    const result = await runMigration({
      app,
      candidates: gathered.value.candidates,
      targetRepo,
      concurrency: MIGRATION_CONCURRENCY,
      dryRun: !live,
      ghRunner: new GhRunner({ execFile: createNodeGhExecFile(), env: process.env }),
      receiptLogPath,
    });

    console.log(JSON.stringify(result, null, 2)); // CLI surface
    return !result.dryRun && result.needsReconciliation.length > 0 ? 1 : 0;
  } finally {
    app.close();
  }
}

if (import.meta.main) {
  process.exitCode = await runCli();
}
