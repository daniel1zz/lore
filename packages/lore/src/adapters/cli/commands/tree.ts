/**
 * lore tree [root-id] — display document hierarchy as a tree.
 * With --orphans: list orphaned documents (parent_id=null AND type∉ROOT_TYPES,
 * or parent_id≠null but parent doesn't exist).
 *
 * Phase grouping (SPEC-023):
 *   When the root document is a plan with extra.phases declared, child tasks are
 *   rendered grouped under phase headers (including empty phases per AC-PHASE-6).
 *   Falls back to flat tree rendering for plans without phases, and for all
 *   non-plan root documents.
 *
 * ## Validity travels on the `--json` payload too, not only the human badge
 * (task-validity-landed-on-lore-list-only-the-dispatch-surface, Required #4)
 *
 * `lore tree` deliberately does NOT filter retracted docs — a tree is a STRUCTURE view,
 * and silently dropping a node would misrepresent the hierarchy (SPEC-043 D4: tree
 * marks, list/search filter). But the mark existed only in the HUMAN render: a
 * `--json` consumer got a node payload with no validity-bearing key at all, i.e. the
 * same blindness the parent task removed from `lore list`.
 *
 * `buildValidityIndex` is now the ONE derivation for both: it fetches the corpus ONCE
 * and computes `projectValidityStatus` (`../../../service/validity-service.js` — the
 * SSOT read-surface projection) per doc. The human badge and the `--json`
 * `validity_status` key are read off the SAME map, so they can never disagree.
 *
 * ⛔ Two properties of that index are load-bearing:
 *   1. It is corpus-WIDE and type-AGNOSTIC (one `listFull({})`, not three type-scoped
 *      calls as before). The SSOT predicate never branches on `doc.type`, so scoping the
 *      index to knowledge/adr/task would have made the tree's verdict differ from the
 *      predicate's for any other type — and it is strictly FEWER store round trips.
 *   2. A node whose id is ABSENT from the index gets NO `validity_status` key, never a
 *      fabricated `{invalidated: false}`. Absent means "this surface never probed it",
 *      which is a different fact from "probed, and live" — collapsing the two is the
 *      exact silence this key exists to remove.
 *
 * Exit codes:
 *   Normal: 0 = success, non-zero on error
 *   --orphans: 0 = no orphans, 3 = orphans found
 */

import { defineLoreCommand } from "../cli-exit.js";

import { loadLoreApp } from "../loader.js";
import {
  exitCode,
  formatErrorFor,
  formatTree,
  formatValidityBadge,
  formatWorkflowBadge,
  parsePositiveIntArg,
} from "../utils.js";
import {
  projectValidityStatus,
  type ValidityStatus,
} from "../../../service/validity-service.js";
import type { TreeBlueprint, PlanPhase, DocRecord } from "@lore/core";
import type { TreeNode } from "../../../service/corpus-service.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";

// ─── Phase Grouping Helpers ───────────────────────────────────────────────────

/**
 * Extract the phases array from a plan's extra field.
 * Returns [] if extra.phases is absent or not an array.
 */
function extractPhasesFromExtra(extra: Record<string, unknown>): PlanPhase[] {
  const raw = extra["phases"];
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (p): p is PlanPhase =>
      typeof p === "object" && p !== null && typeof (p as PlanPhase).name === "string",
  );
}

/**
 * Render a plan's tasks grouped by declared phases.
 * All declared phases are shown (including empty ones — AC-PHASE-6).
 * Tasks not assigned to any phase are shown in an "(unphased)" group if any exist.
 *
 * Example output:
 *   plan-my-plan (plan, draft)
 *   ├── Phase: Foundation (2 tasks)
 *   │   ├── task-setup (task, done)
 *   │   └── task-database (task, todo)
 *   ├── Phase: Build (0 tasks)
 *   └── (unphased) (1 task)
 *       └── task-other (task, todo)
 *
 * Task rows carry a claim/evidence workflow badge (AC-WF-9) — see formatWorkflowBadge.
 */
function formatPhaseTree(
  plan: DocRecord,
  phases: PlanPhase[],
  allTasks: DocRecord[],
  nowIso: string,
  ttlMinutes: number,
): string {
  const lines: string[] = [];
  lines.push(`${plan.slug} (${plan.type}, ${plan.status})`);

  const unphased = allTasks.filter(
    (t) => !t.extra["phase"] || !phases.some((p) => p.name === t.extra["phase"]),
  );

  const totalGroups = phases.length + (unphased.length > 0 ? 1 : 0);
  let groupIndex = 0;

  for (const phase of phases) {
    groupIndex++;
    const tasksInPhase = allTasks.filter((t) => t.extra["phase"] === phase.name);
    const count = tasksInPhase.length;
    const isLast = groupIndex === totalGroups;
    const phasePrefix = isLast ? "└── " : "├── ";
    const childIndent = isLast ? "    " : "│   ";
    const desc = phase.description ? ` — ${phase.description}` : "";
    lines.push(`${phasePrefix}Phase: ${phase.name}${desc} (${count} ${count === 1 ? "task" : "tasks"})`);

    for (let i = 0; i < tasksInPhase.length; i++) {
      const task = tasksInPhase[i]!;
      const isLastTask = i === tasksInPhase.length - 1;
      const taskPrefix = isLastTask ? "└── " : "├── ";
      lines.push(`${childIndent}${taskPrefix}${task.slug} (${task.type}, ${task.status})${formatWorkflowBadge(task, nowIso, ttlMinutes)}`);
    }
  }

  if (unphased.length > 0) {
    const isLast = true;
    const phasePrefix = isLast ? "└── " : "├── ";
    const childIndent = isLast ? "    " : "│   ";
    const count = unphased.length;
    lines.push(`${phasePrefix}(unphased) (${count} ${count === 1 ? "task" : "tasks"})`);
    for (let i = 0; i < unphased.length; i++) {
      const task = unphased[i]!;
      const isLastTask = i === unphased.length - 1;
      const taskPrefix = isLastTask ? "└── " : "├── ";
      lines.push(`${childIndent}${taskPrefix}${task.slug} (${task.type}, ${task.status})${formatWorkflowBadge(task, nowIso, ttlMinutes)}`);
    }
  }

  return lines.join("\n");
}

/** Minimal blueprint used only to trigger orphan detection in TreeCheckService. */
const ORPHAN_DETECTION_BLUEPRINT: TreeBlueprint = {
  version: 1,
  root: { type: "prd", min: 0, max: null, children: [] },
};

/**
 * The corpus-wide validity index this command's HUMAN badges and its `--json`
 * `validity_status` key are both read from — two projections of ONE evaluation, so the
 * rendered table and the machine payload can never disagree.
 */
interface ValidityIndex {
  /** DocId → the SSOT-projected verdict, for every doc the fetch returned. */
  readonly statusById: Map<string, ValidityStatus>;
  /** DocId → `" [invalid]"`, containing ONLY the retracted docs (`formatValidityBadge`). */
  readonly badgeById: Map<string, string>;
}

/**
 * Builds the {@link ValidityIndex} (see this file's header for why it is corpus-wide and
 * type-agnostic, and why an absent entry must stay absent).
 *
 * One `listFull({})` — unfiltered because the SSOT projection never branches on
 * `doc.type`, and a node of ANY type can sit anywhere in the tree. Both outputs are
 * computed in the SAME pass, off the SAME full `DocRecord` and the SAME instant.
 *
 * @param app - The wired App (one `corpusService.listFull` call)
 * @param nowIso - The single instant every verdict in this command is evaluated against
 * @returns Both maps; EMPTY when the fetch fails — the tree still renders (a validity
 *   lookup failure must not abort a structure view) and no node then claims a probed
 *   verdict, which is honest rather than a fabricated "live"
 */
async function buildValidityIndex(
  app: ReturnType<typeof loadLoreApp>["app"],
  nowIso: string,
): Promise<ValidityIndex> {
  const statusById = new Map<string, ValidityStatus>();
  const badgeById = new Map<string, string>();
  const listResult = await app.corpusService.listFull({});
  if (!listResult.ok) return { statusById, badgeById };
  for (const doc of listResult.value.docs) {
    statusById.set(doc.id, projectValidityStatus(doc, nowIso));
    const badge = formatValidityBadge(doc, nowIso);
    if (badge !== "") badgeById.set(doc.id, badge);
  }
  return { statusById, badgeById };
}

/**
 * Returns a structural copy of `node` with each doc carrying its `validity_status` —
 * the `--json` half of Required #4. Pure; the input tree is never mutated.
 *
 * @param node - A `CorpusService.tree` node (its `doc` is a `DocSummary`, which carries
 *   no `extra`, which is exactly why the verdict must arrive from `index`)
 * @param index - {@link buildValidityIndex}'s output
 * @returns The same shape, plus `doc.validity_status` on every node the index knows
 */
function withTreeValidity(
  node: TreeNode,
  index: Map<string, ValidityStatus>,
): Record<string, unknown> {
  const status = index.get(node.doc.id);
  return {
    doc: status !== undefined ? { ...node.doc, validity_status: status } : { ...node.doc },
    children: node.children.map((child) => withTreeValidity(child, index)),
  };
}

export default defineLoreCommand({
  meta: {
    name: "tree",
    description: "Display document hierarchy as a tree",
  },
  args: {
    root: {
      type: "positional",
      description: "Root document ID or slug (default: the business baseline root; the first PRD when there is none)",
      required: false,
    },
    depth: {
      type: "string",
      description: "Max expansion depth (default: 3)",
      default: "3",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
    orphans: {
      type: "boolean",
      description: "List orphan docs (parent_id=null and not root type, or dangling parent)",
    },
  },
  async run(context): Promise<number> {
    const { args } = context;
    const inv = invocationOf(context);
    const { app } = loadLoreApp({ inv });

    try {
      // ── orphans branch ────────────────────────────────────────────────────
      if (args.orphans) {
        const checkR = await app.treeCheckService.checkTree(
          ORPHAN_DETECTION_BLUEPRINT,
        );
        if (!checkR.ok) {
          inv.io.stderr.write(formatErrorFor(inv, checkR.error) + "\n");
          return exitCode(checkR.error);
        }

        const orphanDrifts = checkR.value.drifts.filter(
          (d) => d.kind === "orphan" && d.actual !== undefined,
        );

        if (args.json) {
          printLine(inv.io.stdout, 
            JSON.stringify(
              {
                ok: true,
                data: {
                  orphans: orphanDrifts.map((d) => ({
                    id: d.actual!.id,
                    slug: d.actual!.slug,
                    type: d.actual!.type,
                    parent_id: d.actual!.parent_id,
                  })),
                },
              },
              null,
              2,
            ),
          );
        } else if (orphanDrifts.length === 0) {
          printLine(inv.io.stdout, "No orphan documents.");
        } else {
          printLine(inv.io.stdout, `${orphanDrifts.length} orphan doc(s):`);
          for (const d of orphanDrifts) {
            printLine(inv.io.stdout, 
              `  - ${d.actual!.slug} (${d.actual!.type}, parent_id=${d.actual!.parent_id ?? "null"})`,
            );
          }
        }

        return orphanDrifts.length > 0 ? 3 : 0;
      }

      // ── normal tree branch ────────────────────────────────────────────────
      // BUG-008 audit: an unvalidated NaN --depth makes `remainingDepth <= 0`
      // (corpus-service.ts's recursion guard) evaluate to false forever — the
      // depth cap silently never triggers. Validate before it reaches the service.
      const depthResult = parsePositiveIntArg(args.depth ?? "3", "--depth", { min: 1 });
      if (!depthResult.ok) {
        inv.io.stderr.write(depthResult.message + "\n");
        return 2;
      }
      const result = await app.corpusService.tree(args.root, { depth: depthResult.value });

      if (!result.ok) {
        // Special-case: no root argument + no PRDs in corpus → actionable message.
        if (
          !args.root &&
          result.error.code === "DOC_NOT_FOUND" &&
          result.error.id === "prd"
        ) {
          inv.io.stderr.write(
            "No PRD documents found. Create a PRD first with `lore create prd --title <name>`.\n",
          );
          return 3;
        }
        inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
        return exitCode(result.error);
      }

      // ── Phase grouping (SPEC-023 AC-PHASE-5, AC-PHASE-6) ─────────────────
      // When the root is a plan with declared phases, render tasks grouped under
      // phase headers. Non-plan roots and plans without phases fall back to the
      // generic formatTree renderer.
      //
      // reason: TreeNode.doc is DocSummary (no extra). We fetch the full plan doc
      // separately; this is one extra O(1) store read, acceptable for a CLI command.
      const nowIso = new Date().toISOString();
      const ttlMinutes = app.taskWorkflowService.claimTtlMinutes;
      // SPEC-043 D4 — always-shown [invalid] badges AND (Required #4) the `--json`
      // `validity_status` key, both read off this ONE evaluation.
      const validity = await buildValidityIndex(app, nowIso);
      const validityBadges = validity.badgeById;

      if (args.root) {
        const fullPlanResult = await app.corpusService.get(args.root);
        if (fullPlanResult.ok && fullPlanResult.value.doc.type === "plan") {
          const plan = fullPlanResult.value.doc;
          const phases = extractPhasesFromExtra(plan.extra);
          // Fetch full child task records so we can read extra.phase and render
          // claim/evidence badges (AC-WF-9) regardless of whether phases are declared.
          const childrenResult = await app.corpusService.listFull({
            parent_id: plan.id,
            type: "task",
          });
          const allTasks = childrenResult.ok ? childrenResult.value.docs : [];

          if (phases.length > 0) {
            if (args.json) {
              printLine(inv.io.stdout, 
                JSON.stringify(
                  {
                    ok: true,
                    data: {
                      ...withTreeValidity(result.value, validity.statusById),
                      phases: phases.map((phase) => ({
                        name: phase.name,
                        description: phase.description,
                        tasks: allTasks
                          .filter((t) => t.extra["phase"] === phase.name)
                          .map((t) => ({
                            id: t.id,
                            slug: t.slug,
                            title: t.title,
                            status: t.status,
                            updated_at: t.updated_at,
                            // reason: these rows are hand-built (not `TreeNode`s), so the
                            // recursive stamper above does not reach them — and they are
                            // the ONLY view of a plan's tasks a phase-declaring plan's
                            // `--json` consumer gets. `t` is a full DocRecord here, so the
                            // verdict is computed from its own `extra`, not looked up.
                            validity_status: projectValidityStatus(t, nowIso),
                          })),
                      })),
                    },
                  },
                  null,
                  2,
                ),
              );
              return 0;
            }

            printLine(inv.io.stdout, formatPhaseTree(plan, phases, allTasks, nowIso, ttlMinutes));
            return 0;
          }

          if (!args.json && allTasks.length > 0) {
            // No declared phases — fall through to the flat formatTree renderer,
            // but still annotate task rows with claim/evidence badges (AC-WF-9).
            const badges = new Map<string, string>(validityBadges);
            for (const task of allTasks) {
              const badge = formatWorkflowBadge(task, nowIso, ttlMinutes);
              if (badge !== "") badges.set(task.id, (badges.get(task.id) ?? "") + badge);
            }
            printLine(inv.io.stdout, formatTree(result.value, "", badges));
            return 0;
          }
        }
      }

      if (args.json) {
        printLine(inv.io.stdout, 
          JSON.stringify({ ok: true, data: withTreeValidity(result.value, validity.statusById) }, null, 2),
        );
        return 0;
      }

      printLine(inv.io.stdout, formatTree(result.value, "", validityBadges));
    } finally {
      app.close();
    }
    return 0;
  },
});
