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
 * @invariant Plan membership is `extra.plan_id`, decided by the SHARED
 *   {@link isPlanMember} predicate (`plan-membership.ts`) — NEVER `parent_id`.
 *   `parent_id` is a proxy `--parent` legitimately diverges from (`lore create
 *   task --plan-id P3 --parent P4` is a SUPPORTED shape, SPEC-065 D4), so a
 *   `parent_id`-keyed sweep here would BOTH strand a real member of P3 filed at
 *   P4 AND archive a non-member merely filed under P3, permanently: this is a
 *   ONE-SHOT migration that stamps `extra.migrated_to` and archives its sources,
 *   so unlike every read-path site of the same family
 *   (task-eight-more-plan-member-queries-still-key-on-parent-id) there is no
 *   second, corrected run to fix the attribution
 *   (task-a-ninth-plan-member-query-hides-in-the-one-shot-task-phase).
 *   Consequence for the query shape: the store has no `extra.plan_id` filter, so
 *   the task set is ONE corpus-wide `type: "task"` `findMany` hoisted ABOVE the
 *   plan loop and filtered in memory per plan — the same accepted tradeoff every
 *   other site of this sweep made, plus a strictly smaller number of store round
 *   trips than the per-plan query it replaced.
 * @invariant Every task the run DECLINES to move is NAMED in
 *   `PhaseMigrationReport.warnings` — never merely absent from the counts. The
 *   declined set is exactly: a non-`--adhoc`, not-already-migrated `task` doc
 *   whose `extra.plan_id` matches NO plan in this corpus (missing, malformed, or
 *   pointing at a deleted/non-plan doc). Such a task is claimed by no plan's
 *   migration and, because this migration is one-shot, would otherwise be
 *   dropped in total silence behind a successful-looking report. `--adhoc` tasks
 *   are deliberately NOT reported: they are planless BY DESIGN (SPEC-069 D2), so
 *   they are out of scope rather than declined. The list is never truncated or
 *   capped (same "never truncated" reasoning D6 applies to evidence — a capped
 *   warning list is the silence this invariant exists to remove), and it is
 *   computed identically under `dryRun`, which is the ONLY recoverable checkpoint
 *   a one-shot migration has.
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
import { isPlanMember } from "./plan-membership.js";

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
 *     holder AND one per DECLINED task (a task no plan's migration claimed
 *     because its `extra.plan_id` matches no plan in this corpus — see this
 *     module's declined-member invariant). `lore migrate tasks-to-phases` prints
 *     this array verbatim on both the dry-run and the applying run
 *     (`adapters/cli/commands/migrate.ts`), which is what makes a declined
 *     member visible to the operator instead of merely missing from the counts.
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
 * The Silence half of this module's declined-member invariant: one human-readable
 * warning per task the run refused to move, naming the task and the unresolvable
 * `extra.plan_id` that caused it.
 *
 * Pure and total — takes the SAME task set the plan loop matched against plus the
 * ids that loop actually claimed, so it can never invent a declined task the run
 * never considered, and never hides one behind a per-plan snapshot.
 *
 * @param allTasks - Every live `task` doc this run enumerated (soft-deleted docs
 *   are already excluded by `findMany`, so they are neither migrated nor reported
 *   — identical to the pre-fix behaviour).
 * @param claimedTaskIds - Ids placed into some plan's merge group this run.
 * @returns One warning per declined task, in `allTasks` order; `[]` when every
 *   task was either claimed, already migrated by a prior run, or `--adhoc`.
 * @example
 * computeDeclinedTaskWarnings([orphanTask], new Set());
 * // => ["task task-foo was NOT migrated: its extra.plan_id (01ABC…) matches no plan …"]
 */
function computeDeclinedTaskWarnings(
  allTasks: readonly DocRecord[],
  claimedTaskIds: ReadonlySet<DocId>,
): string[] {
  const warnings: string[] = [];
  for (const task of allTasks) {
    if (claimedTaskIds.has(task.id)) continue;
    // reason: already moved by a PRIOR run (idempotency marker #1) — reporting it
    // would contradict this module's idempotency contract, which promises a
    // re-run is a clean no-op for everything already migrated.
    if (readSourceExtra(task).migrated_to !== undefined) continue;
    // reason: an --adhoc task is planless BY DESIGN (SPEC-069 D2) and can never be
    // a member of any plan, so it was never declined — do not "simplify" this
    // skip away. A warning per adhoc task would fire on every healthy corpus and
    // train operators to ignore the one list that must never be ignored.
    if (task.extra["adhoc"] === true) continue;
    const rawPlanId = task.extra["plan_id"];
    const planIdLabel = typeof rawPlanId === "string" && rawPlanId.length > 0 ? rawPlanId : "absent";
    warnings.push(
      `task ${task.slug} was NOT migrated: its extra.plan_id (${planIdLabel}) matches no plan in this ` +
        `corpus, and plan membership IS extra.plan_id — it is filed under parent_id ` +
        `${task.parent_id ?? "none"}, which this migration deliberately does not treat as membership. ` +
        `Repair extra.plan_id and re-run (migrateTasks is idempotent: already-migrated tasks are skipped).`,
    );
  }
  return warnings;
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

      // Membership is `extra.plan_id` (see this module's membership invariant),
      // and the store has no extra-field filter — so ONE corpus-wide task
      // enumeration is hoisted here and filtered per plan below. Hoisted rather
      // than repeated inside the loop for a second reason beyond round trips: the
      // declined-member report after the loop must be computed against the SAME
      // task set every plan was matched against, or a task could be reported as
      // declined by a snapshot that never contained it.
      const allTasksResult = await this.store.findMany({ type: "task" });
      if (!allTasksResult.ok) return migrationErr(allTasksResult.error, partial());
      const allTasks = allTasksResult.value;

      /** Every task actually placed into some plan's group this run (dry-run included). */
      const claimedTaskIds = new Set<DocId>();

      for (const plan of plansResult.value) {
        const planTasks = allTasks.filter((task) => isPlanMember(task, plan.id));

        // (1) idempotency marker #1 — a task already carrying migrated_to was
        // processed by a prior run; excluding it here is what drives a second
        // run's tasks_archived/evidence_merged to 0.
        const pendingTasks = planTasks.filter(
          (task) => readSourceExtra(task).migrated_to === undefined,
        );

        // reason: `parent_id` is the RIGHT key for THIS query, and deliberately
        // stays one — unlike the task query above. `PhaseMigrationService` is the
        // only phase-doc writer in the codebase (grep `PHASE_DOC_TYPE`) and it
        // always writes `parent_id: plan.id` alongside `extra.plan_id: plan.id`,
        // so for phase docs the two fields cannot diverge; there is no `--parent`
        // flag reaching this type. Documented here so the next reader does not
        // read this line as a ninth site the membership sweep missed.
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
          for (const task of group.tasks) claimedTaskIds.add(task.id);
        }
      }

      warnings.push(...computeDeclinedTaskWarnings(allTasks, claimedTaskIds));

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
   *
   * ⛔ Grouping deliberately does NOT validate `extra.phase` against `plan`'s own
   * declared `extra.phases[]`, and a diverged member makes that visible: a task's
   * `extra.phase` is validated at CREATE time against the plan resolved from its
   * `parent_id` (`CorpusService._createImpl`/`set`), not from `extra.plan_id`, so
   * a member of P3 filed at P4 had its phase name checked against P4's phase
   * namespace while THIS function — correctly, per the membership invariant —
   * groups it under P3. It can therefore produce a phase doc under P3 whose title
   * P3 never declared. That is NOT a new failure mode this fix introduced: an
   * undeclared group name was already reachable pre-fix for any task whose plan
   * renamed or removed a phase after the task was written, and P7's own
   * one-group-per-task fallback creates undeclared titles by design. Widening a
   * phase name into an error here would make the one-shot migration REFUSE data
   * it can losslessly carry, which is the opposite of the drop this task exists
   * to close. The create-time asymmetry itself is the TENTH site of the
   * membership family (`extra.phase` is looked up per plan MEMBERSHIP by
   * `PhaseService.findTasksByPhase`, so the namespace it is validated against
   * should be the member plan's, not the filing parent's) — it lives in
   * `corpus-service.ts`/`phase-service.ts`, outside this task's file anchors, and
   * changing it changes a WRITE-path validation outcome, so it is reported as a
   * follow-up rather than smuggled in here.
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
