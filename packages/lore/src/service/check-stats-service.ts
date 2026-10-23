/**
 * CheckStatsService — what every retained gate and hook has caught, and whether the work they guarded held up.
 *
 * Purpose: `lore checks stats` prints runs, denials and the last denial per check id and lists removal candidates
 * (a check observed long enough that never catching anything is evidence, not luck); `--quality` prints, per closed
 * plan, the defects that escaped it (issues filed shortly after close, reopened tasks, fix tasks). Nothing here
 * samples a human: ground truth is what happened after the plan closed (BR-1373, AC-LG-13, AC-LG-14).
 * Public surface: {@link CheckStatsService}.{stats, quality, ingestHookOutcomes}, {@link deriveRemovalCandidates},
 *   {@link citesAny}, the REMOVAL_* / ESCAPE_WINDOW_DAYS constants, the report types.
 * Invariants:
 *   - A removal candidate can deny (`isDenyCapableCheck`: a gate checkpoint, or a hook declared deny-capable in
 *     `@lore/core`'s HOOK_DENY_CAPABILITY) AND has >= REMOVAL_MIN_DAYS between its first and the current time AND
 *     >= REMOVAL_MIN_RUNS runs AND 0 denials (the ADR's observation window). One denial, ever, takes a check off the
 *     list. An informational hook shows runs only; "never denied" says nothing about a check that cannot deny.
 *   - An issue counts as escaped only when it was filed at or after the plan closed, no later than
 *     ESCAPE_WINDOW_DAYS days after, and its title or body cites the plan slug or one of the plan's task slugs as a
 *     whole token. An issue without a creation time is a VALIDATION_ERROR, never a guess.
 *   - Hook outcomes arrive through a local JSONL file the hooks append to (no process spawn per hook run). The file is
 *     shared by every project of the user, so each line carries the hook's `cwd`: ingest takes only lines whose cwd
 *     is inside this corpus's project root, leaves every other project's lines in the file, and NEVER ingests a line
 *     without a cwd (such a line is dropped and counted as malformed). Ingest claims the file by atomic rename, so two
 *     concurrent lore calls never read the same line twice.
 * Side-effect class: IO (store reads/appends; the outcomes file; the injected issue reader).
 *
 * Source: spec-lean-governance-batch-verbs-judgment-only-at-milestones Part D; BR-1373;
 *   adr-ai-decision-standard-four-checks-references-from-excellent (observation window).
 */
import { appendFileSync, existsSync, readFileSync, realpathSync, renameSync, unlinkSync } from "node:fs";
import { err, isDenyCapableHookCheck, ok, storeError, validationError, type DocRecord, type LoreError, type Result } from "@lore/core";
import { join, sep } from "node:path";
import { z } from "zod";
import type { CheckOutcomeInput, CheckOutcomeStat, StoreInterface } from "../store/store-interface.js";
import { checkpointRegistry } from "./checkpoint-registry.js";
import { isPlanMember } from "./plan-membership.js";

/** A check must have been observed this many days before "never denied" counts as evidence. */
export const REMOVAL_MIN_DAYS = 30;
/** A check must have run this many times before "never denied" counts as evidence. */
export const REMOVAL_MIN_RUNS = 50;
/** An issue filed within this many days after a plan closed (inclusive) is an escaped defect of that plan. */
export const ESCAPE_WINDOW_DAYS = 14;

const DAY_MS = 86_400_000;

/** One check's line in `lore checks stats`. */
export interface CheckStatLine extends CheckOutcomeStat {
  /** Whole days between the first recorded run and now. */
  readonly observed_days: number;
  /** False for a check that cannot deny: it is never a removal candidate and its denial columns carry no meaning. */
  readonly can_deny: boolean;
  readonly removal_candidate: boolean;
}

export interface CheckStatsReport {
  readonly checks: readonly CheckStatLine[];
  /** Check ids that satisfy the removal rule, ordered by check id. */
  readonly removal_candidates: readonly string[];
}

/** One issue as the injected reader returns it (the GitHub port's listing, narrowed to what citing needs). */
export interface EscapeIssue {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  /** ISO 8601 creation time; absent only for a record the reader could not date. */
  readonly createdAt?: string;
}

/** Reads the project's issues (all states). The GitHub intake port satisfies this; tests inject a fake. */
export type ListEscapeIssues = () => Promise<Result<readonly EscapeIssue[], LoreError>>;

/** One closed plan's line in `lore checks stats --quality`. */
export interface PlanQualityLine {
  readonly plan_slug: string;
  readonly closed_at: string;
  /** `audit` = the archive write's own audit row; `updated_at` = no such row was found, the doc's last write time. */
  readonly close_source: "audit" | "updated_at";
  readonly escaped_issues: number;
  readonly escaped_issue_numbers: readonly number[];
  /** Distinct tasks of the plan reopened after it closed. */
  readonly reopened_tasks: number;
  /** Tasks created after the close, outside the plan, named fix, citing the plan or one of its tasks. */
  readonly fix_tasks: number;
}

export interface QualityReport {
  readonly plans: readonly PlanQualityLine[];
}

/** What one ingest of the hook outcomes file did. */
export interface HookIngestReport {
  readonly ingested: number;
  /** Lines that were not a valid outcome or carried no cwd (a hook bug); counted, never silently dropped. */
  readonly malformed: number;
  /** Valid lines of other projects, left in the file for their own corpus. */
  readonly left_for_other_projects: number;
}

const hookOutcomeLineSchema = z.object({
  check: z.string().min(1),
  outcome: z.enum(["pass", "deny", "error"]),
  ts: z.string().refine((value) => Number.isFinite(Date.parse(value)), "ts must be an ISO 8601 time"),
  cwd: z.string().min(1),
});

/**
 * The file the hooks append outcomes to: `<state base>/check-outcomes.jsonl`, where the state base is the SAME
 * directory `assets/hooks/lib/turn-state.mjs::getStateBase` resolves (`CLAUDE_STATE_BASE_OVERRIDE`, else
 * `~/.claude/session-state`). A test pins both sides to the same path.
 */
export function hookOutcomesFilePath(env: Readonly<Record<string, string | undefined>>, homeDir: string): string {
  const override = env["CLAUDE_STATE_BASE_OVERRIDE"];
  const base = override !== undefined && override !== "" ? override : join(homeDir, ".claude", "session-state");
  return join(base, "check-outcomes.jsonl");
}

export interface CheckStatsDeps {
  readonly store: StoreInterface;
  /** Injected clock (ISO 8601). */
  readonly now: () => string;
  /** The JSONL file the hooks append to; absent -> `ingestHookOutcomes` is not wired and refuses. */
  readonly hookOutcomesPath?: string;
  /** This corpus's project root: ingest keeps only hook lines whose cwd is inside it. Required with `hookOutcomesPath`. */
  readonly projectRoot?: string;
}

/**
 * THE deny-capability question for a check id: a `gate:<checkpoint>` of the checkpoint registry, or a `hook:<name>`
 * declared deny-capable in `@lore/core`. An id naming neither is not deny-capable (never a removal candidate).
 */
export function isDenyCapableCheck(checkId: string): boolean {
  if (checkId.startsWith("gate:")) return Object.hasOwn(checkpointRegistry, checkId.slice("gate:".length));
  return isDenyCapableHookCheck(checkId) === true;
}

function realOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    // reason: a cwd that no longer exists (a removed worktree) is still judged by its own text, not dropped.
    return path;
  }
}

/** True when `cwd` is `root` or lies below it (both compared after resolving symlinks). */
export function isInsideProject(cwd: string, root: string): boolean {
  const base = realOrSelf(root);
  const target = realOrSelf(cwd);
  return target === base || target.startsWith(base.endsWith(sep) ? base : base + sep);
}

/**
 * The removal rule over per-check aggregates: observed >= REMOVAL_MIN_DAYS days, >= REMOVAL_MIN_RUNS runs, 0 denials.
 *
 * @example deriveRemovalCandidates([{ check_id: "gate:x", runs: 60, denials: 0, first_run: "2026-01-01T00:00:00Z", ... }], "2026-03-01T00:00:00Z") // ["gate:x"]
 */
export function deriveRemovalCandidates(stats: readonly CheckOutcomeStat[], nowIso: string): string[] {
  const nowMs = Date.parse(nowIso);
  return stats
    .filter((s) => isDenyCapableCheck(s.check_id))
    .filter((s) => s.denials === 0 && s.runs >= REMOVAL_MIN_RUNS && nowMs - Date.parse(s.first_run) >= REMOVAL_MIN_DAYS * DAY_MS)
    .map((s) => s.check_id)
    .sort();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when `text` contains any of `slugs` as a whole token (a longer slug that merely starts with one does not count). */
export function citesAny(text: string, slugs: readonly string[]): boolean {
  return slugs.some((slug) => slug.length > 0 && new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(slug)}(?![A-Za-z0-9_-])`).test(text));
}

const FIX_TITLE = /(^|[^a-z])fix(es|ed)?([^a-z]|$)/i;

export class CheckStatsService {
  constructor(private readonly deps: CheckStatsDeps) {}

  /** Runs, denials, last denial per check id, plus the removal candidates. */
  async stats(): Promise<Result<CheckStatsReport, LoreError>> {
    const listed = await this.deps.store.listCheckOutcomeStats();
    if (!listed.ok) return listed;
    const nowIso = this.deps.now();
    const candidates = new Set(deriveRemovalCandidates(listed.value, nowIso));
    const checks = listed.value.map((s) => ({
      ...s,
      observed_days: Math.floor((Date.parse(nowIso) - Date.parse(s.first_run)) / DAY_MS),
      can_deny: isDenyCapableCheck(s.check_id),
      removal_candidate: candidates.has(s.check_id),
    }));
    return ok({ checks, removal_candidates: [...candidates] });
  }

  /**
   * Per closed (archived) plan: escaped issues, reopened tasks, fix tasks.
   *
   * @param listIssues - the project's issue reader; its failure is returned as is (never read as "0 escaped").
   * @returns err(VALIDATION_ERROR) when an issue has no creation time; err(STORE_ERROR) on a store failure.
   */
  async quality(listIssues: ListEscapeIssues): Promise<Result<QualityReport, LoreError>> {
    const issues = await listIssues();
    if (!issues.ok) return issues;
    for (const issue of issues.value) {
      if (issue.createdAt === undefined || !Number.isFinite(Date.parse(issue.createdAt))) {
        return err(validationError("issue.createdAt", `issue #${issue.number} has no usable creation time, so it cannot be placed against a plan close`, undefined, "BR-1373"));
      }
    }
    const plans = await this.deps.store.findMany({ type: "plan", status: "archived" });
    if (!plans.ok) return plans;
    const allTasks = await this.deps.store.findMany({ type: "task" });
    if (!allTasks.ok) return allTasks;

    const lines: PlanQualityLine[] = [];
    for (const plan of plans.value) {
      const line = await this.planLine(plan, allTasks.value, issues.value);
      if (!line.ok) return line;
      lines.push(line.value);
    }
    return ok({ plans: lines.sort((a, b) => a.plan_slug.localeCompare(b.plan_slug)) });
  }

  private async closeTimeOf(plan: DocRecord): Promise<Result<{ at: string; source: "audit" | "updated_at" }, LoreError>> {
    const audit = await this.deps.store.queryAudit({ doc_id: plan.id, action: "update" });
    if (!audit.ok) return audit;
    const archived = audit.value
      .filter((entry) => (entry.details?.["patch"] as { status?: unknown } | undefined)?.status === "archived")
      .map((entry) => entry.timestamp)
      .sort();
    const latest = archived[archived.length - 1];
    return ok(latest === undefined ? { at: plan.updated_at, source: "updated_at" } : { at: latest, source: "audit" });
  }

  private async planLine(plan: DocRecord, allTasks: readonly DocRecord[], issues: readonly EscapeIssue[]): Promise<Result<PlanQualityLine, LoreError>> {
    const closed = await this.closeTimeOf(plan);
    if (!closed.ok) return closed;
    const closedMs = Date.parse(closed.value.at);
    const ownTasks = allTasks.filter((t) => isPlanMember(t, plan.id));
    const slugs = [plan.slug, ...ownTasks.map((t) => t.slug)];

    const escaped = issues
      .filter((issue) => {
        const age = Date.parse(issue.createdAt as string) - closedMs;
        return age >= 0 && age <= ESCAPE_WINDOW_DAYS * DAY_MS && citesAny(`${issue.title}\n${issue.body}`, slugs);
      })
      .map((issue) => issue.number)
      .sort((a, b) => a - b);

    let reopened = 0;
    for (const task of ownTasks) {
      const audit = await this.deps.store.queryAudit({ doc_id: task.id, action: "update" });
      if (!audit.ok) return audit;
      if (audit.value.some((e) => e.details?.["operation"] === "reopen" && Date.parse(e.timestamp) >= closedMs)) reopened += 1;
    }

    const ownIds = new Set(ownTasks.map((t) => t.id));
    const fixTasks = allTasks.filter(
      (t) =>
        !ownIds.has(t.id) &&
        Date.parse(t.created_at) >= closedMs &&
        (FIX_TITLE.test(t.title) || t.slug.startsWith("fix-")) &&
        citesAny(`${t.title}\n${t.content}`, slugs),
    ).length;

    return ok({
      plan_slug: plan.slug,
      closed_at: closed.value.at,
      close_source: closed.value.source,
      escaped_issues: escaped.length,
      escaped_issue_numbers: escaped,
      reopened_tasks: reopened,
      fix_tasks: fixTasks,
    });
  }

  /**
   * Moves the hooks' local outcome rows into `check_outcomes`. A missing or empty file is a normal "nothing to do".
   * The file is claimed by rename first; on an append failure its lines are put back so nothing is lost.
   *
   * @returns err(VALIDATION_ERROR) when no outcomes path is wired; err(STORE_ERROR) on a failed append.
   */
  async ingestHookOutcomes(): Promise<Result<HookIngestReport, LoreError>> {
    const path = this.deps.hookOutcomesPath;
    const root = this.deps.projectRoot;
    if (path === undefined || root === undefined) {
      return err(validationError("hookOutcomesPath", "the hook outcomes file and the project root must both be wired", undefined, "BR-1373"));
    }
    const nothing: HookIngestReport = { ingested: 0, malformed: 0, left_for_other_projects: 0 };
    if (!existsSync(path)) return ok(nothing);
    const claimed = `${path}.ingest-${process.pid}-${Date.now()}`;
    try {
      renameSync(path, claimed);
    } catch (cause) {
      // reason: another lore call claimed the file between existsSync and rename: it ingests those lines, not us.
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return ok(nothing);
      return err(storeError(`could not claim ${path}: ${String(cause)}`));
    }
    const text = readFileSync(claimed, "utf8");
    const rows: CheckOutcomeInput[] = [];
    const otherProjects: string[] = [];
    let malformed = 0;
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      let json: unknown;
      try {
        json = JSON.parse(line);
      } catch {
        malformed += 1;
        continue;
      }
      const parsed = hookOutcomeLineSchema.safeParse(json); // a line without a cwd fails here: never ingested
      if (!parsed.success) {
        malformed += 1;
        continue;
      }
      if (!isInsideProject(parsed.data.cwd, root)) {
        otherProjects.push(line);
        continue;
      }
      rows.push({ check_id: parsed.data.check, outcome: parsed.data.outcome, ts: parsed.data.ts });
    }
    const appended = await this.deps.store.appendCheckOutcomes(rows);
    if (!appended.ok) {
      appendFileSync(path, text); // put every line back: a failed ingest loses nothing
      unlinkSync(claimed);
      return appended;
    }
    // reason: the other projects' lines go back BEFORE the claim is dropped, so a crash here duplicates nothing and loses nothing a later call cannot redo.
    if (otherProjects.length > 0) appendFileSync(path, `${otherProjects.join("\n")}\n`);
    unlinkSync(claimed);
    return ok({ ingested: rows.length, malformed, left_for_other_projects: otherProjects.length });
  }
}
