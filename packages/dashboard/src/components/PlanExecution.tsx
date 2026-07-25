/**
 * PlanExecution — plan-detail Execution section (SPEC-037 D2).
 * Purpose: replaces the flat children list in `DocDetail`'s footer, for plan
 *   docs that have at least one task child, with a phase-grouped progress
 *   view: a rollup header (`X / Y tasks done`, `R ready`), one group per
 *   declared phase (in declaration order), an `Unphased` group, and an
 *   `Other documents` group for non-task children.
 * Public surface: PlanExecution, PlanExecutionProps
 * Invariants:
 *   - Readiness is its OWN query (`["planExecution","ready",plan.id]`) —
 *     a failed/pending readiness fetch degrades the rollup's `R ready`
 *     segment and every row's blocked-indicator by OMISSION, never a crash
 *     and never a fabricated `0 ready`.
 *   - Phase group order follows `plan.extra.phases[]` declaration order
 *     (parsed via `planExtraSchema.safeParse` — malformed/absent `extra`
 *     degrades to zero declared phases, everything falls into `Unphased`).
 *   - A task child with no matching `ReadyRecord` (join key: `record.task.id`)
 *     renders in `Unphased` with no readiness adornments (ready/blocked) —
 *     the race SPEC-037 §1 D2 names (task created after the readiness fetch).
 *   - Task rows reuse `TYPE_ACCENT`/`TYPE_ACCENT_BORDER_CLASS`,
 *     `formatTypeMetaLabel`/`metaBadgeVariant`, and `StatusPill` (read-only) —
 *     no independent re-derivation of any of those three renderers.
 *   - Caller (`DocDetail`) only mounts this when the plan has >=1 task child;
 *     zero-task-children plans keep the plain flat list, so this component
 *     never has to render an empty rollup shell.
 *   - Reads `apiGetReadyReport(plan.id).value.records` (never the deleted
 *     flat-array reader) — `GET /api/ready/:planIdOrSlug` has always returned
 *     the `{records, sessions, anchor_conflicts}` object (SPEC-042); a prior
 *     version of this file read `.value` as if it were the records array
 *     itself, a silent-then-throwing bug fixed by
 *     `task-fix-live-spec-042-regression-apigetready-types-api-ready`.
 * Side-effect class: IO (fetch via TanStack Query, read-only)
 * Source: SPEC-037 §1 D2, AC-37-3, AC-37-4, AC-37-6
 */

import { useQuery } from "@tanstack/react-query";
import type { DocRecord, DocSummary, ReadyRecord } from "@lore/core";
import { planExtraSchema } from "@lore/core";
import { apiGetReadyReport } from "@/lib/api";
import { queryKeys } from "@/lib/project-api";
import { Badge } from "@/components/ui/badge";
import { StatusPill } from "@/components/StatusPill";
import { cn } from "@/lib/utils";
import { TYPE_ACCENT, TYPE_ACCENT_BORDER_CLASS } from "@/lib/type-accent";
import { formatTypeMetaLabel, metaBadgeVariant } from "@/lib/type-meta-label";

export interface PlanExecutionProps {
  /** The plan document itself — `extra.phases[]` drives group declaration order. */
  plan: DocRecord;
  /** `navigation.children` from `GET /api/docs/:id` — full `DocSummary[]` incl. `.meta`. */
  children: DocSummary[];
  /** Called when a task/document row is clicked. */
  onNavigate?: (docId: string) => void;
}

const UNPHASED_LABEL = "Unphased";
const OTHER_DOCS_LABEL = "Other documents";

/**
 * One task row: accent border, status pill, meta badge, blocked indicator.
 * Reuses the exact SPEC-036 renderers (AC-37-4 shared-renderer parity).
 */
function TaskRow({
  task,
  readyRecord,
  onNavigate,
}: {
  task: DocSummary;
  // reason: required (not `?:`) but `| undefined` — these are internal-only
  // components always called with an explicit (possibly-undefined) value, so
  // `exactOptionalPropertyTypes` never has to distinguish "key omitted" from
  // "key present with value undefined" the way it would for an optional prop.
  readyRecord: ReadyRecord | undefined;
  onNavigate: ((docId: string) => void) | undefined;
}): React.ReactElement {
  const metaLabel = task.meta !== undefined ? formatTypeMetaLabel(task.meta) : null;
  const badgeVariant = task.meta !== undefined ? metaBadgeVariant(task.meta) : "outline";
  const isTerminal = task.status === "archived" || task.status === "deprecated";
  const isBlocked = readyRecord !== undefined && !readyRecord.ready && !isTerminal;
  const blockers = readyRecord?.unmet_blockers ?? [];

  return (
    <button
      type="button"
      onClick={() => onNavigate?.(task.id)}
      className={cn(
        "w-full flex items-center gap-2 rounded border p-2 text-left hover:bg-muted transition-colors",
        TYPE_ACCENT_BORDER_CLASS,
        TYPE_ACCENT[task.type],
      )}
    >
      <span className="text-sm flex-1 truncate">{task.title}</span>
      <StatusPill status={task.status} />
      {metaLabel !== null && (
        <Badge variant={badgeVariant} className="text-xs shrink-0">
          {metaLabel}
        </Badge>
      )}
      {isBlocked && blockers.length > 0 && (
        <span className="text-xs text-muted-foreground shrink-0">
          blocked by {blockers[0]!.slug}
          {blockers.length > 1 ? ` +${blockers.length - 1}` : ""}
        </span>
      )}
    </button>
  );
}

/** One phase (or Unphased) group: label header + stacked task rows. */
function TaskGroup({
  label,
  tasks,
  readyByTaskId,
  onNavigate,
}: {
  label: string;
  tasks: DocSummary[];
  readyByTaskId: Map<string, ReadyRecord>;
  onNavigate: ((docId: string) => void) | undefined;
}): React.ReactElement | null {
  if (tasks.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
      <div className="space-y-1.5">
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} readyRecord={readyByTaskId.get(task.id)} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  );
}

/**
 * @example
 * <PlanExecution plan={doc} children={navigation.children} onNavigate={onNavigate} />
 */
export function PlanExecution({ plan, children, onNavigate }: PlanExecutionProps): React.ReactElement {
  const { data } = useQuery({
    queryKey: queryKeys.scope(null, ["planExecution", "ready", plan.id]),
    queryFn: () => apiGetReadyReport(plan.id),
  });

  const readyRecords: ReadyRecord[] = data !== undefined && data.ok ? data.value.records : [];
  const readyByTaskId = new Map(readyRecords.map((record) => [record.task.id, record]));

  const taskChildren = children.filter((child) => child.type === "task");
  const otherChildren = children.filter((child) => child.type !== "task");

  const doneCount = taskChildren.filter((task) => task.status === "archived").length;
  const readyCount = data !== undefined && data.ok ? readyRecords.filter((r) => r.ready).length : undefined;

  // reason: parse extra.phases defensively — a legacy/malformed plan.extra must
  // degrade to "no declared phases" (everything falls into Unphased), never throw.
  const parsedExtra = planExtraSchema.safeParse(plan.extra);
  const declaredPhaseNames = parsedExtra.success ? (parsedExtra.data.phases ?? []).map((p) => p.name) : [];

  const phaseGroups = declaredPhaseNames.map((phaseName) => ({
    phaseName,
    tasks: taskChildren.filter((task) => readyByTaskId.get(task.id)?.phase === phaseName),
  }));

  const groupedTaskIds = new Set(phaseGroups.flatMap((g) => g.tasks.map((t) => t.id)));
  const unphasedTasks = taskChildren.filter((task) => !groupedTaskIds.has(task.id));

  return (
    <div className="space-y-4">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Execution</p>
      <p className="text-sm">
        {doneCount} / {taskChildren.length} tasks done
        {readyCount !== undefined ? ` · ${readyCount} ready` : ""}
      </p>

      {phaseGroups.map(({ phaseName, tasks }) => (
        <TaskGroup
          key={phaseName}
          label={phaseName}
          tasks={tasks}
          readyByTaskId={readyByTaskId}
          onNavigate={onNavigate}
        />
      ))}

      <TaskGroup
        label={UNPHASED_LABEL}
        tasks={unphasedTasks}
        readyByTaskId={readyByTaskId}
        onNavigate={onNavigate}
      />

      {otherChildren.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{OTHER_DOCS_LABEL}</p>
          <div className="flex flex-wrap gap-2">
            {otherChildren.map((child) => (
              <button
                key={child.id}
                className="text-sm text-primary hover:underline"
                onClick={() => onNavigate?.(child.id)}
                type="button"
              >
                {child.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
