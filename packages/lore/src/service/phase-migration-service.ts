/**
 * PhaseMigrationService — one-shot idempotent task→phase sweep (SPEC-056 §Design
 * Decisions D6/D6a, PRD §18 P7 edge rules).
 *
 * Converts every plan's `task` docs into `phase` docs, grouped by
 * `extra.phase` (declared-phase grouping), falling back to `extra.legacy_phase`
 * (pre-SPEC-023 residue), falling back to one phase per task when neither field
 * is present. A plan's declared-but-unreferenced `extra.phases[]` entries still
 * migrate to an EMPTY phase doc (zero `migrated_from`) — P7 explicitly requires
 * this so a declared phase is never silently dropped.
 *
 * Mirrors `MigrationService`'s structural precedent (dry-run flag, raw
 * `store.insert` bypassing `CorpusService.create`'s normal validation/gate
 * path, audit rows, idempotency markers) — D6a explicitly names this the same
 * deliberate, documented, BOUNDED bypass (one-shot migration path, not a
 * steady-state write; no `phase-create` checkpoint exists to gate against, so
 * `GateEnforcer` is never consulted here, exactly like `MigrationService`'s own
 * `store.insert` bypass).
 *
 * @invariant Idempotent via TWO markers, never a separate "already migrated"
 *   ledger: (1) a source task carrying `extra.migrated_to` is treated as
 *   already-processed and excluded from every group on a re-run — this is what
 *   drives `tasks_archived`/`evidence_merged` to 0 on a second call; (2) a
 *   plan's declared phase name already present among its existing phase docs'
 *   `title`s (empty OR non-empty — a "core" phase created empty-vs-merged on a
 *   prior run must never be recreated) is skipped by the empty-declared-phase
 *   fallback. Neither check requires a dedicated migration-run ledger table —
 *   both read state the migration itself already wrote.
 * @invariant Evidence merge NEVER truncates, even past `taskExtraSchema`'s
 *   50-entry cap (D6 "never truncated" — a merge group's evidence total may
 *   legitimately exceed 50; the resulting phase doc is written via the SAME
 *   raw-insert bypass that lets `type: "phase"` itself skip
 *   `createDocInputSchema`'s validation, so the cap — enforced by
 *   `phaseExtraSchema`, a schema this service deliberately never `.parse()`s
 *   the final merged extra through — never applies to migration OUTPUT).
 *   `phaseExtraSchema` is intentionally NOT run against the constructed extra
 *   for this same reason: `evidenceEntrySchema` (unchanged by this task) has no
 *   `origin` field, so a `.parse()` would silently STRIP the migration's own
 *   provenance annotation off every merged entry (Zod's default "strip unknown
 *   keys" behavior) in addition to rejecting the >50-cap merge group.
 * @invariant Claim precedence is "newest fresh claim wins" by `at` (ISO 8601,
 *   lexicographically comparable) among every claim collected in a merge
 *   group — NOT a TTL/staleness computation (`isClaimStale` is deliberately
 *   not consulted here; a group's claims may all be TTL-stale by the time the
 *   migration runs, and the newest one still wins verbatim). Every displaced
 *   claim becomes a `track` note AND a report warning (D6/P7 "loud in the
 *   migration report") — never silently dropped.
 * @invariant `type: "phase"` is cast through `DocType` at every call site
 *   (`"phase" as unknown as DocType`) — `phase` is deliberately NOT yet a
 *   member of `@lore/core`'s `DocType` union (see `phase.ts`'s own header
 *   invariant); widening that union is a later task's file anchor, out of
 *   scope here.
 *
 * Side-effect class: IO (StoreInterface reads/writes; no filesystem, no AI)
 *
 * Source: spec-spec-056-phase-execution-model-phase-doc-type-computed-comp
 *   §Design Decisions D1, D6, D6a; §Acceptance Criteria AC-P-5.
 */

import { ulid } from "ulidx";
import { err, ok, slugifyWithCollision } from "@lore/core";
// reason: getTransliterateCjk/containsCjk (SPEC-068 D1, hotfix 2026-07-23) are
// Node-only-subpath-gated purely for the browser-safety barrel-isolation
// invariant (packages/core/src/CLAUDE.md) — this service file is always
// server-side, same precedent config-service.ts already set.
import { containsCjk, getTransliterateCjk } from "@lore/core/node";
import type {
  DocId,
  DocRecord,
  DocType,
  EvidenceEntry,
  LoreError,
  Result,
  TaskClaim,
  TrackItem,
} from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";

// ─── Public Types ───────────────────────────────────────────────────────────

/**
 * Report returned by {@link PhaseMigrationService.migrateTasks}.
 *
 *   - phases_created: total NEW phase docs written this run, INCLUDING empty
 *     declared-phase docs with zero migrated_from tasks.
 *   - tasks_archived: total SOURCE task docs processed this run (status set to
 *     "archived" + `extra.migrated_to` populated) — counts every task touched
 *     this run, regardless of its PRE-migration status.
 *   - evidence_merged: total `verification_evidence` entries written across
 *     every phase doc created this run — must equal the sum of every processed
 *     source task's pre-migration evidence array length, zero entries dropped
 *     or duplicated (D6 "never truncated").
 *   - warnings: human-readable notes, at minimum one per displaced multi-claim
 *     holder.
 */
export interface PhaseMigrationReport {
  dry_run: boolean;
  phases_created: number;
  tasks_archived: number;
  evidence_merged: number;
  warnings: string[];
}

/** Options for {@link PhaseMigrationService.migrateTasks}. */
export interface MigrateTasksOpts {
  /** When true, computes the full report but performs ZERO store writes. */
  dryRun: boolean;
}

/**
 * Progress durably committed to the store BEFORE a mid-run store failure
 * aborted {@link PhaseMigrationService.migrateTasks} (BUG-009 fix). Every count
 * here reflects docs that ACTUALLY exist post-failure — the accumulator
 * variables backing this shape are only ever incremented AFTER
 * `persistGroup`/each early lookup resolves `ok`, so a failure never double-
 * counts a group that didn't fully commit.
 */
export interface PhaseMigrationPartialProgress {
  phases_created: number;
  tasks_archived: number;
  evidence_merged: number;
}

/**
 * Error returned by {@link PhaseMigrationService.migrateTasks} on a mid-run
 * store failure (BUG-009 fix). Distinct from a bare `LoreError` so the caller
 * (CLI `lore migrate tasks-to-phases`) can report BOTH the underlying failure
 * AND how much progress already landed — critical because a caller seeing only
 * "STORE_ERROR: ..." with no partial-progress figure has no way to know the run
 * is SAFE TO RE-RUN (migrateTasks is idempotent — see this module's header
 * invariants #1/#2 — a retry skips every already-migrated task/phase and only
 * processes the remainder).
 */
export interface PhaseMigrationError {
  /** The underlying store failure that aborted the run. */
  cause: LoreError;
  /** Progress already committed before `cause` occurred — see {@link PhaseMigrationPartialProgress}. */
  partial: PhaseMigrationPartialProgress;
}

// ─── Internal Types ─────────────────────────────────────────────────────────

/** `"phase"` cast through `DocType` — see this module's header invariant. */
const PHASE_DOC_TYPE = "phase" as unknown as DocType;

/** Actor stamped on every doc/version/audit row this service writes. */
const MIGRATION_ACTOR = "system:phase-migration";

/** The subset of `task.extra` this service reads — narrower than `TaskExtra`. */
interface SourceTaskExtra {
  phase?: unknown;
  legacy_phase?: unknown;
  claim?: TaskClaim;
  verification_evidence?: EvidenceEntry[];
  file_anchors?: string[];
  migrated_to?: unknown;
}

/** One merged evidence entry — the source task's entry plus provenance (D6). */
interface MergedEvidenceEntry extends EvidenceEntry {
  origin: DocId;
}

/** One task→phase merge group, resolved before any doc is written. */
interface PhaseGroup {
  /** Unique within a plan — drives the phase doc's title (and `legacy_phase`, if set). */
  title: string;
  legacyPhase?: string;
  tasks: DocRecord[];
}

function readSourceExtra(task: DocRecord): SourceTaskExtra {
  return task.extra as SourceTaskExtra;
}

/**
 * Constructs a failed {@link PhaseMigrationReport} result carrying `cause` +
 * `partial` progress (BUG-009 fix). `@lore/core`'s `err<E extends LoreError>`
 * cannot be reused here — `PhaseMigrationError` deliberately is NOT a
 * `LoreError` itself (it WRAPS one alongside partial-progress counts), so it
 * fails that generic's `extends LoreError` constraint. This is the sole
 * construction site for this module's `err` branch, mirroring `ok`/`err`'s
 * own shape without importing a mismatched generic.
 */
function migrationErr(
  cause: LoreError,
  partial: PhaseMigrationPartialProgress,
): Result<PhaseMigrationReport, PhaseMigrationError> {
  return { ok: false, error: { cause, partial } };
}

// ─── Service ────────────────────────────────────────────────────────────────

/**
 * One-shot idempotent task→phase migration (SPEC-056 §Design Decisions
 * D6/D6a). See this module's header docstring for the full invariant set —
 * `migrateTasks` is the sole public method.
 *
 * @invariant Stateless — holds only a `StoreInterface`, mirroring every other
 *   service in this codebase; no telemetry (a one-shot migration, not a hot
 *   instrumented path, same rationale as `MigrationService`/`AuditService`).
 */
export class PhaseMigrationService {
  constructor(private readonly store: StoreInterface) {}

  async migrateTasks(opts: MigrateTasksOpts): Promise<Result<PhaseMigrationReport, PhaseMigrationError>> {
    const dryRun = opts.dryRun;

    // BUG-009 fix: these accumulators are declared BEFORE the try block (and
    // before the FIRST store call) so `partial()` can report `{0,0,0}` even on
    // the very first lookup's failure, and so the catch block (a thrown, not
    // Result-returned, store failure) can report accurately too. Every
    // increment site is UNCHANGED from pre-fix — only incremented AFTER
    // `persistGroup` resolves ok, so a failing group's write is never
    // double-counted into `partial`.
    let phasesCreated = 0;
    let tasksArchived = 0;
    let evidenceMerged = 0;
    const warnings: string[] = [];

    const partial = (): PhaseMigrationPartialProgress => ({
      phases_created: phasesCreated,
      tasks_archived: tasksArchived,
      evidence_merged: evidenceMerged,
    });

    try {
      const plansResult = await this.store.findMany({ type: "plan" });
      if (!plansResult.ok) return migrationErr(plansResult.error, partial());

      const nowIso = new Date().toISOString();

      for (const plan of plansResult.value) {
        const tasksResult = await this.store.findMany({
          parent_id: plan.id,
          type: "task",
        });
        if (!tasksResult.ok) return migrationErr(tasksResult.error, partial());

        // (1) idempotency marker #1 — a task already carrying migrated_to was
        // processed by a prior run; excluding it here is what drives a second
        // run's tasks_archived/evidence_merged to 0.
        const pendingTasks = tasksResult.value.filter(
          (task) => readSourceExtra(task).migrated_to === undefined,
        );

        const existingPhasesResult = await this.store.findMany({
          parent_id: plan.id,
          type: PHASE_DOC_TYPE,
        });
        if (!existingPhasesResult.ok) return migrationErr(existingPhasesResult.error, partial());
        // (2) idempotency marker #2 — a declared phase name already present
        // among this plan's existing phase doc titles (empty OR merged) is
        // never recreated by the empty-declared-phase fallback below.
        const existingPhaseTitles = new Set(existingPhasesResult.value.map((d) => d.title));

        const groups = this.buildGroups(plan, pendingTasks, existingPhaseTitles);

        for (const group of groups) {
          const { extra, evidenceCount, warningsForGroup } = this.mergeGroup(plan, group, nowIso);
          warnings.push(...warningsForGroup);

          // Only awaited when the title actually contains CJK — an ASCII-only
          // title never pays the pinyin-pro load cost (SPEC-068 D1 hotfix).
          // reason: exactOptionalPropertyTypes forbids `{ transliterate: undefined }`
          // — omit the key entirely rather than spread an undefined-valued property.
          const slugOpts = containsCjk(group.title)
            ? { transliterate: await getTransliterateCjk() }
            : undefined;
          const slug = await slugifyWithCollision(
            PHASE_DOC_TYPE,
            group.title,
            async (candidate) => {
              const r = await this.store.findBySlug(candidate);
              return r.ok && r.value !== null;
            },
            slugOpts,
          );

          const phaseId = ulid();
          const phaseDoc: DocRecord = {
            id: phaseId,
            slug,
            type: PHASE_DOC_TYPE,
            role: "plan",
            title: group.title,
            status: "active",
            priority: "medium",
            content: "",
            parent_id: plan.id,
            created_at: nowIso,
            updated_at: nowIso,
            created_by: MIGRATION_ACTOR,
            version: 1,
            deleted_at: null,
            tags: [],
            extra,
          };

          if (!dryRun) {
            const writeResult = await this.persistGroup(phaseDoc, group, nowIso);
            if (!writeResult.ok) return migrationErr(writeResult.error, partial());
          }

          phasesCreated += 1;
          tasksArchived += group.tasks.length;
          evidenceMerged += evidenceCount;
        }
      }

      return ok({
        dry_run: dryRun,
        phases_created: phasesCreated,
        tasks_archived: tasksArchived,
        evidence_merged: evidenceMerged,
        warnings,
      });
    } catch (error) {
      return migrationErr(
        {
          code: "STORE_ERROR",
          message: error instanceof Error ? error.message : String(error),
        },
        partial(),
      );
    }
  }

  /**
   * Writes one phase doc (+ version snapshot + audit entry, D6a) and archives
   * every source task in `group` (+ its own version snapshot + audit entry).
   * Never called when `dryRun` is true.
   */
  private async persistGroup(
    phaseDoc: DocRecord,
    group: PhaseGroup,
    nowIso: string,
  ): Promise<Result<void, LoreError>> {
    const insertResult = await this.store.insert(phaseDoc);
    if (!insertResult.ok) return err(insertResult.error);

    const versionResult = await this.store.insertVersion({
      doc_id: phaseDoc.id,
      version: 1,
      content: phaseDoc.content,
      extra: phaseDoc.extra,
      status: phaseDoc.status,
      title: phaseDoc.title,
      action: "create",
      created_at: nowIso,
      created_by: MIGRATION_ACTOR,
      change_summary: `migrated from ${group.tasks.length} task(s)`,
      // SPEC-072 D1/D2 — the phase doc's slug at its own creation.
      slug: phaseDoc.slug,
    });
    if (!versionResult.ok) return err(versionResult.error);

    const auditResult = await this.store.appendAuditEntry({
      timestamp: nowIso,
      actor: MIGRATION_ACTOR,
      session_id: `phase-migration-${phaseDoc.id}`,
      action: "create",
      doc_id: phaseDoc.id,
      details: { version: 1, migrated_from: group.tasks.map((t) => t.id) },
    });
    if (!auditResult.ok) return err(auditResult.error);

    for (const task of group.tasks) {
      const newVersion = task.version + 1;
      const newExtra = { ...task.extra, migrated_to: phaseDoc.id };

      const updateResult = await this.store.update(
        task.id,
        { status: "archived", extra: newExtra, updated_at: nowIso, version: newVersion },
        { expected_version: task.version },
      );
      if (!updateResult.ok) return err(updateResult.error);

      const taskVersionResult = await this.store.insertVersion({
        doc_id: task.id,
        version: newVersion,
        content: updateResult.value.content,
        extra: updateResult.value.extra,
        status: updateResult.value.status,
        title: updateResult.value.title,
        action: "update",
        created_at: nowIso,
        created_by: MIGRATION_ACTOR,
        change_summary: `migrated to phase ${phaseDoc.id}`,
        // SPEC-072 D1/D2 — archiving never touches slug; carry the current value.
        slug: updateResult.value.slug,
      });
      if (!taskVersionResult.ok) return err(taskVersionResult.error);

      const taskAuditResult = await this.store.appendAuditEntry({
        timestamp: nowIso,
        actor: MIGRATION_ACTOR,
        session_id: `phase-migration-${task.id}`,
        action: "update",
        doc_id: task.id,
        details: { version: newVersion, migrated_to: phaseDoc.id },
      });
      if (!taskAuditResult.ok) return err(taskAuditResult.error);
    }

    return ok(undefined);
  }

  /**
   * Groups `pendingTasks` by `extra.phase` (declared-phase precedence),
   * falling back to `extra.legacy_phase`, falling back to one group per task
   * (P7's three-tier fallback). Adds one EMPTY group per plan-declared phase
   * name that has no task group AND no already-existing phase doc (idempotency
   * marker #2).
   */
  private buildGroups(
    plan: DocRecord,
    pendingTasks: DocRecord[],
    existingPhaseTitles: Set<string>,
  ): PhaseGroup[] {
    const groups = new Map<string, PhaseGroup>();

    for (const task of pendingTasks) {
      const extra = readSourceExtra(task);
      const phaseName = typeof extra.phase === "string" ? extra.phase : undefined;
      const legacyPhase = typeof extra.legacy_phase === "string" ? extra.legacy_phase : undefined;

      let key: string;
      let title: string;
      let legacyPhaseValue: string | undefined;

      if (phaseName !== undefined) {
        key = `declared:${phaseName}`;
        title = phaseName;
      } else if (legacyPhase !== undefined) {
        key = `legacy:${legacyPhase}`;
        title = legacyPhase;
        legacyPhaseValue = legacyPhase;
      } else {
        key = `solo:${task.id}`;
        title = task.title;
      }

      const existing = groups.get(key);
      if (existing !== undefined) {
        existing.tasks.push(task);
        continue;
      }
      groups.set(
        key,
        legacyPhaseValue !== undefined
          ? { title, legacyPhase: legacyPhaseValue, tasks: [task] }
          : { title, tasks: [task] },
      );
    }

    const declaredPhases = (plan.extra as { phases?: Array<{ name: string }> }).phases ?? [];
    for (const declared of declaredPhases) {
      const key = `declared:${declared.name}`;
      if (groups.has(key)) continue; // covered by a real task group this run
      if (existingPhaseTitles.has(declared.name)) continue; // idempotency marker #2
      groups.set(key, { title: declared.name, tasks: [] });
    }

    return Array.from(groups.values());
  }

  /**
   * Merges one group's source tasks into a phase doc's `extra` shape: evidence
   * (every entry gains `origin: taskId`, D6), file anchors (straight
   * concatenation in task order), claim precedence (newest `at` wins, every
   * other claim becomes a `track` note + report warning), and `migrated_from`.
   */
  private mergeGroup(
    plan: DocRecord,
    group: PhaseGroup,
    nowIso: string,
  ): { extra: Record<string, unknown>; evidenceCount: number; warningsForGroup: string[] } {
    const warningsForGroup: string[] = [];
    const evidence: MergedEvidenceEntry[] = [];
    const anchors: string[] = [];
    const claims: Array<{ task: DocRecord; claim: TaskClaim }> = [];

    for (const task of group.tasks) {
      const extra = readSourceExtra(task);

      for (const entry of extra.verification_evidence ?? []) {
        evidence.push({ ...entry, origin: task.id });
      }
      for (const anchor of extra.file_anchors ?? []) {
        anchors.push(anchor);
      }
      if (extra.claim !== undefined) {
        claims.push({ task, claim: extra.claim });
      }
    }

    // Newest fresh claim wins (P7) — comparison by `at` (ISO 8601,
    // lexicographically ordered), NOT a TTL staleness check (see this
    // module's header invariant). Descending sort: winner is index 0.
    claims.sort((a, b) => {
      if (a.claim.at === b.claim.at) return 0;
      return a.claim.at < b.claim.at ? 1 : -1;
    });
    const winner = claims[0];

    const track: TrackItem[] = [];
    for (let i = 1; i < claims.length; i++) {
      const displaced = claims[i];
      if (displaced === undefined) continue;
      const branchSuffix = displaced.claim.branch !== undefined ? `@${displaced.claim.branch}` : "";
      const note =
        `displaced claim holder ${displaced.claim.by}${branchSuffix} at ${displaced.claim.at} ` +
        `(from task ${displaced.task.slug}, superseded by ${winner?.claim.by ?? "unknown"})`;
      track.push({ id: ulid(), note, by: MIGRATION_ACTOR, at: nowIso });
      warningsForGroup.push(`phase '${group.title}' (plan ${plan.slug}): ${note}`);
    }

    const extra: Record<string, unknown> = {
      plan_id: plan.id,
      verification_evidence: evidence,
      file_anchors: anchors,
      track,
      migrated_from: group.tasks.map((t) => t.id),
    };
    if (winner !== undefined) extra.claim = winner.claim;
    if (group.legacyPhase !== undefined) extra.legacy_phase = group.legacyPhase;

    return { extra, evidenceCount: evidence.length, warningsForGroup };
  }
}
