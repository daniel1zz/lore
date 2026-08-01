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
 * Exit codes:
 *   Normal: 0 = success, non-zero on error
 *   --orphans: 0 = no orphans, 3 = orphans found
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import {
  exitCode,
  formatError,
  formatTree,
  formatValidityBadge,
  formatWorkflowBadge,
  parsePositiveIntArg,
} from "../utils.js";
import type { TreeBlueprint, PlanPhase, DocRecord } from "@lore/core";

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
 * Builds a DocId → " [invalid]" badge map covering every invalidated
 * knowledge/adr/task doc in the corpus (SPEC-043 D3/D4 — `lore tree` never
 * filters invalidated docs, but must always mark them, unlike search/list
 * which filter by default; `task` added by
 * task-a-task-cannot-be-retracted-supersedes-emits-a-repair, mirroring
 * `ValidityService.VALIDITY_ELIGIBLE_TYPES`). Three `listFull` calls
 * (knowledge + adr + task) regardless of the tree's root type — cheap
 * relative to store round trips this command already makes, and correct for
 * any root (an invalidated node of any of these three types can appear
 * anywhere in the tree, not only under a plan).
 */
async function buildValidityBadges(
  app: ReturnType<typeof loadLoreApp>["app"],
  nowIso: string,
): Promise<Map<string, string>> {
  const badges = new Map<string, string>();
  const [knowledgeResult, adrResult, taskResult] = await Promise.all([
    app.corpusService.listFull({ type: "knowledge" }),
    app.corpusService.listFull({ type: "adr" }),
    app.corpusService.listFull({ type: "task" }),
  ]);
  for (const listResult of [knowledgeResult, adrResult, taskResult]) {
    if (!listResult.ok) continue;
    for (const doc of listResult.value.docs) {
      const badge = formatValidityBadge(doc, nowIso);
      if (badge !== "") badges.set(doc.id, badge);
    }
  }
  return badges;
}

export default defineCommand({
  meta: {
    name: "tree",
    description: "Display document hierarchy as a tree",
  },
  args: {
    root: {
      type: "positional",
      description: "Root document ID or slug (default: first PRD)",
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
  async run({ args }) {
    const { app } = loadLoreApp();

    try {
      // ── orphans branch ────────────────────────────────────────────────────
      if (args.orphans) {
        const checkR = await app.treeCheckService.checkTree(
          ORPHAN_DETECTION_BLUEPRINT,
        );
        if (!checkR.ok) {
          process.stderr.write(formatError(checkR.error) + "\n");
          process.exitCode = exitCode(checkR.error);
          return;
        }

        const orphanDrifts = checkR.value.drifts.filter(
          (d) => d.kind === "orphan" && d.actual !== undefined,
        );

        if (args.json) {
          console.log(
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
          console.log("No orphan documents.");
        } else {
          console.log(`${orphanDrifts.length} orphan doc(s):`);
          for (const d of orphanDrifts) {
            console.log(
              `  - ${d.actual!.slug} (${d.actual!.type}, parent_id=${d.actual!.parent_id ?? "null"})`,
            );
          }
        }

        process.exitCode = orphanDrifts.length > 0 ? 3 : 0;
        return;
      }

      // ── normal tree branch ────────────────────────────────────────────────
      // BUG-008 audit: an unvalidated NaN --depth makes `remainingDepth <= 0`
      // (corpus-service.ts's recursion guard) evaluate to false forever — the
      // depth cap silently never triggers. Validate before it reaches the service.
      const depthResult = parsePositiveIntArg(args.depth ?? "3", "--depth", { min: 1 });
      if (!depthResult.ok) {
        process.stderr.write(depthResult.message + "\n");
        process.exitCode = 2;
        return;
      }
      const result = await app.corpusService.tree(args.root, { depth: depthResult.value });

      if (!result.ok) {
        // Special-case: no root argument + no PRDs in corpus → actionable message.
        if (
          !args.root &&
          result.error.code === "DOC_NOT_FOUND" &&
          result.error.id === "prd"
        ) {
          process.stderr.write(
            "No PRD documents found. Create a PRD first with `lore create prd --title <name>`.\n",
          );
          process.exitCode = 3;
          return;
        }
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
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
      // SPEC-043 D4 — always-shown [invalid] badges, merged into every badges map below.
      const validityBadges = await buildValidityBadges(app, nowIso);

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
              console.log(
                JSON.stringify(
                  {
                    ok: true,
                    data: {
                      ...result.value,
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
                          })),
                      })),
                    },
                  },
                  null,
                  2,
                ),
              );
              return;
            }

            console.log(formatPhaseTree(plan, phases, allTasks, nowIso, ttlMinutes));
            return;
          }

          if (!args.json && allTasks.length > 0) {
            // No declared phases — fall through to the flat formatTree renderer,
            // but still annotate task rows with claim/evidence badges (AC-WF-9).
            const badges = new Map<string, string>(validityBadges);
            for (const task of allTasks) {
              const badge = formatWorkflowBadge(task, nowIso, ttlMinutes);
              if (badge !== "") badges.set(task.id, (badges.get(task.id) ?? "") + badge);
            }
            console.log(formatTree(result.value, "", badges));
            return;
          }
        }
      }

      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: result.value }, null, 2));
        return;
      }

      console.log(formatTree(result.value, "", validityBadges));
    } finally {
      app.close();
    }
  },
});
