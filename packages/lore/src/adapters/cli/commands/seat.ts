/**
 * lore seat — plan-bound worktree seat lifecycle (SPEC-057 §Public Interface).
 *
 * `lore seat <plan> [--json]`          — enter (create) a seat worktree for `<plan>`.
 * `lore seat list [--json]`            — list every active seat (branch/created_at/merged
 *                                         — the G13 cost counter-metric data surface, AC-S-7).
 * `lore seat resume <plan> [--json]`   — re-enter an EXISTING seat worktree.
 * `lore seat remove <plan> [--force] [--json]` — remove a seat's worktree + branch; refuses
 *                                         an UNMERGED branch unless `--force`.
 *
 * Thin pipe over `SeatService` — all decisions (entry readiness, unmerged-removal refusal)
 * live in `SeatService`/`core/seat.ts`'s pure predicates, never here.
 *
 * @invariant Dispatch is NOT citty's `subCommands` mechanism — citty rejects any first
 *   positional that isn't a declared subcommand key ("Unknown command"), which would
 *   break `lore seat <plan-slug>` (the bare-positional "enter" form) for any plan whose
 *   slug doesn't happen to be `list`/`resume`/`remove`. Instead, this command declares
 *   TWO plain positionals (`target`, `planArg`) and dispatches manually in `run()` — a
 *   plan literally slugged `list`/`resume`/`remove` is a reserved-word edge case (SPEC-057
 *   accepts it as "code, not config" pragmatism, same posture as the fixed worktree-path
 *   convention).
 * @invariant `enter`'s `mainCwd` is ALWAYS `process.cwd()` — `lore seat <plan>` is only
 *   ever meaningful run from the main checkout (a seat worktree has no `.lore/` of its
 *   own to resolve the plan against, mirrors `bootstrap`'s `bootstrapCwd` redirection
 *   the SessionStart hook performs for OTHER commands, not this one).
 *
 * Exit codes: 0 = success; 1 = SeatService not wired; 2 = missing/invalid `<plan>` for
 *   `resume`/`remove` (CLI usage error, SPEC-051's own convention); other codes per
 *   `utils.ts::exitCode` (3 = DOC_NOT_FOUND, 4 = VALIDATION_ERROR — dirty main, anchor
 *   conflict, unmerged removal without `--force`, no seat found to resume, etc.).
 *
 * Source: SPEC-057 §Module Boundary, §Public Interface, §Acceptance Criteria AC-S-7.
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError } from "../utils.js";
import { buildSeatListJsonPayload, formatSeatList } from "../seat-render.js";
import { invocationOf } from "../command-invocation.js";

const RESERVED_SUBCOMMANDS = new Set(["list", "resume", "remove"]);

export default defineCommand({
  meta: {
    name: "seat",
    description: "Plan-bound worktree seat lifecycle: enter (bare <plan>) / list / resume / remove (SPEC-057)",
  },
  args: {
    target: {
      type: "positional",
      description: "Plan doc id/slug (enter/resume/remove target), or the literal 'list'",
      required: true,
    },
    planArg: {
      type: "positional",
      description: "Plan doc id/slug — required for `seat resume <plan>` / `seat remove <plan>`",
      required: false,
    },
    force: {
      type: "boolean",
      description: "For `remove`: bypass the unmerged-branch refusal (commits will be LOST)",
    },
    json: {
      type: "boolean",
      description: "Output result as JSON",
    },
  },
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    const { app } = loadLoreApp({ inv });
    try {
      if (app.seatService === undefined) {
        process.stderr.write("Error: SeatService not wired on this App instance.\n");
        process.exitCode = 1;
        return;
      }
      const seatService = app.seatService;
      const target = String(args.target);
      const planArg = typeof args.planArg === "string" ? args.planArg : undefined;

      if (target === "list") {
        const result = await seatService.list();
        if (!result.ok) {
          process.stderr.write(formatError(result.error) + "\n");
          process.exitCode = exitCode(result.error);
          return;
        }
        if (args.json) {
          console.log(JSON.stringify(buildSeatListJsonPayload(result.value), null, 2));
        } else {
          console.log(formatSeatList(result.value));
        }
        return;
      }

      if (target === "resume" || target === "remove") {
        if (planArg === undefined || planArg.length === 0) {
          process.stderr.write(`Error: \`lore seat ${target}\` requires a plan id/slug: lore seat ${target} <plan>\n`);
          process.exitCode = 2;
          return;
        }

        if (target === "resume") {
          const result = await seatService.resume(planArg);
          if (!result.ok) {
            process.stderr.write(formatError(result.error) + "\n");
            process.exitCode = exitCode(result.error);
            return;
          }
          if (args.json) {
            console.log(JSON.stringify({ ok: true, data: result.value }, null, 2));
          } else {
            console.log(`Resumed seat for plan ${planArg}: ${result.value.path} (${result.value.branch})`);
          }
          return;
        }

        // target === "remove"
        const result = await seatService.remove(planArg, { force: args.force === true });
        if (!result.ok) {
          process.stderr.write(formatError(result.error) + "\n");
          process.exitCode = exitCode(result.error);
          return;
        }
        if (args.json) {
          console.log(JSON.stringify({ ok: true, data: { removed: planArg } }, null, 2));
        } else {
          console.log(`Removed seat for plan ${planArg}.`);
        }
        return;
      }

      // Bare positional (not a reserved subcommand name) — enter.
      if (RESERVED_SUBCOMMANDS.has(target)) {
        // unreachable given the branches above, kept for exhaustiveness clarity.
        return;
      }
      const result = await seatService.enter(target, { mainCwd: inv.cwd });
      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }
      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: result.value }, null, 2));
      } else {
        console.log(`Entered seat for plan ${target}: ${result.value.path} (${result.value.branch})`);
      }
    } finally {
      app.close();
    }
  },
});
